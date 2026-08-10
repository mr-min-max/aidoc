import * as fs from "fs";

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
}

/** Validates the provider boundary before command-specific wrapping occurs. */
export function validateGeneratedContent(content: string): ValidationResult {
  const warnings: string[] = [];

  if (content.trim().length === 0) {
    warnings.push("Generated provider output is blank");
  }

  return { isValid: warnings.length === 0, warnings };
}

/** Validates a raw Keep a Changelog entry for the requested version. */
export function validateChangelogEntry(
  content: string,
  version: string,
): ValidationResult {
  const { warnings } = validateGeneratedContent(content);
  if (warnings.length > 0) {
    return { isValid: false, warnings };
  }

  const firstLine = content
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)!
    .trim();
  const expectedHeading = `## [${version}]`;
  if (
    firstLine !== expectedHeading &&
    !firstLine.startsWith(`${expectedHeading} `)
  ) {
    warnings.push(`Changelog entry must start with ${expectedHeading}`);
  }

  return { isValid: warnings.length === 0, warnings };
}

/** Validates raw Mermaid source before the command adds a Markdown fence. */
export function validateMermaidSource(content: string): ValidationResult {
  const { warnings } = validateGeneratedContent(content);
  if (warnings.length > 0) {
    return { isValid: false, warnings };
  }

  if (
    content.includes("```") ||
    content.split(/\r?\n/).some((line) => line.trimStart().startsWith("~~~"))
  ) {
    warnings.push("Mermaid source must not contain Markdown fences");
  }

  const firstLine = content
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)!
    .trim();
  if (!/^(?:graph|flowchart)\s+(?:TB|TD|BT|RL|LR)(?:\s|;|$)/i.test(firstLine)) {
    warnings.push(
      "Mermaid source must start with graph or flowchart and a direction",
    );
  }

  return { isValid: warnings.length === 0, warnings };
}

/** Performs lightweight validation on generated markdown before writing it. */
export function validateMarkdown(content: string): ValidationResult {
  const warnings: string[] = [];

  if (!content.trim().startsWith("#")) {
    warnings.push("Markdown does not start with a heading");
  }

  const codeBlockCount = (content.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    warnings.push("Markdown has unclosed code blocks");
  }

  return { isValid: warnings.length === 0, warnings };
}

/** Reads an existing markdown file or returns null when it is absent. */
export function readExistingMarkdown(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}
