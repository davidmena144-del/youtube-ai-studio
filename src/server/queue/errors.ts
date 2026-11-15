/** Errors that will not be fixed by retrying (bad configuration, invalid input, auth failure). */
export class NonRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NonRetryableError";
  }
}

/** Errors that are expected to succeed later (rate limits, timeouts, 5xx). Optional explicit delay. */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RetryableError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
