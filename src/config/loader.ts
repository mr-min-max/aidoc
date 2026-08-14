import { cosmiconfigSync } from "cosmiconfig";
import * as dotenv from "dotenv";
import { ConfigSchema, AidocConfig, defaultConfig } from "./schema";

function ownString(
  env: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    return descriptor &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Projects the allowlisted AIDOC_* environment settings into config fields. */
export function environmentConfig(
  env: Readonly<NodeJS.ProcessEnv>,
): Record<string, unknown> {
  const allowLocalHttp = parseBooleanEnvironment(
    ownString(env, "AIDOC_ALLOW_LOCAL_HTTP"),
  );
  const provider = ownString(env, "AIDOC_PROVIDER");
  const model = ownString(env, "AIDOC_MODEL");
  const providerBaseUrl = ownString(env, "AIDOC_PROVIDER_BASE_URL");
  const qwenRegion = ownString(env, "AIDOC_QWEN_REGION");
  const qwenWorkspaceId = ownString(env, "AIDOC_QWEN_WORKSPACE_ID");
  const ollamaHost = ownString(env, "AIDOC_OLLAMA_HOST");
  const trustPolicy = ownString(env, "AIDOC_TRUST_POLICY");
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(providerBaseUrl ? { providerBaseUrl } : {}),
    ...(allowLocalHttp === undefined ? {} : { allowLocalHttp }),
    ...(qwenRegion ? { qwenRegion } : {}),
    ...(qwenWorkspaceId ? { qwenWorkspaceId } : {}),
    ...(ollamaHost ? { ollamaHost } : {}),
    ...(trustPolicy ? { trustPolicy } : {}),
  };
}

function parseBooleanEnvironment(
  value: string | undefined,
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Loads ordinary CLI configuration through cosmiconfig and applies environment overrides. */
export function loadConfig(
  searchFrom?: string,
  env: NodeJS.ProcessEnv = process.env,
): AidocConfig {
  const explorer = cosmiconfigSync("aidoc");
  const result = searchFrom ? explorer.search(searchFrom) : explorer.search();
  let fileConfig: AidocConfig = defaultConfig;

  if (result && !result.isEmpty) {
    const apiKeyDescriptor =
      typeof result.config === "object" && result.config !== null
        ? Object.getOwnPropertyDescriptor(result.config, "apiKey")
        : undefined;
    if (apiKeyDescriptor !== undefined) {
      console.warn(
        'Deprecated Aidoc config field "apiKey" detected; use the provider-specific environment variable instead.',
      );
    }
    try {
      fileConfig = ConfigSchema.parse({
        ...defaultConfig,
        ...result.config,
      });
    } catch {
      console.warn("⚠️  Invalid aidoc configuration. Using defaults.");
    }
  }

  return parseConfigValues(fileConfig, env);
}

/** Loads provider environment immediately before resolving full configuration. */
export function loadProviderConfig(searchFrom?: string): AidocConfig {
  dotenv.config({ quiet: true });
  return loadConfig(searchFrom);
}

function safeFileRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid aidoc configuration");
  }

  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    throw new Error("invalid aidoc configuration");
  }
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new Error("invalid aidoc configuration");
    }
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error("invalid aidoc configuration");
    }
    result[key] = descriptor.value;
  }
  return result;
}

/** Combines a declarative config value with the selected environment snapshot. */
export function parseConfigValues(
  fileValue: unknown,
  env: Readonly<NodeJS.ProcessEnv>,
): AidocConfig {
  const fileConfig = ConfigSchema.parse({
    ...defaultConfig,
    ...safeFileRecord(fileValue),
  });
  const envConfig = environmentConfig(env);
  const effectiveConfig = ConfigSchema.parse({
    ...fileConfig,
    ...envConfig,
  });

  // A generic legacy apiKey belongs only to the provider recorded in the file.
  // If the environment selects another provider, do not transport that file key
  // across provider boundaries; provider-specific environment keys still win in
  // the registry for the selected provider.
  if (envConfig.provider && envConfig.provider !== fileConfig.provider) {
    return { ...effectiveConfig, apiKey: undefined };
  }

  return effectiveConfig;
}

export { defaultConfig, ConfigSchema, AidocConfig };
