import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  assertValidRepositoryTarget,
  isRepositoryContainedPath,
} from "./repository-path";
import { RepositoryWriteError } from "./types";

const execFileAsync = promisify(execFile);
const GIT_DISCOVERY_TIMEOUT_MS = 5_000;
const GIT_DISCOVERY_MAX_BUFFER = 16 * 1024;

type FileType = "directory" | "regular-file";

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly type: FileType;
}

interface ExistingLeafIdentity extends FileIdentity {
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly mode: bigint;
}

interface ExistingComponentSnapshot {
  readonly absolutePath: string;
  readonly identity: FileIdentity;
}

interface MissingComponentSnapshot {
  readonly absolutePath: string;
  readonly missing: true;
}

type ComponentSnapshot = ExistingComponentSnapshot | MissingComponentSnapshot;

interface PreparedTargetState {
  readonly absolutePath: string;
  readonly rootIdentity: FileIdentity;
  readonly components: readonly ComponentSnapshot[];
  readonly leafIdentity: ExistingLeafIdentity | null;
}

/** A safely inspected repository target and its exact UTF-8 snapshot. */
export interface PreparedRepositoryTarget {
  readonly displayPath: string;
  readonly existingText: string | null;
  replaceText(content: string): Promise<void>;
}

/** Pins one canonical Git worktree for repository-contained file writes. */
export class RepositoryWriteScope {
  readonly #root: string;
  readonly #lexicalRoot: string;
  readonly #invocationCwd: string;
  readonly #gitDirectory: string;
  readonly #rootIdentity: FileIdentity;
  readonly #gitDirectoryIdentity: FileIdentity;
  readonly #gitEntryPath: string;
  readonly #gitEntryIdentity: FileIdentity;

  private constructor(
    root: string,
    lexicalRoot: string,
    invocationCwd: string,
    gitDirectory: string,
    rootIdentity: FileIdentity,
    gitDirectoryIdentity: FileIdentity,
    gitEntryPath: string,
    gitEntryIdentity: FileIdentity,
  ) {
    this.#root = root;
    this.#lexicalRoot = lexicalRoot;
    this.#invocationCwd = invocationCwd;
    this.#gitDirectory = gitDirectory;
    this.#rootIdentity = rootIdentity;
    this.#gitDirectoryIdentity = gitDirectoryIdentity;
    this.#gitEntryPath = gitEntryPath;
    this.#gitEntryIdentity = gitEntryIdentity;
  }

  static async open(cwd: string): Promise<RepositoryWriteScope> {
    const lexicalCwd = resolve(cwd);
    const canonicalCwd = await canonicalDirectory(cwd);
    const discovery = await discoverGitScope(canonicalCwd);

    if (!isRepositoryContainedPath(discovery.root, canonicalCwd)) {
      throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
    }

    const rootIdentity = await inspectDirectory(discovery.root);
    const gitDirectoryIdentity = await inspectDirectory(discovery.gitDirectory);
    const gitEntryPath = join(discovery.root, ".git");
    const gitEntryIdentity = await inspectGitEntry(gitEntryPath);

    await requireStableIdentity(discovery.root, rootIdentity);
    await requireStableIdentity(discovery.gitDirectory, gitDirectoryIdentity);
    await requireStableIdentity(gitEntryPath, gitEntryIdentity);

    const lexicalRoot = resolve(
      lexicalCwd,
      relative(canonicalCwd, discovery.root),
    );

    return new RepositoryWriteScope(
      discovery.root,
      lexicalRoot,
      canonicalCwd,
      discovery.gitDirectory,
      rootIdentity,
      gitDirectoryIdentity,
      gitEntryPath,
      gitEntryIdentity,
    );
  }

  async prepare(rawTarget: string): Promise<PreparedRepositoryTarget> {
    assertValidRepositoryTarget(rawTarget);
    await this.requireStableScope();

    const absoluteTarget = resolveTarget(
      this.#root,
      this.#lexicalRoot,
      this.#invocationCwd,
      rawTarget,
    );
    const relativeTarget = relative(this.#root, absoluteTarget);

    if (
      !isRepositoryContainedPath(this.#root, absoluteTarget) ||
      relativeTarget.length === 0 ||
      relativeTarget
        .split(sep)
        .some((component) => component.toLowerCase() === ".git")
    ) {
      throw new RepositoryWriteError("TRUST_PATH_OUTSIDE_ROOT");
    }

    const targetSnapshot = await inspectTarget(
      this.#root,
      this.#rootIdentity,
      this.#gitDirectory,
      absoluteTarget,
      relativeTarget,
    );

    await this.requireStableScope();

    return new PreparedRepositoryTargetImpl(
      relativeTarget,
      targetSnapshot.existingText,
      {
        absolutePath: absoluteTarget,
        rootIdentity: this.#rootIdentity,
        components: targetSnapshot.components,
        leafIdentity: targetSnapshot.leafIdentity,
      },
    );
  }

  private async requireStableScope(): Promise<void> {
    await requireStableIdentity(this.#root, this.#rootIdentity);
    await requireStableIdentity(this.#gitDirectory, this.#gitDirectoryIdentity);
    await requireStableIdentity(this.#gitEntryPath, this.#gitEntryIdentity);
  }
}

function resolveTarget(
  root: string,
  lexicalRoot: string,
  invocationCwd: string,
  rawTarget: string,
): string {
  if (!isAbsolute(rawTarget)) return resolve(invocationCwd, rawTarget);

  const lexicalTarget = resolve(rawTarget);
  if (isRepositoryContainedPath(root, lexicalTarget)) return lexicalTarget;
  if (!isRepositoryContainedPath(lexicalRoot, lexicalTarget)) {
    return lexicalTarget;
  }
  return resolve(root, relative(lexicalRoot, lexicalTarget));
}

class PreparedRepositoryTargetImpl implements PreparedRepositoryTarget {
  #consumed = false;
  readonly #state: PreparedTargetState;

  constructor(
    readonly displayPath: string,
    readonly existingText: string | null,
    state: PreparedTargetState,
  ) {
    this.#state = state;
  }

  async replaceText(content: string): Promise<void> {
    if (!this.#consumed) this.#consumed = true;
    void content;
    void this.#state;
    throw new RepositoryWriteError("TRUST_ATOMIC_WRITE_FAILED", "replace");
  }
}

interface GitDiscovery {
  readonly root: string;
  readonly gitDirectory: string;
}

async function canonicalDirectory(path: string): Promise<string> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
  } catch {
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }

  await inspectDirectory(canonicalPath);
  return canonicalPath;
}

async function discoverGitScope(canonicalCwd: string): Promise<GitDiscovery> {
  let stdout: string;
  try {
    const result = await execFileAsync(
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
        timeout: GIT_DISCOVERY_TIMEOUT_MS,
        maxBuffer: GIT_DISCOVERY_MAX_BUFFER,
        windowsHide: true,
      },
    );
    stdout = result.stdout;
  } catch (error) {
    if (isUnsupportedWorktreeResult(error)) {
      throw new RepositoryWriteError("TRUST_REPOSITORY_REQUIRED");
    }
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }

  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== 2) {
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }

  try {
    const [reportedRoot, reportedGitDirectory] = lines;
    return {
      root: await realpath(reportedRoot),
      gitDirectory: await realpath(reportedGitDirectory),
    };
  } catch {
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }
}

function isUnsupportedWorktreeResult(error: unknown): boolean {
  const stderr = readStringProperty(error, "stderr");
  return (
    stderr?.includes("not a git repository") === true ||
    stderr?.includes("must be run in a work tree") === true
  );
}

async function inspectDirectory(path: string): Promise<FileIdentity> {
  const stats = await inspectPath(path, "TRUST_INSPECTION_FAILED");
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }
  return identityFromStats(stats, "directory");
}

async function inspectGitEntry(path: string): Promise<FileIdentity> {
  let stats: BigIntStats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if (readErrnoCode(error) === "ENOENT") {
      throw new RepositoryWriteError("TRUST_REPOSITORY_REQUIRED");
    }
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }

  if (stats.isSymbolicLink()) {
    throw new RepositoryWriteError("TRUST_REPOSITORY_REQUIRED");
  }
  if (stats.isDirectory()) return identityFromStats(stats, "directory");
  if (stats.isFile()) return identityFromStats(stats, "regular-file");
  throw new RepositoryWriteError("TRUST_REPOSITORY_REQUIRED");
}

async function inspectTarget(
  root: string,
  rootIdentity: FileIdentity,
  gitDirectory: string,
  absoluteTarget: string,
  relativeTarget: string,
): Promise<{
  readonly components: readonly ComponentSnapshot[];
  readonly leafIdentity: ExistingLeafIdentity | null;
  readonly existingText: string | null;
}> {
  const parts = relativeTarget.split(sep);
  const components: ComponentSnapshot[] = [];
  let currentPath = root;
  let ancestorMissing = false;
  let leafIdentity: ExistingLeafIdentity | null = null;

  for (const [index, part] of parts.entries()) {
    currentPath = join(currentPath, part);
    const isLeaf = index === parts.length - 1;

    if (ancestorMissing) {
      components.push({ absolutePath: currentPath, missing: true });
      continue;
    }

    let stats: BigIntStats;
    try {
      stats = await lstat(currentPath, { bigint: true });
    } catch (error) {
      const code = readErrnoCode(error);
      if (code === "ENOENT") {
        ancestorMissing = true;
        components.push({ absolutePath: currentPath, missing: true });
        continue;
      }
      if (code === "ENOTDIR") {
        throw new RepositoryWriteError("TRUST_RACE_DETECTED");
      }
      throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
    }

    if (stats.isSymbolicLink()) {
      throw new RepositoryWriteError("TRUST_UNSAFE_SYMLINK");
    }

    if (!isLeaf) {
      if (!stats.isDirectory()) {
        throw new RepositoryWriteError("TRUST_INVALID_TARGET_TYPE");
      }
      components.push({
        absolutePath: currentPath,
        identity: identityFromStats(stats, "directory"),
      });
      continue;
    }

    if (!stats.isFile()) {
      throw new RepositoryWriteError("TRUST_INVALID_TARGET_TYPE");
    }

    leafIdentity = leafIdentityFromStats(stats);
    components.push({ absolutePath: currentPath, identity: leafIdentity });
  }

  await requireStableIdentity(root, rootIdentity);
  if (leafIdentity === null) {
    return { components, leafIdentity, existingText: null };
  }

  const existingText = await readExistingSnapshot(
    root,
    gitDirectory,
    absoluteTarget,
    leafIdentity,
  );
  return { components, leafIdentity, existingText };
}

async function readExistingSnapshot(
  root: string,
  gitDirectory: string,
  absoluteTarget: string,
  preOpenIdentity: ExistingLeafIdentity,
): Promise<string> {
  const initialPhysicalPath = await inspectPhysicalTarget(
    root,
    gitDirectory,
    absoluteTarget,
    "policy",
  );
  let handle: FileHandle | undefined;
  let text: string | undefined;
  let failure: RepositoryWriteError | undefined;

  try {
    const noFollow =
      process.platform !== "win32" && typeof constants.O_NOFOLLOW === "number"
        ? constants.O_NOFOLLOW
        : 0;
    handle = await open(absoluteTarget, constants.O_RDONLY | noFollow);
    const beforeRead = await handle.stat({ bigint: true });
    if (
      !beforeRead.isFile() ||
      !sameExistingLeaf(preOpenIdentity, leafIdentityFromStats(beforeRead))
    ) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }

    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (
      !afterRead.isFile() ||
      !sameExistingLeaf(
        leafIdentityFromStats(beforeRead),
        leafIdentityFromStats(afterRead),
      )
    ) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }

    const postReadStats = await lstat(absoluteTarget, { bigint: true });
    if (
      !postReadStats.isFile() ||
      postReadStats.isSymbolicLink() ||
      !sameExistingLeaf(
        leafIdentityFromStats(afterRead),
        leafIdentityFromStats(postReadStats),
      )
    ) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }

    const finalPhysicalPath = await inspectPhysicalTarget(
      root,
      gitDirectory,
      absoluteTarget,
      "race",
    );
    if (finalPhysicalPath !== initialPhysicalPath) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }
    if (!isUtf8(bytes)) {
      throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
    }
    text = bytes.toString("utf8");
  } catch (error) {
    failure = classifySnapshotFailure(error);
  }

  if (handle !== undefined) {
    try {
      await handle.close();
    } catch {
      failure ??= new RepositoryWriteError("TRUST_INSPECTION_FAILED");
    }
  }

  if (failure !== undefined) throw failure;
  if (text === undefined) {
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }
  return text;
}

async function inspectPhysicalTarget(
  root: string,
  gitDirectory: string,
  absoluteTarget: string,
  unexpectedContainment: "policy" | "race",
): Promise<string> {
  let physicalPath: string;
  try {
    physicalPath = await realpath(absoluteTarget);
  } catch (error) {
    if (
      unexpectedContainment === "race" &&
      ["ENOENT", "ENOTDIR", "ELOOP"].includes(readErrnoCode(error) ?? "")
    ) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }
    throw new RepositoryWriteError("TRUST_INSPECTION_FAILED");
  }

  if (isRepositoryContainedPath(gitDirectory, physicalPath)) {
    throw new RepositoryWriteError(
      unexpectedContainment === "policy"
        ? "TRUST_PATH_OUTSIDE_ROOT"
        : "TRUST_RACE_DETECTED",
    );
  }
  if (!isRepositoryContainedPath(root, physicalPath)) {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  return physicalPath;
}

async function requireStableIdentity(
  path: string,
  expected: FileIdentity,
): Promise<void> {
  let current: BigIntStats;
  try {
    current = await lstat(path, { bigint: true });
  } catch {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }

  const type = fileType(current);
  if (
    current.isSymbolicLink() ||
    type === undefined ||
    !sameIdentity(expected, identityFromStats(current, type))
  ) {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
}

async function inspectPath(
  path: string,
  failureCode: "TRUST_INSPECTION_FAILED",
): Promise<BigIntStats> {
  try {
    return await lstat(path, { bigint: true });
  } catch {
    throw new RepositoryWriteError(failureCode);
  }
}

function identityFromStats(stats: BigIntStats, type: FileType): FileIdentity {
  return { dev: stats.dev, ino: stats.ino, type };
}

function leafIdentityFromStats(stats: BigIntStats): ExistingLeafIdentity {
  return {
    ...identityFromStats(stats, "regular-file"),
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    mode: stats.mode,
  };
}

function fileType(stats: BigIntStats): FileType | undefined {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "regular-file";
  return undefined;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev && left.ino === right.ino && left.type === right.type
  );
}

function sameExistingLeaf(
  left: ExistingLeafIdentity,
  right: ExistingLeafIdentity,
): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mode === right.mode
  );
}

function classifySnapshotFailure(error: unknown): RepositoryWriteError {
  if (error instanceof RepositoryWriteError) return error;
  const code = readErrnoCode(error);
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
    return new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  return new RepositoryWriteError("TRUST_INSPECTION_FAILED");
}

function readErrnoCode(error: unknown): string | undefined {
  return readStringProperty(error, "code");
}

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const result = Reflect.get(value, property);
    return typeof result === "string" ? result : undefined;
  } catch {
    return undefined;
  }
}
