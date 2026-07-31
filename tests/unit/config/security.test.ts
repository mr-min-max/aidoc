import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.mock("../../../src/providers/openai", () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => ({ name: "openai" })),
}));

import { loadConfig } from "../../../src/config/loader";
import { createProvider } from "../../../src/providers/registry";
import { OpenAIProvider } from "../../../src/providers/openai";

const mockOpenAIProvider = OpenAIProvider as unknown as jest.Mock;

function fakeCredential(label: string): string {
  return ["sk", label, "x".repeat(32)].join("-");
}

describe("Trust Gate configuration", () => {
  let root: string;
  let originalOpenAiKey: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-security-config-"));
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
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
});
