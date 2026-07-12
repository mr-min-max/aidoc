import { LanguageParser } from "./types";
import { TypeScriptParser } from "./typescript";
import { PythonParser } from "./python";

const parsers: LanguageParser[] = [new TypeScriptParser(), new PythonParser()];

/** Returns the registered parser that supports a file's extension. */
export function getParserForFile(filePath: string): LanguageParser | null {
  const ext = "." + filePath.split(".").pop()?.toLowerCase();
  return parsers.find((p) => p.supportedExtensions.includes(ext)) || null;
}

/** Adds a language parser to the in-process parser registry. */
export function registerParser(parser: LanguageParser): void {
  parsers.push(parser);
}

/** Lists every file extension supported by registered parsers. */
export function getSupportedExtensions(): string[] {
  return parsers.flatMap((p) => p.supportedExtensions);
}
