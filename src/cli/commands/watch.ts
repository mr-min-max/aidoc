import { Command } from "commander";
import chalk from "chalk";
import chokidar from "chokidar";
import * as path from "path";
import {
  loadCommandContext,
  prepareDocumentTarget,
  type CommandContext,
  writeDoc,
  readProjectInfo,
} from "../context";
import { analyzeCodebase } from "../../core/analyzer";
import { debounce, isRelevantChange } from "../../core/watcher";
import { logger } from "../../core/logger";
import { getSafeErrorDiagnostic } from "../../security/diagnostics";
import { RepositoryWriteScope } from "../../security/repository-writer";

export interface WatchRegeneratorOptions {
  auto?: boolean;
}

/** Builds one regeneration pass while sharing only the pinned repository scope. */
export function createWatchRegenerator(
  ctx: CommandContext,
  scope: RepositoryWriteScope,
  rawTarget: string,
  options: WatchRegeneratorOptions,
): () => Promise<void> {
  return async () => {
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
      const target = await prepareDocumentTarget(
        ctx.cwd,
        rawTarget,
        false,
        scope,
      );
      const readme = await ctx.generator.generateReadme({
        projectName,
        description,
        modules,
        dependencies,
      } as any);
      await writeDoc(target, readme, { auto: options.auto });
      console.log(chalk.green(`✔ Regenerated in ${Date.now() - start}ms`));
    } catch (error: unknown) {
      logger.error(
        `Regeneration failed: ${getSafeErrorDiagnostic(error).message}`,
      );
    }
  };
}

export const watchCommand = new Command("watch")
  .description("Watch source files and regenerate docs live on save")
  .option("--target <file>", "Doc file to keep fresh", "./README.md")
  .option("--auto", "Write without prompting (for live demos)")
  .option("--mock", "Use mock generator (no API key needed)")
  .action(async (options) => {
    const ctx = await loadCommandContext(options);
    const globs = ctx.config.include.map((g) => path.join(ctx.cwd, g));

    console.log(chalk.cyan(`👁  Watching ${ctx.config.include.join(", ")}…`));
    console.log(chalk.gray(`    Target: ${options.target}   (Ctrl-C to stop)`));
    console.log(
      chalk.gray(
        `    ${options.auto ? "Auto-write ON" : "Prompt before writing"}`,
      ),
    );

    const scope = await RepositoryWriteScope.open(ctx.cwd);
    const regenerate = debounce(
      createWatchRegenerator(ctx, scope, options.target, options),
      300,
    );

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
