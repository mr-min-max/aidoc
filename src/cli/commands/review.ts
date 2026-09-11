import { Command } from "commander";
import { getChangedFiles } from "../../git/history";
import { toPlanError } from "../../impact/canonical";
import { createImpactPlan } from "../../impact/planner";
import { assessDocumentationFreshness } from "../../core/freshness";
import type { SymbolChange } from "../../impact/types";
import {
  renderReviewMarkdown,
  renderReviewText,
  serializeReviewReport,
  REVIEW_SCHEMA_VERSION,
  type ReviewReport,
  type ReviewReportChange,
  type ReviewReportDocument,
} from "../../output/review";

export type ReviewFormat = "text" | "markdown" | "json";
export type ReviewFailOn = "none" | "stale" | "breaking";

export interface ReviewCommandOptions {
  base?: string;
  head?: string;
  format?: ReviewFormat;
  failOn?: ReviewFailOn;
  maxSymbols?: string | number;
}

export interface ReviewCommandIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

const processIO: ReviewCommandIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

/** Builds the deterministic review report from a plan and freshness assessments. */
export async function createReviewReport(
  options: ReviewCommandOptions = {},
  cwd = process.cwd(),
): Promise<ReviewReport> {
  const planning = await createImpactPlan({
    cwd,
    base: options.base,
    head: options.head,
  });
  const plan = planning.plan;
  const changedFiles = await getChangedFiles(
    plan.base.commit ?? plan.base.label,
    plan.head.type === "working-tree"
      ? undefined
      : (plan.head.commit ?? plan.head.label),
    cwd,
  );
  const publicChanges = plan.changes
    .filter(isReviewChange)
    .filter(
      (change): change is typeof change & { qualifiedName: string } =>
        change.qualifiedName !== undefined,
    )
    .map(
      (change): ReviewReportChange => ({
        id: change.id,
        qualifiedName: change.qualifiedName,
        kind: change.kind,
        category: change.category,
        risk: change.risk,
        path: change.path,
        ...(change.before === undefined ? {} : { before: change.before }),
        ...(change.after === undefined ? {} : { after: change.after }),
        ...(change.changedContractFacets === undefined
          ? {}
          : { changedContractFacets: [...change.changedContractFacets] }),
      }),
    );

  const changesById = new Map(
    plan.changes.map((change) => [change.id, change]),
  );
  const directReferenceFiles = new Set<string>();
  const unmapped = new Set<string>();
  for (const impact of plan.documentation) {
    const change = changesById.get(impact.changeId);
    if (
      change?.qualifiedName === undefined ||
      change.visibility === "internal"
    ) {
      continue;
    }
    if (isReviewChange(change) && impact.directReferences.length === 0) {
      unmapped.add(change.qualifiedName);
    }
    for (const reference of impact.directReferences) {
      directReferenceFiles.add(reference.file);
    }
  }

  const documents: ReviewReportDocument[] = [];
  for (const path of [...directReferenceFiles].sort(compareStrings)) {
    const freshness = assessDocumentationFreshness({
      plan,
      changedFiles,
      target: path,
      targetExists: true,
    });
    if (freshness.status !== "stale" && freshness.status !== "co-changed") {
      continue;
    }
    documents.push({
      path,
      status: freshness.status,
      sections: freshness.sections,
    });
  }

  const breaking = publicChanges.filter(
    (change) => change.risk === "potentially-breaking",
  ).length;
  const staleDocuments = documents.filter(
    (document) => document.status === "stale",
  ).length;
  const coChangedDocuments = documents.filter(
    (document) => document.status === "co-changed",
  ).length;
  const suppressed = planning.suppressed;
  const report: ReviewReport = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    base: plan.base,
    head: plan.head,
    summary: {
      publicApiChanges: publicChanges.length,
      breaking,
      staleDocuments,
      coChangedDocuments,
      unmappedSymbols: unmapped.size,
      suppressed: plan.ignored.suppressed,
      ...(plan.summary.internalChanges === undefined
        ? {}
        : { internalChanges: plan.summary.internalChanges }),
    },
    changes: publicChanges,
    documents,
    unmapped: [...unmapped].sort(compareStrings),
    suppressed: suppressed
      .map(({ symbol, reason }) => ({
        symbol,
        ...(reason === undefined ? {} : { reason }),
      }))
      .sort((left, right) => compareStrings(left.symbol, right.symbol)),
    ...(plan.boundary === undefined ? {} : { boundary: plan.boundary }),
    verdict: breaking > 0 ? "breaking" : staleDocuments > 0 ? "stale" : "clean",
  };
  return report;
}

/** Executes review output and applies the opt-in fail-on policy. */
export async function executeReviewCommand(
  options: ReviewCommandOptions,
  io: ReviewCommandIO = processIO,
  cwd = process.cwd(),
): Promise<0 | 1 | 2> {
  const format = options.format ?? "text";
  const failOn = options.failOn ?? "none";
  if (!isReviewFormat(format) || !isReviewFailOn(failOn)) {
    io.stderr("Invalid review options: format or fail-on is not supported.\n");
    return 2;
  }

  let report: ReviewReport;
  try {
    report = await createReviewReport(options, cwd);
  } catch (error: unknown) {
    const planError = toPlanError(error);
    io.stderr(`${planError.code}: ${planError.message}\n`);
    return 2;
  }

  const maxSymbols = parseMaxSymbols(options.maxSymbols);
  const output =
    format === "json"
      ? serializeReviewReport(report)
      : format === "markdown"
        ? renderReviewMarkdown(report, maxSymbols)
        : renderReviewText(report, maxSymbols);
  io.stdout(`${output}\n`);
  if (failOn === "breaking" && report.verdict === "breaking") return 1;
  if (
    failOn === "stale" &&
    (report.verdict === "stale" || report.verdict === "breaking")
  )
    return 1;
  return 0;
}

export const reviewCommand = new Command("review")
  .description("Review pull-request documentation impact")
  .option("--base <ref>", "Comparison base")
  .option("--head <ref>", "Comparison head")
  .option("--format <format>", "Output format: text, markdown, or json", "text")
  .option("--fail-on <verdict>", "Fail on none, stale, or breaking", "none")
  .option(
    "--max-symbols <count>",
    "Maximum symbols in text or Markdown output",
    "30",
  )
  .action(async (options: ReviewCommandOptions) => {
    process.exitCode = await executeReviewCommand(options);
  });

function parseMaxSymbols(value: string | number | undefined): number {
  if (value === undefined) return 30;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 30;
}

function isReviewFormat(value: unknown): value is ReviewFormat {
  return value === "text" || value === "markdown" || value === "json";
}

function isReviewFailOn(value: unknown): value is ReviewFailOn {
  return value === "none" || value === "stale" || value === "breaking";
}

function isReviewChange(change: SymbolChange): boolean {
  return (
    change.scope === "symbol" &&
    change.visibility !== "internal" &&
    (change.category === "added" ||
      change.category === "exposed" ||
      change.category === "removed" ||
      change.category === "hidden" ||
      change.category === "moved" ||
      change.category === "contract-changed")
  );
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
