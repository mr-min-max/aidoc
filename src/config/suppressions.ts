import { RepositoryWriteScope } from "../security/repository-writer";

export interface SuppressionConfig {
  readonly symbols: readonly string[];
  readonly sourcePaths: readonly string[];
  readonly docPaths: readonly string[];
}

export interface SuppressedChange {
  readonly symbol: string;
  readonly reason?: string;
}

export const EMPTY_SUPPRESSIONS: SuppressionConfig = Object.freeze({
  symbols: Object.freeze([]),
  sourcePaths: Object.freeze([]),
  docPaths: Object.freeze([]),
});

/** Parses the deliberately small, line-oriented .staledocsignore format. */
export function parseSuppressions(content: string): SuppressionConfig {
  const symbols: string[] = [];
  const sourcePaths: string[] = [];
  const docPaths: string[] = [];

  for (const rawLine of content.replace(/\r\n?/gu, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (containsControlCharacter(line) || /\s/gu.test(line)) continue;

    if (line.endsWith(".md")) {
      if (isSafePattern(line)) docPaths.push(line);
    } else if (line.includes("/")) {
      if (isSafePattern(line)) sourcePaths.push(line);
    } else if (isSymbolPattern(line)) {
      symbols.push(line);
    }
  }

  return Object.freeze({
    symbols: Object.freeze(uniqueSorted(symbols)),
    sourcePaths: Object.freeze(uniqueSorted(sourcePaths)),
    docPaths: Object.freeze(uniqueSorted(docPaths)),
  });
}

/** Reads the optional root .staledocsignore without exposing filesystem failures. */
export async function loadSuppressions(root: string): Promise<SuppressionConfig> {
  try {
    const scope = await RepositoryWriteScope.open(root);
    const target = await scope.prepare(".staledocsignore");
    if (target.existingText === null || target.existingText.length > 256 * 1024) {
      return EMPTY_SUPPRESSIONS;
    }
    return parseSuppressions(target.existingText);
  } catch {
    return EMPTY_SUPPRESSIONS;
  }
}

/** Returns the matching suppression pattern, if any. */
export function matchingSuppression(
  value: string,
  patterns: readonly string[],
): string | undefined {
  const normalized = value.replaceAll("\\", "/");
  const separator = normalized.includes("/") ? "/" : ".";
  for (const pattern of patterns) {
    if (matchesStarPattern(normalized, pattern, separator)) return pattern;
  }
  return undefined;
}

function isSymbolPattern(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    /[?{}()!+@]|\[|\]/u.test(value)
  ) {
    return false;
  }
  const segments = value.split(".");
  if (segments.some((segment) => segment.length === 0)) return false;
  const wildcardIndex = segments.findIndex((segment) => segment.includes("*"));
  if (wildcardIndex < 0) return true;
  return (
    wildcardIndex === segments.length - 1 &&
    segments[wildcardIndex] === "*" &&
    !segments.slice(0, -1).some((segment) => segment.includes("*"))
  );
}

function isSafePattern(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !/[?{}()!+@]|\[|\]/u.test(value) &&
    !value.split("/").some((part) => part === "..")
  );
}

function matchesStarPattern(
  value: string,
  pattern: string,
  separator: "/" | ".",
): boolean {
  let valueIndex = 0;
  let patternIndex = 0;
  let wildcard:
    | { patternIndex: number; valueIndex: number; crossesSegments: boolean }
    | undefined;

  while (valueIndex < value.length) {
    if (
      patternIndex < pattern.length &&
      pattern[patternIndex] === value[valueIndex]
    ) {
      patternIndex += 1;
      valueIndex += 1;
      continue;
    }

    if (pattern[patternIndex] === "*") {
      const crossesSegments = pattern[patternIndex + 1] === "*";
      patternIndex += crossesSegments ? 2 : 1;
      wildcard = { patternIndex, valueIndex, crossesSegments };
      continue;
    }

    if (
      wildcard === undefined ||
      wildcard.valueIndex >= value.length ||
      (!wildcard.crossesSegments && value[wildcard.valueIndex] === separator)
    ) {
      return false;
    }
    wildcard.valueIndex += 1;
    valueIndex = wildcard.valueIndex;
    patternIndex = wildcard.patternIndex;
  }

  while (pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
