import { env } from "../../env";
import { NonRetryableError } from "../../queue/errors";
import type { AppSettings } from "../../settings";
import { AnthropicLlmProvider } from "./anthropic";
import { MockLlmProvider } from "./mock";
import type { LlmProvider } from "./types";

export type LlmProviderId = "mock" | "anthropic";

export function resolveLlmProviderId(): LlmProviderId {
  const e = env();
  if (e.LLM_PROVIDER === "mock") return "mock";
  if (e.LLM_PROVIDER === "anthropic") return "anthropic";
  return e.ANTHROPIC_API_KEY ? "anthropic" : "mock";
}

let override: LlmProvider | null = null;

/** Tests only: force a specific provider. */
export function setLlmProviderOverride(p: LlmProvider | null) {
  override = p;
}

export function createLlmProvider(settings: AppSettings): LlmProvider {
  if (override) return override;
  const id = resolveLlmProviderId();
  if (id === "mock") return new MockLlmProvider();
  const key = env().ANTHROPIC_API_KEY;
  if (!key) throw new NonRetryableError("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
  return new AnthropicLlmProvider(key, settings.llmModel, settings.llmEffort);
}

export type { LlmProvider } from "./types";
