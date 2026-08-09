import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.mock("../../../src/providers/openai", () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({ name: "openai" })),
}));

jest.mock("../../../src/providers/anthropic", () => ({
  AnthropicProvider: jest
    .fn()
    .mockImplementation(() => ({ name: "anthropic" })),
}));

import { loadConfig } from "../../../src/config/loader";
import { createProvider } from "../../../src/providers/registry";
import { OpenAIProvider } from "../../../src/providers/openai";
import { AnthropicProvider } from "../../../src/providers/anthropic";

const mockOpenAIProvider = OpenAIProvider as unknown as jest.Mock;
const mockAnthropicProvider = AnthropicProvider as unknown as jest.Mock;

function fakeCredential(label: string): string {
  return ["sk", label, "x".repeat(32)].join("-");
}

describe("Trust Gate configuration", () => {
  let root: string;
  let originalOpenAiKey: string | undefined;
  let originalAnthropicKey: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-security-config-"));
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("defaults the Trust Gate to redact", () => {
    expect(loadConfig(root, {} as NodeJS.ProcessEnv).trustPolicy).toBe(
      "redact",
    );
  });

  it("accepts strict from AIDOC_TRUST_POLICY", () => {
    expect(
      loadConfig(root, { AIDOC_TRUST_POLICY: "strict" } as NodeJS.ProcessEnv)
        .trustPolicy,
    ).toBe("strict");
  });

  it("rejects an unknown environment policy", () => {
    expect(() =>
      loadConfig(root, {
        AIDOC_TRUST_POLICY: "unsafe",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("warns once without exposing a config credential and uses the provider environment credential", () => {
    const fileKey = fakeCredential("config");
    const environmentKey = fakeCredential("environment");
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "openai", apiKey: fileKey }),
    );
    process.env.OPENAI_API_KEY = environmentKey;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const config = loadConfig(root, {} as NodeJS.ProcessEnv);
    const provider = createProvider(config);
    const warningOutput = warn.mock.calls
      .map((args) => args.join(" "))
      .join("\n");

    expect(provider.name).toBe("openai");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Deprecated Aidoc config field "apiKey" detected; use the provider-specific environment variable instead.',
    );
    expect(warningOutput).not.toContain(fileKey);
    expect(warningOutput).not.toContain(environmentKey);
    expect(mockOpenAIProvider).toHaveBeenLastCalledWith(
      environmentKey,
      undefined,
    );
  });

  it("drops a legacy OpenAI key when an environment override selects Anthropic", () => {
    const fileKey = fakeCredential("file-openai");
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "openai", apiKey: fileKey }),
    );

    const config = loadConfig(root, {
      AIDOC_PROVIDER: "anthropic",
    } as NodeJS.ProcessEnv);

    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBeUndefined();
    expect(() => createProvider(config)).toThrow(
      /Anthropic API key is required/,
    );
    expect(mockAnthropicProvider).not.toHaveBeenCalled();
  });

  it("drops a legacy Anthropic key when an environment override selects OpenAI", () => {
    const fileKey = fakeCredential("file-anthropic");
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "anthropic", apiKey: fileKey }),
    );

    const config = loadConfig(root, {
      AIDOC_PROVIDER: "openai",
    } as NodeJS.ProcessEnv);

    expect(config.provider).toBe("openai");
    expect(config.apiKey).toBeUndefined();
    expect(() => createProvider(config)).toThrow(/OpenAI API key is required/);
    expect(mockOpenAIProvider).not.toHaveBeenCalled();
  });

  it("preserves a legacy key when the environment keeps the file provider", () => {
    const fileKey = fakeCredential("same-provider");
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "openai", apiKey: fileKey }),
    );

    const config = loadConfig(root, {
      AIDOC_PROVIDER: "openai",
    } as NodeJS.ProcessEnv);

    createProvider(config);

    expect(config.apiKey).toBe(fileKey);
    expect(mockOpenAIProvider).toHaveBeenLastCalledWith(fileKey, undefined);
  });

  it("keeps provider-specific environment credentials ahead of a same-provider legacy key", () => {
    const fileKey = fakeCredential("same-provider-file");
    const environmentKey = fakeCredential("same-provider-environment");
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "anthropic", apiKey: fileKey }),
    );
    process.env.ANTHROPIC_API_KEY = environmentKey;

    const config = loadConfig(root, {
      AIDOC_PROVIDER: "anthropic",
    } as NodeJS.ProcessEnv);

    createProvider(config);

    expect(mockAnthropicProvider).toHaveBeenLastCalledWith(
      environmentKey,
      undefined,
    );
  });
});
