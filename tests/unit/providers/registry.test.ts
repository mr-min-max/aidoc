import {
  registerProvider,
  listProviders,
  createProvider,
} from "../../../src/providers/registry";
import { Generator } from "../../../src/core/generator";
import { LLMProvider } from "../../../src/providers/types";
import * as path from "path";
import { OpenAICompatibleProvider } from "../../../src/providers/compatible";

describe("provider registry", () => {
  it("lists built-in providers", () => {
    const names = listProviders().map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "openai",
        "anthropic",
        "deepseek",
        "qwen",
        "ollama",
        "openai-compatible",
      ]),
    );
  });

  it("creates a known provider with an explicit Ollama model", () => {
    const p = createProvider({ provider: "ollama", model: "qwen2" });
    expect(p.name).toBe("ollama");
  });

  it("rejects auto instead of selecting a hidden provider", () => {
    expect(() => createProvider({ provider: "auto" })).toThrow(
      "Provider selection is required",
    );
  });

  it("constructs DeepSeek with its exact key, model, and fixed origin", () => {
    const original = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "fake-deepseek-key";
    try {
      const provider = createProvider({ provider: "deepseek" });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.name).toBe("deepseek");
      expect((provider as unknown as { model: string }).model).toBe(
        "deepseek-v4-flash",
      );
      expect(
        (provider as unknown as { endpoint: { origin: string } }).endpoint
          .origin,
      ).toBe("https://api.deepseek.com");
    } finally {
      if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = original;
    }
  });

  it("constructs Qwen and generic compatible providers from accepted endpoints", () => {
    const originalQwen = process.env.DASHSCOPE_API_KEY;
    const originalCompat = process.env.AIDOC_COMPAT_API_KEY;
    process.env.DASHSCOPE_API_KEY = "fake-qwen-key";
    process.env.AIDOC_COMPAT_API_KEY = "fake-compatible-key";
    const qwenEndpoint = {
      url: new URL("https://dashscope.aliyuncs.com/compatible-mode/v1"),
      origin: "https://dashscope.aliyuncs.com",
      local: false,
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
    };
    const compatibleEndpoint = {
      url: new URL("https://gateway.example.test/v1"),
      origin: "https://gateway.example.test",
      local: false,
      addresses: [{ address: "93.184.216.35", family: 4 as const }],
    };
    try {
      const qwen = createProvider({
        provider: "qwen",
        endpoint: qwenEndpoint,
        qwen: { region: "china-beijing" },
      });
      expect(qwen).toBeInstanceOf(OpenAICompatibleProvider);
      expect((qwen as unknown as { model: string }).model).toBe(
        "qwen3.6-flash",
      );
      const compatible = createProvider({
        provider: "openai-compatible",
        model: "explicit-model",
        endpoint: compatibleEndpoint,
      });
      expect(compatible).toBeInstanceOf(OpenAICompatibleProvider);
      expect(compatible.name).toBe("openai-compatible");
      expect((compatible as unknown as { model: string }).model).toBe(
        "explicit-model",
      );
    } finally {
      if (originalQwen === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = originalQwen;
      if (originalCompat === undefined) delete process.env.AIDOC_COMPAT_API_KEY;
      else process.env.AIDOC_COMPAT_API_KEY = originalCompat;
    }
  });

  it("does not forward an OpenAI key to compatible providers", () => {
    const originalOpenAI = process.env.OPENAI_API_KEY;
    const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.OPENAI_API_KEY = "fake-openai-key";
    try {
      expect(() => createProvider({ provider: "deepseek" })).toThrow(
        /DEEPSEEK_API_KEY/,
      );
    } finally {
      if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAI;
      if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
    }
  });

  it("never lets a DeepSeek credential cross the fixed DeepSeek origin", () => {
    const original = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "fake-deepseek-key";
    try {
      expect(() =>
        createProvider({
          provider: "deepseek",
          endpoint: {
            url: new URL("https://attacker.example/v1"),
            origin: "https://attacker.example",
            local: false,
            addresses: [{ address: "93.184.216.34", family: 4 }],
          },
        }),
      ).toThrow(expect.objectContaining({ code: "PROVIDER_INVALID_ENDPOINT" }));
    } finally {
      if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = original;
    }
  });

  it("binds a Qwen credential to the canonical selected region endpoint", () => {
    const original = process.env.DASHSCOPE_API_KEY;
    process.env.DASHSCOPE_API_KEY = "fake-qwen-key";
    try {
      expect(() =>
        createProvider({
          provider: "qwen",
          qwen: { region: "china-beijing" },
          endpoint: {
            url: new URL("https://attacker.example/compatible-mode/v1"),
            origin: "https://attacker.example",
            local: false,
            addresses: [{ address: "93.184.216.34", family: 4 }],
          },
        }),
      ).toThrow(expect.objectContaining({ code: "PROVIDER_INVALID_ENDPOINT" }));
    } finally {
      if (original === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = original;
    }
  });

  it("throws on unknown provider", () => {
    expect(() => createProvider({ provider: "nope" as any })).toThrow(
      "Unknown provider: nope",
    );
  });

  it("lets third parties register a provider", () => {
    const fake = { generate: async () => "fake", name: "fake" };
    registerProvider({
      name: "fake",
      available: () => true,
      create: () => fake as any,
    });
    const p = createProvider({ provider: "fake" });
    expect(p.name).toBe("fake");
  });

  it("applies Generator trust policy to a registered provider", async () => {
    const fakeSecret = ["sk", "proj", "F".repeat(32)].join("-");
    let receivedPrompt = "";
    const customProvider: LLMProvider = {
      name: "custom-trust-provider",
      generate: async (prompt) => {
        receivedPrompt = prompt;
        return "# Safe";
      },
    };

    registerProvider({
      name: "custom-trust-provider",
      available: () => true,
      create: () => customProvider,
    });

    const generator = new Generator(
      createProvider({ provider: "custom-trust-provider" }),
      path.resolve(__dirname, "../../../src/templates"),
    );
    await generator.generateReadme({
      projectName: "custom-provider-project",
      description: fakeSecret,
      modules: [],
      dependencies: [],
      badges: false,
      tableOfContents: false,
      installSection: false,
      usageExamples: false,
    });

    expect(receivedPrompt).not.toContain(fakeSecret);
  });
});
