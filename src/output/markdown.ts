import * as fs from "fs";
import * as path from "path";

interface ValidationResult {
  isValid: boolean;
  warnings: string[];
}

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

export function writeMarkdown(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
}

export function readExistingMarkdown(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}
