import { LanguageParser } from "./types";
import { TypeScriptParser } from "./typescript";
import { PythonParser } from "./python";

const parsers: LanguageParser[] = [new TypeScriptParser(), new PythonParser()];

export function getParserForFile(filePath: string): LanguageParser | null {
  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  return parsers.find((p) => p.supportedExtensions.includes(ext)) || null;
}

export function registerParser(parser: LanguageParser): void {
  parsers.push(parser);
}

export function getSupportedExtensions(): string[] {
  return parsers.flatMap((p) => p.supportedExtensions);
}
