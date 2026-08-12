# Current Provider Transports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` task-by-task and
> `superpowers:verification-before-completion` before the terminal report. This
> dependent SUBCULTURE worker starts only after the curator accepts Provider
> Profiles and Selection; do not create agents, threads, or worktrees.

**Goal:** Implement current OpenAI, Anthropic, DeepSeek, Qwen, generic
OpenAI-compatible, and Ollama transports behind the existing `LLMProvider`
contract with exact credential/origin binding and no fallback.

**Architecture:** Official OpenAI uses Responses; Anthropic uses Messages; a
shared Chat Completions transport serves separately registered compatible
profiles. Every compatible call revalidates its endpoint, disables automatic
redirects, and refuses a response redirect. Ollama discovers installed local
models instead of inventing a default.

**Tech Stack:** OpenAI Node SDK, Anthropic SDK, Node fetch/DNS, existing retry
and Trust Gateway, Jest protocol doubles.

## Global Constraints

- Prerequisite: accepted interfaces from
  `docs/superpowers/plans/2026-08-12-provider-profiles-selection.md` are present
  in the shared checkout. If their names/types differ from this plan, stop and
  ask Sol; do not redesign them silently.
- Read first: `AGENTS.md`, accepted hybrid spec, `src/providers/types.ts`,
  accepted profile/endpoint/selection modules, existing transport tests, and
  `src/core/retry.ts`.
- Do not edit CLI commands, MCP, impact planner/targets, documentation, package
  files, or lockfiles.
- Preserve `LLMProvider.generate()` and optional `generateStream()` contracts.
- Default models: `gpt-5.6-luna`, `claude-sonnet-5`, `deepseek-v4-flash`, and
  `qwen3.6-flash`; Ollama and generic compatible have no implicit model.
- Provider-specific credentials never cross origins. Generic compatible uses
  only `AIDOC_COMPAT_API_KEY`.
- No fallback follows any provider/model/origin/HTTP/network error.
- Provider errors must remain sanitizable by the existing Trust Gateway; tests
  must not include real keys or paid API calls.
- The shared SUBCULTURE checkout has one Git index. Do not stage, commit, switch
  branches, reset, clean, or checkout. Treat commit steps below as curator
  checkpoints and report exact changed paths.

---

## Task 1: OpenAI Responses and current Anthropic Messages

**Files:**

- Modify: `src/providers/openai.ts`
- Modify: `src/providers/anthropic.ts`
- Modify: `tests/unit/providers/openai.test.ts`
- Create: `tests/unit/providers/anthropic.test.ts`
- Modify: `tests/unit/providers/streaming.test.ts`

**Interfaces:** Existing `LLMProvider` only.

- [ ] **Step 1: Write failing OpenAI Responses tests**

Mock `OpenAI.prototype.responses.create` and assert non-streaming requests use:

```ts
{
  model: "gpt-5.6-luna",
  instructions: "system",
  input: "prompt",
  max_output_tokens: 2048,
  text: { format: { type: "json_object" } }, // JSON mode only
}
```

Assert output comes from `response.output_text`, Chat Completions is never
called, 429 remains retryable, non-retryable failures make one call, and no API
error body/key/prompt is interpolated into the public error.

- [ ] **Step 2: Write failing Responses streaming tests**

Mock a stream of `response.output_text.delta` events. Accumulate only `delta`
strings, call `onToken` per text delta, ignore unrelated events, and return the
complete text. A terminal response error must reject through the same sanitized
provider error class/path as non-streaming.

- [ ] **Step 3: Write failing Anthropic current-model tests**

Assert default `claude-sonnet-5`, Messages shape, text-block extraction,
streaming text deltas, retry behavior, and omission of unsupported optional
parameters. `max_tokens` defaults to `4096`; no Claude.ai login/token path is
introduced.

- [ ] **Step 4: Run tests and verify RED**

Run:
`npm test -- tests/unit/providers/openai.test.ts tests/unit/providers/anthropic.test.ts tests/unit/providers/streaming.test.ts --runInBand`

Expected: FAIL because OpenAI still uses Chat Completions and defaults are old.

- [ ] **Step 5: Implement minimal transport modernization**

For GPT-5.6 omit `temperature` unless the current SDK/model accepts the caller's
explicit value; do not send a guessed compatibility parameter. Use SDK types
from the installed `openai` package instead of `any` for response events.

For Anthropic, keep the dynamic-import behavior compatible with the existing
SDK packaging and use typed text-block guards where possible.

- [ ] **Step 6: Verify and commit Task 1**

Run the Step 4 command; expect PASS.

```bash
git add src/providers/openai.ts src/providers/anthropic.ts tests/unit/providers/openai.test.ts tests/unit/providers/anthropic.test.ts tests/unit/providers/streaming.test.ts
git commit -m "feat: modernize official provider transports"
```

## Task 2: Secure OpenAI-compatible Chat Completions transport

**Files:**

- Create: `src/providers/compatible.ts`
- Create: `tests/unit/providers/compatible.test.ts`

**Interfaces:**

```ts
export interface CompatibleTransportOptions {
  readonly name: string;
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: ApprovedProviderEndpoint;
  readonly allowLocalHttp: boolean;
  readonly lookup?: typeof import("node:dns/promises").lookup;
  readonly requestImpl?: typeof import("node:https").request;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  constructor(options: CompatibleTransportOptions);
}
```

- [ ] **Step 1: Write failing protocol and origin tests**

Assert POST `${endpoint}/chat/completions`, bearer authorization, JSON body with
model/messages/max_tokens/temperature/stream, JSON object response format, and
SSE streaming delta accumulation.

Before every request, re-run `approveCompatibleEndpoint()` against the exact
configured URL. Open the HTTP(S) request with the original hostname/SNI but a
custom socket `lookup` callback pinned to one address from that approval. Any
3xx response fails with `PROVIDER_CROSS_ORIGIN_REDIRECT` without issuing a
second request. Assert the Authorization header is never passed to a different
origin or an unapproved address.

- [ ] **Step 2: Write failing hostile-response tests**

Reject malformed JSON, non-string message content, invalid SSE records, a body
over the bounded response limit, and provider error bodies containing fake
secrets. Public errors include provider name and safe HTTP status only.

- [ ] **Step 3: Run tests and verify RED**

Run: `npm test -- tests/unit/providers/compatible.test.ts --runInBand`

Expected: FAIL because the compatible transport does not exist.

- [ ] **Step 4: Implement Chat Completions with manual redirect policy**

Use `node:https.request` for remote HTTPS and `node:http.request` only for an
explicitly approved loopback HTTP endpoint. Preserve the original `Host` and
TLS server name while pinning DNS resolution to an approved address. Cap
non-streaming error/body reads at 1 MiB and streaming line buffer at 1 MiB;
abort with a fixed safe error when exceeded. Preserve `withRetry`; every retry
re-approves and re-pins the same configured origin.

- [ ] **Step 5: Verify and commit Task 2**

Run the Step 3 command; expect PASS.

```bash
git add src/providers/compatible.ts tests/unit/providers/compatible.test.ts
git commit -m "feat: add secure compatible provider transport"
```

## Task 3: Register DeepSeek, Qwen, and advanced compatible profiles

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `tests/unit/providers/registry.test.ts`
- Modify: `tests/unit/providers/factory.test.ts`

**Interfaces:** Consumes accepted profiles/endpoints and Task 2 compatible
transport.

- [ ] **Step 1: Write failing factory-boundary tests**

```ts
expect(factory("deepseek").name).toBe("deepseek");
expect(factory("qwen").name).toBe("qwen");
expect(factory("openai-compatible").name).toBe("openai-compatible");
```

Assert exact keys and models, DeepSeek fixed origin
`https://api.deepseek.com`, Qwen constructed pay-as-you-go origin, generic
explicit model/base URL, no legacy key movement across a changed provider, and
no hidden fallback after a fake 401/404/429.

- [ ] **Step 2: Run tests and verify RED**

Run:
`npm test -- tests/unit/providers/registry.test.ts tests/unit/providers/factory.test.ts --runInBand`

Expected: FAIL because the new profiles have no transport factories.

- [ ] **Step 3: Register factories without duplicating transport code**

Resolve actual key values only inside the selected factory immediately before
construction. DeepSeek/Qwen/generic all instantiate
`OpenAICompatibleProvider`; they differ through profile name, key, model, and
approved endpoint. Do not add vendor-specific prompt strings.

Legacy config `apiKey` is usable only when the same provider name came from the
project config compatibility path; new providers still prefer their exact env
key. Never use `OPENAI_API_KEY` for a compatible profile.

- [ ] **Step 4: Verify and commit Task 3**

Run the Step 2 command; expect PASS.

```bash
git add src/providers/registry.ts tests/unit/providers/registry.test.ts tests/unit/providers/factory.test.ts
git commit -m "feat: register DeepSeek Qwen and compatible providers"
```

## Task 4: Honest Ollama discovery and provider contract gate

**Files:**

- Modify: `src/providers/ollama.ts`
- Modify: `tests/unit/providers/ollama.test.ts`
- Create: `tests/unit/providers/contracts.test.ts`

**Interfaces:**

```ts
export async function listOllamaModels(
  host?: string,
  fetchImpl?: typeof fetch,
): Promise<readonly string[]>;
```

- [ ] **Step 1: Write failing Ollama model-list tests**

GET `/api/tags`, require a valid object with `models[].name`, remove invalid or
duplicate values, sort lexically, and return an immutable list. Connection
failure is availability `[]` for auto-detection but remains a provider error
when generation was explicitly selected.

Constructing `OllamaProvider` without a non-empty model must fail before POST;
remove the implicit `llama3` default.

- [ ] **Step 2: Write shared provider contract tests**

For local protocol doubles, assert every built-in provider:

- exposes the registered name;
- returns string output or rejects non-string/malformed transport output;
- preserves system/user separation when the protocol supports it;
- makes no fallback request after a terminal failure;
- never serializes a credential in thrown diagnostics.

- [ ] **Step 3: Run tests and verify RED**

Run:
`npm test -- tests/unit/providers/ollama.test.ts tests/unit/providers/contracts.test.ts --runInBand`

Expected: FAIL on implicit `llama3` and missing contract suite.

- [ ] **Step 4: Implement discovery and verify the entire slice**

Run:

```bash
npm test -- tests/unit/providers --runInBand
npx tsc --noEmit
```

Expected: all provider tests pass and TypeScript exits `0`; no live API request
or paid model is used.

- [ ] **Step 5: Inspect scope and commit Task 4**

```bash
git add src/providers/ollama.ts tests/unit/providers/ollama.test.ts tests/unit/providers/contracts.test.ts
git commit -m "feat: discover installed Ollama models"
```
