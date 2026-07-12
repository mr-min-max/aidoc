import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import { analyzeCodebase } from "../../core/analyzer.js";
import { loadCommandContext, writeDoc } from "../context.js";

export const diagramCommand = new Command("diagram")
  .description("Generate architecture diagram (Mermaid) from code analysis")
  .option("-o, --output <path>", "Output file path", "./docs/architecture.md")
  .option("--dry-run", "Preview without writing")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options) => {
    const spinner = ora("Analyzing project architecture...").start();
    try {
      const ctx = await loadCommandContext(options);
      const modules = await analyzeCodebase(
        ctx.cwd,
        ctx.config.include,
        ctx.config.exclude,
      );

      if (modules.length === 0) {
        spinner.warn(chalk.yellow("No supported source files found."));
        return;
      }
      spinner.succeed(chalk.green(`Analyzed ${modules.length} modules`));

      const genSpinner = ora("Generating architecture diagram...").start();
      const diagram = await ctx.generator.generateDiagram(modules);
      genSpinner.succeed(chalk.green("Architecture diagram generated!"));

      const output = `# Architecture\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
      await writeDoc(path.resolve(ctx.cwd, options.output), output, {
        dryRun: options.dryRun,
        label: options.output,
      });
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to generate diagram"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
