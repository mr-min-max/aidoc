import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { rememberProviderSelection } from "../../../src/config/persistence";
import type { ResolvedProviderSelection } from "../../../src/providers/selection";
import { RepositoryWriteError } from "../../../src/security/types";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";

function createRepository(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "aidoc-provider-persistence-"),
  );
  execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
    cwd: root,
  });
  return root;
}

function selection(
  overrides: Partial<ResolvedProviderSelection> = {},
): ResolvedProviderSelection {
  return {
    provider: "openai",
    model: "gpt-5.6-luna",
    source: "command",
    boundary: "remote",
    credentialEnv: "OPENAI_API_KEY",
    ...overrides,
  };
}

describe("rememberProviderSelection", () => {
  const roots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true });
  });

  it("atomically creates a non-secret project selection with a trailing newline", async () => {
    const root = createRepository();
    roots.push(root);

    await rememberProviderSelection(root, selection());

    const text = fs.readFileSync(path.join(root, ".aidocrc.json"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
    });
    expect(text).not.toContain("OPENAI_API_KEY");
    expect(text).not.toContain("credential");
  });

  it("preserves unrelated valid JSON properties and writes Qwen profile fields", async () => {
    const root = createRepository();
    roots.push(root);
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ language: "uk", include: ["src/**/*.ts"] }, null, 2),
    );

    await rememberProviderSelection(
      root,
      selection({ provider: "qwen", model: "qwen3.6-flash" }),
      { region: "singapore", workspaceId: "workspace-123" },
    );

    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".aidocrc.json"), "utf8")),
    ).toEqual({
      language: "uk",
      include: ["src/**/*.ts"],
      provider: "qwen",
      model: "qwen3.6-flash",
      qwenRegion: "singapore",
      qwenWorkspaceId: "workspace-123",
    });
  });

  it.each([
    ["an empty file", ""],
    ["malformed JSON", "{not-json"],
    [
      "a legacy plaintext apiKey",
      JSON.stringify({ provider: "openai", apiKey: "do-not-write" }),
    ],
  ])("refuses to rewrite %s", async (_label, contents) => {
    const root = createRepository();
    roots.push(root);
    const configPath = path.join(root, ".aidocrc.json");
    fs.writeFileSync(configPath, contents);

    await expect(
      rememberProviderSelection(root, selection({ provider: "anthropic" })),
    ).rejects.toThrow();
    expect(fs.readFileSync(configPath, "utf8")).toBe(contents);
  });

  it("does not serialize endpoint authorization or credential environment metadata", async () => {
    const root = createRepository();
    roots.push(root);
    await rememberProviderSelection(
      root,
      selection({
        provider: "openai-compatible",
        model: "custom-model",
        credentialEnv: "AIDOC_COMPAT_API_KEY",
        endpoint: {
          url: new URL("https://gateway.example.com/v1"),
          origin: "https://gateway.example.com",
          local: false,
          addresses: [{ address: "93.184.216.34", family: 4 }],
        },
      }),
    );

    const text = fs.readFileSync(path.join(root, ".aidocrc.json"), "utf8");
    expect(text).toContain("providerBaseUrl");
    expect(text).toContain("https://gateway.example.com/v1");
    expect(text).not.toContain("AIDOC_COMPAT_API_KEY");
    expect(text).not.toContain("93.184.216.34");
  });

  it("refuses an endpoint object that contains URL authorization", async () => {
    const root = createRepository();
    roots.push(root);

    await expect(
      rememberProviderSelection(root, {
        ...selection({ provider: "openai-compatible" }),
        endpoint: {
          url: new URL("https://user:password@gateway.example.com/v1"),
          origin: "https://gateway.example.com",
          local: false,
          addresses: [],
        },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_ENDPOINT" });
    expect(fs.existsSync(path.join(root, ".aidocrc.json"))).toBe(false);
  });

  it("does not persist Qwen fields for a non-Qwen selection", async () => {
    const root = createRepository();
    roots.push(root);

    await rememberProviderSelection(root, selection(), {
      region: "singapore",
      workspaceId: "workspace-123",
    });

    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".aidocrc.json"), "utf8")),
    ).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
    });
  });

  it("persists Qwen metadata from the accepted selection by default", async () => {
    const root = createRepository();
    roots.push(root);

    await rememberProviderSelection(
      root,
      selection({
        provider: "qwen",
        model: "qwen3.6-flash",
        qwen: { region: "singapore", workspaceId: "workspace-123" },
      }),
    );

    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".aidocrc.json"), "utf8")),
    ).toEqual({
      provider: "qwen",
      model: "qwen3.6-flash",
      qwenRegion: "singapore",
      qwenWorkspaceId: "workspace-123",
    });
  });

  it("removes stale selection fields when changing provider origin", async () => {
    const root = createRepository();
    roots.push(root);
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({
        provider: "qwen",
        model: "old-model",
        providerBaseUrl: "https://old.example.com/v1",
        allowLocalHttp: true,
        qwenRegion: "singapore",
        qwenWorkspaceId: "old-workspace",
        language: "uk",
      }),
    );

    await rememberProviderSelection(root, selection({ provider: "openai" }));

    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".aidocrc.json"), "utf8")),
    ).toEqual({
      provider: "openai",
      model: "gpt-5.6-luna",
      language: "uk",
    });
  });

  it("propagates a repository snapshot race without replacing the config", async () => {
    const root = createRepository();
    roots.push(root);
    const replacement = jest
      .fn()
      .mockRejectedValue(new RepositoryWriteError("TRUST_RACE_DETECTED"));
    jest.spyOn(RepositoryWriteScope, "open").mockResolvedValue({
      prepare: jest.fn().mockResolvedValue({
        existingText: null,
        replaceText: replacement,
      }),
    } as never);

    await expect(
      rememberProviderSelection(root, selection()),
    ).rejects.toMatchObject({ code: "TRUST_RACE_DETECTED" });
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});
