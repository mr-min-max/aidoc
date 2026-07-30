import { Command } from "commander";
import chalk from "chalk";
import { checkDocumentationFreshness } from "../../core/freshness";

interface CheckOptions {
  target: string;
  since: string;
  json?: boolean;
}

export async function runCheckCommand(
  options: CheckOptions,
  cwd = process.cwd(),
): Promise<number> {
  const report = await checkDocumentationFreshness(
    cwd,
    options.target,
    options.since,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    const color =
      report.status === "clean" || report.status === "co-changed"
        ? chalk.green
        : report.status === "stale"
          ? chalk.yellow
          : chalk.red;
    process.stdout.write(`${color(report.message)}\n`);
  }

  if (report.status === "clean" || report.status === "co-changed") return 0;
  if (report.status === "stale" || report.status === "missing") return 1;
  return 2;
}

export function createCheckCommand(): Command {
  return new Command("check")
    .description("Check whether a document co-changed with AST-backed source")
    .option("--target <file>", "Documentation file to check", "README.md")
    .option("--since <ref>", "Git ref to compare against", "HEAD~1")
    .option("--json", "Print a machine-readable report")
    .action(async (options: CheckOptions) => {
      process.exitCode = await runCheckCommand(options);
    });
}

export const checkCommand = createCheckCommand();
