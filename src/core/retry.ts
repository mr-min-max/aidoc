import { logger } from "./logger";

/** Options for configuring retry behavior. */
export interface RetryOptions {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Base delay in milliseconds between retries (doubled each attempt). */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
  /** Whether to add jitter to the delay to prevent thundering herd. */
  jitter: boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * Determines if an error is retryable.
 * Rate limits (429), server errors (5xx), and network errors are retryable.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Rate limit errors
    if (message.includes("429") || message.includes("rate limit")) return true;
    // Server errors
    if (
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503")
    )
      return true;
    // Network errors
    if (
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("timeout")
    )
      return true;
  }
  return false;
}

/**
 * Wraps an async function with exponential backoff retry logic.
 * Only retries on retryable errors (rate limits, server errors, network errors).
 *
 * @param fn - The async function to execute with retry protection.
 * @param options - Configuration for retry behavior.
 * @returns The result of the function on success.
 * @throws The last error after all retries are exhausted.
 *
 * @example
 * ```ts
 * const result = await withRetry(() => provider.generate(prompt));
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries || !isRetryableError(error)) {
        throw lastError;
      }

      const baseDelay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs,
      );
      const delay = opts.jitter
        ? baseDelay * (0.5 + Math.random() * 0.5)
        : baseDelay;

      logger.warn(
        `Attempt ${attempt + 1}/${opts.maxRetries + 1} failed: ${lastError.message}. ` +
          `Retrying in ${Math.round(delay)}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
