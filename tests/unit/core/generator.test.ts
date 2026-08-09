import { Generator } from "../../../src/core/generator";
import * as path from "path";
import { ParsedModule } from "../../../src/parsers/types";
import { GenerateOptions, LLMProvider } from "../../../src/providers/types";
import { canonicalStringify } from "../../../src/impact/canonical";
import { createImpactPlan } from "../../../src/impact/planner";
import type { ImpactProviderContext } from "../../../src/impact/types";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function updateImpactContext(): ImpactProviderContext {
  return {
    schemaVersion: "aidoc.impact-context.v1",
    impactDigest: "a".repeat(64),
    summary: {
      totalChanges: 1,
      publicApiChanges: 1,
      potentiallyBreaking: 1,
      reviewRequired: 0,
      informational: 0,
      unmapped: 0,
      byCategory: {
        added: 0,
        removed: 0,
        moved: 0,
        "contract-changed": 1,
        "implementation-changed": 0,
        "documentation-changed": 0,
        "dependency-changed": 0,
      },
    },
    changes: [
      {
        id: "typescript:src/index.ts#function:transform",
        category: "contract-changed",
        risk: "potentially-breaking",
        path: "src/index.ts",
        kind: "function",
        qualifiedName: "transform",
        changedContractFacets: ["parameters", "return"],
      },
    ],
    documentation: [
      {
        changeId: "typescript:src/index.ts#function:transform",
        directReferences: [
          {
            file: "README.md",
            section: "API",
            slug: "api",
            reason: "code-span",
          },
        ],
        recommendations: [],
        unmapped: false,
      },
    ],
    omittedRecords: 0,
  };
}

function impactRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "aidoc-update-generator-"));
  const hooks = join(root, "hooks");
  mkdirSync(join(root, "src"));
  mkdirSync(hooks);
  execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
    cwd: root,
  });
  execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(
    join(root, "README.md"),
    "# Project\n\n## API\n\nUse `transform`.\n",
  );
  writeFileSync(
    join(root, "src/index.ts"),
    [
      "/** RAW_COMMENT_SENTINEL */",
      'export function transform(input: string = "RAW_DEFAULT_SENTINEL"): string {',
      '  return "RAW_BODY_SENTINEL";',
      "}",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
  writeFileSync(
    join(root, "src/index.ts"),
    [
      "/** HEAD_COMMENT_SENTINEL */",
      "export function transform(input: number = 42): number {",
      "  const HEAD_BODY_SENTINEL = 7;",
      "  return HEAD_BODY_SENTINEL;",
      "}",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "change contract"], { cwd: root });
  return root;
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
    it("renders only selected impact fields and the separately approved document", async () => {
      provider.response = "# Updated Doc";
      const result = await generator.generateUpdate({
        existingDoc: `# Old Doc\n${fakeSecret}`,
        impactPlan: updateImpactContext(),
      });

      expect(result).toBe("# Updated Doc");
      expect(provider.lastPrompt).toContain("# Old Doc");
      expect(provider.lastPrompt).toContain(
        "typescript:src/index.ts#function:transform",
      );
      expect(provider.lastPrompt).toContain("contract-changed");
      expect(provider.lastPrompt).toContain("potentially-breaking");
      expect(provider.lastPrompt).toContain("parameters");
      expect(provider.lastPrompt).toContain("README.md");
      expect(provider.lastPrompt).toContain("API");
      expect(provider.lastPrompt).not.toContain(fakeSecret);
    });

    it("never transports raw source, signatures, diffs, or repository roots", async () => {
      const root = impactRepository();
      try {
        const result = await createImpactPlan({
          cwd: root,
          base: "HEAD~1",
          head: "HEAD",
        });

        await generator.generateUpdate({
          existingDoc: "# Project\n\n## API\n\nUse `transform`.\n",
          impactPlan: result.providerContext,
        });

        expect(provider.calls).toHaveLength(1);
        expect(provider.lastPrompt).toContain("#function:transform");
        expect(provider.lastPrompt).toContain("contract-changed");
        expect(provider.lastPrompt).toContain("review-required");
        expect(provider.lastPrompt).toContain("parameters");
        expect(provider.lastPrompt).toContain("README.md");
        expect(provider.lastPrompt).not.toMatch(
          /RAW_COMMENT_SENTINEL|RAW_DEFAULT_SENTINEL|RAW_BODY_SENTINEL|HEAD_COMMENT_SENTINEL|HEAD_BODY_SENTINEL/u,
        );
        expect(provider.lastPrompt).not.toContain(
          "export function transform(input: number = 42): number",
        );
        expect(provider.lastPrompt).not.toMatch(/@@|--- a\/|\+\+\+ b\//u);
        expect(provider.lastPrompt).not.toContain(root);
        expect(
          Buffer.byteLength(canonicalStringify(result.providerContext), "utf8"),
        ).toBeLessThanOrEqual(result.plan.context.maxBytes);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("blocks a secret in the existing document before calling a strict provider", async () => {
      const strictGenerator = new Generator(provider, templatesDir, {
        policy: "strict",
        origin: "cli",
      });

      await expect(
        strictGenerator.generateUpdate({
          existingDoc: `# Existing\n${boundarySpanningPrivateKey()}`,
          impactPlan: updateImpactContext(),
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
