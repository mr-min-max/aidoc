# Repository-Contained Atomic Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every AiDoc runtime file mutation through one Git-worktree-contained, symlink-rejecting, compare-before-replace, atomic text writer.

**Architecture:** A `RepositoryWriteScope` discovers and pins one canonical Git worktree, while a one-shot `PreparedRepositoryTarget` owns the descriptor-backed text snapshot and atomic replacement. CLI adapters prepare real targets before provider transport, keep dry-run read-only without constructing the writer, and remove every direct production write outside the security module.

**Tech Stack:** TypeScript 6, Node.js `node:fs/promises` and `node:child_process`, Jest 30, `ts-morph`, Commander, existing provider-neutral `Generator`/`LLMProvider` stack.

## Global Constraints

- Support Node.js `>=22.12.0` and the hosted Node 22/Node 24 CI matrix.
- Use pure Node.js APIs; add no runtime or development dependency.
- Keep AST analysis deterministic and before LLM calls; never parse code with regular expressions.
- Keep every provider behind the existing `LLMProvider`/`Generator` boundary.
- Keep prompts in `src/templates/*.hbs`; this slice changes no prompt.
- Do not add MCP directory allowlisting, `aidoc doctor`, receipts, `verify`, or `explain`.
- Do not duplicate containment, symlink, or atomic-write logic in commands or Bash.
- Do not expose raw target strings, absolute roots, temporary names, file content, child-process output, underlying errors, or `cause` values in writer diagnostics.
- Dry-run, `check`, `plan`, current MCP tools, and `score` without `--output` must construct no writer and perform no target mutation.
- Use same-directory exclusive temp creation, `FileHandle.sync()`, and exactly one `rename(temp, destination)`; never use unlink-first or copy/delete fallback.
- Preserve ordinary POSIX mode bits only; document that ownership, ACLs, extended attributes, resource forks, alternate streams, creation time, directory-entry fsync, network filesystem guarantees, and complete TOCTOU elimination are out of scope.
- Do not create a tag, npm publication, GitHub Release, stable-v1 claim, or merge to `main` in this plan.

## Execution Setup

The worktree has no independent dependency install because npm 10 failed with its internal “Exit handler never called” error even with the required isolated cache. Before Task 1, reuse the already validated checkout dependencies with `ln -s ../../node_modules node_modules`; never stage that symlink, use exact-path `git add` commands, and remove it with `unlink node_modules` before the Git-integrity gate. If dependencies must be refreshed, use `npm install --cache /private/tmp/aidoc-repository-writes-npm-cache` without `sudo` or ownership changes.

## File Map

- Create `src/security/repository-path.ts`: host-independent lexical path policy and containment primitives.
- Create `src/security/repository-writer.ts`: Git discovery, physical path snapshots, repository lock, temp-file lifecycle, safe cleanup, and atomic rename.
- Modify `src/security/types.ts`: stable repository-writer error codes, stages, and value-free error class.
- Modify `src/security/diagnostics.ts`: safe exit-code allowlist for writer policy rejections.
- Modify `src/cli/context.ts`: dry-run/real target adapter and `writeDoc` over a prepared target.
- Modify `src/output/markdown.ts`: retain validation/read helpers and delete the production write sink.
- Modify `src/cli/commands/{readme,api,changelog,diagram,update,watch,score,annotate}.ts`: prepare targets before provider calls and route commits through the writer.
- Modify `src/mcp/server.ts`: recognize stable writer codes while keeping all MCP tools return-only.
- Create `tests/unit/security/repository-path.test.ts`: lexical and Win32 policy coverage.
- Create `tests/unit/security/repository-writer.test.ts`: real temporary Git repository, snapshot, race, atomicity, permission, cleanup, and diagnostic tests.
- Create `tests/unit/security/write-boundary.test.ts`: AST-based ban on production filesystem mutators outside the writer.
- Modify `tests/unit/cli/{context,commands,update-impact}.test.ts`: shared adapter and provider-order assertions.
- Create `tests/unit/cli/write-consumers.test.ts`: readme/api/changelog/diagram/score/watch containment and dry-run behavior.
- Create `tests/unit/cli/annotate-write.test.ts`: per-symbol decisions and one replacement per file.
- Modify `tests/unit/output/markdown.test.ts`: validation-only expectations after removing `writeMarkdown`.
- Modify `tests/unit/action/runner.test.ts`: rejected CLI status produces no changed-file output.
- Modify `tests/unit/mcp/{security,serialization}.test.ts`: allowlisted codes and unchanged repository tree.
- Modify `README.md`, `ROADMAP.md`, and `docs/PUBLIC_BETA.md`: shipped behavior and honest limitations.

---

### Task 1: Stable Errors and Lexical Repository Path Policy

**Files:**

- Create: `src/security/repository-path.ts`
- Modify: `src/security/types.ts:1-48`
- Modify: `src/security/diagnostics.ts:1-96`
- Create: `tests/unit/security/repository-path.test.ts`
- Modify: `tests/unit/security/gateway.test.ts`

**Interfaces:**

- Produces: `RepositoryWriteErrorCode`, `AtomicWriteStage`, and `RepositoryWriteError`.
- Produces: `assertValidRepositoryTarget(rawTarget, platform?)`, `assertValidWindowsTarget(rawTarget)`, and `isRepositoryContainedPath(root, candidate, semantics?)` for Task 2.
- Consumes: existing safe-code inspection in `src/security/diagnostics.ts`.

- [ ] **Step 1: Add failing tests for stable error shape and exit mapping**

Add table-driven assertions that every message is value-free and only policy rejections map to status 2:

```ts
const policyCases = [
  "TRUST_REPOSITORY_REQUIRED",
  "TRUST_INVALID_PATH",
  "TRUST_PATH_OUTSIDE_ROOT",
  "TRUST_UNSAFE_SYMLINK",
  "TRUST_INVALID_TARGET_TYPE",
] as const;

it.each(policyCases)("maps %s to CLI exit 2", (code) => {
  expect(getTrustErrorExitCode(new RepositoryWriteError(code))).toBe(2);
});

it.each(["TRUST_RACE_DETECTED", "TRUST_INSPECTION_FAILED"] as const)(
  "maps %s to CLI exit 1",
  (code) => {
    expect(getTrustErrorExitCode(new RepositoryWriteError(code))).toBe(1);
  },
);

it("allows only a fixed atomic stage", () => {
  const error = new RepositoryWriteError(
    "TRUST_ATOMIC_WRITE_FAILED",
    "temp-sync",
  );
  expect(error.message).toBe("Atomic file replacement failed (temp-sync).");
  expect(getTrustErrorExitCode(error)).toBe(1);
});
```

- [ ] **Step 2: Run the error tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/security/gateway.test.ts`

Expected: FAIL because `RepositoryWriteError` and the new allowlisted codes do not exist.

- [ ] **Step 3: Implement the stable writer error contract**

Add these exact code/stage unions and construct messages only from fixed maps:

```ts
export const REPOSITORY_WRITE_ERROR_CODES = [
  "TRUST_REPOSITORY_REQUIRED",
  "TRUST_INVALID_PATH",
  "TRUST_PATH_OUTSIDE_ROOT",
  "TRUST_UNSAFE_SYMLINK",
  "TRUST_INVALID_TARGET_TYPE",
  "TRUST_RACE_DETECTED",
  "TRUST_INSPECTION_FAILED",
  "TRUST_ATOMIC_WRITE_FAILED",
] as const;

export const ATOMIC_WRITE_STAGES = [
  "directory-create",
  "temp-create",
  "temp-write",
  "temp-sync",
  "permission",
  "replace",
  "cleanup",
] as const;

export type RepositoryWriteErrorCode =
  (typeof REPOSITORY_WRITE_ERROR_CODES)[number];
export type AtomicWriteStage = (typeof ATOMIC_WRITE_STAGES)[number];

export class RepositoryWriteError extends Error {
  constructor(
    readonly code: RepositoryWriteErrorCode,
    readonly stage?: AtomicWriteStage,
  ) {
    super(repositoryWriteMessage(code, stage));
    this.name = "RepositoryWriteError";
  }
}
```

Use these fixed non-atomic messages:

```ts
const REPOSITORY_WRITE_MESSAGES = {
  TRUST_REPOSITORY_REQUIRED: "A Git worktree is required for file writes.",
  TRUST_INVALID_PATH: "The output path is invalid.",
  TRUST_PATH_OUTSIDE_ROOT:
    "The output path is outside the current Git worktree.",
  TRUST_UNSAFE_SYMLINK: "The output path contains an unsafe symbolic link.",
  TRUST_INVALID_TARGET_TYPE: "The output target type is not supported.",
  TRUST_RACE_DETECTED: "The output path changed during generation.",
  TRUST_INSPECTION_FAILED:
    "The repository output path could not be safely inspected.",
} as const;
```

Validate that `TRUST_ATOMIC_WRITE_FAILED` always has an allowlisted stage and non-atomic codes never retain one. Expand only the five policy-rejection codes in `getTrustErrorExitCode()`; race, inspection, and atomic failures remain status 1.

- [ ] **Step 4: Add failing lexical path tests**

Create tests for empty/control input, raw traversal, containment, `.git`, sibling-prefix escapes, and Windows syntax independent of the host OS:

```ts
it.each(["", "safe\0.md", "safe\nname.md", "../outside.md", "a/../b.md"])(
  "rejects malformed target %j",
  (target) => {
    expect(() => assertValidRepositoryTarget(target, "linux")).toThrow(
      expect.objectContaining({ code: "TRUST_INVALID_PATH" }),
    );
  },
);

it.each([
  "C:relative.md",
  "C:\\safe.md:secret",
  "CON",
  "nul.txt",
  "COM1.md",
  "trailing. ",
  "\\\\?\\C:\\repo\\file.md",
  "\\\\.\\NUL",
  "bad<name>.md",
])("rejects Win32 target %j", (target) => {
  expect(() => assertValidWindowsTarget(target)).toThrow(
    expect.objectContaining({ code: "TRUST_INVALID_PATH" }),
  );
});

it("rejects a sibling-prefix escape", () => {
  expect(isRepositoryContainedPath("/repo", "/repo-other/file.md")).toBe(false);
});

it("applies Win32 drive and UNC containment semantics on every host", () => {
  const win32Semantics = {
    relative: win32.relative,
    isAbsolute: win32.isAbsolute,
    sep: win32.sep,
  };
  expect(
    isRepositoryContainedPath(
      "C:\\repo",
      "C:\\repo\\docs\\API.md",
      win32Semantics,
    ),
  ).toBe(true);
  expect(
    isRepositoryContainedPath(
      "C:\\repo",
      "D:\\repo\\docs\\API.md",
      win32Semantics,
    ),
  ).toBe(false);
  expect(
    isRepositoryContainedPath(
      "\\\\server\\repo",
      "\\\\server\\repo-other\\API.md",
      win32Semantics,
    ),
  ).toBe(false);
});
```

- [ ] **Step 5: Run the lexical tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/security/repository-path.test.ts`

Expected: FAIL because `src/security/repository-path.ts` does not exist.

- [ ] **Step 6: Implement host-independent lexical validation**

Implement path validation without touching the filesystem:

```ts
export function assertValidRepositoryTarget(
  rawTarget: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (
    rawTarget.length === 0 ||
    [...rawTarget].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new RepositoryWriteError("TRUST_INVALID_PATH");
  }
  const components = (
    platform === "win32" ? rawTarget.split(/[\\/]+/) : rawTarget.split("/")
  ).filter((component) => component.length > 0);
  if (components.includes("..")) {
    throw new RepositoryWriteError("TRUST_INVALID_PATH");
  }
  if (platform === "win32") assertValidWindowsTarget(rawTarget);
}
```

Treat `.git` ASCII-case-insensitively after resolution in Task 2. Implement Windows device namespaces, drive-relative forms, ADS colons, reserved basenames, forbidden characters, and trailing dot/space as explicit component checks.

- [ ] **Step 7: Run focused tests and typecheck the new contract**

Run: `npm test -- --runInBand tests/unit/security/repository-path.test.ts tests/unit/security/gateway.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS with declarations for the new types and no unused variables.

- [ ] **Step 8: Commit the policy layer**

```bash
git add src/security/types.ts src/security/diagnostics.ts src/security/repository-path.ts tests/unit/security/repository-path.test.ts tests/unit/security/gateway.test.ts
git commit -m "feat(security): define repository write policy"
```

---

### Task 2: Git Scope and Descriptor-Backed Target Snapshot

**Files:**

- Create: `src/security/repository-writer.ts`
- Modify: `src/security/repository-path.ts`
- Create: `tests/unit/security/repository-writer.test.ts`

**Interfaces:**

- Consumes: `RepositoryWriteError`, `assertValidRepositoryTarget()`, and `isRepositoryContainedPath()` from Task 1.
- Produces: `RepositoryWriteScope.open(cwd: string): Promise<RepositoryWriteScope>`.
- Produces: `RepositoryWriteScope.prepare(rawTarget: string): Promise<PreparedRepositoryTarget>`.
- Produces: `PreparedRepositoryTarget.displayPath`, `existingText`, and a temporary fail-closed `replaceText()` completed in Task 3.

- [ ] **Step 1: Add a real temporary-Git-repository fixture**

Create every fixture with its own empty hooks directory so global Git hooks/configuration cannot affect the test:

```ts
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

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
```

Use an actual `git init` fixture for containment tests and a directory without `.git` for `TRUST_REPOSITORY_REQUIRED`. Add one linked-worktree fixture and assert its regular-file `.git` entry is accepted. Set hostile inherited `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_CONFIG_COUNT` values in a scoped test and assert discovery still selects the invocation worktree; restore the environment in `finally`.

- [ ] **Step 2: Add failing scope and snapshot tests**

Cover a nested invocation cwd, existing/missing target, canonical relative display, invalid UTF-8, Git metadata, outside absolute target, and raw traversal:

```ts
it("pins the worktree and reads an existing UTF-8 snapshot", async () => {
  const root = createRepository();
  writeFileSync(join(root, "README.md"), "# Before\n");
  const scope = await RepositoryWriteScope.open(root);
  const target = await scope.prepare("README.md");
  expect(target.displayPath).toBe("README.md");
  expect(target.existingText).toBe("# Before\n");
});
```

Add a separate assertion that `nested/../README.md` fails with `TRUST_INVALID_PATH` even though it normalizes inside the repository.

```ts
it("rejects malformed UTF-8 without exposing bytes", async () => {
  const root = createRepository();
  writeFileSync(join(root, "README.md"), Buffer.from([0xc3, 0x28]));
  await expect(
    (await RepositoryWriteScope.open(root)).prepare("README.md"),
  ).rejects.toMatchObject({ code: "TRUST_INSPECTION_FAILED" });
});
```

- [ ] **Step 3: Add failing symlink and type tests**

Use an external sentinel and cover parent, leaf, dangling leaf, directory, and FIFO where supported:

```ts
it("rejects an external parent symlink without reading its sentinel", async () => {
  const root = createRepository();
  const outside = mkdtempSync(join(tmpdir(), "aidoc-outside-"));
  writeFileSync(join(outside, "sentinel.md"), "outside-sentinel\n");
  symlinkSync(
    outside,
    join(root, "docs"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const scope = await RepositoryWriteScope.open(root);
  await expect(scope.prepare("docs/sentinel.md")).rejects.toMatchObject({
    code: "TRUST_UNSAFE_SYMLINK",
  });
  expect(readFileSync(join(outside, "sentinel.md"), "utf8")).toBe(
    "outside-sentinel\n",
  );
});
```

Skip FIFO creation on Windows; all other cases run on every CI platform.

- [ ] **Step 4: Run snapshot tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/security/repository-writer.test.ts`

Expected: FAIL because `RepositoryWriteScope` does not exist.

- [ ] **Step 5: Implement sanitized Git discovery**

Use one bounded, shell-free command and parse exactly two non-empty lines:

```ts
const { stdout } = await execFile(
  "git",
  ["rev-parse", "--show-toplevel", "--absolute-git-dir"],
  {
    cwd: canonicalCwd,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith("GIT_"),
      ),
    ),
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 16 * 1024,
    windowsHide: true,
  },
);
```

Canonicalize cwd, reported root, and Git directory. Require cwd containment, a stable non-symlink root directory identity, and a non-symlink root `.git` directory or regular file. Collapse non-repository results to `TRUST_REPOSITORY_REQUIRED`; collapse timeouts, malformed output, inaccessible canonical paths, and other inspection failures to `TRUST_INSPECTION_FAILED` without retaining the original error.

- [ ] **Step 6: Implement lexical resolution and physical ancestor walking**

Resolve relative targets from the canonical invocation cwd, then:

```ts
const relativeTarget = path.relative(root, absoluteTarget);
if (!isRepositoryContainedPath(root, absoluteTarget)) {
  throw new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT");
}
if (relativeTarget.length === 0) {
  throw new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT");
}
if (
  relativeTarget.split(path.sep).some((part) => part.toLowerCase() === ".git")
) {
  throw new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT");
}
```

Walk with bigint `lstat`: each existing ancestor must be a non-symlink directory; the leaf must be a non-symlink regular file or absent. Record `{dev, ino, type}` for root/ancestors and `{dev, ino, type, size, mtimeNs, ctimeNs, mode}` for an existing leaf. Record absent components without creating them. Reject an existing target whose canonical physical path equals or descends from the canonical Git directory, including linked-worktree metadata outside the worktree.

- [ ] **Step 7: Implement descriptor-backed UTF-8 snapshot reading**

Open an existing leaf with `O_RDONLY | O_NOFOLLOW` where supported, compare pre-open `lstat` to descriptor `stat`, read bytes, compare descriptor stats again, validate with `isUtf8()`, and check `realpath` containment. Close the descriptor on every branch. Return `TRUST_RACE_DETECTED` for identity changes and `TRUST_INSPECTION_FAILED` for unreadable/invalid text.

Create the one-shot handle now, but make `replaceText()` throw a fixed `TRUST_ATOMIC_WRITE_FAILED` at `replace` until Task 3 replaces that fail-closed stub.

- [ ] **Step 8: Run the target-preparation suite and build**

Run: `npm test -- --runInBand tests/unit/security/repository-path.test.ts tests/unit/security/repository-writer.test.ts`

Expected: PASS for Git discovery, snapshot, outside path, traversal, symlink, target type, and UTF-8 cases.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit safe target preparation**

```bash
git add src/security/repository-path.ts src/security/repository-writer.ts tests/unit/security/repository-writer.test.ts
git commit -m "feat(security): prepare repository write targets"
```

---

### Task 3: Atomic Replacement, Safe Cleanup, and In-Process Races

**Files:**

- Modify: `src/security/repository-writer.ts`
- Modify: `tests/unit/security/repository-writer.test.ts`

**Interfaces:**

- Consumes: prepared root/ancestor/leaf snapshots from Task 2.
- Completes: `PreparedRepositoryTarget.replaceText(content: string): Promise<void>`.
- Produces: repository-identity keyed in-process serialization shared by separate scopes.

- [ ] **Step 1: Add failing successful-write tests**

Cover existing replacement, new file, one-component-at-a-time missing directories, ordinary POSIX mode preservation, and target-independent temp names:

```ts
it("atomically replaces an existing file and preserves its mode", async () => {
  const root = createRepository();
  const output = join(root, "README.md");
  writeFileSync(output, "# Before\n", { mode: 0o640 });
  const target = await (
    await RepositoryWriteScope.open(root)
  ).prepare("README.md");
  await target.replaceText("# After\n");
  expect(readFileSync(output, "utf8")).toBe("# After\n");
  if (process.platform !== "win32") {
    expect(statSync(output).mode & 0o777).toBe(0o640);
  }
  expect(
    readdirSync(root).filter((name) => name.startsWith(".aidoc-write-")),
  ).toEqual([]);
});
```

Observe `fs.promises.rename` to prove the successful path calls it exactly once with source and destination in the same parent. Never assert the random suffix itself.

- [ ] **Step 2: Run successful-write tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/security/repository-writer.test.ts -t "atomically|creates a new|preserves its mode"`

Expected: FAIL because Task 2's replacement method fails closed.

- [ ] **Step 3: Implement the repository lock and pre-commit revalidation**

Use one module-level queue per recorded root filesystem identity, not per path string:

```ts
interface RepositoryLockState {
  tail: Promise<void>;
  pending: number;
}

const repositoryLocks = new Map<string, RepositoryLockState>();
```

Increment `pending`, await the previous tail, run the commit, resolve the queue slot in `finally`, and delete the entry only after the final waiter finishes. The lock key contains only root device/inode/type identity. Mark a prepared target consumed before waiting. A second call on the same target fails with `TRUST_RACE_DETECTED`.

Inside the lock revalidate root, every recorded existing ancestor, every recorded missing component, and the destination snapshot. Existing snapshots compare device, inode, type, size, mtimeNs, and ctimeNs; absent destinations must still be absent.

- [ ] **Step 4: Implement directory and temp creation**

Create missing parents one component at a time with `mkdir`, validating `EEXIST` through `lstat` and recording the resulting directory identity. Map failure to `directory-create`.

Create a temp in the verified destination directory with a fixed target-independent prefix, 128 random bits, mode `0o600`, and `O_CREAT | O_EXCL | O_WRONLY` plus `O_NOFOLLOW` where available. Retry only random-name collisions a bounded number of times. Record descriptor device/inode/type immediately.

- [ ] **Step 5: Implement full write, mode, sync, and single rename**

Perform the commit sequence exactly once:

```ts
await handle.writeFile(content, { encoding: "utf8" });
if (process.platform !== "win32") {
  await handle.chmod(existingMode ?? 0o666 & ~process.umask());
}
await handle.sync();
await handle.close();
await revalidateDestinationAndTemp();
await fs.rename(tempAbsolute, destinationAbsolute);
```

Map write, chmod, sync/close, and rename failures to `temp-write`, `permission`, `temp-sync`, and `replace`. Do not call `unlink(destination)`, `copyFile`, or any fallback. Successful rename is the only commit point.

- [ ] **Step 6: Add failing failure-injection and cleanup tests**

Spy on `fs.promises.mkdir`, `open`, `rename`, and `unlink`; for descriptor stages wrap the real temp handle and reject one selected `writeFile`, `chmod`, or `sync` call. For every pre-commit stage assert:

```ts
expect(readFileSync(destination, "utf8")).toBe("original-sentinel\n");
expect(tempFiles(root)).toEqual([]);
expect(String(error)).not.toContain(root);
expect(String(error)).not.toContain("original-sentinel");
```

Inject cleanup `unlink` failure separately and expect `TRUST_ATOMIC_WRITE_FAILED` with stage `cleanup`, preserved destination, and one verified orphan temp. Restore every spy in `finally`/`afterEach`.

- [ ] **Step 7: Run failure tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/security/repository-writer.test.ts -t "failure|cleanup|preserves"`

Expected: FAIL until safe cleanup distinguishes an ordinary stable-path failure from untrusted substitution.

- [ ] **Step 8: Implement identity-proven cleanup**

On pre-commit failure, close any open descriptor, then revalidate root, parent, and temp pathname identity. Unlink only when the temp path still names the recorded temp file. If `unlink` fails, return the fixed `cleanup` failure. If identity cannot be proven, return `TRUST_RACE_DETECTED` and skip unlink. Empty directories created earlier may remain.

Never include the original error as `cause`; convert it to an owned stable error before leaving the module.

- [ ] **Step 9: Add failing stale-snapshot and concurrency tests**

```ts
it("serializes separate scopes and rejects the stale writer", async () => {
  const first = await (
    await RepositoryWriteScope.open(root)
  ).prepare("README.md");
  const second = await (
    await RepositoryWriteScope.open(root)
  ).prepare("README.md");
  const results = await Promise.allSettled([
    first.replaceText("first\n"),
    second.replaceText("second\n"),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    results.filter((result) => result.status === "rejected")[0],
  ).toMatchObject({
    reason: expect.objectContaining({ code: "TRUST_RACE_DETECTED" }),
  });
});
```

Also mutate the destination between `prepare()` and `replaceText()` and assert the newer content survives. Simulate parent replacement after temp creation and assert an external sentinel is neither modified nor deleted; an orphan temp is allowed only when the pathname is no longer trusted.

- [ ] **Step 10: Run the complete writer suite and build**

Run: `npm test -- --runInBand tests/unit/security/repository-path.test.ts tests/unit/security/repository-writer.test.ts`

Expected: PASS with no leftover temp in ordinary failure cases.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 11: Commit the atomic writer**

```bash
git add src/security/repository-writer.ts tests/unit/security/repository-writer.test.ts
git commit -m "feat(security): add atomic repository replacement"
```

---

### Task 4: Shared Document Commands and Write Adapter

**Files:**

- Modify: `src/cli/context.ts:9-156`
- Modify: `src/output/markdown.ts:88-101`
- Modify: `src/cli/commands/readme.ts:28-103`
- Modify: `src/cli/commands/api.ts:26-66`
- Modify: `src/cli/commands/changelog.ts:32-85`
- Modify: `src/cli/commands/diagram.ts:26-67`
- Modify: `tests/unit/cli/context.test.ts`
- Modify: `tests/unit/cli/commands.test.ts`
- Create: `tests/unit/cli/write-consumers.test.ts`
- Modify: `tests/unit/output/markdown.test.ts`

**Interfaces:**

- Consumes: `RepositoryWriteScope` and `PreparedRepositoryTarget` from Tasks 2-3.
- Produces: `prepareDocumentTarget(cwd, rawTarget, dryRun, scope?)` returning a `DocumentTarget` snapshot.
- Changes: `writeDoc(target, content, options)` accepts no raw filesystem output path and calls `target.prepared.replaceText()` for real writes.

- [ ] **Step 1: Add failing adapter tests**

Define the adapter contract in tests:

```ts
interface DocumentTarget {
  readonly displayPath: string;
  readonly existingText: string | null;
  readonly prepared?: PreparedRepositoryTarget;
}
```

Assert a real target calls `RepositoryWriteScope.open(cwd)` and `scope.prepare(rawTarget)`, while dry-run reads only for preview and never opens the scope. Assert `writeDoc` uses `existingText` for diffing and invokes `replaceText` exactly once after automatic confirmation.

- [ ] **Step 2: Run adapter tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/cli/context.test.ts`

Expected: FAIL because `writeDoc` still accepts a raw path and calls `writeMarkdown`.

- [ ] **Step 3: Implement `DocumentTarget` preparation and refactor `writeDoc`**

For dry-run, resolve only for the existing preview read and return no `prepared` handle. For real writes, open/reuse the repository scope and prepare the raw user target. Make `writeDoc` derive its label from `target.displayPath`, validate content, display the diff from `target.existingText`, preserve confirmation behavior, and await `target.prepared.replaceText(content)`.

Delete `writeMarkdown()` and its write-related imports from `src/output/markdown.ts`. Keep `readExistingMarkdown()` only as the read-only dry-run adapter and keep all validation helpers unchanged.

- [ ] **Step 4: Add failing provider-order tests for readme/api/changelog/diagram**

For each command, mock `RepositoryWriteScope.open().prepare()` to reject an outside target and spy on its generator method:

```ts
await command.parseAsync(["--output", outside], { from: "user" });
expect(generate).not.toHaveBeenCalled();
expect(exit).toHaveBeenCalledWith(2);
```

Add a dry-run case where `RepositoryWriteScope.open` is not called and no file/directory/temp is created. For changelog, assert merge content uses `DocumentTarget.existingText`, not `readExistingMarkdown()` after provider generation.

- [ ] **Step 5: Run command-order tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/cli/write-consumers.test.ts tests/unit/cli/commands.test.ts`

Expected: FAIL because commands currently generate before preparing their output target.

- [ ] **Step 6: Prepare command targets before provider transport**

In each command, keep deterministic AST/Git input discovery first. Immediately after `hasGenerationInput()` succeeds, call `prepareDocumentTarget(ctx.cwd, options.output, options.dryRun)`, then call the generator. Pass the resulting target to `writeDoc`.

For changelog, prepare before `generateChangelog()` and build the final header/entry merge from `target.existingText`. Remove all real-path `readExistingMarkdown()` calls.

- [ ] **Step 7: Run focused CLI and output tests**

Run: `npm test -- --runInBand tests/unit/cli/context.test.ts tests/unit/cli/commands.test.ts tests/unit/cli/write-consumers.test.ts tests/unit/output/markdown.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS and no production import of `writeMarkdown`.

- [ ] **Step 8: Commit shared command integration**

```bash
git add src/cli/context.ts src/output/markdown.ts src/cli/commands/readme.ts src/cli/commands/api.ts src/cli/commands/changelog.ts src/cli/commands/diagram.ts tests/unit/cli/context.test.ts tests/unit/cli/commands.test.ts tests/unit/cli/write-consumers.test.ts tests/unit/output/markdown.test.ts
git commit -m "refactor(cli): route generated docs through repository writer"
```

---

### Task 5: Update, Watch, and Score Consumers

**Files:**

- Modify: `src/cli/commands/update.ts:23-68`
- Modify: `src/cli/commands/watch.ts:16-73`
- Modify: `src/cli/commands/score.ts:27-94`
- Modify: `tests/unit/cli/update-impact.test.ts`
- Modify: `tests/unit/cli/write-consumers.test.ts`
- Modify: `tests/unit/core/watcher.test.ts`

**Interfaces:**

- Consumes: `prepareDocumentTarget()`, `writeDoc()`, and optional scope reuse from Task 4.
- Preserves: provider-free impact planning before `update` provider construction.
- Preserves: score analysis directory independent from invocation-cwd write scope.

- [ ] **Step 1: Add failing update snapshot/order tests**

Replace the old raw-read expectation with a prepared target:

```ts
expect(prepareDocumentTarget).toHaveBeenCalledWith(root, "./README.md", false);
expect(generateUpdate).toHaveBeenCalledWith({
  existingDoc: "# Existing\n",
  impactPlan: result.providerContext,
});
expect(writeDoc).toHaveBeenCalledWith(
  expect.objectContaining({ existingText: "# Existing\n" }),
  "# Updated\n",
  expect.objectContaining({ dryRun: false }),
);
```

Assert an unsafe target returns status 2 before `loadCommandContext()` and before `generateUpdate()`. Keep zero-impact planning free of target preparation and provider construction.

- [ ] **Step 2: Run update tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/cli/update-impact.test.ts`

Expected: FAIL because update still reads the target directly.

- [ ] **Step 3: Route update through the prepared snapshot**

After a non-empty impact plan, prepare the target before loading the provider context. If `existingText === null`, emit the fixed value-free message `Documentation target does not exist. Run 'aidoc readme' first to generate it.` and return 1. Build provider context from `target.existingText`, then pass the same target to `writeDoc`.

- [ ] **Step 4: Add failing watch freshness tests**

Extract/export a small `createWatchRegenerator(ctx, scope, rawTarget, options)` function so tests can trigger regeneration without entering the never-resolving watcher loop. Call it twice, return a fresh fake prepared target from each `scope.prepare`, and assert each target is used once before its corresponding generator call.

```ts
await regenerate();
await regenerate();
expect(scope.prepare).toHaveBeenCalledTimes(2);
expect(firstTarget.replaceText).toHaveBeenCalledTimes(1);
expect(secondTarget.replaceText).toHaveBeenCalledTimes(1);
```

- [ ] **Step 5: Run watch tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/core/watcher.test.ts tests/unit/cli/write-consumers.test.ts -t "watch"`

Expected: FAIL because watch currently reuses only a raw target path and prepares nothing.

- [ ] **Step 6: Reuse one scope and prepare a fresh watch snapshot per run**

Open `RepositoryWriteScope` once when watch starts. Inside every debounced regeneration, call `prepareDocumentTarget(ctx.cwd, options.target, false, scope)` before `generateReadme()`. Keep the existing debounce, prompt/auto, error logging, and watcher lifecycle.

- [ ] **Step 7: Add failing score writer-construction tests**

Assert:

- no `--output`: no `RepositoryWriteScope.open` call;
- `--output --dry-run`: no `RepositoryWriteScope.open` call and no mutation;
- real `--output`: scope opens from the invocation cwd, even when `--dir` points at another analysis directory;
- outside output: status 2 and no report file.

- [ ] **Step 8: Run score tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/cli/write-consumers.test.ts -t "score"`

Expected: FAIL because score sends an absolute path directly to `writeDoc`.

- [ ] **Step 9: Route score output through the invocation repository**

Capture `const invocationCwd = process.cwd()` separately from `const analysisDir = options.dir ?? invocationCwd`. Analyze `analysisDir`, but prepare `options.output` against `invocationCwd` only when output is requested. Pass the prepared/dry target to `writeDoc`. Keep score calculation, JSON output, and threshold behavior unchanged.

- [ ] **Step 10: Run all focused consumer tests and build**

Run: `npm test -- --runInBand tests/unit/cli/update-impact.test.ts tests/unit/cli/write-consumers.test.ts tests/unit/core/watcher.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 11: Commit update/watch/score integration**

```bash
git add src/cli/commands/update.ts src/cli/commands/watch.ts src/cli/commands/score.ts tests/unit/cli/update-impact.test.ts tests/unit/cli/write-consumers.test.ts tests/unit/core/watcher.test.ts
git commit -m "feat(cli): contain update watch and score writes"
```

---

### Task 6: One Atomic Annotation Commit Per File

**Files:**

- Modify: `src/cli/commands/annotate.ts:1-102`
- Create: `tests/unit/cli/annotate-write.test.ts`
- Modify: `tests/unit/cli/commands.test.ts`

**Interfaces:**

- Consumes: one `RepositoryWriteScope`, one prepared target per unique source file, and prepared `existingText` snapshots.
- Produces: exported pure `applyAcceptedAnnotations(source, insertions)` helper for descending-line deterministic assembly.
- Preserves: one confirmation decision for each generated symbol annotation.

- [ ] **Step 1: Add failing pure assembly tests**

Define:

```ts
export interface AcceptedAnnotation {
  readonly name: string;
  readonly line: number;
  readonly jsdoc: string;
}
```

Test two insertions in one file, intentionally supplied in ascending order, and assert descending application preserves original source line numbers:

```ts
expect(
  applyAcceptedAnnotations("first();\nsecond();\n", [
    { name: "first", line: 1, jsdoc: "/** First. */" },
    { name: "second", line: 2, jsdoc: "/** Second. */" },
  ]),
).toBe("/** First. */\nfirst();\n/** Second. */\nsecond();\n");
```

Preserve indentation from the source line and use `name` as a deterministic secondary sort key when line numbers match.

- [ ] **Step 2: Run assembly tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/cli/annotate-write.test.ts -t "descending"`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure descending assembler**

Split the prepared snapshot into lines, sort a copied insertion array by descending `line` then stable `name`, indent each JSDoc line from the original insertion line, splice, and join. Do not reparse code or use a regex to discover code structure; the regex used only to preserve leading whitespace from the already AST-selected line is allowed.

- [ ] **Step 4: Add failing command tests for preparation and commit cardinality**

Mock AST analysis with two undocumented functions in one file and one in another. Before `generateJsDoc`, assert every unique file has been prepared. Inject prompt responses `[true, false, true]`. Assert:

- three confirmations occur;
- accepted changes are accumulated;
- first target receives one replacement containing only its accepted symbol;
- second target receives one replacement;
- no direct `fs.readFileSync`/`fs.writeFileSync` is used by annotate;
- all-false responses call no `replaceText`;
- dry-run opens no scope and performs no replacement.

- [ ] **Step 5: Run annotate command tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/cli/annotate-write.test.ts tests/unit/cli/commands.test.ts`

Expected: FAIL because annotate reads and writes once per annotation.

- [ ] **Step 6: Prepare all unique files before the provider call**

After deterministic AST analysis finds undocumented functions, construct one scope for real writes, prepare every unique `filePath`, and store the resulting targets by canonical `displayPath`. For dry-run, create read-only document targets without a repository writer. If any real target is unsafe, abort before `generateJsDoc()`.

- [ ] **Step 7: Preserve per-symbol prompts and replace once per file**

For each returned annotation, locate its AST function, display the single-symbol proposed diff against the prepared snapshot, and collect only accepted insertions. After all decisions, call `applyAcceptedAnnotations()` once per file with accepted insertions and await one `replaceText()` for that file. Print one successful file update only after its rename commits.

Remove the production `node:fs` write/read import from annotate.

- [ ] **Step 8: Run focused annotate and diagnostic tests**

Run: `npm test -- --runInBand tests/unit/cli/annotate-write.test.ts tests/unit/cli/commands.test.ts`

Expected: PASS, including malformed-provider-output redaction and hostile diagnostic fallback.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 9: Commit atomic annotation behavior**

```bash
git add src/cli/commands/annotate.ts tests/unit/cli/annotate-write.test.ts tests/unit/cli/commands.test.ts
git commit -m "refactor(cli): atomically apply annotations per file"
```

---

### Task 7: Structural Boundary, MCP Non-Mutation, and Action Propagation

**Files:**

- Create: `tests/unit/security/write-boundary.test.ts`
- Modify: `src/mcp/server.ts:48-59`
- Modify: `tests/unit/mcp/security.test.ts`
- Modify: `tests/unit/mcp/serialization.test.ts`
- Modify: `tests/unit/action/runner.test.ts`

**Interfaces:**

- Consumes: all writer error codes from Task 1 and final runtime sink placement from Tasks 3-6.
- Produces: an AST-enforced invariant that `src/security/repository-writer.ts` is the only production filesystem mutation module.
- Preserves: all current MCP tools return content/data only and expose no `output` parameter.

- [ ] **Step 1: Add the AST structural guard**

Use `ts-morph`, not text matching, to inspect every `src/**/*.ts` call expression. Allow filesystem mutation calls only in `src/security/repository-writer.ts`. Include sync/async variants of `appendFile`, `chmod`, `chown`, `copyFile`, `cp`, `createWriteStream`, `link`, `mkdir`, `mkdtemp`, `open`, `rename`, `rm`, `rmdir`, `symlink`, `truncate`, `unlink`, `utimes`, `write`, and `writeFile`.

```ts
const mutators = new Set([
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "copyFile",
  "copyFileSync",
  "createWriteStream",
  "mkdir",
  "mkdirSync",
  "open",
  "openSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "unlink",
  "unlinkSync",
  "write",
  "writeFile",
  "writeFileSync",
]);

const violations = sourceFiles.flatMap((source) =>
  source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) =>
      mutators.has(call.getExpression().getText().split(".").at(-1)!),
    )
    .map((call) => `${source.getFilePath()}:${call.getStartLineNumber()}`),
);
expect(violations).toEqual([]);
```

Complete the set with the listed mutation families and exclude only the writer source file. Child-process script strings in safe-read modules are not AST call expressions and remain unaffected.

Also use `ts-morph` import inspection to assert `src/cli/commands/check.ts` and `src/cli/commands/plan.ts` do not import `repository-writer` or `prepareDocumentTarget`, and assert `src/cli/commands/score.ts` constructs a target only inside its `options.output` branch.

- [ ] **Step 2: Run the structural guard and its non-vacuous fixture**

Run: `npm test -- --runInBand tests/unit/security/write-boundary.test.ts`

Expected: PASS for production sources and PASS for a synthetic assertion that the scanner reports a temporary in-memory fixture containing `fs.writeFileSync()`. This is a post-migration invariant guard rather than a new production behavior, so its non-vacuous fixture supplies the evidence that the scanner can fail.

- [ ] **Step 3: Add MCP stable-code and unchanged-tree tests**

Expand `SAFE_MCP_ERROR_CODES` with `TRUST_REPOSITORY_REQUIRED`, `TRUST_INVALID_PATH`, and `TRUST_INSPECTION_FAILED` while retaining the other writer codes. Add a table test that `formatMCPError()` prefixes each owned code once and never exposes a fake raw target or secret.

For generation, snapshot the fixture recursively after setup, call `generate_readme`, `generate_api_docs`, and `generate_diagram`, then assert the tree (relative names plus content hashes) is byte-for-byte unchanged. Assert `TOOLS` contains no `output` property and no mutating tool name.

- [ ] **Step 4: Run MCP tests and verify the red state**

Run: `npm test -- --runInBand tests/unit/mcp/security.test.ts tests/unit/mcp/serialization.test.ts`

Expected: FAIL until the stable code allowlist and non-mutation assertions are wired.

- [ ] **Step 5: Update MCP serialization only**

Add the stable codes to the safe allowlist. Do not import `RepositoryWriteScope`, add output arguments, or add a file-write tool. Keep `handleToolCall()` generation return values unchanged.

- [ ] **Step 6: Add Action rejection propagation coverage**

Extend the fake runner test with `commands=api`, an output directory pointing outside the fake repository, `AIDOC_FAKE_EXIT=2`, and an external sentinel. Assert runner status 2, empty changed-files output, `changed=true` absent, and unchanged sentinel. The fake CLI simulates the already-tested CLI boundary; do not add Bash path validation.

- [ ] **Step 7: Run structural, MCP, and Action tests**

Run: `npm test -- --runInBand tests/unit/security/write-boundary.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/serialization.test.ts tests/unit/action/runner.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 8: Commit invariant and protocol coverage**

```bash
git add src/mcp/server.ts tests/unit/security/write-boundary.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/serialization.test.ts tests/unit/action/runner.test.ts
git commit -m "test(security): enforce repository write boundary"
```

---

### Task 8: Public-Beta Documentation, Full Verification, and Review

**Files:**

- Modify: `README.md:131-158,323-342`
- Modify: `ROADMAP.md:8-38`
- Modify: `docs/PUBLIC_BETA.md:1-41`

**Interfaces:**

- Consumes: verified behavior and limitations from Tasks 1-7.
- Produces: user-facing claims restricted to evidence from tests and implementation.

- [ ] **Step 1: Update documentation with exact shipped behavior**

In README Trust Gate documentation, replace “does not yet provide filesystem containment” with a concise statement that real CLI/Action/watch writes require a current Git worktree, reject traversal/external/symlink targets, compare the prepared snapshot, and commit through same-directory rename. State that dry-run/check/plan/current MCP generation are non-mutating.

In `ROADMAP.md`, move “Repository-contained atomic writes” from the undifferentiated planned list into an “implemented on the current source branch” subsection while leaving MCP directory allowlisting, doctor, and receipts planned.

In `docs/PUBLIC_BETA.md`, add the repository-write behavior and list the exact metadata, network filesystem, directory fsync/power-loss, Windows `O_NOFOLLOW`, and cross-process TOCTOU limitations. Do not call the boundary an OS sandbox.

- [ ] **Step 2: Run documentation/release-policy focused tests**

Run: `npm test -- --runInBand tests/unit/release/public-beta-config.test.ts tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit user-facing documentation**

```bash
git add README.md ROADMAP.md docs/PUBLIC_BETA.md
git commit -m "docs(security): document repository-contained writes"
```

- [ ] **Step 4: Run formatting and static checks**

Run: `npm run lint`

Expected: PASS with zero ESLint errors.

Run: `/Users/davyd/Documents/aidoc/node_modules/.bin/prettier --check "src/**/*.ts" "tests/**/*.ts" README.md ROADMAP.md docs/PUBLIC_BETA.md`

Expected: PASS. If formatting changes are required, run the same executable with `--write`, inspect the diff, and commit only those scoped changes.

- [ ] **Step 5: Run focused security and consumer suites**

Run: `npm test -- --runInBand tests/unit/security/repository-path.test.ts tests/unit/security/repository-writer.test.ts tests/unit/security/write-boundary.test.ts tests/unit/cli/context.test.ts tests/unit/cli/commands.test.ts tests/unit/cli/update-impact.test.ts tests/unit/cli/write-consumers.test.ts tests/unit/cli/annotate-write.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/serialization.test.ts tests/unit/action/runner.test.ts`

Expected: PASS with zero failed suites/tests.

- [ ] **Step 6: Run the full local release gates**

Run each command separately and retain its exit status/output:

```bash
npm test -- --runInBand
npm run build
npm run verify:release
npm run test:public-beta
npm run verify:public-beta
```

Expected: every command exits 0. Do not hide a failure or infer one gate from another.

- [ ] **Step 7: Run a fresh dependency audit with isolated cache**

Run:

```bash
npm_config_cache=/private/tmp/aidoc-repository-writes-audit-cache npm audit --json
```

Expected: exit 0 and no known production vulnerability. If network access is unavailable, request the required permission and rerun; report the actual result.

- [ ] **Step 8: Verify Git integrity**

Run:

```bash
git diff main...HEAD --check
git status --short --branch
git log --oneline --decorate main..HEAD
```

Expected: no whitespace errors, no uncommitted files, and only scoped design/plan/implementation/documentation commits on `codex/repository-contained-writes`.

- [ ] **Step 9: Request independent code review and resolve findings**

Provide the reviewer with the approved design spec, this plan, `main..HEAD`, and explicit focus areas: path containment, symlink/junction behavior, descriptor identity, cleanup deletion safety, lock correctness, provider-call ordering, dry-run non-mutation, MCP non-mutation, and diagnostic leakage. Apply `receiving-code-review` before accepting changes, reproduce every valid finding with a failing test, fix through TDD, rerun the affected gates, and commit focused corrections.

- [ ] **Step 10: Run hosted CI only after branch-push approval**

If the user approves pushing the branch, push `codex/repository-contained-writes`, wait for hosted CI on Node 22 and Node 24, and report exact job results. Do not merge to `main`; request separate final confirmation after all review and CI evidence is available.
