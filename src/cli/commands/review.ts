import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import { getChangedFiles } from "../../git/history.js";
import { getParserForFile } from "../../parsers/registry.js";
import { ParsedModule } from "../../parsers/types.js";
import { reviewDocImpact, renderReviewMarkdown } from "../../core/review.js";

const SOURCE_RE = /\.(ts|tsx|js|jsx|py)$/;

/** Parses the changed source files (that still exist) into AST modules. */
async function parseChangedFiles(
  cwd: string,
  changedFiles: string[],
): Promise<ParsedModule[]> {
  const modules: ParsedModule[] = [];
  for (const rel of changedFiles) {
    if (!SOURCE_RE.test(rel) || /\.(test|spec)\./.test(rel)) continue;
    const abs = path.resolve(cwd, rel);
    if (!fs.existsSync(abs)) continue; // deleted/renamed file
    const parser = getParserForFile(abs);
    if (!parser) continue;
    try {
      const parsed = await parser.parse(abs);
      // Report paths relative to the repo so output is portable (e.g. in PR comments).
      modules.push({ ...parsed, filePath: path.relative(cwd, abs) || rel });
    } catch {
      // Skip files that fail to parse; they surface elsewhere.
    }
  }
  return modules;
}

export const reviewCommand = new Command("review")
  .description(
    "Review the documentation impact of recent changes (AST-based, no LLM)",
  )
  .option("--dir <path>", "Repository directory (default: cwd)")
  .option("--since <ref>", "Base git ref to compare from", "HEAD~1")
  .option("--to <ref>", "Head git ref to compare to", "HEAD")
  .option("--target <file>", "Documentation file to check against", "README.md")
  .option("--json", "Emit JSON instead of text (for CI)")
  .option(
    "--no-require-inline",
    "Do not flag symbols missing inline doc comments",
  )
  .option("--fail-on-issues", "Exit non-zero when documentation gaps are found")
  .action(async (options) => {
    const cwd = options.dir || process.cwd();
    const spinner = ora("Reviewing documentation impact...").start();

    let changedFiles: string[];
    try {
      changedFiles = await getChangedFiles(options.since, options.to, cwd);
    } catch {
      spinner.fail(chalk.red("Could not read git history"));
      console.error(
        chalk.red(
          `Failed to diff ${options.since}..${options.to}. Is this a git repository with that range?`,
        ),
      );
      process.exit(1);
    }

    const modules = await parseChangedFiles(cwd, changedFiles);

    const targetPath = path.resolve(cwd, options.target);
    const docText = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, "utf8")
      : "";

    const result = reviewDocImpact(modules, {
      docText,
      docLabel: options.target,
      requireInlineDoc: options.requireInline,
    });

    spinner.succeed(chalk.green("Reviewed"));

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("\n" + renderReviewMarkdown(result));
    }

    if (options.failOnIssues && !result.ok) {
      console.error(
        chalk.red(
          `\n${result.issues.length} documentation gap(s) found. Update the docs or run 'aidoc update'.`,
        ),
      );
      process.exit(1);
    }
  });
