import { ConfigSchema, defaultConfig } from "../../../src/config/schema";

describe("ConfigSchema", () => {
  it("should parse empty object with defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.language).toBe("en");
    expect(result.exclude).toContain("**/node_modules/**");
  });

  it("should accept valid full config", () => {
    const config = {
      provider: "anthropic" as const,
      model: "claude-sonnet-4-20250514",
      language: "ru",
      include: ["src/**/*.ts"],
      exclude: ["dist/**"],
    };
    const result = ConfigSchema.parse(config);
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-20250514");
  });

  it("should reject invalid provider", () => {
    expect(() => ConfigSchema.parse({ provider: "invalid" })).toThrow();
  });

  it("should export defaultConfig with sensible values", () => {
    expect(defaultConfig.provider).toBe("openai");
    expect(defaultConfig.exclude.length).toBeGreaterThan(0);
  });

  it("should parse readme section with defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.readme.badges).toBe(true);
    expect(result.readme.tableOfContents).toBe(true);
  });

  it("should allow partial readme override", () => {
    const result = ConfigSchema.parse({ readme: { badges: false } });
    expect(result.readme.badges).toBe(false);
    expect(result.readme.tableOfContents).toBe(true);
  });
});
