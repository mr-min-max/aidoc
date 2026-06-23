import { scanFiles } from './scanner';
import { getParserForFile } from '../parsers/registry';
import { ParsedModule } from '../parsers/types';

export async function analyzeCodebase(
  baseDir: string,
  include: string[],
  exclude: string[]
): Promise<ParsedModule[]> {
  const files = await scanFiles(baseDir, include, exclude);
  const modules: ParsedModule[] = [];

  for (const file of files) {
    const parser = getParserForFile(file);
    if (!parser) continue;

    try {
      const parsed = await parser.parse(file);
      modules.push(parsed);
    } catch (error: any) {
      // Graceful fallback: skip files that fail to parse
      console.warn(`⚠️  Failed to parse ${file}: ${error.message}`);
    }
  }

  return modules;
}
