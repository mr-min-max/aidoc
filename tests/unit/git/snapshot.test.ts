import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GitSnapshotReader } from "../../../src/git/snapshot";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "aidoc-git-"));
  execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}
function commit(root: string, message: string) {
  execFileSync("git", ["add", "--", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", message], { cwd: root });
}

describe("GitSnapshotReader", () => {
  test("reads committed changes and normalizes paths", async () => {
    const root = repo();
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    commit(root, "initial");
    writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
    writeFileSync(join(root, "src/new.py"), "x = 1\n");
    const reader = new GitSnapshotReader(root);
    const result = await reader.read({
      base: "HEAD",
      head: "HEAD",
      include: ["**/*"],
      exclude: [],
    });
    expect(result.files).toHaveLength(0);
    const working = await reader.read({
      base: "HEAD",
      include: ["**/*"],
      exclude: [],
    });
    expect(working.head.type).toBe("working-tree");
    expect(working.files.map((f) => f.afterPath)).toEqual(
      expect.arrayContaining(["src/a.ts", "src/new.py"]),
    );
    expect(
      working.files.find((f) => f.afterPath === "src/a.ts")?.afterSource,
    ).toContain("a = 2");
  });

  test("supports immutable head and excluded/unsupported counts", async () => {
    const root = repo();
    writeFileSync(join(root, "a.ts"), "x\n");
    writeFileSync(join(root, "note.txt"), "n\n");
    commit(root, "initial");
    writeFileSync(join(root, "a.ts"), "y\n");
    writeFileSync(join(root, "note.txt"), "z\n");
    const result = await new GitSnapshotReader(root).read({
      base: "HEAD",
      head: "HEAD",
      include: ["**/*.ts"],
      exclude: [],
    });
    expect(result.head.type).toBe("git");
    expect(result.files).toEqual([]);
    const tree = await new GitSnapshotReader(root).read({
      base: "HEAD",
      include: ["**/*.ts"],
      exclude: [],
    });
    expect(tree.ignored.unsupported).toBeGreaterThanOrEqual(1);
    expect(tree.files.find((f) => f.afterPath === "note.txt")?.supported).toBe(
      false,
    );
  });

  test("rejects unsafe refs and reports fixed failure", async () => {
    const root = repo();
    writeFileSync(join(root, "a.ts"), "x\n");
    commit(root, "initial");
    await expect(
      new GitSnapshotReader(root).read({
        base: "-bad",
        include: [],
        exclude: [],
      }),
    ).rejects.toMatchObject({ code: "PLAN_INVALID_REF" });
    await expect(
      new GitSnapshotReader(join(root, "missing")).read({
        include: [],
        exclude: [],
      }),
    ).rejects.toMatchObject({ code: "PLAN_NOT_GIT_REPOSITORY" });
  });
});
