import { withRetry } from "../../../src/core/retry";

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const result = await withRetry(() => Promise.resolve("hello"));
    expect(result).toBe("hello");
  });

  it("should retry on retryable errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("429 rate limited");
      }
      return "success";
    };

    const result = await withRetry(fn, { baseDelayMs: 10, maxRetries: 3 });
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("should not retry on non-retryable errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error("Invalid API key");
    };

    await expect(
      withRetry(fn, { baseDelayMs: 10, maxRetries: 3 }),
    ).rejects.toThrow("Invalid API key");
    expect(attempts).toBe(1);
  });

  it("should throw after max retries exhausted", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error("503 Service Unavailable");
    };

    await expect(
      withRetry(fn, { baseDelayMs: 10, maxRetries: 2 }),
    ).rejects.toThrow("503");
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("should retry on network errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("ECONNRESET");
      }
      return "recovered";
    };

    const result = await withRetry(fn, { baseDelayMs: 10 });
    expect(result).toBe("recovered");
  });
});
