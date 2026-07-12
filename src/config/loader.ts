import { cosmiconfigSync } from "cosmiconfig";
import { ConfigSchema, AidocConfig, defaultConfig } from "./schema.js";

/** Loads aidoc configuration from cosmiconfig and falls back to defaults. */
export function loadConfig(searchFrom?: string): AidocConfig {
  const explorer = cosmiconfigSync("aidoc");
  const result = searchFrom ? explorer.search(searchFrom) : explorer.search();

  if (result && !result.isEmpty) {
    try {
      return ConfigSchema.parse({ ...defaultConfig, ...result.config });
    } catch {
      console.warn("⚠️  Invalid aidoc configuration. Using defaults.");
      return defaultConfig;
    }
  }
  return defaultConfig;
}

export { defaultConfig, ConfigSchema };
export type { AidocConfig };
