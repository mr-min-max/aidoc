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
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-config-"));
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "openai", model: "file-model" }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("applies validated Action environment values over file config", () => {
    const config = loadConfig(root, {
      AIDOC_PROVIDER: "anthropic",
      AIDOC_MODEL: "env-model",
      AIDOC_PROVIDER_BASE_URL: "https://gateway.example.test/v1",
      AIDOC_ALLOW_LOCAL_HTTP: "true",
      AIDOC_QWEN_REGION: "singapore",
      AIDOC_QWEN_WORKSPACE_ID: "workspace-123",
      AIDOC_OLLAMA_HOST: "http://ollama.internal:11434",
      AIDOC_TRUST_POLICY: "strict",
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
      loadConfig(root, { AIDOC_PROVIDER: "not-a-provider" }),
    ).toThrow(/Unknown provider/);
  });

  it("leaves the model unset so each provider can apply its own default", () => {
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: "anthropic" }),
    );
    const config = loadConfig(root, {});
    expect(config.model).toBeUndefined();
  });

  it("does not treat an invalid local-http environment value as permission", () => {
    const config = loadConfig(root, {
      AIDOC_ALLOW_LOCAL_HTTP: "yes",
    });

    expect(config.allowLocalHttp).toBe(false);
  });

  it("projects only own data environment values", () => {
    const getter = jest.fn(() => "should-not-run");
    const env = Object.create({ AIDOC_PROVIDER: "inherited" }) as Record<
      string,
      string
    >;
    Object.defineProperty(env, "AIDOC_MODEL", { get: getter });
    env.AIDOC_ALLOW_LOCAL_HTTP = "false";
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
        { AIDOC_PROVIDER: "anthropic" },
      ).apiKey,
    ).toBeUndefined();
  });
});
