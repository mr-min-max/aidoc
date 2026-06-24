export interface UpdateContext {
  existingDoc: string;
  changedFiles: string[];
  diffSummary: string;
}

export function buildUpdateContext(
  existingDoc: string,
  changedFiles: string[],
  diffSummary?: string,
): UpdateContext {
  return {
    existingDoc,
    changedFiles,
    diffSummary: diffSummary || `Changed files: ${changedFiles.join(", ")}`,
  };
}
