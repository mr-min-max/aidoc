import { execFile as execFileCallback } from "node:child_process";
import { promises as fs, type BigIntStats } from "node:fs";
import { isAbsolute, posix, resolve, relative, sep } from "node:path";
import { promisify } from "node:util";
import {
  loadSuppressions,
  matchingSuppression,
  type SuppressionConfig,
  type SuppressedChange,
} from "../config/suppressions";
import {
  loadPlanningConfig,
  parseContextBudget,
  parsePlanningConfig,
  type PlanningConfig,
} from "../config/planning";
import { GitSnapshotReader, type SnapshotFileChange } from "../git/snapshot";
import { getSnapshotParserForFile } from "../parsers/registry";
import {
  diffBoundaries,
  resolveBoundary,
  resolvePythonBoundary,
  type BoundaryFlip,
  type ResolvedBoundary,
} from "./boundary";
import { buildImpactContext } from "./context";
import {
  createChange,
  digestImpactPayload,
  compareSnapshots,
  summarizeImpact,
  type ParsedFileSnapshots,
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
  type LanguageBoundaryReport,
  type ParserModuleSnapshot,
  type ParserSymbolSnapshot,
  type SymbolChange,
} from "./types";

export interface ImpactPlanOptions {
  cwd?: string;
  base?: string;
  head?: string;
  maxContextBytes?: unknown;
  readonly planningConfig?: Readonly<PlanningConfig>;
  readonly suppressions?: Readonly<SuppressionConfig>;
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

interface LanguageBoundaryResolution {
  report: LanguageBoundaryReport;
  base: ResolvedBoundary;
  head: ResolvedBoundary;
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
    if (options.planningConfig !== undefined) {
      config = parsePlanningConfig(options.planningConfig);
      if (options.maxContextBytes !== undefined) {
        config.maxContextBytes = parseContextBudget(options.maxContextBytes);
      }
    } else {
      config = loadPlanningConfig(cwd, options.maxContextBytes);
    }
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

  const reader = new GitSnapshotReader(cwd);
  const snapshotSet = await reader.read({
    base: options.base,
    head: options.head,
    include: config.include,
    exclude: config.exclude,
  });
  const { root, base, head, ignored } = snapshotSet;
  const sourceFiles = snapshotSet.files;
  const unsupportedNotAnalyzed = sourceFiles.flatMap((file) => {
    if (file.analysis !== "unsupported") return [];
    const path = file.afterPath ?? file.beforePath;
    // Markdown is read as documentation, so naming it "not analyzed" would
    // contradict the documentation rows in the same report.
    if (path === undefined || /\.md$/iu.test(path)) return [];
    return [{ path, reason: "unsupported" as const }];
  });
  const hasTypeScriptChanges = sourceFiles.some(
    (file) =>
      file.supported &&
      !file.excluded &&
      isTypeScriptPath(file.afterPath ?? file.beforePath),
  );
  const hasPythonChanges = sourceFiles.some(
    (file) =>
      file.supported &&
      !file.excluded &&
      isPythonPath(file.afterPath ?? file.beforePath),
  );
  const parsed = await snapshotChangedSources(sourceFiles);
  const commonJsNotAnalyzed = sourceFiles.flatMap((file) => {
    if (file.analysis !== "commonjs") return [];
    const path = file.afterPath ?? file.beforePath;
    return path === undefined ? [] : [{ path, reason: "commonjs" as const }];
  });
  const boundaryFiles = sourceFiles.map((file) => ({
    status: file.status,
    beforePath: file.beforePath,
    afterPath: file.afterPath,
  }));
  sourceFiles.length = 0;
  let allChanges = compareSnapshots(parsed);
  const [typeScriptBoundary, pythonBoundary] = await Promise.all([
    hasTypeScriptChanges
      ? resolveTypeScriptBoundary(reader, config.entry)
      : undefined,
    hasPythonChanges
      ? resolveProjectPythonBoundary(reader, config.entry)
      : undefined,
  ]);
  if (typeScriptBoundary !== undefined) {
    allChanges = await applyBoundary(
      allChanges,
      parsed,
      boundaryFiles,
      typeScriptBoundary,
      reader,
      "typescript",
    );
  }
  if (pythonBoundary !== undefined) {
    allChanges = await applyBoundary(
      allChanges,
      parsed,
      boundaryFiles,
      pythonBoundary,
      reader,
      "python",
    );
  }
  const suppressions = options.suppressions ?? (await loadSuppressions(root));
  const suppressed: SuppressedChange[] = [];
  const changes = allChanges.filter((change) => {
    const symbolPattern =
      change.qualifiedName === undefined
        ? undefined
        : matchingSuppression(change.qualifiedName, suppressions.symbols);
    const sourcePattern = matchingSuppression(
      change.path,
      suppressions.sourcePaths,
    );
    const pattern = symbolPattern ?? sourcePattern;
    if (pattern === undefined) return true;
    suppressed.push({
      symbol: change.qualifiedName ?? change.path,
      reason: pattern,
    });
    return false;
  });
  const documentationFiles = await loadDocumentationFiles(
    root,
    config.outputDir,
    config.exclude,
  );
  const filteredDocumentationFiles = documentationFiles.filter(
    (file) =>
      matchingSuppression(file.path, suppressions.docPaths) === undefined,
  );
  const documentation = mapDocumentationImpact(
    changes,
    filteredDocumentationFiles,
  );
  const summary = summarizeImpact(changes, documentation);
  const notAnalyzed = [...unsupportedNotAnalyzed, ...commonJsNotAnalyzed]
    .sort(
      (left, right) =>
        compareStrings(left.path, right.path) ||
        compareStrings(left.reason, right.reason),
    )
    .filter(
      (item, index, values) =>
        index === 0 ||
        item.path !== values[index - 1]?.path ||
        item.reason !== values[index - 1]?.reason,
    )
    .slice(0, 50);
  const planIgnored = {
    ...ignored,
    suppressed: suppressed.length,
    ...(notAnalyzed.length === 0 ? {} : { notAnalyzed }),
  };
  const digest = digestImpactPayload({
    base,
    head,
    summary,
    changes,
    documentation,
    ignored: planIgnored,
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
    ignored: planIgnored,
    ...(typeScriptBoundary === undefined && pythonBoundary === undefined
      ? {}
      : {
          boundary: {
            ...(typeScriptBoundary === undefined
              ? {}
              : { typescript: typeScriptBoundary.report }),
            ...(pythonBoundary === undefined
              ? {}
              : { python: pythonBoundary.report }),
          },
        }),
    digest,
  };
  return { plan, providerContext: context.providerContext, suppressed };
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
    const commonJsPath = [
      { path: file.beforePath, snapshot: before },
      { path: file.afterPath, snapshot: after },
    ].find(
      ({ path, snapshot }) =>
        path !== undefined &&
        isJavaScriptPath(path) &&
        snapshot?.moduleSystem === "commonjs" &&
        snapshot.symbols.length === 0,
    )?.path;
    if (commonJsPath !== undefined) file.analysis = "commonjs";
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
  strict = true,
): Promise<ParserModuleSnapshot | undefined> {
  if (filePath === undefined || source === undefined) return undefined;
  const parser = getSnapshotParserForFile(filePath);
  if (parser === null) return undefined;
  try {
    return await parser.snapshot(filePath, source);
  } catch {
    if (!strict) return undefined;
    throw new PlanFailure(
      "PLAN_PARSE_FAILED",
      "Unable to parse changed source.",
      filePath,
    );
  }
}

async function resolveTypeScriptBoundary(
  reader: GitSnapshotReader,
  configuredEntries: readonly string[] | undefined,
): Promise<LanguageBoundaryResolution> {
  const [baseBoundary, headBoundary] = await Promise.all(
    (["base", "head"] as const).map((revision) =>
      resolveBoundary({
        readFile: (path) => reader.readAt(revision, path),
        listPackageJson: () => reader.listPackageManifests(revision),
        snapshot: (path, source) => snapshotSource(path, source, false),
        ...(configuredEntries === undefined ? {} : { configuredEntries }),
      }),
    ),
  );
  return mergeBoundaryReports(baseBoundary, headBoundary);
}

async function resolveProjectPythonBoundary(
  reader: GitSnapshotReader,
  configuredEntries: readonly string[] | undefined,
): Promise<LanguageBoundaryResolution> {
  const pythonEntries = configuredEntries?.filter((path) =>
    path.endsWith("__init__.py"),
  );
  const [baseBoundary, headBoundary] = await Promise.all(
    (["base", "head"] as const).map((revision) =>
      resolvePythonBoundary({
        readFile: (path) => reader.readAt(revision, path),
        listPackageEntries: () => reader.listPythonPackageEntries(revision),
        snapshot: (path, source) => snapshotSource(path, source, false),
        ...(pythonEntries === undefined || pythonEntries.length === 0
          ? {}
          : { configuredEntries: pythonEntries }),
      }),
    ),
  );
  return mergeBoundaryReports(baseBoundary, headBoundary);
}

function mergeBoundaryReports(
  baseBoundary: ResolvedBoundary,
  headBoundary: ResolvedBoundary,
): LanguageBoundaryResolution {
  const entryMode =
    baseBoundary.report.mode === "entry" &&
    headBoundary.report.mode === "entry";
  const fallbackReport =
    baseBoundary.report.mode === "fallback"
      ? baseBoundary.report
      : headBoundary.report;
  return {
    report: entryMode
      ? {
          mode: "entry",
          entries: [
            ...new Set([
              ...baseBoundary.report.entries,
              ...headBoundary.report.entries,
            ]),
          ].sort(compareStrings),
          filesRead:
            baseBoundary.report.filesRead + headBoundary.report.filesRead,
        }
      : {
          mode: "fallback",
          entries: [],
          reason:
            fallbackReport.mode === "fallback"
              ? fallbackReport.reason
              : "entry-not-found",
          filesRead:
            baseBoundary.report.filesRead + headBoundary.report.filesRead,
        },
    base: baseBoundary,
    head: headBoundary,
  };
}
async function applyBoundary(
  changes: SymbolChange[],
  files: ParsedFileSnapshots[],
  boundaryFiles: Pick<
    ParsedFileSnapshots,
    "status" | "beforePath" | "afterPath"
  >[],
  boundary: LanguageBoundaryResolution,
  reader: GitSnapshotReader,
  language: "typescript" | "python",
): Promise<SymbolChange[]> {
  if (boundary.report.mode !== "entry") return changes;
  const paths = new Map<string, { beforePath?: string; afterPath?: string }>();
  for (const file of files) {
    for (const symbol of file.before?.symbols ?? []) {
      paths.set(snapshotSymbolId(file.beforePath, symbol), {
        beforePath: file.beforePath,
        afterPath: file.afterPath,
      });
    }
    for (const symbol of file.after?.symbols ?? []) {
      paths.set(snapshotSymbolId(file.afterPath, symbol), {
        beforePath: file.beforePath,
        afterPath: file.afterPath,
      });
    }
  }
  const tagged = changes.map((change) => {
    if (
      change.scope !== "symbol" ||
      change.language !== language ||
      change.qualifiedName === undefined
    ) {
      return change;
    }
    const endpoints = [change.beforeId, change.afterId, change.id]
      .filter((id): id is string => id !== undefined)
      .map((id) => paths.get(id))
      .find((value) => value !== undefined);
    const name = rootName(change.qualifiedName);
    const beforePath = endpoints?.beforePath ?? change.path;
    const afterPath = endpoints?.afterPath ?? change.path;
    const privatePythonPath =
      language === "python" && isPrivatePythonPath(change.path);
    const isPublic =
      !privatePythonPath &&
      (boundary.base.reachable.get(beforePath)?.has(name) === true ||
        boundary.head.reachable.get(afterPath)?.has(name) === true);
    return {
      ...change,
      visibility: isPublic ? ("public" as const) : ("internal" as const),
    };
  });

  const addedOrDeletedFiles = new Set(
    boundaryFiles
      .filter((file) => file.status === "added" || file.status === "deleted")
      .flatMap((file) => [file.beforePath, file.afterPath])
      .filter((path): path is string => path !== undefined),
  );
  const changedSymbols = new Set(
    tagged
      .filter(
        (change) =>
          change.language === language &&
          change.scope === "symbol" &&
          change.qualifiedName !== undefined &&
          (change.category === "added" ||
            change.category === "removed" ||
            change.category === "moved" ||
            change.category === "contract-changed"),
      )
      .map((change) => `${change.path}\0${rootName(change.qualifiedName!)}`),
  );
  const flips = diffBoundaries(boundary.base, boundary.head).filter(
    (flip) =>
      !addedOrDeletedFiles.has(flip.path) &&
      !changedSymbols.has(`${flip.path}\0${flip.localName}`),
  );
  const flipChanges = await snapshotBoundaryFlips(flips, reader, language);
  return [...tagged, ...flipChanges].sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.kind, right.kind) ||
      compareStrings(left.qualifiedName ?? "", right.qualifiedName ?? "") ||
      compareStrings(left.category, right.category) ||
      compareStrings(left.id, right.id),
  );
}

async function snapshotBoundaryFlips(
  flips: BoundaryFlip[],
  reader: GitSnapshotReader,
  language: "typescript" | "python",
): Promise<SymbolChange[]> {
  const changes: SymbolChange[] = [];
  for (const flip of flips) {
    const revision = flip.kind === "exposed" ? "head" : "base";
    const source = await reader.readAt(revision, flip.path);
    const snapshot = await snapshotSource(flip.path, source);
    if (snapshot === undefined || snapshot.language !== language) continue;
    for (const symbol of snapshot.symbols.filter(
      ({ qualifiedName }) => rootName(qualifiedName) === flip.localName,
    )) {
      const value = {
        scope: "symbol" as const,
        category: flip.kind,
        risk:
          flip.kind === "hidden"
            ? ("potentially-breaking" as const)
            : ("informational" as const),
        language: symbol.language,
        path: flip.path,
        kind: symbol.kind,
        qualifiedName: symbol.qualifiedName,
        ...(flip.kind === "exposed"
          ? { after: symbol.signature }
          : { before: symbol.signature }),
        ...(symbol.arity === undefined ? {} : { arity: symbol.arity }),
        visibility: "public" as const,
      };
      changes.push(createChange(value));
    }
  }
  return changes;
}

function rootName(qualifiedName: string): string {
  return qualifiedName.split(".", 1)[0]!;
}

function snapshotSymbolId(
  path: string | undefined,
  symbol: ParserSymbolSnapshot,
): string {
  return `${symbol.language}:${path ?? ""}#${symbol.kind}:${symbol.qualifiedName}`;
}

function isPrivatePythonPath(path: string): boolean {
  return path.split("/").some((segment) => {
    if (segment === "__init__.py" || segment === "__main__.py") return false;
    const name = segment.endsWith(".py") ? segment.slice(0, -3) : segment;
    return name.startsWith("_");
  });
}

function isPythonPath(path: string | undefined): boolean {
  return path !== undefined && path.endsWith(".py");
}

function isTypeScriptPath(path: string | undefined): boolean {
  return (
    path !== undefined && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(path)
  );
}

function isJavaScriptPath(path: string): boolean {
  return /\.(?:js|jsx|mjs|cjs)$/u.test(path);
}

async function loadDocumentationFiles(
  root: string,
  configuredOutputDir: string,
  exclude: string[],
): Promise<DocumentationFile[]> {
  const candidates = new Set<string>(await rootMarkdownFiles(root));
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

/** Returns the repository-relative README path as it exists on disk, if any. */
export async function discoverReadme(
  root: string,
): Promise<string | undefined> {
  const files = await rootMarkdownFiles(root);
  return files.find((file) => file.toLowerCase() === "readme.md");
}

async function rootMarkdownFiles(root: string): Promise<string[]> {
  let entries;
  try {
    const rootStat = await fs.lstat(root, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .sort((left, right) => compareStrings(left.name, right.name))
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        (entry.name.toLowerCase() === "readme.md" ||
          entry.name.toLowerCase() === "changelog.md") &&
        isSafeRelativePath(entry.name),
    )
    .map((entry) => entry.name);
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
