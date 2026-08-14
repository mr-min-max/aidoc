import type {
  AuthorizedMCPDirectory,
  MCPRepositoryReadScope,
} from "./repository-scope";
import {
  assessDocumentationFreshness,
  isDocumentationSourcePath,
  type FreshnessReport,
} from "../core/freshness";
import { getParserForFile } from "../parsers/registry";
import { MCPRepositoryScopeError } from "./repository-scope";

const DEFAULT_DOCUMENTATION_FILE = "README.md";
const DEFAULT_SINCE_REF = "HEAD~5";
const DEFAULT_TO_REF = "HEAD";

/**
 * Checks documentation freshness using only authorized, captured repository
 * snapshots. The ordinary CLI freshness implementation deliberately remains
 * separate because it has different filesystem and Git ownership semantics.
 */
export async function checkMCPDocumentationFreshness(input: {
  readonly scope: MCPRepositoryReadScope;
  readonly directory: AuthorizedMCPDirectory;
  readonly docFile: unknown;
  readonly since: unknown;
  readonly to?: string;
}): Promise<FreshnessReport> {
  const targetFile = await input.scope.readOptionalFile(
    input.directory,
    input.docFile === undefined ? DEFAULT_DOCUMENTATION_FILE : input.docFile,
  );
  const since = input.scope.validateGitRef(input.since, DEFAULT_SINCE_REF);
  const to = input.scope.validateGitRef(input.to, DEFAULT_TO_REF);
  const changedFiles = await input.scope.changedFiles(
    input.directory,
    since,
    to,
  );
  const target = targetFile.displayPath;
  const targetExists = targetFile.content !== null;
  const sourceFiles: string[] = [];

  for (const changedFile of changedFiles) {
    if (!isDocumentationSourcePath(changedFile)) continue;
    sourceFiles.push(changedFile);

    const sourceFile = await input.scope.readOptionalFile(
      input.scope.rootDirectory(),
      changedFile,
    );
    if (sourceFile.content === null) {
      return unknownReport(
        changedFiles,
        sourceFiles,
        target,
        "Could not evaluate documentation freshness: a changed source snapshot is unavailable.",
      );
    }

    const parser = getParserForFile(changedFile);
    if (parser === null || parser.parseSource === undefined) continue;
    try {
      await parser.parseSource(changedFile, sourceFile.content);
    } catch (error: unknown) {
      if (MCPRepositoryScopeError.read(error) !== undefined) throw error;
      return unknownReport(
        changedFiles,
        sourceFiles,
        target,
        safeOperationalMessage(),
      );
    }
  }

  return assessDocumentationFreshness(
    [...changedFiles],
    sourceFiles,
    target,
    targetExists,
  );
}

function unknownReport(
  changedFiles: readonly string[],
  sourceFiles: readonly string[],
  target: string,
  message: string,
): FreshnessReport {
  return {
    status: "unknown",
    target,
    targetChanged: changedFiles.includes(target),
    sourceFiles: [...sourceFiles].sort(),
    message,
  };
}

function safeOperationalMessage(): string {
  return "Could not evaluate documentation freshness: the source parser failed safely.";
}
