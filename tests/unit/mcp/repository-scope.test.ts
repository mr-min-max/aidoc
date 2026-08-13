import { execFileSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanFailure } from "../../../src/impact/types";
import {
  MCP_DIRECTORY_DENIED,
  MCP_INVALID_PATH_INPUT,
  MCPRepositoryReadScope,
  MCPRepositoryScopeError,
  MCP_SCOPE_ERROR_CODES,
  readExactMCPRecord,
  readOwnMCPArgument,
} from "../../../src/mcp/repository-scope";
import { formatMCPError } from "../../../src/mcp/server";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(root: string, message: string): string {
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
  return git(root, "rev-parse", "HEAD");
}

function fixture(): { root: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), "aidoc-mcp-scope-"));
  const outside = mkdtempSync(join(tmpdir(), "aidoc-mcp-scope-outside-"));
  mkdirSync(join(root, "packages", "api"), { recursive: true });
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "README.md"), "# repository\n");
  writeFileSync(join(root, "src", "index.ts"), "export const root = true;\n");
  writeFileSync(
    join(root, "packages", "api", "index.ts"),
    "export const api = true;\n",
  );
  writeFileSync(join(outside, "secret.ts"), "export const secret = true;\n");
  git(root, "init", "-q", "--initial-branch", "main");
  commit(root, "fixture: initial");
  git(outside, "init", "-q", "--initial-branch", "main");
  commit(outside, "fixture: external");
  return { root, outside };
}

function expectScopeError(
  promise: Promise<unknown>,
  code: "MCP_INVALID_PATH_INPUT" | "MCP_DIRECTORY_DENIED",
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    code,
    message:
      code === "MCP_INVALID_PATH_INPUT"
        ? "The MCP path input is invalid."
        : "The requested directory is outside the MCP repository scope.",
  });
}

describe("MCP repository read scope", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pins the Git worktree and authorizes only real repository directories", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    const sibling = `${root}-sibling`;
    mkdirSync(sibling);
    roots.push(sibling);

    const scope = await MCPRepositoryReadScope.open(root);
    const rootDirectory = scope.rootDirectory();
    const selected = await scope.authorizeDirectory("packages/api");

    expect(rootDirectory.displayPath).toBe(".");
    expect(selected.displayPath).toBe("packages/api");
    expect(Object.isFrozen(rootDirectory)).toBe(true);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(JSON.stringify(rootDirectory)).not.toContain(root);

    await expect(scope.authorizeDirectory(root)).resolves.toMatchObject({
      displayPath: ".",
    });
    await expect(
      scope.authorizeDirectory(join(root, "packages", "api")),
    ).resolves.toMatchObject({ displayPath: "packages/api" });
    await expectScopeError(
      scope.authorizeDirectory(outside),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory(sibling),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory(join(root, "missing")),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory(join(root, "README.md")),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory(join(root, ".git")),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory("../outside"),
      "MCP_INVALID_PATH_INPUT",
    );
  });

  it("rejects malformed directory values before filesystem authorization", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    const scope = await MCPRepositoryReadScope.open(root);

    for (const value of [
      undefined,
      null,
      42,
      [],
      {},
      "",
      "control\nvalue",
      "nul\u0000value",
      "x".repeat(4097),
    ]) {
      await expectScopeError(
        scope.authorizeDirectory(value),
        "MCP_INVALID_PATH_INPUT",
      );
    }
  });

  it("orders configuration directories and rejects cross-scope capabilities", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    const first = await MCPRepositoryReadScope.open(root);
    const selected = await first.authorizeDirectory("packages/api");
    const directories = first.configurationDirectories(selected);

    expect(directories.map((directory) => directory.displayPath)).toEqual([
      "packages/api",
      "packages",
      ".",
    ]);
    expect(directories.every((directory) => Object.isFrozen(directory))).toBe(
      true,
    );

    const second = await MCPRepositoryReadScope.open(root);
    await expectScopeError(
      second.readOptionalFile(selected, "index.ts"),
      "MCP_DIRECTORY_DENIED",
    );
    expect(() => second.configurationDirectories(selected)).toThrow(
      "The requested directory is outside the MCP repository scope.",
    );
  });

  it("revalidates selected-directory and pinned-root identities before reads", async () => {
    const firstFixture = fixture();
    roots.push(firstFixture.root, firstFixture.outside);
    const firstScope = await MCPRepositoryReadScope.open(firstFixture.root);
    const selected = await firstScope.authorizeDirectory("packages/api");
    const selectedPath = join(firstFixture.root, "packages", "api");
    const selectedBackup = `${selectedPath}-backup`;
    renameSync(selectedPath, selectedBackup);
    mkdirSync(selectedPath);
    writeFileSync(
      join(selectedPath, "index.ts"),
      "export const replaced = true;\n",
    );
    await expectScopeError(
      firstScope.readRequiredFile(selected, "index.ts"),
      "MCP_DIRECTORY_DENIED",
    );

    const secondFixture = fixture();
    roots.push(secondFixture.root, secondFixture.outside);
    const secondScope = await MCPRepositoryReadScope.open(secondFixture.root);
    const originalRoot = secondFixture.root;
    const movedRoot = `${originalRoot}-moved`;
    renameSync(originalRoot, movedRoot);
    roots.push(movedRoot);
    mkdirSync(originalRoot);
    await expectScopeError(
      secondScope.readOptionalFile(secondScope.rootDirectory(), "README.md"),
      "MCP_DIRECTORY_DENIED",
    );
  });

  it("rejects helper inherited, accessor, and proxy trap inputs without getters", () => {
    const failure = () => new MCPRepositoryScopeError("MCP_INVALID_PATH_INPUT");
    const inherited = Object.create({ directory: "/tmp/inherited" });
    expect(readOwnMCPArgument(inherited, "directory", failure)).toBeUndefined();

    const getter = jest.fn(() => "/tmp/secret");
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "directory", {
      configurable: true,
      enumerable: true,
      get: getter,
    });
    expect(() => readOwnMCPArgument(accessor, "directory", failure)).toThrow(
      "The MCP path input is invalid.",
    );
    expect(getter).not.toHaveBeenCalled();

    const proxy = new Proxy(Object.create(null), {
      ownKeys: () => {
        throw new Error("proxy sentinel");
      },
    });
    expect(() => readOwnMCPArgument(proxy, "directory", failure)).toThrow(
      "The MCP path input is invalid.",
    );
    expect(() => readExactMCPRecord(proxy, ["directory"], failure)).toThrow(
      "The MCP path input is invalid.",
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects every symlink component, including links that resolve inside", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    symlinkSync(join(root, "packages"), join(root, "inside-link"), "dir");
    symlinkSync(
      join(root, "packages"),
      join(root, "inside-parent-link"),
      "dir",
    );
    symlinkSync(outside, join(root, "outside-link"), "dir");
    symlinkSync(join(root, "missing"), join(root, "dangling-parent"), "dir");
    symlinkSync(join(root, "missing"), join(root, "dangling"), "dir");
    symlinkSync(join(root, "src", "index.ts"), join(root, "file-link"));

    const scope = await MCPRepositoryReadScope.open(root);
    await expectScopeError(
      scope.authorizeDirectory("inside-link"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory("inside-parent-link/api"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory("outside-link"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory("dangling-parent/api"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.authorizeDirectory("dangling"),
      "MCP_DIRECTORY_DENIED",
    );
    const directory = await scope.authorizeDirectory("packages/api");
    await expectScopeError(
      scope.readOptionalFile(scope.rootDirectory(), "inside-link/index.ts"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.readRequiredFile(directory, "../../file-link"),
      "MCP_INVALID_PATH_INPUT",
    );
  });

  it("reads bounded regular files without following links", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    symlinkSync(
      join(root, "src", "index.ts"),
      join(root, "src", "inside-link.ts"),
    );
    symlinkSync(
      join(outside, "secret.ts"),
      join(root, "src", "outside-link.ts"),
    );

    const scope = await MCPRepositoryReadScope.open(root);
    const directory = await scope.authorizeDirectory("src");
    const optional = await scope.readOptionalFile(directory, "index.ts");
    expect(optional).toMatchObject({
      displayPath: "src/index.ts",
      content: readFileSync(join(root, "src", "index.ts"), "utf8"),
    });
    expect(Object.isFrozen(optional)).toBe(true);

    const missing = await scope.readOptionalFile(directory, "missing.md");
    expect(missing).toMatchObject({
      displayPath: "src/missing.md",
      content: null,
    });
    await expectScopeError(
      scope.readRequiredFile(directory, "missing.md"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.readOptionalFile(directory, "inside-link.ts"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.readOptionalFile(directory, "outside-link.ts"),
      "MCP_DIRECTORY_DENIED",
    );
    await expectScopeError(
      scope.readOptionalFile(directory, "../.git/HEAD"),
      "MCP_INVALID_PATH_INPUT",
    );

    writeFileSync(join(root, "src", "too-large.txt"), "123456");
    await expectScopeError(
      scope.readRequiredFile(directory, "too-large.txt", { maxBytes: 5 }),
      "MCP_DIRECTORY_DENIED",
    );

    writeFileSync(
      join(root, "src", "default-too-large.txt"),
      Buffer.alloc(4 * 1024 * 1024 + 1, 0x61),
    );
    await expectScopeError(
      scope.readRequiredFile(directory, "default-too-large.txt"),
      "MCP_DIRECTORY_DENIED",
    );
    writeFileSync(
      join(root, "src", "invalid-utf8.txt"),
      Buffer.from([0xc3, 0x28]),
    );
    await expectScopeError(
      scope.readRequiredFile(directory, "invalid-utf8.txt"),
      "MCP_DIRECTORY_DENIED",
    );
  });

  it("prunes internal and external symlink entries from deterministic enumeration", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    writeFileSync(join(outside, "sentinel.ts"), "EXTERNAL_SENTINEL_VALUE\n");
    git(outside, "add", "--", ".");
    git(
      outside,
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "user.name=MCP Test",
      "commit",
      "-qm",
      "fixture: sentinel",
    );
    symlinkSync(join(root, "src"), join(root, "linked-inside"), "dir");
    symlinkSync(outside, join(root, "linked-outside"), "dir");
    symlinkSync(
      join(outside, "sentinel.ts"),
      join(root, "src", "linked-sentinel.ts"),
    );

    const scope = await MCPRepositoryReadScope.open(root);
    const files = await scope.enumerateSources(
      scope.rootDirectory(),
      ["**/*.ts"],
      [],
    );
    const repeat = await scope.enumerateSources(
      scope.rootDirectory(),
      ["**/*.ts"],
      [],
    );
    const serialized = JSON.stringify(files);
    expect(files.map((file) => file.displayPath)).toEqual([
      "packages/api/index.ts",
      "src/index.ts",
    ]);
    expect(serialized).not.toContain("EXTERNAL_SENTINEL_VALUE");
    expect(serialized).not.toContain("linked-");
    expect(serialized).not.toContain(root);
    expect(repeat.map((file) => file.displayPath)).toEqual(
      files.map((file) => file.displayPath),
    );
    expect(Object.isFrozen(files)).toBe(true);
  });

  it("denies enumeration above the file and aggregate-text bounds", async () => {
    const countFixture = fixture();
    roots.push(countFixture.root, countFixture.outside);
    const countDirectory = join(countFixture.root, "many");
    mkdirSync(countDirectory);
    const source = join(countDirectory, "source.ts");
    writeFileSync(source, "x");
    for (let index = 0; index <= 10_000; index += 1) {
      linkSync(
        source,
        join(countDirectory, `file-${String(index).padStart(5, "0")}.ts`),
      );
    }
    const countScope = await MCPRepositoryReadScope.open(countFixture.root);
    await expectScopeError(
      countScope.enumerateSources(
        await countScope.authorizeDirectory("many"),
        ["**/*.ts"],
        [],
      ),
      "MCP_DIRECTORY_DENIED",
    );

    const aggregateFixture = fixture();
    roots.push(aggregateFixture.root, aggregateFixture.outside);
    const aggregateDirectory = join(aggregateFixture.root, "aggregate");
    mkdirSync(aggregateDirectory);
    const chunk = Buffer.alloc(4 * 1024 * 1024, 0x61);
    for (let index = 0; index < 9; index += 1) {
      writeFileSync(join(aggregateDirectory, `chunk-${index}.ts`), chunk);
    }
    const aggregateScope = await MCPRepositoryReadScope.open(
      aggregateFixture.root,
    );
    await expectScopeError(
      aggregateScope.enumerateSources(
        await aggregateScope.authorizeDirectory("aggregate"),
        ["**/*.ts"],
        [],
      ),
      "MCP_DIRECTORY_DENIED",
    );
  }, 30_000);

  it("validates exact records and never evaluates accessors or implicit coercion", () => {
    const failure = () => new MCPRepositoryScopeError("MCP_INVALID_PATH_INPUT");
    const getter = jest.fn(() => "/tmp/should-not-run");
    const args = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(args, "directory", {
      enumerable: true,
      get: getter,
    });

    expect(() => readOwnMCPArgument(args, "directory", failure)).toThrow(
      "The MCP path input is invalid.",
    );
    expect(getter).not.toHaveBeenCalled();

    const inherited = Object.create({ directory: "/tmp/inherited" });
    expect(() => readExactMCPRecord(inherited, ["directory"], failure)).toThrow(
      "The MCP path input is invalid.",
    );

    const withExtra = { directory: "/tmp/safe", extra: "secret" };
    expect(() => readExactMCPRecord(withExtra, ["directory"], failure)).toThrow(
      "The MCP path input is invalid.",
    );

    const withSymbol = { directory: "/tmp/safe", [Symbol("secret")]: "x" };
    expect(() =>
      readExactMCPRecord(withSymbol, ["directory"], failure),
    ).toThrow("The MCP path input is invalid.");

    const copy = readExactMCPRecord(
      { directory: "/tmp/safe" },
      ["directory"],
      failure,
    );
    expect(Object.getPrototypeOf(copy)).toBeNull();
    expect(Object.isFrozen(copy)).toBe(true);
    expect(copy).toEqual({ directory: "/tmp/safe" });
  });

  it("distinguishes missing glob overrides and rejects unsafe patterns", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    const scope = await MCPRepositoryReadScope.open(root);

    expect(scope.parseOptionalGlobList(undefined, "include")).toBeUndefined();
    expect(scope.parseOptionalGlobList("", "exclude")).toEqual([]);
    expect(
      Object.isFrozen(scope.parseOptionalGlobList("**/*.ts", "include")),
    ).toBe(true);
    await expectScopeError(
      Promise.resolve().then(() => scope.parseOptionalGlobList("", "include")),
      "MCP_INVALID_PATH_INPUT",
    );

    for (const pattern of [
      "/etc/**",
      "C:/Users/**",
      "//server/share/**",
      "https://example.invalid/**",
      "src\\**\\*.ts",
      "{src,../outside}/**",
      "@(src|../outside)/**",
      "src/../outside/**",
    ]) {
      await expectScopeError(
        Promise.resolve().then(() =>
          scope.validateGlobList([pattern], "include"),
        ),
        "MCP_INVALID_PATH_INPUT",
      );
    }

    await expectScopeError(
      Promise.resolve().then(() =>
        scope.validateGlobList(
          Array.from({ length: 65 }, () => "**/*.ts"),
          "include",
        ),
      ),
      "MCP_INVALID_PATH_INPUT",
    );
    await expectScopeError(
      Promise.resolve().then(() =>
        scope.validateGlobList(["x".repeat(1025)], "include"),
      ),
      "MCP_INVALID_PATH_INPUT",
    );
    await expectScopeError(
      Promise.resolve().then(() =>
        scope.validateGlobList(
          Array.from(
            { length: 17 },
            (_, index) =>
              `${String.fromCharCode(97 + index)}${"x".repeat(1023)}`,
          ),
          "include",
        ),
      ),
      "MCP_INVALID_PATH_INPUT",
    );
    for (const pattern of ["control\npattern", "nul\u0000pattern"]) {
      await expectScopeError(
        Promise.resolve().then(() =>
          scope.validateGlobList([pattern], "include"),
        ),
        "MCP_INVALID_PATH_INPUT",
      );
    }

    const sparse = [] as string[];
    sparse.length = 1;
    await expectScopeError(
      Promise.resolve().then(() => scope.validateGlobList(sparse, "include")),
      "MCP_INVALID_PATH_INPUT",
    );
    const getter = jest.fn(() => "**/*.ts");
    const accessor = [] as string[];
    Object.defineProperty(accessor, 0, { configurable: true, get: getter });
    await expectScopeError(
      Promise.resolve().then(() => scope.validateGlobList(accessor, "include")),
      "MCP_INVALID_PATH_INPUT",
    );
    expect(getter).not.toHaveBeenCalled();

    const withSymbol = ["**/*.ts"] as string[];
    Object.defineProperty(withSymbol, Symbol("pattern"), { value: "secret" });
    await expectScopeError(
      Promise.resolve().then(() =>
        scope.validateGlobList(withSymbol, "include"),
      ),
      "MCP_INVALID_PATH_INPUT",
    );
    const proxy = new Proxy(["**/*.ts"], {
      ownKeys: () => {
        throw new Error("proxy glob trap");
      },
    });
    await expectScopeError(
      Promise.resolve().then(() => scope.validateGlobList(proxy, "include")),
      "MCP_INVALID_PATH_INPUT",
    );

    const selected = await scope.authorizeDirectory(".");
    const files = await scope.enumerateSources(
      selected,
      ["**/*.ts"],
      ["**/node_modules/**"],
    );
    expect(files.map((file) => file.displayPath)).toEqual([
      "packages/api/index.ts",
      "src/index.ts",
    ]);
    expect(files.every((file) => Object.isFrozen(file))).toBe(true);
  });

  it("returns bounded Git changes as sorted repository-relative paths", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    const base = git(root, "rev-parse", "HEAD");
    writeFileSync(
      join(root, "src", "index.ts"),
      "export const root = false;\n",
    );
    writeFileSync(
      join(root, "packages", "api", "changed.ts"),
      "export const changed = true;\n",
    );
    const head = commit(root, "fixture: changed");
    const scope = await MCPRepositoryReadScope.open(root);

    expect(scope.validateGitRef(undefined, "HEAD~5")).toBe("HEAD~5");
    expect(scope.validateGitRef("refs/heads/main", "HEAD")).toBe(
      "refs/heads/main",
    );
    for (const ref of ["-c", "bad\nref", "bad\rref", `x${"a".repeat(1024)}`]) {
      expect(() => scope.validateGitRef(ref, "HEAD")).toThrow(PlanFailure);
      expect(() => scope.validateGitRef(ref, "HEAD")).toThrow(
        "The Git reference is invalid.",
      );
    }

    const rootChanges = await scope.changedFiles(
      scope.rootDirectory(),
      base,
      head,
    );
    expect(rootChanges).toEqual(["packages/api/changed.ts", "src/index.ts"]);
    const api = await scope.authorizeDirectory("packages/api");
    await expect(scope.changedFiles(api, base, head)).resolves.toEqual([
      "packages/api/changed.ts",
    ]);
    expect(rootChanges.some((file) => file.startsWith("/"))).toBe(false);
  });

  it("sanitizes Git environment and rejects unsafe or value-bearing Git failures", async () => {
    const { root, outside } = fixture();
    roots.push(root, outside);
    const base = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "unsafe\nname.ts"), "unsafe\n");
    const head = commit(root, "fixture: unsafe path");
    const previousEnvironment = new Map(
      ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_GLOBAL"].map(
        (key) => [key, process.env[key]] as const,
      ),
    );
    process.env.GIT_DIR = join(outside, ".git");
    process.env.GIT_WORK_TREE = outside;
    process.env.GIT_INDEX_FILE = join(outside, "hostile-index");
    process.env.GIT_CONFIG_GLOBAL = join(outside, "hostile-config");

    try {
      const scope = await MCPRepositoryReadScope.open(root);
      await expectScopeError(
        scope.changedFiles(scope.rootDirectory(), base, head),
        "MCP_DIRECTORY_DENIED",
      );
      let gitFailure: unknown;
      try {
        await scope.changedFiles(scope.rootDirectory(), "missing-ref", head);
      } catch (error) {
        gitFailure = error;
      }
      expect(gitFailure).toBeDefined();
      const formatted = formatMCPError(gitFailure);
      expect(formatted).toBe(
        "MCP_DIRECTORY_DENIED: The requested directory is outside the MCP repository scope.",
      );
      expect(formatted).not.toContain(root);
      expect(formatted).not.toContain("hostile");
    } finally {
      for (const [key, value] of previousEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("formats only authentic fixed scope errors", () => {
    const expectedMessages = new Map([
      [MCP_INVALID_PATH_INPUT, "The MCP path input is invalid."],
      [
        MCP_DIRECTORY_DENIED,
        "The requested directory is outside the MCP repository scope.",
      ],
    ]);
    for (const code of MCP_SCOPE_ERROR_CODES) {
      const authentic = new MCPRepositoryScopeError(code);
      const formatted = formatMCPError(authentic);
      expect(formatted).toBe(`${code}: ${expectedMessages.get(code)}`);
      expect(formatted.match(new RegExp(code, "gu"))).toHaveLength(1);
    }

    for (const invalidCode of ["UNAPPROVED_CODE", "__proto__"]) {
      let thrown: unknown;
      try {
        new MCPRepositoryScopeError(invalidCode as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(formatMCPError(thrown)).toBe(
        "Invalid MCP repository scope error configuration.",
      );
      expect(formatMCPError(thrown)).not.toContain(invalidCode);
    }

    const accessorGetters = {
      code: jest.fn(() => MCP_DIRECTORY_DENIED),
      message: jest.fn(() => "/Users/attacker/secret fake key"),
    };
    const accessorError = new MCPRepositoryScopeError(MCP_DIRECTORY_DENIED);
    Object.defineProperty(accessorError, "code", {
      configurable: true,
      get: accessorGetters.code,
    });
    Object.defineProperty(accessorError, "message", {
      configurable: true,
      get: accessorGetters.message,
    });
    expect(formatMCPError(accessorError)).toBe("Unknown MCP error.");
    expect(accessorGetters.code).not.toHaveBeenCalled();
    expect(accessorGetters.message).not.toHaveBeenCalled();

    expect(
      formatMCPError({
        code: "MCP_DIRECTORY_DENIED",
        message: "/Users/attacker/secret fake key",
      }),
    ).toBe("Unknown MCP error.");

    const forgedGetter = jest.fn(() => MCP_INVALID_PATH_INPUT);
    const forged = Object.create(null);
    Object.defineProperty(forged, "code", {
      configurable: true,
      get: forgedGetter,
    });
    Object.defineProperty(forged, "message", {
      configurable: true,
      value: "/Users/attacker/secret fake key",
    });
    expect(formatMCPError(forged)).toBe("Unknown MCP error.");
    expect(forgedGetter).not.toHaveBeenCalled();

    const proxyGet = jest.fn(() => {
      throw new Error("proxy getter");
    });
    const hostileProxy = new Proxy(
      { code: MCP_INVALID_PATH_INPUT, message: "/private/secret" },
      { get: proxyGet },
    );
    expect(formatMCPError(hostileProxy)).toBe("Unknown MCP error.");
    expect(proxyGet).not.toHaveBeenCalled();
  });
});
