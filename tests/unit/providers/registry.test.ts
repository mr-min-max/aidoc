import {
  registerProvider,
  listProviders,
  createProvider,
} from "../../../src/providers/registry";
import { Generator } from "../../../src/core/generator";
import { LLMProvider } from "../../../src/providers/types";
import * as path from "path";

describe("provider registry", () => {
  it("lists built-in providers", () => {
    const names = listProviders().map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(["openai", "anthropic", "ollama"]),
    );
  });

  it("creates a known provider", () => {
    const p = createProvider({ provider: "ollama" });
    expect(p.name).toBe("ollama");
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
