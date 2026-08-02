import { canonicalStringify, compareChangeKeys, sha256Hex } from "./canonical";
import type { SnapshotFileStatus } from "../git/snapshot";
import type {
  ChangeCategory,
  ContractFacet,
  DocumentationImpact,
  ImpactSummary,
  ParserModuleSnapshot,
  ParserSymbolSnapshot,
  SnapshotDescriptor,
  SymbolChange,
} from "./types";

export interface ParsedFileSnapshots {
  status: SnapshotFileStatus;
  beforePath?: string;
  afterPath?: string;
  before?: ParserModuleSnapshot;
  after?: ParserModuleSnapshot;
}

const CATEGORY_ORDER: readonly ChangeCategory[] = [
  "removed",
  "contract-changed",
  "moved",
  "added",
  "dependency-changed",
  "implementation-changed",
  "documentation-changed",
];

const CATEGORY_PRIORITY = new Map(
  CATEGORY_ORDER.map((category, index) => [category, index]),
);

const ALL_CATEGORIES: readonly ChangeCategory[] = [
  "added",
  "removed",
  "moved",
  "contract-changed",
  "implementation-changed",
  "documentation-changed",
  "dependency-changed",
];

const FACETS: readonly ContractFacet[] = [
  "parameters",
  "return",
  "inheritance",
  "members",
  "modifiers",
];

export function compareSnapshots(files: ParsedFileSnapshots[]): SymbolChange[] {
  const changes: SymbolChange[] = [];
  for (const file of files) {
    const before = file.before;
    const after = file.after;
    if (
      file.status === "renamed" &&
      before !== undefined &&
      after !== undefined
    ) {
      const beforeByKey = indexSymbols(before.symbols);
      const afterByKey = indexSymbols(after.symbols);
      for (const previous of before.symbols) {
        const current = afterByKey.get(symbolKey(previous));
        if (current !== undefined && identicalSymbols(previous, current)) {
          changes.push(
            createChange({
              scope: "symbol",
              category: "moved",
              risk: "informational",
              language: previous.language,
              path: file.afterPath ?? file.beforePath ?? "",
              kind: previous.kind,
              qualifiedName: previous.qualifiedName,
              beforeId: symbolId(file.beforePath ?? "", previous),
              afterId: symbolId(file.afterPath ?? "", current),
            }),
          );
        } else {
          addOne(changes, previous, file.beforePath, "removed");
        }
      }
      for (const current of after.symbols) {
        const previous = beforeByKey.get(symbolKey(current));
        if (previous === undefined || !identicalSymbols(previous, current)) {
          addOne(changes, current, file.afterPath, "added");
        }
      }
      if (before.dependencyFingerprint !== after.dependencyFingerprint) {
        changes.push(
          createChange({
            scope: "module",
            category: "dependency-changed",
            risk: "informational",
            language: after.language,
            path: file.afterPath ?? file.beforePath ?? "",
            kind: "module",
          }),
        );
      }
      continue;
    }

    if (before === undefined) {
      addAll(changes, after?.symbols ?? [], file.afterPath, "added");
      continue;
    }
    if (after === undefined) {
      addAll(changes, before.symbols, file.beforePath, "removed");
      continue;
    }

    const beforeByKey = indexSymbols(before.symbols);
    const afterByKey = indexSymbols(after.symbols);
    const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
    for (const key of keys) {
      const previous = beforeByKey.get(key);
      const current = afterByKey.get(key);
      if (previous === undefined) {
        addOne(changes, current!, file.afterPath, "added");
      } else if (current === undefined) {
        addOne(changes, previous, file.beforePath, "removed");
      } else {
        compareSymbol(
          changes,
          previous,
          current,
          file.afterPath ?? file.beforePath ?? "",
        );
      }
    }
    if (before.dependencyFingerprint !== after.dependencyFingerprint) {
      changes.push(
        createChange({
          scope: "module",
          category: "dependency-changed",
          risk: "informational",
          language: after.language,
          path: file.afterPath ?? file.beforePath ?? "",
          kind: "module",
        }),
      );
    }
  }
  return changes.sort(compareImpactChanges);
}

export function summarizeImpact(
  changes: SymbolChange[],
  documentation: DocumentationImpact[] = [],
): ImpactSummary {
  const byCategory = Object.fromEntries(
    ALL_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ChangeCategory, number>;
  let potentiallyBreaking = 0;
  let reviewRequired = 0;
  let informational = 0;
  let publicApiChanges = 0;
  for (const change of changes) {
    byCategory[change.category] += 1;
    if (change.scope === "symbol") publicApiChanges += 1;
    if (change.risk === "potentially-breaking") potentiallyBreaking += 1;
    else if (change.risk === "review-required") reviewRequired += 1;
    else informational += 1;
  }
  return {
    totalChanges: changes.length,
    publicApiChanges,
    potentiallyBreaking,
    reviewRequired,
    informational,
    unmapped: documentation.filter((impact) => impact.unmapped).length,
    byCategory,
  };
}

export function digestImpactPayload(input: {
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  ignored: { unsupported: number; excluded: number };
}): string {
  return sha256Hex(
    canonicalStringify({
      base: input.base,
      head: input.head,
      summary: input.summary,
      changes: input.changes,
      documentation: input.documentation,
      ignored: input.ignored,
    }),
  );
}

function compareSymbol(
  changes: SymbolChange[],
  before: ParserSymbolSnapshot,
  after: ParserSymbolSnapshot,
  path: string,
): void {
  if (before.contractFingerprint !== after.contractFingerprint) {
    const changedContractFacets = FACETS.filter(
      (facet) => before.contractFacets[facet] !== after.contractFacets[facet],
    ).sort();
    changes.push(
      createChange({
        scope: "symbol",
        category: "contract-changed",
        risk: "review-required",
        language: after.language,
        path,
        kind: after.kind,
        qualifiedName: after.qualifiedName,
        changedContractFacets,
      }),
    );
    return;
  }
  if (before.implementationFingerprint !== after.implementationFingerprint) {
    changes.push(
      createChange({
        scope: "symbol",
        category: "implementation-changed",
        risk: "informational",
        language: after.language,
        path,
        kind: after.kind,
        qualifiedName: after.qualifiedName,
      }),
    );
  } else if (
    before.documentationFingerprint !== after.documentationFingerprint
  ) {
    changes.push(
      createChange({
        scope: "symbol",
        category: "documentation-changed",
        risk: "informational",
        language: after.language,
        path,
        kind: after.kind,
        qualifiedName: after.qualifiedName,
      }),
    );
  }
}

function addAll(
  changes: SymbolChange[],
  symbols: ParserSymbolSnapshot[],
  path: string | undefined,
  category: "added" | "removed",
): void {
  for (const symbol of symbols) addOne(changes, symbol, path, category);
}

function addOne(
  changes: SymbolChange[],
  symbol: ParserSymbolSnapshot,
  path: string | undefined,
  category: "added" | "removed",
): void {
  changes.push(
    createChange({
      scope: "symbol",
      category,
      risk: category === "removed" ? "potentially-breaking" : "informational",
      language: symbol.language,
      path: path ?? "",
      kind: symbol.kind,
      qualifiedName: symbol.qualifiedName,
    }),
  );
}

function createChange(
  value: Omit<SymbolChange, "id" | "digest"> & { id?: string },
): SymbolChange {
  const id =
    value.id ??
    (value.scope === "module"
      ? `${value.language}:${value.path}#module`
      : `${value.language}:${value.path}#${value.kind}:${value.qualifiedName ?? ""}`);
  const payload = { ...value, id };
  return { ...payload, digest: sha256Hex(canonicalStringify(payload)) };
}

function symbolId(path: string, symbol: ParserSymbolSnapshot): string {
  return `${symbol.language}:${path}#${symbol.kind}:${symbol.qualifiedName}`;
}

function symbolKey(symbol: ParserSymbolSnapshot): string {
  return `${symbol.kind}:${symbol.qualifiedName}`;
}

function indexSymbols(
  symbols: ParserSymbolSnapshot[],
): Map<string, ParserSymbolSnapshot> {
  return new Map(symbols.map((symbol) => [symbolKey(symbol), symbol]));
}

function identicalSymbols(
  previous: ParserSymbolSnapshot,
  current: ParserSymbolSnapshot,
): boolean {
  return (
    previous.language === current.language &&
    previous.contractFingerprint === current.contractFingerprint &&
    previous.implementationFingerprint === current.implementationFingerprint &&
    previous.documentationFingerprint === current.documentationFingerprint &&
    FACETS.every(
      (facet) =>
        previous.contractFacets[facet] === current.contractFacets[facet],
    )
  );
}

function compareImpactChanges(a: SymbolChange, b: SymbolChange): number {
  return (
    (CATEGORY_PRIORITY.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
      (CATEGORY_PRIORITY.get(b.category) ?? Number.MAX_SAFE_INTEGER) ||
    compareChangeKeys(a, b)
  );
}
