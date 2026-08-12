import {
  assertQwenPlanAllowed,
  buildProviderChoices,
  createInteractivePrompter,
} from "../../../src/providers/onboarding";

jest.mock("prompts", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ confirmed: true }),
}));

import prompts from "prompts";

describe("provider onboarding", () => {
  it("keeps the direct CLI choices grouped around honest provider boundaries", () => {
    const choices = buildProviderChoices({
      readyProviders: ["openai"],
      availableModels: [],
    });

    expect(choices.map((choice) => choice.group)).toEqual(
      expect.arrayContaining([
        "Available now",
        "Connect another provider",
        "Use a ChatGPT subscription in Codex, or use Claude, through local MCP",
        "Exit without sending data",
      ]),
    );
    expect(choices.find((choice) => choice.value === "openai")?.group).toBe(
      "Available now",
    );
    expect(
      choices.find((choice) => choice.value === "subscription-mcp")?.group,
    ).toBe(
      "Use a ChatGPT subscription in Codex, or use Claude, through local MCP",
    );
  });

  it("rejects Qwen Coding Plan and Token Plan choices before any key use", () => {
    expect(() => assertQwenPlanAllowed("coding-plan")).toThrow(
      expect.objectContaining({
        code: "QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP",
      }),
    );
    expect(() => assertQwenPlanAllowed("token-plan")).toThrow(
      expect.objectContaining({
        code: "QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP",
      }),
    );
    expect(() => assertQwenPlanAllowed("pay-as-you-go")).not.toThrow();
  });

  it("shows the Trust Gate policy in the production confirmation prompt", async () => {
    const prompt = prompts as unknown as jest.Mock;
    prompt.mockClear();
    await createInteractivePrompter().confirmBoundary({
      provider: "openai",
      model: "gpt-5.6-luna",
      origin: "https://api.openai.com",
      boundary: "remote",
      targetPaths: ["README.md"],
      contextBytes: 256,
      trustPolicy: "strict",
    });

    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Trust Gate policy: strict"),
      }),
    );
  });
});
