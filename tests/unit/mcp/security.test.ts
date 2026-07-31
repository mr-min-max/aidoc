jest.mock("../../../src/config/loader", () => ({
  loadConfig: jest.fn(),
}));

jest.mock("../../../src/providers/registry", () => ({
  createProvider: jest.fn(),
}));

jest.mock("../../../src/core/analyzer", () => ({
  analyzeCodebase: jest.fn(),
}));

jest.mock("../../../src/core/generator", () => ({
  Generator: jest.fn().mockImplementation(() => ({
    generateReadme: jest.fn().mockResolvedValue("# Safe Markdown\n"),
  })),
}));

import { analyzeCodebase } from "../../../src/core/analyzer";
import { Generator } from "../../../src/core/generator";
import { loadConfig } from "../../../src/config/loader";
import { handleToolCall } from "../../../src/mcp/server";
import { createProvider } from "../../../src/providers/registry";

const analyzeCodebaseMock = analyzeCodebase as jest.MockedFunction<
  typeof analyzeCodebase
>;
const createProviderMock = createProvider as jest.MockedFunction<
  typeof createProvider
>;
const loadConfigMock = loadConfig as jest.MockedFunction<typeof loadConfig>;
const generatorMock = Generator as unknown as jest.Mock;

describe("MCP Trust Gate wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadConfigMock.mockReturnValue({
      provider: "openai",
      include: ["**/*.ts"],
      exclude: ["**/node_modules/**"],
      trustPolicy: "strict",
    } as ReturnType<typeof loadConfig>);
    createProviderMock.mockReturnValue({
      name: "provider-free-test-double",
      generate: jest.fn().mockResolvedValue("# unused provider output\n"),
    });
    analyzeCodebaseMock.mockResolvedValue([]);
  });

  it("constructs README generation with strict MCP security options", async () => {
    const fixture = __dirname;

    const result = await handleToolCall("generate_readme", {
      directory: fixture,
    });

    expect(result).toEqual({
      content: "# Safe Markdown\n",
      format: "markdown",
    });
    expect(generatorMock).toHaveBeenCalledTimes(1);
    expect(generatorMock.mock.calls[0][2]).toEqual({
      policy: "strict",
      origin: "mcp",
    });
  });
});
