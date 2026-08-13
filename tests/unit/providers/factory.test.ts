jest.mock("../../../src/providers/openai", () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({ name: "openai" })),
}));

jest.mock("../../../src/providers/anthropic", () => ({
  AnthropicProvider: jest
    .fn()
    .mockImplementation(() => ({ name: "anthropic" })),
}));

import { createProvider } from "../../../src/providers/factory";
import { OpenAIProvider } from "../../../src/providers/openai";
import { AnthropicProvider } from "../../../src/providers/anthropic";

const mockOpenAIProvider = OpenAIProvider as unknown as jest.Mock;
const mockAnthropicProvider = AnthropicProvider as unknown as jest.Mock;

function fakeCredential(label: string): string {
  return ["credential", label, "x".repeat(32)].join("-");
}

function missingProviderMessage(provider: "openai" | "anthropic"): string {
  try {
    createProvider({ provider });
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected ${provider} to require a credential`);
}

describe("createProvider", () => {
  let originalOpenAiKey: string | undefined;
  let originalAnthropicKey: string | undefined;

  beforeEach(() => {
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  });

  it("should create OpenAI provider", () => {
    const apiKey = fakeCredential("programmatic-openai");
    const provider = createProvider({ provider: "openai", apiKey });

    expect(provider.name).toBe("openai");
    expect(mockOpenAIProvider).toHaveBeenLastCalledWith(apiKey, undefined);
  });

  it("should create Anthropic provider", () => {
    const apiKey = fakeCredential("programmatic-anthropic");
    const provider = createProvider({
      provider: "anthropic",
      apiKey,
    });

    expect(provider.name).toBe("anthropic");
    expect(mockAnthropicProvider).toHaveBeenLastCalledWith(apiKey, undefined);
  });

  it("should create Ollama provider without API key", () => {
    const provider = createProvider({ provider: "ollama", model: "llama3" });
    expect(provider.name).toBe("ollama");
  });

  it("uses OPENAI_API_KEY when it is present instead of the programmatic key", () => {
    const configuredKey = fakeCredential("configured-openai");
    const environmentKey = fakeCredential("environment-openai");
    process.env.OPENAI_API_KEY = environmentKey;

    createProvider({ provider: "openai", apiKey: configuredKey });

    expect(mockOpenAIProvider).toHaveBeenLastCalledWith(
      environmentKey,
      undefined,
    );
  });

  it("uses ANTHROPIC_API_KEY when it is present instead of the programmatic key", () => {
    const configuredKey = fakeCredential("configured-anthropic");
    const environmentKey = fakeCredential("environment-anthropic");
    process.env.ANTHROPIC_API_KEY = environmentKey;

    createProvider({ provider: "anthropic", apiKey: configuredKey });

    expect(mockAnthropicProvider).toHaveBeenLastCalledWith(
      environmentKey,
      undefined,
    );
  });

  it("accepts OPENAI_API_KEY when no programmatic key is provided", () => {
    const environmentKey = fakeCredential("only-openai-environment");
    process.env.OPENAI_API_KEY = environmentKey;

    const provider = createProvider({ provider: "openai" });

    expect(provider.name).toBe("openai");
    expect(mockOpenAIProvider).toHaveBeenLastCalledWith(
      environmentKey,
      undefined,
    );
  });

  it("accepts ANTHROPIC_API_KEY when no programmatic key is provided", () => {
    const environmentKey = fakeCredential("only-anthropic-environment");
    process.env.ANTHROPIC_API_KEY = environmentKey;

    const provider = createProvider({ provider: "anthropic" });

    expect(provider.name).toBe("anthropic");
    expect(mockAnthropicProvider).toHaveBeenLastCalledWith(
      environmentKey,
      undefined,
    );
  });

  it("guides a missing OpenAI credential to OPENAI_API_KEY only", () => {
    const message = missingProviderMessage("openai");

    expect(message).toContain("OPENAI_API_KEY");
    expect(message).not.toContain("Config file");
    expect(message).not.toContain(".env file");
  });

  it("guides a missing Anthropic credential to ANTHROPIC_API_KEY only", () => {
    const message = missingProviderMessage("anthropic");

    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).not.toContain("Config file");
    expect(message).not.toContain(".env file");
  });
});
