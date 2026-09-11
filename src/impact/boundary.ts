import { posix } from "node:path";
import { z } from "zod";

import type { LanguageBoundaryReport, ParserModuleSnapshot } from "./types";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEPTH = 12;
const MAX_PACKAGE_MANIFESTS = 50;
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

export interface ResolvedBoundary {
  report: LanguageBoundaryReport;
  reachable: Map<string, Set<string>>;
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
