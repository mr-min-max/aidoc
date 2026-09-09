import { canonicalStringify } from "../impact/canonical";
import type {
  ChangeCategory,
  ChangeRisk,
  SnapshotDescriptor,
} from "../impact/types";

export const REVIEW_SCHEMA_VERSION = "aidoc.review.v1" as const;

export interface ReviewReportChange {
  id: string;
  qualifiedName: string;
  kind: string;
  category: ChangeCategory;
  risk: ChangeRisk;
  path: string;
  before?: string;
  after?: string;
  changedContractFacets?: string[];
}

export interface ReviewReportSection {
  section: string;
  slug: string;
  symbols: string[];
}

export interface ReviewReportDocument {
  path: string;
  status: "stale" | "co-changed";
  sections: ReviewReportSection[];
}

export interface ReviewReport {
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  summary: {
    publicApiChanges: number;
    breaking: number;
    staleDocuments: number;
    coChangedDocuments: number;
    unmappedSymbols: number;
    suppressed: number;
  };
  changes: ReviewReportChange[];
  documents: ReviewReportDocument[];
  unmapped: string[];
  suppressed: Array<{ symbol: string; reason?: string }>;
  verdict: "clean" | "stale" | "breaking";
}

/** Renders the stable Markdown body used by the review Action comment. */
export function renderReviewMarkdown(
  report: ReviewReport,
  maxSymbols = 30,
): string {
  const lines = ["<!-- aidoc-review -->", "### AiDoc: documentation impact"];
  if (report.summary.publicApiChanges === 0) {
    lines.push("No public API changes in this pull request.");
    return lines.join("\n");
  }

  const staleDocuments = sortedDocuments(report.documents, "stale");
  const coChangedDocuments = sortedDocuments(report.documents, "co-changed");
  const staleSectionCount = staleDocuments.reduce(
    (count, document) => count + document.sections.length,
    0,
  );
  const publicCount = report.summary.publicApiChanges;
  const breakingCount = report.summary.breaking;
  lines.push(
    "",
    `**${publicCount} public API ${plural(publicCount, "change", "changes")}**, ${breakingCount} potentially breaking. **${staleSectionCount} documentation ${plural(staleSectionCount, "section", "sections")}** mention changed symbols and were not updated in this PR.`,
    "",
    "| Symbol | Change | Before | After |",
    "| --- | --- | --- | --- |",
  );

  const changes = [...report.changes].sort(compareReviewChanges);
  const visibleChanges = changes.slice(0, normalizedLimit(maxSymbols));
  for (const change of visibleChanges) {
    lines.push(
      `| \`${escapeTable(change.qualifiedName)}\` | ${changeLabel(change)} | ${signatureCell(change.before)} | ${signatureCell(change.after)} |`,
    );
  }
  appendMore(lines, changes.length - visibleChanges.length);

  const staleRows = staleDocuments.flatMap((document) =>
    [...document.sections]
      .sort(compareReviewSections)
      .map(
        (section) =>
          `- \`${escapeTable(document.path)}\` > ${section.section}: ${[...section.symbols]
            .sort(compareStrings)
            .map((symbol) => `\`${escapeTable(symbol)}\``)
            .join(", ")}`,
      ),
  );
  if (staleRows.length > 0) {
    lines.push("", "**Needs a documentation update**", ...staleRows.slice(0, 20));
    appendMore(lines, staleRows.length - 20);
  }

  if (coChangedDocuments.length > 0) {
    lines.push(
      "",
      "**Updated in this PR**",
      ...coChangedDocuments
        .slice(0, 20)
        .map((document) => `- \`${escapeTable(document.path)}\``),
    );
    appendMore(lines, coChangedDocuments.length - 20);
  }

  const unmapped = [...report.unmapped].sort(compareStrings);
  if (unmapped.length > 0) {
    lines.push(
      "",
      `**Not mentioned in any documentation:** ${unmapped
        .slice(0, 20)
        .map((name) => `\`${escapeTable(name)}\``)
        .join(", ")}`,
    );
    appendMore(lines, unmapped.length - 20);
  }
  lines.push(
    "",
    `<sub>Deterministic AST analysis; no model was used. Suppress a symbol with \`.aidocignore\`. <a href="https://github.com/mr-min-max/aidoc">AiDoc</a></sub>`,
  );
  return lines.join("\n");
}

/** Renders the terminal report without a Markdown table. */
export function renderReviewText(
  report: ReviewReport,
  maxSymbols = 30,
): string {
  const lines: string[] = [];
  if (report.summary.publicApiChanges === 0) {
    lines.push("No public API changes in this pull request.");
  } else {
    lines.push(
      `AiDoc: documentation impact (${report.verdict})`,
      `${report.summary.publicApiChanges} public API ${plural(report.summary.publicApiChanges, "change", "changes")}; ${report.summary.breaking} potentially breaking.`,
    );
    const changes = [...report.changes].sort(compareReviewChanges);
    const visibleChanges = changes.slice(0, normalizedLimit(maxSymbols));
    for (const change of visibleChanges) {
      lines.push(
        `${change.qualifiedName}: ${changeLabel(change)}${change.before === undefined ? "" : `; before ${change.before}`} ${change.after === undefined ? "" : `after ${change.after}`}`.trim(),
      );
    }
    appendMore(lines, changes.length - visibleChanges.length);
    for (const document of sortedDocuments(report.documents)) {
      lines.push(
        `${document.status === "stale" ? "Needs update" : "Updated"}: ${document.path} > ${[...document.sections]
          .sort(compareReviewSections)
          .map(
            (section) =>
              `${section.section}: ${[...section.symbols].sort(compareStrings).join(", ")}`,
          )
          .join("; ")}`,
      );
    }
    if (report.unmapped.length > 0) {
      lines.push(`Not mentioned: ${[...report.unmapped].sort(compareStrings).join(", ")}`);
    }
  }
  if (report.summary.suppressed > 0) {
    lines.push(
      `${report.summary.suppressed} suppressed ${plural(report.summary.suppressed, "change", "changes")} from .aidocignore.`,
    );
  }
  return lines.join("\n");
}

/** Serializes a review report with canonical key ordering for machine consumers. */
export function serializeReviewReport(report: ReviewReport): string {
  return canonicalStringify(report);
}

function sortedDocuments(
  documents: readonly ReviewReportDocument[],
  status?: ReviewReportDocument["status"],
): ReviewReportDocument[] {
  return documents
    .filter((document) => status === undefined || document.status === status)
    .sort((left, right) => compareStrings(left.path, right.path));
}

function compareReviewSections(
  left: ReviewReportSection,
  right: ReviewReportSection,
): number {
  return (
    compareStrings(left.slug, right.slug) ||
    compareStrings(left.section, right.section)
  );
}

function compareReviewChanges(
  left: ReviewReportChange,
  right: ReviewReportChange,
): number {
  return (
    compareStrings(left.path, right.path) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.qualifiedName, right.qualifiedName) ||
    compareStrings(left.category, right.category) ||
    compareStrings(left.id, right.id)
  );
}

function appendMore(lines: string[], count: number): void {
  if (count > 0) lines.push(`+${count} more`);
}

function changeLabel(change: ReviewReportChange): string {
  const facets = change.changedContractFacets ?? [];
  const label = change.category === "contract-changed" && facets.length > 0 ? facets.join(", ") : change.category;
  return change.risk === "potentially-breaking" ? `${label} (breaking)` : label;
}

function signatureCell(signature: string | undefined): string {
  return signature === undefined ? "" : `\`${escapeSignature(signature)}\``;
}

function escapeSignature(signature: string): string {
  return signature.replaceAll("|", "\\|");
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|");
}

function normalizedLimit(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
