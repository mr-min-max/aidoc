import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  loadCommandContext,
  toWriteDocOptions,
  type CommandOptions,
  type DocumentTarget,
  writeDoc,
} from "../context";
import { buildUpdateContext } from "../../core/differ";
import { createImpactPlan } from "../../impact/planner";
import {
  hasDocumentationImpact,
  projectProviderContextForTarget,
  resolveDocumentationTargets,
  type ResolvedDocumentationTarget,
} from "../../impact/targets";
import { formatImpactPlan } from "../../output/impact";
import {
  getSafeErrorDiagnostic,
  getTrustErrorExitCode,
} from "../../security/diagnostics";
import { RepositoryWriteScope } from "../../security/repository-writer";
import {
  selectUpdateTargets,
  type UpdateSelectionRuntime,
} from "../update-target-selection";

export interface UpdateCommandOptions extends CommandOptions {
  base?: string;
  since?: string;
  target?: string | string[];
  all?: boolean;
}

/** Executes the plan-first update workflow and returns its process status. */
export async function executeUpdateCommand(
  options: UpdateCommandOptions,
  cwd = process.cwd(),
  selectionRuntime?: UpdateSelectionRuntime,
): Promise<0 | 1 | 2> {
  const spinner = ora("Planning documentation impact...").start();
  try {
    const base = resolveUpdateBase(options.base, options.since);
    const explicitTargets = normalizeTargets(options.target);
    if (explicitTargets.length > 0 && options.all === true) {
      throw new Error("--target and --all cannot be used together.");
    }

    const result = await createImpactPlan({ cwd, base });
    spinner.stop();

    if (!hasDocumentationImpact(result.plan)) {
      console.log(formatImpactPlan(result.plan));
      return 0;
    }

    const scope = await RepositoryWriteScope.open(cwd);
    const candidates = await resolveDocumentationTargets({
      plan: result.plan,
      scope,
      explicitTargets:
        explicitTargets.length === 0 ? undefined : explicitTargets,
    });
    console.log(
      formatImpactPlan(result.plan, false, {
        targets: candidates,
        requiresExplicitTarget: candidates.length === 0,
      }),
    );

    if (candidates.length === 0) {
      console.error(
        chalk.yellow(
          "No safe documentation target is available. Use --target <file> with an existing Markdown file.",
        ),
      );
      return 1;
    }

    const selected = await selectUpdateTargets({
      candidates,
      explicit: explicitTargets.length > 0,
      all: options.all === true,
      runtime: selectionRuntime,
    });
    if (selected.length === 0) {
      console.log(
        chalk.yellow("No documentation targets selected. Cancelled."),
      );
      return 0;
    }

    // Every selected target has already been inspected by the one write scope
    // above. Provider construction is deliberately after target selection.
    const ctx = await loadCommandContext(options, cwd);
    let processed = 0;
    for (const target of selected) {
      const documentTarget = documentTargetFromResolved(target);
      const projectedContext = projectProviderContextForTarget(
        result.providerContext,
        target,
      );
      const genSpinner = ora(`Updating ${target.path} with AI...`).start();
      try {
        const updatedDoc = await ctx.generator.generateUpdate(
          buildUpdateContext(documentTarget.existingText!, projectedContext),
        );
        genSpinner.succeed(chalk.green(`Generated ${target.path}`));
        await writeDoc(documentTarget, updatedDoc, toWriteDocOptions(options));

        const wasWritten = documentTargetWasWritten(documentTarget);
        if (!wasWritten && !options.dryRun) {
          console.log(
            chalk.yellow(
              `Update cancelled after ${processed} of ${selected.length} selected targets; remaining targets were skipped.`,
            ),
          );
          return 0;
        }
        processed += 1;
      } catch (error: unknown) {
        genSpinner.fail(chalk.red(`Failed to update ${target.path}`));
        if (selected.length > 1) {
          console.log(
            chalk.yellow(
              `Partial update: ${processed} of ${selected.length} selected targets completed; remaining targets were skipped.`,
            ),
          );
        }
        throw error;
      }
    }

    if (selected.length > 1) {
      console.log(
        `Update progress: ${processed} of ${selected.length} selected targets processed.`,
      );
    }
    return 0;
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
  .option(
    "--target <file>",
    "Existing Markdown file to update",
    collectTarget,
    [],
  )
  .option("--all", "Update every automatically affected document")
  .option("--yes", "Apply every generated diff without prompting")
  .option("--dry-run", "Preview without writing")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options: UpdateCommandOptions) => {
    const exitCode = await executeUpdateCommand(options);
    if (exitCode !== 0) process.exit(exitCode);
  });

function collectTarget(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeTargets(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value];
}

function documentTargetFromResolved(
  target: ResolvedDocumentationTarget,
): DocumentTarget {
  let written = false;
  const prepared = {
    displayPath: target.prepared.displayPath,
    existingText: target.prepared.existingText,
    replaceText: async (content: string): Promise<void> => {
      written = true;
      await target.prepared.replaceText(content);
    },
  };
  return {
    displayPath: target.path,
    existingText: target.prepared.existingText,
    prepared: Object.assign(prepared, {
      wasWritten: (): boolean => written,
    }),
  } as DocumentTarget;
}

function documentTargetWasWritten(target: DocumentTarget): boolean {
  const prepared = target.prepared as
    | (DocumentTarget["prepared"] & { wasWritten?: () => boolean })
    | undefined;
  return prepared?.wasWritten?.() ?? false;
}

function resolveUpdateBase(
  base: string | undefined,
  since: string | undefined,
): string | undefined {
  if (base !== undefined && since !== undefined && base !== since) {
    throw new Error("--base and --since must match when both are provided.");
  }
  return base ?? since;
}
