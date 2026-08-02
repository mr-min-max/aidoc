import { promises as fs } from "node:fs";
import { isAbsolute, posix, resolve, relative, sep } from "node:path";
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
    const absolute = await safeExistingAbsolutePath(root, path);
    if (absolute === undefined) continue;
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const content = await fs.readFile(absolute, "utf8");
      files.push({ path, content });
    } catch {
      // Documentation files are optional. A file disappearing during a plan
      // should not expose the underlying path/error or abort source analysis.
    }
  }
  return files;
}

async function markdownFilesUnder(
  root: string,
  directory: string,
): Promise<string[]> {
  const absolute = await safeExistingAbsolutePath(root, directory);
  if (absolute === undefined) return [];
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
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(absolute);
  } catch {
    return [];
  }
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
): Promise<string | undefined> {
  const absolute = safeAbsolutePath(root, path);
  if (absolute === undefined) return undefined;
  const absoluteRoot = resolve(root);
  let current = absoluteRoot;
  try {
    for (const component of relative(absoluteRoot, absolute).split(sep)) {
      if (component.length === 0) continue;
      current = resolve(current, component);
      if ((await fs.lstat(current)).isSymbolicLink()) return undefined;
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
      ? absolute
      : undefined;
  } catch {
    return undefined;
  }
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
