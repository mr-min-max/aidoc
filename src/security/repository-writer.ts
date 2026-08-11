import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  assertValidRepositoryTarget,
  isRepositoryContainedPath,
} from "./repository-path";
import { RepositoryWriteError, type AtomicWriteStage } from "./types";

const execFileAsync = promisify(execFile);
const GIT_DISCOVERY_TIMEOUT_MS = 5_000;
const GIT_DISCOVERY_MAX_BUFFER = 16 * 1024;
const TEMPORARY_FILE_PREFIX = ".aidoc-write-";
const TEMPORARY_CREATE_ATTEMPTS = 8;

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
  readonly rootPath: string;
  readonly absolutePath: string;
  readonly rootIdentity: FileIdentity;
  readonly components: readonly ComponentSnapshot[];
  readonly leafIdentity: ExistingLeafIdentity | null;
}

interface RepositoryLockState {
  tail: Promise<void>;
  pending: number;
}

interface TrustedDirectory {
  readonly absolutePath: string;
  readonly identity: FileIdentity;
}

const repositoryLocks = new Map<string, RepositoryLockState>();

/** A safely inspected repository target and its exact UTF-8 snapshot. */
export interface PreparedRepositoryTarget {
  readonly displayPath: string;
  readonly existingText: string | null;
  replaceText(content: string): Promise<void>;
}

/** Pins one canonical Git worktree for repository-contained file writes. */
export class RepositoryWriteScope {
  readonly #root: string;
  readonly #lexicalRoot: string | undefined;
  readonly #invocationCwd: string;
  readonly #gitDirectory: string;
  readonly #rootIdentity: FileIdentity;
  readonly #gitDirectoryIdentity: FileIdentity;
  readonly #gitEntryPath: string;
  readonly #gitEntryIdentity: FileIdentity;

  private constructor(
    root: string,
    lexicalRoot: string | undefined,
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

    const lexicalRootCandidate = resolve(
      lexicalCwd,
      relative(canonicalCwd, discovery.root),
    );
    const lexicalRoot = await verifiedLexicalRoot(
      lexicalRootCandidate,
      discovery.root,
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

    const displayPath =
      targetSnapshot.physicalPath === null
        ? relativeTarget
        : relative(this.#root, targetSnapshot.physicalPath);

    return new PreparedRepositoryTargetImpl(
      displayPath,
      targetSnapshot.existingText,
      {
        rootPath: this.#root,
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
  lexicalRoot: string | undefined,
  invocationCwd: string,
  rawTarget: string,
): string {
  if (!isAbsolute(rawTarget)) return resolve(invocationCwd, rawTarget);

  const lexicalTarget = resolve(rawTarget);
  if (isRepositoryContainedPath(root, lexicalTarget)) return lexicalTarget;
  if (
    lexicalRoot === undefined ||
    !isRepositoryContainedPath(lexicalRoot, lexicalTarget)
  ) {
    return lexicalTarget;
  }
  return resolve(root, relative(lexicalRoot, lexicalTarget));
}

async function verifiedLexicalRoot(
  candidate: string,
  canonicalRoot: string,
): Promise<string | undefined> {
  try {
    const physicalCandidate = await realpath(candidate);
    return relative(canonicalRoot, physicalCandidate).length === 0
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
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
    if (this.#consumed) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }
    this.#consumed = true;

    await withRepositoryLock(this.#state.rootIdentity, async () => {
      await commitReplacement(this.#state, content);
    });
  }
}

async function withRepositoryLock<T>(
  rootIdentity: FileIdentity,
  operation: () => Promise<T>,
): Promise<T> {
  const key = repositoryLockKey(rootIdentity);
  let state = repositoryLocks.get(key);
  if (state === undefined) {
    state = { tail: Promise.resolve(), pending: 0 };
    repositoryLocks.set(key, state);
  }

  const previous = state.tail;
  let release = (): void => undefined;
  state.tail = new Promise<void>((resolveTail) => {
    release = resolveTail;
  });
  state.pending += 1;

  await previous;
  try {
    return await operation();
  } finally {
    release();
    state.pending -= 1;
    if (state.pending === 0 && repositoryLocks.get(key) === state) {
      repositoryLocks.delete(key);
    }
  }
}

function repositoryLockKey(identity: FileIdentity): string {
  return `${identity.dev.toString()}:${identity.ino.toString()}:${identity.type}`;
}

async function commitReplacement(
  state: PreparedTargetState,
  content: string,
): Promise<void> {
  const trustedDirectories = await revalidatePreparedTarget(state);
  await createMissingDirectories(state, trustedDirectories);

  let temporaryPath: string | undefined;
  let temporaryHandle: FileHandle | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  let failure: RepositoryWriteError;

  try {
    for (let attempt = 0; attempt < TEMPORARY_CREATE_ATTEMPTS; attempt += 1) {
      temporaryPath = join(
        trustedDirectories[trustedDirectories.length - 1].absolutePath,
        `${TEMPORARY_FILE_PREFIX}${randomTemporarySuffix()}`,
      );
      try {
        temporaryHandle = await open(
          temporaryPath,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            noFollowFlag(),
          0o600,
        );
        break;
      } catch (error) {
        temporaryPath = undefined;
        if (readErrnoCode(error) !== "EEXIST") {
          throw atomicWriteFailure("temp-create");
        }
      }
    }

    if (temporaryHandle === undefined || temporaryPath === undefined) {
      throw atomicWriteFailure("temp-create");
    }

    try {
      const temporaryStats = await temporaryHandle.stat({ bigint: true });
      if (!temporaryStats.isFile()) {
        throw new RepositoryWriteError("TRUST_RACE_DETECTED");
      }
      temporaryIdentity = identityFromStats(temporaryStats, "regular-file");
    } catch (error) {
      if (error instanceof RepositoryWriteError) throw error;
      throw atomicWriteFailure("temp-create");
    }

    await refreshMutatedDirectory(trustedDirectories);

    try {
      await temporaryHandle.writeFile(content, { encoding: "utf8" });
    } catch {
      throw atomicWriteFailure("temp-write");
    }

    if (process.platform !== "win32") {
      const finalMode =
        state.leafIdentity === null
          ? 0o666 & ~process.umask()
          : Number(state.leafIdentity.mode & 0o777n);
      try {
        await temporaryHandle.chmod(finalMode);
      } catch {
        throw atomicWriteFailure("permission");
      }
    }

    try {
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;
    } catch {
      throw atomicWriteFailure("temp-sync");
    }

    await revalidateBeforeRename(
      state,
      trustedDirectories,
      temporaryPath,
      temporaryIdentity,
    );

    try {
      await rename(temporaryPath, state.absolutePath);
    } catch {
      throw atomicWriteFailure("replace");
    }
    return;
  } catch (error) {
    failure = classifyReplacementFailure(error);
  }

  if (temporaryHandle !== undefined) {
    try {
      await temporaryHandle.close();
      temporaryHandle = undefined;
    } catch {
      failure = atomicWriteFailure("temp-sync");
    }
  }

  if (temporaryPath !== undefined) {
    const cleanupFailure = await cleanupTemporaryFile(
      trustedDirectories,
      temporaryPath,
      temporaryIdentity,
    );
    if (cleanupFailure !== undefined) throw cleanupFailure;
  }

  throw failure;
}

async function cleanupTemporaryFile(
  trustedDirectories: readonly TrustedDirectory[],
  temporaryPath: string,
  temporaryIdentity: FileIdentity | undefined,
): Promise<RepositoryWriteError | undefined> {
  if (temporaryIdentity === undefined) {
    return new RepositoryWriteError("TRUST_RACE_DETECTED");
  }

  try {
    await requireStableIdentity(
      trustedDirectories[0].absolutePath,
      trustedDirectories[0].identity,
    );
    const parent = trustedDirectories[trustedDirectories.length - 1];
    if (parent.absolutePath !== trustedDirectories[0].absolutePath) {
      await requireStableIdentity(parent.absolutePath, parent.identity);
    }

    const stats = await lstat(temporaryPath, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      !sameIdentity(temporaryIdentity, identityFromStats(stats, "regular-file"))
    ) {
      return new RepositoryWriteError("TRUST_RACE_DETECTED");
    }
  } catch {
    return new RepositoryWriteError("TRUST_RACE_DETECTED");
  }

  try {
    await unlink(temporaryPath);
  } catch {
    return atomicWriteFailure("cleanup");
  }
  return undefined;
}

function classifyReplacementFailure(error: unknown): RepositoryWriteError {
  return error instanceof RepositoryWriteError
    ? error
    : atomicWriteFailure("replace");
}

async function revalidatePreparedTarget(
  state: PreparedTargetState,
): Promise<TrustedDirectory[]> {
  await requireStableIdentity(state.rootPath, state.rootIdentity);

  for (const component of state.components.slice(0, -1)) {
    if ("missing" in component) {
      await requireAbsent(component.absolutePath);
    } else {
      await requireStableIdentity(component.absolutePath, component.identity);
    }
  }
  await requireStableDestination(state);

  return [
    { absolutePath: state.rootPath, identity: state.rootIdentity },
    ...state.components.slice(0, -1).flatMap((component) =>
      "missing" in component
        ? []
        : [
            {
              absolutePath: component.absolutePath,
              identity: component.identity,
            },
          ],
    ),
  ];
}

async function createMissingDirectories(
  state: PreparedTargetState,
  trustedDirectories: TrustedDirectory[],
): Promise<void> {
  for (const component of state.components.slice(0, -1)) {
    if (!("missing" in component)) continue;

    try {
      await mkdir(component.absolutePath);
    } catch (error) {
      if (readErrnoCode(error) !== "EEXIST") {
        throw atomicWriteFailure("directory-create");
      }
    }

    let stats: BigIntStats;
    try {
      stats = await lstat(component.absolutePath, { bigint: true });
    } catch {
      throw atomicWriteFailure("directory-create");
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new RepositoryWriteError("TRUST_RACE_DETECTED");
    }

    await refreshMutatedDirectory(trustedDirectories);
    trustedDirectories.push({
      absolutePath: component.absolutePath,
      identity: identityFromStats(stats, "directory"),
    });
  }
}

async function refreshMutatedDirectory(
  trustedDirectories: TrustedDirectory[],
): Promise<void> {
  const index = trustedDirectories.length - 1;
  const previous = trustedDirectories[index];
  let stats: BigIntStats;
  try {
    stats = await lstat(previous.absolutePath, { bigint: true });
  } catch {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    !sameIdentity(previous.identity, identityFromStats(stats, "directory"))
  ) {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  trustedDirectories[index] = {
    absolutePath: previous.absolutePath,
    identity: identityFromStats(stats, "directory"),
  };
}

async function revalidateBeforeRename(
  state: PreparedTargetState,
  trustedDirectories: readonly TrustedDirectory[],
  temporaryPath: string,
  temporaryIdentity: FileIdentity,
): Promise<void> {
  for (const directory of trustedDirectories) {
    await requireStableIdentity(directory.absolutePath, directory.identity);
  }
  await requireStableDestination(state);

  let temporaryStats: BigIntStats;
  try {
    temporaryStats = await lstat(temporaryPath, { bigint: true });
  } catch {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  if (
    temporaryStats.isSymbolicLink() ||
    !temporaryStats.isFile() ||
    !sameIdentity(
      temporaryIdentity,
      identityFromStats(temporaryStats, "regular-file"),
    )
  ) {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
}

async function requireStableDestination(
  state: PreparedTargetState,
): Promise<void> {
  if (state.leafIdentity === null) {
    await requireAbsent(state.absolutePath);
    return;
  }

  let stats: BigIntStats;
  try {
    stats = await lstat(state.absolutePath, { bigint: true });
  } catch {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !sameExistingLeaf(state.leafIdentity, leafIdentityFromStats(stats))
  ) {
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await lstat(path, { bigint: true });
  } catch (error) {
    if (readErrnoCode(error) === "ENOENT") return;
    throw new RepositoryWriteError("TRUST_RACE_DETECTED");
  }
  throw new RepositoryWriteError("TRUST_RACE_DETECTED");
}

function randomTemporarySuffix(): string {
  try {
    return randomBytes(16).toString("hex");
  } catch {
    throw atomicWriteFailure("temp-create");
  }
}

function noFollowFlag(): number {
  return process.platform !== "win32" &&
    typeof constants.O_NOFOLLOW === "number"
    ? constants.O_NOFOLLOW
    : 0;
}

function atomicWriteFailure(stage: AtomicWriteStage): RepositoryWriteError {
  return new RepositoryWriteError("TRUST_ATOMIC_WRITE_FAILED", stage);
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
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.toUpperCase().startsWith("GIT_"),
            ),
          ),
          LC_ALL: "C",
        },
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
  readonly physicalPath: string | null;
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
    return {
      components,
      leafIdentity,
      existingText: null,
      physicalPath: null,
    };
  }

  const snapshot = await readExistingSnapshot(
    root,
    gitDirectory,
    absoluteTarget,
    leafIdentity,
  );
  return {
    components,
    leafIdentity,
    existingText: snapshot.text,
    physicalPath: snapshot.physicalPath,
  };
}

async function readExistingSnapshot(
  root: string,
  gitDirectory: string,
  absoluteTarget: string,
  preOpenIdentity: ExistingLeafIdentity,
): Promise<{ readonly text: string; readonly physicalPath: string }> {
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
  return { text, physicalPath: initialPhysicalPath };
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
