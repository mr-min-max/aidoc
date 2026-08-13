import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MCPScopedConfigLoader,
  MCPUnsafeConfigurationError,
} from "../../../src/mcp/scoped-config";
import {
  MCPRepositoryReadScope,
  MCPRepositoryScopeError,
} from "../../../src/mcp/repository-scope";
import { formatMCPError } from "../../../src/mcp/server";
import { loadPlanningConfig } from "../../../src/config/planning";
import {
  defaultPlanningConfig,
  parsePlanningConfig,
} from "../../../src/config/planning";
import {
  environmentConfig,
  parseConfigValues,
} from "../../../src/config/loader";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(root: string, message: string): void {
  git(root, "add", "--", ".");
  git(
    root,
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "user.name=MCP Test",
    "commit",
    "-qm",
    message,
  );
}

function fixture(): { root: string; selected: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), "aidoc-mcp-config-"));
  const outside = mkdtempSync(join(tmpdir(), "aidoc-mcp-config-outside-"));
  const selected = join(root, "packages", "api");
  mkdirSync(join(selected, "src"), { recursive: true });
  writeFileSync(
    join(selected, "src", "index.ts"),
    "export const api = true;\n",
  );
  writeFileSync(join(root, "README.md"), "# project\n");
  writeFileSync(join(outside, "secret.ts"), "export const secret = true;\n");
  git(root, "init", "-q", "--initial-branch", "main");
  commit(root, "fixture: initial");
  git(outside, "init", "-q", "--initial-branch", "main");
  commit(outside, "fixture: external");
  return { root, selected, outside };
}

async function openFixture() {
  const value = fixture();
  const scope = await MCPRepositoryReadScope.open(value.root);
  const directory = await scope.authorizeDirectory(value.selected);
  return { ...value, scope, directory };
}

async function expectUnsafe(action: Promise<unknown>): Promise<void> {
  let error: unknown;
  try {
    await action;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(MCPUnsafeConfigurationError);
  expect(error).toMatchObject({
    code: "MCP_UNSAFE_CONFIGURATION",
    message: "The MCP project configuration cannot be loaded safely.",
  });
}

describe("MCP scoped configuration", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers declarative configuration in selected-to-root order", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    writeFileSync(
      join(value.root, ".aidocrc.json"),
      JSON.stringify({ model: "root-model", include: ["**/*.ts"] }),
    );
    writeFileSync(
      join(value.selected, ".aidocrc.yaml"),
      "model: selected-model\ninclude:\n  - '**/*.tsx'\n",
    );

    const loader = new MCPScopedConfigLoader(value.scope, Object.create(null));
    await expect(loader.loadPlanning(value.directory)).resolves.toMatchObject({
      include: ["**/*.tsx"],
    });
  });

  it("covers every declarative MCP configuration filename in precedence order", async () => {
    const candidates = [
      [
        "package.json",
        JSON.stringify({ aidoc: { model: "package" } }),
        "package",
      ],
      [".aidocrc", "model: no-extension\n", "no-extension"],
      [".aidocrc.json", JSON.stringify({ model: "json" }), "json"],
      [".aidocrc.yaml", "model: yaml\n", "yaml"],
      [".aidocrc.yml", "model: yml\n", "yml"],
      [
        ".config/aidocrc",
        "model: config-no-extension\n",
        "config-no-extension",
      ],
      [
        ".config/aidocrc.json",
        JSON.stringify({ model: "config-json" }),
        "config-json",
      ],
      [".config/aidocrc.yaml", "model: config-yaml\n", "config-yaml"],
      [".config/aidocrc.yml", "model: config-yml\n", "config-yml"],
    ] as const;

    for (const [relativePath, content, expectedModel] of candidates) {
      const value = await openFixture();
      roots.push(value.root, value.outside);
      const absolutePath = join(value.selected, relativePath);
      mkdirSync(join(absolutePath, ".."), { recursive: true });
      writeFileSync(absolutePath, content);
      const loader = new MCPScopedConfigLoader(
        value.scope,
        Object.create(null),
      );
      await expect(loader.loadProvider(value.directory)).resolves.toMatchObject(
        {
          config: { model: expectedModel },
        },
      );
    }
  });

  it("denies every executable MCP configuration filename without executing it", async () => {
    const candidates = [
      ".aidocrc.js",
      ".aidocrc.ts",
      ".aidocrc.cjs",
      ".aidocrc.mjs",
      ".config/aidocrc.js",
      ".config/aidocrc.ts",
      ".config/aidocrc.cjs",
      ".config/aidocrc.mjs",
      "aidoc.config.js",
      "aidoc.config.ts",
      "aidoc.config.cjs",
      "aidoc.config.mjs",
    ] as const;
    for (const relativePath of candidates) {
      const value = await openFixture();
      roots.push(value.root, value.outside);
      const absolutePath = join(value.selected, relativePath);
      mkdirSync(join(absolutePath, ".."), { recursive: true });
      const marker = join(
        value.root,
        `marker-${relativePath.replaceAll("/", "-")}`,
      );
      writeFileSync(
        absolutePath,
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"); module.exports = {};`,
      );
      const loader = new MCPScopedConfigLoader(
        value.scope,
        Object.create(null),
      );
      await expectUnsafe(loader.loadPlanning(value.directory));
      expect(() => readFileSync(marker)).toThrow();
    }
  });

  it("stops at the first actual artifact and never executes executable candidates", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    const marker = join(value.root, "marker.txt");
    writeFileSync(
      join(value.selected, ".aidocrc.json"),
      JSON.stringify({ model: "selected-model" }),
    );
    writeFileSync(
      join(value.selected, ".aidocrc.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"); module.exports = {};`,
    );
    writeFileSync(
      join(value.root, "aidoc.config.js"),
      "module.exports = {};\n",
    );

    const loader = new MCPScopedConfigLoader(value.scope, Object.create(null));
    await expect(loader.loadPlanning(value.directory)).resolves.toMatchObject({
      outputDir: "./docs",
    });
    expect(() => readFileSync(marker)).toThrow();
  });

  it("denies selected executable, malformed, legacy-secret, and symlink artifacts", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    const loader = new MCPScopedConfigLoader(value.scope, Object.create(null));

    writeFileSync(
      join(value.selected, ".aidocrc.js"),
      "module.exports = {};\n",
    );
    await expectUnsafe(loader.loadPlanning(value.directory));
    rmSync(join(value.selected, ".aidocrc.js"));

    writeFileSync(join(value.selected, ".aidocrc.json"), "{\n");
    await expectUnsafe(loader.loadPlanning(value.directory));
    rmSync(join(value.selected, ".aidocrc.json"));

    writeFileSync(
      join(value.selected, ".aidocrc.json"),
      JSON.stringify({ apiKey: "not-an-output" }),
    );
    await expectUnsafe(loader.loadPlanning(value.directory));
    rmSync(join(value.selected, ".aidocrc.json"));

    writeFileSync(
      join(value.root, "config.json"),
      JSON.stringify({ model: "x" }),
    );
    symlinkSync(
      join(value.root, "config.json"),
      join(value.selected, ".aidocrc.json"),
    );
    await expectUnsafe(loader.loadPlanning(value.directory));
    rmSync(join(value.selected, ".aidocrc.json"));

    writeFileSync(join(value.selected, "package.json"), "{\n");
    await expectUnsafe(loader.loadPlanning(value.directory));
  });

  it("does not search above the pinned root and reads only the root .env", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    const parentConfig = join(value.root, "..", ".aidocrc.json");
    try {
      writeFileSync(parentConfig, JSON.stringify({ model: "parent-secret" }));
      writeFileSync(
        join(value.root, ".env"),
        "AIDOC_PROVIDER=ollama\nAIDOC_MODEL=local\nUNKNOWN=ignored\n",
      );

      const before = JSON.stringify(process.env);
      const loader = new MCPScopedConfigLoader(
        value.scope,
        Object.create(null),
      );
      const result = await loader.loadProvider(value.directory);
      expect(result.config.provider).toBe("ollama");
      expect(result.config.model).toBe("local");
      expect(result.effectiveEnvironment).toEqual({
        AIDOC_PROVIDER: "ollama",
        AIDOC_MODEL: "local",
      });
      expect(Object.getPrototypeOf(result.effectiveEnvironment)).toBeNull();
      expect(Object.isFrozen(result.effectiveEnvironment)).toBe(true);
      expect(JSON.stringify(process.env)).toBe(before);
    } finally {
      rmSync(parentConfig, { force: true });
    }
  });

  it("does not observe a parent configuration and planning does not read root .env", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    const parentConfig = join(value.root, "..", ".aidocrc.json");
    try {
      writeFileSync(
        parentConfig,
        JSON.stringify({ outputDir: "parent-secret" }),
      );
      writeFileSync(
        join(value.root, ".env"),
        "AIDOC_PROVIDER=not-a-provider\n",
      );
      const loader = new MCPScopedConfigLoader(
        value.scope,
        Object.create(null),
      );
      await expect(loader.loadPlanning(value.directory)).resolves.toMatchObject(
        {
          outputDir: "./docs",
        },
      );
    } finally {
      rmSync(parentConfig, { force: true });
    }
  });

  it("applies host precedence and projects all supported environment settings", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    writeFileSync(
      join(value.root, ".env"),
      [
        "AIDOC_PROVIDER=ollama",
        "AIDOC_MODEL=file-model",
        "AIDOC_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1",
        "AIDOC_ALLOW_LOCAL_HTTP=true",
        "AIDOC_QWEN_REGION=singapore",
        "AIDOC_QWEN_WORKSPACE_ID=workspace",
        "AIDOC_OLLAMA_HOST=http://127.0.0.1:11434",
        "AIDOC_TRUST_POLICY=strict",
        "OPENAI_API_KEY=file-openai",
        "UNKNOWN=drop-me",
      ].join("\n"),
    );
    const host = Object.freeze({
      AIDOC_MODEL: "host-model",
      OPENAI_API_KEY: "host-openai",
    });
    const loader = new MCPScopedConfigLoader(value.scope, host);
    const result = await loader.loadProvider(value.directory);

    expect(result.config).toMatchObject({
      provider: "ollama",
      model: "host-model",
      providerBaseUrl: "http://127.0.0.1:11434/v1",
      allowLocalHttp: true,
      qwenRegion: "singapore",
      qwenWorkspaceId: "workspace",
      ollamaHost: "http://127.0.0.1:11434",
      trustPolicy: "strict",
    });
    expect(result.credentials).toEqual({
      OPENAI_API_KEY: "host-openai",
    });
    expect(Object.getPrototypeOf(result.credentials)).toBeNull();
    expect(Object.isFrozen(result.credentials)).toBe(true);
    expect(result.effectiveEnvironment).not.toHaveProperty("UNKNOWN");
  });

  it("ignores hostile host accessors and proxy get traps without importing them", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    writeFileSync(
      join(value.root, ".env"),
      "AIDOC_PROVIDER=ollama\nAIDOC_MODEL=root-model\n",
    );
    const getter = jest.fn(() => "host-model");
    const host = Object.create(null) as Record<string, string>;
    Object.defineProperty(host, "AIDOC_MODEL", {
      configurable: true,
      get: getter,
    });
    const proxyGet = jest.fn(() => "proxy-model");
    const proxy = new Proxy(host, { get: proxyGet });
    const loader = new MCPScopedConfigLoader(value.scope, proxy);
    await expect(loader.loadProvider(value.directory)).resolves.toMatchObject({
      config: { model: "root-model" },
    });
    expect(getter).not.toHaveBeenCalled();
    expect(proxyGet).not.toHaveBeenCalled();
  });

  it("rejects unsafe root .env forms and unsafe planning output", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    const loader = new MCPScopedConfigLoader(value.scope, Object.create(null));
    symlinkSync(join(value.outside, "missing.env"), join(value.root, ".env"));
    await expectUnsafe(loader.loadProvider(value.directory));
    rmSync(join(value.root, ".env"));
    writeFileSync(
      join(value.root, ".aidocrc.json"),
      JSON.stringify({ outputDir: "../outside" }),
    );
    await expectUnsafe(loader.loadPlanning(value.directory));
  });

  it("validates provider configuration globs and outputDir before returning", async () => {
    const invalidValues = [
      { include: Array.from({ length: 65 }, () => "**/*.ts") },
      {
        exclude: Array.from(
          { length: 17 },
          (_, index) => `${String.fromCharCode(97 + index)}${"x".repeat(1023)}`,
        ),
      },
      { outputDir: ".GIT/docs" },
      { outputDir: "./.Git/cache" },
      { outputDir: ".git/objects" },
      { outputDir: "docs\\generated" },
      { outputDir: "https://example.invalid/docs" },
    ];
    for (const config of invalidValues) {
      const value = await openFixture();
      roots.push(value.root, value.outside);
      writeFileSync(join(value.root, ".aidocrc.json"), JSON.stringify(config));
      const loader = new MCPScopedConfigLoader(
        value.scope,
        Object.create(null),
      );
      await expectUnsafe(loader.loadProvider(value.directory));
    }
  });

  it("rejects malformed, non-file, oversized, and invalid-UTF8 root .env files", async () => {
    const cases = ["directory", "oversized", "invalid-utf8"] as const;
    for (const kind of cases) {
      const value = await openFixture();
      roots.push(value.root, value.outside);
      const envPath = join(value.root, ".env");
      if (kind === "directory") {
        mkdirSync(envPath);
      } else if (kind === "oversized") {
        writeFileSync(envPath, Buffer.alloc(256 * 1024 + 1, 0x61));
      } else {
        writeFileSync(envPath, Buffer.from([0xc3, 0x28]));
      }
      const loader = new MCPScopedConfigLoader(
        value.scope,
        Object.create(null),
      );
      await expectUnsafe(loader.loadProvider(value.directory));
    }
  });

  it("returns immutable metadata with safe fallback and sorted unique dependencies", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    writeFileSync(
      join(value.selected, "package.json"),
      JSON.stringify({
        name: "sample-project",
        description: "A sample",
        dependencies: { zed: "1", alpha: "1", duplicate: "1" },
        devDependencies: { beta: "1", duplicate: "2" },
      }),
    );
    const loader = new MCPScopedConfigLoader(value.scope, Object.create(null));
    const metadata = await loader.readProjectMetadata(value.directory);
    expect(metadata).toEqual({
      name: "sample-project",
      description: "A sample",
      dependencies: ["alpha", "beta", "duplicate", "zed"],
    });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.dependencies)).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain(value.root);
  });

  it("rejects malformed and symlinked metadata while keeping absence deterministic", async () => {
    const value = await openFixture();
    roots.push(value.root, value.outside);
    const loader = new MCPScopedConfigLoader(value.scope, Object.create(null));
    await expect(loader.readProjectMetadata(value.directory)).resolves.toEqual({
      name: "api",
      description: "",
      dependencies: [],
    });
    writeFileSync(join(value.selected, "package.json"), "{\n");
    await expectUnsafe(loader.readProjectMetadata(value.directory));
    rmSync(join(value.selected, "package.json"));
    await expect(
      loader.readProjectMetadata(value.scope.rootDirectory()),
    ).resolves.toEqual({
      name: "project",
      description: "",
      dependencies: [],
    });
    writeFileSync(
      join(value.outside, "package.json"),
      JSON.stringify({ name: "outside" }),
    );
    symlinkSync(
      join(value.outside, "package.json"),
      join(value.selected, "package.json"),
    );
    await expectUnsafe(loader.readProjectMetadata(value.directory));
  });

  it("exposes pure CLI-compatible projections", () => {
    const defaults = defaultPlanningConfig();
    expect(parsePlanningConfig({ include: ["**/*.ts"] })).toMatchObject({
      include: ["**/*.ts"],
      outputDir: defaults.outputDir,
    });
    expect(
      environmentConfig({
        AIDOC_PROVIDER: "openai",
        AIDOC_ALLOW_LOCAL_HTTP: "false",
        UNKNOWN: "ignored",
      }),
    ).toEqual({ provider: "openai", allowLocalHttp: false });
    expect(
      parseConfigValues(
        {},
        {
          AIDOC_PROVIDER: "ollama",
          AIDOC_MODEL: "model",
        },
      ),
    ).toMatchObject({ provider: "ollama", model: "model" });
    expect(loadPlanningConfig(process.cwd()).outputDir).toBe("./docs");
  });

  it("formats only authentic configuration errors and never evaluates hostile values", () => {
    const authentic = new MCPUnsafeConfigurationError();
    expect(formatMCPError(authentic)).toBe(
      "MCP_UNSAFE_CONFIGURATION: The MCP project configuration cannot be loaded safely.",
    );
    expect(
      formatMCPError({
        code: "MCP_UNSAFE_CONFIGURATION",
        message: "/private/hostile/path fake-key",
      }),
    ).toBe("Unknown MCP error.");
    const getter = jest.fn(() => "/private/hostile/path fake-key");
    Object.defineProperty(authentic, "message", {
      configurable: true,
      get: getter,
    });
    expect(formatMCPError(authentic)).toBe("Unknown MCP error.");
    expect(getter).not.toHaveBeenCalled();
    expect(
      MCPUnsafeConfigurationError.read({ code: "UNAPPROVED_CODE" }),
    ).toBeUndefined();
    for (const invalidCode of ["UNAPPROVED_CODE", "__proto__"]) {
      expect(
        () =>
          new (MCPUnsafeConfigurationError as unknown as new (
            code: string,
          ) => MCPUnsafeConfigurationError)(invalidCode),
      ).toThrow("Invalid MCP unsafe configuration error setup.");
    }
    expect(MCPRepositoryScopeError).toBeDefined();
  });
});
