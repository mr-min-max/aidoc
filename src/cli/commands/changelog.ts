import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  enforceGeneratedOutput,
  hasGenerationInput,
  loadCommandContext,
  prepareDocumentTarget,
  toWriteDocOptions,
  writeDoc,
} from "../context";
import { validateChangelogEntry } from "../../output/markdown";
import { getCommitsSince, getLatestTag } from "../../git/history";
import {
  getSafeErrorDiagnostic,
  getTrustErrorExitCode,
} from "../../security/diagnostics";

export const changelogCommand = new Command("changelog")
  .description("Generate CHANGELOG from git history")
  .option("--from <ref>", "Start ref (tag, commit, or branch)")
  .option("--to <ref>", "End ref", "HEAD")
  .option("--version <ver>", "Version string for the entry", "Unreleased")
  .option("-o, --output <path>", "Output file path", "./CHANGELOG.md")
  .option("--dry-run", "Preview without writing")
  .option("--yes", "Apply generated changes without an interactive prompt")
  .option("--strict-output", "Fail instead of writing malformed Markdown")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options) => {
    const spinner = ora("Reading git history...").start();
    try {
      const ctx = await loadCommandContext(options);
      const fromRef = options.from || (await getLatestTag()) || "HEAD~20";
      const toRef = options.to;
      const commits = await getCommitsSince(fromRef, toRef);

      if (
        !hasGenerationInput(
          commits.length > 0,
          options,
          "No commits found in the specified range.",
        )
      ) {
        spinner.warn(chalk.yellow("No commits found in the specified range."));
        return;
      }
      const target = await prepareDocumentTarget(
        ctx.cwd,
        options.output,
        options.dryRun,
      );
      spinner.succeed(chalk.green(`Found ${commits.length} commits`));

      const genSpinner = ora("Generating CHANGELOG entry...").start();
      const entry = await ctx.generator.generateChangelog({
        commits,
        version: options.version,
        date: new Date().toISOString().split("T")[0],
        fromRef,
        toRef,
      } as any);
      enforceGeneratedOutput(
        validateChangelogEntry(entry, options.version),
        options,
        "CHANGELOG entry",
      );
      genSpinner.succeed(chalk.green("CHANGELOG entry generated!"));

      // Changelog prepends to an existing file rather than replacing it.
      const header =
        "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
      const existing = target.existingText;
      const content = existing
        ? existing.replace(/^# Changelog.*?\n\n/s, header + entry + "\n\n")
        : header + entry;

      await writeDoc(target, content, toWriteDocOptions(options));
    } catch (error: unknown) {
      spinner.fail(chalk.red("Failed to generate CHANGELOG"));
      console.error(chalk.red(getSafeErrorDiagnostic(error).message));
      process.exit(getTrustErrorExitCode(error));
    }
  });
