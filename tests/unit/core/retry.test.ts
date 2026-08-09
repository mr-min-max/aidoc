import { withRetry } from "../../../src/core/retry";
import { logger } from "../../../src/core/logger";

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

  it("redacts provider secrets from retry warnings", async () => {
    const fakeKey = ["sk", "proj", "R".repeat(32)].join("-");
    const warnings: string[] = [];
    const warn = jest
      .spyOn(logger, "warn")
      .mockImplementation((message) => warnings.push(message));
    let attempts = 0;

    try {
      await withRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error(`429 provider rejected ${fakeKey}`);
          }
          return "success";
        },
        { baseDelayMs: 0, jitter: false, maxRetries: 1 },
      );
    } finally {
      warn.mockRestore();
    }

    const diagnostic = warnings.join("\n");
    expect(diagnostic).toContain("<AIDOC_REDACTED:OPENAI_API_KEY:1>");
    expect(diagnostic).not.toContain(fakeKey);
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

  it("uses a fixed diagnostic when a retry error message getter throws", async () => {
    const hostileSecret = ["sk", "proj", "Q".repeat(32)].join("-");
    const hostileError = new Error("unused");
    Object.defineProperty(hostileError, "message", {
      get: () => {
        throw new Error(hostileSecret);
      },
    });

    await expect(
      withRetry(
        async () => {
          throw hostileError;
        },
        { maxRetries: 0, jitter: false },
      ),
    ).rejects.toMatchObject({ message: "Unknown error." });
  });
});
