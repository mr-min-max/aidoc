export interface UpdateContext {
  existingDoc: string;
  changedFiles: string[];
  diffSummary: string;
}

/** Builds the minimal context needed for a diff-aware documentation update. */
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
