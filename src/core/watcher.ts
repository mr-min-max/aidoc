/** Debounce: coalesce rapid invocations into one trailing call. */
export function debounce(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

const RELEVANT_EXT = /\.(ts|tsx|js|jsx|py)$/;

/** True for source files we'd want to regenerate docs from. */
export function isRelevantChange(filePath: string): boolean {
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return false;
  if (filePath.includes('node_modules/') || filePath.includes('dist/') || filePath.includes('build/')) return false;
  return RELEVANT_EXT.test(filePath);
}
