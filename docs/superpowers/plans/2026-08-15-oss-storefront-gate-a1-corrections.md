# AiDoc Gate A1 Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AiDoc storefront candidate truthful, reproducible, lint-clean, visually clear, and ready for a fresh local Gate A1 review while producing three untracked logo concepts for maintainer selection.

**Architecture:** Keep product runtime and security behavior unchanged. Strengthen the existing deterministic hybrid demo so its validated Markdown exactly matches the visible animation, make packaged README copy durable across publication, replace the five animation sources with a plain-language proof sequence, and keep logo exploration outside Git until the maintainer chooses a mark.

**Tech Stack:** Node.js 24, TypeScript, Jest, Node test runner, ESLint, SVG, PNG, animated GIF, Markdown, WebVTT, Quick Look, `sips`, and `ffmpeg`.

## Global Constraints

- Work only in `/Users/davyd/Documents/aidoc/.worktrees/oss-evidence-sprint` on `codex/oss-evidence-sprint`.
- Do not create or switch branches or worktrees.
- Do not push, open a pull request, tag, publish, upload repository metadata, or mutate npm/GitHub release state.
- Preserve the `aidoc.hybrid-beta-demo.v1` schema and its nine check names.
- Preserve provider-free, credential-free, and no-write demo behavior.
- Keep package version `0.2.0-beta.6`; npm beta.5 remains current public and beta.4 remains `latest` during candidate review.
- Use only the protected noreply identity for commits.
- Do not track logo exploration files before maintainer selection.
- Do not add dependencies or change runtime/provider/parser/MCP/security code.
- Do not introduce Unicode em dash, private paths, secrets, provider claims, adoption claims, testimonials, or grant claims.

---

### Task 1: Make the canonical demo validate the visible focused draft

**Files:**

- Modify: `tests/e2e/hybrid-beta-demo.test.mjs`
- Modify: `scripts/demo-hybrid-beta.mjs`

**Interfaces:**

- Consumes: existing `createFixture()`, `runMcpEvidence()`, v1 report schema, and `snapshotRepositoryTree()`.
- Produces: exact baseline Markdown containing `createUser(email)` and exact approved Markdown containing `createUser(email, role)` for both targets.

- [ ] **Step 1: Add the failing source and behavior contract**

Extend the existing source-contract test with:

```js
assert.match(source, /Use `createUser\(email\)` from the source module\./u);
assert.match(
  source,
  /Use `createUser\(email, role\)` from the source module\./u,
);
assert.match(
  source,
  /approvedTargets\.push[\s\S]{0,500}createUser\(email, role\)/u,
);
assert.doesNotMatch(source, /Validated by the host/u);
```

Keep the deterministic report deep-equality assertion unchanged.

- [ ] **Step 2: Run RED**

Run:

```bash
npm run build
node --test tests/e2e/hybrid-beta-demo.test.mjs tests/e2e/storefront-demo.test.mjs
```

Expected: the source contract fails because the fixture uses generic prose and
the host candidate is `Validated by the host`.

- [ ] **Step 3: Implement the exact per-target draft**

Change fixture Markdown to:

```js
[
  "# Hybrid fixture",
  "",
  "## API",
  "",
  "Use `createUser(email)` from the source module.",
  "",
].join("\n");
```

Build the host candidate inside the preparation loop from the exact same
document shape with the updated line:

```js
const candidate = [
  "# Hybrid fixture",
  "",
  "## API",
  "",
  "Use `createUser(email, role)` from the source module.",
  "",
].join("\n");
```

For every preparation, require all of these before recording approval:

```js
validation.valid === true &&
  validation.approved_markdown === candidate &&
  validation.approved_markdown.includes("createUser(email, role)") &&
  !validation.approved_markdown.includes("Validated by the host");
```

Keep snapshots before and after every prepare, validate, forged-digest,
secret-candidate, and freshness call.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm run build
node --test tests/e2e/hybrid-beta-demo.test.mjs tests/e2e/storefront-demo.test.mjs
npm run demo:storefront
```

Expected: 5 Node tests pass, presentation output stays the exact seven lines,
and the default report remains deterministic with all nine checks true.

- [ ] **Step 5: Inspect the focused diff contract**

Confirm with `rg` that the demo source contains both exact document lines,
does not contain `Validated by the host`, and changes no product runtime file.

---

### Task 2: Make README onboarding reproducible and package copy evergreen

**Files:**

- Modify: `tests/e2e/storefront-readme.test.mjs`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: current nine-section README structure and beta.5/beta.6 release documentation.
- Produces: permanent packaged README wording and a complete public checkout-to-demo command path.

- [ ] **Step 1: Add RED README assertions and remove dead test helpers**

Remove unused `statSync` and the unused `assertCorpusContains()` helper.

Replace the exact candidate-note assertion with:

```js
assert.match(
  firstScreen,
  /> \[!NOTE\]\s*> This source targets `0\.2\.0-beta\.6`\. The `@beta` install command resolves to the currently published npm beta; the \[Public Beta guide\]\(\.\/docs\/PUBLIC_BETA\.md\) records the verified release state\./u,
);
assert.doesNotMatch(firstScreen, /beta\.6[^\n]*(?:unpublished|forthcoming)/iu);
```

Add an ordered clean-demo assertion:

```js
const cleanDemo = [
  "git clone https://github.com/mr-min-max/aidoc.git",
  "cd aidoc",
  "npm ci",
  "npm run demo:storefront",
];
let cleanDemoIndex = -1;
for (const command of cleanDemo) {
  const nextIndex = readme.indexOf(command);
  assert.ok(nextIndex > cleanDemoIndex, `${command} must appear in order`);
  cleanDemoIndex = nextIndex;
}
```

In `public-beta-config.test.ts`, add a packed-README truth assertion that the
README contains the evergreen notice and does not contain the old exact
candidate sentence. Preserve beta.5 current-public checks in
`docs/PUBLIC_BETA.md` and the beta.6 candidate release note.

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/e2e/storefront-readme.test.mjs
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
```

Expected: failures identify the old transient README notice and missing clean
checkout commands.

- [ ] **Step 3: Implement durable copy and the clean quick start**

Replace the first-screen note with exactly:

```md
> [!NOTE]
> This source targets `0.2.0-beta.6`. The `@beta` install command resolves to the currently published npm beta; the [Public Beta guide](./docs/PUBLIC_BETA.md) records the verified release state.
```

Replace both seeded-demo command blocks with one complete first occurrence:

```bash
git clone https://github.com/mr-min-max/aidoc.git
cd aidoc
npm ci
npm run demo:storefront
```

The later quick-start occurrence may use only `npm run demo:storefront` after
explicitly saying it assumes the checkout and `npm ci` steps above.

- [ ] **Step 4: Run GREEN and pack inspection**

Run:

```bash
node --test tests/e2e/storefront-readme.test.mjs
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
npm pack --dry-run --json
```

Expected: tests pass and the included README contains no time-sensitive beta.6
unpublished claim.

---

### Task 3: Correct brand accessibility truth and strengthen animation tests

**Files:**

- Modify: `tests/e2e/storefront-assets.test.mjs`
- Modify: `docs/assets/brand/aidoc-mark.svg`
- Modify: `docs/assets/brand/aidoc-wordmark.svg`
- Modify: `docs/assets/brand/aidoc-mark-on-dark.svg`
- Modify: `docs/assets/brand/aidoc-mark-on-light.svg`
- Modify: `docs/assets/brand/README.md`

**Interfaces:**

- Consumes: current four-circle canonical geometry and five-frame asset registry.
- Produces: truthful four-node descriptions and a structural contract for plain-language, protected animation layouts.

- [ ] **Step 1: Add RED four-node and animation-layout assertions**

Import Buffer explicitly:

```js
import { Buffer } from "node:buffer";
```

Change mark and brand README assertions from `three AST nodes` to
`four semantic nodes`.

For each frame require:

```js
assert.match(source, /data-protected-margin="80"/u);
assert.match(source, new RegExp(`data-step="${index + 1}"`, "u"));
```

Parse every text element. Require declared `x`, `y`, and `font-size`; require
`24 <= x <= 1128`, `24 <= y <= 568`, minimum font size 28, and visible text
content at most 48 characters. Require exact primary headlines in frame order:

```js
const plainHeadlines = [
  "Code changed",
  "Two docs affected",
  "Bounded draft",
  "Draft validated",
  "You review",
];
```

Require the combined sources to contain:

```text
prepare_documentation_update
validate_documentation_draft
No provider calls
No repository writes
You decide what is applied
```

- [ ] **Step 2: Run RED**

Run:

```bash
node --test tests/e2e/storefront-assets.test.mjs
npm run lint
```

Expected: the asset test fails on three-node descriptions and the old frame
layout. ESLint passes because Buffer is now imported explicitly and the dead
README-test declarations were removed in Task 2.

- [ ] **Step 3: Correct current canonical accessibility text**

Use `four semantic nodes` in all four SVG descriptions and the brand README alt
text. Do not change canonical geometry or PNGs before the maintainer selects a
replacement concept.

- [ ] **Step 4: Re-run the focused static contract**

Run:

```bash
node --test tests/e2e/storefront-assets.test.mjs
```

Expected: only the new animation-layout assertions remain RED.

---

### Task 4: Rebuild the animation as a plain-language proof sequence

**Files:**

- Modify: `docs/assets/demo/frame-01-change.svg`
- Modify: `docs/assets/demo/frame-02-plan.svg`
- Modify: `docs/assets/demo/frame-03-targets.svg`
- Modify: `docs/assets/demo/frame-04-diff.svg`
- Modify: `docs/assets/demo/frame-05-validated.svg`
- Modify: `docs/assets/demo/aidoc-flow.gif`
- Modify: `docs/assets/demo/aidoc-flow-poster.svg`
- Modify: `docs/assets/demo/aidoc-flow-poster.png`
- Modify: `docs/demo/aidoc-walkthrough-script.md`
- Modify: `docs/demo/aidoc-walkthrough.vtt`

**Interfaces:**

- Consumes: exact Task 1 baseline/candidate Markdown and Proof Geometry visual philosophy.
- Produces: five factual SVG sources, a 15-second GIF, a reduced-motion poster, and matching English narration/captions.

- [ ] **Step 1: Draw five sources on one locked grid**

Every frame keeps `viewBox="0 0 1280 720"`,
`data-safe-margin="64"`, `data-protected-margin="80"`, the existing outer
surface at `translate(64 64)`, and a `data-step` from 1 through 5.

Use these primary text and visual facts only:

1. `Code changed`: before `createUser(email)`, after
   `createUser(email, role)`, with `role` in cyan.
2. `Two docs affected`: one source card leading to `README.md` and
   `docs/API.md`.
3. `Bounded draft`: relevant context enters a host-owned draft;
   `prepare_documentation_update` is a secondary label; show
   `No provider calls`.
4. `Draft validated`: both files show the exact demonstrated line replacement;
   `validate_documentation_draft` is secondary; show one green validation mark.
5. `You review`: a visible stop line precedes the repository; show
   `No repository writes` and `You decide what is applied`.

Keep all primary text inside x=88..1192 and y=88..632 in root coordinates.
Do not use fake terminal chrome, simulated typing, testimonials, provider logos,
or model-generated claims.

- [ ] **Step 2: Update the poster and production kit**

The poster compresses the same five facts into three columns:
`Code changed`, `Two docs affected`, and `Validated, you review`.

Update the walkthrough script and VTT so the spoken sequence matches the five
plain-language frames and states that the deterministic animation does not
invoke Codex. Preserve the 0-10, 10-25, 25-50, 50-70, and 70-80 second cue
boundaries.

- [ ] **Step 3: Render temporary frame PNGs and final media**

Attempt exact `sips` SVG export once. If macOS returns Error 13, use Quick Look
only in a task-specific `mktemp -d` directory, normalize each temporary render
to 1280 by 720 with `sips`, and keep every temporary PNG outside Git.

Build the GIF with:

```bash
ffmpeg -y -framerate 1/3 -start_number 1 -i /private/tmp/aidoc-gate-a1-frame-%02d.png -vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 docs/assets/demo/aidoc-flow.gif
```

Render the poster PNG at exactly 1280 by 720. Do not patch PNG bytes.

- [ ] **Step 4: Run GREEN and inspect all frames**

Run:

```bash
node --test tests/e2e/storefront-assets.test.mjs tests/e2e/public-beta-preflight.test.mjs
npm run test:storefront
ffprobe -v error -show_entries stream=width,height -show_entries format=duration -of default=noprint_wrappers=1 docs/assets/demo/aidoc-flow.gif
xmllint --noout docs/assets/demo/*.svg
git diff --check
```

Expected: assets pass, GIF is 960 by 540 and 15 seconds, and all SVGs are valid.

Inspect original-size frames 1 through 5, GIF frames at 0/3/6/9/12 seconds,
the first-to-last loop transition, the 1280 by 720 poster, and README-width
rendering. Reject any clipping, crowding, weak contrast, unsupported claim, or
text that requires technical background to understand the main action.

---

### Task 5: Create three untracked logo concepts for maintainer selection

**Files:**

- Create outside Git: `/private/tmp/aidoc-logo-exploration-*/semantic-fold*.svg`
- Create outside Git: `/private/tmp/aidoc-logo-exploration-*/diff-bracket*.svg`
- Create outside Git: `/private/tmp/aidoc-logo-exploration-*/ad-ligature*.svg`
- Create outside Git: `/private/tmp/aidoc-logo-exploration-*/aidoc-logo-concepts.png`

**Interfaces:**

- Consumes: Proof Geometry philosophy and the locked Semantic Graphite palette.
- Produces: three reviewable concept families without changing tracked canonical assets.

- [ ] **Step 1: Draw original vector concepts**

Create Semantic Fold, Diff Bracket, and AD Ligature as independent 64-unit SVG
geometries. Each source must use a descriptive title/description, rounded or
optically corrected strokes, no remote resource, no font dependency in the
mark itself, and no third-party shape.

- [ ] **Step 2: Produce theme and size previews**

For every concept render dark and light 512-pixel PNGs and 32-pixel PNGs.
Use Quick Look plus `sips` only when direct `sips` SVG export returns Error 13.

- [ ] **Step 3: Build the comparison sheet**

Create one 1536 by 720 PNG with three equal columns, the concept names, dark
and light marks, and 32-pixel samples. Do not include scores, winner labels, or
marketing claims.

- [ ] **Step 4: Inspect and preserve selection boundary**

Inspect all previews at original and 32-pixel size. Reject generic AI-node
clusters, unclear silhouettes, collapsed strokes, uneven optical weight, or
theme variants that are identical.

Keep every exploration artifact untracked and report its absolute paths to the
maintainer. Do not replace `aidoc-mark.svg`, wordmark, avatar, social preview,
or README branding until the maintainer selects a concept.

---

### Task 6: Run the complete local Gate A1 and commit the bounded correction

**Files:** all tracked files changed by Tasks 1 through 4 only.

- [ ] **Step 1: Run formatting and exact local acceptance matrix**

Run sequentially to avoid shared `dist` races:

```bash
export AIDOC_GATE_A1_NPM_CACHE=/private/tmp/aidoc-npm-cache-beta6-correction
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm ci
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run lint
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm test -- --runInBand
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npx tsc --noEmit
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run build
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run test:storefront
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run demo:storefront
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run test:hybrid-beta
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run test:mcp
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run test:package
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run test:codex-plugin
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run test:public-beta
NPM_CONFIG_CACHE="$AIDOC_GATE_A1_NPM_CACHE" npm run verify:release
node dist/cli/index.js score --min 80
node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD
git diff --check
```

Run focused Prettier over every changed tracked path. Require no lockfile diff.

- [ ] **Step 2: Run explicit truth and privacy probes**

Require no matches for Unicode em dash, generic copy, private paths, real
credential values, `Validated by the host`, unverified publication claims,
testimonials, or grant claims across active storefront surfaces.

Inspect `npm pack --dry-run --json`, commit identity, staged paths, full diff,
GIF metadata, SVG validity, PNG budgets, and absence of a beta.6 tag.

- [ ] **Step 3: Perform final visual review**

Render README at 1280 and 390 pixels. Confirm no horizontal overflow, one
first-screen promise, one install block, four badges, readable GIF, static
fallback, and durable candidate wording.

Inspect all tracked visual assets and the untracked three-concept comparison.

- [ ] **Step 4: Commit only tracked corrections**

Stage the demo, tests, README, current brand descriptions, five frame sources,
GIF, poster, and production-kit files. Confirm no `/private/tmp` logo concept
is staged.

Commit with:

```bash
git commit -m "fix: close Gate A1 storefront gaps"
```

Use `mr-min-max <254284659+mr-min-max@users.noreply.github.com>`.

- [ ] **Step 5: Verify post-commit state**

Require a clean worktree, the expected noreply commit, no tag at HEAD, no local
`v0.2.0-beta.6` tag, and no external mutation. Report Gate A1 as locally green
only if every fresh command above exited zero. Hosted PR/CI and maintainer
visual approval remain separate.
