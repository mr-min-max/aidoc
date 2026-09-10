import { Command } from "commander";
import chalk from "chalk";
import { checkDocumentationFreshness } from "../../core/freshness";

interface CheckOptions {
  target?: string;
  since?: string;
  base?: string;
  to?: string;
  json?: boolean;
}

/** Runs the CLI freshness check and maps the report status to an exit code. */
export async function runCheckCommand(
  options: CheckOptions,
  cwd = process.cwd(),
): Promise<number> {
  const report = await checkDocumentationFreshness(
    cwd,
    options.target,
    options.base ?? options.since ?? "HEAD~1",
    options.to ?? "HEAD",
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
    for (const section of report.sections) {
      process.stdout.write(`  - ${section.section}: ${section.symbols.join(", ")}\n`);
    }
    if (report.unmappedSymbols.length > 0) {
      process.stdout.write(
        `${chalk.dim(`  unmapped: ${report.unmappedSymbols.join(", ")}`)}\n`,
      );
    }
  }

  if (report.status === "clean" || report.status === "co-changed") return 0;
  if (report.status === "stale" || report.status === "missing") return 1;
  return 2;
}

/** Creates the Commander definition for the `staledocs check` command. */
export function createCheckCommand(): Command {
  return new Command("check")
    .description("Check whether documentation sections mention changed symbols")
    .option(
      "--target <file>",
      "Documentation file to check (default: the repository README as discovered)",
    )
    .option("--since <ref>", "Git ref to compare against", "HEAD~1")
    .option("--base <ref>", "Alias for --since")
    .option("--to <ref>", "Git ref to compare to (default: working tree)")
    .option("--json", "Print a machine-readable report")
    .action(async (options: CheckOptions) => {
      process.exitCode = await runCheckCommand(options);
    });
}

export const checkCommand = createCheckCommand();
