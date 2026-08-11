import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import * as path from "node:path";
import {
  loadCommandContext,
  prepareDocumentTarget,
  type DocumentTarget,
} from "../context";
import { analyzeCodebase } from "../../core/analyzer";
import { displayDiff } from "../../output/diff-display";
import {
  getSafeErrorDiagnostic,
  getTrustErrorExitCode,
} from "../../security/diagnostics";
import { RepositoryWriteScope } from "../../security/repository-writer";
import type { FunctionInfo } from "../../parsers/types";

export interface AcceptedAnnotation {
  readonly name: string;
  readonly line: number;
  readonly jsdoc: string;
}

interface UndocumentedFunction extends FunctionInfo {
  readonly filePath: string;
}

interface GeneratedAnnotation {
  readonly name: string;
  readonly jsdoc: string;
}

/** Applies accepted comments without invalidating their original AST line numbers. */
export function applyAcceptedAnnotations(
  source: string,
  insertions: readonly AcceptedAnnotation[],
): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const sourceLines = source.split(/\r?\n/);
  const lines = [...sourceLines];
  const descending = [...insertions].sort((left, right) => {
    const lineOrder = right.line - left.line;
    if (lineOrder !== 0) return lineOrder;
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });

  for (const insertion of descending) {
    const insertAt = insertion.line - 1;
    const indent = sourceLines[insertAt]?.match(/^(\s*)/)?.[1] ?? "";
    const jsdoc = insertion.jsdoc
      .split(/\r?\n/)
      .map((line) => indent + line)
      .join(newline);
    lines.splice(insertAt, 0, jsdoc);
  }

  return lines.join(newline);
}

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
      ) satisfies UndocumentedFunction[];
      if (undocumented.length === 0) {
        spinner.succeed(
          chalk.green("All exported functions are already documented! 🎉"),
        );
        return;
      }
      spinner.succeed(
        chalk.yellow(`Found ${undocumented.length} undocumented functions`),
      );

      const uniqueFilePaths = [
        ...new Set(undocumented.map((func) => path.resolve(func.filePath))),
      ];
      const scope = options.dryRun
        ? undefined
        : await RepositoryWriteScope.open(ctx.cwd);
      const displayPathByFile = new Map<string, string>();
      const targetsByFilePath = new Map<string, DocumentTarget>();
      const targetsByDisplayPath = new Map<string, DocumentTarget>();
      const canonicalFilePathByDisplayPath = new Map<string, string>();

      for (const filePath of uniqueFilePaths) {
        const target = await prepareDocumentTarget(
          ctx.cwd,
          filePath,
          options.dryRun,
          scope,
        );
        if (target.existingText === null) {
          throw new Error("Source target does not exist.");
        }
        displayPathByFile.set(filePath, target.displayPath);
        targetsByFilePath.set(filePath, target);
        if (!targetsByDisplayPath.has(target.displayPath)) {
          targetsByDisplayPath.set(target.displayPath, target);
          canonicalFilePathByDisplayPath.set(target.displayPath, filePath);
        }
      }

      const generationInput = options.dryRun
        ? undocumented
        : undocumented.filter((func) => {
            const filePath = path.resolve(func.filePath);
            const displayPath = displayPathByFile.get(filePath);
            return (
              displayPath !== undefined &&
              canonicalFilePathByDisplayPath.get(displayPath) === filePath
            );
          });

      const genSpinner = ora("Generating JSDoc comments with AI...").start();
      const response = await ctx.generator.generateJsDoc(generationInput);
      let annotations: GeneratedAnnotation[];
      try {
        annotations = JSON.parse(stripCodeFences(response));
      } catch {
        throw new Error(
          "LLM returned malformed JSON for annotations. Try again or use --mock.",
        );
      }
      genSpinner.succeed(chalk.green("JSDoc comments generated!"));

      const functionsByName = new Map<string, UndocumentedFunction[]>();
      for (const func of generationInput) {
        const namedFunctions = functionsByName.get(func.name) ?? [];
        namedFunctions.push(func);
        functionsByName.set(func.name, namedFunctions);
      }
      const acceptedByDisplayPath = new Map<string, AcceptedAnnotation[]>();

      for (const ann of annotations) {
        const func = functionsByName.get(ann.name)?.shift();
        if (!func) continue;
        const filePath = path.resolve(func.filePath);
        const displayPath = displayPathByFile.get(filePath);
        const target = options.dryRun
          ? targetsByFilePath.get(filePath)
          : displayPath
            ? targetsByDisplayPath.get(displayPath)
            : undefined;
        if (!target || target.existingText === null) continue;

        const insertion: AcceptedAnnotation = {
          name: ann.name,
          line: func.lineRange[0],
          jsdoc: ann.jsdoc,
        };
        const proposed = applyAcceptedAnnotations(target.existingText, [
          insertion,
        ]);

        console.log(chalk.cyan(`\n📝 ${target.displayPath}: ${ann.name}`));
        displayDiff(target.displayPath, target.existingText, proposed);

        if (options.dryRun) continue;
        const { apply } = await prompts({
          type: "confirm",
          name: "apply",
          message: `Apply JSDoc to ${ann.name}?`,
          initial: true,
        });
        if (apply) {
          const accepted = acceptedByDisplayPath.get(target.displayPath) ?? [];
          accepted.push(insertion);
          acceptedByDisplayPath.set(target.displayPath, accepted);
        }
      }

      for (const [displayPath, accepted] of acceptedByDisplayPath) {
        const target = targetsByDisplayPath.get(displayPath)!;
        if (target.existingText === null || target.prepared === undefined) {
          throw new Error("Source target was not prepared for writing.");
        }
        const content = applyAcceptedAnnotations(target.existingText, accepted);
        await target.prepared.replaceText(content);
        console.log(chalk.green(`✔ Updated ${target.displayPath}`));
      }
    } catch (error: unknown) {
      spinner.fail(chalk.red("Failed to annotate code"));
      console.error(chalk.red(getSafeErrorDiagnostic(error).message));
      process.exit(getTrustErrorExitCode(error));
    }
  });
