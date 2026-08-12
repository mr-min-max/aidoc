# Provider-Free MCP Update Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` task-by-task and
> `superpowers:verification-before-completion` before the terminal report. This
> dependent SUBCULTURE worker starts only after the curator accepts Smart Plan
> to Update; do not create agents, threads, or worktrees.

**Goal:** Let Codex and Claude prepare and validate an AiDoc-guided Markdown
update through local MCP without AiDoc constructing an LLM provider, receiving
subscription credentials, or writing a file.

**Architecture:** Prompt rendering is extracted from `Generator` into a shared
template-driven update-preparation service. MCP preparation resolves one safe
target, inspects the exact returned generation envelope, and issues a signed
opaque preparation token. Validation verifies and recomputes the token inputs,
inspects candidate output, validates Markdown, and returns approved content plus
a bounded diff summary; the host performs any write.

**Tech Stack:** TypeScript, Handlebars, Node crypto, existing Trust Gateway,
repository writer, impact planner/target resolver, diff, MCP SDK, Jest.

## Global Constraints

- Prerequisite: accepted interfaces from
  `docs/superpowers/plans/2026-08-12-smart-plan-update.md` are present. If target
  resolver names/types differ, stop and ask Sol rather than creating a second
  resolver.
- Read first: `AGENTS.md`, accepted hybrid spec, `src/core/generator.ts`,
  `src/security/gateway.ts`, `src/mcp/server.ts`, MCP tests, target resolver, and
  `src/templates/update.hbs`.
- Do not edit provider profiles/transports/selection, CLI commands,
  `package.json`, lockfiles, README, or beta docs.
- New MCP tools accept no caller-supplied directory and always use the server's
  pinned startup repository.
- Preparation and validation construct no LLM provider and make no provider
  network request.
- MCP tools never write, create, rename, delete, chmod, or mkdir repository
  content.
- Returned preparation data contains no raw source, raw Git diff, credential,
  absolute local path, or unscanned existing-document text.
- The Trust Gate claim is scoped to data AiDoc returns. Do not claim control of
  other host tools or repository context.
- A candidate must validate before host write. A changed plan or target snapshot
  produces a stale-preparation failure; there is no force bypass.
- The shared SUBCULTURE checkout has one Git index. Do not stage, commit, switch
  branches, reset, clean, or checkout. Treat commit steps below as curator
  checkpoints and report exact changed paths.

---

## Task 1: Shared update prompt preparation and provider-free Trust inspection

**Files:**

- Create: `src/core/update-preparation.ts`
- Modify: `src/core/generator.ts`
- Modify: `src/security/gateway.ts`
- Create: `tests/unit/core/update-preparation.test.ts`
- Modify: `tests/unit/core/generator.test.ts`
- Modify: `tests/unit/security/gateway.test.ts`

**Interfaces:**

```ts
export interface UpdateGenerationEnvelope {
  readonly operation: "update";
  readonly systemPrompt: string;
  readonly prompt: string;
}

export function renderUpdateGenerationEnvelope(input: {
  templatesDir: string;
  existingDoc: string;
  impactPlan: ImpactProviderContext;
}): UpdateGenerationEnvelope;

export interface ApprovedTrustInput {
  readonly systemPrompt: string;
  readonly prompt: string;
}

// Public methods on TrustGateway; generate()/generateStream() reuse them.
approveInputEnvelope(envelope: ContextEnvelope): ApprovedTrustInput;
approveOutputEnvelope(envelope: ContextEnvelope, output: unknown): string;
```

- [ ] **Step 1: Write failing parity tests**

Use a recording provider to prove `Generator.generateUpdate()` sends exactly
the same approved system/prompt bytes as
`renderUpdateGenerationEnvelope()` followed by Trust approval. Existing doc
redaction, provider-context projection, and template output must not be
duplicated in two implementations.

- [ ] **Step 2: Write failing public-inspection tests**

Assert strict input blocks before any provider method, redact returns only
redacted input, output inspection rejects non-string and strict secret output,
and event metadata contains only stage/action/finding kind/count.

- [ ] **Step 3: Run tests and verify RED**

Run:
`npm test -- tests/unit/core/update-preparation.test.ts tests/unit/core/generator.test.ts tests/unit/security/gateway.test.ts --runInBand`

Expected: FAIL because prompt rendering and inspection are private to
`Generator`/`TrustGateway`.

- [ ] **Step 4: Extract one template-driven implementation**

Compile `update.hbs` in `update-preparation.ts` and keep the existing
target-projection shape. `Generator.generateUpdate()` calls the shared renderer,
then `TrustGateway.generate()`; it must not bypass the complete-envelope input
inspection.

Expose the two Trust approval methods without exposing the redaction session or
adding arbitrary callbacks/transforms. `approveOutputEnvelope()` still requires
a string and emits safe events.

- [ ] **Step 5: Verify and commit Task 1**

Run the Step 3 command; expect PASS.

```bash
git add src/core/update-preparation.ts src/core/generator.ts src/security/gateway.ts tests/unit/core/update-preparation.test.ts tests/unit/core/generator.test.ts tests/unit/security/gateway.test.ts
git commit -m "refactor: share inspected update preparation"
```

## Task 2: Signed opaque preparation token and safe diff summary

**Files:**

- Create: `src/mcp/preparation-token.ts`
- Create: `src/output/diff-summary.ts`
- Create: `tests/unit/mcp/preparation-token.test.ts`
- Create: `tests/unit/output/diff-summary.test.ts`

**Interfaces:**

```ts
export const MCP_PREPARATION_SCHEMA = "aidoc.mcp-preparation.v1" as const;

export interface PreparationClaims {
  readonly schemaVersion: typeof MCP_PREPARATION_SCHEMA;
  readonly planDigest: string;
  readonly base?: string;
  readonly head?: string;
  readonly maxContextBytes: number;
  readonly target: string;
  readonly targetDigest: string;
}

export class PreparationTokenCodec {
  constructor(secret: Uint8Array);
  issue(claims: PreparationClaims): string;
  verify(token: string): PreparationClaims;
}

export interface SafeDiffSummary {
  readonly changed: boolean;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly oldBytes: number;
  readonly newBytes: number;
}

export function summarizeTextDiff(
  before: string,
  after: string,
): SafeDiffSummary;
```

- [ ] **Step 1: Write failing token tests**

Assert deterministic claims canonicalization, round trip, changed payload,
changed signature, wrong secret, malformed segments/base64/JSON, duplicate or
extra claims, overlong token, invalid digest/path/budget, and timing-safe MAC
comparison. Public failures use only `MCP_INVALID_PREPARATION`.

- [ ] **Step 2: Write failing diff-summary tests**

Cover unchanged text, add/remove/replace, CRLF/LF, Unicode byte counts, and a
large document. Output must contain counts only: no line text, absolute path,
secret, prompt, or candidate content.

- [ ] **Step 3: Run tests and verify RED**

Run:
`npm test -- tests/unit/mcp/preparation-token.test.ts tests/unit/output/diff-summary.test.ts --runInBand`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement bounded HMAC token**

Use `HMAC-SHA-256` and a per-MCP-process random 32-byte secret. Token format is
`v1.<base64url canonical claims>.<base64url mac>`, maximum 4096 characters.
Verify exact own data properties and claim types before use. A restarted server
may invalidate an in-flight token; document this as safe re-prepare behavior.

- [ ] **Step 5: Verify and commit Task 2**

Run the Step 3 command; expect PASS.

```bash
git add src/mcp/preparation-token.ts src/output/diff-summary.ts tests/unit/mcp/preparation-token.test.ts tests/unit/output/diff-summary.test.ts
git commit -m "feat: bind MCP drafts to signed preparations"
```

## Task 3: Repository-scoped prepare and validate MCP tools

**Files:**

- Create: `src/mcp/update-workflow.ts`
- Modify: `src/mcp/server.ts`
- Create: `tests/unit/mcp/update-workflow.test.ts`
- Modify: `tests/unit/mcp/security.test.ts`
- Modify: `tests/unit/mcp/impact-plan.test.ts`

**Interfaces and protocol:**

Advertise these exact tool names:

```ts
prepare_documentation_update;
validate_documentation_draft;
```

Prepare input schema:

```json
{
  "type": "object",
  "properties": {
    "base": { "type": "string" },
    "head": { "type": "string" },
    "max_context_bytes": {
      "type": "integer",
      "minimum": 1024,
      "maximum": 1048576
    },
    "target": { "type": "string" }
  },
  "additionalProperties": false
}
```

Validate input schema requires string `preparation_digest`, string `target`,
and string `candidate_markdown`, with `additionalProperties: false`.

Prepare output schema value:

```ts
{
  schema_version: "aidoc.mcp-update-preparation.v1";
  preparation_digest: string;
  target: string;
  generation: { system_prompt: string; prompt: string };
  context: ContextBudgetReport;
  trust: { policy: TrustPolicy; action: string; findings: FindingSummary[] };
  instructions: readonly string[];
}
```

Validate output schema value:

```ts
{
  schema_version: "aidoc.mcp-draft-validation.v1";
  valid: boolean;
  target: string;
  approved_markdown?: string;
  markdown_warnings: readonly string[];
  diff: SafeDiffSummary;
  trust: { policy: TrustPolicy; action: string; findings: FindingSummary[] };
}
```

- [ ] **Step 1: Write failing exact-schema tests**

Assert no `directory`, `output`, write, or credential fields; exact byte-budget
bounds; and non-mutating tool names. Add both new fixed safe error codes to the
MCP allowlist: `MCP_TARGET_REQUIRED` and `MCP_INVALID_PREPARATION`.

- [ ] **Step 2: Write failing prepare workflow tests**

Cover no impact, one automatic target, multiple candidates without explicit
target, explicit safe target, forged/unsafe target, missing target, secret in
existing Markdown under redact and strict policies, hostile accessors, bounded
context, no provider config/registry/template escape, and a byte-for-byte tree
snapshot proving no mutation.

When several candidates exist, prepare returns `MCP_TARGET_REQUIRED` with safe
relative candidate paths and no provider construction. It never prompts over
stdio MCP.

- [ ] **Step 3: Write failing validate workflow tests**

Cover valid candidate, invalid Markdown, strict/redacted secret output, wrong
target, forged token, plan change, source change, target change, target symlink
swap, absolute path, and no writes. Validation recomputes plan using claims and
re-prepares the target; it compares plan digest, target display path, and SHA-256
target snapshot digest before inspecting candidate output.

- [ ] **Step 4: Run tests and verify RED**

Run:
`npm test -- tests/unit/mcp/update-workflow.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/impact-plan.test.ts --runInBand`

Expected: FAIL because tool schemas/handlers do not exist.

- [ ] **Step 5: Implement a per-server execution context**

Create one `PreparationTokenCodec(randomBytes(32))` in `createMCPServer()` and
pass it with the pinned `serverCwd` into both handlers. Preserve a deterministic
injectable codec for unit tests. Existing `handleToolCall(name,args,cwd)` test
usage may use one module-local codec, but production server instances must not
share secrets.

Preparation uses accepted target resolution, target-specific provider context,
shared update envelope rendering, and `approveInputEnvelope()`. Validation uses
`approveOutputEnvelope()` before `validateMarkdown()`. Return the approved
candidate only when valid; never return the unapproved candidate.

- [ ] **Step 6: Verify and commit Task 3**

Run the Step 4 command; expect PASS.

```bash
git add src/mcp/update-workflow.ts src/mcp/server.ts tests/unit/mcp/update-workflow.test.ts tests/unit/mcp/security.test.ts tests/unit/mcp/impact-plan.test.ts
git commit -m "feat: add provider-free MCP update workflow"
```

## Task 4: MCP process and packed-package smoke

**Files:**

- Modify: `tests/e2e/mcp-smoke.mjs`
- Modify: `tests/e2e/package-smoke.mjs`
- Modify: `tests/e2e/smoke-tarball.mjs`

- [ ] **Step 1: Add a failing process-level prepare/validate round trip**

Start the built MCP server in a temporary Git fixture with all provider env
variables removed. Use JSON-RPC to list tools, prepare one update, validate a
candidate, and prove fixture hashes are unchanged. Send a modified token and
expect a fixed MCP error.

- [ ] **Step 2: Run build/MCP smoke and verify RED**

Run: `npm run build && npm run test:mcp`

Expected: FAIL until new tool schemas survive the compiled entry point.

- [ ] **Step 3: Extend tarball smoke**

Install the packed tarball in an isolated fixture, start `aidoc --mcp`, and
repeat tool listing plus one prepare/validate call. Assert `update.hbs` is
present and no source-checkout path appears in responses.

- [ ] **Step 4: Verify the entire slice**

Run:

```bash
npm test -- tests/unit/core/update-preparation.test.ts tests/unit/security/gateway.test.ts tests/unit/mcp tests/unit/output/diff-summary.test.ts --runInBand
npx tsc --noEmit
npm run build
npm run test:mcp
npm run test:package
```

Expected: every command exits `0`, no provider key is set, and no paid request
occurs.

- [ ] **Step 5: Inspect scope and commit Task 4**

```bash
git add tests/e2e/mcp-smoke.mjs tests/e2e/package-smoke.mjs tests/e2e/smoke-tarball.mjs
git commit -m "test: prove provider-free MCP package workflow"
```
