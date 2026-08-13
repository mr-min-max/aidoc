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
  MCP_INVALID_PREPARATION,
  MCPPreparationError,
} from "../../../src/mcp/preparation-token";
import {
  MCP_TARGET_REQUIRED,
  MCPTargetRequiredError,
} from "../../../src/mcp/update-workflow";
import {
  RepositoryWriteError,
  REPOSITORY_WRITE_ERROR_CODES,
} from "../../../src/security/types";
import {
  MCP_DIRECTORY_DENIED,
  MCP_INVALID_PATH_INPUT,
  MCPRepositoryScopeError,
  MCP_SCOPE_ERROR_CODES,
} from "../../../src/mcp/repository-scope";
import { MCPUnsafeConfigurationError } from "../../../src/mcp/scoped-config";

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

  it("formats only authentic fixed MCP repository scope errors", () => {
    for (const [code, message] of [
      [MCP_INVALID_PATH_INPUT, "The MCP path input is invalid."],
      [
        MCP_DIRECTORY_DENIED,
        "The requested directory is outside the MCP repository scope.",
      ],
    ] as const) {
      const authentic = new MCPRepositoryScopeError(code);
      const formatted = formatMCPError(authentic);
      expect(formatted).toBe(`${code}: ${message}`);
      expect(formatted.match(new RegExp(code, "gu"))).toHaveLength(1);
    }

    expect(
      formatMCPError({
        code: "MCP_INVALID_PATH_INPUT",
        message: "/private/hostile/path fake-key",
      }),
    ).toBe("Unknown MCP error.");

    const authentic = new MCPRepositoryScopeError(MCP_INVALID_PATH_INPUT);
    authentic.message = "/private/hostile/path fake-key";
    expect(formatMCPError(authentic)).toBe("Unknown MCP error.");

    for (const invalidCode of ["UNAPPROVED_CODE", "__proto__"]) {
      expect(() => new MCPRepositoryScopeError(invalidCode as never)).toThrow(
        "Invalid MCP repository scope error configuration.",
      );
    }

    const getter = jest.fn(() => "/private/hostile/path fake-key");
    const accessor = new MCPRepositoryScopeError(MCP_DIRECTORY_DENIED);
    Object.defineProperty(accessor, "message", {
      configurable: true,
      get: getter,
    });
    expect(formatMCPError(accessor)).toBe("Unknown MCP error.");
    expect(getter).not.toHaveBeenCalled();

    const proxyGet = jest.fn(() => {
      throw new Error("hostile getter");
    });
    const proxy = new Proxy(
      { code: MCP_DIRECTORY_DENIED, message: "/private/hostile/path" },
      { get: proxyGet },
    );
    expect(formatMCPError(proxy)).toBe("Unknown MCP error.");
    expect(proxyGet).not.toHaveBeenCalled();

    const inheritedGetter = jest.fn(() => MCP_INVALID_PATH_INPUT);
    const inherited = Object.create(null, {
      code: {
        configurable: true,
        get: inheritedGetter,
      },
    });
    expect(formatMCPError(Object.create(inherited))).toBe("Unknown MCP error.");
    expect(inheritedGetter).not.toHaveBeenCalled();

    expect(MCP_SCOPE_ERROR_CODES).toEqual([
      MCP_INVALID_PATH_INPUT,
      MCP_DIRECTORY_DENIED,
    ]);
  });

  it("formats only authentic fixed MCP configuration errors", () => {
    const authentic = new MCPUnsafeConfigurationError();
    expect(formatMCPError(authentic)).toBe(
      "MCP_UNSAFE_CONFIGURATION: The MCP project configuration cannot be loaded safely.",
    );
    expect(
      formatMCPError({
        code: "MCP_UNSAFE_CONFIGURATION",
        message: "/private/hostile/path fake-credential",
      }),
    ).toBe("Unknown MCP error.");

    const messageGetter = jest.fn(
      () => "/private/hostile/path fake-credential",
    );
    Object.defineProperty(authentic, "message", {
      configurable: true,
      get: messageGetter,
    });
    expect(formatMCPError(authentic)).toBe("Unknown MCP error.");
    expect(messageGetter).not.toHaveBeenCalled();

    const proxyGet = jest.fn(() => {
      throw new Error("hostile getter");
    });
    const proxy = new Proxy(
      {
        code: "MCP_UNSAFE_CONFIGURATION",
        message: "/private/hostile/path fake-credential",
      },
      { get: proxyGet },
    );
    expect(formatMCPError(proxy)).toBe("Unknown MCP error.");
    expect(proxyGet).not.toHaveBeenCalled();

    const inherited = Object.create({
      code: "MCP_UNSAFE_CONFIGURATION",
      message: "/private/hostile/path fake-credential",
    });
    expect(formatMCPError(inherited)).toBe("Unknown MCP error.");
    expect(formatMCPError({ code: "UNAPPROVED_CODE", message: "secret" })).toBe(
      "Unknown MCP error.",
    );
    expect(formatMCPError({ code: "__proto__", message: "secret" })).toBe(
      "Unknown MCP error.",
    );
    expect(
      formatMCPError(new MCPUnsafeConfigurationError()).match(
        /MCP_UNSAFE_CONFIGURATION/gu,
      ),
    ).toHaveLength(1);
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

  it("formats the new workflow errors with stable codes and safe candidates", () => {
    expect(formatMCPError(new MCPPreparationError())).toBe(
      `${MCP_INVALID_PREPARATION}: The MCP preparation is invalid.`,
    );
    expect(
      formatMCPError(new MCPTargetRequiredError(["README.md", "/tmp/x.md"])),
    ).toBe(
      `${MCP_TARGET_REQUIRED}: Select one existing Markdown target: README.md.`,
    );
  });

  it("advertises the two provider-free workflow tools", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "prepare_documentation_update",
        "validate_documentation_draft",
      ]),
    );
    for (const name of [
      "prepare_documentation_update",
      "validate_documentation_draft",
    ]) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      expect(tool?.inputSchema.properties).not.toHaveProperty("directory");
      expect(tool?.inputSchema.properties).not.toHaveProperty("output");
    }
  });
});
