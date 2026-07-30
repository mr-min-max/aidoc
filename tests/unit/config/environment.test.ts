import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadConfig } from "../../../src/config/loader";

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
      AIDOC_OLLAMA_HOST: "http://ollama.internal:11434",
    });

    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("env-model");
    expect(config.ollamaHost).toBe("http://ollama.internal:11434");
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
});
