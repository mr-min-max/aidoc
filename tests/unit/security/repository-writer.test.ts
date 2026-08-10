import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";

describe("repository write target preparation", () => {
  const roots: string[] = [];

  function createRepository(): string {
    const root = mkdtempSync(join(tmpdir(), "aidoc-writer-"));
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
      cwd: root,
    });
    execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: root });
    roots.push(root);
    return root;
  }

  function createDirectory(): string {
    const root = mkdtempSync(join(tmpdir(), "aidoc-writer-"));
    roots.push(root);
    return root;
  }

  function createLinkedWorktree(): string {
    const repository = createRepository();
    execFileSync(
      "git",
      [
        "-c",
        "user.name=AiDoc Tests",
        "-c",
        "user.email=tests@example.invalid",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "initial",
      ],
      { cwd: repository },
    );
    const linked = createDirectory();
    execFileSync("git", ["worktree", "add", "-q", "--detach", linked], {
      cwd: repository,
    });
    return linked;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires a Git worktree", async () => {
    await expect(
      RepositoryWriteScope.open(createDirectory()),
    ).rejects.toMatchObject({ code: "TRUST_REPOSITORY_REQUIRED" });
  });

  it("pins a nested invocation worktree and reads an existing UTF-8 snapshot", async () => {
    const root = createRepository();
    const nested = join(root, "docs", "guides");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "README.md"), "# Before\n");

    const scope = await RepositoryWriteScope.open(nested);
    const target = await scope.prepare("README.md");

    expect(target.displayPath).toBe(join("docs", "guides", "README.md"));
    expect(target.existingText).toBe("# Before\n");
  });

  it("accepts an absolute target inside the pinned worktree", async () => {
    const root = createRepository();
    writeFileSync(join(root, "README.md"), "# Before\n");

    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare(join(root, "README.md"));

    expect(target.displayPath).toBe("README.md");
    expect(target.existingText).toBe("# Before\n");
  });

  it("keeps canonical repository paths out of the runtime object surface", async () => {
    const root = createRepository();
    const scope = await RepositoryWriteScope.open(root);
    const target = await scope.prepare("README.md");

    expect(Reflect.ownKeys(scope)).toEqual([]);
    expect(Reflect.ownKeys(target)).toEqual(["displayPath", "existingText"]);
    expect(JSON.stringify({ scope, target })).not.toContain(root);
  });

  it("prepares a missing target without creating its missing parents", async () => {
    const root = createRepository();
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("docs/generated/API.md");

    expect(target.displayPath).toBe(join("docs", "generated", "API.md"));
    expect(target.existingText).toBeNull();
    expect(existsSync(join(root, "docs"))).toBe(false);
  });

  it("rejects raw traversal even when it normalizes inside the worktree", async () => {
    const root = createRepository();
    mkdirSync(join(root, "nested"));

    await expect(
      (await RepositoryWriteScope.open(root)).prepare("nested/../README.md"),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_PATH" });
  });

  it("rejects the worktree root and targets outside it", async () => {
    const root = createRepository();
    const outside = createDirectory();
    const scope = await RepositoryWriteScope.open(root);

    await expect(scope.prepare(root)).rejects.toMatchObject({
      code: "TRUST_PATH_OUTSIDE_ROOT",
    });
    await expect(
      scope.prepare(join(outside, "README.md")),
    ).rejects.toMatchObject({ code: "TRUST_PATH_OUTSIDE_ROOT" });
  });

  it.each([".git/config", ".GIT/config", "docs/.Git/index"])(
    "rejects resolved Git metadata target %s",
    async (rawTarget) => {
      const scope = await RepositoryWriteScope.open(createRepository());

      await expect(scope.prepare(rawTarget)).rejects.toMatchObject({
        code: "TRUST_PATH_OUTSIDE_ROOT",
      });
    },
  );

  it("accepts a linked worktree whose .git entry is a regular file", async () => {
    const linked = createLinkedWorktree();
    writeFileSync(join(linked, "README.md"), "linked\n");

    const target = await (
      await RepositoryWriteScope.open(linked)
    ).prepare("README.md");

    expect(target.displayPath).toBe("README.md");
    expect(target.existingText).toBe("linked\n");
  });

  it("ignores hostile inherited Git repository overrides", async () => {
    const root = createRepository();
    writeFileSync(join(root, "README.md"), "local\n");
    const original = new Map(
      ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_COUNT"].map((key) => [
        key,
        process.env[key],
      ]),
    );

    try {
      process.env.GIT_DIR = join(createDirectory(), ".git");
      process.env.GIT_WORK_TREE = createDirectory();
      process.env.GIT_CONFIG_COUNT = "1";

      const target = await (
        await RepositoryWriteScope.open(root)
      ).prepare("README.md");
      expect(target.existingText).toBe("local\n");
    } finally {
      for (const [key, value] of original) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects an external parent symlink without changing its sentinel", async () => {
    const root = createRepository();
    const outside = createDirectory();
    const sentinel = join(outside, "sentinel.md");
    writeFileSync(sentinel, "outside-sentinel\n");
    symlinkSync(
      outside,
      join(root, "docs"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      (await RepositoryWriteScope.open(root)).prepare("docs/sentinel.md"),
    ).rejects.toMatchObject({ code: "TRUST_UNSAFE_SYMLINK" });
    expect(readFileSync(sentinel, "utf8")).toBe("outside-sentinel\n");
  });

  it("rejects existing and dangling leaf symlinks", async () => {
    const root = createRepository();
    writeFileSync(join(root, "actual.md"), "inside\n");
    symlinkSync("actual.md", join(root, "linked.md"), "file");
    symlinkSync("missing.md", join(root, "dangling.md"), "file");
    const scope = await RepositoryWriteScope.open(root);

    await expect(scope.prepare("linked.md")).rejects.toMatchObject({
      code: "TRUST_UNSAFE_SYMLINK",
    });
    await expect(scope.prepare("dangling.md")).rejects.toMatchObject({
      code: "TRUST_UNSAFE_SYMLINK",
    });
  });

  it("rejects a non-directory ancestor and directory leaf", async () => {
    const root = createRepository();
    writeFileSync(join(root, "docs"), "not a directory\n");
    mkdirSync(join(root, "directory.md"));
    const scope = await RepositoryWriteScope.open(root);

    await expect(scope.prepare("docs/API.md")).rejects.toMatchObject({
      code: "TRUST_INVALID_TARGET_TYPE",
    });
    await expect(scope.prepare("directory.md")).rejects.toMatchObject({
      code: "TRUST_INVALID_TARGET_TYPE",
    });
  });

  (process.platform === "win32" ? it.skip : it)(
    "rejects a FIFO target",
    async () => {
      const root = createRepository();
      execFileSync("mkfifo", [join(root, "stream.md")]);

      await expect(
        (await RepositoryWriteScope.open(root)).prepare("stream.md"),
      ).rejects.toMatchObject({ code: "TRUST_INVALID_TARGET_TYPE" });
    },
  );

  it("rejects malformed UTF-8 without exposing bytes", async () => {
    const root = createRepository();
    writeFileSync(join(root, "README.md"), Buffer.from([0xc3, 0x28]));

    await expect(
      (await RepositoryWriteScope.open(root)).prepare("README.md"),
    ).rejects.toMatchObject({
      code: "TRUST_INSPECTION_FAILED",
      message: "The repository output path could not be safely inspected.",
    });
  });

  it("keeps replacement fail-closed until the atomic writer is implemented", async () => {
    const target = await (
      await RepositoryWriteScope.open(createRepository())
    ).prepare("README.md");

    await expect(target.replaceText("# After\n")).rejects.toMatchObject({
      code: "TRUST_ATOMIC_WRITE_FAILED",
      stage: "replace",
    });
  });
});
