# Hybrid Beta Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` for implementation and
> `superpowers:verification-before-completion` before reporting. This plan is
> being executed through user-authorized SUBCULTURE first-class threads; do not
> spawn subagents, create nested threads, create worktrees, or re-plan the
> locked architecture.

**Goal:** Deliver `0.2.0-beta.3` as an OpenAI-first, provider-agnostic AiDoc beta
with a truthful one-command CLI path and a provider-free local MCP path for
subscription-hosted Codex and Claude workflows.

**Architecture:** Deterministic AST planning and repository-contained target
preparation stay ahead of every provider decision. Direct providers are split
into profiles, selection, endpoint policy, and transports; subscription hosts
consume a non-mutating MCP prepare/validate workflow. Sol owns shared wiring,
package policy, conflict resolution, and final acceptance.

**Tech Stack:** TypeScript 6, Node.js 22.12+, Commander, prompts, Zod,
Handlebars, OpenAI SDK, Anthropic SDK, MCP SDK, Jest.

## Global Constraints

- Follow `/Users/davyd/Documents/aidoc/AGENTS.md`: AST first, `LLMProvider`
  boundary, Handlebars templates, and unit tests for providers/parsers.
- Baseline is commit `8ad1035661ce9fa9d2e937b7eb31f3cdd9b440eb` on
  `codex/hybrid-beta`; it includes repository-contained atomic writes from
  `09e588b3d7cf6a3a2b26d3133ee7a8c45383023c`.
- The accepted design is
  `docs/superpowers/specs/2026-08-12-hybrid-beta-provider-experience-design.md`.
- No API key, OAuth token, browser cookie, or provider credential may be read
  from or written to project configuration by new code.
- No raw source or raw Git diff may enter the update-generation prompt.
- Planning and target preparation must complete before provider construction.
- No hidden provider or origin fallback follows authentication, quota, model,
  HTTP, or network failure.
- MCP prepare/validate tools are repository-scoped and non-mutating.
- Do not publish npm, create a tag/release, open the repository, or add a
  marketplace entry in this plan.
- During the parallel frontier, workers stage only their owned files and run
  focused Jest plus `npx tsc --noEmit`; Sol runs shared/full gates after handoff.

---

## File and responsibility map

| Owner                 | Primary area                                                                                                                     | Shared/blocked surfaces                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Slice A               | `src/impact/targets.ts`, plan/update/default CLI behavior, impact presentation and focused CLI tests                             | Must not edit config schema, provider registry, provider transports, MCP server, package files   |
| Slice B               | provider profiles, endpoint policy, selection/onboarding, safe project persistence, config/registry/context and focused tests    | Must not edit update/plan command behavior, transport implementations, MCP server, package files |
| Sol integration A+B   | command option wiring and the boundary-confirmation call between selected targets and selected provider                          | Starts only after A and B terminal handoffs are accepted                                         |
| Slice C               | OpenAI/Anthropic/compatible/Ollama transports and transport registration/tests                                                   | Starts only after Slice B is accepted; no selection redesign                                     |
| Slice D               | provider-free MCP preparation/validation, prompt extraction, trust inspection and MCP tests                                      | Starts only after Slice A is accepted; no provider transport changes                             |
| Slice E               | repository-owned Codex plugin, source-checkout smoke, README/PUBLIC_BETA/release evidence                                        | Starts only after Slice D is accepted; no publication                                            |
| Sol final integration | `package.json`, lockfile, release version, shared scripts, cross-slice conflicts, full verification and final adversarial review | Exclusive final owner                                                                            |

## Dependency frontier

```text
Slice A ───────────────┐
                      ├─ Sol A+B integration ─┐
Slice B ── Slice C ───┘                       ├─ final integration
   │                                          │
Slice A ── Slice D ── Slice E ────────────────┘
```

Slice A and Slice B are the only concurrent implementation frontier. Slice C
waits for accepted profile/selection interfaces. Slice D waits for the accepted
target resolver. Slice E waits for the accepted MCP schema and handlers.

## Linked implementation plans

1. `docs/superpowers/plans/2026-08-12-smart-plan-update.md`
2. `docs/superpowers/plans/2026-08-12-provider-profiles-selection.md`
3. `docs/superpowers/plans/2026-08-12-current-provider-transports.md`
4. `docs/superpowers/plans/2026-08-12-provider-free-mcp.md`
5. `docs/superpowers/plans/2026-08-12-codex-integration-beta-evidence.md`

## Spec coverage map

| Accepted design sections                                | Implementation owner/evidence                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 5.1, 5.2, 5.3, 5.4, 6                                   | Smart Plan to Update Tasks 1–4                                                                       |
| 7.1, 7.2, 7.5, 7.6, 8                                   | Provider Profiles and Selection Tasks 1–4 plus Curator Task 1                                        |
| 7.3, 7.4 and direct transport portions of 7.2/7.5/7.6   | Current Provider Transports Tasks 1–4                                                                |
| 5.5, 5.6 and 9.1/9.2                                    | Provider-Free MCP Tasks 1–4                                                                          |
| 9.3, subscription/API documentation, source-checkout UX | Codex Integration and Beta Evidence Tasks 1–4                                                        |
| 10 and 11                                               | Per-slice negative tests, safe error contracts, Curator integration-order gate                       |
| 12 and AC-1 through AC-6                                | Slice runtime smokes plus Curator Task 2 full release and adversarial gates                          |
| 13                                                      | Profile/config compatibility tests, unchanged impact schema test, existing MCP tool regression suite |
| 14                                                      | This responsibility map and dependency frontier                                                      |

Self-review found no accepted requirement without an implementation owner. The
post-beta ProofGraph/PR/GitHub Check work remains excluded by design section 4.

## Curator Task 1: Integrate Slice A and Slice B

**Files:**

- Modify: `src/cli/commands/update.ts`
- Modify: `src/cli/context.ts`
- Modify: `src/cli/index.ts` only if accepted worker interfaces require a
  localized hookup
- Test: `tests/unit/cli/update-impact.test.ts`
- Test: `tests/unit/providers/selection.test.ts`

**Interfaces:**

- Consumes: Slice A `ResolvedDocumentationTarget[]` and selected
  `ImpactProviderContext`.
- Consumes: Slice B `resolveProviderSelection()` and
  `confirmProviderBoundary()`.
- Produces: one update call path in which plan, target snapshot, provider
  resolution, boundary display/confirmation, generation, preview and write are
  ordered exactly once.

- [ ] **Step 1: Write the integration-order test**

```ts
expect(events).toEqual([
  "plan",
  "prepare:README.md",
  "select-provider",
  "confirm-boundary",
  "construct-provider",
  "generate:README.md",
  "preview:README.md",
  "write:README.md",
]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
`npm test -- tests/unit/cli/update-impact.test.ts --runInBand`

Expected: FAIL because accepted Slice A and B are not yet wired together.

- [ ] **Step 3: Add the smallest shared hookup**

Register these direct-update options:

```ts
.option("--provider <name>", "Direct provider profile")
.option("--model <model>", "Provider model override")
.option("--provider-base-url <url>", "Advanced compatible provider base URL")
.option("--allow-local-http", "Allow confirmed loopback HTTP for compatible provider")
```

Pass selected target paths, `plan.context.usedBytes`, and the configured Trust
policy into `confirmProviderBoundary()` through Slice B's
`beforeProviderCreate` gate. Do not construct a provider until confirmation
returns true. Treat a declined confirmation or subscription-MCP choice as exit
`0` without generation or write. After a confirmed interactive selection, call
`rememberProviderSelection()` only when `rememberSelection()` explicitly
returns true.

- [ ] **Step 4: Verify the focused integration**

Run:
`npm test -- tests/unit/cli/update-impact.test.ts tests/unit/providers/selection.test.ts --runInBand`

Expected: PASS with no provider construction in no-impact, unsafe-target,
ambiguous, or declined-confirmation cases.

- [ ] **Step 5: Commit the curator integration**

```bash
git add src/cli/commands/update.ts src/cli/context.ts src/cli/index.ts tests/unit/cli/update-impact.test.ts tests/unit/providers/selection.test.ts
git commit -m "feat: integrate smart update provider onboarding"
```

## Curator Task 2: Integrate dependent slices and release gates

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json` only when dependency or script changes require it
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`
- Modify: release policy tests only when a documented beta contract changes

- [ ] **Step 1: Add one failing release-surface assertion per new artifact**

```js
assert.equal(packageJson.version, "0.2.0-beta.3");
assert.ok(packageJson.scripts["test:codex-plugin"]);
assert.ok(packageJson.scripts["test:provider-contracts"]);
```

- [ ] **Step 2: Run the preflight test and verify RED**

Run: `npm run test:public-beta`

Expected: FAIL until the final version, scripts, documentation, and integration
artifacts are present.

- [ ] **Step 3: Wire only accepted scripts and set the beta version**

Set package version to `0.2.0-beta.3`. Add focused scripts referenced by the
accepted Slice C/D/E handoffs. Do not add publish or release automation.

- [ ] **Step 4: Run the complete release candidate gate**

Run: `npm run verify:public-beta`

Expected: exit `0`; lint, Jest, TypeScript build, impact demo, freshness smoke,
tarball/package smoke, action, MCP, beta policy, and preflight all pass.

- [ ] **Step 5: Audit production dependencies**

Run: `npm audit --omit=dev`

Expected: zero known production vulnerabilities. If registry/network access is
unavailable, record the gate as BLOCKED rather than passing it by assumption.

- [ ] **Step 6: Perform the SUBCULTURE adversarial pass**

Select at most three material risks grounded in changed paths. At minimum
consider provider construction ordering, credential/origin binding, and stale
MCP preparation rejection. Record direct evidence and PASS/FAIL/BLOCKED for
each, repair any FAIL, then re-run the affected acceptance gate.

- [ ] **Step 7: Commit the final integration candidate**

```bash
git add package.json package-lock.json scripts tests docs README.md integrations
git commit -m "feat: prepare hybrid provider beta candidate"
```

Do not push, publish, tag, create a release, or merge to `main` without a later
explicit maintainer decision.
