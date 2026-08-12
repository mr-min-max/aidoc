import { posix as pathPosix } from "node:path";
import {
  RepositoryWriteScope,
  type PreparedRepositoryTarget,
} from "../security/repository-writer";
import { RepositoryWriteError } from "../security/types";
import type {
  DocumentationImpact,
  DocumentationReference,
  ImpactPlan,
  ImpactProviderContext,
} from "./types";

export type DocumentationTargetReason =
  | "direct-reference"
  | "recommendation"
  | "unmapped-public-change-fallback"
  | "explicit";

export interface DocumentationTargetCandidate {
  readonly path: string;
  readonly reasons: readonly DocumentationTargetReason[];
  readonly sections: readonly string[];
}

export interface ResolvedDocumentationTarget extends DocumentationTargetCandidate {
  readonly prepared: PreparedRepositoryTarget;
}

const REASON_ORDER: readonly DocumentationTargetReason[] = [
  "direct-reference",
  "recommendation",
  "unmapped-public-change-fallback",
  "explicit",
];

/** Returns whether a plan contains a documentation update worth preparing. */
export function hasDocumentationImpact(plan: ImpactPlan): boolean {
  const publicChangeIds = new Set(
    plan.changes
      .filter((change) => change.scope === "symbol")
      .map((change) => change.id),
  );

  return plan.documentation.some(
    (impact) =>
      impact.directReferences.length > 0 ||
      impact.recommendations.length > 0 ||
      (impact.unmapped && publicChangeIds.has(impact.changeId)),
  );
}

/**
 * Resolves impact mappings into existing, repository-prepared Markdown files.
 * The writer is the source of truth for containment, symlinks, and file type.
 */
export async function resolveDocumentationTargets(input: {
  plan: ImpactPlan;
  scope: RepositoryWriteScope;
  explicitTargets?: readonly string[];
}): Promise<ResolvedDocumentationTarget[]> {
  const explicitTargets = input.explicitTargets ?? [];
  if (explicitTargets.length > 0) {
    return prepareExplicitTargets(input.scope, explicitTargets);
  }

  const mapped = collectMappedCandidates(input.plan.documentation);
  if (mapped.size > 0) {
    const resolved = await prepareMappedTargets(input.scope, mapped);
    if (resolved.length > 0 || !hasUnmappedPublicChange(input.plan)) {
      return resolved;
    }
  }

  if (!hasUnmappedPublicChange(input.plan)) return [];

  return prepareReadmeFallback(input.scope);
}

/**
 * Resolves targets for a read-only command without exposing repository-write
 * capabilities at the CLI boundary.
 */
export async function inspectDocumentationTargets(input: {
  plan: ImpactPlan;
  cwd: string;
}): Promise<ResolvedDocumentationTarget[]> {
  const scope = await RepositoryWriteScope.open(input.cwd);
  return resolveDocumentationTargets({ plan: input.plan, scope });
}

/** Projects the bounded provider context to one selected document. */
export function projectProviderContextForTarget(
  context: ImpactProviderContext,
  target: DocumentationTargetCandidate,
): ImpactProviderContext {
  if (target.reasons.includes("explicit")) return context;

  const targetPath = normalizeTargetPath(target.path);
  const isUnmappedFallback = target.reasons.includes(
    "unmapped-public-change-fallback",
  );

  if (isUnmappedFallback) {
    const unmappedPublicIds = new Set(
      context.documentation
        .filter((impact) => impact.unmapped)
        .map((impact) => impact.changeId),
    );
    const changes = context.changes.filter(
      (change) => change.kind !== "module" && unmappedPublicIds.has(change.id),
    );
    const changeIds = new Set(changes.map((change) => change.id));
    return {
      ...context,
      changes,
      documentation: context.documentation.filter(
        (impact) => impact.unmapped && changeIds.has(impact.changeId),
      ),
    };
  }

  const documentation = context.documentation
    .map((impact) => projectDocumentationImpact(impact, targetPath))
    .filter((impact): impact is DocumentationImpact => impact !== undefined);
  const changeIds = new Set(documentation.map((impact) => impact.changeId));

  return {
    ...context,
    changes: context.changes.filter((change) => changeIds.has(change.id)),
    documentation,
  };
}

interface MutableCandidate {
  rawPath: string;
  reasons: Set<DocumentationTargetReason>;
  sections: Set<string>;
}

function collectMappedCandidates(
  documentation: readonly DocumentationImpact[],
): Map<string, MutableCandidate> {
  const candidates = new Map<string, MutableCandidate>();
  for (const impact of documentation) {
    addReferences(candidates, impact.directReferences, "direct-reference");
    addReferences(candidates, impact.recommendations, "recommendation");
  }
  return candidates;
}

function addReferences(
  candidates: Map<string, MutableCandidate>,
  references: readonly DocumentationReference[],
  reason: "direct-reference" | "recommendation",
): void {
  for (const reference of references) {
    const rawPath = reference.file;
    const key = normalizeTargetPath(rawPath);
    const candidate = candidates.get(key) ?? {
      rawPath,
      reasons: new Set<DocumentationTargetReason>(),
      sections: new Set<string>(),
    };
    candidate.reasons.add(reason);
    candidate.sections.add(reference.section);
    candidates.set(key, candidate);
  }
}

async function prepareMappedTargets(
  scope: RepositoryWriteScope,
  candidates: Map<string, MutableCandidate>,
): Promise<ResolvedDocumentationTarget[]> {
  const resolved = new Map<string, ResolvedDocumentationTarget>();

  for (const candidate of [...candidates.values()].sort((left, right) =>
    compareStrings(
      normalizeTargetPath(left.rawPath),
      normalizeTargetPath(right.rawPath),
    ),
  )) {
    const prepared = await scope.prepare(candidate.rawPath);
    assertMarkdownTarget(prepared.displayPath);
    if (prepared.existingText === null) continue;

    const existing = resolved.get(prepared.displayPath);
    if (existing === undefined) {
      resolved.set(
        prepared.displayPath,
        createResolvedTarget(prepared, candidate.reasons, candidate.sections),
      );
      continue;
    }

    const reasons = new Set(existing.reasons);
    for (const reason of candidate.reasons) reasons.add(reason);
    const sections = new Set(existing.sections);
    for (const section of candidate.sections) sections.add(section);
    resolved.set(
      prepared.displayPath,
      createResolvedTarget(existing.prepared, reasons, sections),
    );
  }

  return [...resolved.values()].sort((left, right) =>
    compareStrings(left.path, right.path),
  );
}

async function prepareExplicitTargets(
  scope: RepositoryWriteScope,
  targets: readonly string[],
): Promise<ResolvedDocumentationTarget[]> {
  const resolved = new Map<string, ResolvedDocumentationTarget>();
  for (const rawTarget of targets) {
    const prepared = await scope.prepare(rawTarget);
    assertMarkdownTarget(prepared.displayPath);
    if (prepared.existingText === null) {
      throw new RepositoryWriteError("TRUST_INVALID_TARGET_TYPE");
    }
    if (!resolved.has(prepared.displayPath)) {
      resolved.set(
        prepared.displayPath,
        createResolvedTarget(prepared, new Set(["explicit"]), new Set()),
      );
    }
  }
  return [...resolved.values()].sort((left, right) =>
    compareStrings(left.path, right.path),
  );
}

async function prepareReadmeFallback(
  scope: RepositoryWriteScope,
): Promise<ResolvedDocumentationTarget[]> {
  const prepared = await scope.prepare("README.md");
  if (prepared.existingText === null) return [];
  assertMarkdownTarget(prepared.displayPath);
  return [
    createResolvedTarget(
      prepared,
      new Set(["unmapped-public-change-fallback"]),
      new Set(),
    ),
  ];
}

function createResolvedTarget(
  prepared: PreparedRepositoryTarget,
  reasons: ReadonlySet<DocumentationTargetReason>,
  sections: ReadonlySet<string>,
): ResolvedDocumentationTarget {
  return {
    path: prepared.displayPath,
    reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
    sections: [...sections].sort(compareStrings),
    prepared,
  };
}

function projectDocumentationImpact(
  impact: DocumentationImpact,
  targetPath: string,
): DocumentationImpact | undefined {
  const directReferences = impact.directReferences.filter(
    (reference) => normalizeTargetPath(reference.file) === targetPath,
  );
  const recommendations = impact.recommendations.filter(
    (reference) => normalizeTargetPath(reference.file) === targetPath,
  );
  if (directReferences.length === 0 && recommendations.length === 0) {
    return undefined;
  }
  return {
    ...impact,
    directReferences,
    recommendations,
    unmapped: false,
  };
}

function hasUnmappedPublicChange(plan: ImpactPlan): boolean {
  const publicChangeIds = new Set(
    plan.changes
      .filter((change) => change.scope === "symbol")
      .map((change) => change.id),
  );
  return plan.documentation.some(
    (impact) => impact.unmapped && publicChangeIds.has(impact.changeId),
  );
}

function assertMarkdownTarget(displayPath: string): void {
  if (!displayPath.toLowerCase().endsWith(".md")) {
    throw new RepositoryWriteError("TRUST_INVALID_TARGET_TYPE");
  }
}

function normalizeTargetPath(value: string): string {
  return pathPosix.normalize(value.replaceAll("\\", "/"));
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
