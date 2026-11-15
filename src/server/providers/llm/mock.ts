import type { LlmProvider, StructuredRequest, StructuredResult } from "./types";

/**
 * Free, offline provider. Returns each agent's deterministic template output, validated
 * against the same schema a real model must satisfy. Content is clearly labelled as mock.
 */
export class MockLlmProvider implements LlmProvider {
  readonly id = "mock";
  readonly model = "mock-template-v1";

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const data = req.schema.parse(req.mock());
    return { data, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, provider: this.id, model: this.model };
  }
}
