import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  loadCommandContext,
  prepareDocumentTarget,
  type CommandOptions,
  writeDoc,
} from "../context";
import { buildUpdateContext } from "../../core/differ";
import { createImpactPlan } from "../../impact/planner";
import type { ImpactPlan } from "../../impact/types";
import { formatImpactPlan } from "../../output/impact";
import {
  getSafeErrorDiagnostic,
  getTrustErrorExitCode,
} from "../../security/diagnostics";

export interface UpdateCommandOptions extends CommandOptions {
  base?: string;
  since?: string;
  target?: string;
}

/** Executes the plan-first update workflow and returns its process status. */
export async function executeUpdateCommand(
  options: UpdateCommandOptions,
  cwd = process.cwd(),
): Promise<0 | 1 | 2> {
  const spinner = ora("Planning documentation impact...").start();
  try {
    const base = resolveUpdateBase(options.base, options.since);
    const result = await createImpactPlan({ cwd, base });
    spinner.stop();
    console.log(formatImpactPlan(result.plan));

    if (!hasDocumentationImpact(result.plan)) return 0;

    const target = options.target ?? "./README.md";
    const dryRun = options.dryRun ?? false;
    const documentTarget = await prepareDocumentTarget(cwd, target, dryRun);
    if (documentTarget.existingText === null) {
      console.error(
        chalk.red(
          "Documentation target does not exist. Run 'aidoc readme' first to generate it.",
        ),
      );
      return 1;
    }

    const ctx = await loadCommandContext(options, cwd);
    const genSpinner = ora("Updating documentation with AI...").start();
    try {
      const updatedDoc = await ctx.generator.generateUpdate(
        buildUpdateContext(documentTarget.existingText, result.providerContext),
      );
      genSpinner.succeed(chalk.green("Documentation updated!"));
      await writeDoc(documentTarget, updatedDoc, { dryRun });
      return 0;
    } catch (error: unknown) {
      genSpinner.fail(chalk.red("Failed to update documentation"));
      throw error;
    }
  } catch (error: unknown) {
    spinner.fail(chalk.red("Failed to update documentation"));
    console.error(chalk.red(getSafeErrorDiagnostic(error).message));
    return getTrustErrorExitCode(error);
  }
}

export const updateCommand = new Command("update")
  .description(
    "Update existing documentation from a bounded documentation-impact plan",
  )
  .option("--base <ref>", "Explicit comparison base")
  .option("--since <ref>", "Compatibility alias for --base")
  .option("--target <file>", "Which doc file to update", "./README.md")
  .option("--dry-run", "Preview without writing")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options: UpdateCommandOptions) => {
    const exitCode = await executeUpdateCommand(options);
    if (exitCode !== 0) process.exit(exitCode);
  });

function resolveUpdateBase(
  base: string | undefined,
  since: string | undefined,
): string | undefined {
  if (base !== undefined && since !== undefined && base !== since) {
    throw new Error("--base and --since must match when both are provided.");
  }
  return base ?? since;
}

function hasDocumentationImpact(plan: ImpactPlan): boolean {
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
