import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createImpactPlan } from "../../../src/impact/planner";
import * as parserRegistry from "../../../src/parsers/registry";

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "aidoc-planner-"));
  const hooks = join(root, "hooks");
  mkdirSync(hooks);
  execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
    cwd: root,
  });
  execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

function commit(root: string, message: string): void {
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", message], { cwd: root });
}

describe("createImpactPlan", () => {
  test("is exposed as the single planning entry point", async () => {
    const root = repository();
    writeFileSync(
      join(root, "index.ts"),
      "export function greet(name: string) { return name; }\n",
    );
    commit(root, "initial");
    // A parent commit gives the working-tree reader a true before snapshot.
    writeFileSync(join(root, "README.md"), "# API\n");
    commit(root, "docs");
    writeFileSync(
      join(root, "index.ts"),
      "export function greet(name: number) { return name; }\n",
    );

    const result = await createImpactPlan({ cwd: root });

    expect(result.plan.schemaVersion).toBe("aidoc.impact-plan.v1");
    expect(result.plan.head.type).toBe("working-tree");
    expect(result.plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "contract-changed",
          path: "index.ts",
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("name: number");
  });

  test("returns stable plans and scans only selected markdown files", async () => {
    const root = repository();
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "guide"));
    writeFileSync(
      join(root, "src.ts"),
      "export function greet(name: string) { return name; }\n",
    );
    writeFileSync(join(root, "README.md"), "# API\n`greet`\n");
    writeFileSync(join(root, "docs", "API.md"), "# API\n`greet`\n");
    writeFileSync(
      join(root, "guide", "ignored.md"),
      "# greet\nSECRET_SOURCE\n",
    );
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
    commit(root, "initial");
    writeFileSync(
      join(root, "src.ts"),
      "export function greet(name: string) { return name; }\n",
    );
    writeFileSync(join(root, "config.txt"), "baseline\n");
    commit(root, "second");
    writeFileSync(
      join(root, "src.ts"),
      "export function greet(name: number) { return name; }\n",
    );

    const first = await createImpactPlan({ cwd: root });
    const second = await createImpactPlan({ cwd: root });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(
      first.plan.documentation.every((item) =>
        ["README.md", "docs/API.md", "CHANGELOG.md"].some(
          (path) =>
            item.directReferences.some(
              (reference) => reference.file === path,
            ) ||
            item.recommendations.some((reference) => reference.file === path),
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain("SECRET_SOURCE");
    expect(readFileSync(join(root, "guide", "ignored.md"), "utf8")).toContain(
      "SECRET_SOURCE",
    );
  });

  test("reports parser failures with a safe relative path and no source", async () => {
    const root = repository();
    writeFileSync(join(root, "bad.ts"), "export function ok() {}\n");
    commit(root, "initial");
    const sentinel = "SOURCE_SENTINEL";
    writeFileSync(
      join(root, "bad.ts"),
      `export function broken( { return '${sentinel}'; }`,
    );

    await expect(createImpactPlan({ cwd: root })).rejects.toMatchObject({
      code: "PLAN_PARSE_FAILED",
      path: "bad.ts",
    });
    await expect(createImpactPlan({ cwd: root })).rejects.not.toMatchObject({
      message: expect.stringContaining(sentinel),
    });
  });

  test("fails closed for malformed Python without returning parser details", async () => {
    const root = repository();
    writeFileSync(join(root, "api.py"), "def api():\n    return 1\n");
    commit(root, "initial");
    writeFileSync(join(root, "marker.txt"), "parent\n");
    commit(root, "parent");
    const sentinel = "PYTHON_SOURCE_SENTINEL";
    writeFileSync(
      join(root, "api.py"),
      `def broken(:\n    return '${sentinel}'\n`,
    );

    await expect(createImpactPlan({ cwd: root })).rejects.toMatchObject({
      code: "PLAN_PARSE_FAILED",
      path: "api.py",
      message: "Unable to parse changed source.",
    });
    await expect(createImpactPlan({ cwd: root })).rejects.not.toMatchObject({
      message: expect.stringContaining(sentinel),
    });
  });

  test("uses configured output markdown and trusts only parser snapshot hashes", async () => {
    const root = repository();
    mkdirSync(join(root, "custom-docs"));
    writeFileSync(join(root, "api.ts"), "export const api = 1;\n");
    writeFileSync(
      join(root, ".aidocrc.json"),
      JSON.stringify({ outputDir: "custom-docs" }),
    );
    writeFileSync(join(root, "custom-docs", "API.md"), "# API\n`api`\n");
    commit(root, "initial");
    writeFileSync(join(root, "api.ts"), "export const api = 2;\n");

    const snapshot = {
      language: "typescript" as const,
      dependencyFingerprint: "a".repeat(64),
      symbols: [
        {
          language: "typescript" as const,
          kind: "function" as const,
          qualifiedName: "api",
          contractFacets: {},
          contractFingerprint: "b".repeat(64),
          implementationFingerprint: "c".repeat(64),
          documentationFingerprint: null,
        },
      ],
    };
    const spy = jest
      .spyOn(parserRegistry, "getSnapshotParserForFile")
      .mockReturnValue({
        name: "fake",
        supportedExtensions: [".ts"],
        parse: async () => {
          throw new Error("legacy parser should not be called");
        },
        snapshot: async (_path, source) => ({
          ...snapshot,
          implementationFingerprint: source.includes("2")
            ? "d".repeat(64)
            : snapshot.implementationFingerprint,
        }),
      });
    try {
      const result = await createImpactPlan({ cwd: root });
      expect(
        result.plan.documentation.some((impact) =>
          impact.directReferences.some(
            (reference) => reference.file === "custom-docs/API.md",
          ),
        ),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain("api = 2");
      expect(JSON.stringify(result)).not.toContain("legacy parser");
    } finally {
      spy.mockRestore();
    }
  });

  test("handles deleted and unsupported-only changes without public impact", async () => {
    const root = repository();
    writeFileSync(join(root, "gone.py"), "def gone():\n    return 1\n");
    writeFileSync(join(root, "notes.txt"), "before\n");
    commit(root, "initial");
    writeFileSync(join(root, "notes.txt"), "baseline\n");
    commit(root, "second");
    execFileSync("git", ["rm", "-q", "--", "gone.py"], { cwd: root });
    writeFileSync(join(root, "notes.txt"), "after\n");

    const result = await createImpactPlan({ cwd: root });

    expect(
      result.plan.changes.some((change) => change.category === "removed"),
    ).toBe(true);
    expect(result.plan.summary.publicApiChanges).toBeGreaterThan(0);

    execFileSync(
      "git",
      ["restore", "--staged", "--worktree", "--", "gone.py"],
      { cwd: root },
    );
    writeFileSync(join(root, "notes.txt"), "unsupported-only\n");
    const unsupported = await createImpactPlan({ cwd: root });
    expect(unsupported.plan.summary.publicApiChanges).toBe(0);
    expect(unsupported.plan.changes).toHaveLength(0);
  });

  test("supports immutable commit descriptors", async () => {
    const root = repository();
    writeFileSync(
      join(root, "api.py"),
      "def api(value: int) -> int:\n    return value\n",
    );
    commit(root, "initial");
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    writeFileSync(
      join(root, "api.py"),
      "def api(value: str) -> str:\n    return value\n",
    );
    commit(root, "change");
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    const result = await createImpactPlan({ cwd: root, base, head });

    expect(result.plan.base).toEqual(
      expect.objectContaining({ type: "git", commit: base }),
    );
    expect(result.plan.head).toEqual(
      expect.objectContaining({ type: "git", commit: head }),
    );
  });
});
