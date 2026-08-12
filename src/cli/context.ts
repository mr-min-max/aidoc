import * as path from "path";
import prompts from "prompts";
import chalk from "chalk";
import { loadProviderConfig, AidocConfig } from "../config/loader";
import { createProvider } from "../providers/registry";
import {
  resolveProviderSelection,
  ProviderConfigurationError,
  type ResolvedProviderSelection,
} from "../providers/selection";
import { getProviderProfile } from "../providers/profiles";
import { Generator } from "../core/generator";
import { resolveTemplatesDir } from "../core/templates";
import { MockGenerator } from "./mock-generator";
import {
  ValidationResult,
  readExistingMarkdown,
  validateMarkdown,
} from "../output/markdown";
import { displayDiff } from "../output/diff-display";
import { logger } from "../core/logger";
import {
  RepositoryWriteScope,
  type PreparedRepositoryTarget,
} from "../security/repository-writer";
import {
  assertValidRepositoryTarget,
  isRepositoryContainedPath,
} from "../security/repository-path";

export interface CommandOptions {
  mock?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  strictOutput?: boolean;
  provider?: string;
  model?: string;
  providerBaseUrl?: string;
  allowLocalHttp?: boolean;
}

export interface CommandContext {
  config: AidocConfig;
  cwd: string;
  generator: Generator | MockGenerator;
  isMock: boolean;
  selection?: ResolvedProviderSelection;
}

export interface CommandContextLoadRuntime {
  beforeProviderCreate?(
    selection: ResolvedProviderSelection,
    config: AidocConfig,
  ): Promise<void>;
}

function cloneApprovedEndpoint(
  endpoint: ResolvedProviderSelection["endpoint"],
): ResolvedProviderSelection["endpoint"] {
  if (endpoint === undefined) return undefined;
  return {
    url: new URL(endpoint.url.href),
    origin: endpoint.origin,
    local: endpoint.local,
    addresses: endpoint.addresses.map(({ address, family }) => ({
      address,
      family,
    })),
  };
}

function cloneProviderSelection(
  selection: ResolvedProviderSelection,
): ResolvedProviderSelection {
  const endpoint = cloneApprovedEndpoint(selection.endpoint);
  return {
    provider: selection.provider,
    ...(selection.model === undefined ? {} : { model: selection.model }),
    ...(endpoint === undefined ? {} : { endpoint }),
    source: selection.source,
    boundary: selection.boundary,
    ...(selection.credentialEnv === undefined
      ? {}
      : { credentialEnv: selection.credentialEnv }),
    ...(selection.qwen === undefined
      ? {}
      : {
          qwen: {
            region: selection.qwen.region,
            ...(selection.qwen.workspaceId === undefined
              ? {}
              : { workspaceId: selection.qwen.workspaceId }),
          },
        }),
  };
}

function sanitizedProviderBoundaryConfig(config: AidocConfig): AidocConfig {
  const sanitized = {
    ...config,
    include: [...config.include],
    exclude: [...config.exclude],
    readme: { ...config.readme },
  } as AidocConfig & { apiKey?: string; providerBaseUrl?: string };
  delete sanitized.apiKey;
  delete sanitized.providerBaseUrl;
  return sanitized;
}

/** A document snapshot prepared for either preview or repository replacement. */
export interface DocumentTarget {
  readonly displayPath: string;
  readonly existingText: string | null;
  readonly prepared?: PreparedRepositoryTarget;
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
  runtime?: CommandContextLoadRuntime,
): Promise<CommandContext> {
  const config = loadProviderConfig(cwd);
  const isMock = !!options.mock;
  const origin = process.env.AIDOC_ORIGIN === "action" ? "action" : "cli";
  if (isMock) {
    return { config, cwd, generator: new MockGenerator(), isMock };
  }

  const selection = await resolveProviderSelection({
    config,
    overrides: {
      provider: options.provider,
      model: options.model,
      providerBaseUrl: options.providerBaseUrl,
      allowLocalHttp: options.allowLocalHttp,
    },
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  });
  if (selection === null) {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_CANCELLED");
  }
  const acceptedSelection = cloneProviderSelection(selection);
  const gateSelection = cloneProviderSelection(acceptedSelection);
  const acceptedEndpointUrl = acceptedSelection.endpoint?.url.href;
  const isBuiltInProvider =
    getProviderProfile(acceptedSelection.provider) !== undefined;
  const acceptedProviderBaseUrl =
    acceptedEndpointUrl ??
    (isBuiltInProvider
      ? undefined
      : (options.providerBaseUrl ?? config.providerBaseUrl));
  const acceptedAllowLocalHttp =
    acceptedSelection.endpoint !== undefined
      ? acceptedSelection.endpoint.local &&
        acceptedSelection.endpoint.url.protocol === "http:"
      : isBuiltInProvider
        ? false
        : (options.allowLocalHttp ?? config.allowLocalHttp);
  const acceptedOllamaHost =
    acceptedSelection.provider === "ollama"
      ? acceptedEndpointUrl
      : config.ollamaHost;
  const legacyApiKey =
    config.provider === acceptedSelection.provider &&
    typeof config.apiKey === "string" &&
    config.apiKey.length > 0
      ? config.apiKey
      : undefined;
  await runtime?.beforeProviderCreate?.(
    gateSelection,
    sanitizedProviderBoundaryConfig(config),
  );
  const factorySelection = cloneProviderSelection(acceptedSelection);
  const generator = new Generator(
    createProvider({
      provider: factorySelection.provider,
      model: factorySelection.model,
      ollamaHost: acceptedOllamaHost,
      providerBaseUrl: acceptedProviderBaseUrl,
      allowLocalHttp: acceptedAllowLocalHttp,
      endpoint: factorySelection.endpoint,
      ...(legacyApiKey === undefined ? {} : { apiKey: legacyApiKey }),
    }),
    resolveTemplatesDir(),
    {
      policy: config.trustPolicy,
      origin,
    },
  );
  return { config, cwd, generator, isMock, selection: acceptedSelection };
}

/**
 * Captures the document state needed by the shared output flow. Real writes
 * are prepared through the repository writer; dry-runs only read a preview.
 */
export async function prepareDocumentTarget(
  cwd: string,
  rawTarget: string,
  dryRun: boolean | undefined,
  scope?: RepositoryWriteScope,
): Promise<DocumentTarget> {
  if (dryRun) {
    assertValidRepositoryTarget(rawTarget);
    const resolvedCwd = path.resolve(cwd);
    const resolvedTarget = path.resolve(resolvedCwd, rawTarget);
    return {
      displayPath: dryRunDisplayPath(resolvedCwd, resolvedTarget),
      existingText: readExistingMarkdown(resolvedTarget),
    };
  }

  const writeScope = scope ?? (await RepositoryWriteScope.open(cwd));
  const prepared = await writeScope.prepare(rawTarget);
  return {
    displayPath: prepared.displayPath,
    existingText: prepared.existingText,
    prepared,
  };
}

function dryRunDisplayPath(cwd: string, target: string): string {
  const relativeTarget = path.relative(cwd, target);
  if (relativeTarget.length > 0 && isRepositoryContainedPath(cwd, target)) {
    return relativeTarget;
  }

  return path.basename(target) || "document";
}

/**
 * Writes a generated document with the standard flow: show diff if a file
 * exists, confirm (unless dry-run/--auto), write, validate. Centralizes the
 * logic that was copy-pasted across commands.
 */
export async function writeDoc(
  target: DocumentTarget,
  content: string,
  opts: {
    dryRun?: boolean;
    auto?: boolean;
    strict?: boolean;
  } = {},
): Promise<void> {
  const label = target.displayPath;
  const existing = target.existingText;

  // Warn (don't fail) on malformed output — e.g. unclosed code fences.
  const { isValid, warnings } = validateMarkdown(content);
  if (opts.strict && !isValid) {
    throw new Error(
      `Generated Markdown failed validation: ${warnings.join("; ")}`,
    );
  }
  warnings.forEach((w) => logger.warn(w));

  if (existing !== null) {
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
      await requirePreparedTarget(target).replaceText(content);
      console.log(chalk.green(`✔ Updated ${label}`));
    } else {
      console.log(chalk.yellow("Skipped."));
    }
  } else if (opts.dryRun) {
    console.log("\n" + content);
  } else {
    await requirePreparedTarget(target).replaceText(content);
    console.log(chalk.green(`✔ Created ${label}`));
  }
}

function requirePreparedTarget(
  target: DocumentTarget,
): PreparedRepositoryTarget {
  if (target.prepared === undefined) {
    throw new Error("Document target was not prepared for writing.");
  }
  return target.prepared;
}

export function toWriteDocOptions(options: CommandOptions): {
  dryRun?: boolean;
  auto?: boolean;
  strict?: boolean;
} {
  return {
    dryRun: options.dryRun,
    auto: options.yes,
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
