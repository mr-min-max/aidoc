# Semantic Documentation Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, zero-configuration `aidoc plan` workflow that compares Git snapshots through TypeScript/JavaScript/Python ASTs, maps public-symbol changes to documentation, supplies a byte-bounded value-free provider context, and becomes the only change context used by `aidoc update` and the MCP planning tool.

**Architecture:** Extend each language parser with a source-in/snapshot-out boundary, then keep Git reads, change comparison, Markdown evidence, context budgeting, and interface projection in focused modules under `src/git/` and `src/impact/`. `createImpactPlan()` is the single orchestration core used by CLI, MCP, and update; it returns the public `ImpactPlan` plus an internal bounded `ImpactProviderContext`, while provider construction remains outside planning.

**Tech Stack:** TypeScript 6, Node.js >=22.12.0 standard library, CommonJS, Jest/ts-jest, Commander 15, cosmiconfig 9, Handlebars 4, `ts-morph` 25, Python 3 standard-library `ast`, Git CLI through `execFile` argument arrays.

## Global Constraints

- Work only in `/Users/example/Documents/aidoc/.worktrees/release-integrity` on `codex/release-integrity`; do not rewrite history, create another branch/worktree, merge, tag, publish, or change repository visibility.
- Target contract is `v0.2.0-beta.2`; manifest version alignment is allowed, but release creation and publication are outside this plan.
- Planning is deterministic and provider-free: it never loads `.env`, provider/model/api-key settings, templates, `LLMProvider`, or provider credentials.
- Keep AST extraction ahead of any LLM operation; do not parse TypeScript, JavaScript, or Python code with regular expressions.
- Use `ts-morph` for TypeScript/JavaScript and Python standard-library `ast` for Python; add unit coverage for both parser snapshot implementations.
- Store provider prompt wording only in `src/templates/update.hbs`; do not inline a production prompt in TypeScript.
- Add no production dependency. Use Node standard-library Git process execution, hashing, path containment, UTF-8 byte counting, and `path.matchesGlob()`.
- Never place raw source, raw diff, bodies, literals, docstrings, full signatures, import specifiers, absolute paths, credentials, raw thrown values, Git stderr, or hostile error values in `ImpactPlan`, JSON, MCP output, diagnostics, or provider context.
- A parse failure for any changed supported source file fails the entire plan and prevents provider construction/calls.
- JSON uses `schemaVersion: "aidoc.impact-plan.v1"`, deterministic array/key ordering, one stdout object, and exit `0` for every complete plan including zero impact; planning failures exit `1`.
- `--max-context-bytes` accepts only integers from 1024 through 1048576; default is exactly 12000 UTF-8 bytes.
- Context priority is removals, contract changes, moves, additions, dependency changes, implementation changes, then documentation-only changes; ties use path, kind, and qualified name.
- Preserve `aidoc update --since <ref>` for one beta cycle as an alias of `--base`; conflicting values are an input error.
- Follow strict red-green-refactor for each behavior: add a focused failing test, run it and observe the expected failure, add the smallest implementation, rerun focused tests, refactor only while green, then run the task regression set.
- Commit only cohesive, tested tasks. Each implementation task receives an independent spec-compliance and code-quality review before the next task begins.

---

## File Structure

### New production files

- `src/impact/types.ts` — public plan, change, documentation, context, error, and internal provider-projection contracts.
- `src/impact/canonical.ts` — canonical JSON serialization, SHA-256 helpers, and stable comparison keys.
- `src/config/planning.ts` — safe planning-only configuration loader and context-budget validation.
- `src/git/snapshot.ts` — ref validation/discovery, immutable/worktree change enumeration, safe blob/file reads, and normalized status records.
- `src/impact/compare.ts` — stable IDs, rename-aware symbol comparison, risks, summary, and semantic plan digest payload.
- `src/impact/documentation.ts` — deterministic Markdown section index, direct evidence, recommendations, and unmapped attribution.
- `src/impact/context.ts` — byte-bounded provider projection and `ContextBudgetReport`.
- `src/impact/planner.ts` — single planning core that joins Git snapshots, parsers, comparison, docs, digest, and bounded context.
- `src/output/impact.ts` — concise human plan output and deterministic command-result JSON.
- `src/cli/commands/plan.ts` — zero-config Commander command and exit/output behavior.
- `scripts/demo-impact.mjs` — no-key deterministic temporary-repository demo, reusable by package smoke.

### New test files

- `tests/unit/impact/canonical.test.ts`
- `tests/unit/config/planning.test.ts`
- `tests/unit/git/snapshot.test.ts`
- `tests/unit/impact/compare.test.ts`
- `tests/unit/impact/documentation.test.ts`
- `tests/unit/impact/context.test.ts`
- `tests/unit/impact/planner.test.ts`
- `tests/unit/output/impact.test.ts`
- `tests/unit/cli/plan.test.ts`
- `tests/unit/cli/update-impact.test.ts`
- `tests/unit/mcp/impact-plan.test.ts`

### Modified production and integration files

- `src/parsers/types.ts`, `src/parsers/typescript.ts`, `src/parsers/python.ts`, `src/parsers/registry.ts` — add value-free snapshot parsing while retaining existing full-module analysis.
- `src/config/schema.ts`, `src/config/loader.ts` — add the shared safe budget field and move `.env` loading into provider-backed configuration only.
- `src/cli/index.ts` — register `planCommand` and remove global dotenv bootstrap.
- `src/cli/context.ts` — load provider environment only at the provider-backed boundary.
- `src/core/differ.ts`, `src/core/generator.ts`, `src/cli/mock-generator.ts`, `src/cli/commands/update.ts`, `src/templates/update.hbs` — replace raw-diff update context with `ImpactProviderContext`.
- `src/mcp/server.ts`, MCP tests/smoke — add repository-scoped `plan_documentation_impact` without provider creation.
- `src/security/diagnostics.ts` — allow stable plan codes without inspecting untrusted error payloads.
- `src/core/templates.ts` — continue packaging the revised update template; no new template name is required.
- `package.json`, `package-lock.json` — add demo/release-gate scripts and align the prerelease version without creating a tag.
- `tests/e2e/package-smoke.mjs`, `tests/e2e/mcp-smoke.mjs` — prove packed CLI/MCP planning parity and no-key behavior.
- `README.md` — lead onboarding with plan/update/JSON, document limitations, options, demo, and safe provider boundary.

---

## Shared Contracts

Task 1 creates these names once; every later task imports them rather than redefining lookalikes:

```ts
export const IMPACT_PLAN_SCHEMA_VERSION = "aidoc.impact-plan.v1" as const;
export const IMPACT_CONTEXT_SCHEMA_VERSION = "aidoc.impact-context.v1" as const;
export const DEFAULT_MAX_CONTEXT_BYTES = 12000;
export const MIN_MAX_CONTEXT_BYTES = 1024;
export const MAX_MAX_CONTEXT_BYTES = 1048576;

export type ImpactLanguage = "typescript" | "python";
export type SymbolKind =
  | "function" | "class" | "method" | "interface" | "type" | "enum";
export type ContractFacet =
  | "parameters" | "return" | "inheritance" | "members" | "modifiers";
export type ChangeCategory =
  | "added" | "removed" | "moved" | "contract-changed"
  | "implementation-changed" | "documentation-changed" | "dependency-changed";
export type ChangeRisk =
  | "potentially-breaking" | "review-required" | "informational";

export interface SnapshotDescriptor {
  type: "git" | "working-tree";
  label: string;
  commit?: string;
}

export interface SymbolChange {
  scope: "symbol" | "module";
  id: string;
  beforeId?: string;
  afterId?: string;
  category: ChangeCategory;
  risk: ChangeRisk;
  language: ImpactLanguage;
  path: string;
  kind: SymbolKind | "module";
  qualifiedName?: string;
  changedContractFacets?: ContractFacet[];
  digest: string;
}

export interface DocumentationReference {
  file: string;
  section: string;
  slug: string;
  reason:
    | "code-span" | "source-link" | "heading"
    | "api-documentation" | "changelog"
    | "entrypoint" | "architecture";
}

export interface DocumentationImpact {
  changeId: string;
  directReferences: DocumentationReference[];
  recommendations: DocumentationReference[];
  unmapped: boolean;
}

export interface ImpactSummary {
  totalChanges: number;
  publicApiChanges: number;
  potentiallyBreaking: number;
  reviewRequired: number;
  informational: number;
  unmapped: number;
  byCategory: Record<ChangeCategory, number>;
}

export interface ContextBudgetReport {
  maxBytes: number;
  usedBytes: number;
  totalRecords: number;
  includedRecords: number;
  omittedRecords: number;
  impactDigest: string;
}

export interface ImpactPlan {
  schemaVersion: typeof IMPACT_PLAN_SCHEMA_VERSION;
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  context: ContextBudgetReport;
  ignored: { unsupported: number; excluded: number };
  digest: string;
}

export interface ImpactProviderContext {
  schemaVersion: typeof IMPACT_CONTEXT_SCHEMA_VERSION;
  impactDigest: string;
  summary: ImpactSummary;
  changes: ImpactProviderChange[];
  documentation: DocumentationImpact[];
  omittedRecords: number;
}

export type ImpactProviderChange =
  | (Pick<SymbolChange,
      "id" | "category" | "risk" | "path" | "kind" |
      "qualifiedName" | "changedContractFacets"> & { compacted?: false })
  | {
      id: string; // the 64-character SymbolChange.digest, not a truncated ID
      category: ChangeCategory;
      risk: ChangeRisk;
      kind: SymbolKind | "module";
      compacted: true;
    };

export type PlanErrorCode =
  | "PLAN_NOT_GIT_REPOSITORY" | "PLAN_BASE_NOT_FOUND"
  | "PLAN_HEAD_NOT_FOUND" | "PLAN_INVALID_REF" | "PLAN_SHALLOW_HISTORY"
  | "PLAN_UNSAFE_WORKTREE_PATH" | "PLAN_SOURCE_READ_FAILED"
  | "PLAN_PARSE_FAILED" | "PLAN_INVALID_CONTEXT_BUDGET";

export interface PlanError { code: PlanErrorCode; message: string; path?: string }
export type PlanCommandResult =
  | { ok: true; plan: ImpactPlan }
  | { ok: false; error: PlanError };

export interface ImpactPlanningResult {
  plan: ImpactPlan;
  providerContext: ImpactProviderContext;
}
```

Parser snapshots use the exact boundary below:

```ts
export interface ParserModuleSnapshot {
  language: ImpactLanguage;
  dependencyFingerprint: string;
  symbols: ParserSymbolSnapshot[];
}

export interface ParserSymbolSnapshot {
  language: ImpactLanguage;
  kind: SymbolKind;
  qualifiedName: string;
  contractFacets: Partial<Record<ContractFacet, string>>;
  contractFingerprint: string;
  implementationFingerprint: string;
  documentationFingerprint: string | null;
}

export interface LanguageParser {
  readonly name: string;
  readonly supportedExtensions: string[];
  parse(filePath: string): Promise<ParsedModule>;
  snapshot(filePath: string, source: string): Promise<ParserModuleSnapshot>;
}
```

---

### Task 1: Canonical public contracts and safe failures

**Files:**

- Create: `src/impact/types.ts`
- Create: `src/impact/canonical.ts`
- Create: `tests/unit/impact/canonical.test.ts`
- Modify: `src/security/diagnostics.ts`

**Interfaces:**

- Produces all names in **Shared Contracts**.
- Produces `PlanFailure`, whose constructor accepts `(code: PlanErrorCode, message: string, path?: string)` and whose enumerable public values are only the stable code/message/normalized relative path.
- Produces `canonicalStringify(value: unknown): string`, `sha256Hex(value: string): string`, `toPlanError(error: unknown): PlanError`, and `compareChangeKeys(a: SymbolChange, b: SymbolChange): number`.

- [ ] **Step 1: Write failing canonicalization and error-boundary tests**

Create `tests/unit/impact/canonical.test.ts` with these assertions:

```ts
expect(canonicalStringify({ z: 1, a: { d: 2, b: 3 } }))
  .toBe('{"a":{"b":3,"d":2},"z":1}');
expect(canonicalStringify({ present: 1, absent: undefined }))
  .toBe('{"present":1}');
expect(sha256Hex("stable")).toMatch(/^[0-9a-f]{64}$/);

const secret = ["sk", "proj", "A".repeat(32)].join("-");
const hostile = new Proxy(new Error("unused"), {
  get() { throw new Error(secret); },
});
expect(toPlanError(hostile)).toEqual({
  code: "PLAN_SOURCE_READ_FAILED",
  message: "Documentation impact planning failed.",
});
expect(JSON.stringify(toPlanError(hostile))).not.toContain(secret);

expect(toPlanError(new PlanFailure(
  "PLAN_PARSE_FAILED",
  "Could not parse changed supported source.",
  "src/broken.py",
))).toEqual({
  code: "PLAN_PARSE_FAILED",
  message: "Could not parse changed supported source.",
  path: "src/broken.py",
});
```

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/impact/canonical.test.ts --runInBand` and confirm module resolution fails because the new contracts/helpers do not exist.

- [ ] **Step 3: Implement exact contracts and canonical serializer**

Create `src/impact/types.ts` from **Shared Contracts**, add `PLAN_ERROR_CODES` as a readonly `Set<PlanErrorCode>`, and implement `PlanFailure` without a `cause`. Create `src/impact/canonical.ts` with recursive lexicographic object-key ordering, stable array order, omission of undefined object fields, rejection of non-finite numbers/cycles, lowercase SHA-256, and fixed fallback conversion for unknown/hostile errors. Extend `src/security/diagnostics.ts` only with the plan-code allowlist needed by CLI/MCP; never inspect arbitrary error fields beyond the guarded existing helpers.

- [ ] **Step 4: Run GREEN and regress diagnostics**

Run:

```bash
npx jest tests/unit/impact/canonical.test.ts tests/unit/security/gateway.test.ts tests/unit/mcp/security.test.ts --runInBand
npm run build
```

Expected: all selected tests pass and TypeScript emits declarations for the shared contracts.

- [ ] **Step 5: Commit**

```bash
git add src/impact/types.ts src/impact/canonical.ts src/security/diagnostics.ts tests/unit/impact/canonical.test.ts
git commit -m "feat(impact): define canonical plan contracts"
```

---

### Task 2: TypeScript and JavaScript value-free AST snapshots

**Files:**

- Modify: `src/parsers/types.ts`
- Modify: `src/parsers/typescript.ts`
- Modify: `tests/unit/parsers/typescript.test.ts`

**Interfaces:**

- Consumes: `ImpactLanguage`, `SymbolKind`, and `ContractFacet` from `src/impact/types.ts`; `sha256Hex()` from `src/impact/canonical.ts`.
- Produces: `LanguageParser.snapshot(filePath, source)` and the `ParserModuleSnapshot` / `ParserSymbolSnapshot` interfaces shown above.
- Guarantees: `.ts`, `.tsx`, `.js`, and `.jsx` snapshots use declared syntax only for contract facets; inferred undeclared types never become contract claims.

- [ ] **Step 1: Add failing TypeScript snapshot tests**

Append focused tests using in-memory source strings. Assert all of the following exact behaviors:

```ts
const first = await parser.snapshot("src/api.ts", `
  /** public docs */
  export function request(value: string = "alpha"): number {
    return value.length + 1;
  }
`);
const formatted = await parser.snapshot("src/api.ts", `
export function request(
  value: string = "alpha"
): number { return value.length + 1 }
`);
expect(formatted.symbols[0].contractFingerprint)
  .toBe(first.symbols[0].contractFingerprint);
expect(formatted.symbols[0].implementationFingerprint)
  .toBe(first.symbols[0].implementationFingerprint);
expect(formatted.symbols[0].documentationFingerprint)
  .not.toBe(first.symbols[0].documentationFingerprint);
expect(JSON.stringify(first)).not.toContain("alpha");
expect(JSON.stringify(first)).not.toContain("public docs");
```

Add separate cases proving: a parameter/default/type/return change changes `contractFingerprint` and the matching facet hash; a body literal/operator change changes only `implementationFingerprint`; comment/line movement changes no non-documentation fingerprint; import specifier changes only `dependencyFingerprint`; private/protected/`#private` members are absent; public class methods use `ClassName.method`; exported interfaces/types/enums/classes appear; overload declarations are grouped and sorted into one symbol; JavaScript inferred return changes are implementation-only; syntax diagnostics reject with the existing fixed `TypeScript syntax error.` message.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/parsers/typescript.test.ts --runInBand` and confirm failure because `snapshot()` is missing.

- [ ] **Step 3: Implement AST normalization and snapshot extraction**

In `src/parsers/typescript.ts`, create an isolated in-memory `ts-morph` source file for snapshot input. Build location/trivia-free recursive AST tuples from `SyntaxKind` plus value-bearing token text, hash internally, and return only hashes. Build contract facets from syntactically declared parameters (including optionality/rest/default-expression AST), declared return annotation, heritage clauses, public declared member shapes, and modifiers. Hash function/method bodies for implementation; hash JSDoc/comment text only into `documentationFingerprint`; hash sorted import/export module specifier AST values into `dependencyFingerprint`. Group overloads by kind/qualified name and sort their normalized declarations before hashing.

- [ ] **Step 4: Run GREEN and existing parser/analyzer regressions**

Run:

```bash
npx jest tests/unit/parsers/typescript.test.ts tests/unit/core/analyzer.test.ts tests/unit/core/cache.test.ts --runInBand
npm run build
```

Expected: snapshot matrix passes without changing the existing `parse()` public output.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/types.ts src/parsers/typescript.ts tests/unit/parsers/typescript.test.ts
git commit -m "feat(parsers): snapshot TypeScript API contracts"
```

---

### Task 3: Python value-free AST snapshots

**Files:**

- Modify: `src/parsers/python.ts`
- Modify: `tests/unit/parsers/python.test.ts`

**Interfaces:**

- Consumes: the snapshot interfaces added to `LanguageParser` in Task 2.
- Produces: `PythonParser.snapshot(filePath, source)` using Python stdlib `ast` and JSON containing hashes/metadata only.
- Guarantees: source is sent to the child parser through stdin, never a command argument, temporary filename, diagnostic, or returned JSON field.

- [ ] **Step 1: Add failing Python snapshot tests**

Add in-memory cases parallel to TypeScript:

```ts
const snapshot = await parser.snapshot("src/client.py", `
def request(value: str = "secret-default") -> int:
    """secret docs"""
    return len(value) + 1
`);
expect(snapshot.symbols[0]).toMatchObject({
  language: "python",
  kind: "function",
  qualifiedName: "request",
});
expect(JSON.stringify(snapshot)).not.toContain("secret-default");
expect(JSON.stringify(snapshot)).not.toContain("secret docs");
```

Add separate cases for formatting/line stability; positional-only, keyword-only, vararg, annotation/default changes; body-only changes; decorators/modifiers; bases; public class methods; underscore-prefixed function/class/member exclusion including dunder methods; import fingerprint changes; docstring-only changes; fixed parse failure output; and a runner failure whose stderr/source sentinel never appears.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/parsers/python.test.ts --runInBand` and confirm failure because Python `snapshot()` is missing.

- [ ] **Step 3: Implement stdin-based Python AST snapshot mode**

Refactor the embedded Python script into an operation selected by a fixed argument (`module` for existing file parsing, `snapshot` for stdin content). Use `ast.dump(..., include_attributes=False)` for location-free internal fingerprint payloads, explicitly remove docstring expression nodes from implementation payloads, compute lowercase SHA-256 inside Python, sort imports and symbol records, and return only the declared snapshot interface. Keep the current value-free Node error translation and existing `parse()` behavior.

- [ ] **Step 4: Run GREEN and parser regressions**

Run:

```bash
npx jest tests/unit/parsers/python.test.ts tests/unit/core/analyzer.test.ts tests/unit/mcp/parser-diagnostics.test.ts --runInBand
npm run build
```

Expected: Python snapshot tests and all existing fixed-diagnostic behavior pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/python.ts tests/unit/parsers/python.test.ts
git commit -m "feat(parsers): snapshot Python API contracts"
```

---

### Task 4: Planning-only configuration and budget validation

**Files:**

- Create: `src/config/planning.ts`
- Create: `tests/unit/config/planning.test.ts`
- Modify: `src/config/schema.ts`

**Interfaces:**

- Produces:

```ts
export interface PlanningConfig {
  include: string[];
  exclude: string[];
  outputDir: string;
  maxContextBytes: number;
}
export function loadPlanningConfig(
  cwd: string,
  overrideMaxContextBytes?: unknown,
): PlanningConfig;
export function parseContextBudget(value: unknown): number;
```

- Ignores `provider`, `model`, `apiKey`, `trustPolicy`, `ollamaHost`, `templates`, and all provider environment variables.
- Reads only `AIDOC_BASE_REF` later in Git selection; planning config reads no environment value.

- [ ] **Step 1: Write failing safe-loader tests**

Create fixtures with `.aidocrc.cjs` getters for provider fields that throw a credential sentinel and ordinary JSON fixtures containing safe fields. Assert safe JSON fields are selected, provider fields do not appear in output, the planning module does not import `providers/registry`, defaults match the existing include/exclude/output settings, and budgets `1024`, `12000`, and `1048576` pass while `1023`, `1048577`, `1.5`, `"1e4"`, empty strings, and non-numbers throw `PLAN_INVALID_CONTEXT_BUDGET` with a fixed value-free message.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/config/planning.test.ts --runInBand` and confirm the module is absent.

- [ ] **Step 3: Implement selected-field loading**

Use cosmiconfig only to locate/load the config object, copy safe fields after guarded own-property checks, validate string arrays/output directory, and fall back atomically to safe defaults if the file is malformed. Add `maxContextBytes: z.number().int().min(1024).max(1048576).default(12000)` to the full config schema so provider-backed commands share the same validated field, while `loadPlanningConfig` remains independent from `ConfigSchema` and provider registration.

- [ ] **Step 4: Run GREEN and configuration regressions**

Run:

```bash
npx jest tests/unit/config/planning.test.ts tests/unit/config/loader.test.ts tests/unit/config/environment.test.ts tests/unit/config/security.test.ts --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/config/planning.ts src/config/schema.ts tests/unit/config/planning.test.ts
git commit -m "feat(config): load provider-free planning settings"
```

---

### Task 5: Safe Git snapshot reader

**Files:**

- Create: `src/git/snapshot.ts`
- Create: `tests/unit/git/snapshot.test.ts`

**Interfaces:**

- Produces:

```ts
export type SnapshotFileStatus = "added" | "modified" | "deleted" | "renamed";
export interface SnapshotFileChange {
  status: SnapshotFileStatus;
  beforePath?: string;
  afterPath?: string;
  beforeSource?: string;
  afterSource?: string;
  supported: boolean;
  excluded: boolean;
}
export interface GitSnapshotSet {
  root: string; // internal only; never copied into ImpactPlan
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  files: SnapshotFileChange[];
  ignored: { unsupported: number; excluded: number };
}
export class GitSnapshotReader {
  constructor(cwd: string, env?: NodeJS.ProcessEnv);
  read(options: {
    base?: string;
    head?: string;
    include: string[];
    exclude: string[];
  }): Promise<GitSnapshotSet>;
}
```

- All Git calls use `execFile("git", args, { cwd, ... })`, fixed `--` separators, bounded buffers, and no shell.

- [ ] **Step 1: Write failing repository-fixture tests**

Use `mkdtempSync`, an empty hooks directory, and `execFileSync("git", [...])` fixtures. Cover exact candidate order (`AIDOC_BASE_REF`, the symbolic target returned for `refs/remotes/origin/HEAD`, `origin/main`, `main`, `origin/master`, `master`, `HEAD~1`, empty tree); committed branch changes plus staged, unstaged, deleted, renamed, and untracked supported files; immutable `--head`; normalized POSIX paths; included/excluded/unsupported counts; root/subdirectory invocation; repository without a parent; missing shallow base; and no automatic fetch.

Add security cases for refs beginning with `-`, refs containing `\n` or `\0`, missing base/head, worktree symlink, symlink swap simulated by an injected file-read hook, non-regular files, `../` containment attempts, and raw Git stderr/source sentinels. Expected errors use only the nine plan error codes and fixed messages; only a safe normalized supported-source path may be present.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/git/snapshot.test.ts --runInBand` and confirm the reader module is missing.

- [ ] **Step 3: Implement ref discovery and immutable/worktree reads**

Resolve repository root first. Reject unsafe refs before `rev-parse`; query `git symbolic-ref --quiet refs/remotes/origin/HEAD` and resolve its returned target rather than treating the symbolic ref text as the reported label; resolve candidates with `rev-parse --verify <ref>^{commit}`; use the empty-tree object only when `HEAD^` does not exist because the repository has no parent. When an explicit/environment-selected base is unavailable and `rev-parse --is-shallow-repository` is true, return `PLAN_SHALLOW_HISTORY` instead of trying later candidates or fetching. For committed heads use `git diff-tree --name-status -r -M`; for working tree use `git diff --name-status -M <base> --` plus `git ls-files --others --exclude-standard --`. Read Git blobs through `git show <commit>:<path>` after path validation. Read worktree files with `lstat`, `realpath`, root containment, regular-file verification, then descriptor-backed read and post-read identity verification. Match normalized paths with Node `path.matchesGlob()` against include/exclude patterns. Convert every child-process/filesystem failure to a fixed `PlanFailure` without retaining the thrown value or stderr.

- [ ] **Step 4: Run GREEN and Git consumer regressions**

Run:

```bash
npx jest tests/unit/git/snapshot.test.ts tests/unit/core/freshness.test.ts tests/unit/core/differ.test.ts --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/git/snapshot.ts tests/unit/git/snapshot.test.ts
git commit -m "feat(git): read safe comparison snapshots"
```

---

### Task 6: Symbol and module impact comparison

**Files:**

- Create: `src/impact/compare.ts`
- Create: `tests/unit/impact/compare.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ParsedFileSnapshots {
  status: SnapshotFileStatus;
  beforePath?: string;
  afterPath?: string;
  before?: ParserModuleSnapshot;
  after?: ParserModuleSnapshot;
}
export function compareSnapshots(files: ParsedFileSnapshots[]): SymbolChange[];
export function summarizeImpact(
  changes: SymbolChange[],
  documentation?: DocumentationImpact[],
): ImpactSummary;
export function digestImpactPayload(input: {
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  ignored: { unsupported: number; excluded: number };
}): string;
```

- [ ] **Step 1: Write failing comparison table tests**

Build snapshots with fixed 64-character hashes and assert each category independently: added, removed, contract-changed with sorted changed facets, implementation-changed, documentation-changed, and module dependency-changed. Assert removed is `potentially-breaking`, contract changes are `review-required`, all others are `informational`, and contract changes suppress redundant implementation records.

For a Git `renamed` status with identical snapshot fingerprints, assert one `moved` record with exact `beforeId` and `afterId`; with a renamed file plus changed symbol identity, assert removal plus addition rather than guessed rename. Assert IDs follow `language:path#kind:qualifiedName`, module IDs follow `language:path#module`, arrays use path/kind/qualified-name ordering within category priority, repeated runs have identical change digests, and plan digest excludes `context` and outer `digest`.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/impact/compare.test.ts --runInBand` and confirm the comparison exports are absent.

- [ ] **Step 3: Implement honest deterministic comparison**

Index before/after symbols by kind plus qualified name inside each file status; detect `moved` only from an explicit Git rename and identical symbol fingerprints; otherwise emit additions/removals. Compare contract first, calculate changed facet labels by hash equality, then implementation, then documentation. Emit one bounded module record when dependency fingerprints differ. Build every change digest from the canonical value-free record excluding its own digest; calculate the semantic plan digest from exactly base/head/summary/changes/documentation/ignored.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npx jest tests/unit/impact/compare.test.ts tests/unit/impact/canonical.test.ts --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/impact/compare.ts tests/unit/impact/compare.test.ts
git commit -m "feat(impact): classify public symbol changes"
```

---

### Task 7: Honest Markdown documentation mapping

**Files:**

- Create: `src/impact/documentation.ts`
- Create: `tests/unit/impact/documentation.test.ts`

**Interfaces:**

- Produces:

```ts
export interface DocumentationFile { path: string; content: string }
export interface DocumentationSection {
  file: string;
  heading: string;
  slug: string;
  body: string; // mapper-internal and never returned by the planner
}
export function indexDocumentation(
  files: DocumentationFile[],
): DocumentationSection[];
export function mapDocumentationImpact(
  changes: SymbolChange[],
  files: DocumentationFile[],
): DocumentationImpact[];
```

- [ ] **Step 1: Write failing Markdown evidence tests**

Use small Markdown strings and assert ATX/Setext headings produce GitHub-style stable slugs including duplicate suffixes. Assert direct evidence only for: exact qualified name inside backtick/fenced code, a Markdown link resolving to the exact changed source path (fragments removed), or a heading containing an exact non-generic qualified name. Assert plain prose does not count as direct evidence; names shorter than four characters and `get`, `set`, `run`, `main`, `open` do not create heading-only evidence.

Assert recommendations separately: additions/removals/contracts select an existing API doc section; potentially breaking changes select existing `CHANGELOG.md`; entrypoint (`index.*`, `main.*`, package-root public module) and dependency changes select README/architecture sections. Assert direct and recommended arrays have distinct `reason` values, missing evidence stays `unmapped: true`, and output never contains Markdown body text, absolute paths, or a seeded credential.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/impact/documentation.test.ts --runInBand` and confirm the mapper is missing.

- [ ] **Step 3: Implement a deterministic Markdown scanner**

Scan lines for ATX/Setext headings, fenced code regions, inline code spans, and link destinations; Markdown scanning may use bounded lexical helpers but never interprets source code. Normalize repository-relative link targets, sort files/sections, deduplicate references by `file#slug#reason`, and keep direct evidence and recommendations in separate arrays. Prefer an existing `docs/API.md`/API-like heading, existing `CHANGELOG.md`, README, or architecture section; do not invent a direct match or mark a recommendation as evidence.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npx jest tests/unit/impact/documentation.test.ts tests/unit/output/markdown.test.ts --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/impact/documentation.ts tests/unit/impact/documentation.test.ts
git commit -m "feat(impact): map changes to documentation"
```

---

### Task 8: Exact byte-bounded provider context

**Files:**

- Create: `src/impact/context.ts`
- Create: `tests/unit/impact/context.test.ts`

**Interfaces:**

- Produces:

```ts
export function buildImpactContext(input: {
  impactDigest: string;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  maxBytes: number;
}): { providerContext: ImpactProviderContext; report: ContextBudgetReport };
```

- `report.usedBytes` equals `Buffer.byteLength(canonicalStringify(providerContext), "utf8")` and never exceeds `maxBytes`.

- [ ] **Step 1: Write failing budget tests**

Create change records in reverse priority order and assert the selected order is removals → contracts → moves → additions → dependency → implementation → documentation. Add exact-boundary and one-byte-too-small cases; multibyte Cyrillic/emoji identifiers; complete JSON parsing; stable repeat output; total/included/omitted counts; preservation of full plan summary/digest when records are omitted; and a pathological identifier that cannot fit.

For the pathological identifier, assert the context contains one fixed compact record `{ id: change.digest, category, risk, kind, compacted: true }`, never a substring of the identifier. Recursively inspect keys/values and assert absence of `source`, `diff`, `body`, `signature`, `literal`, `docstring`, absolute worktree paths, Git stderr, and a credential sentinel.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/impact/context.test.ts --runInBand` and confirm the builder does not exist.

- [ ] **Step 3: Implement record-at-a-time budgeting**

Start with the fixed envelope/summary and zero records. Sort candidate changes by the required priority/tie key, attach only the matching `DocumentationImpact`, canonical-serialize a complete candidate context, and accept the record only if `Buffer.byteLength` remains within the limit. If a full record cannot fit, try the exact compact shape `{ id: change.digest, category, risk, kind, compacted: true }`; otherwise omit it. Never slice a string or serialized JSON. Recompute omitted counts on every accepted candidate and verify the mandatory empty envelope itself fits the validated minimum budget.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npx jest tests/unit/impact/context.test.ts tests/unit/impact/compare.test.ts --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/impact/context.ts tests/unit/impact/context.test.ts
git commit -m "feat(impact): bound provider context by bytes"
```

---

### Task 9: Single end-to-end planning core

**Files:**

- Create: `src/impact/planner.ts`
- Create: `tests/unit/impact/planner.test.ts`
- Modify: `src/parsers/registry.ts`

**Interfaces:**

- Produces:

```ts
export interface ImpactPlanOptions {
  cwd?: string;
  base?: string;
  head?: string;
  maxContextBytes?: unknown;
}
export async function createImpactPlan(
  options?: ImpactPlanOptions,
): Promise<ImpactPlanningResult>;
```

- Adds `getSnapshotParserForFile(path): LanguageParser | null` as an alias-safe registry lookup; existing parser registration remains supported.

- [ ] **Step 1: Write failing planner integration tests**

Construct temporary Git repositories with TypeScript, JavaScript, Python, README, docs, config exclusions, and committed/worktree changes. Assert a zero-option call resolves base/working-tree, parses only supported non-excluded changes, produces stable sorted plan/context/digest, reads only `README.md`, `docs/**/*.md`, configured output-dir Markdown, and existing `CHANGELOG.md`, and returns the same bytes on repeat.

Add fatal malformed TS and Python cases asserting `PLAN_PARSE_FAILED`, safe relative path, no partial plan, and no source sentinel. Add deleted/added source normal states, unsupported-only changes with zero public impact, immutable base/head commit descriptors, and a fake parser whose snapshot return contains only the declared hashes. Spy on `createProvider`, `loadCommandContext`, `resolveTemplatesDir`, and dotenv; assert none is called/imported during planning.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/impact/planner.test.ts --runInBand` and confirm `createImpactPlan` is missing.

- [ ] **Step 3: Implement planner orchestration**

Load planning config, read snapshots, immediately feed each supported source string to its registered parser, discard source-bearing change objects after snapshotting, compare, load only normalized in-root Markdown files selected by fixed/configured paths, map documentation, summarize, compute the semantic digest, build the bounded provider context, and assemble `ImpactPlan`. Convert parser errors to `PLAN_PARSE_FAILED` with only the safe repository-relative path. Keep repository root/source variables function-local and out of returned objects.

- [ ] **Step 4: Run GREEN and complete core regression set**

Run:

```bash
npx jest tests/unit/impact tests/unit/git/snapshot.test.ts tests/unit/config/planning.test.ts tests/unit/parsers --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/impact/planner.ts src/parsers/registry.ts tests/unit/impact/planner.test.ts
git commit -m "feat(impact): assemble deterministic impact plans"
```

---

### Task 10: Human and JSON `aidoc plan` CLI

**Files:**

- Create: `src/output/impact.ts`
- Create: `src/cli/commands/plan.ts`
- Create: `tests/unit/output/impact.test.ts`
- Create: `tests/unit/cli/plan.test.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/context.ts`
- Modify: `src/config/loader.ts`

**Interfaces:**

- Produces `formatImpactPlan(plan: ImpactPlan, verbose?: boolean): string`, `serializePlanCommandResult(result: PlanCommandResult): string`, `executePlanCommand(options, io, cwd): Promise<0 | 1>`, and `loadProviderConfig(searchFrom?: string): AidocConfig`.
- Commander options are exactly `--base <ref>`, `--head <ref>`, `--json`, and `--max-context-bytes <count>`; global `--verbose` adds resolved base/head only in human mode.

- [ ] **Step 1: Write failing formatter and CLI tests**

Assert human output starts with `Documentation impact: N public API changes`, shows potentially breaking count only when nonzero, lists direct/recommended docs without conflating labels, states unmapped count, shows `Context: used / max bytes`, ends with `Next: aidoc update`, and includes base/head only when verbose. Assert zero-impact output is short and actionable.

Invoke the built command handler with captured stdout/stderr. Assert no flags/no key succeeds; `--json` stdout parses as exactly one `{ ok: true, plan: { schemaVersion: "aidoc.impact-plan.v1", ... } }` object, has no ANSI/spinner/log prefix, and writes diagnostics nowhere on success; JSON failure emits exactly `{ok:false,error}` to stdout and exit `1`; human failure writes only safe code/message to stderr; invalid budgets/refs fail before Git content reads; and provider/context/template/dotenv spies have zero calls.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts --runInBand` and confirm formatter/command modules are absent.

- [ ] **Step 3: Implement projections and provider-lazy bootstrap**

Keep output functions pure. Register `planCommand` in `src/cli/index.ts`; remove top-level `dotenv.config()`. Add `loadProviderConfig()` in `src/config/loader.ts`; it runs `dotenv.config({ quiet: true })` immediately before full `loadConfig()`. Use that helper from `loadCommandContext()` and later from provider-backed MCP cases so only provider-backed commands inspect provider environment. In the plan action, call only `createImpactPlan`, translate `PlanFailure` with `toPlanError`, set `process.exitCode` rather than calling `process.exit`, and use canonical command-result serialization.

- [ ] **Step 4: Run GREEN plus all CLI/config tests**

Run:

```bash
npx jest tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts tests/unit/cli tests/unit/config --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/output/impact.ts src/cli/commands/plan.ts src/cli/index.ts src/cli/context.ts src/config/loader.ts tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts
git commit -m "feat(cli): add zero-config impact planning"
```

---

### Task 11: Repository-scoped MCP planning parity

**Files:**

- Modify: `src/mcp/server.ts`
- Create: `tests/unit/mcp/impact-plan.test.ts`
- Modify: `tests/unit/mcp/security.test.ts`

**Interfaces:**

- Adds MCP tool `plan_documentation_impact` with optional `base`, `head`, and integer `max_context_bytes`; no `directory` input.
- Changes `handleToolCall(name, args, serverCwd = process.cwd())` and `createMCPServer(serverCwd = process.cwd())` so planning is locked to the server startup repository.

- [ ] **Step 1: Write failing MCP contract tests**

Assert `TOOLS` advertises the exact input schema and no directory property. Mock `createImpactPlan` and assert snake-case input maps to core options and returned value is exactly `result.plan`. Run CLI JSON and direct MCP planning against the same immutable base/head fixture, unwrap the CLI envelope's `plan`, and deep-equal the two `ImpactPlan` objects. Assert a supplied extra `directory` is ignored/rejected by schema and cannot expand scope, provider/config/template construction has zero calls, parse failures use allowlisted plan codes with sanitized fixed messages, and hostile error getters return `Unknown MCP error.`.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/mcp/impact-plan.test.ts --runInBand` and confirm the tool is not registered.

- [ ] **Step 3: Implement startup-directory planning**

Capture `serverCwd` when the server is constructed and pass it to `handleToolCall`. Move the current unconditional configuration load inside only the existing tools that need it, using `loadProviderConfig()` for generation tools and provider-free config where appropriate for AST-only tools. Add plan codes to `SAFE_MCP_ERROR_CODES`, call the shared planner for the planning tool, return the public plan only, and preserve existing MCP error sanitization.

- [ ] **Step 4: Run GREEN and MCP unit tests**

Run:

```bash
npx jest tests/unit/mcp --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/unit/mcp/impact-plan.test.ts tests/unit/mcp/security.test.ts
git commit -m "feat(mcp): expose repository impact planning"
```

---

### Task 12: Replace raw-diff update context with the bounded plan

**Files:**

- Modify: `src/core/differ.ts`
- Modify: `src/core/generator.ts`
- Modify: `src/cli/mock-generator.ts`
- Modify: `src/cli/commands/update.ts`
- Modify: `src/templates/update.hbs`
- Modify: `tests/unit/core/differ.test.ts`
- Modify: `tests/unit/core/generator.test.ts`
- Create: `tests/unit/cli/update-impact.test.ts`

**Interfaces:**

- Replaces `UpdateContext.diffSummary` / `changedFiles` with:

```ts
export interface UpdateContext {
  existingDoc: string;
  impactPlan: ImpactProviderContext;
}
export function buildUpdateContext(
  existingDoc: string,
  impactPlan: ImpactProviderContext,
): UpdateContext;
```

- `Generator.generateUpdate(context: UpdateContext)` renders the existing document separately from safe selected impact records, and the complete rendered prompt still passes through `TrustGateway`.

- [ ] **Step 1: Write failing raw-source/diff regression tests**

Use a recording `LLMProvider` and a Git fixture whose raw TypeScript body/default/comment/diff contain distinct sentinels. Run update planning and generation; assert provider prompt contains the safe symbol ID/category/risk/facet/doc target and contains none of the sentinels, raw diff markers, full signature, or absolute root. Assert `Buffer.byteLength(canonicalStringify(impactPlan), "utf8") <= maxBytes`.

Add cases proving planner failure causes zero `loadCommandContext`/provider calls; zero documentation impact stops with a concise message and zero provider calls; `--base` works; `--since` maps to base; equal alias values work; conflicting values fail; dry-run/preview confirmation remains; Trust Gate strict rejection remains exit `2`; and mock update consumes the same safe context shape.

- [ ] **Step 2: Run RED**

Run `npx jest tests/unit/core/differ.test.ts tests/unit/core/generator.test.ts tests/unit/cli/update-impact.test.ts --runInBand` and confirm the old diff-shaped API fails the new assertions.

- [ ] **Step 3: Implement plan-first update flow**

Run `createImpactPlan()` before `loadCommandContext()`. Display the same concise summary, stop when the plan has neither direct references nor recommendations/unmapped public impact requiring review, then read the target document and construct the provider only when generation is needed. Remove `getDiff()` from the normal path. Update Handlebars to iterate `impactPlan.changes` and matching documentation references with only ID/category/risk/changed facet/target fields; keep `existingDoc` as its own Trust Gate input. Preserve `getDiff` in `src/git/history.ts` only for any remaining non-provider consumer.

- [ ] **Step 4: Run GREEN plus update/security regressions**

Run:

```bash
npx jest tests/unit/core/differ.test.ts tests/unit/core/generator.test.ts tests/unit/cli/update-impact.test.ts tests/unit/cli/commands.test.ts tests/unit/security/gateway.test.ts --runInBand
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/core/differ.ts src/core/generator.ts src/cli/mock-generator.ts src/cli/commands/update.ts src/templates/update.hbs tests/unit/core/differ.test.ts tests/unit/core/generator.test.ts tests/unit/cli/update-impact.test.ts
git commit -m "feat(update): consume bounded impact plans"
```

---

### Task 13: No-key demo, packed smoke, onboarding, and prerelease metadata

**Files:**

- Create: `scripts/demo-impact.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/e2e/package-smoke.mjs`
- Modify: `tests/e2e/mcp-smoke.mjs`
- Modify: `README.md`

**Interfaces:**

- Produces `runImpactDemo({ cliPath, quiet }): Promise<{ human: string; plan: object }>` from `scripts/demo-impact.mjs` and a direct-execution main block.
- Adds `npm run demo:impact` and `npm run test:impact-demo`; release verification invokes the demo after build.

- [ ] **Step 1: Add failing packed/demo assertions**

Extend package smoke to initialize a temporary Git repository, run the installed tarball CLI `plan` with all provider credential variables removed, parse clean JSON, verify one contract change plus one implementation change, and call `runImpactDemo` with the packed CLI. Extend MCP smoke to find `plan_documentation_impact`, call it for the fixture base/head, and deep-equal the result to packed CLI JSON. Assert the demo human output includes the concise headline/context/next action and its JSON result has no raw source/diff sentinel.

- [ ] **Step 2: Run RED**

Run:

```bash
npm run build
node tests/e2e/package-smoke.mjs
node tests/e2e/mcp-smoke.mjs
```

Expected: failures because the demo script/commands and MCP smoke assertions are not yet implemented.

- [ ] **Step 3: Implement deterministic demo and release scripts**

Create a temporary repository with fixed Git author data and disabled hooks, commit a small exported TypeScript API plus README direct reference, change one declared parameter and one separate function body, run the supplied built CLI in human and `--json` modes via `execFile`, validate outputs, print them unless `quiet`, and remove the repository in `finally`. Add:

```json
"demo:impact": "npm run build && node scripts/demo-impact.mjs",
"test:impact-demo": "node scripts/demo-impact.mjs --verify"
```

Place `npm run test:impact-demo` after `npm run build` inside `verify:release`. Align `package.json` and lockfile package version to `0.2.0-beta.2` without a Git tag.

- [ ] **Step 4: Write precise README onboarding**

Make the Quick Start lead with:

```bash
npx aidoc-gen plan
npx aidoc-gen update --dry-run
npx aidoc-gen plan --json
```

Document zero-key planning, base discovery, `--base`/`--head`/byte budget, `AIDOC_BASE_REF`, human versus versioned JSON, MCP tool scope, `npm run demo:impact`, `--since` compatibility, and that the planner detects structured public-code changes plus deterministic references but does not prove semantic documentation correctness. State explicitly that raw source/diff/credentials are excluded from provider impact context and that parse failures stop updates.

- [ ] **Step 5: Run GREEN package/demo/MCP gates**

Run:

```bash
npm run build
npm run test:impact-demo
npm run test:package
npm run test:mcp
```

Expected: local and packed no-key planning/demo pass; packed CLI and MCP return the same plan for immutable snapshots.

- [ ] **Step 6: Commit**

```bash
git add scripts/demo-impact.mjs package.json package-lock.json tests/e2e/package-smoke.mjs tests/e2e/mcp-smoke.mjs README.md
git commit -m "docs(impact): ship no-key planning workflow"
```

---

### Task 14: Full verification, independent review, and draft PR checkpoint

**Files:**

- Modify only files required by verified findings from independent reviewers.
- Update the existing draft PR body through GitHub after local verification and push; keep it draft/private.

**Interfaces:**

- Consumes the entire branch diff from plan commit through Task 13.
- Produces no new feature contract; this is the release-quality gate.

- [ ] **Step 1: Run the complete local gate from a clean build**

Run exactly:

```bash
npm run verify:release
node dist/cli/index.js score --min 80 --json
git diff --check
git status --short
```

Record exact suite/test counts, build/smoke results, score JSON, and worktree status in the SDD ledger/review package.

- [ ] **Step 2: Re-run explicit acceptance probes**

Run the demo with provider credential variables absent, human `aidoc plan`, JSON `aidoc plan --json`, immutable base/head CLI, MCP planning, malformed supported-source plan/update, oversized/multibyte context fixtures, and recording-provider update regression. Record evidence that provider construction count is zero for plan/failure/no-impact, byte count never exceeds the selected ceiling, CLI/MCP share one digest/plan, and packed smoke includes the new command.

- [ ] **Step 3: Request independent whole-branch review**

Use `requesting-code-review` with an xhigh `gpt-5.6-sol` reviewer over the full implementation range. Require separate Critical/Important/Minor findings for AST/fingerprint correctness, Git ref/path/symlink safety, deterministic contracts/budgeting, documentation attribution, provider boundary, CLI/MCP parity, update compatibility, and test/release coverage.

- [ ] **Step 4: Resolve findings through one TDD fix round and scoped re-review**

For each accepted feature/bug finding, write a regression test and observe RED, implement the smallest fix, rerun the focused suite, then request a scoped re-review. If a finding is rejected, record the concrete code/test evidence in the ledger. Do not weaken security or determinism assertions to make tests pass.

- [ ] **Step 5: Re-run final verification after the last fix**

Run again:

```bash
npm run verify:release
node dist/cli/index.js score --min 80 --json
git diff --check
git status --short
```

Expected: every command succeeds; status contains no uncommitted implementation change.

- [ ] **Step 6: Commit only if review produced changes**

```bash
git add -u
git diff --cached --name-only
git commit -m "fix(impact): address final review findings"
```

Skip this commit when the final review is clean; never create an empty commit.

- [ ] **Step 7: Push and update the existing draft PR**

Push `codex/release-integrity` to its existing remote branch, wait for hosted Node 22/24 CI, and update draft PR #2 with actual commits, exact local/hosted test results, security/provider-context guarantees, demo commands, and remaining limitations. Do not mark ready, merge, tag, release, publish, or change repository visibility.

- [ ] **Step 8: Produce final orchestrator handoff**

Report created commits, completed tasks, exact local test counts, reviewer verdicts/fix rounds, hosted CI URLs/status, open risks, final `HEAD`, ahead/behind state against `origin/codex/release-integrity`, and the recommended next stage.
