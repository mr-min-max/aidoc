# Provider Profiles and Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` task-by-task and
> `superpowers:verification-before-completion` before the terminal report. This
> SUBCULTURE worker executes directly; do not create agents, threads, or
> worktrees.

**Goal:** Replace the implicit OpenAI default with explicit, safe provider
profiles and an `auto` resolver that explains every provider/model/origin
choice without constructing a transport prematurely.

**Architecture:** Static profile metadata is separate from transport factories.
Selection merges CLI, environment, project, safe availability detection, and
interactive choice in strict precedence order. Endpoint policy and safe
non-secret persistence are independent modules so transports and commands can
consume locked results later.

**Tech Stack:** TypeScript, Zod, prompts, Node URL/DNS primitives, existing
provider registry and repository writer, Jest.

## Global Constraints

- Read first: `AGENTS.md`, the accepted hybrid beta spec, `src/config/schema.ts`,
  `src/config/loader.ts`, `src/providers/registry.ts`, `src/cli/context.ts`, and
  focused config/provider tests.
- Do not edit `src/cli/commands/update.ts`, `src/cli/commands/plan.ts`,
  `src/output/impact.ts`, `src/impact/targets.ts`, `src/mcp/**`, provider
  transport files, `package.json`, or lockfiles.
- Profile metadata never receives credential values. Credential presence is a
  boolean boundary; actual values stay in provider-specific environment
  variables until transport construction.
- `auto` is a selection state, never a constructible transport.
- Exact keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`,
  `DASHSCOPE_API_KEY`, and `AIDOC_COMPAT_API_KEY`. Never substitute or reuse a
  different provider's key.
- Qwen direct CLI supports pay-as-you-go keys only. Coding Plan and Token Plan
  selections stop with fixed guidance before any request because Alibaba's
  current terms exclude custom applications/automated scripts from those keys.
- No automatic provider/origin fallback after a selected path fails.
- New persistence writes only non-secret fields through
  `RepositoryWriteScope`; it must refuse to rewrite a config containing legacy
  plaintext `apiKey`.
- Stage only this plan's files. Run focused tests and `npx tsc --noEmit`, not
  repository-wide formatting/full gates while Slice A is active.

---

## Task 1: Locked provider profile and configuration model

**Files:**

- Create: `src/providers/profiles.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`
- Modify: `src/providers/registry.ts`
- Create: `tests/unit/providers/profiles.test.ts`
- Modify: `tests/unit/config/environment.test.ts`
- Modify: `tests/unit/config/loader.test.ts`
- Modify: `tests/unit/config/security.test.ts`

**Interfaces:**

```ts
export type BuiltInProviderName =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "qwen"
  | "ollama"
  | "openai-compatible";

export type ProviderTransportKind =
  | "openai-responses"
  | "anthropic-messages"
  | "openai-compatible-chat"
  | "ollama";

export interface ProviderProfile {
  readonly name: BuiltInProviderName;
  readonly displayName: string;
  readonly credentialEnv?: string;
  readonly defaultModel?: string;
  readonly transport: ProviderTransportKind;
  readonly boundary: "remote" | "local";
}

export const PROVIDER_PROFILES: readonly ProviderProfile[];
export function getProviderProfile(name: string): ProviderProfile | undefined;
```

Extend `AidocConfig` with these non-secret fields:

```ts
provider: string; // default "auto"
model?: string;
providerBaseUrl?: string;
allowLocalHttp: boolean; // default false
qwenRegion?:
  | "china-beijing"
  | "china-hongkong"
  | "singapore"
  | "japan-tokyo"
  | "germany-frankfurt"
  | "us-virginia";
qwenWorkspaceId?: string;
```

- [ ] **Step 1: Write failing profile/config tests**

```ts
expect(defaultConfig.provider).toBe("auto");
expect(getProviderProfile("openai")?.defaultModel).toBe("gpt-5.6-luna");
expect(getProviderProfile("anthropic")?.defaultModel).toBe("claude-sonnet-5");
expect(getProviderProfile("deepseek")?.defaultModel).toBe("deepseek-v4-flash");
expect(getProviderProfile("qwen")?.defaultModel).toBe("qwen3.6-flash");
expect(getProviderProfile("ollama")?.defaultModel).toBeUndefined();
```

Assert environment names map exactly:
`AIDOC_PROVIDER`, `AIDOC_MODEL`, `AIDOC_PROVIDER_BASE_URL`,
`AIDOC_ALLOW_LOCAL_HTTP`, `AIDOC_QWEN_REGION`, and
`AIDOC_QWEN_WORKSPACE_ID`. Boolean parsing accepts only `true`/`false` and
invalid values fall through the existing safe invalid-config behavior.

- [ ] **Step 2: Run focused tests and verify RED**

Run:
`npm test -- tests/unit/providers/profiles.test.ts tests/unit/config/environment.test.ts tests/unit/config/loader.test.ts tests/unit/config/security.test.ts --runInBand`

Expected: FAIL on missing profiles and the old `openai` default.

- [ ] **Step 3: Add immutable built-in profiles**

Use `Object.freeze` on profile objects and the exported array. Profiles contain
only display/policy metadata, never credential values or SDK clients.

Keep community `registerProvider()` compatibility: explicit registered custom
provider names remain valid in project config. `auto` is accepted by the schema
but `createProvider({provider: "auto"})` must throw a fixed actionable error.

- [ ] **Step 4: Extend configuration without cross-origin legacy key reuse**

Preserve the current rule that a legacy `apiKey` belongs only to the provider
recorded in the file. If environment/CLI selection changes provider, clear the
legacy key. Do not add provider-specific credentials to `AidocConfig`.

- [ ] **Step 5: Verify and commit Task 1**

Run the focused command from Step 2; expect PASS.

```bash
git add src/providers/profiles.ts src/config/schema.ts src/config/loader.ts src/providers/registry.ts tests/unit/providers/profiles.test.ts tests/unit/config/environment.test.ts tests/unit/config/loader.test.ts tests/unit/config/security.test.ts
git commit -m "feat: define explicit provider profiles"
```

## Task 2: Endpoint policy and Qwen endpoint construction

**Files:**

- Create: `src/providers/endpoints.ts`
- Create: `src/providers/errors.ts`
- Create: `tests/unit/providers/endpoints.test.ts`

**Interfaces:**

```ts
export interface ApprovedProviderEndpoint {
  readonly url: URL;
  readonly origin: string;
  readonly local: boolean;
  readonly addresses: readonly {
    readonly address: string;
    readonly family: 4 | 6;
  }[];
}

export async function approveCompatibleEndpoint(input: {
  rawUrl: string;
  allowLocalHttp: boolean;
  lookup?: typeof import("node:dns/promises").lookup;
}): Promise<ApprovedProviderEndpoint>;

export function buildQwenPaygEndpoint(input: {
  region: NonNullable<AidocConfig["qwenRegion"]>;
  workspaceId?: string;
}): URL;

export type ProviderConfigurationErrorCode =
  | "PROVIDER_INVALID_ENDPOINT"
  | "PROVIDER_ENDPOINT_NOT_PUBLIC"
  | "PROVIDER_LOCAL_HTTP_NOT_CONFIRMED"
  | "PROVIDER_SELECTION_REQUIRED"
  | "PROVIDER_SELECTION_CANCELLED"
  | "QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP";

export class ProviderConfigurationError extends Error {
  readonly code: ProviderConfigurationErrorCode;
  constructor(code: ProviderConfigurationErrorCode);
}
```

- [ ] **Step 1: Write failing URL-policy tests**

Accept:

```ts
https://gateway.example.com/v1
http://127.0.0.1:8080/v1 // only allowLocalHttp: true
http://[::1]:8080/v1    // only allowLocalHttp: true
```

Reject URL credentials, query, fragment, non-HTTP schemes, remote HTTP,
private/link-local/multicast/unspecified/metadata IPs, DNS resolving to any
private address, and `localhost` unless the explicit local-HTTP flag is true.

Use fixed safe error codes/messages that omit the raw URL:
`PROVIDER_INVALID_ENDPOINT`, `PROVIDER_ENDPOINT_NOT_PUBLIC`, and
`PROVIDER_LOCAL_HTTP_NOT_CONFIRMED`.

- [ ] **Step 2: Write failing Qwen mapping tests**

```ts
expect(url("china-beijing")).toBe(
  "https://dashscope.aliyuncs.com/compatible-mode/v1",
);
expect(url("us-virginia")).toBe(
  "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
);
expect(url("singapore", "ws-123")).toBe(
  "https://ws-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
);
```

Map Hong Kong to `cn-hongkong`, Tokyo to `ap-northeast-1`, and Frankfurt to
`eu-central-1`. Those four workspace-host regions require a DNS-label-safe
workspace ID. Never accept a caller-supplied Qwen base URL in the normal Qwen
profile.

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- tests/unit/providers/endpoints.test.ts --runInBand`

Expected: FAIL because the endpoint module does not exist.

- [ ] **Step 4: Implement lexical and resolved-address approval**

Normalize through `new URL()`, require an empty username/password/search/hash,
and compare origins using `URL.origin`. Resolve all addresses with
`lookup(host, { all: true, verbatim: true })` for non-IP remote hosts and reject
if any answer is not globally routable. Return the approved addresses so the
transport can pin its socket lookup to one of those exact values. This approval
is repeated immediately before every generic request; it is not a permanent DNS
trust grant.

- [ ] **Step 5: Verify and commit Task 2**

Run the Step 3 command; expect PASS.

```bash
git add src/providers/endpoints.ts src/providers/errors.ts tests/unit/providers/endpoints.test.ts
git commit -m "feat: enforce provider endpoint policy"
```

## Task 3: Deterministic provider selection and onboarding primitives

**Files:**

- Create: `src/providers/selection.ts`
- Create: `src/providers/onboarding.ts`
- Create: `tests/unit/providers/selection.test.ts`
- Create: `tests/unit/providers/onboarding.test.ts`

**Interfaces:**

```ts
export type ProviderSelectionSource =
  | "command"
  | "environment"
  | "project"
  | "detected"
  | "interactive";

export interface ResolvedProviderSelection {
  readonly provider: string;
  readonly model?: string;
  readonly endpoint?: ApprovedProviderEndpoint;
  readonly source: ProviderSelectionSource;
  readonly boundary: "remote" | "local";
  readonly credentialEnv?: string;
}

export interface ProviderSelectionOverrides {
  readonly provider?: string;
  readonly model?: string;
  readonly providerBaseUrl?: string;
  readonly allowLocalHttp?: boolean;
}

export interface ProviderPrompter {
  chooseProvider(choices: readonly ProviderChoice[]): Promise<string | null>;
  chooseOllamaModel(models: readonly string[]): Promise<string | null>;
  configureQwen(): Promise<QwenOnboardingChoice | null>;
  confirmBoundary(summary: ProviderBoundarySummary): Promise<boolean>;
  rememberSelection(): Promise<boolean>;
}

export async function resolveProviderSelection(input: {
  config: AidocConfig;
  overrides?: ProviderSelectionOverrides;
  env?: NodeJS.ProcessEnv;
  interactive: boolean;
  prompter?: ProviderPrompter;
  listOllamaModels?: () => Promise<readonly string[]>;
}): Promise<ResolvedProviderSelection | null>;

export async function confirmProviderBoundary(input: {
  selection: ResolvedProviderSelection;
  targetPaths: readonly string[];
  contextBytes: number;
  trustPolicy: TrustPolicy;
  interactive: boolean;
  yes: boolean;
  prompter?: ProviderPrompter;
}): Promise<boolean>;
```

- [ ] **Step 1: Write failing precedence and no-fallback tests**

Test exact order: command > effective environment > project > sole ready key >
Ollama detection > interactive choice > actionable failure. Multiple ready
remote keys must prompt or fail; never rank them. A selected but unavailable
explicit provider fails and does not probe another provider.

In non-interactive mode, a remote key's mere presence is not enough: require an
explicit provider from command, `AIDOC_PROVIDER`, or project config. Local
Ollama may be detected, but it still requires an explicit configured model.

Assert the resolver returns only the credential variable name, never its value:

```ts
expect(JSON.stringify(selection)).not.toContain(env.OPENAI_API_KEY!);
expect(selection.credentialEnv).toBe("OPENAI_API_KEY");
```

- [ ] **Step 2: Write failing onboarding tests**

The production prompt groups choices into `Available now`, `Connect another
provider`, `Use a ChatGPT subscription in Codex, or use Claude, through local
MCP`, and `Exit without sending data`.

For Qwen, choosing Coding Plan or Token Plan returns the fixed
`QWEN_PLAN_NOT_PERMITTED_FOR_CUSTOM_APP` failure before endpoint/key use.
Pay-as-you-go collects the configured region and workspace ID only where
required.

- [ ] **Step 3: Run tests and verify RED**

Run:
`npm test -- tests/unit/providers/selection.test.ts tests/unit/providers/onboarding.test.ts --runInBand`

Expected: FAIL because selection/onboarding modules do not exist.

- [ ] **Step 4: Implement pure selection before prompt adapters**

Keep environment inspection in a value-local scope. Read only whether an exact
key is a non-empty string. Do not cache, log, serialize, or return a key. For
Ollama, an empty model list is unavailable; when models exist and no model is
configured, interactive mode asks and non-interactive mode fails with one exact
`AIDOC_MODEL` example.

Boundary confirmation displays provider, model, endpoint origin, local/remote,
sorted target paths, Trust Gate policy supplied by the caller, and context byte
count. `--yes` skips the confirmation only after an explicit/non-ambiguous
selection; it never resolves ambiguity.

- [ ] **Step 5: Verify and commit Task 3**

Run the Step 3 command; expect PASS.

```bash
git add src/providers/selection.ts src/providers/onboarding.ts tests/unit/providers/selection.test.ts tests/unit/providers/onboarding.test.ts
git commit -m "feat: resolve and explain provider selection"
```

## Task 4: Non-secret project persistence and context construction

**Files:**

- Create: `src/config/persistence.ts`
- Modify: `src/cli/context.ts`
- Create: `tests/unit/config/persistence.test.ts`
- Modify: `tests/unit/cli/context.test.ts`

**Interfaces:**

```ts
export async function rememberProviderSelection(
  cwd: string,
  selection: ResolvedProviderSelection,
  qwen?: { region: AidocConfig["qwenRegion"]; workspaceId?: string },
): Promise<void>;
```

Extend shared command options without editing command registrations:

```ts
provider?: string;
model?: string;
providerBaseUrl?: string;
allowLocalHttp?: boolean;
```

Add an optional construction gate without target logic:

```ts
export interface CommandContextLoadRuntime {
  beforeProviderCreate?(
    selection: ResolvedProviderSelection,
    config: AidocConfig,
  ): Promise<void>;
}

export async function loadCommandContext(
  options: CommandOptions,
  cwd?: string,
  runtime?: CommandContextLoadRuntime,
): Promise<CommandContext>;
```

- [ ] **Step 1: Write failing persistence tests**

Cover a missing `.aidocrc.json`, preservation of valid unrelated fields,
refusal on malformed JSON, refusal when an own `apiKey` property exists, no
environment values in output, endpoint/profile-only persistence, atomic
repository write, and a simulated snapshot race.

- [ ] **Step 2: Write failing context-construction tests**

Assert mock mode constructs no selection/provider. Real mode calls selection
once; when the user exits, it throws an authentic fixed
`ProviderConfigurationError("PROVIDER_SELECTION_CANCELLED")` without
constructing a provider. It calls
`createProvider()` only with an accepted resolved configuration. Multiple key
ambiguity must stop before construction. The optional `beforeProviderCreate`
gate observes the resolved non-secret metadata and completes before the factory;
if it throws, the factory is not called.

- [ ] **Step 3: Run tests and verify RED**

Run:
`npm test -- tests/unit/config/persistence.test.ts tests/unit/cli/context.test.ts --runInBand`

Expected: FAIL on missing persistence and old direct provider construction.

- [ ] **Step 4: Implement safe JSON merge and selection-aware context**

Read the prepared `.aidocrc.json` snapshot from `RepositoryWriteScope`. Require
a plain JSON object; preserve own JSON data properties only. Write two-space
JSON plus newline. Persist `provider`, `model`, `providerBaseUrl`,
`allowLocalHttp`, `qwenRegion`, and `qwenWorkspaceId` only when relevant. Never
persist `apiKey`, credential environment names, or endpoint authorization.

Change `loadCommandContext()` so mock behavior is unchanged and real behavior
resolves selection before `createProvider()`. Preserve its non-null return type;
translate a `null` selection into
`ProviderConfigurationError("PROVIDER_SELECTION_CANCELLED")`, which Sol will
map to update exit `0`. Add the accepted `selection` metadata to the real
`CommandContext` so callers can display it without touching credentials. Do not
add target-aware boundary confirmation here; Sol supplies it through
`beforeProviderCreate` after Slice A handoff. The production prompter's
`rememberSelection()` is opt-in and defaults false; Sol calls persistence only
when it returns true.

- [ ] **Step 5: Verify the entire slice**

Run:

```bash
npm test -- tests/unit/providers/profiles.test.ts tests/unit/providers/endpoints.test.ts tests/unit/providers/selection.test.ts tests/unit/providers/onboarding.test.ts tests/unit/config/environment.test.ts tests/unit/config/loader.test.ts tests/unit/config/security.test.ts tests/unit/config/persistence.test.ts tests/unit/cli/context.test.ts --runInBand
npx tsc --noEmit
```

Expected: all focused tests pass and TypeScript exits `0`.

- [ ] **Step 6: Inspect scope and commit Task 4**

Run `git status --short`; verify no update/plan/MCP/transport/package file is
staged.

```bash
git add src/config/persistence.ts src/cli/context.ts tests/unit/config/persistence.test.ts tests/unit/cli/context.test.ts
git commit -m "feat: persist non-secret provider choices"
```
