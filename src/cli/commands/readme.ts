import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import { analyzeCodebase } from "../../core/analyzer";
import {
  enforceGeneratedOutput,
  hasGenerationInput,
  loadCommandContext,
  readProjectInfo,
  toWriteDocOptions,
  writeDoc,
} from "../context";
import { validateGeneratedContent } from "../../output/markdown";

export const readmeCommand = new Command("readme")
  .description("Generate README.md from code analysis")
  .option("-o, --output <path>", "Output file path", "./README.md")
  .option("--dry-run", "Preview without writing to file")
  .option("--yes", "Apply generated changes without an interactive prompt")
  .option("--strict-output", "Fail instead of writing malformed Markdown")
  .option("--no-badges", "Skip badges generation")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options) => {
    const spinner = ora("Scanning codebase...").start();
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
          "No supported source files found. Make sure your project has .ts, .js, or .py files.",
        )
      ) {
        spinner.warn(
          chalk.yellow(
            "No supported source files found. Make sure your project has .ts, .js, or .py files.",
          ),
        );
        return;
      }
      spinner.succeed(
        chalk.green(`Found ${modules.length} modules to analyze`),
      );

      // Read package.json for project info
      const {
        name: projectName,
        description,
        dependencies,
      } = readProjectInfo(ctx.cwd);

      const genSpinner = ora("Generating README with AI...").start();
      const readmeCtx = {
        projectName,
        description,
        modules,
        dependencies,
        badges: options.badges !== false,
        tableOfContents: ctx.config.readme.tableOfContents,
        installSection: ctx.config.readme.installSection,
        usageExamples: ctx.config.readme.usageExamples,
      };
      // Stream LLM output live when a real provider supports it; mock keeps
      // its plain path. Falls back to non-streaming inside generateReadmeStream.
      let readme: string;
      if (ctx.isMock) {
        readme = await ctx.generator.generateReadme(readmeCtx as any);
      } else {
        readme = await (ctx.generator as any).generateReadmeStream(
          readmeCtx as any,
          (token: string) => {
            genSpinner.text = token.slice(-40);
          }, // live tail
        );
      }
      enforceGeneratedOutput(
        validateGeneratedContent(readme),
        options,
        "README",
      );
      genSpinner.succeed(chalk.green("README generated!"));

      await writeDoc(
        path.resolve(ctx.cwd, options.output),
        readme,
        toWriteDocOptions(options, options.output),
      );
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to generate README"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
