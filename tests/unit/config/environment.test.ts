import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  environmentConfig,
  loadConfig,
  parseConfigValues,
} from "../../../src/config/loader";

describe("loadConfig environment overrides", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "staledocs-config-"));
    fs.writeFileSync(
      path.join(root, ".staledocsrc.json"),
      JSON.stringify({ provider: "openai", model: "file-model" }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("applies validated Action environment values over file config", () => {
    const config = loadConfig(root, {
      STALEDOCS_PROVIDER: "anthropic",
      STALEDOCS_MODEL: "env-model",
      STALEDOCS_PROVIDER_BASE_URL: "https://gateway.example.test/v1",
      STALEDOCS_ALLOW_LOCAL_HTTP: "true",
      STALEDOCS_QWEN_REGION: "singapore",
      STALEDOCS_QWEN_WORKSPACE_ID: "workspace-123",
      STALEDOCS_OLLAMA_HOST: "http://ollama.internal:11434",
      STALEDOCS_TRUST_POLICY: "strict",
    });

    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("env-model");
    expect(config.providerBaseUrl).toBe("https://gateway.example.test/v1");
    expect(config.allowLocalHttp).toBe(true);
    expect(config.qwenRegion).toBe("singapore");
    expect(config.qwenWorkspaceId).toBe("workspace-123");
    expect(config.ollamaHost).toBe("http://ollama.internal:11434");
    expect(config.trustPolicy).toBe("strict");
  });

  it("rejects an invalid provider instead of silently using OpenAI", () => {
    expect(() =>
      loadConfig(root, { STALEDOCS_PROVIDER: "not-a-provider" }),
    ).toThrow(/Unknown provider/);
  });

  it("leaves the model unset so each provider can apply its own default", () => {
    fs.writeFileSync(
      path.join(root, ".staledocsrc.json"),
      JSON.stringify({ provider: "anthropic" }),
    );
    const config = loadConfig(root, {});
    expect(config.model).toBeUndefined();
  });

  it("does not treat an invalid local-http environment value as permission", () => {
    const config = loadConfig(root, {
      STALEDOCS_ALLOW_LOCAL_HTTP: "yes",
    });

    expect(config.allowLocalHttp).toBe(false);
  });

  it("projects only own data environment values", () => {
    const getter = jest.fn(() => "should-not-run");
    const env = Object.create({ STALEDOCS_PROVIDER: "inherited" }) as Record<
      string,
      string
    >;
    Object.defineProperty(env, "STALEDOCS_MODEL", { get: getter });
    env.STALEDOCS_ALLOW_LOCAL_HTTP = "false";
    env.UNKNOWN = "ignored";

    expect(environmentConfig(env)).toEqual({ allowLocalHttp: false });
    expect(getter).not.toHaveBeenCalled();
  });

  it("keeps legacy apiKey compatibility scoped to the recorded provider", () => {
    expect(
      parseConfigValues(
        { provider: "openai", apiKey: "file-key" },
        Object.create(null),
      ).apiKey,
    ).toBe("file-key");
    expect(
      parseConfigValues(
        { provider: "openai", apiKey: "file-key" },
        { STALEDOCS_PROVIDER: "anthropic" },
      ).apiKey,
    ).toBeUndefined();
  });
});
