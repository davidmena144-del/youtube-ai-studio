/**
 * Zero-spend guard. The system must never reach a paid API or a paid fallback.
 *
 * - FORBIDDEN_ENV: if any of these is present in a process environment, the process refuses to
 *   run. ANTHROPIC_API_KEY in particular makes Claude Code bill the API instead of using the
 *   subscription.
 * - FORBIDDEN_PACKAGES / FORBIDDEN_HOSTS: checked by tests/cost-guard.test.ts against
 *   package.json and the source tree, so a paid SDK cannot be reintroduced unnoticed.
 */
export const FORBIDDEN_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "REPLICATE_API_TOKEN",
  "STABILITY_API_KEY",
  "RUNWAY_API_KEY",
  "HEYGEN_API_KEY",
  "AZURE_SPEECH_KEY",
  "GOOGLE_TTS_API_KEY",
] as const;

export const FORBIDDEN_PACKAGES = [
  "@anthropic-ai/sdk",
  "@anthropic-ai/claude-agent-sdk",
  "openai",
  "elevenlabs",
  "@elevenlabs/elevenlabs-js",
  "replicate",
  "@google-cloud/text-to-speech",
  "microsoft-cognitiveservices-speech-sdk",
] as const;

export const FORBIDDEN_HOSTS = [
  "api.anthropic.com",
  "api.openai.com",
  "api.elevenlabs.io",
  "api.replicate.com",
  "api.stability.ai",
  "texttospeech.googleapis.com",
] as const;

export function paidProviderEnvPresent(env: NodeJS.ProcessEnv = process.env): string[] {
  return FORBIDDEN_ENV.filter((name) => typeof env[name] === "string" && env[name] !== "");
}

export class PaidProviderConfiguredError extends Error {
  constructor(names: string[]) {
    super(
      `Refusing to run: paid-provider credentials are configured (${names.join(", ")}). ` +
        "This system runs on the Claude subscription and free services only. Remove them.",
    );
    this.name = "PaidProviderConfiguredError";
  }
}

export function assertNoPaidProviders(env: NodeJS.ProcessEnv = process.env) {
  const found = paidProviderEnvPresent(env);
  if (found.length) throw new PaidProviderConfiguredError(found);
}
