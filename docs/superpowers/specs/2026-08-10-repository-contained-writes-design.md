# Repository-Contained Atomic Writes Design

- **Date:** 2026-08-10
- **Target:** `v0.2.0` Trust Gate follow-up
- **Status:** Approved in conversation; awaiting written-spec review

## 1. Objective

Route every AiDoc runtime file mutation through one repository-scoped,
symlink-rejecting, atomic text-file boundary. A successful mutation must replace
one regular file inside the current Git worktree with a complete new version.
An ordinary failure before the rename commit point must preserve the previous
destination and, whenever the temporary pathname can still be proven safe,
remove the temporary file. Cleanup failure or hostile path substitution is
reported explicitly instead of risking deletion through an untrusted path.

This slice implements only repository-contained atomic writes. It does not add
MCP directory allowlisting, `aidoc doctor`, run receipts, evidence-backed
claims, `aidoc verify`, or `aidoc explain`.

## 2. Current Write Inventory

AiDoc currently has two runtime write systems:

1. `src/cli/context.ts` routes `readme`, `api`, `changelog`, `diagram`,
   `update`, `watch`, and `score` through `writeDoc`, which calls
   `writeMarkdown` in `src/output/markdown.ts`. `writeMarkdown` performs a
   recursive `mkdirSync` followed by `writeFileSync` directly on the target.
2. `src/cli/commands/annotate.ts` calls `writeFileSync` directly for every
   accepted annotation.

The GitHub Action invokes the same CLI commands and therefore inherits these
paths. Current MCP generation tools return content and do not mutate files.
Build/demo scripts, template copying, `dist` cleanup, Action runner output
files, and Action Git staging/commit operations are not runtime document sinks
and are outside this abstraction.

## 3. Design Principles

1. **One boundary.** Path authorization, symlink handling, snapshot reads,
   atomic replacement, cleanup, and diagnostics live in one testable module.
   Commands call the boundary; they do not reproduce its checks.
2. **Explicit worktree root.** A real write belongs to one canonical Git
   worktree established from the command's invocation directory.
3. **Fail before provider transport.** Once a command knows it has generation
   input and intends to write, it prepares the target before calling an
   `LLMProvider` method.
4. **Snapshot then compare.** A prepared target safely reads the current file
   and records its identity. Replacement refuses to overwrite a version that
   changed while generation or confirmation was in progress.
5. **Atomic visibility.** Content is written and flushed in a same-directory
   temporary file, then committed with one rename. There is no unlink-first or
   copy/delete fallback.
6. **Safe failure over aggressive cleanup.** Cleanup never unlinks a path whose
   identity can no longer be proven. Under a hostile directory race, leaving a
   temporary file is safer than deleting an external file.
7. **Honest platform limits.** Pure Node.js path APIs reduce and detect races
   but cannot provide directory-descriptor isolation across every supported
   platform.

## 4. Alternatives Considered

### 4.1 Two-phase repository scope and prepared target — selected

One `RepositoryWriteScope` pins the worktree root. `prepare()` validates and
snapshots a target; the resulting one-shot handle performs `replaceText()`.
This makes the root explicit, avoids repeated Git discovery, blocks unsafe
targets before provider calls, supports multi-file annotation, and gives tests
a narrow security seam.

### 4.2 Stateless atomic-write function

A function receiving `cwd`, target, and content would have a smaller call
surface, but it would rediscover the repository for every write and would not
provide a safe pre-provider snapshot. Multi-file commands could accidentally
use inconsistent roots or duplicate preflight logic.

### 4.3 Generic atomic-write npm package

Existing packages generally cover temporary-file creation and rename, not Git
root discovery, `.git` exclusion, ancestor symlinks, destination identity,
safe diagnostics, or command integration. AiDoc would still need nearly the
entire security boundary while adding another supply-chain dependency.

### 4.4 Native `openat`/`renameat` helper

A native helper could hold directory descriptors and narrow POSIX ancestor
races further. It would add platform-specific binaries, build tooling,
packaging risk, and a different Windows implementation. That cost is not
proportionate for this beta, whose requirements explicitly call for honest
TOCTOU documentation rather than an OS sandbox claim.

## 5. Public Contract

The minimal mutation contract is:

```ts
export class RepositoryWriteScope {
  static open(cwd: string): Promise<RepositoryWriteScope>;
  prepare(rawTarget: string): Promise<PreparedRepositoryTarget>;
}

export interface PreparedRepositoryTarget {
  readonly displayPath: string;
  readonly existingText: string | null;
  replaceText(content: string): Promise<void>;
}
```

`displayPath` is normalized, repository-relative, and safe to show after the
input path passes control-character validation. `existingText` is the exact
snapshot used for diffing, merging, and compare-before-replace. A prepared
target is one-shot: its first replacement attempt consumes it even if the
attempt fails. A caller must prepare again before retrying.

The scope does not expose its absolute root. Errors do not retain raw targets,
content, temporary names, child-process output, underlying filesystem errors,
or `cause` values.

## 6. Git Worktree Discovery

`RepositoryWriteScope.open(cwd)` performs these read-only steps:

1. canonicalize `cwd` with `realpath` and require a directory;
2. run `git rev-parse --show-toplevel` with `execFile`, a timeout, bounded
   output, no shell, and a child environment stripped of repository-local
   `GIT_*` overrides;
3. canonicalize the reported top level;
4. require canonical `cwd` to equal or descend from the reported root;
5. require the root to be a real directory and record its filesystem identity;
6. inspect the root `.git` entry, accepting a non-symlink directory for a main
   worktree or a non-symlink regular file for a linked worktree.

Filtering `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, and related variables
prevents an inherited environment from redirecting repository discovery. The
post-discovery cwd containment check also rejects a misleading `core.worktree`
configuration that reports an unrelated root.

Bare repositories and directories outside a supported Git worktree fail with
`TRUST_REPOSITORY_REQUIRED`.

## 7. Target Syntax and Containment

`prepare(rawTarget)` first validates syntax without touching a destination:

- reject empty strings and NUL;
- reject C0 and DEL control characters;
- reject every `..` component, even if normalization would remain inside the
  repository;
- resolve relative paths from canonical invocation cwd;
- allow absolute paths only when the final target is inside the canonical
  worktree;
- use `path.relative`, not string-prefix comparison, for containment;
- reject the worktree root itself;
- reject every component named `.git` using ASCII case-insensitive comparison;
- reject targets that physically resolve to the canonical Git metadata
  directory or its descendants.

On Windows the validator additionally rejects:

- Win32 and NT device namespace prefixes;
- drive-relative forms such as `C:target.md`;
- alternate data stream syntax;
- reserved device basenames such as `CON`, `NUL`, `COM1`, and `LPT1`, including
  names with extensions;
- forbidden Win32 filename characters;
- components ending in a dot or space.

Absolute drive and UNC paths are accepted only when their filesystem root and
canonical containment match the selected Git worktree. Pure Windows syntax
validation is isolated so it can be tested with `path.win32` on non-Windows CI.

## 8. Physical Path Validation and Snapshot Read

After lexical containment, `prepare()` walks from the canonical root toward
the destination using `lstat`:

- every existing ancestor must be a non-symlink directory;
- a symlink or junction is rejected even when it resolves back inside the
  worktree;
- missing ancestors are recorded but not created during preparation;
- an existing destination must be a non-symlink regular file;
- directories, devices, FIFOs, sockets, and other leaf types are rejected;
- a missing destination is allowed.

For each existing component, the scope records a bigint identity including
device, inode, and type. For an existing destination it also records size,
`mtimeNs`, and `ctimeNs` so in-place changes can be detected.

An existing destination is opened without following the leaf symlink where the
platform supports `O_NOFOLLOW`. The implementation compares pre-open `lstat`,
descriptor `fstat`, the descriptor after reading, and `realpath` containment.
Windows uses the same lstat/fstat/realpath identity checks without claiming an
unavailable `O_NOFOLLOW` guarantee. Any mismatch returns
`TRUST_RACE_DETECTED`; no provider call follows.

The descriptor-backed read becomes `PreparedRepositoryTarget.existingText`.
It first validates that the byte snapshot is well-formed UTF-8, so decoding
cannot silently replace invalid bytes before a later write. Real write paths
use this snapshot instead of calling `readFile` separately. A filesystem, Git,
or decoding failure that cannot be classified as a safe policy rejection or
identity race is collapsed to the fixed `TRUST_INSPECTION_FAILED` diagnostic.

## 9. Atomic Replacement

`replaceText(content)` runs once and acquires a module-level internal lock keyed
by the recorded repository-root filesystem identity. The lock covers
revalidation, temporary-file work, and rename, and is removed after the last
queued replacement completes. Serializing commits within one repository is
intentionally more conservative than locking a path string: it also covers
case aliases, separate scope instances, and directory creation shared by two
targets without guessing the host filesystem's case-sensitivity rules.

The lock prevents two writes in one AiDoc process from both checking an old
destination before either rename. After waiting, a stale prepared target fails
revalidation instead of silently becoming last-writer-wins. Writes to different
repositories may still commit concurrently. This is an in-process guarantee
only; independent processes remain subject to the documented filesystem race
boundary.

Inside the lock the writer:

1. revalidates root identity, every existing ancestor, and the destination
   snapshot;
2. creates each missing directory one component at a time, handling `EEXIST`
   by lstat and type validation rather than trusting it;
3. creates a randomly named, target-independent temporary file in the verified
   destination directory using exclusive-create semantics;
4. records the temporary descriptor identity immediately;
5. writes the complete UTF-8 content through the descriptor;
6. applies the final file mode where supported;
7. calls `FileHandle.sync()` and closes the descriptor;
8. revalidates the root, ancestor chain, destination snapshot, and temporary
   path identity;
9. performs exactly one same-directory `rename(temp, destination)`;
10. treats successful rename as the commit point.

The implementation never truncates the destination and never falls back to
`unlink(destination)`, copy/delete, or another non-atomic sequence. If the
platform or filesystem cannot replace the existing destination with rename,
the operation fails and preserves the old destination.

## 10. Permissions and Metadata

Temporary content starts with restrictive permissions. Before commit:

- on POSIX, an existing file retains only its ordinary `mode & 0o777` bits;
- a new file receives `0o666` filtered by the process umask;
- setuid, setgid, and sticky bits are not copied;
- a POSIX chmod failure aborts before rename;
- Windows uses platform file permissions and does not claim POSIX mode
  preservation.

Atomic inode replacement does not promise to preserve ownership, ACLs,
extended attributes, resource forks, alternate streams, creation time, or
other platform-specific metadata. This limitation is documented rather than
silently described as full metadata preservation.

## 11. Failure and Cleanup Semantics

Before the rename commit point, every ordinary error closes any open descriptor
and attempts to remove any created temporary file. Cleanup first proves that
the root and parent identities still match and that the current temporary path
names the same file recorded from the descriptor.

If identity is proven, cleanup attempts to remove the temporary file. A failed
unlink returns an atomic-write failure at the `cleanup` stage and may leave a
verified orphan rather than hiding the cleanup failure. If an ancestor or temp
identity changed, the writer returns `TRUST_RACE_DETECTED` and deliberately
does not unlink the now-untrusted pathname. This may also leave an orphaned
random temp under a hostile race, but it cannot delete a substituted external
file.

Missing parent directories created by the writer may remain empty after a
later failure. Removing them would create another race with concurrent users
and is not required for target atomicity.

After successful rename there is no rollback. A post-commit observer sees the
old complete file or the new complete file, subject to filesystem rename
semantics. `FileHandle.sync()` flushes the temporary file data and metadata,
but this design does not claim cross-platform directory-entry fsync or
power-loss durability.

## 12. Error Contract

All errors use fixed, value-free messages. `TRUST_ATOMIC_WRITE_FAILED` may add
only one allowlisted stage: `directory-create`, `temp-create`, `temp-write`,
`temp-sync`, `permission`, `replace`, or `cleanup`.

| Code                        | Meaning                                            | CLI exit |
| --------------------------- | -------------------------------------------------- | -------: |
| `TRUST_REPOSITORY_REQUIRED` | No supported Git worktree                          |        2 |
| `TRUST_INVALID_PATH`        | Malformed, traversal, control, ADS, or device path |        2 |
| `TRUST_PATH_OUTSIDE_ROOT`   | External target, root, or Git metadata             |        2 |
| `TRUST_UNSAFE_SYMLINK`      | Symlink or junction in the target chain            |        2 |
| `TRUST_INVALID_TARGET_TYPE` | Invalid ancestor or destination type               |        2 |
| `TRUST_RACE_DETECTED`       | Snapshot or path identity changed                  |        1 |
| `TRUST_INSPECTION_FAILED`   | Repository or target could not be safely inspected |        1 |
| `TRUST_ATOMIC_WRITE_FAILED` | Atomic pipeline operation failed                   |        1 |

`getTrustErrorExitCode()` expands its safe rejection allowlist for the exit-2
codes. Race, inspection, and operational write failures remain exit 1. MCP's
safe-code allowlist includes the new stable codes without adding a mutating MCP
tool. The GitHub Action propagates the CLI status unchanged.

## 13. Command Integration

Every real write follows:

```text
deterministic input check
  -> prepare target and snapshot
  -> provider generation when applicable
  -> validate and diff against snapshot
  -> user confirmation when applicable
  -> atomic replace
```

Preparation happens after a command proves it has meaningful generation input
but before the first provider method call. Provider construction may remain in
the existing command context; no unsafe target reaches provider transport.

### 13.1 Document commands

`readme`, `api`, `changelog`, and `diagram` prepare their raw output option and
use `existingText` for merging or diff display. `update` keeps its provider-free
impact plan first, then prepares and reads the target snapshot before sending
the approved existing document through the existing Trust Gate.

### 13.2 Watch

Watch mode holds one repository scope for the process but prepares a fresh
snapshot before every regeneration. If an editor or another operation changes
the target during generation, replacement fails rather than overwriting the
newer version.

### 13.3 Score

`score --dir` remains the read-only analysis location. A report output is
resolved from the invocation cwd, preserving current behavior, and must belong
to that cwd's Git worktree. Without `--output`, or with `--dry-run`, no write
scope is created.

### 13.4 Annotate

After AST analysis identifies undocumented symbols, annotate prepares every
unique source target before calling the provider. It preserves the existing
per-symbol confirmation behavior but accumulates accepted changes in memory.
Accepted insertions for one file are applied in descending source-line order
to the prepared snapshot, followed by one atomic replacement per file. If no
annotation for a file is accepted, no write occurs.

This removes partial per-file annotation results without broadening parser or
provider behavior. AST analysis remains deterministic and precedes the LLM.

### 13.5 Dry-run, check, and plan

Dry-run retains the existing preview path and performs no Git-root discovery,
directory creation, temp creation, or mutation. `check` and `plan` remain
provider-free/read-only and do not import or construct the writer.

### 13.6 Action and MCP

The GitHub Action receives containment through the CLI. Bash does not duplicate
path checks. Host-owned runner output files and Git staging remain outside this
document boundary.

MCP generation tools remain return-only. This slice does not add `output`
parameters, write tools, or directory authorization. Tests prove that MCP
generation leaves the repository tree unchanged; MCP directory allowlisting
remains the next independent roadmap slice.

## 14. Test Strategy

Every behavior change follows red-green-refactor using temporary Git
worktrees/repositories and runtime-built sentinels.

### 14.1 Core writer tests

Required cases include:

- replace an existing regular file;
- create a new file and missing directories;
- preserve ordinary POSIX permission bits;
- reject raw `..`, including traversal that normalizes back inside root;
- reject an external absolute path and sibling-prefix escape;
- reject the root and Git metadata;
- reject an external parent symlink;
- reject leaf and dangling symlinks;
- reject directory and other invalid destination types;
- reject invalid UTF-8 without calling the provider or changing the target;
- collapse injected Git, lstat, descriptor-read, and realpath failures to the
  fixed inspection diagnostic;
- reject a stale prepared snapshot without changing the newer file;
- serialize two concurrent prepared targets so one commits and one reports a
  race;
- inject failures at directory create, temp create/write/sync, permission,
  rename, and cleanup stages;
- preserve the original destination for every pre-commit failure;
- remove the temp after an ordinary stable-path failure;
- skip unsafe unlink after a simulated parent identity substitution;
- prove an external sentinel is never modified or deleted;
- prove diagnostics contain no raw target, repository root, fake secret,
  temporary name, or underlying error;
- test Win32 ADS, device, reserved-name, drive-relative, and trailing-dot
  syntax independently of host OS;
- prove temp names contain no target-derived data.

### 14.2 Consumer tests

- `writeDoc` consumes a prepared snapshot and has no direct write path;
- dry-run creates no scope, directory, target, or temp;
- each generation command rejects an unsafe target before a provider call;
- update reads from the prepared snapshot;
- annotate preserves per-symbol decisions but replaces each file once;
- watch obtains a new prepared snapshot for each regeneration;
- score without output never creates a writer;
- Action propagates CLI exit 2 and emits no changed file after rejection;
- MCP generation leaves the fixture tree unchanged;
- an AST-based structural test using `ts-morph` rejects direct runtime
  `writeFile*`, `rename`, `unlink`, `rm`, or write-stream calls outside the
  writer module.

The Action must not implement a second Bash path allowlist. Its test verifies
wiring and propagation; CLI integration tests verify the actual boundary.

### 14.3 Regression and release gates

Before implementation completion run:

- focused unit and integration tests;
- `npm run lint`;
- the complete Jest suite;
- `npm run build`;
- `npm run verify:release`;
- `npm run test:public-beta`;
- `npm run verify:public-beta`;
- a fresh `npm audit` using an isolated cache when required;
- `git diff --check`;
- independent code review;
- hosted CI on Node 22 and Node 24 after an approved branch push.

Failures are reported rather than hidden. No tag, npm publication, GitHub
Release, stable-v1 claim, merge to `main`, or unrelated roadmap feature belongs
to this slice.

## 15. Expected File Shape

The implementation plan may refine exact test placement, but the intended
production shape is:

- create `src/security/repository-writer.ts`;
- extend `src/security/types.ts` and `src/security/diagnostics.ts` with stable
  write errors and exit mapping;
- update `src/cli/context.ts` to make `writeDoc` consume a prepared target;
- route `readme`, `api`, `changelog`, `diagram`, `update`, `watch`, `score`, and
  `annotate` through the scope;
- remove `writeMarkdown` as a production sink while retaining Markdown
  validation helpers;
- update MCP safe-code serialization without adding writes;
- add focused security, CLI, Action, watch, and MCP tests;
- update README, `ROADMAP.md`, and `docs/PUBLIC_BETA.md` with accurate shipped
  behavior and limitations during implementation.

No prompt, provider, AST parser, or unrelated configuration refactor is
required.

## 16. Documented Limitations

Node's promise filesystem APIs are not automatically synchronized. The writer
therefore serializes in-process commits per repository, but separate processes
can still race.
Path-based Node APIs do not expose a portable directory-descriptor `renameat`
workflow, and `O_NOFOLLOW` is unavailable on Windows. A privileged same-host
process can rename directories in the final validation-to-rename window.

Network filesystems may weaken exclusive-create or rename behavior. Bind
mounts, junction/reparse behavior, unstable inode reporting, ACL inheritance,
and power-loss durability remain operating-system/filesystem concerns. The
writer performs containment, symlink rejection, identity checks, in-process
serialization, and same-directory atomic replacement; it does not claim a
general OS sandbox.

References:

- [Node.js filesystem API](https://nodejs.org/api/fs.html)
- [POSIX rename](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
- [Git environment and worktree discovery](https://git-scm.com/docs/git)
- [Windows file naming and namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- [Windows MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexa)

## 17. Acceptance Criteria

- Every AiDoc runtime file mutation uses `RepositoryWriteScope`.
- No command duplicates containment or symlink logic.
- Real writes resolve one explicit canonical Git worktree root.
- Unsafe targets are rejected before provider transport.
- Absolute external paths, traversal, Git metadata, ancestor symlinks, and
  leaf symlinks cannot be written through.
- Existing and new files are committed by same-directory rename without a
  non-atomic fallback.
- Every pre-commit failure preserves the destination; ordinary failures remove
  the temp when verified cleanup succeeds, and cleanup failures are explicit.
- Unsafe cleanup never unlinks an unproven path.
- Concurrent writes in one process do not silently overwrite one another.
- Dry-run, check, plan, current MCP tools, and no-output score paths perform no
  writes.
- Diagnostics and tests expose no secret values or absolute paths.
- Documentation states metadata, network filesystem, durability, and TOCTOU
  limits without an OS-sandbox claim.
