import { jest } from "@jest/globals";

// Under ESM, module mocks must be registered with `unstable_mockModule` before
// the module under test is dynamically imported.
const createMock = jest.fn();
jest.unstable_mockModule("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}));

const { OpenAIProvider } = await import("../../../src/providers/openai.js");

describe("OpenAIProvider retry", () => {
  beforeEach(() => createMock.mockReset());

  it("retries on 429 then succeeds", async () => {
    const provider = new OpenAIProvider("test-key", "gpt-4o-mini");

    createMock
      .mockRejectedValueOnce({ status: 429, message: "Rate limited" })
      .mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });

    const result = await provider.generate("hi", { maxTokens: 10 });
    expect(result).toBe("ok");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable error", async () => {
    const provider = new OpenAIProvider("test-key", "gpt-4o-mini");
    createMock.mockRejectedValue({ status: 401, message: "Invalid key" });

    await expect(provider.generate("hi")).rejects.toThrow();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
