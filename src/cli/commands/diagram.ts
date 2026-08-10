import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { analyzeCodebase } from "../../core/analyzer";
import {
  enforceGeneratedOutput,
  hasGenerationInput,
  loadCommandContext,
  prepareDocumentTarget,
  toWriteDocOptions,
  writeDoc,
} from "../context";
import { validateMermaidSource } from "../../output/markdown";
import {
  getSafeErrorDiagnostic,
  getTrustErrorExitCode,
} from "../../security/diagnostics";

export const diagramCommand = new Command("diagram")
  .description("Generate architecture diagram (Mermaid) from code analysis")
  .option("-o, --output <path>", "Output file path", "./docs/architecture.md")
  .option("--dry-run", "Preview without writing")
  .option("--yes", "Apply generated changes without an interactive prompt")
  .option("--strict-output", "Fail instead of writing malformed Markdown")
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
      const target = await prepareDocumentTarget(
        ctx.cwd,
        options.output,
        options.dryRun,
      );
      spinner.succeed(chalk.green(`Analyzed ${modules.length} modules`));

      const genSpinner = ora("Generating architecture diagram...").start();
      const diagram = await ctx.generator.generateDiagram(modules);
      enforceGeneratedOutput(
        validateMermaidSource(diagram),
        options,
        "Architecture diagram",
      );
      genSpinner.succeed(chalk.green("Architecture diagram generated!"));

      const output = `# Architecture\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
      await writeDoc(
        target,
        output,
        toWriteDocOptions(options),
      );
    } catch (error: unknown) {
      spinner.fail(chalk.red("Failed to generate diagram"));
      console.error(chalk.red(getSafeErrorDiagnostic(error).message));
      process.exit(getTrustErrorExitCode(error));
    }
  });
