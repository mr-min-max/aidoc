export type ProviderConfigurationErrorCode =
  | "PROVIDER_INVALID_ENDPOINT"
  | "PROVIDER_ENDPOINT_NOT_PUBLIC"
  | "PROVIDER_LOCAL_HTTP_NOT_CONFIRMED"
  | "PROVIDER_SELECTION_REQUIRED"
  | "PROVIDER_SELECTION_CANCELLED"
  | "QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP";

export type ProviderSelectionGuidance =
  | {
      readonly reason: "missing-credential";
      readonly provider:
        | "openai"
        | "anthropic"
        | "deepseek"
        | "qwen"
        | "openai-compatible";
      readonly credentialEnv:
        | "OPENAI_API_KEY"
        | "ANTHROPIC_API_KEY"
        | "DEEPSEEK_API_KEY"
        | "DASHSCOPE_API_KEY"
        | "AIDOC_COMPAT_API_KEY";
    }
  | { readonly reason: "ollama-model" }
  | { readonly reason: "multiple-remote" };

export type ProviderConfigurationMessageVariant = "remote-http";

const PROVIDER_CONFIGURATION_MESSAGES: Record<
  ProviderConfigurationErrorCode,
  string
> = {
  PROVIDER_INVALID_ENDPOINT:
    "The provider endpoint is invalid. Use an HTTP(S) URL without credentials, query, or fragment.",
  PROVIDER_ENDPOINT_NOT_PUBLIC:
    "The provider endpoint must resolve only to public addresses.",
  PROVIDER_LOCAL_HTTP_NOT_CONFIRMED:
    "Loopback HTTP endpoints require explicit local-HTTP permission.",
  PROVIDER_SELECTION_REQUIRED:
    "Provider selection is required. Set AIDOC_PROVIDER and AIDOC_MODEL explicitly before running non-interactively.",
  PROVIDER_SELECTION_CANCELLED:
    "Provider selection was cancelled before any model request.",
  QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP:
    "Qwen Coding Plan and Token Plan keys cannot be used by custom applications. Choose a pay-as-you-go Model Studio API key.",
};

function selectionRequiredMessage(
  guidance: ProviderSelectionGuidance | undefined,
): string {
  if (guidance?.reason === "missing-credential") {
    return `Provider "${guidance.provider}" is configured but ${guidance.credentialEnv} is missing. Set ${guidance.credentialEnv} in the environment before running.`;
  }
  if (guidance?.reason === "ollama-model") {
    return "Ollama needs an installed model. Set AIDOC_PROVIDER=ollama AIDOC_MODEL=<installed-model> before running non-interactively.";
  }
  if (guidance?.reason === "multiple-remote") {
    return "Multiple remote providers are ready. Set AIDOC_PROVIDER explicitly before running non-interactively.";
  }
  return PROVIDER_CONFIGURATION_MESSAGES.PROVIDER_SELECTION_REQUIRED;
}

function configurationMessage(
  code: ProviderConfigurationErrorCode,
  variant: ProviderConfigurationMessageVariant | undefined,
  guidance: ProviderSelectionGuidance | undefined,
): string {
  if (code === "PROVIDER_SELECTION_REQUIRED") {
    return selectionRequiredMessage(guidance);
  }
  if (variant === "remote-http") {
    return "Remote provider endpoints must use HTTPS; HTTP is limited to explicit loopback.";
  }
  return PROVIDER_CONFIGURATION_MESSAGES[code];
}

/** A stable provider setup error whose message never contains a secret or URL. */
export class ProviderConfigurationError extends Error {
  constructor(
    readonly code: ProviderConfigurationErrorCode,
    guidanceOrVariant?:
      | ProviderSelectionGuidance
      | ProviderConfigurationMessageVariant,
    guidance?: ProviderSelectionGuidance,
  ) {
    const variant =
      guidanceOrVariant === "remote-http" ? guidanceOrVariant : undefined;
    const selectionGuidance =
      typeof guidanceOrVariant === "object" ? guidanceOrVariant : guidance;
    super(configurationMessage(code, variant, selectionGuidance));
    this.name = "ProviderConfigurationError";
  }
}
