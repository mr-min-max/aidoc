import * as fs from "fs";
import * as path from "path";

export const REQUIRED_TEMPLATE_NAMES = [
  "api-doc",
  "changelog",
  "diagram",
  "jsdoc",
  "readme",
  "score",
  "update",
] as const;

export function resolveTemplatesDir(moduleDir = __dirname): string {
  const templatesDir = path.resolve(moduleDir, "../templates");
  const missing = REQUIRED_TEMPLATE_NAMES.filter(
    (name) => !fs.existsSync(path.join(templatesDir, `${name}.hbs`)),
  );

  if (missing.length > 0) {
    throw new Error(
      `Packaged templates are incomplete at ${templatesDir}. Missing: ${missing.join(", ")}`,
    );
  }

  return templatesDir;
}
