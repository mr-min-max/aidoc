import { Command } from "commander";
import { toPlanError } from "../../impact/canonical";
import { createImpactPlan } from "../../impact/planner";
import { inspectDocumentationTargets } from "../../impact/targets";
import type { PlanCommandResult } from "../../impact/types";
import {
  formatImpactPlan,
  serializePlanCommandResult,
} from "../../output/impact";

export interface PlanCommandOptions {
  base?: string;
  head?: string;
  json?: boolean;
  maxContextBytes?: string | number;
  verbose?: boolean;
}

export interface PlanCommandIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

const processIO: PlanCommandIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

/** Executes the deterministic impact plan command and emits text or canonical JSON. */
export async function executePlanCommand(
  options: PlanCommandOptions,
  io: PlanCommandIO = processIO,
  cwd = process.cwd(),
): Promise<0 | 1> {
  try {
    const result = await createImpactPlan({
      cwd,
      base: options.base,
      head: options.head,
      maxContextBytes: normalizeContextBudget(options.maxContextBytes),
    });
    const commandResult: PlanCommandResult = { ok: true, plan: result.plan };
    if (options.json) {
      io.stdout(serializePlanCommandResult(commandResult));
    } else {
      const targets = await inspectDocumentationTargets({
        plan: result.plan,
        cwd,
      });
      io.stdout(
        `${formatImpactPlan(result.plan, options.verbose, {
          targets,
          requiresExplicitTarget:
            targets.length === 0 && result.plan.documentation.length > 0,
        })}\n`,
      );
    }
    return 0;
  } catch (error: unknown) {
    const planError = toPlanError(error);
    const commandResult: PlanCommandResult = { ok: false, error: planError };
    if (options.json) {
      io.stdout(serializePlanCommandResult(commandResult));
    } else {
      io.stderr(`${planError.code}: ${planError.message}\n`);
    }
    return 1;
  }
}

export const planCommand = new Command("plan")
  .description("Plan deterministic documentation impact from Git changes")
  .option("--base <ref>", "Explicit comparison base")
  .option("--head <ref>", "Compare two committed refs")
  .option("--json", "Emit only the versioned JSON result")
  .option(
    "--max-context-bytes <count>",
    "Override the provider-context byte ceiling",
  )
  .action(async (options: PlanCommandOptions, command: Command) => {
    const globalOptions = command.optsWithGlobals<{ verbose?: boolean }>();
    process.exitCode = await executePlanCommand({
      ...options,
      verbose: globalOptions.verbose,
    });
  });

function normalizeContextBudget(value: string | number | undefined): unknown {
  if (typeof value !== "string") return value;
  if (!/^[0-9]+$/u.test(value)) return value;
  return Number(value);
}
