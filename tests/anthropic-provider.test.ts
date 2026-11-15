import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ResearchSchema, type Research } from "@/server/agents/types";
import { AnthropicLlmProvider } from "@/server/providers/llm/anthropic";
import { NonRetryableError, RetryableError } from "@/server/queue/errors";

/**
 * Exercises the REAL @anthropic-ai/sdk code path against a local imitation of the Messages API
 * (no network, no key, no cost). Verifies request shape and error handling.
 */
type Scenario = "ok" | "truncated" | "refusal" | "unauthorized" | "badjson";
let scenario: Scenario = "ok";
let requests: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
let server: http.Server;
const savedBase = process.env.ANTHROPIC_BASE_URL;

const valid: Research = {
  summary: "s",
  audience: "a",
  keyPoints: ["k"],
  angles: [{ title: "t", why: "w" }],
  facts: [],
  viewerQuestions: [],
  risks: [],
};

function sse(res: http.ServerResponse, text: string, stopReason: string, extra: Record<string, unknown> = {}) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  ev("message_start", {
    type: "message_start",
    message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } },
  });
  ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
  ev("content_block_stop", { type: "content_block_stop", index: 0 });
  ev("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null, ...extra }, usage: { output_tokens: 500 } });
  ev("message_stop", { type: "message_stop" });
  res.end();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      if (scenario === "unauthorized") {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid key" } }));
      }
      if (scenario === "ok") return sse(res, JSON.stringify(valid), "end_turn");
      if (scenario === "truncated") return sse(res, JSON.stringify(valid).slice(0, 25), "max_tokens");
      if (scenario === "refusal") return sse(res, "", "refusal");
      return sse(res, "{not json", "end_turn");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  process.env.ANTHROPIC_BASE_URL = savedBase;
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  requests = [];
});

const req = { name: "research", system: "You are the Research Agent", prompt: "topic", schema: ResearchSchema, mock: () => valid };
const provider = () => new AnthropicLlmProvider("sk-test-not-real", "claude-opus-5-5", "medium");

describe("AnthropicLlmProvider via the real SDK", () => {
  it("sends a structured-output request with effort and refusal fallback, and parses the result", async () => {
    scenario = "ok";
    const r = await provider().generateStructured(req);
    expect(r.data).toEqual(valid);
    expect(r.provider).toBe("anthropic");
    expect(r.usage).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    expect(r.usage.costUsd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6, 8);

    expect(requests).toHaveLength(1);
    const { headers, body } = requests[0];
    expect(headers.authorization).toBe("Bearer sk-test-not-real");
    expect(headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body).toMatchObject({ model: "claude-opus-5-5", stream: true, fallbacks: "default" });
    const oc = body.output_config as { effort: string; format: { type: string; schema: { properties: object } } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    expect(Object.keys(oc.format.schema.properties)).toContain("keyPoints");
    expect(body).not.toHaveProperty("thinking"); // adaptive by default on this model
  });

  it("treats truncated output (max_tokens) as permanent — one request, no paid retries", async () => {
    scenario = "truncated";
    await expect(provider().generateStructured(req)).rejects.toBeInstanceOf(NonRetryableError);
    expect(requests).toHaveLength(1);
  });

  it("treats a refusal as permanent", async () => {
    scenario = "refusal";
    await expect(provider().generateStructured(req)).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("treats an invalid key as permanent", async () => {
    scenario = "unauthorized";
    await expect(provider().generateStructured(req)).rejects.toBeInstanceOf(NonRetryableError);
    expect(requests).toHaveLength(1);
  });

  it("treats malformed JSON as retryable", async () => {
    scenario = "badjson";
    await expect(provider().generateStructured(req)).rejects.toBeInstanceOf(RetryableError);
  });
});
