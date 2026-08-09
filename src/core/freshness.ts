import * as fs from "fs";
import * as path from "path";
import { getChangedFiles } from "../git/history";
import { getParserForFile } from "../parsers/registry";
import { getSafeErrorDiagnostic } from "../security/diagnostics";

export type DocumentationCheckStatus =
  | "clean"
  | "co-changed"
  | "stale"
  | "missing"
  | "unknown";

export interface FreshnessReport {
  status: DocumentationCheckStatus;
  target: string;
  targetChanged: boolean;
  sourceFiles: string[];
  message: string;
}

function normalize(file: string): string {
  return file.replaceAll(path.sep, "/").replace(/^\.\//, "");
}

function isTestPath(file: string): boolean {
  return (
    /(^|\/)(tests?|__tests__)\//.test(file) ||
    /\.(test|spec)\.[^.]+$/.test(file)
  );
}

export async function collectAstSourceFiles(
  cwd: string,
  changedFiles: string[],
): Promise<string[]> {
  const sourceFiles: string[] = [];

  for (const changedFile of changedFiles.map(normalize)) {
    if (isTestPath(changedFile)) continue;
    const parser = getParserForFile(changedFile);
    if (!parser) continue;

    const absoluteFile = path.resolve(cwd, changedFile);
    if (!fs.existsSync(absoluteFile)) {
      throw new Error(
        `Changed supported source file does not exist: ${changedFile}`,
      );
    }
    await parser.parse(absoluteFile);

    sourceFiles.push(changedFile);
  }

  return sourceFiles.sort();
}

export function assessDocumentationFreshness(
  changedFiles: string[],
  sourceFiles: string[],
  target: string,
  targetExists: boolean,
): FreshnessReport {
  const normalizedTarget = normalize(target);
  const normalizedChanges = changedFiles.map(normalize);
  const normalizedSourceFiles = sourceFiles.map(normalize).sort();
  const targetChanged = normalizedChanges.includes(normalizedTarget);

  if (!targetExists) {
    return {
      status: "missing",
      target: normalizedTarget,
      targetChanged,
      sourceFiles: normalizedSourceFiles,
      message: `Documentation target is missing: ${normalizedTarget}`,
    };
  }

  if (normalizedSourceFiles.length > 0 && !targetChanged) {
    return {
      status: "stale",
      target: normalizedTarget,
      targetChanged,
      sourceFiles: normalizedSourceFiles,
      message: `${normalizedSourceFiles.length} AST-backed source file(s) changed without ${normalizedTarget}`,
    };
  }

  const status: DocumentationCheckStatus =
    normalizedSourceFiles.length === 0 ? "clean" : "co-changed";
  return {
    status,
    target: normalizedTarget,
    targetChanged,
    sourceFiles: normalizedSourceFiles,
    message:
      normalizedSourceFiles.length === 0
        ? "No documentation-relevant source changes detected"
        : `${normalizedTarget} changed with the affected source files; content correctness was not verified`,
  };
}

export async function checkDocumentationFreshness(
  cwd: string,
  target: string,
  since: string,
  to = "HEAD",
): Promise<FreshnessReport> {
  const absoluteTarget = path.resolve(cwd, target);
  const relativeTarget = normalize(path.relative(cwd, absoluteTarget));

  try {
    const changedFiles = await getChangedFiles(since, to, cwd);
    const sourceFiles = await collectAstSourceFiles(cwd, changedFiles);
    return assessDocumentationFreshness(
      changedFiles,
      sourceFiles,
      relativeTarget,
      fs.existsSync(absoluteTarget),
    );
  } catch (error: unknown) {
    const diagnostic = getSafeErrorDiagnostic(error);
    return {
      status: "unknown",
      target: relativeTarget,
      targetChanged: false,
      sourceFiles: [],
      message: `Could not evaluate documentation freshness: ${diagnostic.message}`,
    };
  }
}
