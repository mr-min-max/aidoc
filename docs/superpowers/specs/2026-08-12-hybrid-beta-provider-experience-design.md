# Hybrid Beta Provider Experience Design

- **Status:** Proposed for maintainer review
- **Date:** 2026-08-12
- **Target release:** `0.2.0-beta.3`
- **Working branch:** `codex/oss-evidence-sprint`
- **Baseline:** `09e588b3d7cf6a3a2b26d3133ee7a8c45383023c`

## 1. Decision summary

AiDoc will be **OpenAI-first, but not OpenAI-only**.

The public beta will support three honest ways to use the product:

1. **Subscription-hosted workflow:** Codex authenticated with an eligible
   ChatGPT subscription, or Claude Desktop/Code authenticated with Claude,
   remains the model host and calls AiDoc through provider-free local MCP tools.
   AiDoc never receives or reuses the host's subscription token.
2. **Direct CLI workflow:** `aidoc update` uses an explicitly selected API
   provider or local Ollama through the existing `LLMProvider` boundary.
3. **Deterministic workflow:** `aidoc plan`, `aidoc check`, and `aidoc score`
   remain usable without a provider, key, login, or network request.

The first beta will not present ChatGPT Plus/Pro or Claude Pro/Max as API
entitlements. It will not read Codex or Claude authentication files, copy OAuth
tokens, call undocumented subscription endpoints, or silently fall back from
one vendor to another.

The polished OpenAI experience will be a Codex plugin containing an AiDoc skill
and MCP configuration. A user with an eligible ChatGPT plan authenticates in
the official Codex client; AiDoc does not authenticate that plan. Claude users
can connect the same MCP server through the official Claude MCP flow. Direct
model calls remain available through OpenAI, Anthropic, DeepSeek, Alibaba Model
Studio/Qwen, an advanced explicit OpenAI-compatible profile, and Ollama.

## 2. Why the direct Codex-as-provider idea is rejected for this beta

The official Codex SDK and App Server are valid integration surfaces and support
ChatGPT subscription authentication. However, Codex is an agent runtime, not a
drop-in completion endpoint. Its `read-only` sandbox protects writes but does
not establish that the agent can read only the temporary working directory.

AiDoc's Trust Gate promises that the rendered, scanned, bounded prompt is the
provider boundary. A Codex agent with filesystem tools could inspect additional
files outside that prompt. Running it as an `LLMProvider` would therefore make
the product's strongest privacy claim unprovable on a normal host.

For `0.2.0-beta.3`:

- Codex subscription use is supported through the host-first MCP/plugin flow.
- A direct Codex SDK provider is a non-goal.
- It may be reconsidered only when AiDoc can disable filesystem/tool access or
  run the agent in a separately verified OS/container isolation boundary.

This is a security decision, not a judgment that the official SDK is unsafe for
its intended coding-agent use.

## 3. Goals

### 3.1 Product goals

- Make `aidoc update` the complete direct-CLI happy path: plan, select affected
  documentation, select a configured provider when needed, generate, preview,
  confirm, and write.
- Make `aidoc` with no subcommand a useful interactive entry point instead of a
  wall of help text.
- Let an eligible ChatGPT subscriber using Codex, or a Claude subscriber using
  Claude Desktop/Code, say a normal sentence such as "update the affected
  documentation with AiDoc" without obtaining a separate API key.
- Make DeepSeek and Qwen first-class, understandable provider choices without
  duplicating transport code or asking ordinary users to understand arbitrary
  base URLs.
- Keep OpenAI a first-class, best-documented path without claiming exclusivity
  or hiding other supported providers.
- Preserve AST-first planning, Trust Gate inspection, bounded provider context,
  repository-contained writes, and explicit human review.

### 3.2 OSS and program-readiness goals

- Demonstrate a real Codex maintainer workflow through an installable
  plugin/skill and MCP tools.
- Publish reproducible no-key, API-provider, local-provider, MCP, security, and
  package smoke tests.
- Keep the provider architecture genuinely extensible through `LLMProvider` and
  registered provider profiles.
- Document exact capabilities and limitations instead of using broad "AI
  agent" claims.

## 4. Non-goals

- Claude.ai OAuth or subscription-rate-limit access from AiDoc.
- Reading `~/.codex/auth.json`, Claude credential stores, browser cookies, or
  any other host authentication material.
- Automatic provider switching after authentication, rate-limit, quota, model,
  or network errors.
- A hosted AiDoc service, remote MCP endpoint, user accounts, payments, or
  telemetry.
- A direct ChatGPT web app/connector integration. The source-checkout beta uses
  local MCP through Codex; a ChatGPT web integration would require a separately
  designed hosted/remote app surface.
- Arbitrary unconfirmed remote provider URLs in the normal onboarding path.
- Cross-file transactional rollback for multi-document updates. Each accepted
  document write remains individually atomic and repository-contained.
- ProofGraph, evidence sidecars, isolated PR creation, or GitHub Check creation
  in this release. Those remain post-beta product work.
- Publishing npm, tags, GitHub Release, a public marketplace listing, or making
  the repository public as part of implementation.

## 5. Primary user journeys

### 5.1 No key, no model

```text
aidoc plan
```

AiDoc chooses a safe Git base, performs AST comparison, maps affected
documentation, and reports whether an update is indicated. It constructs no
provider and makes no network request.

If no documentation update is indicated, output ends with a completed state and
does not print `Next: aidoc update`.

### 5.2 Direct CLI with one affected document

```text
aidoc update
```

1. Build the deterministic impact plan.
2. Stop without provider construction when no documentation impact exists.
3. Resolve the sole affected Markdown document automatically.
4. Prepare its repository-contained snapshot before provider construction.
5. Resolve the provider by the precedence in section 8.
6. Show the provider, model, remote/local boundary, and target before the call.
7. Generate from the scanned existing document and bounded impact context.
8. Show the diff.
9. Ask before writing unless `--yes` was supplied.
10. Replace the file atomically through the repository writer.

### 5.3 Direct CLI with several affected documents

Interactive terminals receive a multi-select list sorted by path. Every row
includes the reason it was selected: direct reference, recommendation, or
unmapped public change fallback.

Non-interactive execution must use one or more explicit `--target` values or
`--all`. Ambiguous non-interactive execution fails before provider construction.

Targets are prepared before their individual provider call. Each generated diff
is confirmed and written separately. Cancellation leaves already accepted
targets intact and skips remaining targets. `--all --yes` is allowed for trusted
automation and must document this partial-progress behavior in its final
summary.

### 5.4 `aidoc` with no subcommand

In an interactive Git worktree, `aidoc` runs the same deterministic plan used by
`aidoc plan`, prints the concise result, and offers one contextual action:

- no impact: exit successfully;
- impact: `Prepare an update now?`;
- planning error: show the stable plan diagnostic and exit non-zero.

In a non-interactive shell, `aidoc` prints concise command help and performs no
generation or write.

### 5.5 Codex user with a ChatGPT subscription

The user signs in to the official Codex client with an eligible ChatGPT plan,
installs the AiDoc Codex integration, and asks in natural language.

Codex calls provider-free AiDoc MCP tools to obtain a bounded update preparation.
It generates a candidate, asks AiDoc to validate it while the repository is
still unchanged, and only then shows and writes it through Codex's own
permission model. AiDoc never treats the ChatGPT subscription as an API key and
never receives Codex OAuth credentials.

### 5.6 Claude Pro/Max user

The user connects AiDoc as a local MCP server in Claude Desktop or Claude Code.
The tool workflow is the same as the Codex workflow. AiDoc does not offer a
`Sign in with Claude` button or claim access to Claude subscription quotas.

## 6. Smart documentation-target resolution

Introduce a provider-free target-selection module. It consumes only
`ImpactPlan` and repository state.

### 6.1 Candidate collection

Candidates are the unique normalized `file` values from:

1. `DocumentationImpact.directReferences`;
2. `DocumentationImpact.recommendations`.

Only repository-contained Markdown files are eligible. A candidate is prepared
through the repository writer before any provider is constructed.

If the plan has an unmapped public symbol change and no mapped candidate, use
`README.md` only when it already exists inside the repository. Label the reason
as `unmapped-public-change-fallback`. Do not invent a new target silently.

### 6.2 Overrides

- Repeated `--target <file>` values replace automatic selection.
- `--all` selects all automatic candidates.
- `--target` and `--all` together are invalid.
- `--base` and the compatibility alias `--since` retain their existing
  equality rule.

### 6.3 Plan presentation

- Zero impact: `No documentation updates are indicated.` and no next command.
- One candidate: print the candidate and `Next: aidoc update`.
- Several candidates: print their sorted paths and `Next: aidoc update`.
- Impact with no safe target: explain that an explicit `--target` is required.

Human and JSON plan output remain deterministic. Interactive target selection
belongs to `update`, not `plan`.

## 7. Provider architecture

### 7.1 Separation of concerns

The implementation will separate:

- **Provider profile:** name, display name, credential environment variable,
  default model, fixed or validated endpoint policy, capability flags, and
  setup guidance.
- **Transport:** OpenAI Responses, Anthropic Messages, OpenAI-compatible Chat
  Completions, or Ollama.
- **Selection:** explicit configuration and safe interactive resolution.
- **Generation:** the existing `LLMProvider` and `Generator` boundary.

Provider-specific prompts remain Handlebars templates under `src/templates/`.
No provider may parse code or Git changes independently of the AST-first plan.

### 7.2 Built-in direct providers

| Profile             | Credential             | Default model        | Endpoint policy                        |
| ------------------- | ---------------------- | -------------------- | -------------------------------------- |
| `openai`            | `OPENAI_API_KEY`       | `gpt-5.6-luna`       | Official OpenAI API only               |
| `anthropic`         | `ANTHROPIC_API_KEY`    | `claude-sonnet-5`    | Official Claude API only               |
| `deepseek`          | `DEEPSEEK_API_KEY`     | `deepseek-v4-flash`  | `https://api.deepseek.com`             |
| `qwen`              | `DASHSCOPE_API_KEY`    | `qwen3.6-flash`      | Validated Alibaba Model Studio profile |
| `ollama`            | none                   | no universal default | Loopback/local endpoint by default     |
| `openai-compatible` | `AIDOC_COMPAT_API_KEY` | required explicitly  | Advanced explicit URL only             |

The default models are versioned product defaults, not claims that they are
best for every repository. `AIDOC_MODEL` and project configuration may override
them. The release documentation must show the selected model before a remote
call.

Ollama must not pretend that a model is installed. If no model is configured,
onboarding lists locally available models and asks the user to choose. A
non-interactive Ollama run requires `AIDOC_MODEL` or project configuration.

### 7.3 OpenAI implementation

The OpenAI provider moves from deprecated GPT-4o-era defaults to the current
Responses API. It preserves the `LLMProvider` text/JSON/streaming contract and
uses the official OpenAI SDK. `gpt-5.6-luna` is the cost-sensitive default;
documentation recommends `gpt-5.6-terra` when maintainers prefer a stronger
quality/cost balance.

### 7.4 Anthropic implementation

The Anthropic provider uses the current Messages API model ID
`claude-sonnet-5`. It does not expose Claude subscription login. Parameters
unsupported by the selected Claude model are omitted rather than sent with a
guessed value.

### 7.5 DeepSeek and Qwen

DeepSeek and Qwen use a shared OpenAI-compatible transport but separate public
profiles. The profiles own vendor-specific defaults, environment variables,
capability differences, and endpoint validation.

DeepSeek uses the current v4 model IDs and does not use retired
`deepseek-chat`/`deepseek-reasoner` defaults.

Qwen onboarding asks for the documented region/plan, constructs a known
Alibaba endpoint, and stores only the non-secret endpoint/profile choice. A key
from another region or plan must fail with vendor-specific guidance rather than
retrying another host.

### 7.6 Advanced OpenAI-compatible profile

The advanced profile requires all of:

- explicit HTTPS base URL, except loopback HTTP with explicit opt-in;
- explicit model;
- `AIDOC_COMPAT_API_KEY`;
- explicit trust confirmation in an interactive terminal or previously saved
  project configuration.

It must not reuse `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, or
`DASHSCOPE_API_KEY`. URLs with userinfo, query, or fragment are rejected.
Cross-origin redirects are rejected, and the authorization header is never
forwarded to another origin. Private, link-local, and metadata addresses are
rejected unless they are loopback and the user explicitly selected local HTTP.

## 8. Provider selection and onboarding

### 8.1 Configuration model

Change the generation default from implicit `openai` to `auto`. `auto` is a
selection state, not a registered transport.

Precedence:

1. command `--provider` and `--model`;
2. `AIDOC_PROVIDER` and `AIDOC_MODEL`;
3. project config;
4. safe availability detection;
5. interactive choice;
6. actionable failure in non-interactive mode.

An exact provider-specific credential variable counts as intent for that
provider only when it is the sole ready remote API profile. If several remote
profiles are ready, AiDoc asks. It never ranks providers by price or silently
chooses a company.

Ollama availability is established by a bounded loopback health/model-list
request. A local process being reachable does not outrank explicit config.

### 8.2 Embedded onboarding

`aidoc update` invokes onboarding only after a non-empty plan and safe target
preparation. The screen separates:

- `Available now`;
- `Connect another provider`;
- `Use a ChatGPT subscription in Codex, or use Claude, through local MCP`;
- `Exit without sending data`.

Before the first remote call, show provider, model, endpoint origin, Trust Gate
policy, target paths, and bounded context bytes. The default action is not to
send until the user confirms.

The user may choose `Remember this provider in this project`. This writes only
non-secret provider/model/endpoint-profile fields to `.aidocrc.json`, preserves
existing valid fields, and uses the repository-contained writer. The default is
not to modify project configuration.

### 8.3 Non-interactive behavior

CI and redirected input never show prompts. A remote update requires explicit
provider configuration and `--yes` for writes. Missing or ambiguous selection
fails before provider construction and prints one exact setup example.

## 9. Provider-free MCP workflow

Existing generation tools remain compatible for BYOK users. Add a provider-free
workflow for subscription hosts.

### 9.1 `prepare_documentation_update`

Input:

- optional `base`, `head`, and `max_context_bytes`;
- optional explicit `target`.

Behavior:

1. Use the repository where the MCP server started; reject caller-supplied
   directories.
2. Build the deterministic impact plan.
3. Resolve safe candidate targets.
4. Prepare the selected existing document without writing.
5. Render the update template.
6. Run the same Trust Gate input inspection used immediately before a direct
   provider call.

Return a versioned JSON object containing an opaque preparation digest bound to
the normalized impact plan, selected target, source snapshot, and existing
target snapshot; the safe target; redacted/rendered generation input; context
byte report; Trust Gate summary; and validation instructions. It must not
include raw source, raw Git diff, credentials, absolute local paths, or
unscanned existing-document text.

### 9.2 `validate_documentation_draft`

Input:

- preparation digest;
- repository-relative target;
- candidate Markdown content.

Behavior:

- recompute the preparation inputs and reject a stale digest before the host
  writes anything;
- validate the target through repository containment;
- run Trust Gate output inspection and Markdown validation;
- return a non-mutating validation result and safe diff summary.

The MCP beta does not write files. Codex or Claude writes through its own
permission system only after successful validation and after showing the user
the change. If the repository changed between preparation and validation, the
host must prepare again instead of forcing the stale candidate. This avoids
bypassing host approval semantics and keeps current MCP tools non-mutating.

The Trust Gate governs only the data AiDoc returns through these tools. It
cannot attest to or restrict repository context that Codex or Claude may obtain
through the host's other tools and permissions. The integration documents this
boundary explicitly and instructs the host to generate from the prepared input,
but does not market that instruction as an isolation guarantee.

### 9.3 Codex plugin/skill

Ship a repository-owned Codex integration that instructs the host to:

1. call `prepare_documentation_update`;
2. generate only the requested Markdown from the returned safe input;
3. call `validate_documentation_draft` with the candidate before editing;
4. show and apply a validated change through the host's normal file-edit
   permission;
5. run the existing freshness/check tool after the write;
6. report Trust Gate, stale-preparation, or post-write check failures without
   bypassing them.

The integration must use official plugin/skill and MCP packaging conventions,
contain no secrets, and work from a source checkout before any marketplace or
npm publication.

## 10. Security and privacy invariants

- Deterministic planning and target preparation happen before provider
  construction.
- Remote origin is displayed before every first-use call.
- Credentials come only from provider-specific environment variables or the
  provider SDK's documented mechanism; project files never receive keys.
- Provider errors are sanitized through existing security diagnostics.
- No raw source or raw Git diff enters update provider context.
- MCP preparation applies the same inspection rules to data returned by AiDoc,
  while explicitly distinguishing that tool boundary from the host model's
  broader permissions and context.
- Existing document content is inspected before it leaves the process.
- Generated output is inspected before display through MCP or write through the
  CLI.
- A provider or endpoint change never transports a legacy generic `apiKey` to a
  new origin.
- Endpoint and authorization values are redacted in logs and receipts.
- No hidden fallback follows a 401, 403, 404, 429, quota, model, or network
  error.
- Existing repository-contained snapshot, symlink/junction, same-directory
  rename, and atomic-write guarantees remain mandatory.

## 11. Errors and exit behavior

- `0`: completed, including a correct zero-impact no-op or user cancellation
  before generation.
- `1`: ordinary plan, configuration, provider, model, network, or validation
  failure.
- `2`: Trust Gate or repository-boundary rejection.

New errors use stable safe codes for JSON/MCP paths. Human diagnostics include
one next action and never echo secrets, prompt content, absolute local paths, or
provider responses.

## 12. Testing and evidence

### 12.1 Required automated coverage

- Target resolver unit tests: zero, one, many, duplicate references, unsafe
  path, missing fallback, explicit overrides, and non-interactive ambiguity.
- CLI update tests: provider is never constructed before plan/target safety;
  interactive and non-interactive behavior; repeated targets; `--all`; `--yes`;
  cancellation and partial progress.
- Provider-selection tests: precedence, single/multiple ready profiles, no
  cross-provider key reuse, no hidden fallback, no secret persistence.
- Transport contract tests for OpenAI Responses, Anthropic Messages, DeepSeek,
  Qwen, generic compatible, and Ollama with local fakes/mocks.
- Endpoint-security tests for origin binding, HTTPS/loopback policy, URL
  rejection, redirect handling, and safe diagnostics.
- MCP parity and security tests: provider-free construction, bounded output,
  stale plan, forged arguments, hostile Markdown, Trust Gate redaction/strict
  rejection, and no writes.
- Codex integration package/manifest validation and a source-checkout smoke
  workflow.
- Packed-package smoke proving templates, MCP entry point, and provider profiles
  survive npm packing.

### 12.2 Required runtime demonstrations

- `aidoc plan` on the fixed impact fixture without credentials.
- `aidoc update --mock` for zero, one, and multiple candidates.
- `aidoc update` with a recording provider that proves only bounded context
  crosses the provider boundary.
- local Ollama detection against a fake loopback server.
- DeepSeek/Qwen/OpenAI-compatible requests against local protocol fakes, never
  live paid APIs in CI.
- MCP prepare/validate round trip with no provider environment variables.
- Codex integration smoke using MCP tool schemas without making a paid model
  request.

### 12.3 Release gates

- full Jest, lint, build, package, action, MCP, beta-policy, and public-beta
  preflight gates pass;
- dependency audit has no known production vulnerability;
- README and `docs/PUBLIC_BETA.md` state subscription/API separation, the Codex
  versus ChatGPT-web distinction, and exact beta limitations;
- repository remains private and no tag/release/npm publish occurs without a
  later explicit maintainer decision.

## 13. Compatibility and migration

- Existing explicit `provider: openai|anthropic|ollama` configs continue to
  work.
- The legacy plaintext `apiKey` field remains readable only under its recorded
  provider during the existing compatibility window and is never written by new
  onboarding.
- Existing CLI commands and MCP generation tool names remain available.
- `aidoc plan --json` retains `aidoc.impact-plan.v1` unless a schema change is
  independently justified; new MCP workflow objects receive their own version.
- `--since` remains an alias for `--base`.

## 14. Implementation decomposition and ownership

The work is split into testable vertical slices. Shared surfaces are sequenced,
not edited concurrently.

### Slice A: Smart Plan to Update

Owns target resolution, plan presentation, no-subcommand interactive entry,
update target selection, and their focused tests. It does not change provider
registries or transports.

### Slice B: Provider Profiles and Selection

Owns profile types, `auto` selection, endpoint policy, configuration precedence,
provider onboarding primitives, and their focused tests. It owns shared config
schema/loader/registry changes for the whole release.

Slices A and B may run in parallel because their shared integration into
`loadCommandContext` is reserved for the curator after both are accepted.

### Slice C: Current Provider Transports

Blocked by Slice B. Owns OpenAI Responses modernization, Anthropic current model
behavior, compatible transport, DeepSeek/Qwen/generic profiles, Ollama model
discovery, and transport/security tests. It may not redesign selection.

### Slice D: Provider-free MCP Update Workflow

Blocked by Slice A's target resolver and the accepted Trust Gate boundary. Owns
new MCP schemas/handlers and no-write tests. It does not change direct provider
transports.

### Slice E: Codex Integration and Beta Evidence

Blocked by Slice D. Owns the Codex plugin/skill package, source-checkout setup,
integration smoke, subscription/API documentation, README/PUBLIC_BETA updates,
and demo evidence. It does not publish externally.

### Curator-owned integration

The main thread owns:

- shared `package.json` and lockfile decisions;
- shared command/context wiring;
- conflict resolution between accepted slices;
- release version and policy surfaces;
- final full verification, adversarial review, and integration verdict.

## 15. Release acceptance criteria

### AC-1: Provider-free behavior remains first-class

With every provider credential removed, `aidoc plan`, `aidoc check`,
`aidoc score`, MCP plan, MCP prepare, and MCP validate run without constructing
an LLM provider.

### AC-2: Direct one-command update is truthful and safe

`aidoc update` plans and resolves targets before provider construction, clearly
shows the selected provider/model/origin, previews every diff, and writes only
after confirmation or explicit `--yes`.

### AC-3: Subscription users need no API key

A Codex host authenticated by an eligible ChatGPT plan, or a Claude
Desktop/Code host authenticated by Claude, can prepare, generate, validate,
apply, and post-check an AiDoc-guided update using local MCP without AiDoc
receiving a subscription token or calling a provider API.

### AC-4: Multi-provider support is explicit

OpenAI, Anthropic, DeepSeek, Qwen, generic compatible, and Ollama each have an
honest setup path, their own credential/origin boundary, and no implicit
cross-provider fallback.

### AC-5: Trust guarantees survive every path

Direct API, local Ollama, legacy MCP generation, and provider-free MCP
preparation apply their documented Trust Gate and repository-boundary rules,
with negative tests proving that unsafe input/output/path cases stop before
escape or write. The provider-free MCP claim is scoped to data returned by
AiDoc and does not imply control over other host tools.

### AC-6: Beta evidence is reproducible

The packed source candidate passes all required local release gates and provides
copyable demonstrations for no-key planning, smart update, provider protocols,
MCP subscription use, and the Codex integration.

## 16. Source basis checked on 2026-08-12

- OpenAI Codex authentication:
  <https://learn.chatgpt.com/docs/auth>
- OpenAI Codex SDK:
  <https://learn.chatgpt.com/docs/codex-sdk>
- OpenAI Codex MCP:
  <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>
- OpenAI Codex for Open Source:
  <https://developers.openai.com/community/codex-for-oss>
- OpenAI current model guidance:
  <https://developers.openai.com/api/docs/guides/latest-model>
- Anthropic subscription/API separation:
  <https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console>
- Anthropic third-party authentication restriction:
  <https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-overview>
- Anthropic current models:
  <https://platform.claude.com/docs/en/about-claude/models/overview>
- DeepSeek API:
  <https://api-docs.deepseek.com/>
- Alibaba Model Studio OpenAI compatibility:
  <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions>
