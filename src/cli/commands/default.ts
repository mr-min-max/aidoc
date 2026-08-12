import prompts from "prompts";
import { executeUpdateCommand } from "./update";
import { toPlanError } from "../../impact/canonical";
import { createImpactPlan } from "../../impact/planner";
import {
  hasDocumentationImpact,
  resolveDocumentationTargets,
} from "../../impact/targets";
import { formatImpactPlan } from "../../output/impact";
import { RepositoryWriteScope } from "../../security/repository-writer";

export interface DefaultCommandRuntime {
  readonly interactive: boolean;
  confirmUpdate(): Promise<boolean>;
  showHelp(): void;
  stdout(value: string): void;
  stderr(value: string): void;
}

const DEFAULT_HELP = [
  "Usage: aidoc <command>",
  "",
  "Commands:",
  "  plan      Plan documentation impact without a provider",
  "  update    Select and update affected Markdown documents",
  "  check     Check documentation freshness",
  "  score     Score documentation quality",
].join("\n");

export async function executeDefaultCommand(
  runtime: DefaultCommandRuntime = createDefaultRuntime(),
  cwd = process.cwd(),
): Promise<0 | 1 | 2> {
  if (!runtime.interactive) {
    runtime.showHelp();
    return 0;
  }

  try {
    const result = await createImpactPlan({ cwd });
    const scope = await RepositoryWriteScope.open(cwd);
    const targets = await resolveDocumentationTargets({
      plan: result.plan,
      scope,
    });
    runtime.stdout(
      `${formatImpactPlan(result.plan, false, {
        targets,
        requiresExplicitTarget:
          targets.length === 0 && hasDocumentationImpact(result.plan),
      })}\n`,
    );

    if (!hasDocumentationImpact(result.plan) || targets.length === 0) return 0;
    if (!(await runtime.confirmUpdate())) return 0;
    return executeUpdateCommand({}, cwd);
  } catch (error: unknown) {
    const planError = toPlanError(error);
    runtime.stderr(`${planError.code}: ${planError.message}\n`);
    return 1;
  }
}

function createDefaultRuntime(): DefaultCommandRuntime {
  return {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    confirmUpdate: async () => {
      const response = await prompts({
        type: "confirm",
        name: "confirm",
        message: "Prepare an update now?",
        initial: true,
      });
      return response.confirm === true;
    },
    showHelp: () => process.stdout.write(`${DEFAULT_HELP}\n`),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}
