import { Command } from "commander";
import chalk from "chalk";
import chokidar from "chokidar";
import * as path from "path";
import { loadCommandContext, writeDoc, readProjectInfo } from "../context.js";
import { analyzeCodebase } from "../../core/analyzer.js";
import { debounce, isRelevantChange } from "../../core/watcher.js";
import { logger } from "../../core/logger.js";

export const watchCommand = new Command("watch")
  .description("Watch source files and regenerate docs live on save")
  .option("--target <file>", "Doc file to keep fresh", "./README.md")
  .option("--auto", "Write without prompting (for live demos)")
  .option("--mock", "Use mock generator (no API key needed)")
  .action(async (options) => {
    const ctx = await loadCommandContext(options);
    const targetPath = path.resolve(ctx.cwd, options.target);
    const globs = ctx.config.include.map((g) => path.join(ctx.cwd, g));

    console.log(chalk.cyan(`👁  Watching ${ctx.config.include.join(", ")}…`));
    console.log(chalk.gray(`    Target: ${options.target}   (Ctrl-C to stop)`));
    console.log(
      chalk.gray(
        `    ${options.auto ? "Auto-write ON" : "Prompt before writing"}`,
      ),
    );

    const regenerate = debounce(async () => {
      const start = Date.now();
      try {
        logger.info("Change detected — regenerating…");
        const modules = await analyzeCodebase(
          ctx.cwd,
          ctx.config.include,
          ctx.config.exclude,
        );
        const {
          name: projectName,
          description,
          dependencies,
        } = readProjectInfo(ctx.cwd);
        const readme = await ctx.generator.generateReadme({
          projectName,
          description,
          modules,
          dependencies,
        } as any);
        await writeDoc(targetPath, readme, {
          auto: options.auto,
          label: options.target,
        });
        console.log(chalk.green(`✔ Regenerated in ${Date.now() - start}ms`));
      } catch (error: any) {
        logger.error(`Regeneration failed: ${error.message}`);
      }
    }, 300);

    const watcher = chokidar.watch(globs, {
      ignored: ctx.config.exclude,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on("all", (_event, changedPath: string) => {
      if (!isRelevantChange(changedPath)) return;
      regenerate();
    });

    // Keep the process alive; clean exit on Ctrl-C.
    await new Promise(() => {});
  });
