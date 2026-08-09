# Release Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a `v0.1.1` release candidate whose templates, CLI configuration, GitHub Action, deterministic AST-backed documentation co-change check, and MCP stdio server work from the distributed package and expose failures honestly.

**Architecture:** Centralize packaged-template and version resolution, then make the CLI expose deterministic non-interactive behavior that the composite Action can call. Replace the bespoke MCP framing with the production-recommended `@modelcontextprotocol/sdk` v1 stdio transport while keeping aidoc tool logic provider-agnostic.

**Tech Stack:** TypeScript 6, Node.js ≥22.12, CommonJS, Jest/ts-jest, Handlebars, Commander, Zod 4, Bash, npm package lifecycle, `@modelcontextprotocol/sdk` v1.

## Global Constraints

- Declare the runtime floor as Node.js `>=22.12.0`, matching the current
  production dependency floor, and run the full suite on supported Node 22 and
  24 lines. Do not claim that CI pins the exact minimum: current lint tooling
  itself requires a later 22.x patch. Do not preserve the false `>=18.0.0`
  claim or migrate the project to ESM in this release.
- Use `@modelcontextprotocol/sdk` v1.x, which remains the production recommendation while v2 is beta.
- Keep AST extraction deterministic and ahead of every LLM operation.
- Access LLMs only through the existing `LLMProvider` interface.
- Keep prompt text in `src/templates/`; do not add inline generation prompts.
- Write a failing test and observe the expected failure before each production change.
- Use fake credentials and seeded fake secrets in tests; never read or print the credential in local Git configuration.
- Do not push, tag, publish, or open remote pull requests until the maintainer rotates the Git remote credential.
- Keep `--mock` available for explicit local tests, but never select it implicitly in a production Action path.
- Do not add Trust Gate, semantic AST diff, or ProofGraph behavior in this plan.

---

## File Structure

### New files

- `src/core/templates.ts` — validates and resolves the template directory shared by CLI and MCP.
- `src/core/package-meta.ts` — reads the installed package version without a second hardcoded version.
- `src/core/freshness.ts` — deterministic AST-backed document co-change assessment.
- `src/cli/commands/check.ts` — `aidoc check` CLI command and machine-readable exit behavior.
- `scripts/clean-dist.mjs` — removes stale build output before TypeScript compilation.
- `scripts/copy-templates.mjs` — copies required `.hbs` files to `dist/templates`.
- `action.yml` — repository-root composite Action entrypoint used by
  `mr-min-max/aidoc@<ref>`.
- `action/run.sh` — testable implementation of composite Action generate/check behavior.
- `tests/unit/core/templates.test.ts` — template resolver tests.
- `tests/unit/core/package-meta.test.ts` — installed-version resolution tests.
- `tests/unit/core/freshness.test.ts` — deterministic co-change rules.
- `tests/unit/cli/check.test.ts` — JSON output and exit-code contract.
- `tests/e2e/check-cli-smoke.mjs` — real Commander/stdout/exit-code contract in a fixture Git repo.
- `tests/unit/cli/commands.test.ts` — non-interactive command-option contract.
- `tests/unit/config/environment.test.ts` — Action environment override contract.
- `tests/unit/action/runner.test.ts` — Action failure propagation and argument tests.
- `tests/e2e/package-smoke.mjs` — installs the generated tarball and renders a real template.
- `tests/e2e/mcp-smoke.mjs` — connects through the official MCP client over stdio.
- `CHANGELOG.md` — factual unreleased record for the `v0.1.1` candidate.

### Modified files

- `package.json` / `package-lock.json` — scripts, package contents, SDK dependency, and patch version.
- `.github/workflows/ci.yml` — test supported Node.js 22 and 24 releases
  instead of EOL/incompatible 18 and 20.
- `.github/workflows/release.yml` — verify tag/version parity and publish the
  exact tarball that passed release checks.
- `src/cli/context.ts` — use the shared template resolver.
- `src/config/schema.ts` — leave provider-specific model defaults to providers.
- `src/config/loader.ts` — apply validated `AIDOC_*` environment overrides.
- `src/cli/index.ts` — quiet dotenv, register `check`, and use the installed package version.
- `src/cli/commands/readme.ts` — accept strict non-interactive writes.
- `src/cli/commands/api.ts` — accept strict non-interactive writes.
- `src/cli/commands/changelog.ts` — accept strict non-interactive writes.
- `src/cli/commands/diagram.ts` — accept strict non-interactive writes.
- `src/mcp/server.ts` — use shared resolvers, freshness core, and official MCP stdio transport.
- `action/action.yml` — move the misplaced entrypoint to repository-root
  `action.yml`, pass inputs to the testable runner, and stop masking push
  failures.
- `README.md` — document real Action/check behavior.
- `ROADMAP.md` — distinguish the `v0.1.1` release candidate from shipped and
  later security features.

---

### Task 1: Ship and verify Handlebars templates

**Files:**

- Create: `src/core/templates.ts`
- Create: `scripts/clean-dist.mjs`
- Create: `scripts/copy-templates.mjs`
- Create: `tests/unit/core/templates.test.ts`
- Create: `tests/e2e/package-smoke.mjs`
- Modify: `src/cli/context.ts:1-72`
- Modify: `src/cli/index.ts:1-18`
- Modify: `package.json:9-20,52-55`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: `REQUIRED_TEMPLATE_NAMES: readonly string[]`
- Produces: `resolveTemplatesDir(moduleDir?: string): string`
- Consumes: `Generator(provider, templatesDir)` without changing `Generator`

- [ ] **Step 1: Write the failing resolver tests**

Create `tests/unit/core/templates.test.ts`:

```ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  REQUIRED_TEMPLATE_NAMES,
  resolveTemplatesDir,
} from "../../../src/core/templates";

describe("resolveTemplatesDir", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-templates-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns the sibling templates directory when every template exists", () => {
    const moduleDir = path.join(root, "core");
    const templatesDir = path.join(root, "templates");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });
    for (const name of REQUIRED_TEMPLATE_NAMES) {
      fs.writeFileSync(path.join(templatesDir, `${name}.hbs`), name);
    }

    expect(resolveTemplatesDir(moduleDir)).toBe(templatesDir);
  });

  it("fails with the missing template names before provider invocation", () => {
    const moduleDir = path.join(root, "core");
    const templatesDir = path.join(root, "templates");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, "readme.hbs"), "readme");

    expect(() => resolveTemplatesDir(moduleDir)).toThrow(
      /Packaged templates are incomplete/,
    );
    expect(() => resolveTemplatesDir(moduleDir)).toThrow(/api-doc/);
  });
});
```

- [ ] **Step 2: Run the resolver test and verify RED**

Run:

```bash
npx jest tests/unit/core/templates.test.ts --runInBand
```

Expected: FAIL because `src/core/templates.ts` does not exist.

- [ ] **Step 3: Implement the template resolver**

Create `src/core/templates.ts`:

```ts
import * as fs from "fs";
import * as path from "path";

export const REQUIRED_TEMPLATE_NAMES = [
  "api-doc",
  "changelog",
  "diagram",
  "jsdoc",
  "readme",
  "score",
  "update",
] as const;

export function resolveTemplatesDir(moduleDir = __dirname): string {
  const templatesDir = path.resolve(moduleDir, "../templates");
  const missing = REQUIRED_TEMPLATE_NAMES.filter(
    (name) => !fs.existsSync(path.join(templatesDir, `${name}.hbs`)),
  );

  if (missing.length > 0) {
    throw new Error(
      `Packaged templates are incomplete at ${templatesDir}. Missing: ${missing.join(", ")}`,
    );
  }

  return templatesDir;
}
```

Modify `src/cli/context.ts`:

```ts
import { resolveTemplatesDir } from "../core/templates";
```

Replace the real `Generator` construction with:

```ts
new Generator(createProvider(config), resolveTemplatesDir());
```

- [ ] **Step 4: Run the resolver and existing context tests and verify GREEN**

Run:

```bash
npx jest tests/unit/core/templates.test.ts tests/unit/cli/context.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Write the failing tarball smoke test**

Create `tests/e2e/package-smoke.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = mkdtempSync(join(tmpdir(), "aidoc-package-smoke-"));

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", root],
    { cwd: resolve("."), encoding: "utf8" },
  );
  const [{ filename }] = JSON.parse(packOutput);
  const tarball = join(root, filename);
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "aidoc-smoke-consumer", private: true }),
  );
  execFileSync("npm", ["install", "--ignore-scripts", tarball], {
    cwd: consumer,
    stdio: "pipe",
  });

  const packageRoot = join(consumer, "node_modules", "aidoc-gen");
  const require = createRequire(import.meta.url);
  const { resolveTemplatesDir } = require(
    join(packageRoot, "dist", "core", "templates.js"),
  );
  const { Generator } = require(
    join(packageRoot, "dist", "core", "generator.js"),
  );

  const provider = {
    name: "package-smoke",
    async generate(prompt) {
      return prompt;
    },
  };
  const generator = new Generator(provider, resolveTemplatesDir());
  const rendered = await generator.generateReadme({
    projectName: "package-smoke",
    description: "packed artifact",
    modules: [],
    dependencies: [],
    badges: false,
    tableOfContents: false,
    installSection: false,
    usageExamples: false,
  });

  assert.match(rendered, /PROJECT INFO:/);
  assert.match(rendered, /package-smoke/);
  const packedPackage = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(packedPackage.name, "aidoc-gen");
  const packedCli = join(packageRoot, "dist", "cli", "index.js");
  const cliVersion = execFileSync(process.execPath, [packedCli, "--version"], {
    cwd: consumer,
    encoding: "utf8",
  }).trim();
  assert.equal(cliVersion, packedPackage.version);
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

Create `scripts/clean-dist.mjs` now so the RED run cannot accidentally consume
stale templates from an earlier build:

```js
import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve("dist"), { recursive: true, force: true });
```

- [ ] **Step 6: Run the package smoke and verify RED**

Run:

```bash
node scripts/clean-dist.mjs
npm run build
node tests/e2e/package-smoke.mjs
```

Expected: the build succeeds, then the smoke test FAILS because the installed
tarball has `dist/core/templates.js` but no
`dist/templates/*.hbs`; the resolver reports that the packaged templates are
incomplete. Verify that the failure contains
`Packaged templates are incomplete`; a missing compiled module is not the
intended RED. This reproduces the previously observed installed-package failure
without contacting an LLM provider.

- [ ] **Step 7: Add the deterministic template copy script**

Create `scripts/copy-templates.mjs`:

```js
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const source = resolve("src/templates");
const destination = resolve("dist/templates");
const require = createRequire(import.meta.url);
const { REQUIRED_TEMPLATE_NAMES } = require(
  resolve("dist/core/templates.js"),
);
const required = REQUIRED_TEMPLATE_NAMES.map((name) => `${name}.hbs`);

const sourceFiles = new Set(readdirSync(source));
const missing = required.filter((name) => !sourceFiles.has(name));
if (missing.length > 0) {
  throw new Error(`Cannot build aidoc: missing templates: ${missing.join(", ")}`);
}

if (existsSync(destination)) {
  rmSync(destination, { recursive: true, force: true });
}
mkdirSync(destination, { recursive: true });
for (const name of required) {
  cpSync(resolve(source, name), resolve(destination, name));
}
```

Change the relevant `package.json` entries to:

```json
{
  "scripts": {
    "build": "node scripts/clean-dist.mjs && tsc && node scripts/copy-templates.mjs",
    "test:package": "node tests/e2e/package-smoke.mjs",
    "prepack": "npm run build",
    "prepublishOnly": "npm run lint && npm test -- --runInBand"
  },
  "files": ["dist/"]
}
```

Preserve every unrelated existing script.

In `src/cli/index.ts`, make dotenv initialization quiet:

```ts
dotenv.config({ quiet: true });
```

The packed `--version` assertion must see only the version line; dotenv
diagnostics on stdout would corrupt both CLI automation and MCP framing.

- [ ] **Step 8: Verify the packed artifact**

Run:

```bash
npm run build
npm run test:package
```

Expected: PASS without making an external LLM request.

- [ ] **Step 9: Commit package integrity**

```bash
git add package.json package-lock.json scripts/clean-dist.mjs \
  scripts/copy-templates.mjs \
  src/core/templates.ts src/cli/context.ts src/cli/index.ts \
  tests/unit/core/templates.test.ts tests/e2e/package-smoke.mjs
git commit -m "fix(package): ship templates with the compiled CLI"
```

---

### Task 2: Make CLI configuration explicit and non-interactive

**Files:**

- Create: `tests/unit/config/environment.test.ts`
- Create: `tests/unit/cli/commands.test.ts`
- Modify: `tests/unit/config/loader.test.ts`
- Modify: `src/config/schema.ts:1-37`
- Modify: `src/config/loader.ts:1-20`
- Modify: `src/cli/context.ts:16-19`
- Modify: `src/cli/commands/readme.ts:8-72`
- Modify: `src/cli/commands/api.ts:8-36`
- Modify: `src/cli/commands/changelog.ts:9-53`
- Modify: `src/cli/commands/diagram.ts:8-37`

**Interfaces:**

- Produces: `loadConfig(searchFrom?: string, env?: NodeJS.ProcessEnv): AidocConfig`
- Produces: `CommandOptions.yes?: boolean`
- Produces: `toWriteDocOptions(options, label)`
- Produces: `hasGenerationInput(condition, options, message)`
- Consumes: existing `writeDoc(..., { auto })`

- [ ] **Step 1: Write failing environment precedence and project-root tests**

Create `tests/unit/config/environment.test.ts`:

```ts
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
```

Append to `tests/unit/cli/context.test.ts`:

```ts
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

it("rejects invalid Markdown before writing in strict-output mode", async () => {
  const target = path.join(os.tmpdir(), `aidoc-strict-${Date.now()}.md`);
  await expect(
    writeDoc(target, "not a Markdown document", { strict: true }),
  ).rejects.toThrow(/failed validation/i);
  expect(fs.existsSync(target)).toBe(false);
});
```

- [ ] **Step 2: Run configuration boundary tests and verify RED**

Run:

```bash
npx jest tests/unit/config/environment.test.ts tests/unit/cli/context.test.ts --runInBand
```

Expected: FAIL because `loadConfig` accepts only one argument and ignores
`AIDOC_PROVIDER`, `AIDOC_MODEL`, and `AIDOC_OLLAMA_HOST`, while
`loadCommandContext` ignores its explicit project directory when finding
configuration and `writeDoc` does not enforce strict validation.

- [ ] **Step 3: Implement validated environment overrides**

In `src/config/schema.ts`, stop applying the OpenAI model to every provider:

```ts
model: z.string().min(1).optional(),
```

Update `tests/unit/config/loader.test.ts` so the empty configuration expects
`model` to be undefined. The OpenAI, Anthropic, and Ollama constructors already
own their provider-specific defaults and receive `undefined` when no model is
configured.

Replace `src/config/loader.ts` with:

```ts
import { cosmiconfigSync } from "cosmiconfig";
import { ConfigSchema, AidocConfig, defaultConfig } from "./schema";

function environmentConfig(env: NodeJS.ProcessEnv): Partial<AidocConfig> {
  return {
    ...(env.AIDOC_PROVIDER ? { provider: env.AIDOC_PROVIDER } : {}),
    ...(env.AIDOC_MODEL ? { model: env.AIDOC_MODEL } : {}),
    ...(env.AIDOC_OLLAMA_HOST ? { ollamaHost: env.AIDOC_OLLAMA_HOST } : {}),
  };
}

export function loadConfig(
  searchFrom?: string,
  env: NodeJS.ProcessEnv = process.env,
): AidocConfig {
  const explorer = cosmiconfigSync("aidoc");
  const result = searchFrom ? explorer.search(searchFrom) : explorer.search();
  let fileConfig: AidocConfig = defaultConfig;

  if (result && !result.isEmpty) {
    try {
      fileConfig = ConfigSchema.parse({
        ...defaultConfig,
        ...result.config,
      });
    } catch {
      console.warn("⚠️  Invalid aidoc configuration. Using defaults.");
    }
  }

  return ConfigSchema.parse({
    ...fileConfig,
    ...environmentConfig(env),
  });
}

export { defaultConfig, ConfigSchema, AidocConfig };
```

In `src/cli/context.ts`, search configuration from the same project directory
that is being analyzed:

```ts
const config = loadConfig(cwd);
```

This preserves the existing fallback for an invalid configuration file, while
invalid explicit `AIDOC_*` values fail instead of silently selecting a
different provider.

Extend the `writeDoc` option type in `src/cli/context.ts` with
`strict?: boolean`. Destructure both `isValid` and `warnings` from
`validateMarkdown(content)`, then enforce:

```ts
if (opts.strict && !isValid) {
  throw new Error(
    `Generated Markdown failed validation: ${warnings.join("; ")}`,
  );
}
```

Keep warning-only behavior when strict mode is not requested.

- [ ] **Step 4: Run all config tests and verify GREEN**

Run:

```bash
npx jest tests/unit/config/loader.test.ts tests/unit/config/environment.test.ts \
  tests/unit/cli/context.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Write the failing non-interactive option contract**

Create `tests/unit/cli/commands.test.ts`:

```ts
import { readmeCommand } from "../../../src/cli/commands/readme";
import { apiCommand } from "../../../src/cli/commands/api";
import { changelogCommand } from "../../../src/cli/commands/changelog";
import { diagramCommand } from "../../../src/cli/commands/diagram";
import {
  hasGenerationInput,
  toWriteDocOptions,
} from "../../../src/cli/context";
import * as path from "path";
import { Project, SyntaxKind } from "ts-morph";

describe("Action-compatible generation commands", () => {
  it.each([
    ["readme", readmeCommand],
    ["api", apiCommand],
    ["changelog", changelogCommand],
    ["diagram", diagramCommand],
  ])("%s exposes non-interactive strict writes", (_name, command) => {
    expect(command.options.some((option) => option.long === "--yes")).toBe(true);
    expect(
      command.options.some((option) => option.long === "--strict-output"),
    ).toBe(true);
  });

  it("maps CI flags to the existing write boundary", () => {
    expect(
      toWriteDocOptions(
        { yes: true, dryRun: false, strictOutput: true },
        "README.md",
      ),
    ).toEqual({
      auto: true,
      dryRun: false,
      label: "README.md",
      strict: true,
    });
  });

  it("turns missing generation input into a strict CI failure", () => {
    expect(() =>
      hasGenerationInput(
        false,
        { strictOutput: true },
        "No supported source files found",
      ),
    ).toThrow(/No supported source files/);
    expect(
      hasGenerationInput(false, {}, "No supported source files found"),
    ).toBe(false);
  });

  it.each(["readme", "api", "changelog", "diagram"])(
    "%s forwards command flags through the shared write adapter",
    (name) => {
      const project = new Project({
        tsConfigFilePath: path.resolve("tsconfig.json"),
      });
      const source = project.getSourceFileOrThrow(
        path.resolve(`src/cli/commands/${name}.ts`),
      );
      const forwardsOptions = source
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .some(
          (call) =>
            call.getExpression().getText() === "toWriteDocOptions" &&
            call.getArguments()[0]?.getText() === "options",
        );
      expect(forwardsOptions).toBe(true);
      expect(
        source
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(
            (call) =>
              call.getExpression().getText() === "hasGenerationInput",
          ),
      ).toBe(true);
    },
  );
});
```

- [ ] **Step 6: Run the command contract and verify RED**

Run:

```bash
npx jest tests/unit/cli/commands.test.ts --runInBand
```

Expected: FAIL because none of the four commands exposes `--yes` or
`--strict-output`, and the shared adapter does not exist.

- [ ] **Step 7: Add and forward non-interactive strict-write flags**

Add these options to `readme`, `api`, `changelog`, and `diagram`:

```ts
.option("--yes", "Apply generated changes without an interactive prompt")
.option("--strict-output", "Fail instead of writing malformed Markdown")
```

Add `yes?: boolean` and `strictOutput?: boolean` to `CommandOptions` in
`src/cli/context.ts`.

Add the shared adapter:

```ts
export function toWriteDocOptions(
  options: CommandOptions,
  label: string,
): { dryRun?: boolean; auto?: boolean; strict?: boolean; label: string } {
  return {
    dryRun: options.dryRun,
    auto: options.yes,
    label,
    strict: options.strictOutput,
  };
}
```

Add the strict-input boundary:

```ts
export function hasGenerationInput(
  condition: boolean,
  options: CommandOptions,
  message: string,
): boolean {
  if (!condition && options.strictOutput) {
    throw new Error(message);
  }
  return condition;
}
```

Import and use `toWriteDocOptions` in every affected command:

```ts
await writeDoc(
  outputPath,
  content,
  toWriteDocOptions(options, options.output),
);
```

Use `hasGenerationInput` around the existing empty-module checks in `readme`,
`api`, and `diagram`, and around the empty-commit check in `changelog`.
Interactive behavior still warns and returns; `--strict-output` throws into
the existing command error handler, so an Action cannot report “Generated”
when no output was produced.

- [ ] **Step 8: Run CLI and config tests and verify GREEN**

Run:

```bash
npx jest tests/unit/config tests/unit/cli --runInBand
```

Expected: PASS.

- [ ] **Step 9: Commit the Action-facing CLI contract**

```bash
git add src/config/schema.ts src/config/loader.ts src/cli/context.ts \
  src/cli/commands/readme.ts src/cli/commands/api.ts \
  src/cli/commands/changelog.ts src/cli/commands/diagram.ts \
  tests/unit/config/loader.test.ts tests/unit/config/environment.test.ts \
  tests/unit/cli/context.test.ts \
  tests/unit/cli/commands.test.ts
git commit -m "fix(cli): support validated CI configuration"
```

---

### Task 3: Add a deterministic AST-backed documentation co-change check

**Files:**

- Create: `src/core/freshness.ts`
- Create: `src/cli/commands/check.ts`
- Create: `tests/unit/core/freshness.test.ts`
- Create: `tests/unit/cli/check.test.ts`
- Create: `tests/e2e/check-cli-smoke.mjs`
- Modify: `src/cli/index.ts:4-43`
- Modify: `package.json`

**Interfaces:**

- Produces: `DocumentationCheckStatus = "clean" | "co-changed" | "stale" | "missing" | "unknown"`
- Produces: `FreshnessReport`
- Produces: `assessDocumentationFreshness(...)`
- Produces: `collectAstSourceFiles(...)`
- Produces: `checkDocumentationFreshness(...)`
- Produces: `runCheckCommand(...) => Promise<number>`

This command is deliberately a co-change guard, not a semantic correctness
proof. A `co-changed` result means only that the target document changed in the
same Git range as AST-parseable source files. ProofGraph and semantic
base/head comparison remain later milestones.

- [ ] **Step 1: Write the failing freshness rule tests**

Create `tests/unit/core/freshness.test.ts`:

```ts
jest.mock("../../../src/git/history", () => ({
  getChangedFiles: jest.fn(),
}));

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getChangedFiles } from "../../../src/git/history";
import {
  assessDocumentationFreshness,
  checkDocumentationFreshness,
} from "../../../src/core/freshness";

describe("assessDocumentationFreshness", () => {
  it("marks a missing target as missing", () => {
    const report = assessDocumentationFreshness(
      ["src/index.ts"],
      ["src/index.ts"],
      "README.md",
      false,
    );
    expect(report.status).toBe("missing");
  });

  it("marks docs stale when source changed without the target", () => {
    const report = assessDocumentationFreshness(
      ["src/index.ts", "tests/index.test.ts"],
      ["src/index.ts"],
      "README.md",
      true,
    );
    expect(report.status).toBe("stale");
    expect(report.sourceFiles).toEqual(["src/index.ts"]);
    expect(report.targetChanged).toBe(false);
  });

  it("reports an explicit co-change when target and source both changed", () => {
    const report = assessDocumentationFreshness(
      ["src/index.ts", "README.md"],
      ["src/index.ts"],
      "README.md",
      true,
    );
    expect(report.status).toBe("co-changed");
    expect(report.targetChanged).toBe(true);
  });

  it("ignores test-only and non-source changes", () => {
    const report = assessDocumentationFreshness(
      ["tests/index.test.ts", "package-lock.json"],
      [],
      "README.md",
      true,
    );
    expect(report.status).toBe("clean");
    expect(report.sourceFiles).toEqual([]);
  });
});

it("returns stale from the Git-backed AST boundary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-freshness-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export function currentApi(): string { return 'ok'; }\n",
    );
    fs.writeFileSync(path.join(root, "README.md"), "# Docs\n");
    (getChangedFiles as jest.Mock).mockResolvedValue(["src/index.ts"]);
    const report = await checkDocumentationFreshness(
      root,
      "README.md",
      "HEAD~1",
    );
    expect(report.status).toBe("stale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run freshness tests and verify RED**

Run:

```bash
npx jest tests/unit/core/freshness.test.ts --runInBand
```

Expected: FAIL because `src/core/freshness.ts` does not exist.

- [ ] **Step 3: Implement AST-backed freshness assessment**

Create `src/core/freshness.ts`:

```ts
import * as fs from "fs";
import * as path from "path";
import { getChangedFiles } from "../git/history";
import { getParserForFile } from "../parsers/registry";

export type DocumentationCheckStatus =
  | "clean"
  | "co-changed"
  | "stale"
  | "missing"
  | "unknown";

export interface FreshnessReport {
  status: DocumentationCheckStatus;
  target: string;
  targetChanged: boolean;
  sourceFiles: string[];
  message: string;
}

function normalize(file: string): string {
  return file.replaceAll(path.sep, "/").replace(/^\.\//, "");
}

function isTestPath(file: string): boolean {
  return (
    /(^|\/)(tests?|__tests__)\//.test(file) ||
    /\.(test|spec)\.[^.]+$/.test(file)
  );
}

export async function collectAstSourceFiles(
  cwd: string,
  changedFiles: string[],
): Promise<string[]> {
  const sourceFiles: string[] = [];

  for (const changedFile of changedFiles.map(normalize)) {
    if (isTestPath(changedFile)) continue;
    const parser = getParserForFile(changedFile);
    if (!parser) continue;

    const absoluteFile = path.resolve(cwd, changedFile);
    if (fs.existsSync(absoluteFile)) {
      // A parser failure makes the check unknown; it must never become a
      // false successful result.
      await parser.parse(absoluteFile);
    }

    // Deleted files cannot be parsed at HEAD, but removal of a supported
    // source module is conservatively documentation-relevant.
    sourceFiles.push(changedFile);
  }

  return sourceFiles.sort();
}

export function assessDocumentationFreshness(
  changedFiles: string[],
  sourceFiles: string[],
  target: string,
  targetExists: boolean,
): FreshnessReport {
  const normalizedTarget = normalize(target);
  const normalizedChanges = changedFiles.map(normalize);
  const normalizedSourceFiles = sourceFiles.map(normalize).sort();
  const targetChanged = normalizedChanges.includes(normalizedTarget);

  if (!targetExists) {
    return {
      status: "missing",
      target: normalizedTarget,
      targetChanged,
      sourceFiles: normalizedSourceFiles,
      message: `Documentation target is missing: ${normalizedTarget}`,
    };
  }

  if (normalizedSourceFiles.length > 0 && !targetChanged) {
    return {
      status: "stale",
      target: normalizedTarget,
      targetChanged,
      sourceFiles: normalizedSourceFiles,
      message: `${normalizedSourceFiles.length} AST-backed source file(s) changed without ${normalizedTarget}`,
    };
  }

  const status: DocumentationCheckStatus =
    normalizedSourceFiles.length === 0 ? "clean" : "co-changed";
  return {
    status,
    target: normalizedTarget,
    targetChanged,
    sourceFiles: normalizedSourceFiles,
    message:
      normalizedSourceFiles.length === 0
        ? "No documentation-relevant source changes detected"
        : `${normalizedTarget} changed with the affected source files; content correctness was not verified`,
  };
}

export async function checkDocumentationFreshness(
  cwd: string,
  target: string,
  since: string,
  to = "HEAD",
): Promise<FreshnessReport> {
  const absoluteTarget = path.resolve(cwd, target);
  const relativeTarget = normalize(path.relative(cwd, absoluteTarget));

  try {
    const changedFiles = await getChangedFiles(since, to, cwd);
    const sourceFiles = await collectAstSourceFiles(cwd, changedFiles);
    return assessDocumentationFreshness(
      changedFiles,
      sourceFiles,
      relativeTarget,
      fs.existsSync(absoluteTarget),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unknown",
      target: relativeTarget,
      targetChanged: false,
      sourceFiles: [],
      message: `Could not evaluate documentation freshness: ${message}`,
    };
  }
}
```

- [ ] **Step 4: Run freshness tests and verify GREEN**

Run:

```bash
npx jest tests/unit/core/freshness.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Write the failing JSON and exit-code tests**

Create `tests/unit/cli/check.test.ts`:

```ts
jest.mock("../../../src/core/freshness", () => ({
  checkDocumentationFreshness: jest.fn(),
}));

import { checkDocumentationFreshness } from "../../../src/core/freshness";
import { runCheckCommand } from "../../../src/cli/commands/check";

const checkMock = checkDocumentationFreshness as jest.MockedFunction<
  typeof checkDocumentationFreshness
>;

describe("runCheckCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prints one JSON report and returns 1 for stale documentation", async () => {
    checkMock.mockResolvedValue({
      status: "stale",
      target: "README.md",
      targetChanged: false,
      sourceFiles: ["src/index.ts"],
      message: "README.md did not co-change",
    });
    const write = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const code = await runCheckCommand({
      target: "README.md",
      since: "HEAD~1",
      json: true,
    });

    expect(code).toBe(1);
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
      status: "stale",
      target: "README.md",
    });
  });

  it("returns 2 when the deterministic check cannot be evaluated", async () => {
    checkMock.mockResolvedValue({
      status: "unknown",
      target: "README.md",
      targetChanged: false,
      sourceFiles: [],
      message: "Git base is unavailable",
    });
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runCheckCommand({ target: "README.md", since: "missing-ref" }),
    ).resolves.toBe(2);
  });

  it.each([
    ["clean", 0],
    ["co-changed", 0],
    ["missing", 1],
  ] as const)("maps %s to exit code %i", async (status, expected) => {
    checkMock.mockResolvedValue({
      status,
      target: "README.md",
      targetChanged: status === "co-changed",
      sourceFiles: status === "clean" ? [] : ["src/index.ts"],
      message: status,
    });
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runCheckCommand({ target: "README.md", since: "base" }),
    ).resolves.toBe(expected);
  });
});
```

Create `tests/e2e/check-cli-smoke.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve("dist/cli/index.js");
const repo = mkdtempSync(join(tmpdir(), "aidoc-check-cli-"));

function git(...args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(message) {
  git("add", ".");
  git("commit", "-m", message);
}

function check(target, since) {
  const result = spawnSync(
    process.execPath,
    [cli, "check", "--target", target, "--since", since, "--json"],
    { cwd: repo, encoding: "utf8" },
  );
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, `expected one JSON line: ${result.stdout}`);
  return { status: result.status, report: JSON.parse(lines[0]) };
}

try {
  git("init", "--quiet");
  git("config", "user.name", "aidoc test");
  git("config", "user.email", "aidoc-test@example.invalid");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "README.md"), "# Fixture\n");
  writeFileSync(
    join(repo, "src", "index.ts"),
    "export function api(): number { return 1; }\n",
  );
  commit("fixture: baseline");
  const base = git("rev-parse", "HEAD");

  writeFileSync(join(repo, "notes.txt"), "non-source change\n");
  commit("fixture: non-source");
  assert.deepEqual(check("README.md", base), {
    status: 0,
    report: {
      status: "clean",
      target: "README.md",
      targetChanged: false,
      sourceFiles: [],
      message: "No documentation-relevant source changes detected",
    },
  });

  writeFileSync(
    join(repo, "src", "index.ts"),
    "export function api(): number { return 2; }\n",
  );
  commit("fixture: source change");
  const stale = check("README.md", base);
  assert.equal(stale.status, 1);
  assert.equal(stale.report.status, "stale");

  const missing = check("MISSING.md", base);
  assert.equal(missing.status, 1);
  assert.equal(missing.report.status, "missing");

  const unknown = check("README.md", "missing-ref");
  assert.equal(unknown.status, 2);
  assert.equal(unknown.report.status, "unknown");

  writeFileSync(join(repo, "README.md"), "# Fixture updated\n");
  commit("fixture: docs co-change");
  const coChanged = check("README.md", base);
  assert.equal(coChanged.status, 0);
  assert.equal(coChanged.report.status, "co-changed");
} finally {
  rmSync(repo, { recursive: true, force: true });
}
```

- [ ] **Step 6: Run the command tests and verify RED**

Run:

```bash
npx jest tests/unit/cli/check.test.ts --runInBand
npm run build
node tests/e2e/check-cli-smoke.mjs
```

Expected: unit FAIL because `src/cli/commands/check.ts` does not exist; the
compiled CLI smoke also FAILS because `check` is not registered.

- [ ] **Step 7: Implement the `aidoc check` command**

Create `src/cli/commands/check.ts`:

```ts
import { Command } from "commander";
import chalk from "chalk";
import { checkDocumentationFreshness } from "../../core/freshness";

interface CheckOptions {
  target: string;
  since: string;
  json?: boolean;
}

export async function runCheckCommand(
  options: CheckOptions,
  cwd = process.cwd(),
): Promise<number> {
  const report = await checkDocumentationFreshness(
    cwd,
    options.target,
    options.since,
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    const color =
      report.status === "clean" || report.status === "co-changed"
        ? chalk.green
        : report.status === "stale"
          ? chalk.yellow
          : chalk.red;
    process.stdout.write(`${color(report.message)}\n`);
  }

  if (report.status === "clean" || report.status === "co-changed") return 0;
  if (report.status === "stale" || report.status === "missing") return 1;
  return 2;
}

export function createCheckCommand(): Command {
  return new Command("check")
    .description("Check whether a document co-changed with AST-backed source")
    .option("--target <file>", "Documentation file to check", "README.md")
    .option("--since <ref>", "Git ref to compare against", "HEAD~1")
    .option("--json", "Print a machine-readable report")
    .action(async (options: CheckOptions) => {
      process.exitCode = await runCheckCommand(options);
    });
}

export const checkCommand = createCheckCommand();
```

Register it in `src/cli/index.ts`:

```ts
import { checkCommand } from "./commands/check";
// ...
program.addCommand(checkCommand);
```

Retain the stdout-clean dotenv initialization established by the packed CLI
smoke:

```ts
dotenv.config({ quiet: true });
```

Because every command action is asynchronous, replace the non-awaiting
`program.parse()` branch with:

```ts
program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
```

Add to `package.json`:

```json
"test:check": "npm run build && node tests/e2e/check-cli-smoke.mjs"
```

- [ ] **Step 8: Run core, command, and CLI contract tests**

Run:

```bash
npx jest tests/unit/core/freshness.test.ts tests/unit/cli/check.test.ts \
  tests/unit/cli/commands.test.ts --runInBand
npm run test:check
```

Expected: tests and fixture smoke PASS; each real CLI invocation prints exactly
one JSON line and exits 0, 1, or 2 according to the seeded Git state.

- [ ] **Step 9: Commit deterministic co-change mode**

```bash
git add src/core/freshness.ts src/cli/commands/check.ts src/cli/index.ts \
  package.json package-lock.json tests/unit/core/freshness.test.ts \
  tests/unit/cli/check.test.ts tests/e2e/check-cli-smoke.mjs
git commit -m "feat(cli): add AST-backed documentation co-change check"
```

---

### Task 4: Make the GitHub Action call real, testable behavior

**Files:**

- Create by moving: `action.yml`
- Create: `action/run.sh`
- Create: `tests/unit/action/runner.test.ts`
- Delete after moving: `action/action.yml`
- Modify: `package.json`

**Interfaces:**

- Consumes: `AIDOC_INPUT_PROVIDER`, `AIDOC_INPUT_API_KEY`,
  `AIDOC_INPUT_MODEL`, `AIDOC_INPUT_COMMANDS`, `AIDOC_INPUT_MODE`,
  `AIDOC_INPUT_OUTPUT_DIR`, `AIDOC_INPUT_DRY_RUN`, `AIDOC_INPUT_SINCE`,
  `AIDOC_CHANGED_FILES_FILE`
- Produces: `changed`, `files`, and multiline `summary` via `$GITHUB_OUTPUT`
- Calls: `aidoc <generate-command> --output <path> --yes --strict-output`
- Calls: `aidoc check --target <path> --since <ref>` in check mode

- [ ] **Step 1: Write the failing Action runner tests**

Create `tests/unit/action/runner.test.ts`:

```ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const runner = path.resolve("action/run.sh");

function setupFakeAidoc(root: string): string {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const fake = path.join(bin, "aidoc");
  fs.writeFileSync(
    fake,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$AIDOC_FAKE_LOG"
if [ "\${AIDOC_FAKE_EXIT:-0}" != "0" ]; then
  exit "$AIDOC_FAKE_EXIT"
fi
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then output="$2"; shift 2; else shift; fi
done
if [ -n "$output" ]; then
  mkdir -p "$(dirname "$output")"
  printf '# generated\n' > "$output"
fi
`,
  );
  fs.chmodSync(fake, 0o755);
  return bin;
}

function runRunner(
  overrides: NodeJS.ProcessEnv = {},
): {
  status: number | null;
  log: string;
  output: string;
  changedFiles: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-github-action-"));
  const bin = setupFakeAidoc(root);
  const log = path.join(root, "aidoc.log");
  const githubOutput = path.join(root, "github-output");
  const changedFiles = path.join(root, "changed-files");
  const result = spawnSync("bash", [runner], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      AIDOC_FAKE_LOG: log,
      GITHUB_OUTPUT: githubOutput,
      AIDOC_CHANGED_FILES_FILE: changedFiles,
      AIDOC_INPUT_PROVIDER: "openai",
      AIDOC_INPUT_API_KEY: "fake-openai-key-for-tests",
      AIDOC_INPUT_MODEL: "test-model",
      AIDOC_INPUT_COMMANDS: "readme",
      AIDOC_INPUT_MODE: "generate",
      AIDOC_INPUT_OUTPUT_DIR: "./docs",
      AIDOC_INPUT_DRY_RUN: "false",
      AIDOC_INPUT_SINCE: "HEAD~1",
      ...overrides,
    },
  });

  const response = {
    status: result.status,
    log: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "",
    output: fs.existsSync(githubOutput)
      ? fs.readFileSync(githubOutput, "utf8")
      : "",
    changedFiles: fs.existsSync(changedFiles)
      ? fs.readFileSync(changedFiles, "utf8")
      : "",
  };
  fs.rmSync(root, { recursive: true, force: true });
  return response;
}

describe("action/run.sh", () => {
  it("propagates generation failures", () => {
    const result = runRunner({ AIDOC_FAKE_EXIT: "23" });
    expect(result.status).toBe(23);
  });

  it("fails generation when a remote provider credential is missing", () => {
    const result = runRunner({ AIDOC_INPUT_API_KEY: "" });
    expect(result.status).toBe(2);
    expect(result.log).toBe("");
  });

  it("uses the real command path without --mock", () => {
    const result = runRunner();
    expect(result.status).toBe(0);
    expect(result.log).toContain(
      "readme --output ./README.md --yes --strict-output",
    );
    expect(result.log).not.toContain("--mock");
    expect(result.output).toContain("changed=true");
    expect(result.changedFiles.trim()).toBe("./README.md");
  });

  it("uses deterministic check mode without an API key", () => {
    const result = runRunner({
      AIDOC_INPUT_MODE: "check",
      AIDOC_INPUT_API_KEY: "",
    });
    expect(result.status).toBe(0);
    expect(result.log).toContain(
      "check --target ./README.md --since HEAD~1",
    );
    expect(result.log).not.toContain("--mock");
  });
});
```

- [ ] **Step 2: Run the Action tests and verify RED**

Run:

```bash
npx jest tests/unit/action/runner.test.ts --runInBand
```

Expected: FAIL with `action/run.sh` missing.

- [ ] **Step 3: Implement `action/run.sh`**

Create `action/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

provider="${AIDOC_INPUT_PROVIDER:-openai}"
model="${AIDOC_INPUT_MODEL:-}"
commands="${AIDOC_INPUT_COMMANDS:-readme}"
mode="${AIDOC_INPUT_MODE:-generate}"
output_dir="${AIDOC_INPUT_OUTPUT_DIR:-./docs}"
dry_run="${AIDOC_INPUT_DRY_RUN:-false}"
since="${AIDOC_INPUT_SINCE:-HEAD~1}"
api_key="${AIDOC_INPUT_API_KEY:-}"
changed_files_file="${AIDOC_CHANGED_FILES_FILE:-}"

case "$mode" in
  generate|check) ;;
  *) echo "Unsupported aidoc Action mode: $mode" >&2; exit 2 ;;
esac

case "$provider" in
  openai)
    export OPENAI_API_KEY="$api_key"
    ;;
  anthropic)
    export ANTHROPIC_API_KEY="$api_key"
    ;;
  ollama)
    ;;
  *)
    echo "Unsupported aidoc provider: $provider" >&2
    exit 2
    ;;
esac

if [ "$mode" = "generate" ] && [ "$provider" != "ollama" ] && [ -z "$api_key" ]; then
  echo "The $provider provider requires the api-key Action input" >&2
  exit 2
fi

export AIDOC_PROVIDER="$provider"
export AIDOC_MODEL="$model"

changed="false"
changed_files=()
summary_lines=()
if [ -n "$changed_files_file" ]; then
  : > "$changed_files_file"
fi

IFS=',' read -ra command_list <<< "$commands"
for raw_command in "${command_list[@]}"; do
  command_name="$(printf '%s' "$raw_command" | xargs)"
  case "$command_name" in
    readme) output_file="./README.md" ;;
    api) output_file="$output_dir/API.md" ;;
    changelog) output_file="./CHANGELOG.md" ;;
    diagram) output_file="$output_dir/architecture.md" ;;
    *) echo "Unsupported aidoc command: $command_name" >&2; exit 2 ;;
  esac

  if [ "$mode" = "check" ]; then
    aidoc check --target "$output_file" --since "$since"
    summary_lines+=("Co-change check passed for $output_file")
    continue
  fi

  before=""
  if [ -f "$output_file" ]; then
    before="$(cksum "$output_file")"
  fi

  args=(
    "$command_name"
    "--output"
    "$output_file"
    "--yes"
    "--strict-output"
  )
  if [ "$dry_run" = "true" ]; then
    args+=("--dry-run")
  fi
  aidoc "${args[@]}"

  if [ "$dry_run" != "true" ]; then
    after=""
    if [ -f "$output_file" ]; then
      after="$(cksum "$output_file")"
    fi
    if [ "$before" != "$after" ]; then
      changed="true"
      changed_files+=("$output_file")
      if [ -n "$changed_files_file" ]; then
        printf '%s\n' "$output_file" >> "$changed_files_file"
      fi
    fi
  fi
  summary_lines+=("Generated $output_file")
done

{
  echo "changed=$changed"
  echo "files<<AIDOC_FILES_EOF"
  printf '%s\n' "${changed_files[@]}"
  echo "AIDOC_FILES_EOF"
  echo "summary<<AIDOC_SUMMARY_EOF"
  printf '%s\n' "${summary_lines[@]}"
  echo "AIDOC_SUMMARY_EOF"
} >> "$GITHUB_OUTPUT"
```

Make it executable:

```bash
chmod +x action/run.sh
```

- [ ] **Step 4: Run the Action runner tests and verify GREEN**

Run:

```bash
npx jest tests/unit/action/runner.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Write the failing Action-entrypoint placement test**

Append to `tests/unit/action/runner.test.ts`:

```ts
describe("composite Action package", () => {
  it("publishes action.yml at the repository root used by owner/repo@ref", () => {
    expect(fs.existsSync(path.resolve("action.yml"))).toBe(true);
  });

  it("links composite outputs to the runner step", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toMatch(/\bid: aidoc\b/);
    for (const output of ["changed", "files", "summary"]) {
      expect(metadata).toContain(
        `value: \${{ steps.aidoc.outputs.${output} }}`,
      );
    }
  });

  it("stages only paths emitted by aidoc", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).not.toContain("git add -A");
    expect(metadata).toContain("git diff --cached --quiet");
    expect(metadata).toContain('git add -- "$file"');
  });

  it("installs the npm version declared by the same Action ref", () => {
    const metadata = fs.readFileSync(path.resolve("action.yml"), "utf8");
    expect(metadata).toContain("require('./package.json').version");
    expect(metadata).toContain('aidoc-gen@$version');
  });
});
```

- [ ] **Step 6: Run the entrypoint test and verify RED**

Run:

```bash
npx jest tests/unit/action/runner.test.ts --runInBand
```

Expected: FAIL because the metadata currently exists at
`action/action.yml`, while the documented `uses: mr-min-max/aidoc@...` syntax
requires `action.yml` at the repository root.

- [ ] **Step 7: Move the metadata and delegate to the runner**

Move the existing metadata without discarding its inputs, outputs, branding,
or auto-commit step:

```bash
git mv action/action.yml action.yml
```

Add the input:

```yaml
  since:
    description: 'Git ref present in the checkout and used by co-change check mode'
    required: false
    default: 'HEAD~1'
```

Change the existing `mode` description from “fail CI if docs are stale” to
“run the deterministic AST-backed co-change guard”.

Wire every composite output to the runner step:

```yaml
outputs:
  changed:
    description: 'Whether documentation was updated (true/false)'
    value: ${{ steps.aidoc.outputs.changed }}
  files:
    description: 'Newline-delimited documentation paths changed by aidoc'
    value: ${{ steps.aidoc.outputs.files }}
  summary:
    description: 'Human-readable summary'
    value: ${{ steps.aidoc.outputs.summary }}
```

Replace the large `Run aidoc commands` script in root `action.yml` with:

```yaml
    - name: Run aidoc commands
      id: aidoc
      shell: bash
      env:
        AIDOC_INPUT_PROVIDER: ${{ inputs.provider }}
        AIDOC_INPUT_API_KEY: ${{ inputs.api-key }}
        AIDOC_INPUT_MODEL: ${{ inputs.model }}
        AIDOC_INPUT_COMMANDS: ${{ inputs.commands }}
        AIDOC_INPUT_MODE: ${{ inputs.mode }}
        AIDOC_INPUT_OUTPUT_DIR: ${{ inputs.output-dir }}
        AIDOC_INPUT_DRY_RUN: ${{ inputs.dry-run }}
        AIDOC_INPUT_SINCE: ${{ inputs.since }}
        AIDOC_CHANGED_FILES_FILE: ${{ runner.temp }}/aidoc-changed-files
      run: bash "$GITHUB_ACTION_PATH/action/run.sh"
```

Derive the npm package version from the same tagged repository metadata so the
Action never silently installs `latest` or drifts from its ref:

```yaml
    - name: Install aidoc
      shell: bash
      run: |
        cd "$GITHUB_ACTION_PATH"
        version="$(node -p "require('./package.json').version")"
        npm install -g "aidoc-gen@$version"
```

In the auto-commit step, replace broad staging and masked push failure:

```bash
git add -A
```

with:

```bash
if ! git diff --cached --quiet; then
  echo "Refusing to commit: the checkout already has staged changes" >&2
  exit 2
fi
while IFS= read -r file; do
  if [ -n "$file" ]; then
    git add -- "$file"
  fi
done < "$RUNNER_TEMP/aidoc-changed-files"
git diff --staged --quiet || \
  git commit -m "docs: update documentation via aidoc [skip ci]"
git push
```

Preserve the existing bot identity configuration. The preflight failure is
required: selective `git add` alone would still include files staged by an
earlier workflow step in the new commit.

Also narrow the step condition:

```yaml
if: inputs.auto-commit == 'true' && inputs.mode != 'check' && inputs.dry-run != 'true' && steps.aidoc.outputs.changed == 'true'
```

- [ ] **Step 8: Add the Action test script and run the focused suite**

Add to `package.json`:

```json
"test:action": "jest tests/unit/action/runner.test.ts --runInBand"
```

Run:

```bash
npm run test:action
npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit real Action behavior**

```bash
git add action.yml action/run.sh package.json package-lock.json \
  tests/unit/action/runner.test.ts
git commit -m "fix(action): propagate real generation failures"
```

---

### Task 5: Replace bespoke MCP framing with the official SDK

**Files:**

- Create: `tests/e2e/mcp-smoke.mjs`
- Modify: `src/mcp/server.ts:20-427`
- Modify: `src/cli/index.ts:1-52`
- Modify: `package.json` / `package-lock.json`

**Interfaces:**

- Produces: `createMCPServer(): Server`
- Produces: `startMCPServer(): Promise<void>`
- Consumes: `@modelcontextprotocol/sdk/server/index.js`
- Consumes: `@modelcontextprotocol/sdk/server/stdio.js`
- Consumes: `@modelcontextprotocol/sdk/types.js`
- Reuses: existing `TOOLS` definitions and `handleToolCall`
- Reuses: `checkDocumentationFreshness` for `check_docs_freshness`

- [ ] **Step 1: Install the production SDK v1**

Run:

```bash
npm install @modelcontextprotocol/sdk@^1.30.0
```

Expected: `package.json` and `package-lock.json` record the v1 dependency while
the module system remains CommonJS.

- [ ] **Step 2: Write the failing stdio integration test**

Create `tests/e2e/mcp-smoke.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = mkdtempSync(join(tmpdir(), "aidoc-mcp-smoke-"));
let client;

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", root],
    { cwd: resolve("."), encoding: "utf8" },
  );
  const [{ filename }] = JSON.parse(packOutput);
  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "aidoc-mcp-consumer", private: true }),
  );
  execFileSync("npm", ["install", "--ignore-scripts", join(root, filename)], {
    cwd: consumer,
    stdio: "pipe",
  });

  const fixture = join(root, "fixture-repo");
  mkdirSync(join(fixture, "src"), { recursive: true });
  writeFileSync(join(fixture, "README.md"), "# MCP fixture\n");
  writeFileSync(
    join(fixture, "src", "index.ts"),
    "export function api(): number { return 1; }\n",
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: fixture,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "aidoc test");
  git("config", "user.email", "aidoc-test@example.invalid");
  git("add", ".");
  git("commit", "-m", "fixture: baseline");
  const base = git("rev-parse", "HEAD");
  writeFileSync(
    join(fixture, "src", "index.ts"),
    "export function api(): number { return 2; }\n",
  );
  git("add", ".");
  git("commit", "-m", "fixture: source change");

  const packedCli = join(
    consumer,
    "node_modules",
    "aidoc-gen",
    "dist",
    "cli",
    "index.js",
  );
  client = new Client({ name: "aidoc-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [packedCli, "--mcp"],
    cwd: consumer,
  });

  await client.connect(transport, { timeout: 5_000 });
  const packedPackage = JSON.parse(
    readFileSync(
      join(consumer, "node_modules", "aidoc-gen", "package.json"),
      "utf8",
    ),
  );
  assert.equal(client.getServerVersion()?.version, packedPackage.version);
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "analyze_codebase"));
  const checkTool = tools.find(
    (tool) => tool.name === "check_docs_freshness",
  );
  assert.ok(checkTool);
  assert.match(checkTool.description ?? "", /co-change/i);

  const result = await client.callTool({
    name: "analyze_codebase",
    arguments: {
      directory: resolve("tests/fixtures"),
      include: "**/*.ts",
      exclude: "",
    },
  });
  assert.notEqual(result.isError, true);
  const text = result.content.find((item) => item.type === "text");
  assert.ok(text && "text" in text);
  const payload = JSON.parse(text.text);
  assert.ok(payload.totalModules >= 1);

  const checkResult = await client.callTool({
    name: "check_docs_freshness",
    arguments: {
      directory: fixture,
      doc_file: "README.md",
      since: base,
    },
  });
  assert.notEqual(checkResult.isError, true);
  const checkText = checkResult.content.find(
    (item) => item.type === "text",
  );
  assert.ok(checkText && "text" in checkText);
  assert.equal(JSON.parse(checkText.text).status, "stale");
} finally {
  if (client) {
    await client.close().catch(() => {});
  }
  rmSync(root, { recursive: true, force: true });
}
```

Add to `package.json`:

```json
"test:mcp": "node tests/e2e/mcp-smoke.mjs"
```

- [ ] **Step 3: Run MCP smoke and verify RED**

Run:

```bash
npm run test:mcp
```

Expected: the tarball installs, then FAIL within five seconds during
initialization because the current server reads newline-delimited input but
writes `Content-Length` framed output.

- [ ] **Step 4: Wire the SDK transport and already-tested shared boundaries**

At the top of `src/mcp/server.ts`, add:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { checkDocumentationFreshness } from "../core/freshness";
import { resolveTemplatesDir } from "../core/templates";
```

Replace every MCP `path.resolve(__dirname, "../templates")` call with:

```ts
resolveTemplatesDir()
```

Keep the same five tool names and schemas, but correct the
`check_docs_freshness` description to:

```ts
"Run an AST-backed documentation co-change guard. This detects source/doc co-change and does not verify semantic correctness."
```

Replace the inline `check_docs_freshness` implementation with:

```ts
const report = await checkDocumentationFreshness(dir, docFile, since);
return {
  ...report,
  recommendation:
    report.status === "stale"
      ? "Run aidoc update to refresh documentation."
      : null,
};
```

Delete the custom `MCPTool` interface and type the existing definitions with
the SDK:

```ts
export const TOOLS: Tool[] = [
  // Preserve the five existing definitions unchanged.
];
```

Export `handleToolCall`, then replace the hand-written
`startMCPServer` implementation with:

```ts
export function createMCPServer(): Server {
  const server = new Server(
    { name: "aidoc", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleToolCall(
        request.params.name,
        request.params.arguments ?? {},
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: message }],
      };
    }
  });

  return server;
}

export async function startMCPServer(): Promise<void> {
  const server = createMCPServer();
  await server.connect(new StdioServerTransport());
}
```

Delete the custom `MCPRequest`, `MCPResponse`, readline buffer, `send`, and
manual initialize/tools routing. Preserve the tool definitions and business
logic until they are deliberately refactored in a later plan.

- [ ] **Step 5: Keep stdout protocol-clean**

Retain the quiet dotenv initialization added with the JSON CLI contract.
Change MCP startup failure handling to:

```ts
startMCPServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Run MCP integration and focused unit tests**

Run:

```bash
npm run test:mcp
npx jest tests/unit/core/freshness.test.ts tests/unit/cli/context.test.ts --runInBand
```

Expected: PASS; stdout contains only MCP protocol messages during the stdio
session.

- [ ] **Step 7: Commit the MCP transport migration**

```bash
git add package.json package-lock.json src/mcp/server.ts src/cli/index.ts \
  tests/e2e/mcp-smoke.mjs
git commit -m "fix(mcp): use the official stdio transport"
```

---

### Task 6: Derive version metadata and prepare `v0.1.1`

**Files:**

- Create: `src/core/package-meta.ts`
- Create: `tests/unit/core/package-meta.test.ts`
- Create: `CHANGELOG.md`
- Modify: `src/cli/index.ts`
- Modify: `src/mcp/server.ts`
- Modify: `package.json` / `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `ROADMAP.md`

**Interfaces:**

- Produces: `readPackageVersion(moduleDir?: string): string`
- Consumes: installed root `package.json`

- [ ] **Step 1: Write the failing package-version test**

Create `tests/unit/core/package-meta.test.ts`:

```ts
import * as path from "path";
import packageJson from "../../../package.json";
import { readPackageVersion } from "../../../src/core/package-meta";

describe("readPackageVersion", () => {
  it("matches the installed root package metadata", () => {
    const moduleDir = path.resolve("src/core");
    expect(readPackageVersion(moduleDir)).toBe(packageJson.version);
  });
});
```

- [ ] **Step 2: Run the version test and verify RED**

Run:

```bash
npx jest tests/unit/core/package-meta.test.ts --runInBand
```

Expected: FAIL because `src/core/package-meta.ts` does not exist.

- [ ] **Step 3: Implement installed package metadata resolution**

Create `src/core/package-meta.ts`:

```ts
import * as fs from "fs";
import * as path from "path";

interface PackageMetadata {
  version?: unknown;
}

export function readPackageVersion(moduleDir = __dirname): string {
  const packagePath = path.resolve(moduleDir, "../../package.json");
  const metadata = JSON.parse(
    fs.readFileSync(packagePath, "utf8"),
  ) as PackageMetadata;

  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Invalid package version in ${packagePath}`);
  }

  return metadata.version;
}
```

Use `readPackageVersion()` in both locations:

```ts
// src/cli/index.ts
import { readPackageVersion } from "../core/package-meta";

program.version(readPackageVersion());
```

```ts
// src/mcp/server.ts
import { readPackageVersion } from "../core/package-meta";

{ name: "aidoc", version: readPackageVersion() }
```

Remove the hardcoded CLI and MCP versions.

- [ ] **Step 4: Run version, build, package, and MCP tests**

Run:

```bash
npx jest tests/unit/core/package-meta.test.ts --runInBand
npm run build
npm run test:package
npm run test:mcp
```

Expected: PASS.

- [ ] **Step 5: Reproduce the false Node.js support floor**

Run:

```bash
node -p "'aidoc: ' + require('./package.json').engines.node"
node -p "'commander: ' + require('./node_modules/commander/package.json').engines.node"
node -p "'chokidar: ' + require('./node_modules/chokidar/package.json').engines.node"
node -p "'glob: ' + require('./node_modules/glob/package.json').engines.node"
```

Expected old behavior: aidoc claims Node `>=18.0.0`, while its installed
runtime dependency set requires newer Node releases (Commander is the highest
floor at `>=22.12.0`). Record this as a release-integrity defect rather than
downgrading current dependencies to preserve EOL runtimes.

- [ ] **Step 6: Make supported Node.js versions truthful**

Change `package.json` to:

```json
{
  "engines": {
    "node": ">=22.12.0"
  }
}
```

Run:

```bash
npm install --package-lock-only
```

Update `.github/workflows/ci.yml`:

```yaml
strategy:
  matrix:
    node-version: [22, 24]
```

Keep coverage upload on one version only. Node 22 and 24 are the supported LTS
lines on the plan date; Node 18 and 20 are EOL and must not remain in the
advertised matrix.

Add the local/CI release gate to `package.json`:

```json
"verify:release": "npm run lint && npm test -- --runInBand && npm run build && npm run test:check && npm run test:package && npm run test:action && npm run test:mcp"
```

Replace the separate lint/build commands in `.github/workflows/ci.yml` with
`npm run verify:release`; retain the deterministic score and coverage steps.
In `.github/workflows/release.yml`, add this before packaging:

```yaml
permissions:
  contents: write

jobs:
  release:
    # existing runner and steps

    steps:
      - name: Verify tag matches package version
        shell: bash
        run: |
          package_version="$(node -p "require('./package.json').version")"
          if [ "$GITHUB_REF_NAME" != "v$package_version" ]; then
            echo "Tag $GITHUB_REF_NAME does not match v$package_version" >&2
            exit 1
          fi
      - run: npm run verify:release
```

Then pack one actual artifact, expose its path from an `id: pack` step, and
publish that exact `.tgz` rather than repacking implicitly:

```yaml
      - name: Pack verified artifact
        id: pack
        shell: bash
        run: |
          npm pack --json --pack-destination "$RUNNER_TEMP" \
            > "$RUNNER_TEMP/aidoc-pack.json"
          filename="$(node -e "const fs=require('fs'); const p=process.env.RUNNER_TEMP + '/aidoc-pack.json'; console.log(JSON.parse(fs.readFileSync(p, 'utf8'))[0].filename)")"
          echo "tarball=$RUNNER_TEMP/$filename" >> "$GITHUB_OUTPUT"
      - run: npm publish "${{ steps.pack.outputs.tarball }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Remove the old bare `npm publish` step. A tag must never bypass version
matching, package, Action, or packed-MCP checks.

Update the README badge to `Node.js-≥22.12`.

- [ ] **Step 7: Verify the supported runtime contract**

Run:

```bash
npm ci
npm run verify:release
node -p "process.versions.node"
node -p "require('./package.json').engines.node"
```

Expected: all local checks pass on the current Node 22 runtime and metadata
prints `>=22.12.0`. The remote CI matrix supplies the separate Node 24
verification before release.

- [ ] **Step 8: Bump package metadata without tagging**

Run:

```bash
npm version 0.1.1 --no-git-tag-version
```

Expected: `package.json` and `package-lock.json` both report `0.1.1`; no Git
tag is created.

- [ ] **Step 9: Create a factual unreleased changelog**

Create `CHANGELOG.md`:

```md
# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Fixed

- Ship Handlebars prompt templates with the compiled npm package.
- Propagate GitHub Action generation and push failures.
- Reject malformed generated Markdown before the Action writes or commits it.
- Use a deterministic AST-backed document co-change guard in Action check mode.
- Replace the bespoke MCP stdio framing with the official TypeScript SDK.
- Read Action provider and model inputs through validated CLI configuration.

### Added

- Tarball smoke tests that render a real packaged template without an API call.
- MCP client/server integration coverage over stdio.
- A non-interactive `--yes` option for documentation generation in CI.

### Changed

- Require Node.js 22.12 or newer and test supported LTS lines in CI.
```

Do not list Trust Gate, semantic AST diff, or ProofGraph as shipped. Replace
`[Unreleased]` with `[0.1.1] - <actual publication date>` only in the final
release commit immediately before tagging.

- [ ] **Step 10: Correct README and roadmap claims**

Replace every unverified major-only Action example with the exact
`mr-min-max/aidoc@v0.1.1` release candidate. Update the Action check example to
include:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - uses: mr-min-max/aidoc@v0.1.1
    with:
      mode: check
      since: ${{ github.event.pull_request.base.sha }}
      commands: readme,api
```

Explain immediately below it:

```md
Check mode is a deterministic co-change guard. It reports a document as stale
when AST-parseable source files changed in the selected Git range without the
target document changing in that range. `fetch-depth: 0` makes the selected
base ref available. A successful `co-changed` result does not prove that the
document content is semantically correct, and check mode never compares
non-deterministic LLM output.
```

State that pull-request workflows should use
`${{ github.event.pull_request.base.sha }}` and push workflows can use
`${{ github.event.before }}`. Do not present `HEAD~1` as equivalent to the
whole pull request.

In the generate/auto-commit example, add:

```yaml
permissions:
  contents: write
```

Without that permission, the documented `auto-commit: true` flow cannot push
on repositories whose default `GITHUB_TOKEN` permission is read-only.

Correct the surrounding release claims at the same time:

- rename “Check Mode (fail CI if docs are stale)” to an AST-backed co-change
  guard and change the MCP tool table from “up-to-date” to the same wording;
- refer to the Action as `mr-min-max/aidoc`, not a different product name;
- describe `update` as giving Git changes to the provider, not guaranteeing
  that only correct affected sections are rewritten;
- describe cache scope accurately (in-process runs such as watch mode), not
  “unchanged files are never re-parsed” across separate CLI processes;
- do not advertise custom template overrides until the `templates` config
  field is actually wired;
- describe Ollama as the local provider option without claiming the remote
  provider path is already protected by the Day 2 Trust Gate.

Restructure the top of `ROADMAP.md` into these accurate states:

```md
## Release candidate

### v0.1.1 — Release Integrity

- Packaged Handlebars templates with tarball smoke coverage
- Failure-propagating GitHub Action generate/check modes
- Deterministic AST-backed documentation co-change command
- Standards-compliant MCP stdio transport

## In progress

### v0.2.0 — Trust Gate

- Provider-context secret detection and redaction
- Repository-contained atomic writes
- Security doctor and bounded run receipts

## Planned

### v0.3.0 — ProofGraph

- Semantic AST documentation impact
- Evidence-backed technical claims
- `aidoc verify` and `aidoc explain`
```

Move existing unshipped language/plugin/editor ideas under a later section;
do not delete them. Move `v0.1.1` to **Shipped** only after the tag, npm
publication, and release checks actually succeed.

- [ ] **Step 11: Run version consistency and documentation checks**

Run:

```bash
npx jest tests/unit/core/package-meta.test.ts --runInBand
npm run build
node dist/cli/index.js --version
```

Expected: all PASS and the CLI prints `0.1.1`.

- [ ] **Step 12: Commit release metadata**

```bash
git add package.json package-lock.json src/core/package-meta.ts \
  src/cli/index.ts src/mcp/server.ts tests/unit/core/package-meta.test.ts \
  .github/workflows/ci.yml .github/workflows/release.yml \
  CHANGELOG.md README.md ROADMAP.md
git commit -m "chore(release): prepare v0.1.1"
```

---

### Task 7: Run the release-candidate verification gate

**Files:**

- Modify only files required by a demonstrated failing verification.
- Do not create a tag, publish a package, or push.

**Interfaces:**

- Consumes every command and artifact produced by Tasks 1–6.
- Produces a verified local release candidate and a concise PR/release report.

- [ ] **Step 1: Verify formatting and tracked changes**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional release-candidate changes are
present.

- [ ] **Step 2: Run the complete unit suite**

Run:

```bash
npm test -- --runInBand
```

Expected: exit code 0 with zero failed suites and zero failed tests.

- [ ] **Step 3: Run lint and TypeScript build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run all release integrations**

Run:

```bash
npm run test:package
npm run test:action
npm run test:check
npm run test:mcp
```

Expected: all commands exit 0 without external LLM requests.

- [ ] **Step 5: Inspect the exact package contents**

First run:

```bash
mktemp -d
```

Record the exact returned temporary directory, then run
`npm pack --json --pack-destination <that-exact-directory>`. Do not reuse or
guess a broad temporary path.

Expected:

- JSON records the candidate filename, shasum, integrity, size, and file list;
- the reported `.tgz` exists at the exact temporary path and remains available
  through handoff;
- `dist/templates/readme.hbs` and the other six templates are listed;
- `src/templates/` is not listed;
- tests, local configuration, `.env`, and Git metadata are not listed.

- [ ] **Step 6: Check runtime dependencies**

Run:

```bash
npm audit --omit=dev
```

Expected: report the actual production result. Do not suppress findings; if a
finding exists, record its severity and whether a non-breaking remediation is
available before deciding to release.

- [ ] **Step 7: Review every release claim against evidence**

Check:

```bash
rg -n "v0\\.1\\.1|Unreleased|Shipped|Trust Gate|ProofGraph|--mock|check mode|up-to-date|freshness|privacy-first|never re-parsed" \
  README.md ROADMAP.md CHANGELOG.md action.yml action/run.sh
```

Expected:

- `v0.1.1` claims map to passing commands above;
- the roadmap calls `v0.1.1` a release candidate and the changelog remains
  `Unreleased` before publication;
- co-change behavior is not described as semantic freshness or proof;
- Trust Gate and ProofGraph appear only as in-progress or planned;
- `--mock` does not appear in `action.yml` or `action/run.sh`.

- [ ] **Step 8: Request two-stage code review**

Use `superpowers:requesting-code-review`:

1. specification-compliance review against
   `docs/superpowers/specs/2026-07-30-oss-credibility-sprint-design.md`;
2. code-quality/security review of the final diff.

Resolve every Critical or Important finding through the original task
implementer and rerun the affected verification command.

- [ ] **Step 9: Prepare the maintainer handoff**

Report:

- exact commit list;
- test/build/lint/package/MCP/Action evidence;
- npm tarball filename and integrity metadata;
- remaining audit or platform limitations;
- three proposed public issue titles;
- proposed PR title and four-section body;
- proposed `v0.1.1` release notes.

Stop before push, tag, GitHub issue creation, npm publish, or release creation.
