import { diffLines } from "diff";

export interface SafeDiffSummary {
  readonly changed: boolean;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly oldBytes: number;
  readonly newBytes: number;
}

/** Summarizes a text change without returning any line content. */
export function summarizeTextDiff(
  before: string,
  after: string,
): SafeDiffSummary {
  let addedLines = 0;
  let removedLines = 0;

  for (const part of diffLines(before, after)) {
    if (part.added) addedLines += part.count ?? countLines(part.value);
    if (part.removed) removedLines += part.count ?? countLines(part.value);
  }

  return {
    changed: before !== after,
    addedLines,
    removedLines,
    oldBytes: Buffer.byteLength(before, "utf8"),
    newBytes: Buffer.byteLength(after, "utf8"),
  };
}

function countLines(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/u).length;
}
