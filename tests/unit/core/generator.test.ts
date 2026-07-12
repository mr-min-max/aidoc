import { Generator } from "../../../src/core/generator.js";
import { LLMProvider, GenerateOptions } from "../../../src/providers/types.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockProvider implements LLMProvider {
  readonly name = "mock";
  lastPrompt = "";
  lastOptions: GenerateOptions = {};
  response = "Mock response";

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    this.lastPrompt = prompt;
    this.lastOptions = options;
    return this.response;
  }
}

describe("Generator", () => {
  let provider: MockProvider;
  let generator: Generator;
  const templatesDir = path.resolve(__dirname, "../../../src/templates");

  beforeEach(() => {
    provider = new MockProvider();
    generator = new Generator(provider, templatesDir);
  });

  describe("generateReadme", () => {
    it("should render readme template and call provider", async () => {
      provider.response = "# Test Project\n\nHello world.";
      const result = await generator.generateReadme({
        projectName: "test-project",
        description: "A test project",
        modules: [],
        dependencies: ["chalk", "commander"],
        badges: true,
        tableOfContents: true,
        installSection: true,
        usageExamples: true,
      });

      expect(result).toBe("# Test Project\n\nHello world.");
      expect(provider.lastPrompt).toContain("test-project");
      expect(provider.lastPrompt).toContain("A test project");
      expect(provider.lastPrompt).toContain("chalk");
      expect(provider.lastOptions.temperature).toBe(0.3);
    });
  });

  describe("generateApiDocs", () => {
    it("should call provider with api-doc template", async () => {
      provider.response = "# API Documentation";
      const result = await generator.generateApiDocs([]);

      expect(result).toBe("# API Documentation");
      expect(provider.lastOptions.temperature).toBe(0.2);
    });
  });

  describe("generateChangelog", () => {
    it("should render changelog template", async () => {
      provider.response = "## [1.0.0] - 2024-01-01\n\n### Added\n- New feature";
      const result = await generator.generateChangelog({
        commits: [
          { hash: "abc1234", message: "feat: add feature", date: "2024-01-01" },
        ],
        version: "1.0.0",
        date: "2024-01-01",
        fromRef: "v0.9.0",
        toRef: "HEAD",
      });

      expect(result).toContain("## [1.0.0]");
      expect(provider.lastPrompt).toContain("abc1234");
      expect(provider.lastPrompt).toContain("feat: add feature");
    });
  });

  describe("generateDiagram", () => {
    it("should call provider with diagram template", async () => {
      provider.response = "graph TD\n    A --> B";
      const result = await generator.generateDiagram([]);

      expect(result).toBe("graph TD\n    A --> B");
      expect(provider.lastOptions.systemPrompt).toContain("software architect");
    });
  });

  describe("generateUpdate", () => {
    it("should call provider with update template", async () => {
      provider.response = "# Updated Doc";
      const result = await generator.generateUpdate({
        existingDoc: "# Old Doc",
        changedFiles: ["src/index.ts"],
        diffSummary: "Added new function",
      });

      expect(result).toBe("# Updated Doc");
      expect(provider.lastPrompt).toContain("# Old Doc");
      expect(provider.lastPrompt).toContain("src/index.ts");
    });
  });

  describe("template caching", () => {
    it("should cache templates after first use", async () => {
      await generator.generateReadme({
        projectName: "p1",
        description: "",
        modules: [],
        dependencies: [],
        badges: false,
        tableOfContents: false,
        installSection: false,
        usageExamples: false,
      });
      // Second call should use cached template (no error)
      await generator.generateReadme({
        projectName: "p2",
        description: "",
        modules: [],
        dependencies: [],
        badges: false,
        tableOfContents: false,
        installSection: false,
        usageExamples: false,
      });
      expect(provider.lastPrompt).toContain("p2");
    });
  });

  describe("error handling", () => {
    it("should throw on missing template", async () => {
      const badGenerator = new Generator(provider, "/nonexistent");
      await expect(
        badGenerator.generateReadme({
          projectName: "test",
          description: "",
          modules: [],
          dependencies: [],
          badges: false,
          tableOfContents: false,
          installSection: false,
          usageExamples: false,
        }),
      ).rejects.toThrow("Template not found");
    });
  });
});
