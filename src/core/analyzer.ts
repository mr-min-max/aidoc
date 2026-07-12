import { scanFiles } from "./scanner.js";
import { getParserForFile } from "../parsers/registry.js";
import { ParsedModule } from "../parsers/types.js";
import { globalCache } from "./cache.js";
import { logger } from "./logger.js";

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
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to parse ${file}: ${message}`);
    }
  }

  const stats = globalCache.stats();
  logger.debug(
    `AST Cache: ${stats.hits} hits, ${stats.misses} misses, ${stats.size} entries`,
  );

  return modules;
}
