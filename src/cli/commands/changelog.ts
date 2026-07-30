import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import {
  enforceGeneratedOutput,
  hasGenerationInput,
  loadCommandContext,
  toWriteDocOptions,
  writeDoc,
} from "../context";
import {
  readExistingMarkdown,
  validateChangelogEntry,
} from "../../output/markdown";
import { getCommitsSince, getLatestTag } from "../../git/history";

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
      const outputPath = path.resolve(ctx.cwd, options.output);
      const header =
        "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n";
      const existing = readExistingMarkdown(outputPath);
      const content = existing
        ? existing.replace(/^# Changelog.*?\n\n/s, header + entry + "\n\n")
        : header + entry;

      await writeDoc(
        outputPath,
        content,
        toWriteDocOptions(options, options.output),
      );
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to generate CHANGELOG"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
