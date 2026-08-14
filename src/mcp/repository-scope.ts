import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, readdir, realpath, type FileHandle } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { devNull } from "node:os";
import {
  isAbsolute,
  join,
  posix as pathPosix,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { PlanFailure } from "../impact/types";
import type { GatewayPathProtection } from "../security/gateway";
import { applySecretPolicy, type RedactionSession } from "../security/scanner";
import type { TrustPolicy } from "../security/types";

const execFileAsync = promisify(execFile);
const { open: openFile } = fsPromises;

const MAX_DIRECTORY_BYTES = 4 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_GLOB_PATTERNS = 64;
const MAX_GLOB_PATTERN_BYTES = 1024;
const MAX_GLOB_LIST_BYTES = 16 * 1024;
const MAX_ENUMERATED_FILES = 10_000;
const MAX_ENUMERATED_BYTES = 32 * 1024 * 1024;
const MAX_GIT_REF_BYTES = 1024;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 5_000;

const NO_FOLLOW =
  typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const DIRECTORY_FLAG =
  typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;

export const MCP_INVALID_PATH_INPUT = "MCP_INVALID_PATH_INPUT" as const;
export const MCP_DIRECTORY_DENIED = "MCP_DIRECTORY_DENIED" as const;

export const MCP_SCOPE_ERROR_CODES = Object.freeze([
  MCP_INVALID_PATH_INPUT,
  MCP_DIRECTORY_DENIED,
] as const);

type MCPRepositoryScopeErrorCode = (typeof MCP_SCOPE_ERROR_CODES)[number];

const MCP_SCOPE_ERROR_CONFIGURATION =
  "Invalid MCP repository scope error configuration.";
const MCP_SCOPE_ERROR_CODE_SET = new Set<MCPRepositoryScopeErrorCode>(
  MCP_SCOPE_ERROR_CODES,
);
const MCP_SCOPE_ERROR_MESSAGES = new Map<MCPRepositoryScopeErrorCode, string>([
  [MCP_INVALID_PATH_INPUT, "The MCP path input is invalid."],
  [
    MCP_DIRECTORY_DENIED,
    "The requested directory is outside the MCP repository scope.",
  ],
]);
const MCP_SCOPE_ERROR_MESSAGE_SET = new Set(MCP_SCOPE_ERROR_MESSAGES.values());

interface ScopeErrorPayload {
  readonly code: MCPRepositoryScopeErrorCode;
  readonly message: string;
}

const MCP_SCOPE_ERROR_PAYLOADS = new WeakMap<object, ScopeErrorPayload>();

function findPropertyDescriptor(
  object: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const visited = new Set<object>();
  let current: object | null = object;
  while (current !== null) {
    if (visited.has(current)) throw new Error("Cyclic error prototype.");
    visited.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

/** A fixed, value-free error raised by the MCP repository read boundary. */
export class MCPRepositoryScopeError extends Error {
  declare readonly code: MCPRepositoryScopeErrorCode;

  constructor(code: MCPRepositoryScopeErrorCode) {
    if (!MCP_SCOPE_ERROR_CODE_SET.has(code)) {
      throw new TypeError(MCP_SCOPE_ERROR_CONFIGURATION);
    }
    const message = MCP_SCOPE_ERROR_MESSAGES.get(code);
    if (message === undefined) {
      throw new TypeError(MCP_SCOPE_ERROR_CONFIGURATION);
    }
    super(message);
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "MCPRepositoryScopeError",
      writable: true,
    });
    Object.defineProperty(this, "code", {
      configurable: true,
      enumerable: true,
      value: code,
      writable: true,
    });
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: true,
      value: message,
      writable: true,
    });
    MCP_SCOPE_ERROR_PAYLOADS.set(this, Object.freeze({ code, message }));
  }

  /** Returns the original fixed payload only for an unmodified authentic error. */
  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const payload = MCP_SCOPE_ERROR_PAYLOADS.get(error);
    if (payload === undefined) return undefined;

    try {
      const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
      const messageDescriptor = Object.getOwnPropertyDescriptor(
        error,
        "message",
      );
      if (
        codeDescriptor === undefined ||
        !Object.hasOwn(codeDescriptor, "value") ||
        messageDescriptor === undefined ||
        !Object.hasOwn(messageDescriptor, "value") ||
        codeDescriptor.value !== payload.code ||
        messageDescriptor.value !== payload.message
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { ...payload };
  }

  /** Identifies scope-shaped errors so a mutated or forged lookalike fails closed. */
  static isCandidate(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    if (MCP_SCOPE_ERROR_PAYLOADS.has(error)) return true;

    try {
      const codeDescriptor = findPropertyDescriptor(error, "code");
      const messageDescriptor = findPropertyDescriptor(error, "message");
      if (
        (codeDescriptor !== undefined &&
          !Object.hasOwn(codeDescriptor, "value")) ||
        (messageDescriptor !== undefined &&
          !Object.hasOwn(messageDescriptor, "value"))
      ) {
        return true;
      }
      const code =
        codeDescriptor !== undefined && Object.hasOwn(codeDescriptor, "value")
          ? codeDescriptor.value
          : undefined;
      const message =
        messageDescriptor !== undefined &&
        Object.hasOwn(messageDescriptor, "value")
          ? messageDescriptor.value
          : undefined;
      return (
        (typeof code === "string" &&
          MCP_SCOPE_ERROR_CODE_SET.has(code as MCPRepositoryScopeErrorCode)) ||
        (typeof message === "string" &&
          MCP_SCOPE_ERROR_MESSAGE_SET.has(message))
      );
    } catch {
      return true;
    }
  }
}

const authorizedMCPDirectory: unique symbol = Symbol("authorizedMCPDirectory");
const authorizedMCPFile: unique symbol = Symbol("authorizedMCPFile");

export interface AuthorizedMCPDirectory {
  readonly [authorizedMCPDirectory]: true;
  readonly displayPath: string;
}

export interface AuthorizedMCPFile {
  readonly [authorizedMCPFile]: true;
  readonly displayPath: string;
  readonly content: string | null;
}

export interface AuthorizedMCPExistingFile extends AuthorizedMCPFile {
  readonly content: string;
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly type: "directory" | "regular-file";
}

interface ExistingFileIdentity extends FileIdentity {
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly mode: bigint;
}

interface DirectoryComponent {
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly identity: FileIdentity;
}

interface ScopeState {
  readonly token: object;
  readonly startupRootPath: string;
  readonly rootPath: string;
  readonly gitDirectoryPath: string;
  readonly gitEntryPath: string;
  readonly rootIdentity: FileIdentity;
  readonly gitDirectoryIdentity: FileIdentity;
  readonly gitEntryIdentity: FileIdentity;
  rootDirectory: AuthorizedMCPDirectory;
}

interface DirectoryRecord {
  readonly scopeToken: object;
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly components: readonly DirectoryComponent[];
}

interface FileRecord {
  readonly scopeToken: object;
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly directory: AuthorizedMCPDirectory;
  readonly identity: ExistingFileIdentity | undefined;
}

const AUTHORIZED_DIRECTORIES = new WeakMap<
  AuthorizedMCPDirectory,
  DirectoryRecord
>();
const AUTHORIZED_FILES = new WeakMap<AuthorizedMCPFile, FileRecord>();

/** Reads one own data property without invoking an accessor or coercing its value. */
export function readOwnMCPArgument(
  args: unknown,
  key: string,
  failure: () => Error,
): unknown {
  if (
    typeof key !== "string" ||
    typeof args !== "object" ||
    args === null ||
    Array.isArray(args)
  ) {
    throw failure();
  }

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(args);
  } catch {
    throw failure();
  }
  if (!keys.some((candidate) => candidate === key)) return undefined;

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(args, key);
  } catch {
    throw failure();
  }
  if (descriptor === undefined || !("value" in descriptor)) throw failure();
  return descriptor.value;
}

/** Copies exactly the own data fields allowed by one MCP route. */
export function readExactMCPRecord(
  args: unknown,
  allowedKeys: readonly string[],
  failure: () => Error,
): Readonly<Record<string, unknown>> {
  if (
    typeof args !== "object" ||
    args === null ||
    Array.isArray(args) ||
    !Array.isArray(allowedKeys)
  ) {
    throw failure();
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(args);
  } catch {
    throw failure();
  }
  if (prototype !== Object.prototype && prototype !== null) throw failure();

  const allowed = new Set<string>();
  for (const key of allowedKeys) {
    if (typeof key !== "string") throw failure();
    allowed.add(key);
  }

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(args);
  } catch {
    throw failure();
  }
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key)) throw failure();
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(args, key);
    } catch {
      throw failure();
    }
    if (descriptor === undefined || !("value" in descriptor)) throw failure();
    copy[key] = descriptor.value;
  }
  return Object.freeze(copy);
}

/** Pins one canonical Git worktree for bounded MCP project reads. */
export class MCPRepositoryReadScope {
  readonly #state: ScopeState;

  private constructor(state: ScopeState) {
    this.#state = state;
  }

  /** Opens a scope after pinning the startup directory to a canonical Git worktree. */
  static async open(serverCwd: string): Promise<MCPRepositoryReadScope> {
    if (typeof serverCwd !== "string" || serverCwd.length === 0) {
      throw directoryDenied();
    }

    try {
      const canonicalCwd = await canonicalDirectory(serverCwd);
      const discovery = await discoverGitScope(canonicalCwd);
      if (!isContained(discovery.rootPath, canonicalCwd)) {
        throw directoryDenied();
      }

      const rootIdentity = await inspectDirectoryIdentity(discovery.rootPath);
      const gitDirectoryIdentity = await inspectDirectoryIdentity(
        discovery.gitDirectoryPath,
      );
      const gitEntryPath = join(discovery.rootPath, ".git");
      const gitEntryIdentity = await inspectGitEntryIdentity(gitEntryPath);

      const state: ScopeState = {
        token: {},
        startupRootPath: resolve(
          resolve(serverCwd),
          relative(canonicalCwd, discovery.rootPath),
        ),
        rootPath: discovery.rootPath,
        gitDirectoryPath: discovery.gitDirectoryPath,
        gitEntryPath,
        rootIdentity,
        gitDirectoryIdentity,
        gitEntryIdentity,
        rootDirectory: undefined as unknown as AuthorizedMCPDirectory,
      };
      state.rootDirectory = makeAuthorizedDirectory(state, {
        absolutePath: discovery.rootPath,
        displayPath: ".",
        components: [
          {
            absolutePath: discovery.rootPath,
            displayPath: ".",
            identity: rootIdentity,
          },
        ],
      });

      await requireStableScope(state);
      return new MCPRepositoryReadScope(state);
    } catch (error: unknown) {
      if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
      throw directoryDenied();
    }
  }

  /** Returns the authenticated directory handle for the pinned repository root. */
  rootDirectory(): AuthorizedMCPDirectory {
    return this.#state.rootDirectory;
  }

  /** Creates a non-serializable provider-boundary protection capability. */
  createMCPPathProtection(): GatewayPathProtection {
    const sensitivePaths = Object.freeze([
      this.#state.startupRootPath,
      this.#state.rootPath,
    ]);
    return Object.freeze({
      protect(text: string, policy: TrustPolicy, session: RedactionSession) {
        return applySecretPolicy(text, policy, session, {
          additionalSensitivePaths: sensitivePaths,
          onlySensitivePaths: true,
          redactSensitivePathsOnWarn: true,
        });
      },
    });
  }

  /** Returns selected-directory-to-root handles in the order used for config lookup. */
  configurationDirectories(
    directory: AuthorizedMCPDirectory,
  ): readonly AuthorizedMCPDirectory[] {
    const record = this.requireDirectory(directory);
    const values: AuthorizedMCPDirectory[] = [];

    for (let index = record.components.length - 1; index >= 0; index -= 1) {
      const component = record.components[index];
      const components = record.components.slice(0, index + 1);
      values.push(
        makeAuthorizedDirectory(this.#state, {
          absolutePath: component.absolutePath,
          displayPath: component.displayPath,
          components,
        }),
      );
    }
    return Object.freeze(values);
  }

  /** Validates and authenticates a real, symlink-free directory in this scope. */
  async authorizeDirectory(raw: unknown): Promise<AuthorizedMCPDirectory> {
    const input = validateDirectoryInput(raw);
    let candidate = isAbsolute(input)
      ? resolve(input)
      : resolve(this.#state.rootPath, input);

    if (!isContained(this.#state.rootPath, candidate)) {
      const startupRelative = relative(this.#state.startupRootPath, candidate);
      if (!isContained(this.#state.startupRootPath, candidate)) {
        throw directoryDenied();
      }
      candidate = resolve(this.#state.rootPath, startupRelative);
    }
    const relativeCandidate = relative(this.#state.rootPath, candidate);

    if (!isContained(this.#state.rootPath, candidate)) {
      throw directoryDenied();
    }

    const parts =
      relativeCandidate.length === 0 ? [] : relativeCandidate.split(sep);
    const components: DirectoryComponent[] = [
      {
        absolutePath: this.#state.rootPath,
        displayPath: ".",
        identity: this.#state.rootIdentity,
      },
    ];
    let currentPath = this.#state.rootPath;

    for (const [index, part] of parts.entries()) {
      if (part === ".git") throw directoryDenied();
      currentPath = join(currentPath, part);
      const identity = await inspectDirectoryComponent(
        currentPath,
        index === parts.length - 1,
      );
      components.push({
        absolutePath: currentPath,
        displayPath: toDisplayPath(this.#state.rootPath, currentPath),
        identity,
      });
    }

    const canonicalCandidate = await canonicalExistingPath(candidate);
    if (
      canonicalCandidate !== candidate ||
      !isContained(this.#state.rootPath, canonicalCandidate) ||
      isGitMetadataPath(this.#state, canonicalCandidate)
    ) {
      throw directoryDenied();
    }
    await requireStableScope(this.#state);

    return makeAuthorizedDirectory(this.#state, {
      absolutePath: canonicalCandidate,
      displayPath: toDisplayPath(this.#state.rootPath, canonicalCandidate),
      components,
    });
  }

  /** Reads an optional regular file through the no-follow, identity-checked boundary. */
  async readOptionalFile(
    directory: AuthorizedMCPDirectory,
    rawRelativePath: unknown,
    options?: { readonly maxBytes: number },
  ): Promise<AuthorizedMCPFile> {
    return this.readFile(directory, rawRelativePath, false, options);
  }

  /** Reads a required regular file or raises a fixed scope denial. */
  async readRequiredFile(
    directory: AuthorizedMCPDirectory,
    rawRelativePath: unknown,
    options?: { readonly maxBytes: number },
  ): Promise<AuthorizedMCPExistingFile> {
    const file = await this.readFile(directory, rawRelativePath, true, options);
    if (file.content === null) throw directoryDenied();
    return file as AuthorizedMCPExistingFile;
  }

  /** Distinguishes an omitted glob override from a validated caller-supplied list. */
  parseOptionalGlobList(
    raw: unknown,
    kind: "include" | "exclude",
  ): readonly string[] | undefined {
    if (raw === undefined) return undefined;
    return this.validateGlobList(raw, kind);
  }

  /** Validates bounded POSIX glob patterns before filesystem enumeration. */
  validateGlobList(
    raw: unknown,
    kind: "include" | "exclude",
  ): readonly string[] {
    if (kind !== "include" && kind !== "exclude") {
      throw invalidPath();
    }

    let values: string[];
    if (typeof raw === "string") {
      if (
        Buffer.byteLength(raw, "utf8") >
        MAX_GLOB_LIST_BYTES + MAX_GLOB_PATTERNS
      ) {
        throw invalidPath();
      }
      if (raw.length === 0 && kind === "exclude") return Object.freeze([]);
      values = raw.split(",").map((value) => value.trim());
    } else if (Array.isArray(raw)) {
      values = readStringArray(raw);
    } else {
      throw invalidPath();
    }

    if (values.length === 0) {
      if (kind === "exclude") return Object.freeze([]);
      throw invalidPath();
    }
    if (values.length > MAX_GLOB_PATTERNS) throw invalidPath();

    let combinedBytes = 0;
    for (const pattern of values) {
      if (
        pattern.length === 0 ||
        containsControlCharacter(pattern) ||
        pattern.includes("\\") ||
        pattern.includes("..") ||
        isUnsafePathSyntax(pattern) ||
        isAbsolute(pattern) ||
        Buffer.byteLength(pattern, "utf8") > MAX_GLOB_PATTERN_BYTES
      ) {
        throw invalidPath();
      }
      combinedBytes += Buffer.byteLength(pattern, "utf8");
      if (combinedBytes > MAX_GLOB_LIST_BYTES) throw invalidPath();
    }
    return Object.freeze([...values]);
  }

  /** Enumerates deterministic captured source files while pruning symlinks and bounds. */
  async enumerateSources(
    directory: AuthorizedMCPDirectory,
    include: readonly string[],
    exclude: readonly string[],
  ): Promise<readonly AuthorizedMCPExistingFile[]> {
    const record = this.requireDirectory(directory);
    const safeInclude = this.validateGlobList(include, "include");
    const safeExclude = this.validateGlobList(exclude, "exclude");
    await requireStableDirectory(this.#state, record);

    const selectedRelativeRoot =
      record.displayPath === "." ? "" : record.displayPath;
    const pending = [record.absolutePath];
    const matches: AuthorizedMCPExistingFile[] = [];
    let capturedBytes = 0;

    while (pending.length > 0) {
      const currentPath = pending.pop();
      if (currentPath === undefined) continue;
      const entries = await readDirectoryNoFollow(currentPath);
      entries.sort((left, right) => compareStrings(left.name, right.name));

      for (const entry of entries) {
        if (entry.name === ".git" || entry.isSymbolicLink()) continue;
        const childPath = join(currentPath, entry.name);
        const childIdentity = await inspectEntry(childPath);
        if (childIdentity === undefined) continue;

        if (childIdentity.type === "directory") {
          pending.push(childPath);
          continue;
        }

        const displayPath = toDisplayPath(this.#state.rootPath, childPath);
        const matchPath =
          selectedRelativeRoot.length === 0
            ? displayPath
            : pathPosix.relative(selectedRelativeRoot, displayPath);
        if (
          !matchesAny(matchPath, safeInclude) ||
          matchesAny(matchPath, safeExclude)
        ) {
          continue;
        }

        if (matches.length >= MAX_ENUMERATED_FILES) throw directoryDenied();
        await requireStableDirectory(this.#state, record);
        const relativeToSelected = pathPosix.relative(
          selectedRelativeRoot,
          displayPath,
        );
        const file = await this.readRequiredFile(
          record.value,
          relativeToSelected,
        );
        capturedBytes += Buffer.byteLength(file.content, "utf8");
        if (capturedBytes > MAX_ENUMERATED_BYTES) throw directoryDenied();
        matches.push(file);
      }
    }

    await requireStableDirectory(this.#state, record);
    matches.sort((left, right) =>
      compareStrings(left.displayPath, right.displayPath),
    );
    return Object.freeze(matches);
  }

  /** Validates a bounded Git ref without coercion or option-like values. */
  validateGitRef(raw: unknown, fallback: string): string {
    const value = raw === undefined ? fallback : raw;
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("-") ||
      containsControlCharacter(value) ||
      value.includes("\u0000") ||
      Buffer.byteLength(value, "utf8") > MAX_GIT_REF_BYTES
    ) {
      throw new PlanFailure(
        "PLAN_INVALID_REF",
        "The Git reference is invalid.",
      );
    }
    return value;
  }

  /** Returns validated, sorted, selected-directory Git paths from a fixed Git invocation. */
  async changedFiles(
    directory: AuthorizedMCPDirectory,
    fromRef: string,
    toRef = "HEAD",
  ): Promise<readonly string[]> {
    const record = this.requireDirectory(directory);
    const safeFromRef = this.validateGitRef(fromRef, "");
    const safeToRef = this.validateGitRef(toRef, "HEAD");
    await requireStableDirectory(this.#state, record);

    const range = `${safeFromRef}..${safeToRef}`;
    let stdout: Buffer;
    try {
      const result = await execFileAsync(
        "git",
        [
          "diff",
          "--name-only",
          "--no-renames",
          "--no-ext-diff",
          "--no-textconv",
          "-z",
          "--end-of-options",
          range,
          "--",
        ],
        {
          cwd: this.#state.rootPath,
          env: sanitizedGitEnvironment(),
          encoding: "buffer",
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: MAX_GIT_OUTPUT_BYTES,
          windowsHide: true,
        },
      );
      if (!Buffer.isBuffer(result.stdout)) throw directoryDenied();
      stdout = result.stdout;
    } catch (error: unknown) {
      if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
      throw directoryDenied();
    }

    if (stdout.length === 0) {
      await requireStableDirectory(this.#state, record);
      return Object.freeze([]);
    }
    if (!isUtf8(stdout) || stdout[stdout.length - 1] !== 0) {
      throw directoryDenied();
    }

    const result = new Set<string>();
    for (const rawPath of splitNulDelimited(stdout)) {
      const displayPath = validateGitPath(rawPath);
      if (isWithinSelectedDirectory(record.displayPath, displayPath)) {
        result.add(displayPath);
      }
    }
    await requireStableDirectory(this.#state, record);
    return Object.freeze(
      [...result].sort((left, right) => compareStrings(left, right)),
    );
  }

  private async readFile(
    directory: AuthorizedMCPDirectory,
    rawRelativePath: unknown,
    required: boolean,
    options?: { readonly maxBytes: number },
  ): Promise<AuthorizedMCPFile> {
    const record = this.requireDirectory(directory);
    const relativePath = validateRelativeFilePath(rawRelativePath);
    const optionRecord =
      options === undefined
        ? undefined
        : readExactMCPRecord(options, ["maxBytes"], invalidPath);
    const maxBytes = validateMaxBytes(
      optionRecord?.maxBytes as number | undefined,
    );
    const inspected = await inspectFilePath(this.#state, record, relativePath);

    if (inspected.identity === undefined) {
      if (required) throw directoryDenied();
      return makeAuthorizedFile(this.#state, {
        absolutePath: inspected.absolutePath,
        displayPath: inspected.displayPath,
        directory,
        identity: undefined,
        content: null,
      });
    }

    await requireStableDirectory(this.#state, record);
    const content = await readRegularFile(
      this.#state,
      inspected.absolutePath,
      inspected.identity,
      maxBytes,
    );
    await requireStableDirectory(this.#state, record);
    return makeAuthorizedFile(this.#state, {
      absolutePath: inspected.absolutePath,
      displayPath: inspected.displayPath,
      directory,
      identity: inspected.identity,
      content,
    });
  }

  private requireDirectory(
    directory: AuthorizedMCPDirectory,
  ): DirectoryRecord & { readonly value: AuthorizedMCPDirectory } {
    if (typeof directory !== "object" || directory === null) {
      throw directoryDenied();
    }
    const record = AUTHORIZED_DIRECTORIES.get(directory);
    if (record === undefined || record.scopeToken !== this.#state.token) {
      throw directoryDenied();
    }
    return { ...record, value: directory };
  }
}

function invalidPath(): MCPRepositoryScopeError {
  return new MCPRepositoryScopeError(MCP_INVALID_PATH_INPUT);
}

function directoryDenied(): MCPRepositoryScopeError {
  return new MCPRepositoryScopeError(MCP_DIRECTORY_DENIED);
}

function validateDirectoryInput(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    Buffer.byteLength(raw, "utf8") > MAX_DIRECTORY_BYTES ||
    containsControlCharacter(raw) ||
    raw.includes("\\") ||
    raw.split("/").some((part) => part === "..") ||
    isUnsafePathSyntax(raw)
  ) {
    throw invalidPath();
  }
  return raw;
}

function validateRelativeFilePath(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    Buffer.byteLength(raw, "utf8") > MAX_DIRECTORY_BYTES ||
    containsControlCharacter(raw) ||
    raw.includes("\\") ||
    raw.split("/").some((part) => part === "..") ||
    isUnsafePathSyntax(raw)
  ) {
    throw invalidPath();
  }
  if (isAbsolute(raw) || raw.startsWith("/")) throw invalidPath();
  return raw;
}

function validateMaxBytes(raw: number | undefined): number {
  if (
    raw !== undefined &&
    (!Number.isInteger(raw) || raw < 0 || raw > MAX_FILE_BYTES)
  ) {
    throw invalidPath();
  }
  return raw ?? MAX_FILE_BYTES;
}

function isUnsafePathSyntax(value: string): boolean {
  return (
    value.startsWith("//") ||
    /^[A-Za-z]:/u.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  );
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  try {
    return patterns.some((pattern) => pathPosix.matchesGlob(path, pattern));
  } catch {
    throw invalidPath();
  }
}

function readStringArray(raw: unknown[]): string[] {
  try {
    if (!Array.isArray(raw)) throw invalidPath();
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Array.prototype && prototype !== null)
      throw invalidPath();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      throw invalidPath();
    }
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(raw);
    const seen = new Set<number>();
    for (const key of keys) {
      if (key === "length") continue;
      if (typeof key !== "string") throw invalidPath();
      const index = arrayIndex(key);
      if (index === undefined || index >= length || seen.has(index)) {
        throw invalidPath();
      }
      seen.add(index);
    }
    if (seen.size !== length) throw invalidPath();

    const values: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        throw invalidPath();
      }
      if (typeof descriptor.value !== "string") throw invalidPath();
      values.push(descriptor.value.trim());
    }
    return values;
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    throw invalidPath();
  }
}

function arrayIndex(key: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < 0xffffffff ? index : undefined;
}

function makeAuthorizedDirectory(
  state: ScopeState,
  input: {
    readonly absolutePath: string;
    readonly displayPath: string;
    readonly components: readonly DirectoryComponent[];
  },
): AuthorizedMCPDirectory {
  const value = Object.freeze({
    [authorizedMCPDirectory]: true as const,
    displayPath: input.displayPath,
  });
  AUTHORIZED_DIRECTORIES.set(value, {
    scopeToken: state.token,
    absolutePath: input.absolutePath,
    displayPath: input.displayPath,
    components: Object.freeze([...input.components]),
  });
  return value;
}

function makeAuthorizedFile(
  state: ScopeState,
  input: {
    readonly absolutePath: string;
    readonly displayPath: string;
    readonly directory: AuthorizedMCPDirectory;
    readonly identity: ExistingFileIdentity | undefined;
    readonly content: string | null;
  },
): AuthorizedMCPFile {
  const value = Object.freeze({
    [authorizedMCPFile]: true as const,
    displayPath: input.displayPath,
    content: input.content,
  });
  AUTHORIZED_FILES.set(value, {
    scopeToken: state.token,
    absolutePath: input.absolutePath,
    displayPath: input.displayPath,
    directory: input.directory,
    identity: input.identity,
  });
  return value;
}

async function inspectFilePath(
  state: ScopeState,
  directory: DirectoryRecord & { readonly value: AuthorizedMCPDirectory },
  relativePath: string,
): Promise<{
  readonly absolutePath: string;
  readonly displayPath: string;
  readonly identity: ExistingFileIdentity | undefined;
}> {
  await requireStableDirectory(state, directory);
  const parts = relativePath
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
  let currentPath = directory.absolutePath;

  for (const [index, part] of parts.entries()) {
    if (part === ".git") throw directoryDenied();
    currentPath = join(currentPath, part);
    const isLeaf = index === parts.length - 1;
    let stats: BigIntStats;
    try {
      stats = await lstat(currentPath, { bigint: true });
    } catch (error: unknown) {
      if (isLeaf && readErrnoCode(error) === "ENOENT") {
        await requireStableDirectory(state, directory);
        return {
          absolutePath: currentPath,
          displayPath: toDisplayPath(state.rootPath, currentPath),
          identity: undefined,
        };
      }
      throw directoryDenied();
    }
    if (stats.isSymbolicLink()) throw directoryDenied();
    if (!isLeaf && !stats.isDirectory()) throw directoryDenied();
    if (isLeaf && !stats.isFile()) throw directoryDenied();
  }

  const canonicalPath = await canonicalExistingPath(currentPath);
  if (
    canonicalPath !== currentPath ||
    !isContained(state.rootPath, canonicalPath) ||
    isGitMetadataPath(state, canonicalPath)
  ) {
    throw directoryDenied();
  }
  const stats = await lstat(currentPath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) throw directoryDenied();
  return {
    absolutePath: currentPath,
    displayPath: toDisplayPath(state.rootPath, canonicalPath),
    identity: existingFileIdentity(stats),
  };
}

async function readRegularFile(
  state: ScopeState,
  absolutePath: string,
  expected: ExistingFileIdentity,
  maxBytes: number,
): Promise<string> {
  const initialPhysicalPath = await canonicalExistingPath(absolutePath);
  if (
    initialPhysicalPath !== absolutePath ||
    !isContained(state.rootPath, initialPhysicalPath) ||
    isGitMetadataPath(state, initialPhysicalPath)
  ) {
    throw directoryDenied();
  }

  let handle: FileHandle | undefined;
  let content: string | undefined;
  let failure: MCPRepositoryScopeError | undefined;
  try {
    handle = await openFile(absolutePath, constants.O_RDONLY | NO_FOLLOW);
    const before = await handle.stat({ bigint: true });
    const beforeIdentity = existingFileIdentityIfRegular(before);
    if (
      beforeIdentity === undefined ||
      !sameExistingIdentity(expected, beforeIdentity)
    ) {
      throw directoryDenied();
    }
    if (beforeIdentity.size > BigInt(maxBytes)) throw directoryDenied();

    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes || !isUtf8(bytes)) throw directoryDenied();

    const after = await handle.stat({ bigint: true });
    const afterIdentity = existingFileIdentityIfRegular(after);
    if (
      afterIdentity === undefined ||
      !sameExistingIdentity(beforeIdentity, afterIdentity)
    ) {
      throw directoryDenied();
    }
    const postStats = await lstat(absolutePath, { bigint: true });
    const postIdentity = existingFileIdentityIfRegular(postStats);
    if (
      postIdentity === undefined ||
      !sameExistingIdentity(afterIdentity, postIdentity)
    ) {
      throw directoryDenied();
    }
    const finalPhysicalPath = await canonicalExistingPath(absolutePath);
    if (
      finalPhysicalPath !== initialPhysicalPath ||
      finalPhysicalPath !== absolutePath
    ) {
      throw directoryDenied();
    }
    content = bytes.toString("utf8");
  } catch (error: unknown) {
    failure =
      MCPRepositoryScopeError.read(error) !== undefined
        ? (error as MCPRepositoryScopeError)
        : directoryDenied();
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        failure ??= directoryDenied();
      }
    }
  }
  if (failure !== undefined) throw failure;
  if (content === undefined) throw directoryDenied();
  return content;
}

async function readDirectoryNoFollow(
  absolutePath: string,
): Promise<import("node:fs").Dirent[]> {
  let handle: FileHandle | undefined;
  let entries: import("node:fs").Dirent[] | undefined;
  let failure: MCPRepositoryScopeError | undefined;
  try {
    handle = await openFile(
      absolutePath,
      constants.O_RDONLY | NO_FOLLOW | DIRECTORY_FLAG,
    );
    const initialPhysicalPath = await canonicalExistingPath(absolutePath);
    if (initialPhysicalPath !== absolutePath) throw directoryDenied();
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory()) throw directoryDenied();
    entries = await readdir(absolutePath, {
      encoding: "utf8",
      withFileTypes: true,
    });
    const after = await lstat(absolutePath, { bigint: true });
    const finalPhysicalPath = await canonicalExistingPath(absolutePath);
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      finalPhysicalPath !== absolutePath ||
      !sameIdentity(directoryIdentity(stats), directoryIdentity(after))
    ) {
      throw directoryDenied();
    }
  } catch (error: unknown) {
    failure =
      MCPRepositoryScopeError.read(error) !== undefined
        ? (error as MCPRepositoryScopeError)
        : directoryDenied();
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        failure ??= directoryDenied();
      }
    }
  }
  if (failure !== undefined) throw failure;
  if (entries === undefined) throw directoryDenied();
  return entries;
}

async function inspectEntry(
  absolutePath: string,
): Promise<FileIdentity | undefined> {
  try {
    const stats = await lstat(absolutePath, { bigint: true });
    if (stats.isSymbolicLink()) return undefined;
    if (stats.isDirectory()) return directoryIdentity(stats);
    if (stats.isFile()) return existingFileIdentity(stats);
    return undefined;
  } catch {
    throw directoryDenied();
  }
}

async function inspectDirectoryComponent(
  absolutePath: string,
  leaf: boolean,
): Promise<FileIdentity> {
  try {
    const stats = await lstat(absolutePath, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw directoryDenied();
    if (!leaf && !stats.isDirectory()) throw directoryDenied();
    return directoryIdentity(stats);
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    throw directoryDenied();
  }
}

async function requireStableScope(state: ScopeState): Promise<void> {
  const root = await inspectDirectoryIdentity(state.rootPath);
  const gitDirectory = await inspectDirectoryIdentity(state.gitDirectoryPath);
  const gitEntry = await inspectGitEntryIdentity(state.gitEntryPath);
  if (
    !sameIdentity(root, state.rootIdentity) ||
    !sameIdentity(gitDirectory, state.gitDirectoryIdentity) ||
    !sameIdentity(gitEntry, state.gitEntryIdentity)
  ) {
    throw directoryDenied();
  }
}

async function requireStableDirectory(
  state: ScopeState,
  directory: DirectoryRecord,
): Promise<void> {
  await requireStableScope(state);
  for (const component of directory.components) {
    let identity: FileIdentity;
    try {
      identity = await inspectDirectoryIdentity(component.absolutePath);
    } catch {
      throw directoryDenied();
    }
    if (!sameIdentity(identity, component.identity)) throw directoryDenied();
  }
}

async function canonicalDirectory(absolutePath: string): Promise<string> {
  try {
    const canonicalPath = await realpath(absolutePath);
    const stats = await lstat(canonicalPath, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw directoryDenied();
    return canonicalPath;
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    throw directoryDenied();
  }
}

interface GitDiscovery {
  readonly rootPath: string;
  readonly gitDirectoryPath: string;
}

async function discoverGitScope(cwd: string): Promise<GitDiscovery> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel", "--absolute-git-dir"],
      {
        cwd,
        env: sanitizedGitEnvironment(),
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024,
        windowsHide: true,
      },
    );
    if (typeof result.stdout !== "string") throw directoryDenied();
    stdout = result.stdout;
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    throw directoryDenied();
  }

  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  if (
    lines.length !== 2 ||
    lines.some((line) => containsControlCharacter(line) || !isAbsolute(line))
  ) {
    throw directoryDenied();
  }
  try {
    return {
      rootPath: await realpath(lines[0]),
      gitDirectoryPath: await realpath(lines[1]),
    };
  } catch {
    throw directoryDenied();
  }
}

function sanitizedGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/iu.test(key)) environment[key] = value;
  }
  environment.LC_ALL = "C";
  environment.LANG = "C";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = devNull;
  environment.GIT_CONFIG_SYSTEM = devNull;
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  return environment;
}

async function canonicalExistingPath(absolutePath: string): Promise<string> {
  try {
    return await realpath(absolutePath);
  } catch {
    throw directoryDenied();
  }
}

async function inspectDirectoryIdentity(
  absolutePath: string,
): Promise<FileIdentity> {
  try {
    const stats = await lstat(absolutePath, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw directoryDenied();
    return directoryIdentity(stats);
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    throw directoryDenied();
  }
}

async function inspectGitEntryIdentity(
  absolutePath: string,
): Promise<FileIdentity> {
  try {
    const stats = await lstat(absolutePath, { bigint: true });
    if (stats.isSymbolicLink()) throw directoryDenied();
    if (stats.isDirectory()) return directoryIdentity(stats);
    if (stats.isFile()) return fileIdentity(stats);
    throw directoryDenied();
  } catch (error: unknown) {
    if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
    throw directoryDenied();
  }
}

function directoryIdentity(stats: BigIntStats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino, type: "directory" };
}

function fileIdentity(stats: BigIntStats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino, type: "regular-file" };
}

function existingFileIdentity(stats: BigIntStats): ExistingFileIdentity {
  return {
    ...fileIdentity(stats),
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    mode: stats.mode,
  };
}

function existingFileIdentityIfRegular(
  stats: BigIntStats,
): ExistingFileIdentity | undefined {
  return stats.isFile() && !stats.isSymbolicLink()
    ? existingFileIdentity(stats)
    : undefined;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev && left.ino === right.ino && left.type === right.type
  );
}

function sameExistingIdentity(
  left: ExistingFileIdentity,
  right: ExistingFileIdentity,
): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mode === right.mode
  );
}

function isContained(rootPath: string, candidatePath: string): boolean {
  const candidateRelativePath = relative(rootPath, candidatePath);
  return (
    candidateRelativePath === "" ||
    (!candidateRelativePath.startsWith(`..${sep}`) &&
      candidateRelativePath !== ".." &&
      !isAbsolute(candidateRelativePath))
  );
}

function isGitMetadataPath(state: ScopeState, candidatePath: string): boolean {
  if (candidatePath === state.gitDirectoryPath) return true;
  const relativePath = relative(state.rootPath, candidatePath);
  return (
    relativePath === ".git" ||
    relativePath.startsWith(`.git${sep}`) ||
    relativePath.split(sep).some((part) => part === ".git")
  );
}

function toDisplayPath(rootPath: string, absolutePath: string): string {
  const value = relative(rootPath, absolutePath).split(sep).join("/");
  return value.length === 0 ? "." : value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readErrnoCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null) return undefined;
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function isWithinSelectedDirectory(
  selectedPath: string,
  candidatePath: string,
): boolean {
  if (selectedPath === ".") return true;
  return (
    candidatePath === selectedPath ||
    candidatePath.startsWith(`${selectedPath}/`)
  );
}

function splitNulDelimited(stdout: Buffer): string[] {
  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < stdout.length; index += 1) {
    if (stdout[index] !== 0) continue;
    const value = stdout.subarray(start, index);
    if (value.length === 0) throw directoryDenied();
    if (!isUtf8(value)) throw directoryDenied();
    paths.push(value.toString("utf8"));
    start = index + 1;
  }
  if (start !== stdout.length) throw directoryDenied();
  return paths;
}

function validateGitPath(rawPath: string): string {
  if (
    rawPath.length === 0 ||
    Buffer.byteLength(rawPath, "utf8") > MAX_DIRECTORY_BYTES ||
    containsControlCharacter(rawPath) ||
    rawPath.includes("\\") ||
    rawPath.split("/").some((part) => part === ".." || part === ".git") ||
    isUnsafePathSyntax(rawPath) ||
    isAbsolute(rawPath)
  ) {
    throw directoryDenied();
  }
  const normalized = pathPosix.normalize(rawPath);
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw directoryDenied();
  }
  return normalized;
}
