# Codex Integration and Beta Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use the system
> `plugin-creator` workflow for the plugin scaffold,
> `superpowers:test-driven-development` for repository code/tests, and
> `superpowers:verification-before-completion` before the terminal report. This
> dependent SUBCULTURE worker starts only after Provider-Free MCP is accepted;
> do not create agents, threads, or worktrees.

**Goal:** Package AiDoc's accepted local MCP workflow as a repository-owned
Codex plugin/skill and publish reproducible source-checkout evidence and honest
beta documentation without releasing anything externally.

**Architecture:** The plugin contains a manifest, one bundled local MCP server
configuration that invokes the installed `aidoc --mcp` command, and one skill
that enforces prepare → generate → validate → host apply → post-check. Repo-native
smokes validate artifacts in CI; release documentation distinguishes
subscription-hosted MCP from direct API billing.

**Tech Stack:** Codex plugin manifest, `.mcp.json`, Markdown skill, Node smoke
scripts, existing MCP process, Jest/Node test runner.

## Global Constraints

- Prerequisite: accepted `prepare_documentation_update` and
  `validate_documentation_draft` schemas/handlers are present. Stop if names or
  fields differ; do not invent compatibility aliases.
- Read first: `AGENTS.md`, accepted hybrid spec, accepted MCP plan/implementation,
  `README.md`, `docs/PUBLIC_BETA.md`, release gates, and current official plugin
  packaging guidance linked from the spec.
- Use `/Users/davyd/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py`
  to scaffold, then edit generated metadata. Validate with
  `/Users/davyd/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py`.
- Create no personal/repo marketplace entry, install, cachebuster, public
  listing, npm publish, GitHub release, or tag.
- The plugin never reads Codex/ChatGPT/Claude auth files and carries no secret.
- `.mcp.json` invokes `aidoc --mcp`; source-checkout instructions use
  `npm install`, `npm run build`, and `npm link`. Do not embed a developer's
  absolute checkout path.
- Explicitly state that a linked/global source checkout is development setup,
  that npm publication is not part of this implementation, and that ChatGPT web
  needs a separately designed hosted/remote integration.
- Do not claim AiDoc controls context Codex/Claude reads through other tools.
- Package/lockfile/version/script wiring remains Sol-owned final integration.
- The shared SUBCULTURE checkout has one Git index. Do not stage, commit, switch
  branches, reset, clean, or checkout. Treat commit steps below as curator
  checkpoints and report exact changed paths.

---

## Task 1: Scaffold and validate the repository-owned Codex plugin

**Files:**

- Create: `integrations/codex/aidoc/.codex-plugin/plugin.json`
- Create: `integrations/codex/aidoc/.mcp.json`
- Create: `integrations/codex/aidoc/skills/maintain-documentation/SKILL.md`
- Create: `tests/e2e/codex-plugin-smoke.mjs`

- [ ] **Step 1: Write a failing repo-native manifest smoke**

Assert:

```js
assert.equal(manifest.name, "aidoc");
assert.equal(manifest.version, "0.2.0-beta.3");
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.mcpServers, "./.mcp.json");
assert.deepEqual(mcp, {
  aidoc: { command: "aidoc", args: ["--mcp"] },
});
```

Validate strict semver, required author/interface values, at most three default
prompts each <=128 characters, relative in-plugin component paths, no
placeholder, secret, absolute path, hook, app, marketplace, or auth field, and
an actual `SKILL.md` for every declared skill directory.

- [ ] **Step 2: Run the smoke and verify RED**

Run: `node tests/e2e/codex-plugin-smoke.mjs`

Expected: FAIL because the plugin does not exist.

- [ ] **Step 3: Scaffold through plugin-creator**

Run from the plugin-creator skill root:

```bash
python3 scripts/create_basic_plugin.py aidoc --path /Users/davyd/Documents/aidoc/integrations/codex --with-skills --with-mcp
```

Do not pass `--with-marketplace`.

- [ ] **Step 4: Replace scaffold metadata with exact AiDoc metadata**

Use:

```json
{
  "name": "aidoc",
  "version": "0.2.0-beta.3",
  "description": "Plan, prepare, and validate AST-backed documentation updates.",
  "author": { "name": "aidoc contributors" },
  "repository": "https://github.com/mr-min-max/aidoc",
  "license": "MIT",
  "keywords": ["documentation", "ast", "mcp", "codex"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "AiDoc",
    "shortDescription": "Safe AST-backed documentation maintenance.",
    "longDescription": "Plan affected documentation, prepare bounded update context, and validate a draft before applying it.",
    "developerName": "aidoc contributors",
    "category": "Developer Tools",
    "capabilities": ["Read", "Write"],
    "defaultPrompt": [
      "Update the documentation affected by my code changes.",
      "Plan documentation impact without an API key.",
      "Validate this documentation draft before I apply it."
    ]
  }
}
```

Use a direct server map in `.mcp.json` exactly as asserted in Step 1.

- [ ] **Step 5: Validate and commit the scaffold**

Run:

```bash
python3 /Users/davyd/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py integrations/codex/aidoc
node tests/e2e/codex-plugin-smoke.mjs
```

Expected: both commands exit `0`.

```bash
git add integrations/codex/aidoc tests/e2e/codex-plugin-smoke.mjs
git commit -m "feat: package AiDoc Codex integration"
```

## Task 2: Encode the safe host workflow in the bundled skill

**Files:**

- Modify: `integrations/codex/aidoc/skills/maintain-documentation/SKILL.md`
- Modify: `tests/e2e/codex-plugin-smoke.mjs`

**Skill contract:**

```text
1. Call prepare_documentation_update.
2. If multiple targets are returned as an error, ask the user which safe
   relative target to prepare; never guess.
3. Generate one complete Markdown candidate only from generation.system_prompt
   and generation.prompt.
4. Call validate_documentation_draft with the unchanged preparation digest,
   target, and candidate.
5. If invalid/stale/blocked, stop or prepare again; never bypass.
6. Show the approved Markdown diff and request normal host write permission.
7. Apply only approved_markdown to the exact repository-relative target.
8. Run check_docs_freshness (or the accepted post-check tool) after the write.
9. Report the Trust Gate boundary as AiDoc tool-output inspection, not host
   sandbox/isolation.
```

- [ ] **Step 1: Add failing semantic assertions for the skill**

The smoke must parse frontmatter and assert the skill contains each exact tool
name in the required order, says validation happens before edit, uses
`approved_markdown`, forbids stale/Trust bypass, forbids direct subscription
token access, and contains the host-context limitation.

- [ ] **Step 2: Run smoke and verify RED**

Run: `node tests/e2e/codex-plugin-smoke.mjs`

Expected: FAIL until the scaffold placeholder is replaced with the complete
workflow.

- [ ] **Step 3: Write the skill without implementation claims beyond MCP**

Use concise frontmatter with name `maintain-documentation` and a description
that triggers only documentation planning/updating/validation. The body may
explain direct CLI alternatives but must not ask the host to create/read an API
key. It must not invoke legacy provider-backed MCP generation tools for the
subscription path.

- [ ] **Step 4: Validate and commit Task 2**

Run the two validator commands from Task 1; expect PASS.

```bash
git add integrations/codex/aidoc/skills/maintain-documentation/SKILL.md tests/e2e/codex-plugin-smoke.mjs
git commit -m "docs: encode validated Codex documentation workflow"
```

## Task 3: Source-checkout setup and truthful user documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/PUBLIC_BETA.md`
- Create: `docs/integrations/codex.md`
- Create: `docs/integrations/claude.md`
- Create: `docs/releases/v0.2.0-beta.3.md`
- Modify: `tests/unit/release/public-beta-config.test.ts`

- [ ] **Step 1: Write failing beta-contract assertions**

Assert user-facing docs contain:

- `aidoc`, `aidoc plan`, and `aidoc update` simple paths;
- ChatGPT subscription via official Codex authentication + local MCP;
- Claude subscription via Claude Desktop/Code + local MCP;
- API subscriptions/billing are separate from ChatGPT/Claude consumer plans;
- direct providers and exact key variable names;
- Qwen pay-as-you-go-only restriction for custom AiDoc calls;
- no automatic provider fallback;
- no claim of ChatGPT web/local stdio support;
- no claim that AiDoc limits other host context;
- source-checkout setup and uninstall/reversal steps;
- no npm/marketplace/public release claim.

- [ ] **Step 2: Run release docs test and verify RED**

Run:
`npm test -- tests/unit/release/public-beta-config.test.ts --runInBand`

Expected: FAIL because the current beta docs describe only the earlier provider
surface.

- [ ] **Step 3: Write copyable Codex setup**

Use this sequence, clearly marked development/source checkout:

```bash
npm install
npm run build
npm link
aidoc --version
```

Then explain local marketplace installation as a later testing/distribution
step without creating or editing a marketplace in this task. Include reversal:
`npm unlink -g aidoc-gen` and removal/disable of any manually installed plugin.

- [ ] **Step 4: Write Claude setup without subscription OAuth claims**

Document local stdio command `aidoc --mcp` using Claude's official MCP setup.
State that Claude authenticates itself; AiDoc receives no Claude token. Direct
AiDoc Anthropic generation still requires `ANTHROPIC_API_KEY` and separate API
billing.

- [ ] **Step 5: Verify and commit Task 3**

Run the Step 2 command and `node tests/e2e/codex-plugin-smoke.mjs`; expect PASS.

```bash
git add README.md docs/PUBLIC_BETA.md docs/integrations docs/releases/v0.2.0-beta.3.md tests/unit/release/public-beta-config.test.ts
git commit -m "docs: explain hybrid beta access paths"
```

## Task 4: Reproducible hybrid-beta demonstration

**Files:**

- Create: `scripts/demo-hybrid-beta.mjs`
- Create: `tests/e2e/hybrid-beta-demo.test.mjs`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

- [ ] **Step 1: Write a failing deterministic demo test**

The demo creates temporary Git fixtures and proves, without credentials or
network:

1. no-impact `aidoc plan` has no update next-step;
2. one impacted target is auto-selected with `--mock --dry-run`;
3. multiple targets require selection in non-interactive mode unless `--all`;
4. MCP prepare/validate succeeds with provider env removed and writes nothing;
5. a forged preparation and seeded secret are blocked/redacted per policy;
6. plugin manifest and skill smoke pass.

Emit canonical JSON summary with schema
`aidoc.hybrid-beta-demo.v1`, boolean checks, tool/provider names only, and no
temp absolute paths/prompt/content/credentials.

- [ ] **Step 2: Run demo test and verify RED**

Run: `node --test tests/e2e/hybrid-beta-demo.test.mjs`

Expected: FAIL because the demo script does not exist.

- [ ] **Step 3: Implement the demo using only local mocks/processes**

Spawn the built CLI/MCP, explicitly remove all five provider key variables from
child env, bind no public socket, and clean temporary fixtures in `finally`.
Exit non-zero on any false check; do not use `|| true`.

- [ ] **Step 4: Add preflight artifact checks**

Preflight verifies plugin, integration docs, release notes, demo script, and
expected compiled MCP tools. It does not install, publish, tag, or access a
paid provider.

- [ ] **Step 5: Verify the entire slice**

Run:

```bash
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
node tests/e2e/codex-plugin-smoke.mjs
node --test tests/e2e/hybrid-beta-demo.test.mjs
npx tsc --noEmit
```

Expected: all commands exit `0`.

- [ ] **Step 6: Inspect scope and commit Task 4**

Do not edit `package.json` to add scripts; report the exact recommended script
names to Sol for final integration.

```bash
git add scripts/demo-hybrid-beta.mjs scripts/public-beta-preflight.mjs tests/e2e/hybrid-beta-demo.test.mjs tests/e2e/public-beta-preflight.test.mjs
git commit -m "test: add reproducible hybrid beta evidence"
```
