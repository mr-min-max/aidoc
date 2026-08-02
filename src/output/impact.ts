import { canonicalStringify } from "../impact/canonical";
import type {
  DocumentationReference,
  ImpactPlan,
  PlanCommandResult,
  SnapshotDescriptor,
} from "../impact/types";

export function formatImpactPlan(plan: ImpactPlan, verbose = false): string {
  const count = plan.summary.publicApiChanges;
  const lines = [
    `Documentation impact: ${count} public API ${plural(count, "change", "changes")}`,
  ];

  if (count === 0) {
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
  lines.push("", "Next: aidoc update");
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

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
