# Provider Trust Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-agnostic Trust Gate that detects, redacts, or blocks high-confidence secrets immediately before every LLM call and immediately after every LLM response.

**Architecture:** Keep `LLMProvider` as the transport extension point and place one `TrustGateway` inside `Generator`, after final Handlebars rendering. A per-generator redaction session supplies stable typed placeholders, completed streaming output is buffered before callbacks, and sanitized value-free events form the later receipt boundary.

**Tech Stack:** TypeScript 6, Node.js >=22.12.0, CommonJS, Jest/ts-jest, Zod 4, Commander, Bash, existing `LLMProvider` and Handlebars templates.

## Global Constraints

- Keep AST extraction deterministic and ahead of every LLM operation.
- Access all LLMs through the existing `LLMProvider` interface; registered third-party providers must receive the same Trust Gate.
- Keep generation prompt text in `src/templates/`; do not add large inline prompts.
- Use `redact` as the default policy. `strict` prevents provider calls and output callbacks; `warn` is explicit and permissive.
- Placeholders reveal no secret prefix, suffix, length, hash, or other secret-derived information.
- Never include secret values, prompts, responses, raw provider errors, or absolute paths in Trust events or test snapshots.
- Buffer streaming output until the completed response is scanned; token-by-token display may be restored only by a later stateful design.
- Retain config-file `apiKey` for one beta compatibility window, warn without printing it, prefer provider-specific environment variables, and remove plaintext config recommendations.
- Use seeded fake credentials assembled at test runtime. Never read or print credentials from Git configuration or the host environment.
- Follow red-green-refactor for every behavior change and keep Node 22/24 release verification intact.
- This plan does not implement filesystem containment, MCP directory authorization, the security doctor, or persisted receipts. Those are separate approved slices from `docs/superpowers/specs/2026-07-31-trust-gate-design.md`.

---

## File Structure

### New files

- `src/security/types.ts` — public policy, envelope, finding-summary, event, and typed-error contracts.
- `src/security/scanner.ts` — high-confidence detectors, overlap handling, stable per-run placeholders, and diagnostic sanitization.
- `src/security/gateway.ts` — input/output policy enforcement around one `LLMProvider` transport.
- `tests/unit/security/scanner.test.ts` — detector, policy, false-positive, and value-leak tests.
- `tests/unit/security/gateway.test.ts` — provider call, output, event, strict, and streaming behavior.
- `tests/unit/config/security.test.ts` — policy override and legacy-key deprecation behavior.
- `tests/unit/mcp/security.test.ts` — MCP Generator construction uses the effective policy and MCP origin.

### Modified files

- `src/core/generator.ts` — route all six operations and streaming through `TrustGateway`.
- `src/config/schema.ts` — add validated `trustPolicy` with default `redact`.
- `src/config/loader.ts` — read `AIDOC_TRUST_POLICY`, warn on file credentials, and keep warnings value-free.
- `src/providers/registry.ts` — prefer provider-specific environment credentials and remove config-file recommendations.
- `src/core/retry.ts` — redact high-confidence secrets from retry diagnostics.
- `src/cli/context.ts` — pass CLI/Action origin and effective policy into `Generator`.
- `src/cli/commands/annotate.ts` — stop echoing raw malformed provider output.
- `src/mcp/server.ts` — construct `Generator` with MCP origin and effective policy.
- `action.yml` / `action/run.sh` — expose a validated Action trust policy, defaulting to `strict`.
- `README.md` / `ROADMAP.md` / `docs/releases/v0.1.1.md` — document the in-progress beta boundary without claiming the later filesystem, MCP-allowlist, doctor, or receipt slices are shipped.
- Existing generator, config, provider-registry, retry, Action, and MCP tests — cover the new integration seams.

---

### Task 1: Detect secrets and apply deterministic policies

**Files:**

- Create: `src/security/types.ts`
- Create: `src/security/scanner.ts`
- Create: `tests/unit/security/scanner.test.ts`

**Interfaces:**

- Produces: `TRUST_POLICIES`, `TrustPolicy`, `SecretKind`, `FindingSummary`, `TrustViolationError`.
- Produces: `RedactionSession.placeholder(kind: SecretKind, value: string): string`.
- Produces: `applySecretPolicy(text: string, policy: TrustPolicy, session: RedactionSession): TrustTextResult`.
- Produces: `sanitizeDiagnostic(text: string): string`.

- [ ] **Step 1: Write the failing scanner contract tests**

Create `tests/unit/security/scanner.test.ts` with runtime-built fake values so
the repository never contains a complete credential literal:

```ts
import {
  RedactionSession,
  applySecretPolicy,
  sanitizeDiagnostic,
} from "../../../src/security/scanner";
import { TrustViolationError } from "../../../src/security/types";

const fakeOpenAiKey = ["sk", "proj", "A".repeat(32)].join("-");
const fakeAnthropicKey = ["sk", "ant", "B".repeat(32)].join("-");
const fakeGithubToken = `ghp_${"C".repeat(36)}`;

describe("applySecretPolicy", () => {
  it("redacts provider tokens with stable typed placeholders", () => {
    const session = new RedactionSession();
    const result = applySecretPolicy(
      `${fakeOpenAiKey}\nagain=${fakeOpenAiKey}\n${fakeAnthropicKey}`,
      "redact",
      session,
    );

    expect(result.text).toBe(
      "<AIDOC_REDACTED:OPENAI_API_KEY:1>\n" +
        "again=<AIDOC_REDACTED:OPENAI_API_KEY:1>\n" +
        "<AIDOC_REDACTED:ANTHROPIC_API_KEY:1>",
    );
    expect(result.findings).toEqual([
      { kind: "openai_api_key", count: 2 },
      { kind: "anthropic_api_key", count: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain(fakeOpenAiKey);
  });

  it("blocks strict content without returning the value", () => {
    const session = new RedactionSession();
    let thrown: unknown;
    try {
      applySecretPolicy(fakeGithubToken, "strict", session);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TrustViolationError);
    expect((thrown as TrustViolationError).code).toBe("TRUST_SECRET_BLOCKED");
    expect(String(thrown)).not.toContain(fakeGithubToken);
  });

  it("warns without changing the original text", () => {
    const session = new RedactionSession();
    const result = applySecretPolicy(fakeOpenAiKey, "warn", session);
    expect(result.text).toBe(fakeOpenAiKey);
    expect(result.action).toBe("warned");
  });

  it("detects private keys, credential URLs, named secrets, and sensitive paths", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "ZmFrZS10ZXN0LWtleQ==",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const input = [
      privateKey,
      "https://build-user:fake-password@example.invalid/repo",
      "clientSecret=fake-client-secret-value",
      "changed: .env.production",
    ].join("\n");
    const result = applySecretPolicy(input, "redact", new RedactionSession());

    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "private_key",
      "credential_url",
      "named_secret",
      "sensitive_path",
    ]);
    expect(result.text).not.toContain("fake-password");
    expect(result.text).not.toContain("fake-client-secret-value");
  });

  it("does not treat ordinary identifiers and documentation examples as secrets", () => {
    const input = [
      "tokenCount = 42",
      "passwordPolicy = strict",
      ".env.example",
      "https://example.invalid/docs",
      "const apiKeyName = 'OPENAI_API_KEY'",
    ].join("\n");
    const result = applySecretPolicy(input, "redact", new RedactionSession());
    expect(result).toEqual({ text: input, findings: [], action: "allowed" });
  });

  it("sanitizes diagnostics regardless of the configured request policy", () => {
    const diagnostic = `provider rejected ${fakeOpenAiKey}`;
    const safe = sanitizeDiagnostic(diagnostic);
    expect(safe).toContain("<AIDOC_REDACTED:OPENAI_API_KEY:1>");
    expect(safe).not.toContain(fakeOpenAiKey);
  });
});
```

- [ ] **Step 2: Run the scanner tests and verify RED**

Run:

```bash
npx jest tests/unit/security/scanner.test.ts --runInBand
```

Expected: FAIL because `src/security/scanner.ts` and `types.ts` do not exist.

- [ ] **Step 3: Add the exact public trust contracts**

Create `src/security/types.ts`:

```ts
export const TRUST_POLICIES = ["warn", "redact", "strict"] as const;
export type TrustPolicy = (typeof TRUST_POLICIES)[number];

export type SecretKind =
  | "openai_api_key"
  | "anthropic_api_key"
  | "github_token"
  | "private_key"
  | "credential_url"
  | "named_secret"
  | "sensitive_path";

export interface FindingSummary {
  kind: SecretKind;
  count: number;
}

export interface TrustTextResult {
  text: string;
  findings: FindingSummary[];
  action: "allowed" | "warned" | "redacted";
}

export class TrustViolationError extends Error {
  readonly code = "TRUST_SECRET_BLOCKED" as const;

  constructor(readonly findings: FindingSummary[]) {
    super(
      `Trust Gate blocked ${findings.reduce((sum, item) => sum + item.count, 0)} secret finding(s): ${findings.map((item) => item.kind).join(", ")}`,
    );
    this.name = "TrustViolationError";
  }
}
```

- [ ] **Step 4: Implement ordered matching and stable redaction**

Create `src/security/scanner.ts` with these exact exports:

```ts
import {
  FindingSummary,
  SecretKind,
  TrustPolicy,
  TrustTextResult,
  TrustViolationError,
} from "./types";

interface SecretMatch {
  kind: SecretKind;
  start: number;
  end: number;
  value: string;
  priority: number;
}

export class RedactionSession {
  private readonly values = new Map<SecretKind, Map<string, number>>();

  placeholder(kind: SecretKind, value: string): string {
    const byValue = this.values.get(kind) ?? new Map<string, number>();
    this.values.set(kind, byValue);
    if (!byValue.has(value)) byValue.set(value, byValue.size + 1);
    return `<AIDOC_REDACTED:${kind.toUpperCase()}:${byValue.get(value)}>`;
  }
}

export function applySecretPolicy(
  text: string,
  policy: TrustPolicy,
  session: RedactionSession,
): TrustTextResult;

export function sanitizeDiagnostic(text: string): string;
```

Use fresh global regular expressions per call for these detector families:

```ts
const providerPatterns: ReadonlyArray<{
  kind: SecretKind;
  pattern: RegExp;
  priority: number;
}> = [
  {
    kind: "openai_api_key",
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
    priority: 30,
  },
  {
    kind: "anthropic_api_key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    priority: 30,
  },
  {
    kind: "github_token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    priority: 30,
  },
];
```

Add dedicated collectors for:

- matching PEM blocks whose BEGIN and END labels agree;
- replacing the complete credential-bearing URL;
- replacing only the assigned value after the approved secret field names;
- matching exact sensitive basenames while excluding `.env.example`.

Sort matches by start, then higher priority, then longer length. Drop matches
that overlap an already accepted match. Aggregate summaries by first accepted
kind occurrence. `strict` throws before building a returned object; `warn`
returns the original text; `redact` rebuilds text from accepted spans and the
session placeholders. `sanitizeDiagnostic` always applies `redact` with a new
session and returns only `.text`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx jest tests/unit/security/scanner.test.ts --runInBand
npx eslint src/security tests/unit/security --ext .ts
npx prettier --check src/security tests/unit/security
```

Expected: all scanner tests pass with no lint or format errors.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/security/types.ts src/security/scanner.ts \
  tests/unit/security/scanner.test.ts
git commit -m "feat(security): add secret detection policies"
```

---

### Task 2: Guard every provider request, response, and stream

**Files:**

- Create: `src/security/gateway.ts`
- Create: `tests/unit/security/gateway.test.ts`
- Modify: `src/core/generator.ts`
- Modify: `tests/unit/core/generator.test.ts`
- Modify: `tests/unit/providers/registry.test.ts`

**Interfaces:**

- Consumes: `TrustPolicy`, `FindingSummary`, `RedactionSession`, `applySecretPolicy`, `sanitizeDiagnostic` from Task 1.
- Produces: `GenerationOperation`, `GenerationOrigin`, `ContextEnvelope`, `TrustEvent`, `GeneratorSecurityOptions`, `TrustGateway`.
- Changes: `new Generator(provider, templatesDir, securityOptions?)` remains backward-compatible and defaults to `redact`/`cli`.

- [ ] **Step 1: Write failing gateway tests**

Create `tests/unit/security/gateway.test.ts` using a recording fake provider.
Cover:

```ts
import { TrustGateway } from "../../../src/security/gateway";
import { LLMProvider } from "../../../src/providers/types";

const fakeSecret = ["sk", "proj", "D".repeat(32)].join("-");

class RecordingProvider implements LLMProvider {
  readonly name = "recording";
  calls: Array<{ prompt: string; systemPrompt?: string }> = [];
  response = "# Safe";

  async generate(prompt: string, options = {}): Promise<string> {
    this.calls.push({
      prompt,
      systemPrompt: (options as { systemPrompt?: string }).systemPrompt,
    });
    return this.response;
  }
}

it("redacts system and user messages before transport", async () => {
  const provider = new RecordingProvider();
  const gateway = new TrustGateway(provider, {
    policy: "redact",
    origin: "cli",
  });
  await gateway.generate({
    operation: "readme",
    systemPrompt: `system ${fakeSecret}`,
    prompt: `user ${fakeSecret}`,
  });
  expect(provider.calls).toHaveLength(1);
  expect(JSON.stringify(provider.calls)).not.toContain(fakeSecret);
});

it("makes zero provider calls when strict input is blocked", async () => {
  const provider = new RecordingProvider();
  const gateway = new TrustGateway(provider, {
    policy: "strict",
    origin: "action",
  });
  await expect(
    gateway.generate({
      operation: "api",
      systemPrompt: "safe",
      prompt: fakeSecret,
    }),
  ).rejects.toMatchObject({ code: "TRUST_SECRET_BLOCKED" });
  expect(provider.calls).toHaveLength(0);
});

it("redacts provider output before returning it", async () => {
  const provider = new RecordingProvider();
  provider.response = `# Generated\n${fakeSecret}`;
  const gateway = new TrustGateway(provider, {
    policy: "redact",
    origin: "mcp",
  });
  const output = await gateway.generate({
    operation: "readme",
    systemPrompt: "safe",
    prompt: "safe",
  });
  expect(output).not.toContain(fakeSecret);
});
```

Also add a streaming provider that invokes its internal callback with the fake
secret split across at least three chunks. Assert that the public callback is
not called until the provider promise completes and then receives one approved
string without the secret. Add an event-sink assertion showing only stage,
operation, policy, action, and finding summaries.

- [ ] **Step 2: Run the gateway tests and verify RED**

Run:

```bash
npx jest tests/unit/security/gateway.test.ts --runInBand
```

Expected: FAIL because `src/security/gateway.ts` does not exist.

- [ ] **Step 3: Implement the gateway contracts**

Create `src/security/gateway.ts` with:

```ts
import { GenerateOptions, LLMProvider } from "../providers/types";
import {
  RedactionSession,
  applySecretPolicy,
  sanitizeDiagnostic,
} from "./scanner";
import { FindingSummary, TrustPolicy } from "./types";

export type GenerationOperation =
  | "readme"
  | "api"
  | "jsdoc"
  | "changelog"
  | "diagram"
  | "update";

export type GenerationOrigin = "cli" | "action" | "mcp";

export interface ContextEnvelope {
  operation: GenerationOperation;
  systemPrompt: string;
  prompt: string;
}

export interface TrustEvent {
  stage: "input" | "output" | "error";
  operation: GenerationOperation;
  origin: GenerationOrigin;
  policy: TrustPolicy;
  action: "allowed" | "warned" | "redacted" | "blocked";
  findings: FindingSummary[];
}

export interface GatewayOptions {
  policy: TrustPolicy;
  origin: GenerationOrigin;
  onEvent?: (event: TrustEvent) => void;
}

export class TrustGateway {
  private readonly session = new RedactionSession();

  constructor(
    private readonly provider: LLMProvider,
    private readonly options: GatewayOptions,
  ) {}

  generate(
    envelope: ContextEnvelope,
    options?: Omit<GenerateOptions, "systemPrompt">,
  ): Promise<string>;

  generateStream(
    envelope: ContextEnvelope,
    options: Omit<GenerateOptions, "systemPrompt">,
    onApprovedOutput: (content: string) => void,
  ): Promise<string>;
}
```

Use the same `RedactionSession` for both message roles and output. Emit one
input event after both scans, aggregating identical kinds. Catch provider
errors, sanitize `error.message`, emit an error event without raw text, and
throw a new `Error` whose message uses the sanitized diagnostic. Never add
prompt/response strings or lengths to `TrustEvent` in this slice.

For streaming, pass a private no-op or buffer callback to the provider, await
its returned completed string, scan that string, then invoke
`onApprovedOutput(safeOutput)` once. If no `generateStream` exists, call the
gateway's non-streaming transport path and invoke the callback once.

- [ ] **Step 4: Route all Generator methods through the gateway**

Add to `src/core/generator.ts`:

```ts
export interface GeneratorSecurityOptions {
  policy?: TrustPolicy;
  origin?: GenerationOrigin;
  onEvent?: (event: TrustEvent) => void;
}
```

Keep the constructor call-compatible:

```ts
constructor(
  provider: LLMProvider,
  private templatesDir: string,
  security: GeneratorSecurityOptions = {},
) {
  this.gateway = new TrustGateway(provider, {
    policy: security.policy ?? "redact",
    origin: security.origin ?? "cli",
    onEvent: security.onEvent,
  });
}
```

Replace the six direct calls with a private helper receiving the exact
operation. Example for README:

```ts
const prompt = this.renderTemplate("readme", context);
return this.gateway.generate(
  {
    operation: "readme",
    systemPrompt:
      "You are a professional open-source documentation writer. Output only valid Markdown.",
    prompt,
  },
  { temperature: 0.3 },
);
```

Move every current `systemPrompt` into the envelope and preserve other
`GenerateOptions` values exactly. `generateReadmeStream` calls
`gateway.generateStream` and never exposes the provider callback directly.

- [ ] **Step 5: Prove every operation and registered provider is covered**

Extend `tests/unit/core/generator.test.ts` so each of the six generator methods
receives a context containing a runtime-built fake secret and asserts the
recording provider did not receive it under default redaction. Add strict
coverage for zero calls and output coverage before JSDoc JSON parsing.

Extend `tests/unit/providers/registry.test.ts` with a registered custom provider,
construct a normal `Generator` around it, and assert its received prompt is
redacted. This proves enforcement is above built-in provider implementations.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npx jest tests/unit/security/gateway.test.ts \
  tests/unit/core/generator.test.ts \
  tests/unit/providers/registry.test.ts --runInBand
npx eslint src/security src/core/generator.ts \
  tests/unit/security tests/unit/core/generator.test.ts \
  tests/unit/providers/registry.test.ts --ext .ts
```

Expected: all focused tests pass and no direct `this.provider.generate` remains
inside `Generator`.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/security/gateway.ts src/core/generator.ts \
  tests/unit/security/gateway.test.ts tests/unit/core/generator.test.ts \
  tests/unit/providers/registry.test.ts
git commit -m "feat(security): guard provider input and output"
```

---

### Task 3: Wire policy, origin, and safe credential precedence

**Files:**

- Create: `tests/unit/config/security.test.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/providers/registry.ts`
- Modify: `src/cli/context.ts`
- Modify: `src/mcp/server.ts`
- Modify: `action.yml`
- Modify: `action/run.sh`
- Modify: `tests/unit/config/environment.test.ts`
- Modify: `tests/unit/providers/factory.test.ts`
- Modify: `tests/unit/action/runner.test.ts`
- Create: `tests/unit/mcp/security.test.ts`

**Interfaces:**

- Consumes: `TrustPolicy`, `TRUST_POLICIES`, and `GeneratorSecurityOptions`.
- Produces: `AidocConfig.trustPolicy: TrustPolicy` with default `redact`.
- Produces: environment overrides `AIDOC_TRUST_POLICY` and `AIDOC_ORIGIN`.
- Produces: Action input `trust-policy` with default `strict`.

- [ ] **Step 1: Write failing config and credential tests**

Create `tests/unit/config/security.test.ts` covering:

```ts
it("defaults the Trust Gate to redact", () => {
  expect(loadConfig(root, {} as NodeJS.ProcessEnv).trustPolicy).toBe("redact");
});

it("accepts strict from AIDOC_TRUST_POLICY", () => {
  expect(
    loadConfig(root, { AIDOC_TRUST_POLICY: "strict" } as NodeJS.ProcessEnv)
      .trustPolicy,
  ).toBe("strict");
});

it("rejects an unknown environment policy", () => {
  expect(() =>
    loadConfig(root, {
      AIDOC_TRUST_POLICY: "unsafe",
    } as NodeJS.ProcessEnv),
  ).toThrow();
});
```

Write a temporary `.aidocrc.json` containing a runtime-built fake `apiKey`, spy
on `console.warn`, and assert exactly one deprecation warning without the value.
Set both that file key and a fake provider environment key; assert the provider
factory uses the environment key.

Extend the Action test with invalid `AIDOC_INPUT_TRUST_POLICY=unsafe` expecting
exit `2` before the fake `aidoc` executable is called, and a default invocation
expecting `AIDOC_TRUST_POLICY=strict` plus `AIDOC_ORIGIN=action` in the child
environment.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx jest tests/unit/config/security.test.ts \
  tests/unit/config/environment.test.ts \
  tests/unit/providers/factory.test.ts \
  tests/unit/action/runner.test.ts --runInBand
```

Expected: FAIL because the policy, deprecation, precedence, and Action input do
not exist.

- [ ] **Step 3: Add the validated policy configuration**

In `src/config/schema.ts`, import `TRUST_POLICIES` and add:

```ts
trustPolicy: z.enum(TRUST_POLICIES).default("redact"),
```

In `environmentConfig`, add only a present raw value and let the final Zod parse
reject invalid values:

```ts
...(env.AIDOC_TRUST_POLICY
  ? { trustPolicy: env.AIDOC_TRUST_POLICY }
  : {}),
```

Type the intermediate object as `Record<string, unknown>` so an invalid string
is not cast to `TrustPolicy` before validation.

Before merging a non-empty cosmiconfig result, inspect only whether the raw
object owns `apiKey`. Emit:

```text
Deprecated Aidoc config field "apiKey" detected; use the provider-specific environment variable instead.
```

Do not interpolate or serialize the config object.

- [ ] **Step 4: Prefer environment credentials and remove unsafe guidance**

In `src/providers/registry.ts`, change built-in availability and construction to
prefer the provider environment variable:

```ts
const openAiKey = (config: ProviderConfig): string | undefined =>
  process.env.OPENAI_API_KEY || config.apiKey;

const anthropicKey = (config: ProviderConfig): string | undefined =>
  process.env.ANTHROPIC_API_KEY || config.apiKey;
```

Use these helpers in both `available` and `create`. Missing-key messages mention
only the provider-specific environment variable. Keep `ProviderConfig.apiKey`
for programmatic and compatibility use.

- [ ] **Step 5: Pass policy and origin from every construction site**

In `loadCommandContext`, derive origin without trusting arbitrary values:

```ts
const origin = process.env.AIDOC_ORIGIN === "action" ? "action" : "cli";
const generator = isMock
  ? new MockGenerator()
  : new Generator(createProvider(config), resolveTemplatesDir(), {
      policy: config.trustPolicy,
      origin,
    });
```

Every MCP `new Generator` receives:

```ts
{ policy: config.trustPolicy, origin: "mcp" }
```

In `tests/unit/mcp/security.test.ts`, mock `loadConfig`, `createProvider`,
`analyzeCodebase`, and `Generator`. Call `handleToolCall("generate_readme", {
directory: fixture })` and assert the `Generator` constructor's third argument
is exactly `{ policy: "strict", origin: "mcp" }`. Make the mocked generator
return safe Markdown. This test proves MCP wiring without contacting a real or
local model server; the unchanged packed MCP smoke remains the transport gate.

- [ ] **Step 6: Add and validate the Action policy**

Add to `action.yml`:

```yaml
trust-policy:
  description: "Secret handling policy: warn, redact, or strict"
  required: false
  default: "strict"
```

Pass it as `AIDOC_INPUT_TRUST_POLICY`. In `action/run.sh`, validate:

```bash
trust_policy="${AIDOC_INPUT_TRUST_POLICY:-strict}"
case "$trust_policy" in
  warn|redact|strict) ;;
  *) echo "Unsupported aidoc trust policy: $trust_policy" >&2; exit 2 ;;
esac
export AIDOC_TRUST_POLICY="$trust_policy"
export AIDOC_ORIGIN="action"
```

Perform this validation before checksum or Aidoc invocation.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
npx jest tests/unit/config/security.test.ts \
  tests/unit/config/environment.test.ts \
  tests/unit/providers/factory.test.ts \
  tests/unit/action/runner.test.ts \
  tests/unit/mcp/security.test.ts --runInBand
npm run build
npm run test:action
npm run test:mcp
```

Expected: all tests pass; config warnings and test output contain no seeded
credential values.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/config/schema.ts src/config/loader.ts src/providers/registry.ts \
  src/cli/context.ts src/mcp/server.ts action.yml action/run.sh \
  tests/unit/config/security.test.ts tests/unit/config/environment.test.ts \
  tests/unit/providers/factory.test.ts tests/unit/action/runner.test.ts \
  tests/unit/mcp/security.test.ts
git commit -m "fix(config): enforce Trust Gate policy sources"
```

---

### Task 4: Sanitize diagnostics and document the beta boundary

**Files:**

- Modify: `src/core/retry.ts`
- Modify: `src/cli/commands/annotate.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/unit/core/retry.test.ts`
- Modify: `tests/unit/cli/commands.test.ts`
- Modify: `tests/e2e/mcp-smoke.mjs`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `docs/releases/v0.1.1.md`

**Interfaces:**

- Consumes: `sanitizeDiagnostic(text: string): string`.
- Produces: value-free retry, annotation, and MCP diagnostics.
- Produces: accurate documentation of the provider-boundary beta slice and its deferred limits.

- [ ] **Step 1: Write failing diagnostic leak tests**

Extend retry tests so an operation rejects with an error containing a
runtime-built fake key. Capture logger output and assert the original key is
absent while `<AIDOC_REDACTED:OPENAI_API_KEY:1>` is present.

Extend annotation command tests so malformed JSON containing a fake key reports
only:

```text
LLM returned malformed JSON for annotations. Try again or use --mock.
```

Extend MCP smoke/unit handling with an error containing a fake key and assert
the protocol error contains the placeholder but not the original value.

- [ ] **Step 2: Run leak tests and verify RED**

Run:

```bash
npx jest tests/unit/core/retry.test.ts \
  tests/unit/cli/commands.test.ts --runInBand
npm run test:mcp
```

Expected: FAIL because current retry, annotation, or MCP errors expose raw text.

- [ ] **Step 3: Sanitize the three diagnostic paths**

In `src/core/retry.ts`, wrap every provider-controlled error string passed to
the logger with `sanitizeDiagnostic`.

In `annotate.ts`, delete the raw-response suffix and throw exactly:

```ts
throw new Error(
  "LLM returned malformed JSON for annotations. Try again or use --mock.",
);
```

In the MCP request handler catch, pass the selected error message through
`sanitizeDiagnostic` before returning it as text. Preserve stable Trust error
codes by prefixing a known `code` property when present, without serializing the
whole error object.

- [ ] **Step 4: Update documentation without overclaiming**

Add a README `Trust Gate beta` section covering:

- default `redact`, optional `strict`, explicitly permissive `warn`;
- environment credential recommendation and deprecated file `apiKey`;
- provider input/output coverage and buffered streaming;
- statement that filesystem containment, MCP directory allowlisting, doctor,
  and persisted receipts are still in progress;
- statement that secret redaction is not a prompt-injection or OS sandbox.

Move only `Provider-context secret detection and redaction` into an
`In progress — v0.2.0-beta.1` Roadmap subsection. Leave repository-contained
atomic writes and security doctor/receipts planned. Update v0.1.1 release notes
only to link the later in-progress branch; do not describe Trust Gate as part of
v0.1.1.

- [ ] **Step 5: Run the complete verification gate**

Run:

```bash
npm_config_offline=true npm run verify:release
npx prettier --check src tests README.md ROADMAP.md docs/releases/v0.1.1.md
git diff --check
```

Expected:

- every Jest suite passes;
- lint and TypeScript build pass;
- package, Action, check, and MCP smoke tests pass;
- no formatting or whitespace errors;
- a repository search for each runtime-built fixture value is impossible by
  construction because tests assemble them from fragments.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/core/retry.ts src/cli/commands/annotate.ts src/mcp/server.ts \
  tests/unit/core/retry.test.ts tests/unit/cli/commands.test.ts \
  tests/e2e/mcp-smoke.mjs README.md ROADMAP.md docs/releases/v0.1.1.md
git commit -m "docs(security): document provider Trust Gate limits"
```

---

## Review and Handoff

After every task:

1. generate a task-scoped diff from the recorded base commit;
2. run an independent spec and code-quality/security review;
3. fix Critical and Important findings through a scoped red-green loop;
4. append the reviewed commit range and evidence to the plan ledger.

After Task 4:

1. run one whole-branch security review focused on bypasses, secret leakage,
   registered providers, streaming, error paths, and false positives;
2. rerun `verify:release` from a clean state;
3. push only to the existing private draft PR;
4. require hosted Node 22 and Node 24 checks;
5. keep tag, npm publication, GitHub Release, repository visibility, and the
   online-audit GREEN claim blocked until their separate gates are satisfied.
