import * as path from "path";
import prompts from "prompts";
import chalk from "chalk";
import { loadProviderConfig, AidocConfig } from "../config/loader";
import { createProvider } from "../providers/registry";
import { Generator } from "../core/generator";
import { resolveTemplatesDir } from "../core/templates";
import { MockGenerator } from "./mock-generator";
import {
  ValidationResult,
  writeMarkdown,
  readExistingMarkdown,
  validateMarkdown,
} from "../output/markdown";
import { displayDiff } from "../output/diff-display";
import { logger } from "../core/logger";

export interface CommandOptions {
  mock?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  strictOutput?: boolean;
}

export interface CommandContext {
  config: AidocConfig;
  cwd: string;
  generator: Generator | MockGenerator;
  isMock: boolean;
}

/** Project metadata extracted from package.json, with sane fallbacks. */
export interface ProjectInfo {
  name: string;
  description: string;
  dependencies: string[];
}

/** Applies a command-specific provider-output check at the strict boundary. */
export function enforceGeneratedOutput(
  result: ValidationResult,
  options: CommandOptions,
  label: string,
): void {
  if (options.strictOutput && !result.isValid) {
    throw new Error(
      `${label} failed validation: ${result.warnings.join("; ")}`,
    );
  }
  result.warnings.forEach((warning) => logger.warn(warning));
}

/**
 * Reads package.json from `cwd` for project metadata used by README/Watch.
 * Falls back to the directory name when there's no package.json. Centralizes
 * logic that was copy-pasted across readme/watch/mcp commands.
 */
export function readProjectInfo(cwd: string): ProjectInfo {
  const pkgPath = path.join(cwd, "package.json");
  let name = path.basename(cwd);
  let description = "";
  let dependencies: string[] = [];
  try {
    const fs = require("fs");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      name = pkg.name || name;
      description = pkg.description || "";
      dependencies = Object.keys(pkg.dependencies || {});
    }
  } catch {
    // Malformed or unreadable package.json — keep the fallbacks.
  }
  return { name, description, dependencies };
}

/** Builds the shared context every command needs. Chooses real/mock generator. */
export async function loadCommandContext(
  options: CommandOptions,
  cwd = process.cwd(),
): Promise<CommandContext> {
  const config = loadProviderConfig(cwd);
  const isMock = !!options.mock;
  const origin = process.env.AIDOC_ORIGIN === "action" ? "action" : "cli";
  const generator = isMock
    ? new MockGenerator()
    : new Generator(createProvider(config), resolveTemplatesDir(), {
        policy: config.trustPolicy,
        origin,
      });
  return { config, cwd, generator, isMock };
}

/**
 * Writes a generated document with the standard flow: show diff if a file
 * exists, confirm (unless dry-run/--auto), write, validate. Centralizes the
 * logic that was copy-pasted across commands.
 */
export async function writeDoc(
  outputPath: string,
  content: string,
  opts: {
    dryRun?: boolean;
    auto?: boolean;
    label?: string;
    strict?: boolean;
  } = {},
): Promise<void> {
  const label = opts.label || path.basename(outputPath);
  const existing = readExistingMarkdown(outputPath);

  // Warn (don't fail) on malformed output — e.g. unclosed code fences.
  const { isValid, warnings } = validateMarkdown(content);
  if (opts.strict && !isValid) {
    throw new Error(
      `Generated Markdown failed validation: ${warnings.join("; ")}`,
    );
  }
  warnings.forEach((w) => logger.warn(w));

  if (existing) {
    displayDiff(label, existing, content);
    if (opts.dryRun) return;
    const { confirm } = opts.auto
      ? { confirm: true }
      : await prompts({
          type: "confirm",
          name: "confirm",
          message: `Apply changes to ${label}?`,
          initial: true,
        });
    if (confirm) {
      writeMarkdown(outputPath, content);
      console.log(chalk.green(`✔ Updated ${label}`));
    } else {
      console.log(chalk.yellow("Skipped."));
    }
  } else if (opts.dryRun) {
    console.log("\n" + content);
  } else {
    writeMarkdown(outputPath, content);
    console.log(chalk.green(`✔ Created ${label}`));
  }
}

export function toWriteDocOptions(
  options: CommandOptions,
  label: string,
): { dryRun?: boolean; auto?: boolean; strict?: boolean; label: string } {
  return {
    dryRun: options.dryRun,
    auto: options.yes,
    label,
    strict: options.strictOutput,
  };
}

export function hasGenerationInput(
  condition: boolean,
  options: CommandOptions,
  message: string,
): boolean {
  if (!condition && options.strictOutput) {
    throw new Error(message);
  }
  return condition;
}
