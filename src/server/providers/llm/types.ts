import type { z } from "zod";

export type LlmUsage = { inputTokens: number; outputTokens: number; costUsd: number | null };

export type StructuredRequest<T> = {
  /** Stable name used for logging and the JSON schema. */
  name: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Deterministic output used by the mock provider (no network, no cost). */
  mock: () => T;
  maxTokens?: number;
};

export type StructuredResult<T> = {
  data: T;
  usage: LlmUsage;
  provider: string;
  model: string;
};

/** Replaceable text-generation provider. Implementations: mock, anthropic. */
export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
