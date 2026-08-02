import { execFile as execFileCallback } from "node:child_process";
import { promises as fs, type BigIntStats } from "node:fs";
import { isAbsolute, posix, resolve, relative, sep } from "node:path";
import { promisify } from "node:util";
import { loadPlanningConfig } from "../config/planning";
import { GitSnapshotReader, type SnapshotFileChange } from "../git/snapshot";
import { getSnapshotParserForFile } from "../parsers/registry";
import { buildImpactContext } from "./context";
import {
  digestImpactPayload,
  compareSnapshots,
  summarizeImpact,
} from "./compare";
import {
  mapDocumentationImpact,
  type DocumentationFile,
} from "./documentation";
import {
  IMPACT_PLAN_SCHEMA_VERSION,
  PlanFailure,
  type ImpactPlan,
  type ImpactPlanningResult,
  type ParserModuleSnapshot,
} from "./types";

export interface ImpactPlanOptions {
  cwd?: string;
  base?: string;
  head?: string;
  maxContextBytes?: unknown;
}

interface ValidatedExistingPath {
  absolute: string;
  stat: BigIntStats;
  parentAbsolute: string;
  parentIdentity: FilesystemIdentity;
}

interface FilesystemIdentity {
  dev: string;
  ino: string;
  type: string;
}

const execFile = promisify(execFileCallback);
const DOCUMENTATION_READ_TIMEOUT_MS = 5_000;
const DOCUMENTATION_READ_MAX_BUFFER = 10 * 1024 * 1024;
const DOCUMENTATION_READER_SCRIPT = String.raw`
const fs = require("node:fs");
const [
  leaf,
  expectedParentDev,
  expectedParentIno,
  expectedParentType,
  expectedLeafDev,
  expectedLeafIno,
  expectedLeafType,
] = process.argv.slice(1);
let descriptor;

function identity(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    type: (stat.mode & 0o170000n).toString(),
  };
}

function sameSnapshot(left, right) {
  const leftIdentity = identity(left);
  const rightIdentity = identity(right);
  return leftIdentity.dev === rightIdentity.dev &&
    leftIdentity.ino === rightIdentity.ino &&
    leftIdentity.type === rightIdentity.type &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

try {
  if (typeof leaf !== "string" || leaf.length === 0 || leaf === "." ||
      leaf === ".." || leaf.includes("/") || leaf.includes("\\") ||
      leaf.includes("\0")) throw new Error();
  const parent = fs.lstatSync(".", { bigint: true });
  const parentIdentity = identity(parent);
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      parentIdentity.dev !== expectedParentDev ||
      parentIdentity.ino !== expectedParentIno ||
      parentIdentity.type !== expectedParentType) throw new Error();
  descriptor = fs.openSync(
    leaf,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  const before = fs.fstatSync(descriptor, { bigint: true });
  const beforeIdentity = identity(before);
  if (!before.isFile() || before.isSymbolicLink() ||
      beforeIdentity.dev !== expectedLeafDev ||
      beforeIdentity.ino !== expectedLeafIno ||
      beforeIdentity.type !== expectedLeafType) throw new Error();
  const content = fs.readFileSync(descriptor, { encoding: "utf8" });
  const after = fs.fstatSync(descriptor, { bigint: true });
  if (!sameSnapshot(before, after)) throw new Error();
  process.stdout.write(JSON.stringify({ ok: true, content }));
} catch {
  process.stdout.write('{"ok":false}');
} finally {
  if (descriptor !== undefined) {
    try { fs.closeSync(descriptor); } catch {}
  }
}
`;

/**
 * Builds the value-free impact plan shared by CLI, MCP, and update flows.
 * Provider construction and command context loading intentionally do not
 * belong here: this function is deterministic and AST-only.
 */
export async function createImpactPlan(
  options: ImpactPlanOptions = {},
): Promise<ImpactPlanningResult> {
  const cwd = options.cwd ?? process.cwd();
  let config;
  try {
    config = loadPlanningConfig(cwd, options.maxContextBytes);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === "PLAN_INVALID_CONTEXT_BUDGET"
    ) {
      throw new PlanFailure(
        "PLAN_INVALID_CONTEXT_BUDGET",
        "The provider context byte budget is invalid.",
      );
    }
    throw new PlanFailure(
      "PLAN_SOURCE_READ_FAILED",
      "Unable to read planning configuration.",
    );
  }

  const snapshotSet = await new GitSnapshotReader(cwd).read({
    base: options.base,
    head: options.head,
    include: config.include,
    exclude: config.exclude,
  });
  const { root, base, head, ignored } = snapshotSet;
  const sourceFiles = snapshotSet.files;
  const parsed = await snapshotChangedSources(sourceFiles).finally(() => {
    sourceFiles.length = 0;
  });
  const changes = compareSnapshots(parsed);
  const documentationFiles = await loadDocumentationFiles(
    root,
    config.outputDir,
    config.exclude,
  );
  const documentation = mapDocumentationImpact(changes, documentationFiles);
  const summary = summarizeImpact(changes, documentation);
  const digest = digestImpactPayload({
    base,
    head,
    summary,
    changes,
    documentation,
    ignored,
  });
  const context = buildImpactContext({
    impactDigest: digest,
    summary,
    changes,
    documentation,
    maxBytes: config.maxContextBytes,
  });
  const plan: ImpactPlan = {
    schemaVersion: IMPACT_PLAN_SCHEMA_VERSION,
    base,
    head,
    summary,
    changes,
    documentation,
    context: context.report,
    ignored,
    digest,
  };
  return { plan, providerContext: context.providerContext };
}

async function snapshotChangedSources(files: SnapshotFileChange[]): Promise<
  {
    status: SnapshotFileChange["status"];
    beforePath?: string;
    afterPath?: string;
    before?: ParserModuleSnapshot;
    after?: ParserModuleSnapshot;
  }[]
> {
  const parsed: {
    status: SnapshotFileChange["status"];
    beforePath?: string;
    afterPath?: string;
    before?: ParserModuleSnapshot;
    after?: ParserModuleSnapshot;
  }[] = [];

  for (const file of files) {
    if (!file.supported || file.excluded) continue;
    const before = await snapshotSource(file.beforePath, file.beforeSource);
    const after = await snapshotSource(file.afterPath, file.afterSource);
    if (before === undefined && after === undefined) continue;
    parsed.push({
      status: file.status,
      beforePath: file.beforePath,
      afterPath: file.afterPath,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    });
  }
  return parsed;
}

async function snapshotSource(
  filePath: string | undefined,
  source: string | undefined,
): Promise<ParserModuleSnapshot | undefined> {
  if (filePath === undefined || source === undefined) return undefined;
  const parser = getSnapshotParserForFile(filePath);
  if (parser === null) return undefined;
  try {
    return await parser.snapshot(filePath, source);
  } catch {
    throw new PlanFailure(
      "PLAN_PARSE_FAILED",
      "Unable to parse changed source.",
      filePath,
    );
  }
}

async function loadDocumentationFiles(
  root: string,
  configuredOutputDir: string,
  exclude: string[],
): Promise<DocumentationFile[]> {
  const candidates = new Set<string>(["README.md", "CHANGELOG.md"]);
  for (const directory of ["docs", normalizeOutputDir(configuredOutputDir)]) {
    if (directory === undefined) continue;
    for (const path of await markdownFilesUnder(root, directory)) {
      candidates.add(path);
    }
  }

  const files: DocumentationFile[] = [];
  for (const path of [...candidates].sort(compareStrings)) {
    if (matchesAny(path, exclude)) continue;
    const content = await readSafeDocumentationFile(root, path);
    if (content !== undefined) files.push({ path, content });
  }
  return files;
}

async function readSafeDocumentationFile(
  root: string,
  path: string,
): Promise<string | undefined> {
  const validated = await safeExistingAbsolutePath(root, path);
  if (validated === undefined) return undefined;
  const leafIdentity = filesystemIdentity(validated.stat);
  try {
    const result = await execFile(
      process.execPath,
      [
        "-e",
        DOCUMENTATION_READER_SCRIPT,
        "--",
        posix.basename(path),
        validated.parentIdentity.dev,
        validated.parentIdentity.ino,
        validated.parentIdentity.type,
        leafIdentity.dev,
        leafIdentity.ino,
        leafIdentity.type,
      ],
      {
        cwd: validated.parentAbsolute,
        encoding: "utf8",
        timeout: DOCUMENTATION_READ_TIMEOUT_MS,
        maxBuffer: DOCUMENTATION_READ_MAX_BUFFER,
        windowsHide: true,
      },
    );
    return parseDocumentationRead(result.stdout);
  } catch {
    // Documentation files are optional. A file disappearing during a plan
    // should not expose the underlying path/error or abort source analysis.
    return undefined;
  }
}

function parseDocumentationRead(value: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return undefined;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  return record.ok === true &&
    typeof record.content === "string" &&
    keys.length === 2 &&
    keys.includes("ok") &&
    keys.includes("content")
    ? record.content
    : undefined;
}

async function markdownFilesUnder(
  root: string,
  directory: string,
): Promise<string[]> {
  const validated = await safeExistingAbsolutePath(root, directory);
  if (validated === undefined) return [];
  const { absolute } = validated;
  const result: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) =>
      compareStrings(a.name, b.name),
    )) {
      const child = resolve(current, entry.name);
      const childRelative = relative(root, child).split(sep).join("/");
      if (!isSafeRelativePath(childRelative)) continue;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(child);
      } else if (
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        childRelative.toLowerCase().endsWith(".md")
      ) {
        result.push(childRelative);
      }
    }
  };
  if (validated.stat.isDirectory() && !validated.stat.isSymbolicLink())
    await walk(absolute);
  return result;
}

function normalizeOutputDir(value: string): string | undefined {
  const slash = value.replaceAll("\\", "/");
  if (slash.startsWith("/") || /^[A-Za-z]:\//u.test(slash)) return undefined;
  const normalized = posix.normalize(slash);
  if (!isSafeRelativePath(normalized)) return undefined;
  return normalized === "." ? undefined : normalized;
}

function safeAbsolutePath(root: string, path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  if (!isSafeRelativePath(normalized)) return undefined;
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, normalized);
  const relativePath = relative(absoluteRoot, absolute);
  if (
    relativePath.length > 0 &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".." &&
    !isAbsolute(relativePath)
  ) {
    return absolute;
  }
  return undefined;
}

async function safeExistingAbsolutePath(
  root: string,
  path: string,
): Promise<ValidatedExistingPath | undefined> {
  const absolute = safeAbsolutePath(root, path);
  if (absolute === undefined) return undefined;
  const absoluteRoot = resolve(root);
  let current = absoluteRoot;
  try {
    let stat = await fs.lstat(absoluteRoot, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    let parentAbsolute = absoluteRoot;
    let parentIdentity = filesystemIdentity(stat);
    const components = relative(absoluteRoot, absolute).split(sep);
    for (const [index, component] of components.entries()) {
      if (component.length === 0) continue;
      current = resolve(current, component);
      stat = await fs.lstat(current, { bigint: true });
      if (stat.isSymbolicLink()) return undefined;
      if (index < components.length - 1) {
        if (!stat.isDirectory()) return undefined;
        parentAbsolute = current;
        parentIdentity = filesystemIdentity(stat);
      }
    }
    const [realRoot, realPath] = await Promise.all([
      fs.realpath(absoluteRoot),
      fs.realpath(absolute),
    ]);
    const realRelative = relative(realRoot, realPath);
    return realRelative.length === 0 ||
      (!realRelative.startsWith(`..${sep}`) &&
        realRelative !== ".." &&
        !isAbsolute(realRelative))
      ? { absolute, stat, parentAbsolute, parentIdentity }
      : undefined;
  } catch {
    return undefined;
  }
}

function filesystemIdentity(stat: BigIntStats): FilesystemIdentity {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    type: (stat.mode & 0o170000n).toString(),
  };
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes("\0") || path.startsWith("/"))
    return false;
  const normalized = posix.normalize(path);
  return (
    normalized !== "." && normalized !== ".." && !normalized.startsWith("../")
  );
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => posix.matchesGlob(path, pattern));
}
