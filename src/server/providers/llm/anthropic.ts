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
};

/** Models that accept the server-side refusal fallback ("default" routing). */
const SUPPORTS_SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: Effort,
  ) {
    // maxRetries: 2 — the SDK retries transient errors itself; our job queue retries on top of that.
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const useFallback = SUPPORTS_SERVER_FALLBACK.has(this.model);
    try {
      // Streaming avoids HTTP timeouts on long scripts; finalMessage() returns the parsed result.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: req.maxTokens ?? 32000,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(req.schema) },
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      const message = await stream.finalMessage();

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
      if (!message.parsed_output) {
        throw new RetryableError(`Model returned output that did not match the "${req.name}" schema`);
      }
      const data = req.schema.parse(message.parsed_output);
      const servedModel = message.model ?? this.model;
      const usage: LlmUsage = {
        inputTokens:
          message.usage.input_tokens +
          (message.usage.cache_read_input_tokens ?? 0) +
          (message.usage.cache_creation_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
        costUsd: estimateCost(servedModel, message.usage.input_tokens, message.usage.output_tokens),
      };
      return { data, usage, provider: this.id, model: servedModel };
    } catch (err) {
      throw classifyAnthropicError(err);
    }
  }
}

/** Map SDK errors to queue semantics: transient → retry, configuration/auth → stop. */
export function classifyAnthropicError(err: unknown): Error {
  if (err instanceof NonRetryableError || err instanceof RetryableError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new NonRetryableError("Anthropic API key is invalid or lacks permission. Check ANTHROPIC_API_KEY.", {
      cause: err,
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get?.("retry-after"));
    return new RetryableError("Anthropic rate limit reached", Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined, {
      cause: err,
    });
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new NonRetryableError(`Anthropic rejected the request: ${err.message}`, { cause: err });
  }
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new RetryableError(`Anthropic temporarily unavailable: ${err.message}`, undefined, { cause: err });
  }
  return err instanceof Error ? err : new Error(String(err));
}
