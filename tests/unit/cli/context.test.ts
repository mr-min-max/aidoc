import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";
import {
  enforceGeneratedOutput,
  loadCommandContext,
  prepareDocumentTarget,
  writeDoc,
} from "../../../src/cli/context";
import { RepositoryWriteScope } from "../../../src/security/repository-writer";
import * as diffDisplay from "../../../src/output/diff-display";
import * as providerSelection from "../../../src/providers/selection";
import * as providerRegistry from "../../../src/providers/registry";
import type { ResolvedProviderSelection } from "../../../src/providers/selection";

describe("loadCommandContext", () => {
  it("returns a mock generator when mock is set", async () => {
    const ctx = await loadCommandContext({ mock: true });
    expect(ctx.isMock).toBe(true);
    expect(ctx.generator.constructor.name).toBe("MockGenerator");
  });

  it("loads configuration from the project directory being analyzed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({ model: "project-model" }),
      );
      const ctx = await loadCommandContext({ mock: true }, root);
      expect(ctx.config.model).toBe("project-model");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves selection and runs the pre-create gate before constructing a real provider", async () => {
    const selection: ResolvedProviderSelection = {
      provider: "openai",
      model: "gpt-5.6-luna",
      source: "command",
      boundary: "remote",
      credentialEnv: "OPENAI_API_KEY",
    };
    const events: string[] = [];
    const resolveSelection = jest
      .spyOn(providerSelection, "resolveProviderSelection")
      .mockImplementation(async () => {
        events.push("select");
        return selection;
      });
    const createProvider = jest
      .spyOn(providerRegistry, "createProvider")
      .mockImplementation(() => {
        events.push("create");
        return { name: "openai", generate: jest.fn() };
      });

    const ctx = await loadCommandContext(
      {
        provider: "openai",
        model: "command-model",
      },
      process.cwd(),
      {
        beforeProviderCreate: async (resolved) => {
          events.push(`gate:${resolved.provider}`);
        },
      },
    );

    expect(events).toEqual(["select", "gate:openai", "create"]);
    expect(resolveSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: {
          provider: "openai",
          model: "command-model",
          providerBaseUrl: undefined,
          allowLocalHttp: undefined,
        },
      }),
    );
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5.6-luna",
      }),
    );
    expect(createProvider.mock.calls[0][0]).not.toHaveProperty("credentialEnv");
    expect(createProvider.mock.calls[0][0]).not.toHaveProperty("source");
    expect(createProvider.mock.calls[0][0]).not.toHaveProperty("boundary");
    expect(createProvider.mock.calls[0][0]).not.toHaveProperty("apiKey");
    expect(ctx.selection).toEqual(selection);
    expect(ctx.isMock).toBe(false);
  });

  it("passes an approved command loopback endpoint and effective local permission to the factory", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-context-endpoint-"),
    );
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({
          provider: "openai-compatible",
          model: "project-model",
          providerBaseUrl: "https://old.example.com/v1",
          allowLocalHttp: false,
        }),
      );
      const selection: ResolvedProviderSelection = {
        provider: "openai-compatible",
        model: "command-model",
        source: "command",
        boundary: "remote",
        credentialEnv: "AIDOC_COMPAT_API_KEY",
        endpoint: {
          url: new URL("http://127.0.0.1:8080/v1"),
          origin: "http://127.0.0.1:8080",
          local: true,
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
      };
      jest
        .spyOn(providerSelection, "resolveProviderSelection")
        .mockResolvedValue(selection);
      const createProvider = jest.spyOn(providerRegistry, "createProvider");
      createProvider.mockClear();
      createProvider.mockReturnValue({
        name: "openai-compatible",
        generate: jest.fn(),
      });

      await loadCommandContext(
        {
          provider: "openai-compatible",
          model: "command-model",
          providerBaseUrl: "http://127.0.0.1:8080/v1",
          allowLocalHttp: true,
        },
        root,
      );

      expect(createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai-compatible",
          model: "command-model",
          providerBaseUrl: "http://127.0.0.1:8080/v1",
          allowLocalHttp: true,
          endpoint: selection.endpoint,
        }),
      );
      expect(createProvider.mock.calls[0][0]).not.toHaveProperty(
        "credentialEnv",
      );
      expect(createProvider.mock.calls[0][0]).not.toHaveProperty("source");
      expect(createProvider.mock.calls[0][0]).not.toHaveProperty("boundary");
      expect(createProvider.mock.calls[0][0]).not.toHaveProperty("apiKey");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes an approved remote override endpoint instead of a stale project URL", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-context-remote-endpoint-"),
    );
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({
          provider: "openai-compatible",
          model: "project-model",
          providerBaseUrl: "https://old.example.com/v1",
        }),
      );
      const selection: ResolvedProviderSelection = {
        provider: "openai-compatible",
        model: "command-model",
        source: "command",
        boundary: "remote",
        endpoint: {
          url: new URL("https://new.example.com/v1"),
          origin: "https://new.example.com",
          local: false,
          addresses: [{ address: "93.184.216.34", family: 4 }],
        },
      };
      jest
        .spyOn(providerSelection, "resolveProviderSelection")
        .mockResolvedValue(selection);
      const createProvider = jest.spyOn(providerRegistry, "createProvider");
      createProvider.mockClear();
      createProvider.mockReturnValue({
        name: "openai-compatible",
        generate: jest.fn(),
      });

      await loadCommandContext(
        {
          provider: "openai-compatible",
          model: "command-model",
          providerBaseUrl: "https://new.example.com/v1",
        },
        root,
      );

      expect(createProvider.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          providerBaseUrl: "https://new.example.com/v1",
          allowLocalHttp: false,
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes a same-recorded legacy key only to provider construction", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-context-legacy-same-provider-"),
    );
    const legacyKey = "legacy-openai-secret";
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({ provider: "openai", apiKey: legacyKey }),
      );
      const selection: ResolvedProviderSelection = {
        provider: "openai",
        model: "gpt-5.6-luna",
        source: "project",
        boundary: "remote",
        credentialEnv: "OPENAI_API_KEY",
      };
      jest
        .spyOn(providerSelection, "resolveProviderSelection")
        .mockResolvedValue(selection);
      const createProvider = jest.spyOn(providerRegistry, "createProvider");
      createProvider.mockClear();
      createProvider.mockReturnValue({
        name: "openai",
        generate: jest.fn(),
      });

      const ctx = await loadCommandContext({}, root);

      expect(createProvider.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          provider: "openai",
          model: "gpt-5.6-luna",
          apiKey: legacyKey,
        }),
      );
      expect(JSON.stringify(ctx.selection)).not.toContain(legacyKey);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sanitizes and isolates the pre-create gate from accepted factory inputs", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-context-gate-snapshot-"),
    );
    const legacyKey = "legacy-openai-secret";
    const staleProjectUrl = "https://old.example.com/v1";
    const acceptedUrl = "http://127.0.0.1:8080/v1";
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({
          provider: "openai",
          apiKey: legacyKey,
          providerBaseUrl: staleProjectUrl,
          allowLocalHttp: false,
        }),
      );
      const selection: ResolvedProviderSelection = {
        provider: "openai-compatible",
        model: "command-model",
        source: "command",
        boundary: "remote",
        credentialEnv: "AIDOC_COMPAT_API_KEY",
        endpoint: {
          url: new URL(acceptedUrl),
          origin: "http://127.0.0.1:8080",
          local: true,
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
      };
      jest
        .spyOn(providerSelection, "resolveProviderSelection")
        .mockResolvedValue(selection);
      const createProvider = jest.spyOn(providerRegistry, "createProvider");
      createProvider.mockClear();
      createProvider.mockReturnValue({
        name: "openai-compatible",
        generate: jest.fn(),
      });

      let gateSnapshot = "";
      await loadCommandContext(
        {
          provider: "openai-compatible",
          model: "command-model",
          providerBaseUrl: acceptedUrl,
          allowLocalHttp: true,
        },
        root,
        {
          beforeProviderCreate: async (observed, gateConfig) => {
            gateSnapshot = JSON.stringify({
              selection: observed,
              config: gateConfig,
            });
            const mutableSelection = observed as any;
            mutableSelection.provider = "anthropic";
            mutableSelection.model = "gate-model";
            mutableSelection.endpoint.url.href = "https://evil.example/v1";
            mutableSelection.endpoint.origin = "https://evil.example";
            mutableSelection.endpoint.local = false;
            mutableSelection.endpoint.addresses[0].address = "10.0.0.1";
            const mutableConfig = gateConfig as any;
            mutableConfig.provider = "anthropic";
            mutableConfig.allowLocalHttp = false;
            mutableConfig.providerBaseUrl = staleProjectUrl;
          },
        },
      );

      const factoryInput = createProvider.mock.calls[0][0];
      expect(gateSnapshot).not.toContain(legacyKey);
      expect(gateSnapshot).not.toContain(staleProjectUrl);
      expect(JSON.parse(gateSnapshot).config).not.toHaveProperty("apiKey");
      expect(JSON.parse(gateSnapshot).config).not.toHaveProperty(
        "providerBaseUrl",
      );
      expect(factoryInput).toMatchObject({
        provider: "openai-compatible",
        model: "command-model",
        providerBaseUrl: acceptedUrl,
        allowLocalHttp: true,
      });
      expect(factoryInput).not.toHaveProperty("apiKey");
      expect(factoryInput.endpoint).toMatchObject({
        origin: "http://127.0.0.1:8080",
        local: true,
        addresses: [{ address: "127.0.0.1", family: 4 }],
      });
      expect(factoryInput.endpoint.url.href).toBe(acceptedUrl);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires both stdin and stdout TTYs before entering interactive selection", async () => {
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: false,
      });
      const resolveSelection = jest
        .spyOn(providerSelection, "resolveProviderSelection")
        .mockResolvedValue(null);

      await expect(loadCommandContext({}, process.cwd())).rejects.toMatchObject(
        {
          code: "PROVIDER_SELECTION_CANCELLED",
        },
      );
      expect(resolveSelection.mock.calls[0][0].interactive).toBe(false);
    } finally {
      if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
      if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
    }
  });

  it("translates interactive cancellation without constructing a provider", async () => {
    const resolveSelection = jest
      .spyOn(providerSelection, "resolveProviderSelection")
      .mockResolvedValue(null);
    const createProvider = jest.spyOn(providerRegistry, "createProvider");
    resolveSelection.mockClear();
    createProvider.mockClear();

    await expect(loadCommandContext({}, process.cwd())).rejects.toMatchObject({
      code: "PROVIDER_SELECTION_CANCELLED",
    });
    expect(resolveSelection).toHaveBeenCalledTimes(1);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("does not construct a provider when the pre-create gate rejects", async () => {
    const selection: ResolvedProviderSelection = {
      provider: "openai",
      model: "gpt-5.6-luna",
      source: "command",
      boundary: "remote",
      credentialEnv: "OPENAI_API_KEY",
    };
    jest
      .spyOn(providerSelection, "resolveProviderSelection")
      .mockResolvedValue(selection);
    const createProvider = jest.spyOn(providerRegistry, "createProvider");
    createProvider.mockClear();
    const gateError = new Error("boundary declined");

    await expect(
      loadCommandContext({}, process.cwd(), {
        beforeProviderCreate: async () => {
          throw gateError;
        },
      }),
    ).rejects.toBe(gateError);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("does not pass a legacy key across a command provider change", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "aidoc-context-legacy-"),
    );
    try {
      fs.writeFileSync(
        path.join(root, ".aidocrc.json"),
        JSON.stringify({ provider: "openai", apiKey: "legacy-openai-secret" }),
      );
      const selection: ResolvedProviderSelection = {
        provider: "anthropic",
        model: "claude-sonnet-5",
        source: "command",
        boundary: "remote",
        credentialEnv: "ANTHROPIC_API_KEY",
      };
      jest
        .spyOn(providerSelection, "resolveProviderSelection")
        .mockResolvedValue(selection);
      const createProvider = jest.spyOn(providerRegistry, "createProvider");
      createProvider.mockClear();
      createProvider.mockReturnValue({
        name: "anthropic",
        generate: jest.fn(),
      });

      await loadCommandContext({ provider: "anthropic" }, root);

      expect(createProvider).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "anthropic" }),
      );
      expect(createProvider.mock.calls[0][0]).not.toHaveProperty("apiKey");
      expect(JSON.stringify(createProvider.mock.calls[0][0])).not.toContain(
        "legacy-openai-secret",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps mock mode free of selection and provider construction", async () => {
    const resolveSelection = jest.spyOn(
      providerSelection,
      "resolveProviderSelection",
    );
    const createProvider = jest.spyOn(providerRegistry, "createProvider");
    resolveSelection.mockClear();
    createProvider.mockClear();

    const ctx = await loadCommandContext({ mock: true });

    expect(ctx.selection).toBeUndefined();
    expect(resolveSelection).not.toHaveBeenCalled();
    expect(createProvider).not.toHaveBeenCalled();
  });
});

describe("writeDoc", () => {
  it("uses the prepared snapshot for a diff before replacing the document once", async () => {
    // Catches a write adapter regression that re-reads a live output path or
    // bypasses PreparedRepositoryTarget.replaceText().
    const replaceText = jest.fn().mockResolvedValue(undefined);
    const displayDiff = jest
      .spyOn(diffDisplay, "displayDiff")
      .mockImplementation(() => undefined);

    try {
      await writeDoc(
        {
          displayPath: "README.md",
          existingText: "# Before\n",
          prepared: {
            displayPath: "README.md",
            existingText: "# Before\n",
            replaceText,
          },
        },
        "# After\n",
        { auto: true },
      );

      expect(displayDiff).toHaveBeenCalledWith(
        "README.md",
        "# Before\n",
        "# After\n",
      );
      expect(replaceText).toHaveBeenCalledTimes(1);
      expect(replaceText).toHaveBeenCalledWith("# After\n");
    } finally {
      displayDiff.mockRestore();
    }
  });

  it("rejects invalid Markdown before replacing a prepared document in strict-output mode", async () => {
    // Catches a strict-output regression that invokes the atomic writer before validation.
    const replaceText = jest.fn().mockResolvedValue(undefined);
    await expect(
      writeDoc(
        {
          displayPath: "README.md",
          existingText: null,
          prepared: {
            displayPath: "README.md",
            existingText: null,
            replaceText,
          },
        },
        "not a Markdown document",
        { strict: true },
      ),
    ).rejects.toThrow(/failed validation/i);
    expect(replaceText).not.toHaveBeenCalled();
  });
});

describe("prepareDocumentTarget", () => {
  const roots: string[] = [];

  function createRepository(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    execFileSync("git", ["init", "-q", "--initial-branch", "main"], {
      cwd: root,
    });
    roots.push(root);
    return root;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("opens the repository writer and snapshots the requested real target", async () => {
    // Catches a regression that resolves a raw output path or reads it outside
    // RepositoryWriteScope before it has been trusted.
    const root = createRepository();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "README.md"), "# Before\n");
    const scope = await RepositoryWriteScope.open(root);
    const prepare = jest.spyOn(scope, "prepare");
    const open = jest
      .spyOn(RepositoryWriteScope, "open")
      .mockResolvedValue(scope);

    const target = await prepareDocumentTarget(root, "docs/README.md", false);

    expect(open).toHaveBeenCalledWith(root);
    expect(prepare).toHaveBeenCalledWith("docs/README.md");
    expect(target).toMatchObject({
      displayPath: path.join("docs", "README.md"),
      existingText: "# Before\n",
    });
    expect(target.prepared).toBeDefined();
  });

  it("reads a dry-run preview without opening the repository writer", async () => {
    // Catches a dry-run regression that creates a writer scope, directories, or temp files.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "preview.md"), "# Preview\n");
    const open = jest.spyOn(RepositoryWriteScope, "open");

    const target = await prepareDocumentTarget(root, "preview.md", true);

    expect(open).not.toHaveBeenCalled();
    expect(target).toEqual({
      displayPath: "preview.md",
      existingText: "# Preview\n",
    });
    expect(fs.readdirSync(root)).toEqual(["preview.md"]);
  });

  it("rejects a control-bearing dry-run target without opening a writer", async () => {
    // Catches a terminal-output injection regression that preserves raw target
    // text as a dry-run display label before lexical validation.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    roots.push(root);
    const open = jest.spyOn(RepositoryWriteScope, "open");

    await expect(
      prepareDocumentTarget(
        root,
        `preview/${String.fromCharCode(27)}[2J.md`,
        true,
      ),
    ).rejects.toMatchObject({ code: "TRUST_INVALID_PATH" });

    expect(open).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("uses a basename label for a valid external dry-run preview", async () => {
    // Catches a display-path regression that leaks an absolute external target
    // into diffs, confirmation prompts, or status messages.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-context-"));
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-external-"));
    roots.push(root, external);
    const externalTarget = path.join(external, "private-preview.md");
    fs.writeFileSync(externalTarget, "# Preview\n");
    const open = jest.spyOn(RepositoryWriteScope, "open");

    const target = await prepareDocumentTarget(root, externalTarget, true);

    expect(target).toEqual({
      displayPath: "private-preview.md",
      existingText: "# Preview\n",
    });
    expect(open).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe("enforceGeneratedOutput", () => {
  it("turns command-specific validation warnings into a strict failure", () => {
    expect(() =>
      enforceGeneratedOutput(
        { isValid: false, warnings: ["Generated provider output is blank"] },
        { strictOutput: true },
        "README",
      ),
    ).toThrow("README failed validation: Generated provider output is blank");
  });
});
