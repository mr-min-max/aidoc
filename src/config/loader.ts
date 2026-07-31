import { cosmiconfigSync } from "cosmiconfig";
import { ConfigSchema, AidocConfig, defaultConfig } from "./schema";

function environmentConfig(env: NodeJS.ProcessEnv): Record<string, unknown> {
  return {
    ...(env.AIDOC_PROVIDER ? { provider: env.AIDOC_PROVIDER } : {}),
    ...(env.AIDOC_MODEL ? { model: env.AIDOC_MODEL } : {}),
    ...(env.AIDOC_OLLAMA_HOST ? { ollamaHost: env.AIDOC_OLLAMA_HOST } : {}),
    ...(env.AIDOC_TRUST_POLICY ? { trustPolicy: env.AIDOC_TRUST_POLICY } : {}),
  };
}

export function loadConfig(
  searchFrom?: string,
  env: NodeJS.ProcessEnv = process.env,
): AidocConfig {
  const explorer = cosmiconfigSync("aidoc");
  const result = searchFrom ? explorer.search(searchFrom) : explorer.search();
  let fileConfig: AidocConfig = defaultConfig;

  if (result && !result.isEmpty) {
    if (
      typeof result.config === "object" &&
      result.config !== null &&
      Object.prototype.hasOwnProperty.call(result.config, "apiKey")
    ) {
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

  return ConfigSchema.parse({
    ...fileConfig,
    ...environmentConfig(env),
  });
}

export { defaultConfig, ConfigSchema, AidocConfig };
