import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import * as fs from "fs";
import * as path from "path";
import { loadCommandContext } from "../context.js";
import { analyzeCodebase } from "../../core/analyzer.js";
import { displayDiff } from "../../output/diff-display.js";

/** Strips ```json ... ``` fences an LLM may wrap around a JSON response. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return match ? match[1].trim() : trimmed;
}

export const annotateCommand = new Command("annotate")
  .description("Add JSDoc/TSDoc comments to undocumented functions")
  .option("--file <path>", "Annotate a specific file")
  .option("--all", "Annotate all files in the project")
  .option("--dry-run", "Preview without writing changes")
  .option("--mock", "Use mock LLM response for testing")
  .action(async (options) => {
    const spinner = ora("Finding undocumented functions...").start();
    try {
      const ctx = await loadCommandContext(options);
      const include = options.file ? [options.file] : ctx.config.include;
      const modules = await analyzeCodebase(
        ctx.cwd,
        include,
        ctx.config.exclude,
      );

      // Find functions without documentation
      const undocumented = modules.flatMap((m) =>
        m.functions
          .filter((f) => !f.existingDoc)
          .map((f) => ({ ...f, filePath: m.filePath })),
      );
      if (undocumented.length === 0) {
        spinner.succeed(
          chalk.green("All exported functions are already documented! 🎉"),
        );
        return;
      }
      spinner.succeed(
        chalk.yellow(`Found ${undocumented.length} undocumented functions`),
      );

      const genSpinner = ora("Generating JSDoc comments with AI...").start();
      const response = await ctx.generator.generateJsDoc(undocumented);
      let annotations: { name: string; jsdoc: string }[];
      try {
        annotations = JSON.parse(stripCodeFences(response));
      } catch {
        throw new Error(
          "LLM returned malformed JSON for annotations. Try again or use --mock. " +
            "Raw response:\n" +
            response.slice(0, 500),
        );
      }
      genSpinner.succeed(chalk.green("JSDoc comments generated!"));

      for (const ann of annotations) {
        const func = undocumented.find((f) => f.name === ann.name);
        if (!func) continue;
        const filePath = (func as any).filePath;
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        const insertLine = func.lineRange[0] - 1;
        const indent = lines[insertLine]?.match(/^(\s*)/)?.[1] || "";
        const jsdocLines = ann.jsdoc
          .split("\n")
          .map((l) => indent + l)
          .join("\n");
        lines.splice(insertLine, 0, jsdocLines);
        const newContent = lines.join("\n");

        console.log(chalk.cyan(`\n📝 ${path.basename(filePath)}: ${ann.name}`));
        displayDiff(path.basename(filePath), content, newContent);

        if (!options.dryRun) {
          const { apply } = await prompts({
            type: "confirm",
            name: "apply",
            message: `Apply JSDoc to ${ann.name}?`,
            initial: true,
          });
          if (apply) {
            fs.writeFileSync(filePath, newContent, "utf8");
            console.log(chalk.green(`✔ Updated ${path.basename(filePath)}`));
          }
        }
      }
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to annotate code"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
