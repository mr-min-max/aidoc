import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import fsPromises = require("node:fs/promises");
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";

describe("repository write target preparation", () => {
  const roots: string[] = [];
  const ORIGINAL_SENTINEL = "original-sentinel\n";
  const REPLACEMENT_SECRET = "replacement-secret\n";
  const FILESYSTEM_SECRET = "filesystem-detail-secret";

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

  function tempFiles(root: string): string[] {
    return readdirSync(root).filter((name) => name.startsWith(".aidoc-write-"));
  }

  async function captureRejection(operation: Promise<void>): Promise<unknown> {
    try {
      await operation;
    } catch (error) {
      return error;
    }
    throw new Error("Expected repository replacement to reject.");
  }

  function expectOwnedFailure(
    error: unknown,
    root: string,
    code: string,
    stage?: string,
    additionalSecrets: readonly string[] = [],
  ): void {
    expect(error).toMatchObject(
      stage === undefined ? { code } : { code, stage },
    );
    const rendered = String(error);
    for (const secret of [
      root,
      ORIGINAL_SENTINEL.trim(),
      REPLACEMENT_SECRET.trim(),
      FILESYSTEM_SECRET,
      ...additionalSecrets,
    ]) {
      expect(rendered).not.toContain(secret);
    }
    expect(Reflect.has(Object(error), "cause")).toBe(false);
  }

  function injectDescriptorFailure(
    method: "writeFile" | "chmod" | "sync",
  ): void {
    const realOpen = fsPromises.open.bind(fsPromises);
    jest
      .spyOn(fsPromises, "open")
      .mockImplementation(
        async (...args: Parameters<typeof fsPromises.open>) => {
          const handle = await realOpen(...args);
          return new Proxy(handle, {
            get(target, property) {
              if (property === method) {
                return async (): Promise<never> => {
                  throw new Error(FILESYSTEM_SECRET);
                };
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      );
  }

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("rejects external absolute targets when the invocation cwd is a symlink", async () => {
    const root = createRepository();
    const nested = join(root, "nested");
    const outside = createDirectory();
    const linkedCwd = join(outside, "linked-cwd");
    mkdirSync(nested);
    symlinkSync(
      nested,
      linkedCwd,
      process.platform === "win32" ? "junction" : "dir",
    );

    const scope = await RepositoryWriteScope.open(linkedCwd);

    await expect(
      scope.prepare(join(outside, "unrelated.md")),
    ).rejects.toMatchObject({ code: "TRUST_PATH_OUTSIDE_ROOT" });
  });

  (process.platform === "win32" ? it.skip : it)(
    "forces a deterministic Git locale before classifying non-repositories",
    async () => {
      const fakeBin = createDirectory();
      const fakeGit = join(fakeBin, "git");
      writeFileSync(
        fakeGit,
        [
          "#!/bin/sh",
          'if [ "$LC_ALL" = "C" ]; then',
          "  echo 'fatal: not a git repository' >&2",
          "else",
          "  echo 'fatal: depot introuvable' >&2",
          "fi",
          "exit 128",
          "",
        ].join("\n"),
      );
      chmodSync(fakeGit, 0o755);
      const originalPath = process.env.PATH;
      const originalLocale = process.env.LC_ALL;

      try {
        process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ""}`;
        process.env.LC_ALL = "aidoc_TEST.UTF-8";

        await expect(
          RepositoryWriteScope.open(createDirectory()),
        ).rejects.toMatchObject({ code: "TRUST_REPOSITORY_REQUIRED" });
      } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        if (originalLocale === undefined) delete process.env.LC_ALL;
        else process.env.LC_ALL = originalLocale;
      }
    },
  );

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

  it("atomically replaces an existing file and preserves its mode", async () => {
    const root = createRepository();
    const canonicalRoot = realpathSync(root);
    const output = join(root, "README.md");
    writeFileSync(output, "# Before\n", { mode: 0o640 });
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    const renameSpy = jest.spyOn(fsPromises, "rename");

    await target.replaceText("# After\n");

    expect(readFileSync(output, "utf8")).toBe("# After\n");
    if (process.platform !== "win32") {
      expect(statSync(output).mode & 0o777).toBe(0o640);
    }
    expect(
      readdirSync(root).filter((name) => name.startsWith(".aidoc-write-")),
    ).toEqual([]);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [temporary, destination] = renameSpy.mock.calls[0];
    expect(dirname(temporary)).toBe(canonicalRoot);
    expect(dirname(destination)).toBe(canonicalRoot);
    expect(destination).toBe(join(canonicalRoot, "README.md"));
  });

  it("creates a new file and each missing directory one component at a time", async () => {
    const root = createRepository();
    const canonicalRoot = realpathSync(root);
    const output = join(root, "docs", "generated", "API.md");
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("docs/generated/API.md");
    const mkdirSpy = jest.spyOn(fsPromises, "mkdir");

    await target.replaceText("# API\n");

    expect(readFileSync(output, "utf8")).toBe("# API\n");
    expect(mkdirSpy.mock.calls).toEqual([
      [join(canonicalRoot, "docs")],
      [join(canonicalRoot, "docs", "generated")],
    ]);
    if (process.platform !== "win32") {
      expect(statSync(output).mode & 0o777).toBe(0o666 & ~process.umask());
    }
  });

  it("creates a new target with target-independent temporary names", async () => {
    const root = createRepository();
    const targetName = "confidential-roadmap.md";
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare(targetName);
    const renameSpy = jest.spyOn(fsPromises, "rename");

    await target.replaceText("private draft\n");

    const temporaryName = basename(renameSpy.mock.calls[0][0]);
    expect(temporaryName).toMatch(/^\.aidoc-write-[0-9a-f]{32}$/);
    expect(temporaryName).not.toContain("confidential");
    expect(temporaryName).not.toContain("roadmap");
    expect(temporaryName).not.toContain("md");
  });

  it("keeps a pinned scope reusable after its own replacement", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, "# Before\n");
    const scope = await RepositoryWriteScope.open(root);
    const first = await scope.prepare("README.md");

    await first.replaceText("# After\n");
    const second = await scope.prepare("README.md");

    expect(second.existingText).toBe("# After\n");
  });

  it("reports a directory-create failure without creating the target", async () => {
    const root = createRepository();
    const output = join(root, "docs", "generated", "README.md");
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("docs/generated/README.md");
    const realMkdir = fsPromises.mkdir.bind(fsPromises);
    jest
      .spyOn(fsPromises, "mkdir")
      .mockImplementationOnce((path) => realMkdir(path))
      .mockRejectedValueOnce(new Error(FILESYSTEM_SECRET));

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );

    expectOwnedFailure(
      error,
      root,
      "TRUST_ATOMIC_WRITE_FAILED",
      "directory-create",
    );
    expect(existsSync(output)).toBe(false);
    expect(existsSync(join(root, "docs"))).toBe(true);
    expect(existsSync(join(root, "docs", "generated"))).toBe(false);
    expect(tempFiles(root)).toEqual([]);
  });

  it("reports a temp-create failure and preserves the destination", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    jest
      .spyOn(fsPromises, "open")
      .mockRejectedValueOnce(new Error(FILESYSTEM_SECRET));

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );

    expectOwnedFailure(error, root, "TRUST_ATOMIC_WRITE_FAILED", "temp-create");
    expect(readFileSync(output, "utf8")).toBe(ORIGINAL_SENTINEL);
    expect(tempFiles(root)).toEqual([]);
  });

  it("validates an EEXIST directory race without following a substituted symlink", async () => {
    const root = createRepository();
    const canonicalRoot = realpathSync(root);
    const outside = createDirectory();
    const externalSentinel = join(outside, "README.md");
    writeFileSync(externalSentinel, "external-sentinel\n");
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("docs/README.md");
    jest.spyOn(fsPromises, "mkdir").mockImplementationOnce(async () => {
      symlinkSync(
        outside,
        join(canonicalRoot, "docs"),
        process.platform === "win32" ? "junction" : "dir",
      );
      throw Object.assign(new Error(FILESYSTEM_SECRET), { code: "EEXIST" });
    });

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );

    expectOwnedFailure(error, root, "TRUST_RACE_DETECTED");
    expect(readFileSync(externalSentinel, "utf8")).toBe("external-sentinel\n");
    expect(tempFiles(outside)).toEqual([]);
  });

  it.each([
    ["writeFile", "temp-write"],
    ...(process.platform === "win32" ? [] : [["chmod", "permission"]]),
    ["sync", "temp-sync"],
  ] as const)(
    "cleans up after a %s failure and preserves the destination",
    async (method, expectedStage) => {
      const root = createRepository();
      const output = join(root, "README.md");
      writeFileSync(output, ORIGINAL_SENTINEL);
      const target = await (
        await RepositoryWriteScope.open(root)
      ).prepare("README.md");
      injectDescriptorFailure(method);

      const error = await captureRejection(
        target.replaceText(REPLACEMENT_SECRET),
      );

      expectOwnedFailure(
        error,
        root,
        "TRUST_ATOMIC_WRITE_FAILED",
        expectedStage,
      );
      expect(readFileSync(output, "utf8")).toBe(ORIGINAL_SENTINEL);
      expect(tempFiles(root)).toEqual([]);
    },
  );

  it("cleans up after a replace failure and preserves the destination", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    jest
      .spyOn(fsPromises, "rename")
      .mockRejectedValueOnce(new Error(FILESYSTEM_SECRET));

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );

    expectOwnedFailure(error, root, "TRUST_ATOMIC_WRITE_FAILED", "replace");
    expect(readFileSync(output, "utf8")).toBe(ORIGINAL_SENTINEL);
    expect(tempFiles(root)).toEqual([]);
  });

  it("reports cleanup failure and leaves one verified orphan temp", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    injectDescriptorFailure("writeFile");
    jest
      .spyOn(fsPromises, "unlink")
      .mockRejectedValueOnce(new Error(FILESYSTEM_SECRET));

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );
    const orphans = tempFiles(root);

    expect(orphans).toHaveLength(1);
    expectOwnedFailure(
      error,
      root,
      "TRUST_ATOMIC_WRITE_FAILED",
      "cleanup",
      orphans,
    );
    expect(readFileSync(output, "utf8")).toBe(ORIGINAL_SENTINEL);
    if (process.platform !== "win32") {
      expect(statSync(join(root, orphans[0])).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects a stale prepared snapshot and preserves the newer destination", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    writeFileSync(output, "newer-editor-content\n");

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );

    expectOwnedFailure(error, root, "TRUST_RACE_DETECTED");
    expect(readFileSync(output, "utf8")).toBe("newer-editor-content\n");
    expect(tempFiles(root)).toEqual([]);
  });

  it("serializes separate scopes and rejects the stale writer", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const first = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    const second = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    const renameSpy = jest.spyOn(fsPromises, "rename");

    const results = await Promise.allSettled([
      first.replaceText("first\n"),
      second.replaceText("second\n"),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ code: "TRUST_RACE_DETECTED" }),
    });
    expect(["first\n", "second\n"]).toContain(readFileSync(output, "utf8"));
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(tempFiles(root)).toEqual([]);
  });

  it("consumes the prepared target on its first failed replacement attempt", async () => {
    const root = createRepository();
    const output = join(root, "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("README.md");
    const openSpy = jest
      .spyOn(fsPromises, "open")
      .mockRejectedValue(new Error(FILESYSTEM_SECRET));

    const firstError = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );
    const secondError = await captureRejection(target.replaceText("second\n"));
    const thirdError = await captureRejection(target.replaceText("third\n"));

    expectOwnedFailure(
      firstError,
      root,
      "TRUST_ATOMIC_WRITE_FAILED",
      "temp-create",
    );
    expectOwnedFailure(secondError, root, "TRUST_RACE_DETECTED");
    expectOwnedFailure(thirdError, root, "TRUST_RACE_DETECTED");
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(readFileSync(output, "utf8")).toBe(ORIGINAL_SENTINEL);
    expect(tempFiles(root)).toEqual([]);
  });

  it("skips unsafe cleanup after parent substitution and preserves the external sentinel", async () => {
    const root = createRepository();
    const canonicalRoot = realpathSync(root);
    const parent = join(canonicalRoot, "docs");
    const displacedParent = join(canonicalRoot, "docs-displaced");
    mkdirSync(parent);
    const output = join(root, "docs", "README.md");
    writeFileSync(output, ORIGINAL_SENTINEL);
    const outside = createDirectory();
    const externalSentinel = join(outside, "README.md");
    writeFileSync(externalSentinel, "external-sentinel\n");
    const target = await (
      await RepositoryWriteScope.open(root)
    ).prepare("docs/README.md");
    const realOpen = fsPromises.open.bind(fsPromises);
    jest
      .spyOn(fsPromises, "open")
      .mockImplementationOnce(
        async (...args: Parameters<typeof fsPromises.open>) => {
          const handle = await realOpen(...args);
          return new Proxy(handle, {
            get(target, property) {
              if (property === "close") {
                return async (): Promise<void> => {
                  await target.close();
                  renameSync(parent, displacedParent);
                  symlinkSync(
                    outside,
                    parent,
                    process.platform === "win32" ? "junction" : "dir",
                  );
                };
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      );
    const unlinkSpy = jest.spyOn(fsPromises, "unlink");

    const error = await captureRejection(
      target.replaceText(REPLACEMENT_SECRET),
    );
    const orphans = tempFiles(displacedParent);

    expectOwnedFailure(error, root, "TRUST_RACE_DETECTED", undefined, orphans);
    expect(readFileSync(externalSentinel, "utf8")).toBe("external-sentinel\n");
    expect(readFileSync(output, "utf8")).toBe("external-sentinel\n");
    expect(readFileSync(join(displacedParent, "README.md"), "utf8")).toBe(
      ORIGINAL_SENTINEL,
    );
    expect(orphans).toHaveLength(1);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});
