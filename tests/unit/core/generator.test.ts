import { Generator } from "../../../src/core/generator";
import * as path from "path";
import { ParsedModule } from "../../../src/parsers/types";
import { GenerateOptions, LLMProvider } from "../../../src/providers/types";

const fakeSecret = ["sk", "proj", "E".repeat(32)].join("-");

function moduleWithSecret(secret: string): ParsedModule {
  return {
    filePath: "src/example.ts",
    language: "typescript",
    functions: [
      {
        name: "example",
        parameters: [],
        returnType: "void",
        isAsync: false,
        isExported: true,
        lineRange: [1, 1],
        existingDoc: secret,
        signature: "function example(): void",
      },
    ],
    classes: [],
    types: [],
    imports: [],
  };
}

function boundarySpanningPrivateKey(): string {
  const delimiter = "-".repeat(5);
  const label = ["PRIVATE", "KEY"].join(" ");
  return [
    `${delimiter}BEGIN ${label}${delimiter}`,
    "fixture-key-body",
    `${delimiter}END ${label}${delimiter}`,
  ].join("\n");
}

class MockProvider implements LLMProvider {
  readonly name = "mock";
  lastPrompt = "";
  lastOptions: GenerateOptions = {};
  calls: Array<{ prompt: string; options: GenerateOptions }> = [];
  response = "Mock response";

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    this.lastPrompt = prompt;
    this.lastOptions = options;
    this.calls.push({ prompt, options });
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
        description: `A test project ${fakeSecret}`,
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
      expect(provider.lastPrompt).not.toContain(fakeSecret);
      expect(provider.lastOptions.temperature).toBe(0.3);
    });
  });

  describe("generateApiDocs", () => {
    it("should call provider with api-doc template", async () => {
      provider.response = "# API Documentation";
      const result = await generator.generateApiDocs([
        moduleWithSecret(fakeSecret),
      ]);

      expect(result).toBe("# API Documentation");
      expect(provider.lastOptions.temperature).toBe(0.2);
      expect(provider.lastPrompt).not.toContain(fakeSecret);
    });
  });

  describe("generateJsDoc", () => {
    it("redacts context and output before JSDoc JSON parsing", async () => {
      provider.response = JSON.stringify([
        { name: "example", jsdoc: fakeSecret },
      ]);

      const result = await generator.generateJsDoc([
        {
          name: "example",
          signature: "function example(): void",
          parameters: [],
          returnType: "void",
          existingDoc: fakeSecret,
        },
      ]);
      const parsed = JSON.parse(result) as Array<{ jsdoc: string }>;

      expect(provider.lastPrompt).not.toContain(fakeSecret);
      expect(result).not.toContain(fakeSecret);
      expect(parsed[0].jsdoc).not.toContain(fakeSecret);
      expect(provider.lastOptions.responseFormat).toBe("json");
    });
  });

  describe("generateChangelog", () => {
    it("should render changelog template", async () => {
      provider.response = "## [1.0.0] - 2024-01-01\n\n### Added\n- New feature";
      const result = await generator.generateChangelog({
        commits: [
          {
            hash: "abc1234",
            message: `feat: add feature ${fakeSecret}`,
            date: "2024-01-01",
          },
        ],
        version: "1.0.0",
        date: "2024-01-01",
        fromRef: "v0.9.0",
        toRef: "HEAD",
      });

      expect(result).toContain("## [1.0.0]");
      expect(provider.lastPrompt).toContain("abc1234");
      expect(provider.lastPrompt).toContain("feat: add feature");
      expect(provider.lastPrompt).not.toContain(fakeSecret);
    });
  });

  describe("generateDiagram", () => {
    it("should call provider with diagram template", async () => {
      provider.response = "graph TD\n    A --> B";
      const diagramModule = moduleWithSecret("safe");
      diagramModule.filePath = fakeSecret;
      const result = await generator.generateDiagram([diagramModule]);

      expect(result).toBe("graph TD\n    A --> B");
      expect(provider.lastOptions.systemPrompt).toContain("software architect");
      expect(provider.lastPrompt).not.toContain(fakeSecret);
    });
  });

  describe("generateUpdate", () => {
    it("should call provider with update template", async () => {
      provider.response = "# Updated Doc";
      const result = await generator.generateUpdate({
        existingDoc: `# Old Doc\n${fakeSecret}`,
        changedFiles: ["src/index.ts"],
        diffSummary: "Added new function",
      });

      expect(result).toBe("# Updated Doc");
      expect(provider.lastPrompt).toContain("# Old Doc");
      expect(provider.lastPrompt).toContain("src/index.ts");
      expect(provider.lastPrompt).not.toContain(fakeSecret);
    });

    it("redacts a complete diff fragment before applying the update limit", async () => {
      const privateKey = boundarySpanningPrivateKey();
      const rawDiff = `${"x".repeat(2950)}${privateKey}`;

      await generator.generateUpdate({
        existingDoc: "# Existing\n",
        changedFiles: ["src/index.ts"],
        diffSummary: rawDiff,
      });

      expect(provider.calls).toHaveLength(1);
      expect(provider.lastPrompt).not.toContain(privateKey.slice(0, 16));
      expect(provider.lastPrompt).not.toContain("fixture-key-body");
      expect(provider.lastPrompt).toContain("<AIDOC_REDACTED:PRIVATE_KEY:1>");
      const transportedDiff = provider.lastPrompt
        .split("--- DIFF SUMMARY ---\n")[1]
        .split("\n\nRequirements:")[0];
      expect(transportedDiff.length).toBeLessThanOrEqual(3000);
    });

    it("blocks a boundary-spanning update secret before calling a strict provider", async () => {
      const strictGenerator = new Generator(provider, templatesDir, {
        policy: "strict",
        origin: "cli",
      });
      const rawDiff = `${"x".repeat(2950)}${boundarySpanningPrivateKey()}`;

      await expect(
        strictGenerator.generateUpdate({
          existingDoc: "# Existing\n",
          changedFiles: ["src/index.ts"],
          diffSummary: rawDiff,
        }),
      ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });

      expect(provider.calls).toHaveLength(0);
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

  describe("security options", () => {
    it("blocks strict input before calling the provider", async () => {
      const strictGenerator = new Generator(provider, templatesDir, {
        policy: "strict",
        origin: "action",
      });

      await expect(
        strictGenerator.generateReadme({
          projectName: "test-project",
          description: fakeSecret,
          modules: [],
          dependencies: [],
          badges: false,
          tableOfContents: false,
          installSection: false,
          usageExamples: false,
        }),
      ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });

      expect(provider.calls).toHaveLength(0);
    });
  });
});
