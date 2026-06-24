import {
  registerProvider,
  listProviders,
  createProvider,
} from "../../../src/providers/registry";

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
});
