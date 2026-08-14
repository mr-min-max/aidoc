import type { AidocConfig } from "../config/schema";
import { TRUST_POLICIES, type TrustPolicy } from "../security/types";
import {
  buildProviderChoices,
  createInteractivePrompter,
  assertQwenPlanAllowed,
  type ProviderChoice,
  type QwenOnboardingChoice,
} from "./onboarding";
import {
  approveCompatibleEndpoint,
  buildQwenPaygEndpoint,
  type ApprovedProviderEndpoint,
} from "./endpoints";
import {
  ProviderConfigurationError,
  type ProviderSelectionGuidance,
} from "./errors";
import { getProviderProfile, PROVIDER_PROFILES } from "./profiles";
import { listProviders } from "./registry";

export type ProviderSelectionSource =
  | "command"
  | "environment"
  | "project"
  | "detected"
  | "interactive";

export interface ResolvedProviderSelection {
  readonly provider: string;
  readonly model?: string;
  readonly endpoint?: ApprovedProviderEndpoint;
  readonly source: ProviderSelectionSource;
  readonly boundary: "remote" | "local";
  readonly credentialEnv?: string;
  readonly qwen?: {
    readonly region: NonNullable<AidocConfig["qwenRegion"]>;
    readonly workspaceId?: string;
  };
}

export interface ProviderSelectionOverrides {
  readonly provider?: string;
  readonly model?: string;
  readonly providerBaseUrl?: string;
  readonly allowLocalHttp?: boolean;
}

export interface ProviderBoundarySummary {
  readonly provider: string;
  readonly model?: string;
  readonly origin?: string;
  readonly boundary: "remote" | "local";
  readonly targetPaths: readonly string[];
  readonly contextBytes: number;
  readonly trustPolicy: TrustPolicy;
}

export interface ProviderPrompter {
  chooseProvider(choices: readonly ProviderChoice[]): Promise<string | null>;
  chooseOllamaModel(models: readonly string[]): Promise<string | null>;
  configureQwen(): Promise<QwenOnboardingChoice | null>;
  confirmBoundary(summary: ProviderBoundarySummary): Promise<boolean>;
  rememberSelection(): Promise<boolean>;
}

function providerSource(
  overrides: ProviderSelectionOverrides | undefined,
  env: NodeJS.ProcessEnv,
  config: AidocConfig,
): { provider?: string; source?: ProviderSelectionSource } {
  if (overrides?.provider !== undefined) {
    return { provider: overrides.provider, source: "command" };
  }
  if (env.AIDOC_PROVIDER !== undefined && env.AIDOC_PROVIDER.length > 0) {
    return { provider: env.AIDOC_PROVIDER, source: "environment" };
  }
  if (config.provider !== "auto") {
    return { provider: config.provider, source: "project" };
  }
  return {};
}

function envModel(
  overrides: ProviderSelectionOverrides | undefined,
  env: NodeJS.ProcessEnv,
  config: AidocConfig,
): { model?: string; source?: ProviderSelectionSource } {
  if (overrides?.model !== undefined) {
    return { model: overrides.model, source: "command" };
  }
  if (env.AIDOC_MODEL !== undefined && env.AIDOC_MODEL.length > 0) {
    return { model: env.AIDOC_MODEL, source: "environment" };
  }
  if (config.model !== undefined) {
    return { model: config.model, source: "project" };
  }
  return {};
}

function allowLocalHttp(
  overrides: ProviderSelectionOverrides | undefined,
  env: NodeJS.ProcessEnv,
  config: AidocConfig,
): boolean {
  if (overrides?.allowLocalHttp !== undefined) return overrides.allowLocalHttp;
  if (env.AIDOC_ALLOW_LOCAL_HTTP === "true") return true;
  if (env.AIDOC_ALLOW_LOCAL_HTTP === "false") return false;
  return config.allowLocalHttp;
}

function providerBaseUrl(
  overrides: ProviderSelectionOverrides | undefined,
  env: NodeJS.ProcessEnv,
  config: AidocConfig,
): string | undefined {
  return (
    overrides?.providerBaseUrl ??
    (env.AIDOC_PROVIDER_BASE_URL || undefined) ??
    config.providerBaseUrl
  );
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

function profileFor(provider: string) {
  return getProviderProfile(provider);
}

function withoutLegacyCredential(config: AidocConfig): AidocConfig {
  const sanitized = { ...config } as AidocConfig & { apiKey?: string };
  delete sanitized.apiKey;
  return sanitized;
}

function explicitProviderAvailable(
  provider: string,
  config: AidocConfig,
  env: NodeJS.ProcessEnv,
): boolean {
  const profile = profileFor(provider);
  if (profile === undefined) {
    const definition = listProviders().find((item) => item.name === provider);
    if (definition === undefined) return false;
    try {
      return definition.available(
        config.provider === provider ? config : withoutLegacyCredential(config),
      );
    } catch {
      return false;
    }
  }
  if (profile.name === "ollama") return true;
  const environmentCredential =
    profile.credentialEnv === undefined
      ? undefined
      : env[profile.credentialEnv];
  return (
    isNonEmpty(environmentCredential) ||
    (config.provider === provider && isNonEmpty(config.apiKey))
  );
}

function missingCredentialGuidance(
  profile: ReturnType<typeof profileFor>,
): ProviderSelectionGuidance | undefined {
  if (profile === undefined || profile.name === "ollama") return undefined;
  const credentialEnv = profile.credentialEnv;
  if (
    credentialEnv !== "OPENAI_API_KEY" &&
    credentialEnv !== "ANTHROPIC_API_KEY" &&
    credentialEnv !== "DEEPSEEK_API_KEY" &&
    credentialEnv !== "DASHSCOPE_API_KEY" &&
    credentialEnv !== "AIDOC_COMPAT_API_KEY"
  ) {
    return undefined;
  }
  return {
    reason: "missing-credential",
    provider: profile.name,
    credentialEnv,
  };
}

function selectionRequired(
  guidance?: ProviderSelectionGuidance,
): ProviderConfigurationError {
  return new ProviderConfigurationError(
    "PROVIDER_SELECTION_REQUIRED",
    guidance,
  );
}

function remoteReadyProviders(env: NodeJS.ProcessEnv): string[] {
  return PROVIDER_PROFILES.filter(
    (profile) =>
      profile.boundary === "remote" &&
      profile.credentialEnv !== undefined &&
      isNonEmpty(env[profile.credentialEnv]),
  ).map((profile) => profile.name);
}

function selectedModel(
  provider: string,
  requestedModel: string | undefined,
): string | undefined {
  return requestedModel ?? profileFor(provider)?.defaultModel;
}

const FIXED_PROVIDER_ORIGINS: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com",
};

function providerOrigin(
  selection: ResolvedProviderSelection,
): string | undefined {
  const origin =
    selection.endpoint?.origin ?? FIXED_PROVIDER_ORIGINS[selection.provider];
  if (
    origin === undefined &&
    getProviderProfile(selection.provider) !== undefined
  ) {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
  }
  return origin;
}

const QWEN_REGIONS: readonly NonNullable<AidocConfig["qwenRegion"]>[] = [
  "china-beijing",
  "china-hongkong",
  "singapore",
  "japan-tokyo",
  "germany-frankfurt",
  "us-virginia",
];

function effectiveQwenConfig(
  config: AidocConfig,
  env: NodeJS.ProcessEnv,
): AidocConfig {
  const environmentRegion = QWEN_REGIONS.includes(
    env.AIDOC_QWEN_REGION as NonNullable<AidocConfig["qwenRegion"]>,
  )
    ? (env.AIDOC_QWEN_REGION as NonNullable<AidocConfig["qwenRegion"]>)
    : undefined;
  return {
    ...config,
    ...(environmentRegion === undefined
      ? {}
      : { qwenRegion: environmentRegion }),
    ...(env.AIDOC_QWEN_WORKSPACE_ID === undefined
      ? {}
      : { qwenWorkspaceId: env.AIDOC_QWEN_WORKSPACE_ID }),
  };
}

async function completeQwenConfiguration(input: {
  config: AidocConfig;
  interactive: boolean;
  prompter: ProviderPrompter;
}): Promise<{
  region: NonNullable<AidocConfig["qwenRegion"]>;
  workspaceId?: string;
} | null> {
  if (input.config.qwenRegion !== undefined) {
    return {
      region: input.config.qwenRegion,
      ...(input.config.qwenWorkspaceId === undefined
        ? {}
        : { workspaceId: input.config.qwenWorkspaceId }),
    };
  }
  if (!input.interactive) {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
  }
  const choice = await input.prompter.configureQwen();
  if (choice === null) return null;
  assertQwenPlanAllowed(choice.plan);
  return { region: choice.region, workspaceId: choice.workspaceId };
}

async function resolveExplicit(input: {
  provider: string;
  source: ProviderSelectionSource;
  requestedModel?: string;
  config: AidocConfig;
  env: NodeJS.ProcessEnv;
  interactive: boolean;
  prompter: ProviderPrompter;
  listOllamaModels?: () => Promise<readonly string[]>;
  endpointBaseUrl?: string;
  allowLocalHttp: boolean;
}): Promise<ResolvedProviderSelection | null> {
  const profile = profileFor(input.provider);
  if (
    profile === undefined &&
    !listProviders().some((item) => item.name === input.provider)
  ) {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
  }

  let qwenConfiguration:
    | { region: NonNullable<AidocConfig["qwenRegion"]>; workspaceId?: string }
    | null
    | undefined;
  if (profile?.name === "qwen") {
    if (input.endpointBaseUrl !== undefined) {
      throw new ProviderConfigurationError("PROVIDER_INVALID_ENDPOINT");
    }
    // Validate the selected Qwen plan before checking the key or building an endpoint.
    qwenConfiguration = await completeQwenConfiguration({
      config: effectiveQwenConfig(input.config, input.env),
      interactive: input.interactive,
      prompter: input.prompter,
    });
    if (qwenConfiguration === null) return null;
  }

  if (!explicitProviderAvailable(input.provider, input.config, input.env)) {
    throw selectionRequired(missingCredentialGuidance(profile));
  }

  let model = selectedModel(input.provider, input.requestedModel);
  let endpoint: ApprovedProviderEndpoint | undefined;
  if (profile?.name === "ollama") {
    endpoint = await approveCompatibleEndpoint({
      rawUrl: input.config.ollamaHost,
      allowLocalHttp: true,
    });
    if (!endpoint.local || endpoint.url.protocol !== "http:") {
      throw new ProviderConfigurationError("PROVIDER_ENDPOINT_NOT_PUBLIC");
    }
    if (model === undefined) {
      const models =
        input.listOllamaModels === undefined
          ? []
          : await input.listOllamaModels();
      if (!input.interactive || models.length === 0) {
        throw selectionRequired({ reason: "ollama-model" });
      }
      model = (await input.prompter.chooseOllamaModel(models)) ?? undefined;
      if (model === undefined) {
        return null;
      }
    }
  } else if (profile?.name === "openai-compatible") {
    if (model === undefined || input.endpointBaseUrl === undefined) {
      throw selectionRequired();
    }
    endpoint = await approveCompatibleEndpoint({
      rawUrl: input.endpointBaseUrl,
      allowLocalHttp: input.allowLocalHttp,
    });
  } else if (profile?.name === "qwen") {
    const qwen = qwenConfiguration!;
    const qwenUrl = buildQwenPaygEndpoint(qwen);
    endpoint = {
      url: qwenUrl,
      origin: qwenUrl.origin,
      local: false,
      addresses: [],
    };
  }

  return {
    provider: input.provider,
    ...(model === undefined ? {} : { model }),
    ...(endpoint === undefined ? {} : { endpoint }),
    source: input.source,
    boundary: profile?.boundary ?? "remote",
    ...(profile?.credentialEnv === undefined
      ? {}
      : { credentialEnv: profile.credentialEnv }),
    ...(qwenConfiguration === undefined || qwenConfiguration === null
      ? {}
      : { qwen: qwenConfiguration }),
  };
}

/** Resolves provider, model, endpoint, and credential metadata without creating a provider. */
export async function resolveProviderSelection(input: {
  config: AidocConfig;
  overrides?: ProviderSelectionOverrides;
  env?: NodeJS.ProcessEnv;
  interactive: boolean;
  prompter?: ProviderPrompter;
  listOllamaModels?: () => Promise<readonly string[]>;
}): Promise<ResolvedProviderSelection | null> {
  const env = input.env ?? process.env;
  const prompter = input.prompter ?? createInteractivePrompter();
  const commandAuto = input.overrides?.provider === "auto";
  const environmentAuto =
    input.overrides?.provider === undefined && env.AIDOC_PROVIDER === "auto";
  const source =
    commandAuto || environmentAuto
      ? {}
      : providerSource(input.overrides, env, input.config);
  const model = envModel(input.overrides, env, input.config);
  const baseUrl = providerBaseUrl(input.overrides, env, input.config);
  const localHttp = allowLocalHttp(input.overrides, env, input.config);

  if (source.provider !== undefined) {
    return resolveExplicit({
      provider: source.provider,
      source: source.source!,
      requestedModel: model.model,
      config: input.config,
      env,
      interactive: input.interactive,
      prompter,
      listOllamaModels: input.listOllamaModels,
      endpointBaseUrl: baseUrl,
      allowLocalHttp: localHttp,
    });
  }

  const ready = remoteReadyProviders(env);
  if (ready.length === 1 && input.interactive) {
    return resolveExplicit({
      provider: ready[0],
      source: "detected",
      requestedModel: model.model,
      config: input.config,
      env,
      interactive: input.interactive,
      prompter,
      listOllamaModels: input.listOllamaModels,
      endpointBaseUrl: baseUrl,
      allowLocalHttp: localHttp,
    });
  }
  if (ready.length > 1) {
    if (!input.interactive) {
      throw selectionRequired({ reason: "multiple-remote" });
    }
    const choices = buildProviderChoices({
      readyProviders: ready,
      availableModels: [],
    });
    const chosen = await prompter.chooseProvider(choices);
    if (chosen === null || chosen === "exit" || chosen === "subscription-mcp")
      return null;
    return resolveExplicit({
      provider: chosen,
      source: "interactive",
      requestedModel: model.model,
      config: input.config,
      env,
      interactive: input.interactive,
      prompter,
      listOllamaModels: input.listOllamaModels,
      endpointBaseUrl: baseUrl,
      allowLocalHttp: localHttp,
    });
  }

  if (input.listOllamaModels !== undefined) {
    const models = await input.listOllamaModels();
    if (models.length > 0) {
      if (!input.interactive && model.model === undefined) {
        throw selectionRequired({ reason: "ollama-model" });
      }
      const chosenModel =
        model.model ?? (await prompter.chooseOllamaModel(models));
      if (chosenModel === null || chosenModel === undefined) return null;
      return resolveExplicit({
        provider: "ollama",
        source:
          input.interactive && model.model === undefined
            ? "interactive"
            : "detected",
        requestedModel: chosenModel,
        config: input.config,
        env,
        interactive: input.interactive,
        prompter,
        listOllamaModels: input.listOllamaModels,
        endpointBaseUrl: baseUrl,
        allowLocalHttp: localHttp,
      });
    }
  }

  if (input.interactive) {
    const choices = buildProviderChoices({
      readyProviders: [],
      availableModels: [],
    });
    const chosen = await prompter.chooseProvider(choices);
    if (chosen === null || chosen === "exit" || chosen === "subscription-mcp")
      return null;
    return resolveExplicit({
      provider: chosen,
      source: "interactive",
      requestedModel: model.model,
      config: input.config,
      env,
      interactive: input.interactive,
      prompter,
      listOllamaModels: input.listOllamaModels,
      endpointBaseUrl: baseUrl,
      allowLocalHttp: localHttp,
    });
  }

  throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
}

/** Confirms an explicit provider boundary, using the prompter only when required. */
export async function confirmProviderBoundary(input: {
  selection: ResolvedProviderSelection;
  targetPaths: readonly string[];
  contextBytes: number;
  trustPolicy: TrustPolicy;
  interactive: boolean;
  yes: boolean;
  prompter?: ProviderPrompter;
}): Promise<boolean> {
  if (input.selection.provider === "auto") {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
  }
  if (!TRUST_POLICIES.includes(input.trustPolicy)) {
    throw new ProviderConfigurationError("PROVIDER_SELECTION_REQUIRED");
  }
  const explicit = ["command", "environment", "project"].includes(
    input.selection.source,
  );
  if (input.yes && explicit) return true;
  if (!input.interactive) return false;
  const prompter = input.prompter ?? createInteractivePrompter();
  return prompter.confirmBoundary({
    provider: input.selection.provider,
    model: input.selection.model,
    origin: providerOrigin(input.selection),
    boundary: input.selection.boundary,
    targetPaths: [...input.targetPaths].sort(),
    contextBytes: input.contextBytes,
    trustPolicy: input.trustPolicy,
  });
}

export { ProviderConfigurationError } from "./errors";
export type { ProviderChoice } from "./onboarding";
