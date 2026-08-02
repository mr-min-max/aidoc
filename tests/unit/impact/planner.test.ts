import {
  mkdtempSync,
  mkdirSync,
  promises as fs,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createImpactPlan } from "../../../src/impact/planner";
import {
  GitSnapshotReader,
  type GitSnapshotSet,
} from "../../../src/git/snapshot";
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

  test("skips configured documentation reached through an intermediate external symlink", async () => {
    const root = repository();
    const externalRoot = mkdtempSync(join(tmpdir(), "aidoc-external-docs-"));
    mkdirSync(join(externalRoot, "sub"));
    writeFileSync(
      join(externalRoot, "sub", "API.md"),
      "# API\n`externalApi`\nEXTERNAL_DOCUMENTATION_SENTINEL\n",
    );
    symlinkSync(externalRoot, join(root, "bridge"), "dir");
    writeFileSync(
      join(root, ".aidocrc.json"),
      JSON.stringify({ outputDir: "bridge/sub" }),
    );
    writeFileSync(
      join(root, "api.ts"),
      "export function externalApi(value: string) { return value; }\n",
    );
    commit(root, "initial");
    writeFileSync(
      join(root, "api.ts"),
      "export function externalApi(value: number) { return value; }\n",
    );

    const result = await createImpactPlan({ cwd: root });

    expect(JSON.stringify(result.plan.documentation)).not.toContain(
      "bridge/sub/API.md",
    );
  });

  // Break caught: a validated documentation directory is swapped for an
  // external symlink after lstat and the subsequent read follows it.
  test("skips documentation when its parent directory is swapped before read", async () => {
    const root = repository();
    const docs = join(root, "docs");
    const parkedDocs = join(root, "docs-before-swap");
    const externalDocs = mkdtempSync(join(tmpdir(), "aidoc-external-swap-"));
    const documentationPath = join(docs, "API.md");
    mkdirSync(docs);
    writeFileSync(documentationPath, "# Internal notes\nNo public API here.\n");
    writeFileSync(
      join(externalDocs, "API.md"),
      "# API\n`swappedApi`\nEXTERNAL_DOCUMENTATION_SENTINEL\n",
    );
    writeFileSync(
      join(root, "api.ts"),
      "export function swappedApi(value: string) { return value; }\n",
    );
    commit(root, "initial");
    writeFileSync(
      join(root, "api.ts"),
      "export function swappedApi(value: number) { return value; }\n",
    );

    const originalLstat = fs.lstat.bind(fs);
    let targetLstatCalls = 0;
    let swapped = false;
    const lstatSpy = jest.spyOn(fs, "lstat").mockImplementation((async (
      path,
      options,
    ) => {
      const stat =
        options === undefined
          ? await originalLstat(path)
          : await originalLstat(path, options);
      if (String(path).endsWith(`${sep}docs${sep}API.md`)) {
        targetLstatCalls += 1;
        if (targetLstatCalls === 2) {
          renameSync(docs, parkedDocs);
          symlinkSync(externalDocs, docs, "dir");
          swapped = true;
        }
      }
      return stat;
    }) as typeof fs.lstat);

    let result;
    try {
      result = await createImpactPlan({ cwd: root });
    } finally {
      lstatSpy.mockRestore();
    }

    expect(swapped).toBe(true);
    expect(JSON.stringify(result.plan.documentation)).not.toContain(
      "docs/API.md",
    );
  });

  test("releases source-bearing snapshot files before documentation access", async () => {
    const root = mkdtempSync(join(tmpdir(), "aidoc-planner-lifetime-"));
    const files: GitSnapshotSet["files"] = [
      {
        status: "modified",
        beforePath: "api.ts",
        afterPath: "api.ts",
        beforeSource: "export function api(value: string) { return value; }\n",
        afterSource: "export function api(value: number) { return value; }\n",
        supported: true,
        excluded: false,
      },
    ];
    const snapshotSet: GitSnapshotSet = {
      root,
      base: { type: "git", label: "base", commit: "a".repeat(40) },
      head: { type: "working-tree", label: "HEAD" },
      files,
      ignored: { unsupported: 0, excluded: 0 },
    };
    const readSpy = jest
      .spyOn(GitSnapshotReader.prototype, "read")
      .mockResolvedValue(snapshotSet);
    const originalLstat = fs.lstat.bind(fs);
    const observedLengths: number[] = [];
    const lstatSpy = jest.spyOn(fs, "lstat").mockImplementation(((
      path,
      options,
    ) => {
      observedLengths.push(files.length);
      return options === undefined
        ? originalLstat(path)
        : originalLstat(path, options);
    }) as typeof fs.lstat);
    try {
      await createImpactPlan({ cwd: root });
      expect(observedLengths[0]).toBe(0);
      expect(files).toHaveLength(0);
    } finally {
      lstatSpy.mockRestore();
      readSpy.mockRestore();
    }
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

  test("applies configured exclusions to changed source and documentation", async () => {
    const root = repository();
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, ".aidocrc.json"),
      JSON.stringify({ exclude: ["ignored.ts", "docs/private.md"] }),
    );
    writeFileSync(
      join(root, "visible.ts"),
      "export function visibleApi(value: string) { return value; }\n",
    );
    writeFileSync(
      join(root, "ignored.ts"),
      "export function ignoredApi(value: string) { return value; }\n",
    );
    writeFileSync(join(root, "docs", "public.md"), "# API\n`visibleApi`\n");
    writeFileSync(
      join(root, "docs", "private.md"),
      "# API\n`visibleApi`\nPRIVATE_DOCUMENTATION_SENTINEL\n",
    );
    commit(root, "initial");
    writeFileSync(join(root, "marker.txt"), "baseline\n");
    commit(root, "baseline");
    writeFileSync(
      join(root, "visible.ts"),
      "export function visibleApi(value: number) { return value; }\n",
    );
    writeFileSync(
      join(root, "ignored.ts"),
      "export function ignoredApi(value: number) { return value; }\n",
    );

    const result = await createImpactPlan({ cwd: root });
    const serialized = JSON.stringify(result);

    expect(result.plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "visible.ts",
          qualifiedName: "visibleApi",
        }),
      ]),
    );
    expect(serialized).not.toContain("ignoredApi");
    expect(serialized).not.toContain("docs/private.md");
    expect(serialized).not.toContain("PRIVATE_DOCUMENTATION_SENTINEL");
  });

  test("uses the snapshot-parser alias for JavaScript changes", async () => {
    const root = repository();
    writeFileSync(
      join(root, "api.js"),
      "export function javascriptApi(value) { return value; }\n",
    );
    commit(root, "initial");
    writeFileSync(join(root, "marker.txt"), "baseline\n");
    commit(root, "baseline");
    writeFileSync(
      join(root, "api.js"),
      "export function javascriptApi(value, options) { return value; }\n",
    );

    const result = await createImpactPlan({ cwd: root });

    expect(result.plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: "typescript",
          path: "api.js",
          qualifiedName: "javascriptApi",
          category: "contract-changed",
        }),
      ]),
    );
  });

  test("does not import provider, command-context, template, or dotenv modules", async () => {
    const root = repository();
    writeFileSync(
      join(root, "api.ts"),
      "export function api(value: string) { return value; }\n",
    );
    commit(root, "initial");
    writeFileSync(join(root, "marker.txt"), "baseline\n");
    commit(root, "baseline");
    writeFileSync(
      join(root, "api.ts"),
      "export function api(value: number) { return value; }\n",
    );
    const forbiddenModules = [
      "../../../src/providers/registry",
      "../../../src/cli/context",
      "../../../src/core/templates",
      "dotenv",
    ];
    for (const modulePath of forbiddenModules) {
      jest.doMock(modulePath, () => {
        throw new Error(`planning imported forbidden module: ${modulePath}`);
      });
    }

    let isolatedCreateImpactPlan: typeof createImpactPlan | undefined;
    try {
      await jest.isolateModulesAsync(async () => {
        ({ createImpactPlan: isolatedCreateImpactPlan } =
          await import("../../../src/impact/planner"));
      });
      await isolatedCreateImpactPlan?.({ cwd: root });
      expect(isolatedCreateImpactPlan).toBeDefined();
    } finally {
      for (const modulePath of forbiddenModules) jest.dontMock(modulePath);
      jest.resetModules();
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
