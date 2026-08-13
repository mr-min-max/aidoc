# MCP Repository Scope Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin every MCP project read and project configuration lookup to the Git worktree where the server started, before AiDoc can read source, inspect Git, parse AST, construct a provider, or return local paths.

**Architecture:** Create one MCP-only `MCPRepositoryReadScope` per server and make it the sole authority for legacy caller paths, legacy project reads/source enumeration, all MCP declarative configuration, and repository-relative display paths. The three provider-free tools retain their existing startup-root source/target guards and receive bounded configuration through the same server context. Keep normal CLI loaders and parser behavior unchanged; legacy MCP parses already-authorized in-memory source and provider-free MCP injects a bounded planning configuration into the shared impact planner. Preserve all eight MCP tool names and response shapes except for the intentional privacy correction from absolute to repository-relative `analyze_codebase.modules[].filePath`.

**Tech Stack:** TypeScript 6, Node.js 22+, Git CLI, `path.posix.matchesGlob`, `cosmiconfig` declarative loaders, `dotenv.parse`, Jest 30, MCP SDK 1.30, Node test runner.

## Global Constraints

- Follow `AGENTS.md`: AST first, provider agnostic, template driven, and unit-test all parser/provider changes.
- Implement [the approved design](../specs/2026-08-13-mcp-repository-scope-design.md) without adding an MCP write tool, authentication bridge, multi-root allowlist, dependency, package script, or publication action.
- One MCP server authorizes exactly the canonical Git worktree containing its startup cwd; root and real descendants are accepted, and symlink components, `.git`, external, missing, and non-directory targets fail closed.
- Directory inputs are at most 4,096 UTF-8 bytes. Glob lists allow at most 64 patterns, 1,024 UTF-8 bytes per pattern, and 16,384 UTF-8 bytes combined.
- Authorized source/config/metadata files are at most 4 MiB each; one source enumeration returns at most 10,000 files and 32 MiB of captured text. Configuration and `.env` apply stricter 256 KiB call-site limits.
- Only JSON/YAML/no-extension YAML and the `aidoc` field in `package.json` are project configuration in MCP. JS/TS/CJS/MJS config is rejected without execution. CLI configuration semantics remain unchanged.
- MCP rejects the legacy secret-bearing `apiKey` project-config field; credentials come only from the copied host environment or the bounded root `.env` snapshot.
- MCP may parse only the pinned-root `.env`, from a verified no-follow read, into an immutable request environment. Existing host environment values win and `process.env` is never mutated.
- Every MCP source parse starts from authorized captured text. Do not pass an authorized pathname back into `LanguageParser.parse()`.
- Errors use authentic fixed-message classes and never serialize caller paths, config/source text, credentials, raw filesystem/provider errors, or stacks.
- All implementation work follows RED → GREEN → refactor. Never write production code before the mapped failing test has been run and observed failing for the expected reason.
- Use writable offline npm cache for package/release gates: `NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 NPM_CONFIG_OFFLINE=true`.
- No push, tag, npm publish, marketplace install, history rewrite, or change to the accepted retained-history private-path decision.

## File Map

- Create `src/mcp/repository-scope.ts`: authentic MCP scope errors, pinned Git-root discovery, hostile argument readers, lexical/path authorization, no-follow/identity-checked project reads, bounded glob parsing, symlink-pruned source enumeration, relative display paths, and bounded Git-ref validation.
- Create `src/mcp/scoped-config.ts`: bounded declarative config discovery/parsing, executable-config refusal, safe planning/provider config projection, exact pinned-root `.env` snapshot, and package metadata parsing.
- Modify `src/parsers/types.ts`, `src/parsers/typescript.ts`, `src/parsers/python.ts`: add an optional captured-source parser capability and implement it for the two built-in parsers without changing existing `parse()` or `snapshot()` contracts.
- Modify `src/core/analyzer.ts`: add `analyzeCapturedSources()` for MCP; keep `analyzeCodebase()` for CLI.
- Modify `src/config/planning.ts`: export a pure planning-config parser/default factory used by the MCP loader while preserving ordinary cosmiconfig search.
- Modify `src/config/loader.ts`: export pure config/environment projection helpers that accept an explicit environment; keep `loadProviderConfig()` and implicit dotenv behavior for CLI only.
- Modify `src/providers/registry.ts`: allow provider availability/construction to read an explicit immutable five-key credential environment carried in `ProviderConfig`; default to `process.env` for all existing CLI callers.
- Modify `src/impact/planner.ts`: accept an optional frozen `PlanningConfig` override; MCP uses it, ordinary CLI does not.
- Modify `src/mcp/update-workflow.ts`: carry the pinned read scope and safe planning-config loader in one per-server workflow context.
- Modify `src/mcp/server.ts`: instantiate one async MCP runtime context, route all eight tools through it, enforce schema/order/error contracts, and normalize successful paths.
- Create `src/mcp/scoped-freshness.ts` and minimally modify `src/core/freshness.ts`: MCP owns authorized Git/file/AST work while reusing the core source-candidate predicate and report assessment; ordinary CLI behavior stays unchanged.
- Modify tests under `tests/unit/mcp/`, `tests/unit/parsers/`, `tests/unit/core/`, `tests/unit/config/`, and `tests/unit/providers/` only where their public contracts change.
- Modify `tests/e2e/mcp-smoke.mjs`, `tests/e2e/smoke-tarball.mjs`, `scripts/public-beta-preflight.mjs`, and `tests/e2e/public-beta-preflight.test.mjs` for built/packed A/B isolation and artifact coverage.
- Modify `README.md`, `ROADMAP.md`, `docs/PUBLIC_BETA.md`, `docs/integrations/codex.md`, `docs/integrations/claude.md`, `docs/releases/v0.2.0-beta.3.md`, `integrations/codex/aidoc/skills/maintain-documentation/SKILL.md`, `tests/unit/release/public-beta-config.test.ts`, and `tests/e2e/codex-plugin-smoke.mjs` so public claims match the executable boundary.

---

### Task 1: Pinned MCP Repository Read Scope

**Files:**

- Create: `src/mcp/repository-scope.ts`
- Create: `tests/unit/mcp/repository-scope.test.ts`
- Modify: `src/mcp/server.ts`
- Test: `tests/unit/mcp/security.test.ts`

**Interfaces:**

- Produces:

```ts
export const MCP_SCOPE_ERROR_CODES = [
  "MCP_INVALID_PATH_INPUT",
  "MCP_DIRECTORY_DENIED",
] as const;

export class MCPRepositoryScopeError extends Error {
  readonly code: (typeof MCP_SCOPE_ERROR_CODES)[number];
  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined;
}

declare const authorizedMCPDirectory: unique symbol;
declare const authorizedMCPFile: unique symbol;

export interface AuthorizedMCPDirectory {
  readonly [authorizedMCPDirectory]: true;
  readonly displayPath: string; // "." or repository-relative POSIX path
}

export interface AuthorizedMCPFile {
  readonly [authorizedMCPFile]: true;
  readonly displayPath: string; // repository-relative POSIX path
  readonly content: string | null;
}

export interface AuthorizedMCPExistingFile extends AuthorizedMCPFile {
  readonly content: string;
}

export function readOwnMCPArgument(
  args: unknown,
  key: string,
  failure: () => Error,
): unknown;

export function readExactMCPRecord(
  args: unknown,
  allowedKeys: readonly string[],
  failure: () => Error,
): Readonly<Record<string, unknown>>;

export class MCPRepositoryReadScope {
  static open(serverCwd: string): Promise<MCPRepositoryReadScope>;
  rootDirectory(): AuthorizedMCPDirectory;
  configurationDirectories(
    directory: AuthorizedMCPDirectory,
  ): readonly AuthorizedMCPDirectory[]; // selected directory through root
  authorizeDirectory(raw: unknown): Promise<AuthorizedMCPDirectory>;
  readOptionalFile(
    directory: AuthorizedMCPDirectory,
    rawRelativePath: unknown,
    options?: { readonly maxBytes: number },
  ): Promise<AuthorizedMCPFile>;
  readRequiredFile(
    directory: AuthorizedMCPDirectory,
    rawRelativePath: unknown,
    options?: { readonly maxBytes: number },
  ): Promise<AuthorizedMCPExistingFile>;
  parseOptionalGlobList(
    raw: unknown,
    kind: "include" | "exclude",
  ): readonly string[] | undefined;
  validateGlobList(
    raw: unknown,
    kind: "include" | "exclude",
  ): readonly string[];
  enumerateSources(
    directory: AuthorizedMCPDirectory,
    include: readonly string[],
    exclude: readonly string[],
  ): Promise<readonly AuthorizedMCPExistingFile[]>;
  validateGitRef(raw: unknown, fallback: string): string;
  changedFiles(
    directory: AuthorizedMCPDirectory,
    fromRef: string,
    toRef?: string,
  ): Promise<readonly string[]>; // safe repository-relative POSIX paths within directory
}
```

- The two brand symbols stay module-private. `AuthorizedMCPDirectory` and `AuthorizedMCPFile` are frozen values constructed only by the scope, and their internal canonical path/identity records stay in private `WeakMap` state; do not expose canonical absolute roots in public results.
- `MCPRepositoryScopeError.read()` uses private authenticity state and fixed messages. Remove its codes from the formatter's generic property-based allowlist; a forged or mutated lookalike must fail closed.

- [ ] **Step 1: Write the failing scope/error tests**

Cover one real temporary Git repository plus an external sibling repository. The test table must include:

```ts
await expect(scope.authorizeDirectory(root)).resolves.toMatchObject({
  displayPath: ".",
});
await expect(scope.authorizeDirectory("packages/api")).resolves.toMatchObject({
  displayPath: "packages/api",
});
await expect(scope.authorizeDirectory(external)).rejects.toMatchObject({
  code: "MCP_DIRECTORY_DENIED",
  message: "The requested directory is outside the MCP repository scope.",
});
```

Also assert empty/non-string/array/inherited/accessor/proxy/control/NUL/>4096-byte inputs, `..`, sibling-prefix, missing, file-as-directory, `.git`, parent/leaf/dangling/symlink-to-inside, and root/directory identity changes. Hostile getters must never execute. Serialize seeded external paths and fake keys through `formatMCPError()` and prove neither value appears and each code appears exactly once.

- [ ] **Step 2: Run the scope tests and verify RED**

Run:

```bash
npm test -- tests/unit/mcp/repository-scope.test.ts tests/unit/mcp/security.test.ts --runInBand
```

Expected: FAIL because `MCPRepositoryReadScope`, authentic errors, and the context wiring do not exist.

- [ ] **Step 3: Implement minimal pinned-root discovery and authentic errors**

Use `git rev-parse --show-toplevel --absolute-git-dir` with inherited `GIT_*` variables removed; set `LC_ALL=C`, `GIT_CONFIG_NOSYSTEM=1`, global/system config to `os.devNull`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, and `GIT_NO_REPLACE_OBJECTS=1`; apply fixed timeout/maxBuffer and value-free failures. Canonicalize/lstat the startup directory, root, Git directory, and `.git` entry; capture bigint `dev`, `ino`, and type identities. Walk every directory component with `lstat`, reject every symlink (including symlink-to-inside), require a directory leaf, require canonical containment, and reject Git metadata.

Move the existing safe own-data-property pattern into `readOwnMCPArgument()` and `readExactMCPRecord()` using guarded `Reflect.ownKeys` and `Object.getOwnPropertyDescriptor`. The exact-record reader permits only the route's named string keys, rejects every extra string or symbol key, accessor, inherited value, proxy trap failure, implicit conversion, or extra input type, and returns a frozen null-prototype copy. Legacy directory/doc/glob callers pass `MCP_INVALID_PATH_INPUT`; ref callers pass `PLAN_INVALID_REF`. This runtime check is required independently of `additionalProperties:false` schema metadata.

- [ ] **Step 4: Implement safe relative-file reads and glob/ref input validation**

Implement descriptor-backed UTF-8 reads with `O_NOFOLLOW` when available, pre/post `fstat` identity and size/mtime/ctime checks, the 4 MiB default ceiling, and repository-relative POSIX display paths. `readOptionalFile()` returns an authorized snapshot with `content:null` only for a genuinely missing safe leaf; unsafe/mutated paths reject. Source enumeration fails closed above 10,000 files or 32 MiB aggregate text.

Validate comma-separated caller input or configured arrays into immutable lists. `parseOptionalGlobList(undefined, ...)` returns `undefined` so a missing caller override can be distinguished from an explicit empty value; `validateGlobList()` requires a defined list. Reject absolute/drive/UNC/URI/backslash/control/empty (except whole exclude `""` → `[]`), any `..` substring (a conservative guard covering brace/extglob traversal forms), >64 patterns, >1,024 bytes per pattern, and >16,384 combined bytes. Validate refs as nonempty bounded strings with no leading `-`, NUL, LF, or CR. Tests include drive, UNC, brace/extglob traversal, and Windows-style separator inputs.

- [ ] **Step 5: Implement symlink-pruned source enumeration**

Walk with `readdir({withFileTypes:true})`, never recurse into or accept symlink entries, skip `.git`, sort names deterministically, produce repository-relative paths, apply validated patterns with Node's `path.posix.matchesGlob`, and call `readRequiredFile()` before returning each source. Revalidate pinned root/directory identity before each read phase. `changedFiles()` runs fixed Git argv with `--`, validates every returned NUL-delimited path, filters to the selected directory, and never exposes an absolute cwd.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/mcp/repository-scope.test.ts tests/unit/mcp/security.test.ts --runInBand
npx tsc --noEmit
npx eslint src/mcp/repository-scope.ts src/mcp/server.ts tests/unit/mcp/repository-scope.test.ts tests/unit/mcp/security.test.ts
```

Expected: all commands exit 0; `formatMCPError()` recognizes authentic fixed errors and forged/mutated lookalikes still become `Unknown MCP error.`

- [ ] **Step 7: Commit the scope**

```bash
git add src/mcp/repository-scope.ts src/mcp/server.ts tests/unit/mcp/repository-scope.test.ts tests/unit/mcp/security.test.ts
git commit -m "feat(mcp): pin repository read scope"
```

### Task 2: Safe MCP Configuration, Metadata, and Credential Snapshot

**Files:**

- Create: `src/mcp/scoped-config.ts`
- Create: `tests/unit/mcp/scoped-config.test.ts`
- Modify: `src/config/planning.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/providers/registry.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/unit/config/planning.test.ts`
- Modify: `tests/unit/config/environment.test.ts`
- Modify: `tests/unit/providers/registry.test.ts`
- Modify: `tests/unit/mcp/security.test.ts`

**Interfaces:**

- Consumes: `MCPRepositoryReadScope`, `AuthorizedMCPDirectory`, and `AuthorizedMCPFile` from Task 1.
- Produces:

```ts
export class MCPUnsafeConfigurationError extends Error {
  readonly code = "MCP_UNSAFE_CONFIGURATION" as const;
  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined;
}

export interface MCPProjectMetadata {
  readonly name: string;
  readonly description: string;
  readonly dependencies: readonly string[];
}

// Defined in src/providers/registry.ts; imported by the MCP config loader.
export type ProviderCredentialName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "DASHSCOPE_API_KEY"
  | "AIDOC_COMPAT_API_KEY";

export type ProviderCredentialEnvironment = Readonly<
  Partial<Record<ProviderCredentialName, string>>
>;

export type MCPAllowedEnvironment = Readonly<
  Partial<
    Record<
      | ProviderCredentialName
      | "AIDOC_PROVIDER"
      | "AIDOC_MODEL"
      | "AIDOC_PROVIDER_BASE_URL"
      | "AIDOC_ALLOW_LOCAL_HTTP"
      | "AIDOC_QWEN_REGION"
      | "AIDOC_QWEN_WORKSPACE_ID"
      | "AIDOC_OLLAMA_HOST"
      | "AIDOC_TRUST_POLICY",
      string
    >
  >
>;

export interface MCPProviderSettings {
  readonly config: Readonly<AidocConfig>;
  readonly effectiveEnvironment: MCPAllowedEnvironment;
  readonly credentials: ProviderCredentialEnvironment;
}

export class MCPScopedConfigLoader {
  constructor(
    scope: MCPRepositoryReadScope,
    hostEnvironment?: Readonly<NodeJS.ProcessEnv>,
  );
  loadPlanning(
    directory: AuthorizedMCPDirectory,
  ): Promise<Readonly<PlanningConfig>>;
  loadProvider(directory: AuthorizedMCPDirectory): Promise<MCPProviderSettings>;
  readProjectMetadata(
    directory: AuthorizedMCPDirectory,
  ): Promise<MCPProjectMetadata>;
}
```

- Add `credentialEnvironment?: ProviderCredentialEnvironment` to `ProviderConfig`; built-ins read credentials from it when supplied and otherwise preserve `process.env` behavior.
- Export pure `defaultPlanningConfig()`, `parsePlanningConfig(value)`, `environmentConfig(env)`, and `parseConfigValues(fileValue, env)` helpers; normal CLI loaders delegate to them without semantic change.
- `effectiveEnvironment` is a frozen null-prototype allowlisted snapshot containing only the exact thirteen supported variables and is typed as a readonly partial environment at implementation time. `credentials` is its frozen five-key subset; neither object is serialized.
- `MCPUnsafeConfigurationError.read()` uses private authenticity state and always returns the fixed message `The MCP project configuration cannot be loaded safely.`. `formatMCPError()` recognizes that authentic type before generic diagnostics and does not trust an object merely claiming its code.

- [ ] **Step 1: Write failing configuration tests**

Test bounded upward precedence for `package.json#aidoc`; `.aidocrc`, `.aidocrc.json`, `.aidocrc.yaml`, `.aidocrc.yml`; the corresponding JS/TS/CJS/MJS deny-only candidates; `.config/aidocrc`, `.config/aidocrc.json`, `.config/aidocrc.yaml`, `.config/aidocrc.yml`; their JS/TS/CJS/MJS deny-only candidates; and `aidoc.config.js`, `aidoc.config.ts`, `aidoc.config.cjs`, `aidoc.config.mjs`. Prove search stops at the pinned root and never reaches a parent/home/global config. Assert a selected executable config, malformed declarative config/package JSON, legacy `apiKey`, and config/package symlink fail with authentic `MCP_UNSAFE_CONFIGURATION` without executing a marker-writing body. Assert the first actual artifact in the documented MCP precedence wins and later artifacts are not evaluated. Serialize authentic, forged, mutated, and hostile configuration errors through `formatMCPError()` and prove only the authentic error receives the stable code/message.

Test caller/config glob bounds and repository-relative `outputDir` through Task 1's validator. Test only the pinned-root `.env`, reject its symlink/non-file form, and import only `AIDOC_PROVIDER`, `AIDOC_MODEL`, `AIDOC_PROVIDER_BASE_URL`, `AIDOC_ALLOW_LOCAL_HTTP`, `AIDOC_QWEN_REGION`, `AIDOC_QWEN_WORKSPACE_ID`, `AIDOC_OLLAMA_HOST`, `AIDOC_TRUST_POLICY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, and `AIDOC_COMPAT_API_KEY`. Preserve host precedence and prove `process.env` is byte-for-byte unchanged. Add end-to-end cases where bounded `.env` alone selects the provider/model, Qwen region/workspace, compatible endpoint/local-HTTP permission, Ollama host/model, and Trust policy exactly once. Test `package.json` metadata fallback and sorted dependencies.

- [ ] **Step 2: Run configuration tests and verify RED**

Run:

```bash
npm test -- tests/unit/mcp/scoped-config.test.ts tests/unit/mcp/security.test.ts tests/unit/config/planning.test.ts tests/unit/config/environment.test.ts tests/unit/providers/registry.test.ts --runInBand
```

Expected: FAIL because the scoped loader, pure projections, explicit credential environment, and authentic configuration error do not exist.

- [ ] **Step 3: Extract pure config projections without changing CLI**

Move the current defaults/parser logic behind exported pure functions. Keep `loadPlanningConfig()` using ordinary cosmiconfig and keep `loadProviderConfig()` invoking dotenv for CLI. Type the built-in `selectedCredential()` environment-name parameter as `ProviderCredentialName` and extend its lookup to:

```ts
const source = config.credentialEnvironment ?? process.env;
const environmentValue = source[envName];
```

When `credentialEnvironment` is explicitly supplied, it is the complete credential authority for that construction: do not consult `process.env` for a missing key. This prevents credentials that were deliberately excluded from the MCP allowlisted snapshot from leaking back through the ambient process. Never serialize or copy credential values into selection metadata or error messages.

- [ ] **Step 4: Implement bounded declarative MCP discovery**

Walk `scope.configurationDirectories()` from the selected directory to the root. At each level use this explicit MCP order: `package.json#aidoc`; `.aidocrc`, `.aidocrc.json`, `.aidocrc.yaml`, `.aidocrc.yml`; executable `.aidocrc.js`, `.aidocrc.ts`, `.aidocrc.cjs`, `.aidocrc.mjs`; `.config/aidocrc`, `.config/aidocrc.json`, `.config/aidocrc.yaml`, `.config/aidocrc.yml`; executable `.config/aidocrc.js`, `.config/aidocrc.ts`, `.config/aidocrc.cjs`, `.config/aidocrc.mjs`; then executable `aidoc.config.js`, `aidoc.config.ts`, `aidoc.config.cjs`, `aidoc.config.mjs`. The MJS entries are a fail-closed deny-only superset of the current synchronous CLI search, not a claim that CLI loads them. Inspect candidates only through the scope and stop on the first actual configuration; `package.json` counts only when its parsed own `aidoc` field exists. Use only `defaultLoadersSync[".json"]`, `.yaml`, `.yml`, and `noExt` on captured text. If the selected candidate is executable or contains the legacy secret-bearing `apiKey` field, reject before execution/projection. Reject malformed selected artifacts rather than silently falling back; do not inspect lower-precedence or higher-directory candidates after a selection. Validate parsed include/exclude lists and require `outputDir` to remain repository-relative before returning either planning or provider configuration. Translate candidate/package/`.env` scope failures into authentic `MCP_UNSAFE_CONFIGURATION` without copying the underlying diagnostic.

- [ ] **Step 5: Implement root `.env`, metadata, and immutable output**

`loadProvider()` reads only root `.env` with the scope and a 256 KiB ceiling, parses captured text with `dotenv.parse`, selects the exact eight `AIDOC_*` names and five credential variables listed in Step 1, and overlays them only when the host value is absent. Pass the resulting safe environment snapshot into `parseConfigValues(fileValue, env)` so all eight `AIDOC_*` values are reflected in the returned effective `AidocConfig`; return that frozen allowlisted snapshot as `effectiveEnvironment` and its five credential keys separately as `credentials` for the registry. Never mutate `process.env`. `loadPlanning()` does not read `.env` or project metadata. Parse the selected directory's authorized `package.json` without getters/prototypes; safe absence uses directory basename/empty fields, while malformed or symlinked metadata fails closed. Deep-freeze all public arrays/objects.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/mcp/scoped-config.test.ts tests/unit/mcp/security.test.ts tests/unit/config/planning.test.ts tests/unit/config/environment.test.ts tests/unit/providers/registry.test.ts --runInBand
npx tsc --noEmit
npx eslint src/mcp/scoped-config.ts src/mcp/server.ts src/config/planning.ts src/config/loader.ts src/providers/registry.ts tests/unit/mcp/scoped-config.test.ts tests/unit/mcp/security.test.ts tests/unit/config/planning.test.ts tests/unit/config/environment.test.ts tests/unit/providers/registry.test.ts
```

Expected: exit 0 and the existing CLI/provider environment behavior remains green.

- [ ] **Step 7: Commit scoped configuration**

```bash
git add src/mcp/scoped-config.ts src/mcp/server.ts src/config/planning.ts src/config/loader.ts src/providers/registry.ts tests/unit/mcp/scoped-config.test.ts tests/unit/mcp/security.test.ts tests/unit/config/planning.test.ts tests/unit/config/environment.test.ts tests/unit/providers/registry.test.ts
git commit -m "feat(mcp): load bounded project configuration"
```

### Task 3: Parse Authorized Source Text In Memory

**Files:**

- Modify: `src/parsers/types.ts`
- Modify: `src/parsers/typescript.ts`
- Modify: `src/parsers/python.ts`
- Modify: `src/core/analyzer.ts`
- Modify: `tests/unit/parsers/typescript.test.ts`
- Modify: `tests/unit/parsers/python.test.ts`
- Modify: `tests/unit/core/analyzer.test.ts`

**Interfaces:**

- Consumes: `AuthorizedMCPFile` from Task 1.
- Produces:

```ts
export interface LanguageParser {
  readonly name: string;
  readonly supportedExtensions: string[];
  parse(filePath: string): Promise<ParsedModule>;
  parseSource?(filePath: string, source: string): Promise<ParsedModule>;
  snapshot(filePath: string, source: string): Promise<ParserModuleSnapshot>;
}

export async function analyzeCapturedSources(
  files: readonly { displayPath: string; content: string }[],
): Promise<ParsedModule[]>;
```

- A registered parser without `parseSource()` remains usable by ordinary CLI analysis but is treated as unsupported by captured-source MCP analysis; MCP never falls back to pathname parsing.

- [ ] **Step 1: Write failing parser/analyzer tests**

For TypeScript and Python, call `parseSource!("src/api.ts", source)` / `parseSource!("src/api.py", source)` and assert the full existing `ParsedModule` schema and value-free syntax diagnostics. Delete or mutate the backing fixture before parsing and prove the captured source still determines the result. For `analyzeCapturedSources`, assert deterministic order, unsupported extension skipping, safe skipping of a registered parser without `parseSource()`, per-file safe warning behavior, and `filePath` exactly equal to the provided repository-relative POSIX path.

- [ ] **Step 2: Run parser/analyzer tests and verify RED**

Run:

```bash
npm test -- tests/unit/parsers/typescript.test.ts tests/unit/parsers/python.test.ts tests/unit/core/analyzer.test.ts --runInBand
```

Expected: FAIL because `parseSource()` and `analyzeCapturedSources()` do not exist.

- [ ] **Step 3: Refactor TypeScript AST extraction around captured source**

Create an in-memory `ts-morph` project/source file for `parseSource()`, run the same syntactic diagnostics, and route both filesystem `parse()` and in-memory parsing through one private `ParsedModule` extraction function. Preserve the shared-project optimization for ordinary `parse()` and keep `snapshot()` fingerprints unchanged.

- [ ] **Step 4: Refactor Python AST extraction around stdin source**

Refactor the Python helper into `analyze_source(filepath, source)`, keep `analyze_file(filepath)` as the filesystem wrapper, and add a `module-source` operation that passes `sys.stdin.read()` to `analyze_source`. Route `parseSource()` through that operation and retain the exact output validator/mappers and safe error classification used by `parse()`.

- [ ] **Step 5: Implement captured-source analyzer**

Sort copied `{displayPath, content}` records, select parsers by display path, call only an available `parseSource()`, and never use the global path-keyed filesystem cache. Keep `analyzeCodebase()` unchanged for non-MCP CLI callers.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/parsers/typescript.test.ts tests/unit/parsers/python.test.ts tests/unit/core/analyzer.test.ts --runInBand
npx tsc --noEmit
npx eslint src/core/analyzer.ts src/parsers/types.ts src/parsers/typescript.ts src/parsers/python.ts tests/unit/core/analyzer.test.ts tests/unit/parsers/typescript.test.ts tests/unit/parsers/python.test.ts
```

Expected: exit 0; ordinary file-based parser tests and AST-first behavior remain unchanged.

- [ ] **Step 7: Commit in-memory parsing**

```bash
git add src/core/analyzer.ts src/parsers/types.ts src/parsers/typescript.ts src/parsers/python.ts tests/unit/core/analyzer.test.ts tests/unit/parsers/typescript.test.ts tests/unit/parsers/python.test.ts
git commit -m "feat(core): parse authorized source snapshots"
```

### Task 4: Inject Safe Planning Configuration into Provider-Free MCP

**Files:**

- Modify: `src/impact/planner.ts`
- Modify: `src/mcp/update-workflow.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/unit/impact/planner.test.ts`
- Modify: `tests/unit/mcp/impact-plan.test.ts`
- Modify: `tests/unit/mcp/update-workflow.test.ts`

**Interfaces:**

- Consumes: `MCPRepositoryReadScope` and `MCPScopedConfigLoader` from Tasks 1-2.
- Changes `ImpactPlanOptions` by adding:

```ts
readonly planningConfig?: Readonly<PlanningConfig>;
```

- Produces the final per-server context and signatures:

```ts
export interface MCPServerContext {
  readonly serverCwd: string;
  readonly scope: MCPRepositoryReadScope;
  readonly configLoader: MCPScopedConfigLoader;
  readonly updateWorkflow: MCPUpdateWorkflowContext;
}

export async function createMCPServerContext(
  serverCwd?: string,
  hostEnvironment?: Readonly<NodeJS.ProcessEnv>,
): Promise<MCPServerContext>;

export async function handleToolCall(
  name: string,
  args: unknown,
  contextOrCwd?: MCPServerContext | string,
  legacyWorkflowContext?: MCPUpdateWorkflowContext,
): Promise<unknown>;

export async function createMCPServer(
  serverCwd?: string,
  hostEnvironment?: Readonly<NodeJS.ProcessEnv>,
): Promise<Server>;
```

- `MCPUpdateWorkflowContext` receives `loadPlanningConfig(): Promise<Readonly<PlanningConfig>>`; prepare and validate request a fresh immutable config through the same pinned loader. `startMCPServer()` awaits `createMCPServer()` before connecting stdio.
- The string overload remains for existing direct unit consumers and opens a fresh scope; its optional legacy workflow context preserves current prepare/validate tests. Production `createMCPServer()` always passes one shared `MCPServerContext` and never uses the fallback codec.

- [ ] **Step 1: Write failing planning/wiring tests**

Update MCP tests to build one `MCPServerContext` per Git fixture and pass it to every direct `handleToolCall()`. Update the planner spy expectation to include an injected `planningConfig`. Assert ordinary CLI/provider loaders and provider factory remain uncalled. Add cases where an unsafe executable/symlink config yields `MCP_UNSAFE_CONFIGURATION` before `GitSnapshotReader.read()`/AST work. Prepare once, change the safe config so the effective plan digest changes, then assert validation rejects the stale preparation; replace config with an unsafe artifact and assert safe configuration failure before planning.

- [ ] **Step 2: Run planning tests and verify RED**

Run:

```bash
npm test -- tests/unit/impact/planner.test.ts tests/unit/mcp/impact-plan.test.ts tests/unit/mcp/update-workflow.test.ts --runInBand
```

Expected: FAIL because `createImpactPlan()` ignores injected config and the per-server workflow context does not own the scope/loader.

- [ ] **Step 3: Add immutable planning override**

When `options.planningConfig` is provided, validate/copy it, apply a valid request `maxContextBytes` override after that copy, and skip `loadPlanningConfig()`. Preserve override bounds and all existing `PlanFailure` mapping. Without it, retain the current CLI path byte-for-byte in behavior.

- [ ] **Step 4: Wire all provider-free tools through one scope**

Make `createMCPServerContext()` await one `MCPRepositoryReadScope.open(serverCwd)`, construct one loader from a copied host environment, and create one per-server preparation-token codec. For plan, call `configLoader.loadPlanning(scope.rootDirectory())` and then `createImpactPlan({cwd: serverCwd, planningConfig, ...})`. For prepare/validate, refresh the same safe root planning config and inject it into both planning calls. Preserve HMAC token lifetime, Trust privacy floor, target digest checks, structured output, no provider construction, and no writes.

Do not route the provider-free planner or `RepositoryWriteScope` target preparation through the new legacy read APIs: their existing implementations already pin Git/source/document targets to `serverCwd` and are exercised by their established no-write/symlink/stale tests. In this task the shared MCP scope supplies their startup-worktree identity and closes only their remaining unbounded configuration search. Add a context test proving their `cwd` equals the scope's startup worktree while the ordinary CLI config loader remains uncalled.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/impact/planner.test.ts tests/unit/mcp/impact-plan.test.ts tests/unit/mcp/update-workflow.test.ts --runInBand
npx tsc --noEmit
npx eslint src/impact/planner.ts src/mcp/update-workflow.ts src/mcp/server.ts tests/unit/impact/planner.test.ts tests/unit/mcp/impact-plan.test.ts tests/unit/mcp/update-workflow.test.ts
```

Expected: exit 0 and all provider-free no-write/provider-construction spies remain zero.

- [ ] **Step 6: Commit provider-free scope wiring**

```bash
git add src/impact/planner.ts src/mcp/update-workflow.ts src/mcp/server.ts tests/unit/impact/planner.test.ts tests/unit/mcp/impact-plan.test.ts tests/unit/mcp/update-workflow.test.ts
git commit -m "fix(mcp): scope provider-free planning config"
```

### Task 5: Route Legacy MCP Analysis, Generation, and Freshness Through the Scope

**Files:**

- Modify: `src/mcp/server.ts`
- Create: `src/mcp/scoped-freshness.ts`
- Modify: `src/core/freshness.ts`
- Create: `tests/unit/mcp/repository-scope-wiring.test.ts`
- Create: `tests/unit/mcp/scoped-freshness.test.ts`
- Modify: `tests/unit/mcp/security.test.ts`
- Modify: `tests/unit/mcp/serialization.test.ts`
- Modify: `tests/unit/mcp/parser-diagnostics.test.ts`
- Modify: `tests/unit/core/freshness.test.ts`

**Interfaces:**

- Consumes: all Task 1-4 interfaces.
- Produces an authentic fixed legacy-generation failure:

```ts
export class MCPLegacyGenerationError extends Error {
  readonly code = "MCP_GENERATION_FAILED" as const;
  static read(
    error: unknown,
  ): { readonly code: string; readonly message: string } | undefined;
}
```

- `formatMCPError()` emits `MCP_GENERATION_FAILED: The MCP documentation generation request failed.` only for this authentic wrapper. The handler may pass through authentic scope/config and `PlanFailure` errors. `ProviderConfigurationError` is first reconstructed from its exact known code into a fresh fixed built-in error; existing authentic Trust classes are passed only when their fixed code/message can be recognized without reading attacker-controlled state. Every otherwise unknown provider factory/transport/generator failure is replaced with the wrapper and its original object is not retained as `cause`. Add these cases to this task's focused error table and do not widen the generic property-based allowlist.
- Produces:

```ts
export async function checkMCPDocumentationFreshness(input: {
  readonly scope: MCPRepositoryReadScope;
  readonly directory: AuthorizedMCPDirectory;
  readonly docFile: unknown;
  readonly since: unknown;
  readonly to?: string;
}): Promise<FreshnessReport>;
```

- `src/core/freshness.ts` exports its normalized `isDocumentationSourcePath()` predicate and existing `assessDocumentationFreshness()`; its filesystem-based `checkDocumentationFreshness()` remains behaviorally unchanged.

- [ ] **Step 1: Write failing legacy wiring and ordering tests**

Build a temp Git fixture and assert all five legacy schemas use `additionalProperties:false` and describe “Path within the Git worktree where this MCP server started (absolute or repository-relative).” Add root/relative subdirectory success and exact legacy response fields. Assert `analyze_codebase.modules[].filePath === "src/index.ts"` and no JSON/provider prompt contains either the canonical or lexical root. Call `handleToolCall()` directly with an extra string key, a symbol key, inherited/accessor fields, and hostile proxies; prove runtime rejection happens before authorization and no getter executes.

For external/traversal/symlink/unsafe glob/doc/config inputs, spy on scoped config, package metadata, enumeration, Git, parser/cache, provider factory, provider transport, generator, and write helpers; all must be zero after the first denial point. For README, assert malformed/symlinked metadata prevents enumeration/parser/provider selection/factory/transport. Seed unknown custom-provider factory, transport, and generator messages with an absolute path/key and prove each becomes the single fixed authentic `MCP_GENERATION_FAILED` message; forged/mutated generation errors remain unknown.

- [ ] **Step 2: Run legacy MCP tests and verify RED**

Run:

```bash
npm test -- tests/unit/mcp/repository-scope-wiring.test.ts tests/unit/mcp/scoped-freshness.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/serialization.test.ts tests/unit/mcp/parser-diagnostics.test.ts tests/unit/core/freshness.test.ts --runInBand
```

Expected: FAIL because legacy handlers still cast arbitrary `directory`, invoke CLI loaders/glob/path parsers, and emit absolute paths.

- [ ] **Step 3: Wire analyze and generation tools**

Before authorization, copy each route's arguments through `readExactMCPRecord()` with its exact allowed-key set. Authorize the directory next. For `analyze_codebase`, call `parseOptionalGlobList()` before configuration loading so a hostile caller value fails first; load scoped planning configuration; validate its include/exclude arrays; then choose the caller list when present and the configured list otherwise. For each generation tool, load scoped provider settings and, for README only, scoped metadata before enumeration or provider work; validate configured globs; enumerate/capture sources; and analyze them in memory.

Only after analysis, resolve the provider noninteractively through `resolveProviderSelection({config, env: effectiveEnvironment, interactive:false})`, where the immutable effective environment is the same host-plus-root-`.env` snapshot used to project `config`; the five-key credential subset remains the only environment data passed to the registry. Treat `null` as the existing fixed selection failure, clone its accepted provider/model/endpoint/Qwen metadata, and pass that snapshot plus `credentialEnvironment: credentials` into `createProvider()`. This keeps endpoint approval, Qwen region binding, explicit Ollama model requirements, no-fallback behavior, and cross-provider credential isolation. Keep Trust Gate `{origin:"mcp"}` and all existing response formats. At the legacy generation boundary, pass through only authentic scope/config/plan failures, reconstruct recognized provider-configuration failures from their exact code into fresh fixed built-in errors, pass only recognizable authentic fixed Trust classes, and replace every other failure with a fresh `MCPLegacyGenerationError`.

- [ ] **Step 4: Wire freshness with authorized captured reads**

Validate `doc_file` and `since` before Git. Use `scope.changedFiles()` so Git results are validated, repository-relative, and filtered to the authorized subdirectory. Resolve the documentation snapshot through that directory; read changed sources from `scope.rootDirectory()` by their already-validated repository-relative paths and call only `parseSource()`. A safely missing/deleted changed source remains a genuinely operational `unknown` result, while a symlink or containment failure remains a policy error. Pass root-relative target/change/source paths to `assessDocumentationFreshness()`. Re-throw authentic scope policy errors instead of converting them to `{status:"unknown"}`; preserve safe `missing`, `clean`, `co-changed`, `stale`, and genuinely operational/parser `unknown` behavior.

- [ ] **Step 5: Migrate affected unit fixtures**

Initialize serialization/security fixtures as Git worktrees, pass their root as `serverCwd`, and exclude `.git` from no-write snapshots. Pass the existing parser-diagnostics Git root as server cwd. Replace direct mocks of `loadProviderConfig()` with the scoped-config boundary. Keep invalid provider-output and raw-diagnostic leak regressions.

- [ ] **Step 6: Run aggregate MCP tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/mcp --runInBand
npm test -- tests/unit/core/freshness.test.ts tests/unit/core/analyzer.test.ts --runInBand
npm test -- tests/unit/providers --runInBand
npx tsc --noEmit
```

Expected: all exit 0; provider contracts remain green and no paid/live provider call occurs.

- [ ] **Step 7: Commit legacy MCP routing**

```bash
git add src/mcp/server.ts src/mcp/scoped-freshness.ts src/core/freshness.ts tests/unit/mcp/repository-scope-wiring.test.ts tests/unit/mcp/scoped-freshness.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/serialization.test.ts tests/unit/mcp/parser-diagnostics.test.ts tests/unit/core/freshness.test.ts
git commit -m "fix(mcp): contain legacy project reads"
```

### Task 6: Prove Built and Packed MCP Isolation

**Files:**

- Modify: `tests/e2e/mcp-smoke.mjs`
- Modify: `tests/e2e/smoke-tarball.mjs`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

**Interfaces:**

- Consumes compiled `dist/mcp/repository-scope.js`, `dist/mcp/scoped-config.js`, `dist/mcp/scoped-freshness.js`, the existing MCP stdio protocol, and `snapshotRepositoryTree()` from `scripts/hybrid-beta-snapshot.mjs`.
- Produces an e2e A/B isolation oracle used for both built source and installed tarball CLIs.

- [ ] **Step 1: Write the failing packed-artifact and A/B smoke assertions**

Create Git repositories A and B. Put a tracked unique sentinel only in B. Put a safe source and README in A plus an in-repo symlink to B. For both `dist/cli/index.js` and the installed tarball CLI, start MCP with cwd A and assert:

```js
// allowed
directory: ".";
directory: "src";

// denied
directory: absoluteRepoB;
directory: "linked-external";
```

Denied calls must return exactly one `MCP_DIRECTORY_DENIED` prefix, omit both absolute roots and the sentinel, and leave complete A/B tree snapshots unchanged. Analyze success must return only `src/index.ts`-style paths. Add `dist/mcp/repository-scope.js`, `dist/mcp/scoped-config.js`, and `dist/mcp/scoped-freshness.js` to `assertPackedMcpArtifacts()` and public preflight artifact sets.

- [ ] **Step 2: Run process/package tests and verify RED**

Run:

```bash
npm run build
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 NPM_CONFIG_OFFLINE=true npm run test:mcp
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 NPM_CONFIG_OFFLINE=true npm run test:package
node --test tests/e2e/public-beta-preflight.test.mjs
```

Expected before fixture migration: MCP smoke fails because it still analyzes repository-external `tests/fixtures`; artifact assertions fail for new files.

- [ ] **Step 3: Migrate the current MCP smoke fixture**

Move the analyzed source into A and call `directory:"src"`. Replace external hostile `.aidocrc.cjs` fixtures with one in-repository executable config whose body would write a marker and expose a seeded fake key if executed. Expect exact `MCP_UNSAFE_CONFIGURATION`, marker absent, and path/key absent. Keep hostile formatter-object behavior in unit tests rather than executing config in e2e.

- [ ] **Step 4: Add built + packed isolation helper and artifact coverage**

Run the identical repository-scope round trip against built and packed CLIs. Reuse `snapshotRepositoryTree()` so no-write evidence covers recursive tracked/untracked content, empty directories, type/mode/symlink state without following links, and current HEAD. Update compiled artifact allowlists and their fixture sets.

- [ ] **Step 5: Run process/package tests and verify GREEN**

Run:

```bash
npm run build
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 NPM_CONFIG_OFFLINE=true npm run test:mcp
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 NPM_CONFIG_OFFLINE=true npm run test:package
node --test tests/e2e/public-beta-preflight.test.mjs
```

Expected: all exit 0 with no network/provider request and no A/B mutation.

- [ ] **Step 6: Commit package evidence**

```bash
git add tests/e2e/mcp-smoke.mjs tests/e2e/smoke-tarball.mjs scripts/public-beta-preflight.mjs tests/e2e/public-beta-preflight.test.mjs
git commit -m "test(mcp): prove packed repository isolation"
```

### Task 7: Publish Truthful Repository-Scope UX

**Files:**

- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `docs/PUBLIC_BETA.md`
- Modify: `docs/integrations/codex.md`
- Modify: `docs/integrations/claude.md`
- Modify: `docs/releases/v0.2.0-beta.3.md`
- Modify: `integrations/codex/aidoc/skills/maintain-documentation/SKILL.md`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `tests/e2e/codex-plugin-smoke.mjs`

**Interfaces:**

- Consumes the final executable behavior from Tasks 1-6.
- Produces one consistent public claim: one MCP server is pinned to its startup Git worktree; root/real subdirectories are allowed, external/traversal/`.git`/symlink paths are denied before reads; successful paths are relative; MCP uses declarative project config only; this is not an OS sandbox.

- [ ] **Step 1: Write failing documentation/plugin assertions**

Extend the release corpus test to require startup-worktree scope, one-server-per-repository UX, relative result paths, declarative-only MCP config, executable-config refusal, CLI config unchanged, and the hard-link/race/OS-sandbox limit. Add a negative assertion that the old phrase “MCP directory allowlisting ... unimplemented” is absent. Extend plugin smoke to require the skill to stop on `MCP_INVALID_PATH_INPUT`, `MCP_DIRECTORY_DENIED`, or `MCP_UNSAFE_CONFIGURATION` and never retry another directory.

- [ ] **Step 2: Run docs/plugin tests and verify RED**

Run:

```bash
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
node tests/e2e/codex-plugin-smoke.mjs
```

Expected: FAIL because public docs still say MCP directory allowlisting is unimplemented and the skill lacks the scope-error stop rule.

- [ ] **Step 3: Update all public documentation consistently**

Replace only outdated boundary claims. Keep subscription/API separation, provider-free vs legacy provider-backed distinction, Trust privacy floor, Qwen/Ollama/no-fallback rules, source-checkout status, and no-publication truth unchanged. Move MCP directory scope from planned to implemented in `ROADMAP.md`. State that executable project config is deliberately rejected by MCP while direct CLI keeps its existing cosmiconfig behavior.

- [ ] **Step 4: Update the bundled skill fail-closed rule**

Add concise instructions: use only the repository where MCP started; on any of the three scope/config codes, stop, explain that the host must start AiDoc in the intended Git worktree, and never try another absolute path. Preserve its prohibition on `generate_readme`, `generate_api_docs`, and `generate_diagram`.

- [ ] **Step 5: Run docs/plugin/public-beta tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
node tests/e2e/codex-plugin-smoke.mjs
node --test tests/e2e/public-beta-preflight.test.mjs
```

Expected: all exit 0; no document claims marketplace/npm publication or subscription-to-API bridging.

- [ ] **Step 6: Commit truthful UX**

```bash
git add README.md ROADMAP.md docs/PUBLIC_BETA.md docs/integrations/codex.md docs/integrations/claude.md docs/releases/v0.2.0-beta.3.md integrations/codex/aidoc/skills/maintain-documentation/SKILL.md tests/unit/release/public-beta-config.test.ts tests/e2e/codex-plugin-smoke.mjs
git commit -m "docs(mcp): document pinned repository scope"
```

### Task 8: Full Security and Release Acceptance

**Files:**

- Modify only files already owned by Tasks 1-7 when a failing gate demonstrates a regression caused by this feature.
- Do not change history, release version, package scripts, provider defaults, plugin manifest, or accepted private-path policy to make a gate green.

**Interfaces:**

- Consumes the complete implementation.
- Produces fresh acceptance evidence tied to the final commit.

- [ ] **Step 1: Run focused security and type/style gates**

Run:

```bash
npm test -- tests/unit/mcp tests/unit/core/analyzer.test.ts tests/unit/core/freshness.test.ts tests/unit/config tests/unit/providers --runInBand
npx tsc --noEmit
npx eslint src/mcp src/core/analyzer.ts src/core/freshness.ts src/config src/providers/registry.ts src/parsers/types.ts src/parsers/typescript.ts src/parsers/python.ts tests/unit/mcp tests/unit/core/analyzer.test.ts tests/unit/core/freshness.test.ts tests/unit/config tests/unit/providers
npx prettier --check src/mcp src/core/analyzer.ts src/core/freshness.ts src/config src/providers/registry.ts src/parsers/types.ts src/parsers/typescript.ts src/parsers/python.ts tests/unit/mcp tests/unit/core/analyzer.test.ts tests/unit/core/freshness.test.ts tests/unit/config tests/unit/providers tests/e2e/mcp-smoke.mjs tests/e2e/smoke-tarball.mjs scripts/public-beta-preflight.mjs README.md ROADMAP.md docs/PUBLIC_BETA.md docs/integrations/codex.md docs/integrations/claude.md docs/releases/v0.2.0-beta.3.md integrations/codex/aidoc/skills/maintain-documentation/SKILL.md
git diff --check
```

Expected: all exit 0.

- [ ] **Step 2: Run complete offline release verification**

Run:

```bash
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 NPM_CONFIG_OFFLINE=true npm run verify:release
npm run test:public-beta
```

Expected: all release, package, Action, provider, MCP, plugin, and hybrid tests pass. No live or paid provider call occurs.

- [ ] **Step 3: Run final public preflight and classify only known policy output**

Run:

```bash
node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD
```

Expected: every new source-artifact/repository-scope check passes. The previously accepted retained-history private-needle path may remain the only failure; do not rewrite history.

- [ ] **Step 4: Re-run direct leak/no-write probes**

Run built and packed MCP A/B probes once more and scan their serialized output for both temporary absolute roots, seeded sentinel, fake provider key, raw config source, and stack markers. Expected forbidden count: 0. Verify `git status --short` is clean, except for a bounded Task 8 correction that is about to be committed.

- [ ] **Step 5: Commit any bounded gate corrections**

If and only if Tasks 8.1-8.4 required an in-scope correction:

```bash
git add src/mcp/repository-scope.ts src/mcp/scoped-config.ts src/mcp/scoped-freshness.ts src/mcp/server.ts src/mcp/update-workflow.ts src/config/planning.ts src/config/loader.ts src/providers/registry.ts src/parsers/types.ts src/parsers/typescript.ts src/parsers/python.ts src/core/analyzer.ts src/core/freshness.ts src/impact/planner.ts tests/unit/mcp tests/unit/config tests/unit/providers tests/unit/parsers/typescript.test.ts tests/unit/parsers/python.test.ts tests/unit/core/analyzer.test.ts tests/unit/core/freshness.test.ts tests/unit/impact/planner.test.ts tests/e2e/mcp-smoke.mjs tests/e2e/smoke-tarball.mjs scripts/public-beta-preflight.mjs tests/e2e/public-beta-preflight.test.mjs README.md ROADMAP.md docs/PUBLIC_BETA.md docs/integrations/codex.md docs/integrations/claude.md docs/releases/v0.2.0-beta.3.md integrations/codex/aidoc/skills/maintain-documentation/SKILL.md tests/unit/release/public-beta-config.test.ts tests/e2e/codex-plugin-smoke.mjs
git commit -m "fix(mcp): close repository scope regressions"
```

Otherwise create no empty commit.

- [ ] **Step 6: Record final handoff evidence**

Report the final commit, exact passing commands/counts, the built+packed A/B denial evidence, tree cleanliness, and the known retained-history private-needle policy result. State that hosted Node 22/24 CI remains an external post-push check. Do not merge, push, tag, publish, or install globally until the user chooses the release action.
