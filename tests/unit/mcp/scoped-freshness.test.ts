import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  MCPRepositoryReadScope,
  MCPRepositoryScopeError,
} from "../../../src/mcp/repository-scope";
import { defaultPlanningConfig } from "../../../src/config/planning";
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

function fixture(readme = "# Docs\n"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-freshness-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  git(root, "init", "--quiet");
  git(root, "config", "user.name", "aidoc test");
  git(root, "config", "user.email", "aidoc-test@example.invalid");
  fs.writeFileSync(path.join(root, "README.md"), readme);
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    "export function documented(): string { return 'safe'; }\n",
  );
  commit(root, "fixture: baseline");
  return root;
}

async function openCheck(root: string, since: string, docFile?: string) {
  const scope = await MCPRepositoryReadScope.open(root);
  const directory = await scope.authorizeDirectory(root);
  return checkMCPDocumentationFreshness({
    scope,
    serverCwd: root,
    directory,
    docFile,
    since,
    planningConfig: defaultPlanningConfig(),
  });
}

describe("scoped MCP freshness", () => {
  it("reports a referenced symbol change as stale", async () => {
    const root = fixture("# Docs\n\n## API\n\n`documented` is public.\n");
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "index.ts"),
        "export function documented(value: string): string { return value; }\n",
      );
      commit(root, "fixture: source change");

      const report = await openCheck(root, base);

      expect(report).toMatchObject({
        status: "stale",
        target: "README.md",
        sourceFiles: ["src/index.ts"],
        referencedSymbols: ["documented"],
        sections: [
          { section: "API", slug: "api", symbols: ["documented"] },
        ],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports uncommitted README and referenced symbol changes as co-changed", async () => {
    const root = fixture("# Docs\n\n## API\n\n`documented` is public.\n");
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "index.ts"),
        "export function documented(value: string): string { return value; }\n",
      );
      fs.writeFileSync(
        path.join(root, "README.md"),
        "# Docs\n\n## API\n\n`documented(value)` is public.\n",
      );

      const report = await openCheck(root, base);

      expect(report).toMatchObject({
        status: "co-changed",
        target: "README.md",
        targetChanged: true,
        sourceFiles: ["src/index.ts"],
        referencedSymbols: ["documented"],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers the repository README when the MCP server starts in a subdirectory", async () => {
    const root = fixture("# Docs\n\n## API\n\n`documented` is public.\n");
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "index.ts"),
        "export function documented(value: string): string { return value; }\n",
      );
      fs.writeFileSync(
        path.join(root, "README.md"),
        "# Docs\n\n## API\n\n`documented(value)` is public.\n",
      );
      const serverCwd = path.join(root, "src");
      const scope = await MCPRepositoryReadScope.open(serverCwd);
      const directory = await scope.authorizeDirectory(serverCwd);

      const report = await checkMCPDocumentationFreshness({
        scope,
        serverCwd,
        directory,
        docFile: undefined,
        since: base,
        planningConfig: defaultPlanningConfig(),
      });

      expect(report).toMatchObject({
        status: "co-changed",
        target: "README.md",
        targetChanged: true,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an unreferenced source change as clean", async () => {
    const root = fixture();
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "helper.ts"),
        "export function helper(value: string): string { return value + '!'; }\n",
      );
      commit(root, "fixture: source change");

      const report = await openCheck(root, base);

      expect(report.status).toBe("clean");
      expect(report.referencedSymbols).toEqual([]);
      expect(report.unmappedSymbols).toEqual(["helper"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers a case-tolerant README by default", async () => {
    const root = fixture("# Docs\n\n## API\n\n`documented` is public.\n");
    fs.renameSync(path.join(root, "README.md"), path.join(root, "readme.md"));
    try {
      const base = git(root, "rev-parse", "HEAD");
      fs.writeFileSync(
        path.join(root, "src", "index.ts"),
        "export function documented(value: string): string { return value; }\n",
      );
      commit(root, "fixture: source change");

      const report = await openCheck(root, base);

      expect(report.target).toBe("readme.md");
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
          serverCwd: root,
          docFile: "../README.md",
          since: "HEAD~1",
          planningConfig: defaultPlanningConfig(),
        }),
      ).rejects.toBeInstanceOf(MCPRepositoryScopeError);
      expect(changedFiles).not.toHaveBeenCalled();
      changedFiles.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid Git ref", async () => {
    const root = fixture();
    try {
      await expect(openCheck(root, "-invalid")).rejects.toMatchObject({
        code: "PLAN_INVALID_REF",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
