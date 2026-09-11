import { canonicalStringify } from "../impact/canonical";
import {
  hasDocumentationImpact,
  type DocumentationTargetCandidate,
} from "../impact/targets";
import type {
  DocumentationReference,
  ImpactPlan,
  LanguageBoundaryReport,
  PlanCommandResult,
  SnapshotDescriptor,
} from "../impact/types";

export interface ImpactPlanPresentation {
  readonly targets: readonly DocumentationTargetCandidate[];
  readonly requiresExplicitTarget: boolean;
}

/** Formats an impact plan for humans without changing the underlying plan data. */
export function formatImpactPlan(
  plan: ImpactPlan,
  verbose = false,
  presentation?: ImpactPlanPresentation,
): string {
  const count = plan.summary.publicApiChanges;
  const informational = plan.summary.informational;
  const lines = [
    `Documentation impact: ${count} public API ${plural(count, "change", "changes")}${informational > 0 ? ` (${informational} informational)` : ""}`,
  ];

  if (!hasDocumentationImpact(plan)) {
    lines.push("No documentation updates are indicated.");
  } else {
    if (plan.summary.potentiallyBreaking > 0) {
      const breaking = plan.summary.potentiallyBreaking;
      lines.push(
        `! ${breaking} potentially breaking ${plural(breaking, "change", "changes")}`,
      );
    }

    appendReferences(
      lines,
      "Direct documentation references:",
      plan.documentation.flatMap((item) => item.directReferences),
    );
    appendReferences(
      lines,
      "Recommended documentation:",
      plan.documentation.flatMap((item) => item.recommendations),
    );

    if (plan.summary.unmapped > 0) {
      const unmapped = plan.summary.unmapped;
      lines.push(
        "",
        `${unmapped} changed ${plural(unmapped, "symbol is", "symbols are")} not mapped to documentation.`,
      );
    }
  }

  lines.push(
    `Context: ${plan.context.usedBytes} / ${plan.context.maxBytes} bytes`,
  );
  if (plan.ignored.suppressed > 0) {
    lines.push(
      `${plan.ignored.suppressed} changes suppressed by .staledocsignore`,
    );
  }
  if (verbose) appendBoundaries(lines, plan);
  if (verbose) {
    for (const change of plan.changes) {
      if (change.before === undefined && change.after === undefined) continue;
      lines.push(`Change: ${change.qualifiedName ?? change.id}`);
      if (change.before !== undefined) lines.push(`  before: ${change.before}`);
      if (change.after !== undefined) lines.push(`  after:  ${change.after}`);
    }
    lines.push(`Base: ${formatSnapshot(plan.base)}`);
    lines.push(`Head: ${formatSnapshot(plan.head)}`);
  }
  appendNextAction(lines, plan, presentation);
  return lines.join("\n");
}

/** Serializes a plan command result with deterministic canonical key ordering. */
export function serializePlanCommandResult(result: PlanCommandResult): string {
  return canonicalStringify(result);
}

function appendBoundaries(lines: string[], plan: ImpactPlan): void {
  for (const [label, boundary] of [
    ["TypeScript", plan.boundary?.typescript],
    ["Python", plan.boundary?.python],
  ] as const) {
    if (boundary === undefined) continue;
    lines.push(formatBoundary(label, boundary));
  }
}

function formatBoundary(
  label: string,
  boundary: LanguageBoundaryReport,
): string {
  if (boundary.mode === "entry") {
    return `Boundary (${label}): entry ${boundary.entries.join(", ")} (${boundary.filesRead} files read)`;
  }
  return `Boundary (${label}): not resolved (${boundary.reason}); every export is treated as public. Set entry in the StaleDocs config to narrow it.`;
}
function appendReferences(
  lines: string[],
  heading: string,
  references: DocumentationReference[],
): void {
  const labels = new Set(
    references.map((reference) => `${reference.file} -> ${reference.section}`),
  );
  if (labels.size === 0) return;
  lines.push("", heading);
  for (const label of [...labels].sort(compareStrings)) {
    lines.push(`  ${label}`);
  }
}

function formatSnapshot(snapshot: SnapshotDescriptor): string {
  if (snapshot.type === "working-tree") return "working-tree";
  return snapshot.commit === undefined
    ? snapshot.label
    : `${snapshot.label} (${snapshot.commit})`;
}

function appendNextAction(
  lines: string[],
  plan: ImpactPlan,
  presentation: ImpactPlanPresentation | undefined,
): void {
  if (!hasDocumentationImpact(plan)) return;

  const resolved = presentation ?? inferPresentation(plan);
  if (resolved.targets.length === 1) {
    lines.push(
      "",
      `Target: ${resolved.targets[0]!.path}`,
      "Next: staledocs update",
    );
    return;
  }
  if (resolved.targets.length > 1) {
    lines.push("", "Targets:");
    for (const target of resolved.targets) lines.push(`  ${target.path}`);
    lines.push("Next: staledocs update");
    return;
  }

  lines.push(
    "",
    "No safe automatic documentation target was found.",
    "Use --target <file> to choose an existing Markdown file.",
  );
}

function inferPresentation(plan: ImpactPlan): ImpactPlanPresentation {
  const candidates = new Map<string, DocumentationTargetCandidate>();
  for (const impact of plan.documentation) {
    for (const [references, reason] of [
      [impact.directReferences, "direct-reference" as const],
      [impact.recommendations, "recommendation" as const],
    ] as const) {
      for (const reference of references) {
        const existing = candidates.get(reference.file);
        if (existing === undefined) {
          candidates.set(reference.file, {
            path: reference.file,
            reasons: [reason],
            sections: [reference.section],
          });
          continue;
        }
        candidates.set(reference.file, {
          path: reference.file,
          reasons: [...new Set([...existing.reasons, reason])],
          sections: [
            ...new Set([...existing.sections, reference.section]),
          ].sort(compareStrings),
        });
      }
    }
  }
  return {
    targets: [...candidates.values()].sort((left, right) =>
      compareStrings(left.path, right.path),
    ),
    requiresExplicitTarget: candidates.size === 0,
  };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
