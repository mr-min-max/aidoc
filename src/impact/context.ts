import { posix as pathPosix } from "node:path";
import { sanitizeDiagnostic } from "../security/scanner";
import { canonicalStringify, compareChangeKeys } from "./canonical";
import {
  IMPACT_CONTEXT_SCHEMA_VERSION,
  MAX_MAX_CONTEXT_BYTES,
  MIN_MAX_CONTEXT_BYTES,
  PlanFailure,
  type ChangeCategory,
  type ContextBudgetReport,
  type DocumentationImpact,
  type DocumentationReference,
  type ImpactProviderChange,
  type ImpactProviderContext,
  type ImpactSummary,
  type SymbolChange,
} from "./types";

const CATEGORY_PRIORITY: Readonly<Record<ChangeCategory, number>> = {
  removed: 0,
  "contract-changed": 1,
  moved: 2,
  added: 3,
  "dependency-changed": 4,
  "implementation-changed": 5,
  "documentation-changed": 6,
};

const CATEGORIES: readonly ChangeCategory[] = [
  "added",
  "removed",
  "moved",
  "contract-changed",
  "implementation-changed",
  "documentation-changed",
  "dependency-changed",
];

const CONTRACT_FACETS: ReadonlySet<string> = new Set([
  "parameters",
  "return",
  "inheritance",
  "members",
  "modifiers",
]);

const DOCUMENTATION_REASONS: ReadonlySet<string> = new Set([
  "code-span",
  "source-link",
  "heading",
  "api-documentation",
  "changelog",
  "entrypoint",
  "architecture",
]);

export function buildImpactContext(input: {
  impactDigest: string;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  maxBytes: number;
}): {
  providerContext: ImpactProviderContext;
  report: ContextBudgetReport;
} {
  validateBudget(input.maxBytes);

  const summary = projectSummary(input.summary);
  const totalRecords = input.changes.length;
  let providerContext = createContext(
    input.impactDigest,
    summary,
    [],
    [],
    totalRecords,
  );
  ensureFits(providerContext, input.maxBytes);

  const documentationByChange = indexDocumentation(input.documentation);
  const orderedChanges = [...input.changes].sort(compareContextChanges);

  for (const change of orderedChanges) {
    if (canProjectFullChange(change)) {
      const fullChange = projectFullChange(change);
      const fullDocumentation = projectMatchingDocumentation(
        documentationByChange.get(change.id) ?? [],
        fullChange.id,
      );
      const fullCandidate = appendRecord(
        providerContext,
        fullChange,
        fullDocumentation,
        totalRecords,
      );
      if (fits(fullCandidate, input.maxBytes)) {
        providerContext = fullCandidate;
        continue;
      }
    }

    const compactChange: ImpactProviderChange = {
      id: change.digest,
      category: change.category,
      risk: change.risk,
      kind: change.kind,
      compacted: true,
    };
    const compactDocumentation = projectMatchingDocumentation(
      documentationByChange.get(change.id) ?? [],
      compactChange.id,
    );
    const compactCandidate = appendRecord(
      providerContext,
      compactChange,
      compactDocumentation,
      totalRecords,
    );
    if (fits(compactCandidate, input.maxBytes)) {
      providerContext = compactCandidate;
    }
  }

  const usedBytes = serializedBytes(providerContext);
  const includedRecords = providerContext.changes.length;
  return {
    providerContext,
    report: {
      maxBytes: input.maxBytes,
      usedBytes,
      totalRecords,
      includedRecords,
      omittedRecords: totalRecords - includedRecords,
      impactDigest: input.impactDigest,
    },
  };
}

function validateBudget(maxBytes: number): void {
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes < MIN_MAX_CONTEXT_BYTES ||
    maxBytes > MAX_MAX_CONTEXT_BYTES
  ) {
    throw new PlanFailure(
      "PLAN_INVALID_CONTEXT_BUDGET",
      "The provider context byte budget is invalid.",
    );
  }
}

function ensureFits(context: ImpactProviderContext, maxBytes: number): void {
  if (!fits(context, maxBytes)) {
    throw new PlanFailure(
      "PLAN_INVALID_CONTEXT_BUDGET",
      "The provider context byte budget cannot fit its mandatory envelope.",
    );
  }
}

function createContext(
  impactDigest: string,
  summary: ImpactSummary,
  changes: ImpactProviderChange[],
  documentation: DocumentationImpact[],
  omittedRecords: number,
): ImpactProviderContext {
  return {
    schemaVersion: IMPACT_CONTEXT_SCHEMA_VERSION,
    impactDigest,
    summary,
    changes,
    documentation,
    omittedRecords,
  };
}

function appendRecord(
  context: ImpactProviderContext,
  change: ImpactProviderChange,
  documentation: DocumentationImpact[],
  totalRecords: number,
): ImpactProviderContext {
  const changes = [...context.changes, change];
  return createContext(
    context.impactDigest,
    context.summary,
    changes,
    [...context.documentation, ...documentation],
    totalRecords - changes.length,
  );
}

function fits(context: ImpactProviderContext, maxBytes: number): boolean {
  return serializedBytes(context) <= maxBytes;
}

function serializedBytes(context: ImpactProviderContext): number {
  return Buffer.byteLength(canonicalStringify(context), "utf8");
}

function compareContextChanges(a: SymbolChange, b: SymbolChange): number {
  return (
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category] ||
    compareChangeKeys(a, b)
  );
}

function projectFullChange(change: SymbolChange): ImpactProviderChange {
  return {
    id: change.id,
    category: change.category,
    risk: change.risk,
    path: change.path,
    kind: change.kind,
    ...(change.qualifiedName === undefined
      ? {}
      : { qualifiedName: change.qualifiedName }),
    ...(change.changedContractFacets === undefined
      ? {}
      : {
          changedContractFacets: change.changedContractFacets
            .filter((facet) => CONTRACT_FACETS.has(facet))
            .sort(),
        }),
  };
}

function canProjectFullChange(change: SymbolChange): boolean {
  return (
    isSafeProviderText(change.id) &&
    isRepositoryRelativePath(change.path) &&
    (change.qualifiedName === undefined ||
      isSafeProviderText(change.qualifiedName))
  );
}

function projectSummary(summary: ImpactSummary): ImpactSummary {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [category, summary.byCategory[category]]),
  ) as Record<ChangeCategory, number>;
  return {
    totalChanges: summary.totalChanges,
    publicApiChanges: summary.publicApiChanges,
    potentiallyBreaking: summary.potentiallyBreaking,
    reviewRequired: summary.reviewRequired,
    informational: summary.informational,
    unmapped: summary.unmapped,
    byCategory,
  };
}

function indexDocumentation(
  documentation: DocumentationImpact[],
): Map<string, DocumentationImpact[]> {
  const byChange = new Map<string, DocumentationImpact[]>();
  for (const impact of documentation) {
    const matches = byChange.get(impact.changeId) ?? [];
    matches.push(impact);
    byChange.set(impact.changeId, matches);
  }
  return byChange;
}

function projectMatchingDocumentation(
  documentation: DocumentationImpact[],
  providerChangeId: string,
): DocumentationImpact[] {
  return documentation
    .map((impact) => ({
      changeId: providerChangeId,
      directReferences: projectReferences(impact.directReferences),
      recommendations: projectReferences(impact.recommendations),
      unmapped: impact.unmapped,
    }))
    .sort(compareCanonical);
}

function projectReferences(
  references: DocumentationReference[],
): DocumentationReference[] {
  return references
    .filter(
      (reference) =>
        isRepositoryRelativePath(reference.file) &&
        isSafeProviderText(reference.section) &&
        isSafeProviderText(reference.slug) &&
        DOCUMENTATION_REASONS.has(reference.reason),
    )
    .map((reference) => ({
      file: reference.file,
      section: reference.section,
      slug: reference.slug,
      reason: reference.reason,
    }))
    .sort(compareCanonical);
}

function isRepositoryRelativePath(value: string): boolean {
  if (!isSafeProviderText(value) || value.includes("\\")) return false;
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value)
  ) {
    return false;
  }
  const normalized = pathPosix.normalize(value);
  return (
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    normalized === value
  );
}

function isSafeProviderText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return false;
    }
  }
  return sanitizeDiagnostic(value) === value;
}

function compareCanonical(a: unknown, b: unknown): number {
  const left = canonicalStringify(a);
  const right = canonicalStringify(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
