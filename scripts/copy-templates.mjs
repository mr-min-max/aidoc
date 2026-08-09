import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const source = resolve("src/templates");
const destination = resolve("dist/templates");
const require = createRequire(import.meta.url);
const { REQUIRED_TEMPLATE_NAMES } = require(
  resolve("dist/core/templates.js"),
);
const required = REQUIRED_TEMPLATE_NAMES.map((name) => `${name}.hbs`);

const sourceFiles = new Set(readdirSync(source));
const missing = required.filter((name) => !sourceFiles.has(name));
if (missing.length > 0) {
  throw new Error(`Cannot build aidoc: missing templates: ${missing.join(", ")}`);
}

if (existsSync(destination)) {
  rmSync(destination, { recursive: true, force: true });
}
mkdirSync(destination, { recursive: true });
for (const name of required) {
  cpSync(resolve(source, name), resolve(destination, name));
}
