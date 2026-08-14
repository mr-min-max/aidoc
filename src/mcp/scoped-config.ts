import { defaultLoadersSync } from "cosmiconfig";
import * as dotenv from "dotenv";
import { posix as pathPosix } from "node:path";
import {
  MCPRepositoryReadScope,
  MCPRepositoryScopeError,
  type AuthorizedMCPDirectory,
  type AuthorizedMCPFile,
} from "./repository-scope";
import {
  defaultPlanningConfig,
  parsePlanningConfig,
  type PlanningConfig,
} from "../config/planning";
import { parseConfigValues } from "../config/loader";
import type { AidocConfig } from "../config/schema";
import type {
  ProviderCredentialEnvironment,
  ProviderCredentialName,
} from "../providers/registry";

const CONFIG_MAX_BYTES = 256 * 1024;
const MCP_UNSAFE_CONFIGURATION = "MCP_UNSAFE_CONFIGURATION" as const;
const MCP_UNSAFE_CONFIGURATION_MESSAGE =
  "The MCP project configuration cannot be loaded safely.";
const MCP_UNSAFE_CONFIGURATION_SETUP =
  "Invalid MCP unsafe configuration error setup.";

const MCP_UNSAFE_CONFIGURATION_PAYLOADS = new WeakMap<
  object,
  { readonly code: typeof MCP_UNSAFE_CONFIGURATION; readonly message: string }
>();
const MCP_UNSAFE_CONFIGURATION_CODE_SET = new Set<string>([
  MCP_UNSAFE_CONFIGURATION,
]);
const MCP_UNSAFE_CONFIGURATION_MESSAGE_SET = new Set<string>([
  MCP_UNSAFE_CONFIGURATION_MESSAGE,
]);

const ALLOWED_ENVIRONMENT_NAMES = Object.freeze([
  "AIDOC_PROVIDER",
  "AIDOC_MODEL",
  "AIDOC_PROVIDER_BASE_URL",
  "AIDOC_ALLOW_LOCAL_HTTP",
  "AIDOC_QWEN_REGION",
  "AIDOC_QWEN_WORKSPACE_ID",
  "AIDOC_OLLAMA_HOST",
  "AIDOC_TRUST_POLICY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "AIDOC_COMPAT_API_KEY",
] as const);

const CREDENTIAL_NAMES = Object.freeze([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
  "AIDOC_COMPAT_API_KEY",
] as const satisfies readonly ProviderCredentialName[]);

const TOP_LEVEL_DECLARATIVE_CANDIDATES = Object.freeze([
  [".aidocrc", "noExt"],
  [".aidocrc.json", ".json"],
  [".aidocrc.yaml", ".yaml"],
  [".aidocrc.yml", ".yml"],
] as const);

const TOP_LEVEL_EXECUTABLE_CANDIDATES = Object.freeze([
  ".aidocrc.js",
  ".aidocrc.ts",
  ".aidocrc.cjs",
  ".aidocrc.mjs",
] as const);

const CONFIG_DIRECTORY_DECLARATIVE_CANDIDATES = Object.freeze([
  ["aidocrc", "noExt"],
  ["aidocrc.json", ".json"],
  ["aidocrc.yaml", ".yaml"],
  ["aidocrc.yml", ".yml"],
] as const);

const CONFIG_DIRECTORY_EXECUTABLE_CANDIDATES = Object.freeze([
  "aidocrc.js",
  "aidocrc.ts",
  "aidocrc.cjs",
  "aidocrc.mjs",
] as const);

const ROOT_EXECUTABLE_CANDIDATES = Object.freeze([
  "aidoc.config.js",
  "aidoc.config.ts",
  "aidoc.config.cjs",
  "aidoc.config.mjs",
] as const);

type CapturedLoader = (filepath: string, content: string) => unknown;
type Missing = { readonly missing: true };
const MISSING: Missing = Object.freeze({ missing: true });

function findPropertyDescriptor(
  object: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const visited = new Set<object>();
  let current: object | null = object;
  while (current !== null) {
    if (visited.has(current)) throw new Error("Cyclic error prototype.");
    visited.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function safeOwnDataValue(value: object, key: string): unknown | Missing {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return MISSING;
  if (!Object.hasOwn(descriptor, "value")) throw new Error("unsafe accessor");
  return descriptor.value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownEnumerableDataRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error("invalid configuration record");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new Error("unsafe accessor");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function freezeStringRecord(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  const result = Object.create(null) as Record<string, string>;
  for (const [key, value] of entries) result[key] = value;
  return Object.freeze(result);
}

function captureEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): Readonly<Record<string, string>> {
  const entries: [string, string][] = [];
  if (typeof environment !== "object" || environment === null) {
    return freezeStringRecord(entries);
  }
  for (const name of ALLOWED_ENVIRONMENT_NAMES) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(environment, name);
      if (
        descriptor !== undefined &&
        Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
      ) {
        entries.push([name, descriptor.value]);
      }
    } catch {
      // A hostile host snapshot is ignored key-by-key. No value getter runs.
    }
  }
  return freezeStringRecord(entries);
}

function mergeEnvironment(
  host: Readonly<Record<string, string>>,
  dotenvValues: unknown,
): Readonly<Record<string, string>> {
  const root = ownEnumerableDataRecord(dotenvValues);
  const entries: [string, string][] = [];
  for (const name of ALLOWED_ENVIRONMENT_NAMES) {
    const hostDescriptor = Object.getOwnPropertyDescriptor(host, name);
    if (
      hostDescriptor !== undefined &&
      Object.hasOwn(hostDescriptor, "value")
    ) {
      entries.push([name, hostDescriptor.value as string]);
      continue;
    }
    const rootDescriptor = Object.getOwnPropertyDescriptor(root, name);
    if (
      rootDescriptor !== undefined &&
      Object.hasOwn(rootDescriptor, "value") &&
      typeof rootDescriptor.value === "string"
    ) {
      entries.push([name, rootDescriptor.value]);
    }
  }
  return freezeStringRecord(entries);
}

function outputDirectory(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    containsControlCharacter(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.startsWith("//") ||
    /^[A-Za-z]:/u.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  ) {
    throw new Error("invalid output directory");
  }
  const parts = value.split("/");
  if (parts.some((part) => part === ".." || part.toLowerCase() === ".git")) {
    throw new Error("invalid output directory");
  }
  const normalized = pathPosix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("invalid output directory");
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function childPath(directory: AuthorizedMCPDirectory, child: string): string {
  return directory.displayPath === "."
    ? child
    : `${directory.displayPath}/${child}`;
}

function fallbackProjectName(directory: AuthorizedMCPDirectory): string {
  if (directory.displayPath === ".") return "project";
  const parts = directory.displayPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || "project";
}

function parseCaptured(file: AuthorizedMCPFile, extension: string): unknown {
  if (file.content === null) throw new Error("missing configuration");
  const loaders = defaultLoadersSync as unknown as Record<
    string,
    CapturedLoader
  >;
  const loader = loaders[extension];
  if (loader === undefined) throw new Error("unsupported configuration");
  return loader(file.displayPath, file.content);
}

function assertNoLegacyApiKey(value: unknown): void {
  if (!isPlainRecord(value)) throw new Error("invalid configuration record");
  const descriptor = Object.getOwnPropertyDescriptor(value, "apiKey");
  if (descriptor !== undefined) throw new Error("legacy api key");
}

function freezePlanningConfig(value: PlanningConfig): Readonly<PlanningConfig> {
  return Object.freeze({
    ...value,
    include: Object.freeze([...value.include]),
    exclude: Object.freeze([...value.exclude]),
  }) as unknown as Readonly<PlanningConfig>;
}

function validatePlanningFields<
  T extends { include: string[]; exclude: string[]; outputDir: string },
>(scope: MCPRepositoryReadScope, config: T): T {
  const include = scope.validateGlobList(config.include, "include");
  const exclude = scope.validateGlobList(config.exclude, "exclude");
  return {
    ...config,
    outputDir: outputDirectory(config.outputDir),
    include: [...include],
    exclude: [...exclude],
  } as T;
}

function unsafeConfiguration(): MCPUnsafeConfigurationError {
  return new MCPUnsafeConfigurationError();
}

/** A fixed, value-free error raised for every unsafe MCP configuration input. */
export class MCPUnsafeConfigurationError extends Error {
  readonly code = MCP_UNSAFE_CONFIGURATION;

  constructor() {
    if (arguments.length !== 0) {
      throw new TypeError(MCP_UNSAFE_CONFIGURATION_SETUP);
    }
    super(MCP_UNSAFE_CONFIGURATION_MESSAGE);
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "MCPUnsafeConfigurationError",
      writable: true,
    });
    Object.defineProperty(this, "code", {
      configurable: true,
      enumerable: true,
      value: MCP_UNSAFE_CONFIGURATION,
      writable: true,
    });
    Object.defineProperty(this, "message", {
      configurable: true,
      enumerable: true,
      value: MCP_UNSAFE_CONFIGURATION_MESSAGE,
      writable: true,
    });
    MCP_UNSAFE_CONFIGURATION_PAYLOADS.set(
      this,
      Object.freeze({
        code: MCP_UNSAFE_CONFIGURATION,
        message: MCP_UNSAFE_CONFIGURATION_MESSAGE,
      }),
    );
  }

  /** Returns the fixed payload only for an authentic, unmodified configuration error. */
  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const payload = MCP_UNSAFE_CONFIGURATION_PAYLOADS.get(error);
    if (payload === undefined) return undefined;
    try {
      const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
      const messageDescriptor = Object.getOwnPropertyDescriptor(
        error,
        "message",
      );
      if (
        codeDescriptor === undefined ||
        !Object.hasOwn(codeDescriptor, "value") ||
        messageDescriptor === undefined ||
        !Object.hasOwn(messageDescriptor, "value") ||
        codeDescriptor.value !== payload.code ||
        messageDescriptor.value !== payload.message
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    return { ...payload };
  }

  /** Detects configuration-shaped errors without trusting their mutable values. */
  static isCandidate(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    if (MCP_UNSAFE_CONFIGURATION_PAYLOADS.has(error)) return true;
    try {
      const codeDescriptor = findPropertyDescriptor(error, "code");
      const messageDescriptor = findPropertyDescriptor(error, "message");
      if (
        (codeDescriptor !== undefined &&
          !Object.hasOwn(codeDescriptor, "value")) ||
        (messageDescriptor !== undefined &&
          !Object.hasOwn(messageDescriptor, "value"))
      ) {
        return true;
      }
      const code =
        codeDescriptor !== undefined && Object.hasOwn(codeDescriptor, "value")
          ? codeDescriptor.value
          : undefined;
      const message =
        messageDescriptor !== undefined &&
        Object.hasOwn(messageDescriptor, "value")
          ? messageDescriptor.value
          : undefined;
      return (
        (typeof code === "string" &&
          MCP_UNSAFE_CONFIGURATION_CODE_SET.has(code)) ||
        (typeof message === "string" &&
          MCP_UNSAFE_CONFIGURATION_MESSAGE_SET.has(message))
      );
    } catch {
      return true;
    }
  }
}

export interface MCPProjectMetadata {
  readonly name: string;
  readonly description: string;
  readonly dependencies: readonly string[];
}

export type MCPAllowedEnvironment = Readonly<
  Partial<
    Record<
      | ProviderCredentialName
      | "AIDOC_PROVIDER"
      | "AIDOC_MODEL"
      | "AIDOC_PROVIDER_BASE_URL"
      | "AIDOC_ALLOW_LOCAL_HTTP"
      | "AIDOC_QWEN_REGION"
      | "AIDOC_QWEN_WORKSPACE_ID"
      | "AIDOC_OLLAMA_HOST"
      | "AIDOC_TRUST_POLICY",
      string
    >
  >
>;

export interface MCPProviderSettings {
  readonly config: Readonly<AidocConfig>;
  readonly effectiveEnvironment: MCPAllowedEnvironment;
  readonly credentials: ProviderCredentialEnvironment;
}

/** Loads bounded MCP planning, provider, and package metadata snapshots. */
export class MCPScopedConfigLoader {
  readonly #scope: MCPRepositoryReadScope;
  readonly #hostEnvironment: Readonly<Record<string, string>>;

  constructor(
    scope: MCPRepositoryReadScope,
    hostEnvironment?: Readonly<NodeJS.ProcessEnv>,
  ) {
    this.#scope = scope;
    this.#hostEnvironment = captureEnvironment(hostEnvironment ?? process.env);
  }

  /** Loads and validates planning fields without consulting ambient CLI config search. */
  async loadPlanning(
    directory: AuthorizedMCPDirectory,
  ): Promise<Readonly<PlanningConfig>> {
    try {
      const fileValue = await this.findConfiguration(directory);
      const planning = parsePlanningConfig(fileValue ?? {});
      return freezePlanningConfig(
        validatePlanningFields(this.#scope, planning),
      );
    } catch (error) {
      if (MCPUnsafeConfigurationError.read(error) !== undefined) throw error;
      throw unsafeConfiguration();
    }
  }

  /** Loads safe project/provider settings and a frozen allowlisted environment snapshot. */
  async loadProvider(
    directory: AuthorizedMCPDirectory,
  ): Promise<MCPProviderSettings> {
    try {
      const fileValue = await this.findConfiguration(directory);
      const root = this.#scope.rootDirectory();
      const dotenvFile = await this.#scope.readOptionalFile(root, ".env", {
        maxBytes: CONFIG_MAX_BYTES,
      });
      const dotenvValues =
        dotenvFile.content === null
          ? Object.create(null)
          : dotenv.parse(dotenvFile.content);
      const effectiveEnvironment = mergeEnvironment(
        this.#hostEnvironment,
        dotenvValues,
      );
      const config = validatePlanningFields(
        this.#scope,
        parseConfigValues(fileValue ?? {}, effectiveEnvironment),
      );
      const credentials = freezeStringRecord(
        CREDENTIAL_NAMES.flatMap((name) => {
          const descriptor = Object.getOwnPropertyDescriptor(
            effectiveEnvironment,
            name,
          );
          return descriptor !== undefined && Object.hasOwn(descriptor, "value")
            ? [[name, descriptor.value as string] as const]
            : [];
        }),
      );
      return Object.freeze({
        config: freezeAidocConfig(config),
        effectiveEnvironment,
        credentials,
      });
    } catch (error) {
      if (MCPUnsafeConfigurationError.read(error) !== undefined) throw error;
      throw unsafeConfiguration();
    }
  }

  /** Reads selected-directory package metadata with deterministic safe fallbacks. */
  async readProjectMetadata(
    directory: AuthorizedMCPDirectory,
  ): Promise<MCPProjectMetadata> {
    try {
      const file = await this.#scope.readOptionalFile(
        directory,
        "package.json",
        {
          maxBytes: CONFIG_MAX_BYTES,
        },
      );
      if (file.content === null) {
        return Object.freeze({
          name: fallbackProjectName(directory),
          description: "",
          dependencies: Object.freeze([]),
        });
      }
      const packageValue = parseCaptured(file, ".json");
      if (!isPlainRecord(packageValue)) throw new Error("invalid package");
      const nameValue = safeOwnDataValue(packageValue, "name");
      const descriptionValue = safeOwnDataValue(packageValue, "description");
      const name =
        typeof nameValue === "string" && nameValue.length > 0
          ? nameValue
          : fallbackProjectName(directory);
      const description =
        typeof descriptionValue === "string" ? descriptionValue : "";
      const dependencies = new Set<string>();
      for (const key of ["dependencies", "devDependencies"] as const) {
        const dependencyValue = safeOwnDataValue(packageValue, key);
        if (dependencyValue === MISSING || dependencyValue === undefined)
          continue;
        if (!isPlainRecord(dependencyValue))
          throw new Error("invalid dependencies");
        for (const dependencyName of Object.keys(dependencyValue)) {
          const descriptor = Object.getOwnPropertyDescriptor(
            dependencyValue,
            dependencyName,
          );
          if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
            throw new Error("invalid dependencies");
          }
          dependencies.add(dependencyName);
        }
      }
      return Object.freeze({
        name,
        description,
        dependencies: Object.freeze([...dependencies].sort()),
      });
    } catch (error) {
      if (MCPUnsafeConfigurationError.read(error) !== undefined) throw error;
      throw unsafeConfiguration();
    }
  }

  private async findConfiguration(
    directory: AuthorizedMCPDirectory,
  ): Promise<unknown | undefined> {
    let directories: readonly AuthorizedMCPDirectory[];
    try {
      directories = this.#scope.configurationDirectories(directory);
    } catch {
      throw unsafeConfiguration();
    }

    for (const current of directories) {
      const packageFile = await this.readOptional(current, "package.json");
      if (packageFile.content !== null) {
        const packageValue = parseCaptured(packageFile, ".json");
        if (!isPlainRecord(packageValue)) throw unsafeConfiguration();
        const aidoc = safeOwnDataValue(packageValue, "aidoc");
        if (aidoc !== MISSING) {
          assertNoLegacyApiKey(aidoc);
          return aidoc;
        }
      }

      for (const [name, extension] of TOP_LEVEL_DECLARATIVE_CANDIDATES) {
        const candidate = await this.readOptional(current, name);
        if (candidate.content !== null) {
          const value = parseCaptured(candidate, extension);
          assertNoLegacyApiKey(value);
          return value;
        }
      }
      for (const name of TOP_LEVEL_EXECUTABLE_CANDIDATES) {
        if ((await this.readOptional(current, name)).content !== null) {
          throw unsafeConfiguration();
        }
      }

      const configDirectory = await this.findConfigDirectory(current);
      if (configDirectory !== undefined) {
        for (const [
          name,
          extension,
        ] of CONFIG_DIRECTORY_DECLARATIVE_CANDIDATES) {
          const candidate = await this.readOptional(configDirectory, name);
          if (candidate.content !== null) {
            const value = parseCaptured(candidate, extension);
            assertNoLegacyApiKey(value);
            return value;
          }
        }
        for (const name of CONFIG_DIRECTORY_EXECUTABLE_CANDIDATES) {
          if (
            (await this.readOptional(configDirectory, name)).content !== null
          ) {
            throw unsafeConfiguration();
          }
        }
      }

      for (const name of ROOT_EXECUTABLE_CANDIDATES) {
        if ((await this.readOptional(current, name)).content !== null) {
          throw unsafeConfiguration();
        }
      }
    }
    return undefined;
  }

  private async findConfigDirectory(
    directory: AuthorizedMCPDirectory,
  ): Promise<AuthorizedMCPDirectory | undefined> {
    const relativePath = childPath(directory, ".config");
    try {
      return await this.#scope.authorizeDirectory(relativePath);
    } catch (error) {
      if (MCPRepositoryScopeError.read(error) === undefined) {
        throw unsafeConfiguration();
      }
      try {
        const probe = await this.#scope.readOptionalFile(directory, ".config", {
          maxBytes: CONFIG_MAX_BYTES,
        });
        if (probe.content === null) return undefined;
      } catch {
        throw unsafeConfiguration();
      }
      throw unsafeConfiguration();
    }
  }

  private async readOptional(
    directory: AuthorizedMCPDirectory,
    name: string,
  ): Promise<AuthorizedMCPFile> {
    try {
      return await this.#scope.readOptionalFile(directory, name, {
        maxBytes: CONFIG_MAX_BYTES,
      });
    } catch (error) {
      if (MCPUnsafeConfigurationError.read(error) !== undefined) throw error;
      throw unsafeConfiguration();
    }
  }
}

function freezeAidocConfig(config: AidocConfig): Readonly<AidocConfig> {
  return Object.freeze({
    ...config,
    include: Object.freeze([...config.include]),
    exclude: Object.freeze([...config.exclude]),
    readme: Object.freeze({ ...config.readme }),
  }) as unknown as Readonly<AidocConfig>;
}

export {
  defaultPlanningConfig,
  parsePlanningConfig,
  parseConfigValues,
  MCP_UNSAFE_CONFIGURATION,
};
