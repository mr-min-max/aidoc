import { scanFiles } from "./scanner";
import { getParserForFile } from "../parsers/registry";
import { ParsedModule } from "../parsers/types";
import { globalCache } from "./cache";
import { logger } from "./logger";
import { getSafeErrorDiagnostic } from "../security/diagnostics";

/** Scans configured source files and parses each supported file into AST metadata. */
export async function analyzeCodebase(
  baseDir: string,
  include: string[],
  exclude: string[],
): Promise<ParsedModule[]> {
  const files = await scanFiles(baseDir, include, exclude);
  const modules: ParsedModule[] = [];

  for (const file of files) {
    // Check cache first
    const cached = globalCache.get(file);
    if (cached) {
      modules.push(cached);
      continue;
    }

    const parser = getParserForFile(file);
    if (!parser) continue;

    try {
      const parsed = await parser.parse(file);
      globalCache.set(file, parsed);
      modules.push(parsed);
    } catch (error: unknown) {
      logger.warn(
        `Failed to parse source file: ${getSafeErrorDiagnostic(error).message}`,
      );
    }
  }

  const stats = globalCache.stats();
  logger.debug(
    `AST Cache: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`,
  );

  return modules;
}

/** Parses authorized in-memory source snapshots without reopening their paths. */
export async function analyzeCapturedSources(
  files: readonly { displayPath: string; content: string }[],
): Promise<ParsedModule[]> {
  const modules: ParsedModule[] = [];
  const sortedFiles = files
    .map(({ displayPath, content }) => ({ displayPath, content }))
    .sort((left, right) =>
      left.displayPath < right.displayPath
        ? -1
        : left.displayPath > right.displayPath
          ? 1
          : 0,
    );

  for (const file of sortedFiles) {
    const parser = getParserForFile(file.displayPath);
    if (!parser || typeof parser.parseSource !== "function") continue;

    try {
      modules.push(await parser.parseSource(file.displayPath, file.content));
    } catch (error: unknown) {
      logger.warn(
        `Failed to parse source file: ${getSafeErrorDiagnostic(error).message}`,
      );
    }
  }

  return modules;
}
