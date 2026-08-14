import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as analyzer from "../../../src/core/analyzer";
import {
  createMCPServerContext,
  handleToolCall,
  TOOLS,
} from "../../../src/mcp/server";
import { registerProvider } from "../../../src/providers/registry";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(root: string, message: string): string {
  git(root, "add", ".");
  git(root, "-c", "commit.gpgSign=false", "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-wiring-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "aidoc test");
  git(root, "config", "user.email", "aidoc-test@example.invalid");
  fs.writeFileSync(
    path.join(root, ".aidocrc.json"),
    JSON.stringify({ include: ["**/*.ts"], exclude: [] }),
  );
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    "export function documented(): string { return 'safe'; }\n",
  );
  fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
  commit(root, "fixture: baseline");
  return root;
}

describe("scoped legacy MCP routes", () => {
  it("advertises exact repository-scoped legacy directory contracts", () => {
    const description =
      "Path within the Git worktree where this MCP server started (absolute or repository-relative).";
    for (const name of [
      "analyze_codebase",
      "generate_readme",
      "generate_api_docs",
      "generate_diagram",
      "check_docs_freshness",
    ]) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      expect(tool?.inputSchema.additionalProperties).toBe(false);
      expect(tool?.inputSchema.properties?.directory).toEqual(
        expect.objectContaining({ description }),
      );
    }
  });

  it("analyzes an authorized relative subdirectory from captured snapshots", async () => {
    const root = createFixture();
    try {
      const context = await createMCPServerContext(root, Object.create(null));
      const result = (await handleToolCall(
        "analyze_codebase",
        { directory: "src" },
        context,
      )) as { modules: Array<{ filePath: string }>; totalModules: number };

      expect(result.totalModules).toBe(1);
      expect(result.modules.map((module) => module.filePath)).toEqual([
        "src/index.ts",
      ]);
      expect(JSON.stringify(result)).not.toContain(path.resolve(root));
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unsafe exact record before scope authorization", async () => {
    const root = createFixture();
    try {
      const context = await createMCPServerContext(root, Object.create(null));
      const getter = jest.fn(() => root);
      const args = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(args, "directory", {
        configurable: true,
        enumerable: true,
        get: getter,
      });

      await expect(
        handleToolCall("analyze_codebase", args, context),
      ).rejects.toMatchObject({ code: "MCP_INVALID_PATH_INPUT" });
      expect(getter).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects external Git worktrees and unsafe caller globs before project reads", async () => {
    const root = createFixture();
    const external = createFixture();
    try {
      const context = await createMCPServerContext(root, Object.create(null));
      const loadPlanning = jest.spyOn(context.configLoader, "loadPlanning");
      const enumerate = jest.spyOn(context.scope, "enumerateSources");

      await expect(
        handleToolCall("analyze_codebase", { directory: external }, context),
      ).rejects.toMatchObject({ code: "MCP_DIRECTORY_DENIED" });
      await expect(
        handleToolCall(
          "analyze_codebase",
          { directory: root, include: "../*" },
          context,
        ),
      ).rejects.toMatchObject({ code: "MCP_INVALID_PATH_INPUT" });
      expect(loadPlanning).not.toHaveBeenCalled();
      expect(enumerate).not.toHaveBeenCalled();
      loadPlanning.mockRestore();
      enumerate.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it("rejects executable project configuration before source enumeration", async () => {
    const root = createFixture();
    try {
      fs.rmSync(path.join(root, ".aidocrc.json"));
      fs.writeFileSync(
        path.join(root, ".aidocrc.js"),
        "throw new Error('this executable must never run');\n",
      );
      const context = await createMCPServerContext(root, Object.create(null));
      const enumerate = jest.spyOn(context.scope, "enumerateSources");

      await expect(
        handleToolCall("generate_readme", { directory: root }, context),
      ).rejects.toMatchObject({ code: "MCP_UNSAFE_CONFIGURATION" });
      expect(enumerate).not.toHaveBeenCalled();
      enumerate.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not construct a provider until after captured AST analysis", async () => {
    const root = createFixture();
    const providerName = `wiring-provider-${Date.now()}`;
    const events: string[] = [];
    registerProvider({
      name: providerName,
      available: () => true,
      create: () => {
        events.push("provider");
        return {
          name: providerName,
          generate: async () => "# Generated\n",
        };
      },
    });
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: providerName, include: ["**/*.ts"] }),
    );
    commit(root, "fixture: provider configuration");
    try {
      const context = await createMCPServerContext(root, Object.create(null));
      const enumerate = jest.spyOn(context.scope, "enumerateSources");
      const originalAnalyze = (
        jest.requireActual("../../../src/core/analyzer") as typeof analyzer
      ).analyzeCapturedSources;
      const captured = jest
        .spyOn(analyzer, "analyzeCapturedSources")
        .mockImplementation(async (files) => {
          events.push("ast");
          return originalAnalyze(files);
        });

      await expect(
        handleToolCall("generate_api_docs", { directory: root }, context),
      ).resolves.toEqual({ content: "# Generated\n", format: "markdown" });
      expect(enumerate).toHaveBeenCalled();
      expect(events).toEqual(["ast", "provider"]);
      captured.mockRestore();
      enumerate.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes lexical and canonical repository roots from all provider prompts", async () => {
    const root = createFixture();
    const providerName = `path-redaction-provider-${Date.now()}`;
    const calls: Array<{ prompt: string; systemPrompt?: string }> = [];
    registerProvider({
      name: providerName,
      available: () => true,
      create: () => ({
        name: providerName,
        generate: async (prompt, options) => {
          calls.push({ prompt, systemPrompt: options?.systemPrompt });
          return "# Generated\n";
        },
      }),
    });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "path-redaction-fixture", description: root }),
    );
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({
        provider: providerName,
        include: ["**/*.ts"],
        trustPolicy: "warn",
      }),
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      [
        `/** ${root} */`,
        `import dependency from ${JSON.stringify(`${root}/dependency`)};`,
        `export function documented(value: string = ${JSON.stringify(root)}): string { return dependency + value; }`,
        "",
      ].join("\n"),
    );
    commit(root, "fixture: path privacy inputs");

    try {
      for (const trustPolicy of ["warn", "redact"] as const) {
        fs.writeFileSync(
          path.join(root, ".aidocrc.json"),
          JSON.stringify({
            provider: providerName,
            include: ["**/*.ts"],
            trustPolicy,
          }),
        );
        const context = await createMCPServerContext(root, Object.create(null));
        for (const [name, format] of [
          ["generate_readme", "markdown"],
          ["generate_api_docs", "markdown"],
          ["generate_diagram", "mermaid"],
        ] as const) {
          await expect(
            handleToolCall(name, { directory: root }, context),
          ).resolves.toEqual({ content: "# Generated\n", format });
        }
      }

      expect(calls).toHaveLength(6);
      for (const call of calls) {
        expect(call.prompt).not.toContain(root);
        expect(call.systemPrompt).not.toContain(root);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks every provider transport when strict policy sees a repository root", async () => {
    const root = createFixture();
    const providerName = `strict-path-provider-${Date.now()}`;
    const calls: string[] = [];
    registerProvider({
      name: providerName,
      available: () => true,
      create: () => ({
        name: providerName,
        generate: async () => {
          calls.push("transport");
          return "# should not run\n";
        },
      }),
    });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "strict-path-fixture", description: root }),
    );
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({
        provider: providerName,
        include: ["**/*.ts"],
        trustPolicy: "strict",
      }),
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      [
        `/** ${root} */`,
        `import dependency from ${JSON.stringify(`${root}/dependency`)};`,
        `export function documented(value: string = ${JSON.stringify(root)}): string { return dependency + value; }`,
        "",
      ].join("\n"),
    );
    commit(root, "fixture: strict path privacy");

    try {
      const context = await createMCPServerContext(root, Object.create(null));
      for (const name of [
        "generate_readme",
        "generate_api_docs",
        "generate_diagram",
      ]) {
        await expect(
          handleToolCall(name, { directory: root }, context),
        ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });
      }
      expect(calls).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps unknown provider failures to one fixed generation error", async () => {
    const root = createFixture();
    const providerName = `failure-provider-${Date.now()}`;
    const secret = ["sk", "proj", "Z".repeat(32)].join("-");
    registerProvider({
      name: providerName,
      available: () => true,
      create: () => ({
        name: providerName,
        generate: async () => {
          throw new Error(`${path.resolve(root)} ${secret}`);
        },
      }),
    });
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: providerName, include: ["**/*.ts"] }),
    );
    commit(root, "fixture: failing provider");
    try {
      const context = await createMCPServerContext(root, Object.create(null));
      const thrown = await handleToolCall(
        "generate_diagram",
        { directory: root },
        context,
      ).catch((error: unknown) => error);
      expect((thrown as { code: string }).code).toBe("MCP_GENERATION_FAILED");
      expect(JSON.stringify(thrown)).not.toContain(path.resolve(root));
      expect(JSON.stringify(thrown)).not.toContain(secret);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
