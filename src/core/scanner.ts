import { glob } from 'glob';

export async function scanFiles(
  baseDir: string,
  include: string[],
  exclude: string[]
): Promise<string[]> {
  const files: Set<string> = new Set();

  for (const pattern of include) {
    const matches = await glob(pattern, {
      cwd: baseDir,
      absolute: true,
      ignore: exclude,
      nodir: true,
    });
    matches.forEach(f => files.add(f));
  }

  return Array.from(files).sort();
}
