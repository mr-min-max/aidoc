import { posix as pathPosix } from "node:path";

export const IMPACT_PLAN_SCHEMA_VERSION = "aidoc.impact-plan.v1" as const;
export const IMPACT_CONTEXT_SCHEMA_VERSION = "aidoc.impact-context.v1" as const;
export const DEFAULT_MAX_CONTEXT_BYTES = 12000;
export const MIN_MAX_CONTEXT_BYTES = 1024;
export const MAX_MAX_CONTEXT_BYTES = 1048576;

export type ImpactLanguage = "typescript" | "python";
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum";
export type ContractFacet =
  | "parameters"
  | "return"
  | "inheritance"
  | "members"
  | "modifiers";
export type ChangeCategory =
  | "added"
  | "removed"
  | "moved"
  | "contract-changed"
  | "implementation-changed"
  | "documentation-changed"
  | "dependency-changed";
export type ChangeRisk =
  | "potentially-breaking"
  | "review-required"
  | "informational";

export interface SnapshotDescriptor {
  type: "git" | "working-tree";
  label: string;
  commit?: string;
}

export interface SymbolChange {
  scope: "symbol" | "module";
  id: string;
  beforeId?: string;
  afterId?: string;
  category: ChangeCategory;
  risk: ChangeRisk;
  language: ImpactLanguage;
  path: string;
  kind: SymbolKind | "module";
  qualifiedName?: string;
  changedContractFacets?: ContractFacet[];
  digest: string;
}

export interface DocumentationReference {
  file: string;
  section: string;
  slug: string;
  reason:
    | "code-span"
    | "source-link"
    | "heading"
    | "api-documentation"
    | "changelog"
    | "entrypoint"
    | "architecture";
}

export interface DocumentationImpact {
  changeId: string;
  directReferences: DocumentationReference[];
  recommendations: DocumentationReference[];
  unmapped: boolean;
}

export interface ImpactSummary {
  totalChanges: number;
  publicApiChanges: number;
  potentiallyBreaking: number;
  reviewRequired: number;
  informational: number;
  unmapped: number;
  byCategory: Record<ChangeCategory, number>;
}

export interface ContextBudgetReport {
  maxBytes: number;
  usedBytes: number;
  totalRecords: number;
  includedRecords: number;
  omittedRecords: number;
  impactDigest: string;
}

export interface ImpactPlan {
  schemaVersion: typeof IMPACT_PLAN_SCHEMA_VERSION;
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  context: ContextBudgetReport;
  ignored: { unsupported: number; excluded: number };
  digest: string;
}

export interface ImpactProviderContext {
  schemaVersion: typeof IMPACT_CONTEXT_SCHEMA_VERSION;
  impactDigest: string;
  summary: ImpactSummary;
  changes: ImpactProviderChange[];
  documentation: DocumentationImpact[];
  omittedRecords: number;
}

export type ImpactProviderChange =
  | (Pick<
      SymbolChange,
      | "id"
      | "category"
      | "risk"
      | "path"
      | "kind"
      | "qualifiedName"
      | "changedContractFacets"
    > & { compacted?: false })
  | {
      id: string;
      category: ChangeCategory;
      risk: ChangeRisk;
      kind: SymbolKind | "module";
      compacted: true;
    };

export type PlanErrorCode =
  | "PLAN_NOT_GIT_REPOSITORY"
  | "PLAN_BASE_NOT_FOUND"
  | "PLAN_HEAD_NOT_FOUND"
  | "PLAN_INVALID_REF"
  | "PLAN_SHALLOW_HISTORY"
  | "PLAN_UNSAFE_WORKTREE_PATH"
  | "PLAN_SOURCE_READ_FAILED"
  | "PLAN_PARSE_FAILED"
  | "PLAN_INVALID_CONTEXT_BUDGET";

export const PLAN_ERROR_CODES: ReadonlySet<PlanErrorCode> = new Set([
  "PLAN_NOT_GIT_REPOSITORY",
  "PLAN_BASE_NOT_FOUND",
  "PLAN_HEAD_NOT_FOUND",
  "PLAN_INVALID_REF",
  "PLAN_SHALLOW_HISTORY",
  "PLAN_UNSAFE_WORKTREE_PATH",
  "PLAN_SOURCE_READ_FAILED",
  "PLAN_PARSE_FAILED",
  "PLAN_INVALID_CONTEXT_BUDGET",
]);

export interface PlanError {
  code: PlanErrorCode;
  message: string;
  path?: string;
}

export type PlanCommandResult =
  | { ok: true; plan: ImpactPlan }
  | { ok: false; error: PlanError };

export interface ImpactPlanningResult {
  plan: ImpactPlan;
  providerContext: ImpactProviderContext;
}

export interface ParserModuleSnapshot {
  language: ImpactLanguage;
  dependencyFingerprint: string;
  symbols: ParserSymbolSnapshot[];
}

export interface ParserSymbolSnapshot {
  language: ImpactLanguage;
  kind: SymbolKind;
  qualifiedName: string;
  contractFacets: Partial<Record<ContractFacet, string>>;
  contractFingerprint: string;
  implementationFingerprint: string;
  documentationFingerprint: string | null;
}

const PLAN_FAILURE_PAYLOADS = new WeakMap<object, Readonly<PlanError>>();

/** Carries a stable planning failure code with an optional safe relative path. */
export class PlanFailure extends Error {
  readonly code: PlanErrorCode;
  declare readonly path?: string;

  constructor(code: PlanErrorCode, message: string, path?: string) {
    super(message);
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "PlanFailure",
      writable: true,
    });
    this.code = code;
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: true,
      value: message,
      writable: true,
    });

    const normalizedPath = normalizeRelativePath(path);
    if (normalizedPath !== undefined) this.path = normalizedPath;

    PLAN_FAILURE_PAYLOADS.set(
      this,
      Object.freeze({
        code,
        message,
        ...(normalizedPath === undefined ? {} : { path: normalizedPath }),
      }),
    );
  }

  /** Returns the sanitized payload only when the error is an authentic PlanFailure. */
  static read(error: unknown): PlanError | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const payload = PLAN_FAILURE_PAYLOADS.get(error);
    return payload === undefined ? undefined : { ...payload };
  }
}

function normalizeRelativePath(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0 || hasControlCharacter(path)) {
    return undefined;
  }

  const slashPath = path.replace(/\\/gu, "/");
  if (slashPath.startsWith("/") || /^[A-Za-z]:\//u.test(slashPath)) {
    return undefined;
  }

  const normalized = pathPosix.normalize(slashPath);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return undefined;
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}
