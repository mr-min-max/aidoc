# aidoc — Upgrade Design (Approach C)

**Date:** 2026-06-24
**Goal:** Make aidoc genuinely work and stand out — fix what's broken, then add 2 high-impact features (doc-quality scoring + watch/streaming) that differentiate it from README-AI/Mintlify and make it demoable.

**Success criteria:**
- Everything the README promises actually works (retry, validation, resilient generation).
- `aidoc watch` regenerates docs live on file save — strong demo.
- `aidoc score` grades documentation health 0–100 — no direct competitor has this.
- Incremental commits across the work so history reads like a real project.

---

## 1. Critical Fixes (does what the README promises)

These break claims already made in README. Fix first.

### 1.1 Wire up `withRetry` to all providers
**Problem:** `withRetry()` exists and is tested, but `OpenAIProvider`/`AnthropicProvider`/`OllamaProvider` never call it. README says "Resilient: retry with exponential backoff" — it's not.
**Fix:** Wrap the network call inside each provider's `generate()` with `withRetry(fn, { maxRetries: 3 })`. Providers already throw messages containing `429`/`503`/`timeout` which `isRetryableError` matches.
**Files:** `src/providers/openai.ts`, `anthropic.ts`, `ollama.ts`.
**Tests:** provider unit tests with mocked clients asserting retry count.

### 1.2 One `ts-morph` Project for the whole run
**Problem:** `TypeScriptParser` creates `new Project()` per file (`typescript.ts:12`) → 100 compiler boots for 100 files.
**Fix:** Reuse a module-level `Project`. Parser adds each file via `project.addSourceFileAtPath()` on the shared instance.
**Files:** `src/parsers/typescript.ts`.
**Tests:** existing typescript parser tests stay green; add a benchmark-style test asserting a single Project instance is reused.

### 1.3 Graceful JSON parsing in `annotate`
**Problem:** `annotate.ts:56` does `JSON.parse(response)` with no guard — one stray token from the LLM and the command crashes.
**Fix:** Wrap in try/catch; on failure, surface a clear error ("LLM returned malformed JSON") rather than a raw `SyntaxError`. Optionally strip markdown fences before parsing.
**Files:** `src/cli/commands/annotate.ts` (later moved into the shared layer — see §3).
**Tests:** unit test with malformed response.

### 1.4 Actually use `validateMarkdown`
**Problem:** `validateMarkdown()` exists but is called nowhere. Generated docs can have unclosed code blocks.
**Fix:** Validate generator output before writing; warn (don't fail) on warnings, log via `logger`.
**Files:** integrate in the shared output helper (§3.2).

---

## 2. Provider Registry (plugin-style)

**Problem:** provider list `'openai' | 'anthropic' | 'ollama'` is hardcoded in two places — `factory.ts` and `schema.ts`. Adding a provider means editing core.
**Design:** `src/providers/registry.ts`
- `interface ProviderDefinition { name; available(): boolean; create(config): LLMProvider }`
- `registerProvider(def)`, `createProvider(config)`, `listProviders()`.
- Each provider registers itself. `schema.ts` validates against `listProviders()` — single source of truth.
- Opens the door for community providers (Gemini, Mistral, vLLM) without core edits — matches ROADMAP "Plugin system".
**Files:** new `src/providers/registry.ts`; rewrite `factory.ts` to delegate; update `schema.ts`.
**Tests:** registry tests (register, lookup, unknown provider error).

---

## 3. Shared Command Layer (remove duplication)

**Problem:** 6 commands duplicate the same skeleton (`loadConfig → analyzeCodebase → createProvider → new Generator → mock branch`). Adding streaming means editing 6 files.

### 3.1 `CommandContext`
`src/cli/context.ts` — `loadCommandContext(options) → { config, cwd, provider, generator, modules }`. Generator is a real or mock instance chosen by options (strategy), so commands drop their `if (options.mock)` branches.

### 3.2 Output helper
`writeDoc(path, content, { dryRun, target })` — reads existing, shows diff, confirms, writes, runs `validateMarkdown`. Replaces repeated per-command logic in `readme`/`api`/`changelog`/`diagram`/`update`.

### 3.3 `MockGenerator`
Class implementing the same methods as `Generator`, returning the mock strings currently inlined in each command. Commands stay identical for real/mock.

**Files:** new `src/cli/context.ts`, `src/cli/output.ts`; rewrite 6 commands to use them; delete inline mock blocks.
**Tests:** context tests; existing behavior preserved.

---

## 4. Feature: Doc-Quality Scoring (`aidoc score`)

**Why:** no competitor offers this. Grades documentation health 0–100.

**What it does (deterministic, no LLM — fast, free, cacheable):**
- Scan AST: % of exported functions with `existingDoc`, % of exported classes with docs, % of methods documented.
- Module-level coverage + project-level aggregate score.
- Bucket: 0–39 🔴 Poor, 40–69 🟡 Fair, 70–100 🟢 Good.
- Output: terminal table (per-module) + optional `--output docs/score.md` (markdown report with breakdown).
- `--json` for CI consumption; exit code 1 when score below `--min` (configurable) → CI gate.

**Optional LLM pass (off by default, `--llm`):** check doc *quality* (placeholder docs like "TODO", stub descriptions) — flagged separately, doesn't change the deterministic score.

**Files:** new `src/core/score.ts` (scoring engine), `src/cli/commands/score.ts`; add `score` command in `cli/index.ts`; template `src/templates/score.hbs` for the report.
**Tests:** scoring engine unit tests (fixtures with known coverage); command test.

---

## 5. Feature: Watch + Streaming (`aidoc watch`)

**Why:** the strongest demo moment — docs update live as you save a file. + Streaming LLM output makes generation feel instant.

### 5.1 Streaming
Extend `LLMProvider` with optional `generateStream(prompt, options, onToken)`; providers implement via their native streaming APIs (OpenAI `stream: true`, Anthropic `messages.stream`, Ollama ndjson stream). `Generator` gains `*Stream` variants that call `onToken` and write tokens to the spinner/terminal live. Commands fall back to non-streaming if unsupported.

### 5.2 Watch mode
`aidoc watch [--target README.md]`:
- File watcher (chokidar) on the configured `include` globs.
- On change: debounce (300ms), re-parse the changed file (AST cache reuse), determine if the change is in a documented area, regenerate only the affected section via the diff-aware `update` generator, show live diff, write if `--auto` (else prompt).
- Graceful handling of bulk saves / many files.
- `Ctrl-C` clean exit.

**Files:** new `src/cli/commands/watch.ts`, `src/core/watcher.ts`; extend `src/providers/types.ts`, the 3 providers, `src/core/generator.ts`; add dependency `chokidar`.
**Tests:** watcher debounce/ignore logic unit tests; streaming token-accumulation test with a mock provider.

---

## 6. Out of scope (YAGNI / later)
- New languages (Go/Rust parsers) — separate effort.
- init wizard — quick later win, not now.
- call-graph diagrams — interesting but bigger lift; defer.
- VS Code extension.

---

## 7. Commit plan (incremental, as we go)
1. `fix: wire retry into providers, reuse ts-morph Project, harden annotate JSON`
2. `refactor: provider registry + shared command layer`
3. `feat: doc-quality scoring (aidoc score)`
4. `feat: watch mode with live regeneration + streaming LLM`
5. `test: expand coverage` + `docs: update README/ROADMAP`

---

## 8. Risks / notes
- **chokidar** is a new native-ish dependency; acceptable, it's the Node standard for file watching. Alternative: Node's `fs.watch` (flaky across platforms) — chokidar is the sane choice.
- **Streaming API surface** must stay backward compatible (optional method) so mock + non-streaming providers keep working.
- All new code gets unit tests (AGENTS.md §4). AST-first principle preserved (AGENTS.md §1) — scoring is deterministic AST analysis; LLM only for optional quality pass.
