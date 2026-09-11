import { posix } from "node:path";
import { z } from "zod";

import type { LanguageBoundaryReport, ParserModuleSnapshot } from "./types";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEPTH = 12;
const MAX_PACKAGE_MANIFESTS = 50;
const MAX_PYTHON_PACKAGE_ENTRIES = 20;
const SUPPORTED_EXTENSIONS = [
  ".d.ts",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;
const PROBE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;
const BUILD_DIRECTORIES: Readonly<Record<string, true>> = {
  dist: true,
  build: true,
  lib: true,
  distribution: true,
  out: true,
  esm: true,
  cjs: true,
  types: true,
};
const SOURCE_DIRECTORIES = ["src", "source", "lib"] as const;
const EXPORT_CONDITIONS = ["types", "import", "default", "require"] as const;
const UNKNOWN_OBJECT_SCHEMA = z.record(z.string(), z.unknown());

export interface BoundaryInput {
  readFile(path: string): Promise<string | undefined>;
  listPackageJson(): Promise<string[]>;
  snapshot(
    path: string,
    source: string,
  ): Promise<ParserModuleSnapshot | undefined>;
  configuredEntries?: readonly string[];
  limits?: { maxFiles?: number; maxDepth?: number };
}

export interface PythonBoundaryInput {
  readFile(path: string): Promise<string | undefined>;
  listPackageEntries(): Promise<string[]>;
  snapshot(
    path: string,
    source: string,
  ): Promise<ParserModuleSnapshot | undefined>;
  configuredEntries?: readonly string[];
  limits?: { maxFiles?: number; maxDepth?: number };
}

export interface ResolvedBoundary {
  report: LanguageBoundaryReport;
  reachable: Map<string, Set<string>>;
}

export interface BoundaryFlip {
  path: string;
  localName: string;
  kind: "exposed" | "hidden";
}

/** Diffs two fully resolved public surfaces in stable declaration order. */
export function diffBoundaries(
  base: ResolvedBoundary,
  head: ResolvedBoundary,
): BoundaryFlip[] {
  if (base.report.mode !== "entry" || head.report.mode !== "entry") return [];
  const flips: BoundaryFlip[] = [];
  for (const [path, names] of head.reachable) {
    const previous = base.reachable.get(path);
    for (const localName of names) {
      if (previous?.has(localName) !== true) {
        flips.push({ path, localName, kind: "exposed" });
      }
    }
  }
  for (const [path, names] of base.reachable) {
    const current = head.reachable.get(path);
    for (const localName of names) {
      if (current?.has(localName) !== true) {
        flips.push({ path, localName, kind: "hidden" });
      }
    }
  }
  return flips.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.localName, right.localName) ||
      compareStrings(left.kind, right.kind),
  );
}

type BoundaryReason = NonNullable<LanguageBoundaryReport["reason"]>;
type QueueSelection =
  | { kind: "entry-all" | "star-all" | "namespace" }
  | { kind: "names"; names: string[] };
interface QueueItem {
  path: string;
  depth: number;
  selection: QueueSelection;
}
interface PackageRecord {
  path: string;
  value: Record<string, unknown>;
}

class BoundaryLimitExceeded extends Error {}

/** Resolves the TypeScript/JavaScript public surface from package entries. */
export async function resolveBoundary(
  input: BoundaryInput,
): Promise<ResolvedBoundary> {
  const maxFiles = positiveLimit(input.limits?.maxFiles, DEFAULT_MAX_FILES);
  const maxDepth = positiveLimit(input.limits?.maxDepth, DEFAULT_MAX_DEPTH);
  const sourceCache = new Map<string, string | undefined>();
  let filesRead = 0;

  const readFile = async (path: string): Promise<string | undefined> => {
    const normalized = normalizeRepositoryPath(path);
    if (normalized === undefined) return undefined;
    if (sourceCache.has(normalized)) return sourceCache.get(normalized);
    if (filesRead >= maxFiles) throw new BoundaryLimitExceeded();
    filesRead += 1;
    const source = await input.readFile(normalized);
    sourceCache.set(normalized, source);
    return source;
  };

  try {
    const discovered = await discoverEntries(input, readFile);
    if (discovered.reason !== undefined) {
      return fallback(discovered.reason, filesRead);
    }

    const entries = [...new Set(discovered.entries)].sort(compareStrings);
    const reachable = new Map<string, Set<string>>();
    const queue: QueueItem[] = entries.map((path) => ({
      path,
      depth: 0,
      selection: { kind: "entry-all" },
    }));
    const bestDepth = new Map<string, number>();

    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]!;
      if (item.depth > maxDepth) throw new BoundaryLimitExceeded();
      const stateKey = selectionKey(item.path, item.selection);
      const previousDepth = bestDepth.get(stateKey);
      if (previousDepth !== undefined && previousDepth <= item.depth) continue;
      bestDepth.set(stateKey, item.depth);

      const source = await readFile(item.path);
      if (source === undefined) continue;
      const snapshot = await input.snapshot(item.path, source);
      if (snapshot === undefined || snapshot.language !== "typescript")
        continue;

      const localNames = new Set(
        snapshot.symbols.map(({ qualifiedName }) => rootName(qualifiedName)),
      );
      const exportNames = new Map(
        (
          snapshot.exports ??
          [...localNames].map((name) => ({
            exported: name,
            symbol: name,
          }))
        ).map(({ exported, symbol }) => [exported, symbol]),
      );
      const visibleNames = reachable.get(item.path) ?? new Set<string>();
      switch (item.selection.kind) {
        case "entry-all":
        case "namespace":
          for (const name of localNames) visibleNames.add(name);
          break;
        case "star-all":
          for (const [exported, symbol] of exportNames) {
            if (exported !== "default") visibleNames.add(symbol);
          }
          break;
        case "names":
          for (const name of item.selection.names) {
            const symbol = exportNames.get(name);
            if (symbol !== undefined) visibleNames.add(symbol);
          }
          break;
      }
      if (visibleNames.size > 0) reachable.set(item.path, visibleNames);
      if (item.selection.kind === "namespace") continue;

      for (const edge of snapshot.reexports ?? []) {
        const target = await resolveReexport(
          item.path,
          edge.specifier,
          readFile,
        );
        if (target === undefined) continue;
        if (item.depth >= maxDepth) throw new BoundaryLimitExceeded();

        if (edge.names === undefined) {
          if (item.selection.kind === "names") {
            const names = item.selection.names.filter(
              (name) => name !== "default",
            );
            if (names.length > 0) {
              queue.push({
                path: target,
                depth: item.depth + 1,
                selection: { kind: "names", names },
              });
            }
          } else {
            queue.push({
              path: target,
              depth: item.depth + 1,
              selection: { kind: "star-all" },
            });
          }
          continue;
        }

        const selected =
          item.selection.kind === "names"
            ? new Set(item.selection.names)
            : undefined;
        for (const name of edge.names) {
          const exposed =
            item.selection.kind === "entry-all" ||
            (item.selection.kind === "star-all" &&
              name.exported !== "default") ||
            (selected !== undefined && selected.has(name.exported));
          if (!exposed) continue;
          queue.push({
            path: target,
            depth: item.depth + 1,
            selection:
              name.local === "*"
                ? { kind: "namespace" }
                : { kind: "names", names: [name.local] },
          });
        }
      }
    }

    return {
      report: { mode: "entry", entries, filesRead },
      reachable,
    };
  } catch (error) {
    if (error instanceof BoundaryLimitExceeded) {
      return fallback("limit-exceeded", filesRead);
    }
    throw error;
  }
}

/** Resolves Python reachability from root package initializers. */
export async function resolvePythonBoundary(
  input: PythonBoundaryInput,
): Promise<ResolvedBoundary> {
  const maxFiles = positiveLimit(input.limits?.maxFiles, DEFAULT_MAX_FILES);
  const maxDepth = Math.min(positiveLimit(input.limits?.maxDepth, 1), 1);
  const sourceCache = new Map<string, string | undefined>();
  let filesRead = 0;
  const readFile = async (path: string): Promise<string | undefined> => {
    const normalized = normalizeRepositoryPath(path);
    if (normalized === undefined) return undefined;
    if (sourceCache.has(normalized)) return sourceCache.get(normalized);
    if (filesRead >= maxFiles) throw new BoundaryLimitExceeded();
    filesRead += 1;
    const source = await input.readFile(normalized);
    sourceCache.set(normalized, source);
    return source;
  };

  try {
    const entries = await discoverPythonEntries(input, readFile);
    if (entries.reason !== undefined)
      return fallback(entries.reason, filesRead);
    const sortedEntries = [...new Set(entries.paths)].sort(compareStrings);
    const reachable = new Map<string, Set<string>>();
    const visited = new Set<string>();
    for (const path of sortedEntries) {
      await resolvePythonInitializer(
        path,
        0,
        maxDepth,
        undefined,
        readFile,
        input.snapshot,
        reachable,
        visited,
      );
    }
    return {
      report: { mode: "entry", entries: sortedEntries, filesRead },
      reachable,
    };
  } catch (error) {
    if (error instanceof BoundaryLimitExceeded) {
      return fallback("limit-exceeded", filesRead);
    }
    throw error;
  }
}

async function discoverPythonEntries(
  input: PythonBoundaryInput,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<{ paths: string[]; reason?: BoundaryReason }> {
  if ((input.configuredEntries?.length ?? 0) > 0) {
    const paths: string[] = [];
    for (const configured of input.configuredEntries ?? []) {
      const path = normalizeRepositoryPath(configured);
      if (
        path === undefined ||
        posix.basename(path) !== "__init__.py" ||
        (await readFile(path)) === undefined
      ) {
        return { paths: [], reason: "entry-not-found" };
      }
      paths.push(path);
    }
    return { paths };
  }

  const [pyproject, setupPy, setupCfg] = await Promise.all([
    readFile("pyproject.toml"),
    readFile("setup.py"),
    readFile("setup.cfg"),
  ]);
  const manifestPresent =
    pyproject !== undefined || setupPy !== undefined || setupCfg !== undefined;
  const configuration =
    pyproject === undefined
      ? { names: [], sourceRoots: ["", "src"] }
      : parsePythonProjectConfiguration(pyproject);
  const configuredPaths = configuration.names.flatMap((name) =>
    configuration.sourceRoots.map((root) =>
      root.length === 0 ? `${name}/__init__.py` : `${root}/${name}/__init__.py`,
    ),
  );
  if (configuredPaths.length > MAX_PYTHON_PACKAGE_ENTRIES) {
    throw new BoundaryLimitExceeded();
  }
  const resolvedConfigured: string[] = [];
  for (const path of configuredPaths) {
    if ((await readFile(path)) !== undefined) resolvedConfigured.push(path);
  }
  if (resolvedConfigured.length > 0) {
    return { paths: [...new Set(resolvedConfigured)].sort(compareStrings) };
  }

  const listed = await input.listPackageEntries();
  if (listed.length > MAX_PYTHON_PACKAGE_ENTRIES) {
    throw new BoundaryLimitExceeded();
  }
  const publicEntries = listed
    .map(normalizeRepositoryPath)
    .filter((path): path is string => path !== undefined)
    .filter((path) => !isPrivatePythonPath(path))
    .sort(compareStrings);
  const paths = publicEntries.filter((path) =>
    configuration.names.length === 0
      ? configuration.sourceRoots.some((root) =>
          root.length === 0
            ? path.split("/").length === 2
            : path.startsWith(`${root}/`) && path.split("/").length === 3,
        )
      : false,
  );
  if (paths.length > 0) return { paths };
  return {
    paths: [],
    reason: manifestPresent ? "entry-not-found" : "no-manifest",
  };
}

interface PythonProjectConfiguration {
  names: string[];
  sourceRoots: string[];
}

function parsePythonProjectConfiguration(
  source: string,
): PythonProjectConfiguration {
  if (Buffer.byteLength(source, "utf8") > 256 * 1024) {
    return { names: [], sourceRoots: ["", "src"] };
  }
  const names = new Set<string>();
  const sourceRoots = new Set<string>();
  let packageDirectoryConfigured = false;
  let section = "";
  let poetryPackage = false;
  for (const rawLine of source.split("\n").slice(0, 4000)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.startsWith("[[") && line.endsWith("]]")) {
      section = line;
      poetryPackage = section === "[[tool.poetry.packages]]";
      if (poetryPackage) packageDirectoryConfigured = true;
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line;
      poetryPackage = false;
      continue;
    }
    const keyValue = tomlKeyValue(line);
    if (keyValue === undefined) continue;
    const [key, value] = keyValue;
    if (section === "[project]" && key === "name") {
      const name = tomlString(value);
      if (name !== undefined) names.add(normalizePythonPackageName(name));
    } else if (section === "[tool.setuptools]" && key === "package-dir") {
      packageDirectoryConfigured = true;
      for (const root of tomlPackageDirectories(value)) sourceRoots.add(root);
    } else if (
      section === "[tool.setuptools.packages.find]" &&
      key === "where"
    ) {
      packageDirectoryConfigured = true;
      for (const root of tomlStringArray(value)) sourceRoots.add(root);
    } else if (section === "[tool.poetry]" && key === "packages") {
      packageDirectoryConfigured = true;
      for (const item of tomlPoetryPackages(value)) {
        names.add(normalizePythonPackageName(item.include));
        sourceRoots.add(item.from ?? "");
      }
    } else if (poetryPackage && key === "include") {
      const name = tomlString(value);
      if (name !== undefined) names.add(normalizePythonPackageName(name));
    } else if (poetryPackage && key === "from") {
      const root = tomlString(value);
      if (root !== undefined) sourceRoots.add(root);
    }
  }
  const roots = packageDirectoryConfigured ? [...sourceRoots] : ["", "src"];
  return {
    names: [...names].filter((name) => name.length > 0).sort(compareStrings),
    sourceRoots: roots
      .map((root) => root.replace(/^\.\//u, "").replace(/\/$/u, ""))
      .filter(
        (root) => root.length === 0 || normalizeRepositoryPath(root) === root,
      )
      .sort(compareStrings),
  };
}

function tomlKeyValue(line: string): [string, string] | undefined {
  const separator = line.indexOf("=");
  if (separator < 0) return undefined;
  const key = line.slice(0, separator).trim();
  const rawValue = line.slice(separator + 1).trim();
  return rawValue.length === 0 ? undefined : [key, rawValue];
}

function tomlString(value: string): string | undefined {
  const quote = value[0];
  if (
    value.length < 2 ||
    (quote !== '"' && quote !== "'") ||
    value[value.length - 1] !== quote
  ) {
    return undefined;
  }
  return value.slice(1, -1);
}

function tomlStringArray(value: string): string[] {
  const direct = tomlString(value);
  if (direct !== undefined) return [direct];
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => tomlString(item.trim()))
    .filter((item): item is string => item !== undefined);
}

function tomlPackageDirectories(value: string): string[] {
  const direct = tomlString(value);
  if (direct !== undefined) return [direct];
  if (!value.startsWith("{") || !value.endsWith("}")) return [];
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => tomlKeyValue(item.trim()))
    .filter((item): item is [string, string] => item !== undefined)
    .map(([, rawValue]) => tomlString(rawValue))
    .filter((item): item is string => item !== undefined);
}

function tomlPoetryPackages(
  value: string,
): Array<{ include: string; from?: string }> {
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const result: Array<{ include: string; from?: string }> = [];
  for (const table of tomlInlineTables(value.slice(1, -1))) {
    let include: string | undefined;
    let from: string | undefined;
    for (const field of table.split(",")) {
      const keyValue = tomlKeyValue(field.trim());
      if (keyValue === undefined) continue;
      const [key, rawValue] = keyValue;
      const parsed = tomlString(rawValue);
      if (key === "include") include = parsed;
      else if (key === "from") from = parsed;
    }
    if (include !== undefined) {
      result.push({ include, ...(from === undefined ? {} : { from }) });
    }
  }
  return result;
}

function tomlInlineTables(value: string): string[] {
  const tables: string[] = [];
  let start = -1;
  let quote = "";
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote.length > 0) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tables.push(value.slice(start, index));
        start = -1;
      }
    }
  }
  return depth === 0 && quote.length === 0 ? tables : [];
}

function normalizePythonPackageName(value: string): string {
  return value.replaceAll("-", "_").split(".", 1)[0] ?? "";
}

async function resolvePythonInitializer(
  path: string,
  depth: number,
  maxDepth: number,
  requestedNames: ReadonlySet<string> | undefined,
  readFile: (path: string) => Promise<string | undefined>,
  snapshotSource: (
    path: string,
    source: string,
  ) => Promise<ParserModuleSnapshot | undefined>,
  reachable: Map<string, Set<string>>,
  visited: Set<string>,
): Promise<void> {
  const visitKey = `${path}\0${
    requestedNames === undefined
      ? "all"
      : [...requestedNames].sort(compareStrings).join("\0")
  }`;
  if (visited.has(visitKey) || isPrivatePythonPath(path)) return;
  visited.add(visitKey);
  const source = await readFile(path);
  if (source === undefined) return;
  const snapshot = await snapshotSource(path, source);
  if (snapshot === undefined || snapshot.language !== "python") return;
  const localNames = new Set(
    snapshot.symbols.map(({ qualifiedName }) => rootName(qualifiedName)),
  );
  const selected =
    requestedNames ??
    (snapshot.dunderAll === undefined
      ? new Set([...localNames].filter((name) => !name.startsWith("_")))
      : new Set(snapshot.dunderAll));
  const localVisible = reachable.get(path) ?? new Set<string>();
  for (const name of selected) {
    if (localNames.has(name)) localVisible.add(name);
  }
  if (localVisible.size > 0) reachable.set(path, localVisible);

  const unconstrained =
    requestedNames === undefined && snapshot.dunderAll === undefined;
  for (const edge of snapshot.reexports ?? []) {
    const target = await resolvePythonReexport(path, edge.specifier, readFile);
    if (target === undefined || isPrivatePythonPath(target)) continue;
    const importedNames = new Set<string>();
    if (edge.names === undefined) {
      if (!unconstrained) {
        for (const name of selected) {
          if (!localNames.has(name)) importedNames.add(name);
        }
      }
    } else {
      for (const name of edge.names) {
        if (
          unconstrained
            ? !name.exported.startsWith("_")
            : selected.has(name.exported)
        ) {
          importedNames.add(name.local);
        }
      }
    }
    const starsAllPublic = edge.names === undefined && unconstrained;
    if (!starsAllPublic && importedNames.size === 0) continue;
    if (
      importedNames.size > 0 &&
      depth < maxDepth &&
      target.endsWith("/__init__.py")
    ) {
      await resolvePythonInitializer(
        target,
        depth + 1,
        maxDepth,
        importedNames,
        readFile,
        snapshotSource,
        reachable,
        visited,
      );
      continue;
    }
    const targetSource = await readFile(target);
    if (targetSource === undefined) continue;
    const targetSnapshot = await snapshotSource(target, targetSource);
    if (targetSnapshot === undefined || targetSnapshot.language !== "python") {
      continue;
    }
    const targetNames = new Set(
      targetSnapshot.symbols.map(({ qualifiedName }) =>
        rootName(qualifiedName),
      ),
    );
    const targetVisible = reachable.get(target) ?? new Set<string>();
    const names = starsAllPublic
      ? [...targetNames].filter((name) => !name.startsWith("_"))
      : [...importedNames].filter((name) => targetNames.has(name));
    for (const name of names) targetVisible.add(name);
    if (targetVisible.size > 0) reachable.set(target, targetVisible);
  }
}

async function resolvePythonReexport(
  fromPath: string,
  specifier: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  let level = 0;
  while (specifier[level] === ".") level += 1;
  if (level === 0) return undefined;
  let directory = posix.dirname(fromPath);
  for (let index = 1; index < level; index += 1) {
    directory = posix.dirname(directory);
  }
  const modulePath = specifier.slice(level).replaceAll(".", "/");
  const base = normalizeRepositoryPath(
    modulePath.length === 0 ? directory : posix.join(directory, modulePath),
  );
  if (base === undefined) return undefined;
  for (const candidate of [`${base}.py`, `${base}/__init__.py`]) {
    if ((await readFile(candidate)) !== undefined) return candidate;
  }
  return undefined;
}

function isPrivatePythonPath(path: string): boolean {
  return path.split("/").some((segment) => {
    if (segment === "__init__.py" || segment === "__main__.py") return false;
    const name = segment.endsWith(".py") ? segment.slice(0, -3) : segment;
    return name.startsWith("_");
  });
}

async function discoverEntries(
  input: BoundaryInput,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<{ entries: string[]; reason?: BoundaryReason }> {
  if ((input.configuredEntries?.length ?? 0) > 0) {
    const entries: string[] = [];
    for (const configured of input.configuredEntries ?? []) {
      const path = normalizeRepositoryPath(configured);
      if (
        path === undefined ||
        !hasSupportedExtension(path) ||
        (await readFile(path)) === undefined
      ) {
        return { entries: [], reason: "entry-not-found" };
      }
      entries.push(path);
    }
    return { entries };
  }

  const listed = await input.listPackageJson();
  if (listed.length === 0) return { entries: [], reason: "no-manifest" };
  if (listed.length > MAX_PACKAGE_MANIFESTS) {
    throw new BoundaryLimitExceeded();
  }
  const manifestPaths = [...new Set(listed)]
    .map(normalizeRepositoryPath)
    .filter((path): path is string => path !== undefined)
    .filter(
      (path) =>
        posix.basename(path) === "package.json" &&
        !path.split("/").includes("node_modules"),
    );
  if (manifestPaths.length === 0) {
    return { entries: [], reason: "no-manifest" };
  }

  const rootSource = manifestPaths.includes("package.json")
    ? await readFile("package.json")
    : undefined;
  const rootPackage = parsePackageJson(rootSource);
  const workspaceParents = workspaceDirectories(rootPackage);
  const allowed = manifestPaths
    .filter((path) => isAllowedManifest(path, workspaceParents))
    .sort(compareManifestPaths);
  const packages: PackageRecord[] = [];
  let invalidManifest = false;
  for (const path of allowed) {
    const source = path === "package.json" ? rootSource : await readFile(path);
    const value = parsePackageJson(source);
    if (value === undefined) {
      invalidManifest = true;
      continue;
    }
    packages.push({ path, value });
  }

  let hasEntryField = false;
  let hasSupportedCandidate = false;
  const entries: string[] = [];
  for (const manifest of packages) {
    const packageDirectory = posix.dirname(manifest.path);
    const candidates = packageEntryCandidates(manifest.value);
    hasEntryField ||= candidates.hasEntryField;
    hasSupportedCandidate ||= candidates.values.some(hasSupportedExtension);
    for (const candidate of candidates.values) {
      if (!hasSupportedExtension(candidate)) continue;
      const resolved = await resolveEntryCandidate(
        packageDirectory === "." ? "" : packageDirectory,
        candidate,
        readFile,
      );
      if (resolved !== undefined) entries.push(resolved);
    }
  }

  if (entries.length > 0) return { entries };
  if (!hasEntryField) {
    return {
      entries: [],
      reason: invalidManifest ? "unsupported-entry" : "no-entry-field",
    };
  }
  return {
    entries: [],
    reason: hasSupportedCandidate ? "entry-not-found" : "unsupported-entry",
  };
}

function packageEntryCandidates(value: Record<string, unknown>): {
  values: string[];
  hasEntryField: boolean;
} {
  const values: string[] = [];
  let hasEntryField = false;
  if (Object.hasOwn(value, "exports")) {
    hasEntryField = true;
    values.push(...exportEntryStrings(value.exports));
  }
  for (const key of ["types", "typings", "module", "main"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    hasEntryField = true;
    if (typeof value[key] === "string") values.push(value[key]);
  }
  return { values: [...new Set(values)], hasEntryField };
}

function exportEntryStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  const object = UNKNOWN_OBJECT_SCHEMA.safeParse(value);
  if (!object.success) return [];
  const subpaths = Object.keys(object.data).filter(
    (key) => key === "." || key.startsWith("./"),
  );
  if (subpaths.length > 0) {
    return [".", ...subpaths.filter((key) => key !== ".").sort(compareStrings)]
      .filter((key) => Object.hasOwn(object.data, key))
      .flatMap((key) => conditionEntryStrings(object.data[key], 0));
  }
  return conditionEntryStrings(object.data, 0);
}

function conditionEntryStrings(value: unknown, depth: number): string[] {
  if (typeof value === "string") return [value];
  const object = UNKNOWN_OBJECT_SCHEMA.safeParse(value);
  if (!object.success || depth > 1) return [];
  return EXPORT_CONDITIONS.flatMap((condition) => {
    if (!Object.hasOwn(object.data, condition)) return [];
    const selected = object.data[condition];
    return typeof selected === "string"
      ? [selected]
      : conditionEntryStrings(selected, depth + 1);
  });
}

async function resolveEntryCandidate(
  packageDirectory: string,
  candidate: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const relativeCandidate = candidate.startsWith("./")
    ? candidate.slice(2)
    : candidate;
  const direct = normalizeRepositoryPath(
    packageDirectory.length === 0
      ? relativeCandidate
      : posix.join(packageDirectory, relativeCandidate),
  );
  if (direct === undefined) return undefined;
  if ((await readFile(direct)) !== undefined) return direct;
  if (!shouldMapBuildEntry(relativeCandidate)) return undefined;

  for (const mapped of mappedSourceCandidates(
    packageDirectory,
    relativeCandidate,
  )) {
    if (mapped === direct) continue;
    if ((await readFile(mapped)) !== undefined) return mapped;
  }
  return undefined;
}

function mappedSourceCandidates(
  packageDirectory: string,
  candidate: string,
): string[] {
  const parts = candidate.split("/");
  const remainder = parts.length > 1 ? parts.slice(1).join("/") : parts[0]!;
  const stem = stripSupportedExtension(remainder);
  const candidates: string[] = [];
  for (const directory of SOURCE_DIRECTORIES) {
    for (const extension of PROBE_EXTENSIONS) {
      const packagePath = `${directory}/${stem}${extension}`;
      const resolved = normalizeRepositoryPath(
        packageDirectory.length === 0
          ? packagePath
          : posix.join(packageDirectory, packagePath),
      );
      if (resolved !== undefined) candidates.push(resolved);
    }
  }
  return [...new Set(candidates)];
}

async function resolveReexport(
  fromPath: string,
  specifier: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined;
  }
  const base = normalizeRepositoryPath(
    posix.join(posix.dirname(fromPath), specifier),
  );
  if (base === undefined) return undefined;
  const candidates: string[] = [];
  if (hasSupportedExtension(base)) {
    candidates.push(base);
    if (base.endsWith(".js")) candidates.push(`${base.slice(0, -3)}.ts`);
  } else {
    for (const extension of PROBE_EXTENSIONS) {
      candidates.push(`${base}${extension}`);
    }
    for (const extension of PROBE_EXTENSIONS) {
      candidates.push(`${base}/index${extension}`);
    }
  }
  for (const candidate of [...new Set(candidates)]) {
    if ((await readFile(candidate)) !== undefined) return candidate;
  }
  return undefined;
}

function fallback(reason: BoundaryReason, filesRead: number): ResolvedBoundary {
  return {
    report: { mode: "fallback", entries: [], reason, filesRead },
    reachable: new Map(),
  };
}

function parsePackageJson(
  source: string | undefined,
): Record<string, unknown> | undefined {
  if (source === undefined) return undefined;
  try {
    const parsed = UNKNOWN_OBJECT_SCHEMA.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function workspaceDirectories(
  rootPackage: Record<string, unknown> | undefined,
): Set<string> {
  const result = new Set<string>();
  if (rootPackage === undefined) return result;
  const workspaces = rootPackage.workspaces;
  const workspaceObject = UNKNOWN_OBJECT_SCHEMA.safeParse(workspaces);
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : workspaceObject.success && Array.isArray(workspaceObject.data.packages)
      ? workspaceObject.data.packages
      : [];
  for (const value of patterns) {
    if (typeof value !== "string" || !value.endsWith("/*")) continue;
    const directory = value.slice(0, -2).replace(/^\.\//u, "");
    if (
      directory.length > 0 &&
      !directory.includes("*") &&
      !directory.includes("?") &&
      normalizeRepositoryPath(directory) === directory
    ) {
      result.add(directory);
    }
  }
  return result;
}

function isAllowedManifest(
  path: string,
  workspaceParents: ReadonlySet<string>,
): boolean {
  if (path === "package.json") return true;
  const directory = posix.dirname(path);
  const parent = posix.dirname(directory);
  return (
    posix.basename(path) === "package.json" &&
    (parent === "packages" || parent === "apps" || workspaceParents.has(parent))
  );
}

function shouldMapBuildEntry(path: string): boolean {
  const first = path.split("/")[0] ?? "";
  return (
    BUILD_DIRECTORIES[first] === true ||
    path.endsWith(".d.ts") ||
    path.endsWith(".js") ||
    path.endsWith(".mjs") ||
    path.endsWith(".cjs")
  );
}

function stripSupportedExtension(path: string): string {
  const extension = SUPPORTED_EXTENSIONS.find((suffix) =>
    path.endsWith(suffix),
  );
  return extension === undefined ? path : path.slice(0, -extension.length);
}

function hasSupportedExtension(path: string): boolean {
  return SUPPORTED_EXTENSIONS.some((extension) =>
    path.toLowerCase().endsWith(extension),
  );
}

function normalizeRepositoryPath(value: string): string | undefined {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.startsWith("/") ||
    value.includes("\\")
  ) {
    return undefined;
  }
  const normalized = posix.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return undefined;
  }
  return normalized;
}

function positiveLimit(
  value: number | undefined,
  fallbackValue: number,
): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : fallbackValue;
}

function rootName(qualifiedName: string): string {
  return qualifiedName.split(".", 1)[0]!;
}

function selectionKey(path: string, selection: QueueSelection): string {
  return selection.kind === "names"
    ? `${path}\0names\0${[...selection.names].sort(compareStrings).join("\0")}`
    : `${path}\0${selection.kind}`;
}

function compareManifestPaths(left: string, right: string): number {
  return (
    left.split("/").length - right.split("/").length ||
    compareStrings(left, right)
  );
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
