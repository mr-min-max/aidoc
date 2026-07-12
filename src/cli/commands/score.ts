import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import * as fs from "fs";
import { analyzeCodebase } from "../../core/analyzer.js";
import { scoreModules, BAND_META } from "../../core/score.js";
import { writeDoc } from "../context.js";
import { loadConfig } from "../../config/loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const scoreCommand = new Command("score")
  .description("Score documentation health (0-100) from AST coverage")
  .option("--dir <path>", "Directory to score (default: cwd)")
  .option("-o, --output <path>", "Write a markdown report to this path")
  .option("--json", "Emit JSON instead of text (for CI)")
  .option(
    "--min <n>",
    "Exit non-zero if score is below this threshold",
    parseInt,
  )
  .option("--dry-run", "Preview report without writing")
  .action(async (options) => {
    const spinner = ora("Scoring documentation health...").start();
    try {
      const cwd = options.dir || process.cwd();
      const config = loadConfig();
      const modules = await analyzeCodebase(
        cwd,
        config.include,
        config.exclude,
      );
      const result = scoreModules(modules);
      spinner.succeed(chalk.green("Scored"));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const band = BAND_META[result.band];
        console.log(
          chalk.bold(
            `\n${band.emoji} Documentation health: ${result.score}/100 (${band.label})`,
          ),
        );
        console.log(
          chalk.gray(
            `Symbols documented: ${result.documentedSymbols}/${result.totalSymbols}`,
          ),
        );
        if (result.lowQualityCount > 0) {
          console.log(
            chalk.yellow(`Stub/low-quality docs: ${result.lowQualityCount}`),
          );
        }
        console.log("\nPer-module:");
        for (const m of result.modules) {
          const cov = chalk.cyan(`${m.coverage}%`);
          const tail = m.undocumented.length
            ? chalk.gray("(" + m.undocumented.length + " undocumented)")
            : chalk.green("✓");
          console.log(`  ${cov}  ${path.basename(m.filePath)}  ${tail}`);
        }
      }

      if (options.output) {
        const band = BAND_META[result.band];
        const tplSrc = fs.readFileSync(
          path.resolve(__dirname, "../../templates/score.hbs"),
          "utf8",
        );
        const report = Handlebars.compile(tplSrc)({ result, bandMeta: band });
        await writeDoc(path.resolve(options.output), report, {
          dryRun: options.dryRun,
          label: options.output,
        });
      }

      if (options.min !== undefined && result.score < options.min) {
        console.error(
          chalk.red(
            `\nScore ${result.score} is below threshold ${options.min}.`,
          ),
        );
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red("Failed to score documentation"));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
