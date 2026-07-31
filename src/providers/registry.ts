import { LLMProvider } from "./types";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";

export interface ProviderDefinition {
  name: string;
  /** Returns true when all prerequisites are met (key present, SDK installed). */
  available: (config: ProviderConfig) => boolean;
  /** Human-readable reason when not available. */
  missingMessage?: string;
  create: (config: ProviderConfig) => LLMProvider;
}

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  ollamaHost?: string;
}

const registry = new Map<string, ProviderDefinition>();

const openAiKey = (config: ProviderConfig): string | undefined =>
  process.env.OPENAI_API_KEY || config.apiKey;

const anthropicKey = (config: ProviderConfig): string | undefined =>
  process.env.ANTHROPIC_API_KEY || config.apiKey;

/** Registers a provider. Lets the community add providers without editing core. */
export function registerProvider(def: ProviderDefinition): void {
  registry.set(def.name, def);
}

/** Lists all provider definitions registered in the current process. */
export function listProviders(): ProviderDefinition[] {
  return Array.from(registry.values());
}

/** Creates a configured LLM provider after validating prerequisites. */
export function createProvider(config: ProviderConfig): LLMProvider {
  const def = registry.get(config.provider);
  if (!def) {
    throw new Error(
      `Unknown provider: ${config.provider}. Available: ${listProviders()
        .map((p) => p.name)
        .join(", ")}`,
    );
  }
  if (!def.available(config)) {
    throw new Error(
      def.missingMessage || `Provider "${config.provider}" is not available.`,
    );
  }
  return def.create(config);
}

// --- Built-in providers (self-register) ---
registerProvider({
  name: "openai",
  available: (c) => !!openAiKey(c),
  missingMessage:
    "OpenAI API key is required.\nSet it via:\n" +
    '  • Environment variable: export OPENAI_API_KEY="sk-..."',
  create: (c) => new OpenAIProvider(openAiKey(c)!, c.model),
});

registerProvider({
  name: "anthropic",
  available: (c) => !!anthropicKey(c),
  missingMessage:
    "Anthropic API key is required.\n" +
    "Set it via:\n" +
    '  • Environment variable: export ANTHROPIC_API_KEY="sk-ant-..."',
  create: (c) => new AnthropicProvider(anthropicKey(c)!, c.model),
});

registerProvider({
  name: "ollama",
  available: () => true,
  create: (c) => new OllamaProvider(c.ollamaHost, c.model),
});
