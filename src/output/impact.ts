import { canonicalStringify } from "../impact/canonical";
import {
  hasDocumentationImpact,
  type DocumentationTargetCandidate,
} from "../impact/targets";
import type {
  DocumentationReference,
  ImpactPlan,
  PlanCommandResult,
  SnapshotDescriptor,
} from "../impact/types";

export interface ImpactPlanPresentation {
  readonly targets: readonly DocumentationTargetCandidate[];
  readonly requiresExplicitTarget: boolean;
}

export function formatImpactPlan(
  plan: ImpactPlan,
  verbose = false,
  presentation?: ImpactPlanPresentation,
): string {
  const count = plan.summary.publicApiChanges;
  const lines = [
    `Documentation impact: ${count} public API ${plural(count, "change", "changes")}`,
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
  if (verbose) {
    lines.push(`Base: ${formatSnapshot(plan.base)}`);
    lines.push(`Head: ${formatSnapshot(plan.head)}`);
  }
  appendNextAction(lines, plan, presentation);
  return lines.join("\n");
}

export function serializePlanCommandResult(result: PlanCommandResult): string {
  return canonicalStringify(result);
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
      "Next: aidoc update",
    );
    return;
  }
  if (resolved.targets.length > 1) {
    lines.push("", "Targets:");
    for (const target of resolved.targets) lines.push(`  ${target.path}`);
    lines.push("Next: aidoc update");
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
