import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  getParserForFile,
  registerParser,
} from "../../../src/parsers/registry";
import {
  MCPRepositoryReadScope,
  MCPRepositoryScopeError,
} from "../../../src/mcp/repository-scope";
import { checkMCPDocumentationFreshness } from "../../../src/mcp/scoped-freshness";

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

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-freshness-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "aidoc test");
  git(root, "config", "user.email", "aidoc-test@example.invalid");
  fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    "export function documented(): string { return 'safe'; }\n",
  );
  commit(root, "fixture: baseline");
  return root;
}

describe("scoped MCP freshness", () => {
  it("uses validated relative changed files and captured parser input", async () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "index.ts"),
        "export function changed(): string { return 'changed'; }\n",
      );
      commit(root, "fixture: source change");

      const scope = await MCPRepositoryReadScope.open(root);
      const directory = await scope.authorizeDirectory(root);
      const parser = getParserForFile("src/index.ts");
      expect(parser).not.toBeNull();
      const parseSource = jest.spyOn(parser!, "parseSource");
      const parse = jest.spyOn(parser!, "parse");

      const report = await checkMCPDocumentationFreshness({
        scope,
        directory,
        docFile: "README.md",
        since: base,
      });

      expect(report).toMatchObject({
        status: "stale",
        target: "README.md",
        sourceFiles: ["src/index.ts"],
      });
      expect(parseSource).toHaveBeenCalledWith(
        "src/index.ts",
        expect.stringContaining("changed"),
      );
      expect(parse).not.toHaveBeenCalled();
      expect(JSON.stringify(report)).not.toContain(path.resolve(root));
      parseSource.mockRestore();
      parse.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips changed parsers without parseSource and never calls parse", async () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      const parse = jest.fn().mockRejectedValue(new Error("PARSE_SENTINEL"));
      registerParser({
        name: "mcp-no-captured-source-parser",
        supportedExtensions: [".mcpnops"],
        parse,
        snapshot: jest.fn().mockResolvedValue({
          language: "typescript",
          dependencyFingerprint: "unused",
          symbols: [],
        }),
      });
      fs.writeFileSync(
        path.join(root, "src", "unsupported.mcpnops"),
        "captured source",
      );
      commit(root, "fixture: unsupported captured source");

      const scope = await MCPRepositoryReadScope.open(root);
      const directory = await scope.authorizeDirectory(root);
      const report = await checkMCPDocumentationFreshness({
        scope,
        directory,
        docFile: "README.md",
        since: base,
      });

      expect(report.status).toBe("clean");
      expect(report.sourceFiles).toEqual([]);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a fixed diagnostic for arbitrary captured parser failures", async () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      const parseSource = jest
        .fn()
        .mockRejectedValue(new Error("RAW_PARSER_SENTINEL"));
      registerParser({
        name: "mcp-failing-captured-source-parser",
        supportedExtensions: [".mcpleak"],
        parse: jest.fn().mockRejectedValue(new Error("PARSE_SENTINEL")),
        parseSource,
        snapshot: jest.fn().mockResolvedValue({
          language: "typescript",
          dependencyFingerprint: "unused",
          symbols: [],
        }),
      });
      fs.writeFileSync(
        path.join(root, "src", "failure.mcpleak"),
        "captured source",
      );
      commit(root, "fixture: failing captured source");

      const scope = await MCPRepositoryReadScope.open(root);
      const directory = await scope.authorizeDirectory(root);
      const report = await checkMCPDocumentationFreshness({
        scope,
        directory,
        docFile: "README.md",
        since: base,
      });

      expect(report.status).toBe("unknown");
      expect(report.message).toBe(
        "Could not evaluate documentation freshness: the source parser failed safely.",
      );
      expect(report.message).not.toContain("RAW_PARSER_SENTINEL");
      expect(parseSource).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe documentation paths before Git", async () => {
    const root = fixture();
    try {
      const scope = await MCPRepositoryReadScope.open(root);
      const directory = await scope.authorizeDirectory(root);
      const changedFiles = jest.spyOn(scope, "changedFiles");

      await expect(
        checkMCPDocumentationFreshness({
          scope,
          directory,
          docFile: "../README.md",
          since: "HEAD~1",
        }),
      ).rejects.toBeInstanceOf(MCPRepositoryScopeError);
      expect(changedFiles).not.toHaveBeenCalled();
      changedFiles.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a safely missing target without exposing filesystem paths", async () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.rmSync(path.join(root, "README.md"));
      commit(root, "fixture: delete docs");
      const scope = await MCPRepositoryReadScope.open(root);
      const directory = await scope.authorizeDirectory(root);

      const report = await checkMCPDocumentationFreshness({
        scope,
        directory,
        docFile: "README.md",
        since: base,
      });

      expect(report.status).toBe("missing");
      expect(report.target).toBe("README.md");
      expect(JSON.stringify(report)).not.toContain(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
