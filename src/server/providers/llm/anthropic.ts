import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NonRetryableError, RetryableError } from "../../queue/errors";
import type { LlmProvider, LlmUsage, StructuredRequest, StructuredResult } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** USD per million tokens (input, output). Used only for the cost estimate shown in the UI. */
const PRICING: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  // Models the server-side refusal fallback may route to.
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [2, 10],
};

/** Models that accept the server-side refusal fallback ("default" routing). */
const SUPPORTS_SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

/**
 * Hard limit for one generation, covering the connection AND the whole streamed body.
 * (The SDK's own `timeout` only covers the wait for response headers: its timer is cleared once
 * fetch resolves, so a stalled stream would otherwise hang forever.) It is kept below the queue's
 * 15-minute lease; the worker also refreshes the lease while a job runs (heartbeat), and the
 * result is saved only if this worker still owns the job — together these prevent a paid call
 * from being executed twice in parallel.
 */
export const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
/** Time to receive response headers (SDK-level timeout). */
const CONNECT_TIMEOUT_MS = 2 * 60 * 1000;

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  private readonly generationTimeoutMs: number;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: Effort,
    opts: { generationTimeoutMs?: number } = {},
  ) {
    this.generationTimeoutMs = opts.generationTimeoutMs ?? GENERATION_TIMEOUT_MS;
    // No SDK-level retries: a retry inside one job would re-pay for the call outside the queue's
    // attempt accounting. Transient failures are retried by the job queue (bounded by maxAttempts).
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: Math.min(CONNECT_TIMEOUT_MS, this.generationTimeoutMs) });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const useFallback = SUPPORTS_SERVER_FALLBACK.has(this.model);
    // Send only the JSON schema (no auto-parse): the SDK's auto-parser throws on truncated
    // output before stop_reason can be inspected, which would turn a permanent error into
    // paid retries. We check stop_reason first, then validate with Zod ourselves.
    const { type, schema } = betaZodOutputFormat(req.schema);
    let message: Anthropic.Beta.BetaMessage;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.generationTimeoutMs);
    try {
      // Streaming avoids HTTP timeouts on long scripts; the abort signal bounds the whole stream.
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? 32000,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          output_config: { effort: this.effort, format: { type, schema } },
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: deadline.signal },
      );
      message = await stream.finalMessage();
    } catch (err) {
      if (deadline.signal.aborted) {
        throw new RetryableError(`Claude did not finish within ${Math.round(this.generationTimeoutMs / 1000)} s`, undefined, { cause: err });
      }
      throw classifyAnthropicError(err);
    } finally {
      clearTimeout(timer);
    }

    if (message.stop_reason === "refusal") {
      throw new NonRetryableError(
        `The model declined this request (${message.stop_details?.category ?? "unspecified"}). Edit the topic or notes and retry.`,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new NonRetryableError(
        `Output exceeded the token limit for "${req.name}". Shorten the target duration or raise the limit.`,
      );
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new RetryableError(`Model returned invalid JSON for "${req.name}"`);
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new RetryableError(`Model output did not match the "${req.name}" schema`);

    const servedModel = message.model ?? this.model;
    const usage: LlmUsage = {
      inputTokens:
        message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
      costUsd: estimateCost(servedModel, message.usage.input_tokens, message.usage.output_tokens),
    };
    return { data: parsed.data, usage, provider: this.id, model: servedModel };
  }
}

/** Map SDK errors to queue semantics: transient → retry, configuration/auth → stop. */
export function classifyAnthropicError(err: unknown): Error {
  if (err instanceof NonRetryableError || err instanceof RetryableError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new NonRetryableError("Anthropic API key is invalid or lacks permission. Check ANTHROPIC_API_KEY.", { cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get?.("retry-after"));
    return new RetryableError("Anthropic rate limit reached", Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined, { cause: err });
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new NonRetryableError(`Anthropic rejected the request: ${err.message}`, { cause: err });
  }
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new RetryableError(`Anthropic temporarily unavailable: ${err.message}`, undefined, { cause: err });
  }
  return err instanceof Error ? err : new Error(String(err));
}
