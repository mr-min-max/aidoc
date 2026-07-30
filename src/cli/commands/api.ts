import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import { analyzeCodebase } from "../../core/analyzer";
import {
  enforceGeneratedOutput,
  hasGenerationInput,
  loadCommandContext,
  toWriteDocOptions,
  writeDoc,
} from "../context";
import { validateGeneratedContent } from "../../output/markdown";

export const apiCommand = new Command("api")
  .description("Generate API documentation from code analysis")
  .option("-o, --output <path>", "Output file path", "./docs/API.md")
  .option("--dry-run", "Preview without writing to file")
  .option("--yes", "Apply generated changes without an interactive prompt")
  .option("--strict-output", "Fail instead of writing malformed Markdown")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options) => {
    const spinner = ora("Scanning codebase for API symbols...").start();
    try {
      const ctx = await loadCommandContext(options);
      const modules = await analyzeCodebase(
        ctx.cwd,
        ctx.config.include,
        ctx.config.exclude,
      );

      if (
        !hasGenerationInput(
          modules.length > 0,
          options,
          "No supported source files found.",
        )
      ) {
        spinner.warn(chalk.yellow("No supported source files found."));
        return;
      }
      spinner.succeed(chalk.green(`Found ${modules.length} modules`));

      const genSpinner = ora("Generating API documentation...").start();
      const apiDocs = await ctx.generator.generateApiDocs(modules);
      enforceGeneratedOutput(
        validateGeneratedContent(apiDocs),
        options,
        "API documentation",
      );
      genSpinner.succeed(chalk.green("API documentation generated!"));

      await writeDoc(
        path.resolve(ctx.cwd, options.output),
        apiDocs,
        toWriteDocOptions(options, options.output),
      );
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to generate API docs"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
