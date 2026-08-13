import { LLMProvider } from "./types";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";
import { OpenAICompatibleProvider, ProviderTransportError } from "./compatible";
import { ProviderConfigurationError } from "./errors";
import { getProviderProfile } from "./profiles";
import {
  buildQwenPaygEndpoint,
  type ApprovedProviderEndpoint,
} from "./endpoints";

export type ProviderCredentialName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "DASHSCOPE_API_KEY"
  | "AIDOC_COMPAT_API_KEY";

export type ProviderCredentialEnvironment = Readonly<
  Partial<Record<ProviderCredentialName, string>>
>;

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
  providerBaseUrl?: string;
  allowLocalHttp?: boolean;
  /** Approved endpoint metadata is passed through for later transport pinning. */
  endpoint?: ApprovedProviderEndpoint;
  /** Accepted Qwen region metadata used to bind its credential to one origin. */
  qwen?: Parameters<typeof buildQwenPaygEndpoint>[0];
  /** Explicit credential authority for isolated MCP provider construction. */
  credentialEnvironment?: ProviderCredentialEnvironment;
}

const registry = new Map<string, ProviderDefinition>();

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function selectedCredential(
  config: ProviderConfig,
  provider: string,
  envName: ProviderCredentialName,
): string | undefined {
  const source = config.credentialEnvironment ?? process.env;
  const environmentValue = source[envName];
  if (nonEmpty(environmentValue)) return environmentValue;
  return config.provider === provider && nonEmpty(config.apiKey)
    ? config.apiKey
    : undefined;
}

function fixedEndpoint(origin: string): ApprovedProviderEndpoint {
  const url = new URL(origin);
  return {
    url,
    origin: url.origin,
    local: false,
    // Fixed vendor origins are re-approved and DNS-pinned by the transport on
    // every attempt. No unverified address is treated as approved here.
    addresses: [],
  };
}

function endpointSnapshot(config: ProviderConfig): ApprovedProviderEndpoint {
  if (config.endpoint !== undefined) return cloneEndpoint(config.endpoint);
  if (config.providerBaseUrl === undefined) {
    throw new ProviderTransportError(
      "PROVIDER_ENDPOINT_REQUIRED",
      "an approved provider endpoint is required",
    );
  }
  let url: URL;
  try {
    url = new URL(config.providerBaseUrl);
  } catch {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  return {
    url,
    origin: url.origin,
    local: config.allowLocalHttp === true && url.protocol === "http:",
    addresses: [],
  };
}

function cloneEndpoint(
  endpoint: ApprovedProviderEndpoint,
): ApprovedProviderEndpoint {
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

function defaultModel(provider: string): string | undefined {
  return getProviderProfile(provider)?.defaultModel;
}

function compatibleProvider(
  config: ProviderConfig,
  name: string,
  apiKey: string,
  model: string,
  endpoint: ApprovedProviderEndpoint,
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    name,
    apiKey,
    model,
    endpoint,
    allowLocalHttp: config.allowLocalHttp === true,
  });
}

function deepSeekEndpoint(config: ProviderConfig): ApprovedProviderEndpoint {
  if (config.endpoint !== undefined || config.providerBaseUrl !== undefined) {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  return fixedEndpoint("https://api.deepseek.com");
}

function qwenEndpoint(config: ProviderConfig): ApprovedProviderEndpoint {
  if (config.endpoint === undefined || config.qwen === undefined) {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  const canonical = buildQwenPaygEndpoint(config.qwen);
  if (
    config.endpoint.url.href !== canonical.href ||
    config.endpoint.origin !== canonical.origin ||
    config.endpoint.local ||
    (config.providerBaseUrl !== undefined &&
      config.providerBaseUrl !== canonical.href)
  ) {
    throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
  }
  return cloneEndpoint(config.endpoint);
}

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
  if (config.provider === "auto") {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
  }
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
  available: (c) => !!selectedCredential(c, "openai", "OPENAI_API_KEY"),
  missingMessage:
    "OpenAI API key is required.\nSet it via:\n" +
    '  • Environment variable: export OPENAI_API_KEY="sk-..."',
  create: (c) =>
    new OpenAIProvider(
      selectedCredential(c, "openai", "OPENAI_API_KEY")!,
      c.model,
    ),
});

registerProvider({
  name: "anthropic",
  available: (c) => !!selectedCredential(c, "anthropic", "ANTHROPIC_API_KEY"),
  missingMessage:
    "Anthropic API key is required.\n" +
    "Set it via:\n" +
    '  • Environment variable: export ANTHROPIC_API_KEY="sk-ant-..."',
  create: (c) =>
    new AnthropicProvider(
      selectedCredential(c, "anthropic", "ANTHROPIC_API_KEY")!,
      c.model,
    ),
});

registerProvider({
  name: "deepseek",
  available: (c) => !!selectedCredential(c, "deepseek", "DEEPSEEK_API_KEY"),
  missingMessage:
    "DeepSeek API key is required.\n" +
    'Set it via: export DEEPSEEK_API_KEY="..."',
  create: (c) =>
    compatibleProvider(
      c,
      "deepseek",
      selectedCredential(c, "deepseek", "DEEPSEEK_API_KEY")!,
      c.model ?? defaultModel("deepseek")!,
      deepSeekEndpoint(c),
    ),
});

registerProvider({
  name: "qwen",
  available: (c) =>
    !!selectedCredential(c, "qwen", "DASHSCOPE_API_KEY") &&
    c.endpoint !== undefined &&
    c.qwen !== undefined,
  missingMessage:
    "Qwen API key and an accepted endpoint are required.\n" +
    'Set it via: export DASHSCOPE_API_KEY="..."',
  create: (c) =>
    compatibleProvider(
      c,
      "qwen",
      selectedCredential(c, "qwen", "DASHSCOPE_API_KEY")!,
      c.model ?? defaultModel("qwen")!,
      qwenEndpoint(c),
    ),
});

registerProvider({
  name: "ollama",
  available: () => true,
  create: (c) =>
    new OllamaProvider(
      c.endpoint?.url.toString() ?? c.ollamaHost,
      c.model,
      c.endpoint,
    ),
});

registerProvider({
  name: "openai-compatible",
  available: (c) =>
    !!selectedCredential(c, "openai-compatible", "AIDOC_COMPAT_API_KEY") &&
    nonEmpty(c.model) &&
    (c.endpoint !== undefined || nonEmpty(c.providerBaseUrl)),
  missingMessage:
    "An explicit compatible endpoint, model, and AIDOC_COMPAT_API_KEY are required.",
  create: (c) =>
    compatibleProvider(
      c,
      "openai-compatible",
      selectedCredential(c, "openai-compatible", "AIDOC_COMPAT_API_KEY")!,
      c.model!,
      endpointSnapshot(c),
    ),
});
