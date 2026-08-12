import prompts from "prompts";
import { ProviderConfigurationError } from "./errors";

export type QwenPlan = "pay-as-you-go" | "coding-plan" | "token-plan";

export interface QwenOnboardingChoice {
  readonly plan: QwenPlan;
  readonly region:
    | "china-beijing"
    | "china-hongkong"
    | "singapore"
    | "japan-tokyo"
    | "germany-frankfurt"
    | "us-virginia";
  readonly workspaceId?: string;
}

export interface ProviderChoice {
  readonly value: string;
  readonly title: string;
  readonly description?: string;
  readonly group: string;
}

export const ONBOARDING_GROUPS = {
  available: "Available now",
  connect: "Connect another provider",
  subscription:
    "Use a ChatGPT subscription in Codex, or use Claude, through local MCP",
  exit: "Exit without sending data",
} as const;

export function buildProviderChoices(input: {
  readyProviders: readonly string[];
  availableModels: readonly string[];
}): readonly ProviderChoice[] {
  const ready = [...new Set(input.readyProviders)].sort();
  const choices: ProviderChoice[] = ready.map((provider) => ({
    value: provider,
    title: provider,
    group: ONBOARDING_GROUPS.available,
  }));

  const connectable = [
    "openai",
    "anthropic",
    "deepseek",
    "qwen",
    "ollama",
    "openai-compatible",
  ].filter((provider) => !ready.includes(provider));
  choices.push(
    ...connectable.map((provider) => ({
      value: provider,
      title: provider,
      group: ONBOARDING_GROUPS.connect,
    })),
  );
  choices.push({
    value: "subscription-mcp",
    title: "Use a subscription host",
    description:
      "Use a ChatGPT subscription in Codex, or use Claude, through local MCP.",
    group: ONBOARDING_GROUPS.subscription,
  });
  choices.push({
    value: "exit",
    title: "Exit",
    group: ONBOARDING_GROUPS.exit,
  });
  return choices;
}

export function assertQwenPlanAllowed(plan: QwenPlan): void {
  if (plan !== "pay-as-you-go") {
    throw new ProviderConfigurationError(
      "QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP",
    );
  }
}

/** Default terminal adapter; selection remains testable without invoking it. */
export function createInteractivePrompter(): {
  chooseProvider: (
    choices: readonly ProviderChoice[],
  ) => Promise<string | null>;
  chooseOllamaModel: (models: readonly string[]) => Promise<string | null>;
  configureQwen: () => Promise<QwenOnboardingChoice | null>;
  confirmBoundary: (summary: ProviderBoundarySummaryLike) => Promise<boolean>;
  rememberSelection: () => Promise<boolean>;
} {
  return {
    async chooseProvider(choices) {
      const result = await prompts({
        type: "select",
        name: "value",
        message: "Choose how AiDoc should generate this update",
        choices: choices.map((choice) => ({
          title: `${choice.group}: ${choice.title}`,
          description: choice.description,
          value: choice.value,
        })),
      });
      return typeof result.value === "string" ? result.value : null;
    },
    async chooseOllamaModel(models) {
      const result = await prompts({
        type: "select",
        name: "value",
        message: "Choose an installed Ollama model",
        choices: models.map((model) => ({ title: model, value: model })),
      });
      return typeof result.value === "string" ? result.value : null;
    },
    async configureQwen() {
      const planResult = await prompts({
        type: "select",
        name: "plan",
        message: "Choose the Qwen API plan for this custom CLI",
        choices: [
          {
            title: "Pay-as-you-go Model Studio API key",
            value: "pay-as-you-go",
          },
          {
            title: "Coding Plan (not available to custom apps)",
            value: "coding-plan",
          },
          {
            title: "Token Plan (not available to custom apps)",
            value: "token-plan",
          },
        ],
      });
      if (typeof planResult.plan !== "string") return null;
      assertQwenPlanAllowed(planResult.plan as QwenPlan);

      const regionResult = await prompts({
        type: "select",
        name: "region",
        message: "Choose the Qwen Model Studio region",
        choices: [
          { title: "Beijing", value: "china-beijing" },
          { title: "Hong Kong", value: "china-hongkong" },
          { title: "Singapore", value: "singapore" },
          { title: "Tokyo", value: "japan-tokyo" },
          { title: "Frankfurt", value: "germany-frankfurt" },
          { title: "US Virginia", value: "us-virginia" },
        ],
      });
      if (typeof regionResult.region !== "string") return null;
      const needsWorkspace =
        regionResult.region !== "china-beijing" &&
        regionResult.region !== "us-virginia";
      let workspaceId: string | undefined;
      if (needsWorkspace) {
        const workspaceResult = await prompts({
          type: "text",
          name: "workspaceId",
          message: "Qwen workspace ID",
        });
        if (typeof workspaceResult.workspaceId !== "string") return null;
        workspaceId = workspaceResult.workspaceId;
      }
      return {
        plan: planResult.plan as QwenPlan,
        region: regionResult.region as QwenOnboardingChoice["region"],
        ...(workspaceId === undefined ? {} : { workspaceId }),
      };
    },
    async confirmBoundary(summary) {
      const result = await prompts({
        type: "confirm",
        name: "confirmed",
        initial: true,
        message: `${summary.provider} / ${summary.model ?? "model required"} via ${summary.origin ?? "custom provider"} (${summary.boundary}); Trust Gate policy: ${summary.trustPolicy}; send ${summary.contextBytes} bytes for ${summary.targetPaths.join(", ")}?`,
      });
      return result.confirmed === true;
    },
    async rememberSelection() {
      const result = await prompts({
        type: "confirm",
        name: "remember",
        initial: false,
        message: "Remember this provider in this project?",
      });
      return result.remember === true;
    },
  };
}

interface ProviderBoundarySummaryLike {
  provider: string;
  model?: string;
  origin?: string;
  boundary: "remote" | "local";
  targetPaths: readonly string[];
  contextBytes: number;
  trustPolicy: string;
}
