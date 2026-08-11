jest.mock("../../../src/config/loader", () => ({
  loadProviderConfig: jest.fn(),
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
import { loadProviderConfig } from "../../../src/config/loader";
import { formatMCPError, handleToolCall, TOOLS } from "../../../src/mcp/server";
import { createProvider } from "../../../src/providers/registry";
import {
  RepositoryWriteError,
  REPOSITORY_WRITE_ERROR_CODES,
} from "../../../src/security/types";

const analyzeCodebaseMock = analyzeCodebase as jest.MockedFunction<
  typeof analyzeCodebase
>;
const createProviderMock = createProvider as jest.MockedFunction<
  typeof createProvider
>;
const loadProviderConfigMock = loadProviderConfig as jest.MockedFunction<
  typeof loadProviderConfig
>;
const generatorMock = Generator as unknown as jest.Mock;

describe("MCP Trust Gate wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadProviderConfigMock.mockReturnValue({
      provider: "openai",
      include: ["**/*.ts"],
      exclude: ["**/node_modules/**"],
      trustPolicy: "strict",
    } as ReturnType<typeof loadProviderConfig>);
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

  it("does not double-prefix an already-prefixed allowlisted error", () => {
    const error = Object.assign(
      new Error("TRUST_SECRET_BLOCKED: Trust Gate rejected input."),
      { code: "TRUST_SECRET_BLOCKED" },
    );

    expect(formatMCPError(error)).toBe(
      "TRUST_SECRET_BLOCKED: Trust Gate rejected input.",
    );
  });

  it("fails closed when an error exposes an unallowlisted code", () => {
    const error = Object.assign(new Error("safe-looking failure"), {
      code: "UNTRUSTED_CODE",
    });

    expect(formatMCPError(error)).toBe("Unknown MCP error.");
  });

  it.each(REPOSITORY_WRITE_ERROR_CODES)(
    "serializes %s with one stable prefix and no caller values",
    (code) => {
      const fakeTarget = `/outside/hostile-${code}.md`;
      const fakeSecret = ["sk", "proj", "M".repeat(32)].join("-");
      const error = Object.assign(
        code === "TRUST_ATOMIC_WRITE_FAILED"
          ? new RepositoryWriteError(code, "replace")
          : new RepositoryWriteError(code),
        { fakeTarget, fakeSecret },
      );

      const formatted = formatMCPError(error);

      expect(formatted.startsWith(`${code}: `)).toBe(true);
      expect(formatted.match(new RegExp(code, "gu"))).toHaveLength(1);
      expect(formatted).not.toContain(fakeTarget);
      expect(formatted).not.toContain(fakeSecret);
    },
  );

  it("exposes only content-oriented MCP tools without output or mutators", () => {
    const mutatingToolNames = new Set([
      "apply_patch",
      "append_file",
      "delete_file",
      "mkdir",
      "patch_file",
      "remove_file",
      "rename_file",
      "rmdir",
      "save_file",
      "write",
      "write_file",
      "writeFile",
      "write_document",
    ]);

    expect(
      TOOLS.some((tool) => {
        const properties = tool.inputSchema.properties;
        return properties !== undefined && Object.hasOwn(properties, "output");
      }),
    ).toBe(false);
    expect(TOOLS.some((tool) => mutatingToolNames.has(tool.name))).toBe(false);
  });
});
