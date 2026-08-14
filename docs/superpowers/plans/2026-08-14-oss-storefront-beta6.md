# AiDoc OSS Storefront and beta.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working AiDoc public beta into a clear, credible OSS
storefront with a reproducible provider-free demonstration, original visual
assets, progressive documentation, and one OIDC-published
`0.2.0-beta.6` release.

**Architecture:** Keep the product runtime and security boundaries unchanged.
Build a tested presentation layer around existing CLI and MCP behavior, reuse
the deterministic hybrid-beta fixture as the demo engine, store only small
reviewed visual assets in Git, and separate prepublication candidate truth from
postpublication registry truth. Publish one verified tarball from protected
`main` through the existing npm Trusted Publisher workflow.

**Tech Stack:** TypeScript, Node.js 22/24, Jest, Node test runner, SVG, PNG,
animated GIF, Markdown, WebVTT, GitHub Actions, npm Trusted Publishing/OIDC,
GitHub CLI, `sips`, and `ffmpeg`.

## Global Constraints

- Work only in the isolated
  `/Users/davyd/Documents/aidoc/.worktrees/oss-evidence-sprint` worktree on
  `codex/oss-evidence-sprint` until the reviewed candidate is integrated.
- Start from `origin/main` commit
  `35b2a8580afe26037949580454651bc687268562` plus the approved design commits
  already on the branch.
- Use `mr-min-max <254284659+mr-min-max@users.noreply.github.com>` for every
  commit. Check the identity before the first commit and before each push.
- Do not use the Unicode em dash character in public copy, tests, captions, or
  asset text.
- Do not add API keys, npm tokens, private paths, personal account data, raw
  prompts, generated private content, or local machine screenshots.
- Preserve the existing AST-first, provider-agnostic, template-driven
  architecture. This phase adds no parser, provider, prompt, model, MCP tool,
  write path, or autonomous product feature.
- Preserve the distinction between deterministic planning/checking and model
  generation. Never imply that ChatGPT Plus or Claude Pro is an AiDoc API key.
- Keep the Codex plugin intentionally focused on change-driven Markdown
  maintenance. Do not broaden its claims to every CLI generation command.
- Do not add a Codex marketplace entry or a temporary documentation website in
  this phase. The repository homepage points to the npm package.
- Use only original visual work. Do not place OpenAI, Anthropic, GitHub, or
  competitor logos inside AiDoc artwork.
- Enforce these checked-in media limits: mark SVG at most 50 KiB, demo poster
  PNG at most 500 KiB, README GIF at most 6 MiB, social preview PNG at most
  1.5 MiB.
- The canonical demo is offline, credential-free, provider-free on the AiDoc
  side, deterministic, and no-write. It may demonstrate a host contract, but
  must not falsely claim that an automated script actually invoked Codex.
- Keep `latest` fixed at `0.2.0-beta.4`. Publish beta.6 only under the `beta`
  dist-tag. Do not create a stable release.
- Use npm Trusted Publishing only. Do not restore `NPM_TOKEN`, a token fallback,
  or a bypass-2FA publishing path.
- Treat beta.6 as unpublished until npm, provenance, the GitHub prerelease, and
  the exact tarball all prove publication. Historical beta.4 and beta.5 release
  records remain historical.
- Do not start the five-repository evaluation or user pilot in this plan. They
  must use the exact published storefront release and therefore begin only
  after Gate A succeeds.
- Run RED before implementation and GREEN after each bounded change. Commit
  each task separately with conventional commit messages.

## Phase Boundary and Gates

This plan completes only Phase A from the approved design.

**Gate A1, candidate storefront:** active copy, demo, visuals, docs, package
metadata, candidate release metadata, and every local gate are green in one
reviewed pull request.

**Gate A2, published beta.6:** the exact protected-main commit is tagged,
published through OIDC, exposed under `beta`, preserved outside `latest`, and
matched by a GitHub prerelease and checksum.

**Gate A3, public truth:** a small postpublication pull request updates active
docs and registry assertions from beta.5 current/beta.6 candidate to beta.6
current. It contains no product code.

Phase B will evaluate five unrelated public repositories. Phase C will run a
clean-account onboarding pass and one independent tester. Those phases receive
separate plans after Gate A3.

---

### Task 1: Lock the active product message with a failing contract test

**Files:**

- Create: `tests/unit/release/storefront-copy.test.ts`
- Modify: `package.json`
- Modify: `src/cli/index.ts`
- Modify: `action.yml`
- Modify: `docs/PUBLIC_BETA.md`

- [ ] **Step 1: Add the RED storefront-copy contract**

  Create `tests/unit/release/storefront-copy.test.ts`. Read only active public
  surfaces and assert exact copy rather than testing subjective adjectives.

  ```ts
  import { readFileSync } from "node:fs";
  import path from "node:path";

  const root = path.resolve(__dirname, "../../..");
  const read = (file: string) =>
    readFileSync(path.join(root, file), { encoding: "utf8" });
  const packageJson = JSON.parse(read("package.json"));
  const cli = read("src/cli/index.ts");
  const action = read("action.yml");
  const publicBeta = read("docs/PUBLIC_BETA.md");
  const activeCopy = [packageJson.description, cli, action, publicBeta].join(
    "\n",
  );

  describe("active AiDoc product copy", () => {
    it("uses one broad AST-first product position", () => {
      expect(packageJson.description).toBe(
        "AST-first documentation workflow for codebases. Create README and API docs, map code changes to affected files, and review focused updates with Codex, Claude, Ollama, or supported providers.",
      );
      expect(cli).toContain(
        '"AST-first documentation creation and change-aware updates for codebases."',
      );
      expect(action).toContain(
        'name: "AiDoc: AST-first documentation workflow"',
      );
      expect(action).toContain(
        'description: "Generate project documentation and run deterministic change-aware checks in CI."',
      );
      expect(publicBeta).toContain(
        "Documentation that keeps up with your code.",
      );
    });

    it("removes conflicting generic and synthetic copy", () => {
      expect(activeCopy).not.toContain(
        "AI-powered documentation generator for codebases",
      );
      expect(activeCopy).not.toContain("professional documentation");
      expect(activeCopy).not.toContain("🤖");
      expect(activeCopy).not.toContain("\u2014");
    });
  });
  ```

- [ ] **Step 2: Run the focused test and observe RED**

  ```bash
  npm test -- tests/unit/release/storefront-copy.test.ts --runInBand
  ```

  Expected: failures identify the generic package, CLI, Action, and public-beta
  entry copy.

- [ ] **Step 3: Apply the exact active-surface copy**

  Set the `package.json` description to:

  ```text
  AST-first documentation workflow for codebases. Create README and API docs, map code changes to affected files, and review focused updates with Codex, Claude, Ollama, or supported providers.
  ```

  Replace package keywords with this focused ordered list:

  ```json
  [
    "documentation",
    "documentation-generator",
    "developer-tools",
    "ast",
    "codex",
    "claude",
    "mcp",
    "readme",
    "typescript",
    "python",
    "cli",
    "ollama"
  ]
  ```

  Set the Commander description to:

  ```text
  AST-first documentation creation and change-aware updates for codebases.
  ```

  Set the first two Action fields to:

  ```yaml
  name: "AiDoc: AST-first documentation workflow"
  description: "Generate project documentation and run deterministic change-aware checks in CI."
  ```

  Open `docs/PUBLIC_BETA.md` with the approved headline and two-job summary.
  Keep all existing subscription/API, repository scope, provider, billing, and
  Trust Gate boundaries intact.

- [ ] **Step 4: Run GREEN and compatibility checks**

  ```bash
  npm test -- tests/unit/release/storefront-copy.test.ts tests/unit/release/public-beta-config.test.ts tests/unit/action/runner.test.ts --runInBand
  npx tsc --noEmit
  git diff --check
  ```

  Expected: all focused tests pass and the TypeScript surface is unchanged
  except for top-level help text.

- [ ] **Step 5: Commit the message contract**

  ```bash
  git add package.json src/cli/index.ts action.yml docs/PUBLIC_BETA.md tests/unit/release/storefront-copy.test.ts
  git commit -m "docs: align active AiDoc product messaging"
  ```

---

### Task 2: Turn the existing hybrid fixture into the canonical storefront demo

**Files:**

- Modify: `scripts/demo-hybrid-beta.mjs`
- Modify: `tests/e2e/hybrid-beta-demo.test.mjs`
- Create: `tests/e2e/storefront-demo.test.mjs`
- Modify: `package.json`
- Modify: `tests/unit/release/public-beta-config.test.ts`

- [ ] **Step 1: Add RED tests for the canonical scenario and presentation mode**

  Keep the current one-line JSON output as the machine evidence contract. Add
  `tests/e2e/storefront-demo.test.mjs` for an exact, human-readable
  `--presentation` mode:

  ```js
  import assert from "node:assert/strict";
  import { execFile } from "node:child_process";
  import path from "node:path";
  import process from "node:process";
  import test from "node:test";
  import { promisify } from "node:util";

  const execFileAsync = promisify(execFile);
  const root = path.resolve(import.meta.dirname, "../..");
  const script = path.join(root, "scripts", "demo-hybrid-beta.mjs");

  test("renders the exact provider-free storefront story", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [script, "--presentation"],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    assert.equal(stderr, "");
    assert.equal(
      stdout,
      [
        "AiDoc storefront demo",
        "Change: createUser(email) -> createUser(email, role)",
        "Impact: README.md, docs/API.md",
        "Host contract: prepare -> host draft -> validate",
        "Provider calls: none",
        "Repository writes: none",
        "Result: PASS",
        "",
      ].join("\n"),
    );
  });

  test("presentation output is value-free", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [script, "--presentation"],
      { cwd: root, encoding: "utf8" },
    );
    for (const forbidden of [
      root,
      "/Users/",
      "/home/",
      "sk-proj-",
      "preparation_digest",
      "system_prompt",
      "candidate_markdown",
    ]) {
      assert.equal(stdout.includes(forbidden), false);
    }
  });
  ```

  Extend the existing source-contract test to require `createUser`,
  `README.md`, and `docs/API.md`, and to reject the old `formatName` fixture.

- [ ] **Step 2: Run RED**

  ```bash
  npm run build
  node --test tests/e2e/hybrid-beta-demo.test.mjs tests/e2e/storefront-demo.test.mjs
  ```

  Expected: the new test fails because `--presentation` and the canonical
  `createUser` scenario do not exist.

- [ ] **Step 3: Reuse the existing fixture instead of creating a second demo engine**

  Change the baseline source to:

  ```ts
  export function createUser(email: string): { email: string; role: string } {
    return { email, role: "member" };
  }
  ```

  Change the source commit to:

  ```ts
  export function createUser(
    email: string,
    role: string,
  ): { email: string; role: string } {
    return { email, role };
  }
  ```

  Use `README.md` and `docs/API.md` as the two-target fixture. Update the exact
  generated-target checks accordingly. Preserve all current snapshot,
  forged-digest, secret-candidate, freshness, plugin-smoke, and no-write
  assertions.

  Run an explicit `aidoc plan --base <fixture-base> --head <fixture-head>` on
  the two-target fixture and require both relative paths before running update
  selection. Fold this result into the existing multiple-target check so the
  canonical JSON schema and nine check names remain unchanged.

  Change `runMcpEvidence` to prepare and validate both `README.md` and
  `docs/API.md` through one MCP session. Snapshot the complete fixture after
  every prepare and validate call. Keep the forged-digest and secret-candidate
  adversarial probes, and require both approved drafts before setting
  `mcp_prepare_validate_approved` to true. This makes the two-document host
  contract real without adding provider or network behavior.

  Add an exact argument parser accepting only no argument or
  `--presentation`. Add this formatter:

  ```js
  function formatPresentation(report) {
    if (report.status !== "pass")
      return "AiDoc storefront demo\nResult: FAIL\n";
    return [
      "AiDoc storefront demo",
      "Change: createUser(email) -> createUser(email, role)",
      "Impact: README.md, docs/API.md",
      "Host contract: prepare -> host draft -> validate",
      "Provider calls: none",
      "Repository writes: none",
      "Result: PASS",
      "",
    ].join("\n");
  }
  ```

  The phrase `Host contract` is deliberate. The script validates the host
  boundary but does not claim it invoked Codex.

- [ ] **Step 4: Add release scripts without breaking canonical JSON**

  Add:

  ```json
  {
    "scripts": {
      "demo:storefront": "npm run build && node scripts/demo-hybrid-beta.mjs --presentation",
      "test:storefront": "node --test tests/e2e/storefront-demo.test.mjs && jest tests/unit/release/storefront-copy.test.ts --runInBand"
    }
  }
  ```

  Add `npm run test:storefront` to `verify:release`. Extend
  `public-beta-config.test.ts` to assert both scripts and the gate ordering.
  Keep this intermediate script green. Task 3 will add the asset test after
  that test exists.

- [ ] **Step 5: Run GREEN for the demo contract**

  ```bash
  npm run build
  node --test tests/e2e/hybrid-beta-demo.test.mjs tests/e2e/storefront-demo.test.mjs
  npm run demo:storefront
  ```

  Expected: the default mode still emits one deterministic canonical JSON
  line, the presentation mode emits the seven exact lines, and both modes
  expose no forbidden value.

- [ ] **Step 6: Commit the canonical demo**

  ```bash
  git add scripts/demo-hybrid-beta.mjs tests/e2e/hybrid-beta-demo.test.mjs tests/e2e/storefront-demo.test.mjs package.json tests/unit/release/public-beta-config.test.ts
  git commit -m "feat: add canonical storefront demo"
  ```

---

### Task 3: Create an original, tested visual identity and static storefront assets

Use the `canvas-design` skill for Tasks 3 and 4 before drawing. Keep the result
vector-native and repository-owned; ImageGen is not needed for this geometric
developer-tool identity.

**Files:**

- Create: `docs/assets/brand/aidoc-mark.svg`
- Create: `docs/assets/brand/aidoc-wordmark.svg`
- Create: `docs/assets/brand/aidoc-mark-on-dark.svg`
- Create: `docs/assets/brand/aidoc-mark-on-light.svg`
- Create: `docs/assets/brand/aidoc-mark-dark.png`
- Create: `docs/assets/brand/aidoc-mark-light.png`
- Create: `docs/assets/brand/aidoc-avatar.png`
- Create: `docs/assets/brand/README.md`
- Create: `docs/assets/social/aidoc-social-preview.svg`
- Create: `docs/assets/social/aidoc-social-preview.png`
- Create: `docs/assets/demo/aidoc-flow-poster.svg`
- Create: `docs/assets/demo/aidoc-flow-poster.png`
- Create: `tests/e2e/storefront-assets.test.mjs`
- Modify: `package.json`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

- [ ] **Step 1: Add RED structural and budget tests**

  In `tests/e2e/storefront-assets.test.mjs`, implement helpers that read PNG
  width and height from bytes 16 through 23 of the IHDR chunk and reject unsafe
  SVG elements. Assert:

  ```js
  const budgets = {
    "docs/assets/brand/aidoc-mark.svg": 50 * 1024,
    "docs/assets/demo/aidoc-flow-poster.png": 500 * 1024,
    "docs/assets/social/aidoc-social-preview.png": 1.5 * 1024 * 1024,
  };

  assert.deepEqual(
    pngDimensions("docs/assets/social/aidoc-social-preview.png"),
    {
      width: 1280,
      height: 640,
    },
  );
  assert.match(markSvg, /viewBox="0 0 64 64"/u);
  assert.match(markSvg, /#58A6FF/u);
  assert.match(markSvg, /#3FB950/u);
  assert.doesNotMatch(
    allSvg,
    /<script|javascript:|(?:href|src)=["']https?:\/\/|xlink:href|@import|url\(/iu,
  );
  assert.doesNotMatch(allSvg, /OpenAI|Anthropic|GitHub|Claude logo/iu);
  assert.notDeepEqual(
    readFileSync("docs/assets/brand/aidoc-mark-dark.png"),
    readFileSync("docs/assets/brand/aidoc-mark-light.png"),
  );
  ```

  Also require the exact social-preview text, poster text, alt-text note, PNG
  signatures, positive dimensions for all exports, and no Unicode em dash.

- [ ] **Step 2: Run RED**

  ```bash
  node --test tests/e2e/storefront-assets.test.mjs
  ```

  Expected: missing asset failures.

- [ ] **Step 3: Draw the original mark as code-native SVG**

  Use this geometry as the canonical mark. Keep strokes rounded and readable
  at 32 pixels:

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title desc">
    <title id="title">AiDoc mark</title>
    <desc id="desc">A document page connected to three AST nodes.</desc>
    <path d="M14 7h25l11 11v39H14z" fill="#161B22" stroke="#F0F6FC" stroke-width="3" stroke-linejoin="round"/>
    <path d="M39 7v12h11" fill="none" stroke="#F0F6FC" stroke-width="3" stroke-linejoin="round"/>
    <path d="M24 29v14m0-7h15m0-7v14" fill="none" stroke="#58A6FF" stroke-width="3" stroke-linecap="round"/>
    <circle cx="24" cy="29" r="4" fill="#58A6FF"/>
    <circle cx="24" cy="43" r="4" fill="#3FB950"/>
    <circle cx="39" cy="29" r="4" fill="#58A6FF"/>
    <circle cx="39" cy="43" r="4" fill="#3FB950"/>
  </svg>
  ```

  Build the wordmark from this mark plus a plain `AiDoc` label on a graphite
  rounded surface so it remains readable in both GitHub themes. Use only
  system monospace fonts and an accessible text fallback. Do not use a remote
  font or an embedded raster image.

  Create two export-only SVG compositions. `aidoc-mark-on-dark.svg` uses a
  graphite background and the light canonical mark. `aidoc-mark-on-light.svg`
  uses a white background, graphite document stroke, cyan analysis nodes, and
  green validated nodes. Both preserve the canonical geometry. The dark and
  light PNG files must therefore be visually distinct rather than two names
  for identical bytes.

- [ ] **Step 4: Create the social preview and static demo poster**

  Use the approved palette:

  ```text
  background #0D1117
  surface    #161B22
  text       #F0F6FC
  secondary  #8B949E
  analysis   #58A6FF
  validated  #3FB950
  warning    #D29922
  ```

  The 1280 by 640 social source must contain only:

  ```text
  AiDoc
  Documentation that keeps up with your code.
  Code change -> Impact plan -> Reviewable docs update
  ```

  Keep critical text within x=120..1160 and y=100..540. The poster uses the
  same scenario as Task 2 and includes `createUser(email, role)`, `README.md`,
  `docs/API.md`, and `Validated`. It contains no fake terminal output beyond
  values asserted by the deterministic demo.

- [ ] **Step 5: Export reviewed PNGs locally**

  Run from the worktree on macOS:

  ```bash
  sips -s format png docs/assets/social/aidoc-social-preview.svg --out docs/assets/social/aidoc-social-preview.png
  sips -s format png docs/assets/demo/aidoc-flow-poster.svg --out docs/assets/demo/aidoc-flow-poster.png
  sips -s format png --resampleHeightWidth 512 512 docs/assets/brand/aidoc-mark-on-dark.svg --out docs/assets/brand/aidoc-mark-dark.png
  sips -s format png --resampleHeightWidth 512 512 docs/assets/brand/aidoc-mark-on-light.svg --out docs/assets/brand/aidoc-mark-light.png
  sips -s format png --resampleHeightWidth 512 512 docs/assets/brand/aidoc-mark-on-dark.svg --out docs/assets/brand/aidoc-avatar.png
  ```

  If `sips` ignores an SVG background, correct the source SVG composition and
  rerun the export. Do not patch PNG bytes manually. Inspect every PNG at
  actual size and at 32-pixel mark size.

- [ ] **Step 6: Document usage and add source-artifact preflight coverage**

  `docs/assets/brand/README.md` records the palette, alt text, clear-space
  rule, minimum 32-pixel mark size, dark/light use, and the original-design
  constraint. Add all source and final static assets to the bounded
  storefront source-artifact list in `public-beta-preflight.mjs` and mirror it
  in the fixture test.

  Extend `test:storefront` to:

  ```json
  {
    "scripts": {
      "test:storefront": "node --test tests/e2e/storefront-demo.test.mjs tests/e2e/storefront-assets.test.mjs && jest tests/unit/release/storefront-copy.test.ts --runInBand"
    }
  }
  ```

  Update `public-beta-config.test.ts` to require the exact command.

- [ ] **Step 7: Run GREEN and visual inspection**

  ```bash
  node --test tests/e2e/storefront-assets.test.mjs tests/e2e/public-beta-preflight.test.mjs
  npm run test:storefront
  git diff --check
  ```

  Expected: exact dimensions, budgets, content, safety, and source-artifact
  checks pass. Open the generated images and confirm no clipping, blurry text,
  unsafe crop, or unreadable 32-pixel mark.

- [ ] **Step 8: Commit static assets**

  ```bash
  git add docs/assets/brand docs/assets/social docs/assets/demo/aidoc-flow-poster.svg docs/assets/demo/aidoc-flow-poster.png tests/e2e/storefront-assets.test.mjs package.json tests/unit/release/public-beta-config.test.ts scripts/public-beta-preflight.mjs tests/e2e/public-beta-preflight.test.mjs
  git commit -m "feat: add AiDoc storefront visual identity"
  ```

---

### Task 4: Produce the short animation and a truthful full-video kit

**Files:**

- Create: `docs/assets/demo/frame-01-change.svg`
- Create: `docs/assets/demo/frame-02-plan.svg`
- Create: `docs/assets/demo/frame-03-targets.svg`
- Create: `docs/assets/demo/frame-04-diff.svg`
- Create: `docs/assets/demo/frame-05-validated.svg`
- Create: `docs/assets/demo/aidoc-flow.gif`
- Create: `docs/demo/aidoc-walkthrough-script.md`
- Create: `docs/demo/aidoc-walkthrough.vtt`
- Create: `docs/demo/recording-checklist.md`
- Modify: `tests/e2e/storefront-assets.test.mjs`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

- [ ] **Step 1: Add RED animation and caption assertions**

  Extend the asset test to require five 1280 by 720 SVG frames in exact order,
  a valid 960 by 540 `GIF89a` loop no larger than 6 MiB, and a WebVTT file with
  cues that cover 60 to 90 seconds. Assert the combined source contains these
  facts:

  ```text
  createUser(email)
  createUser(email, role)
  README.md
  docs/API.md
  prepare_documentation_update
  validate_documentation_draft
  Review the diff
  Public beta
  ```

  Reject private paths, credential names with values, raw preparation digests,
  provider claims, synthetic-user claims, and the Unicode em dash.

- [ ] **Step 2: Run RED**

  ```bash
  node --test tests/e2e/storefront-assets.test.mjs
  ```

  Expected: missing frame, GIF, and caption-kit failures.

- [ ] **Step 3: Create five consistent frames**

  Use one 1280 by 720 layout with a 64-pixel outer margin, 24-pixel minimum
  body text, and a visible 1-of-5 progress indicator. Each frame has one job:

  1. signature change;
  2. `aidoc plan` and impact analysis;
  3. two selected documentation targets;
  4. focused README/API diff;
  5. validated state and review boundary.

  Do not simulate typing, fake a Codex response, or show a personal terminal.
  The sequence is a visual rendering of the deterministic Task 2 result.

- [ ] **Step 4: Render the 15-second README loop**

  Export each frame to numbered temporary PNG files, then create the GIF:

  ```bash
  sips -s format png docs/assets/demo/frame-01-change.svg --out /private/tmp/aidoc-demo-frame-01.png
  sips -s format png docs/assets/demo/frame-02-plan.svg --out /private/tmp/aidoc-demo-frame-02.png
  sips -s format png docs/assets/demo/frame-03-targets.svg --out /private/tmp/aidoc-demo-frame-03.png
  sips -s format png docs/assets/demo/frame-04-diff.svg --out /private/tmp/aidoc-demo-frame-04.png
  sips -s format png docs/assets/demo/frame-05-validated.svg --out /private/tmp/aidoc-demo-frame-05.png
  ffmpeg -y -framerate 1/3 -start_number 1 -i /private/tmp/aidoc-demo-frame-%02d.png -vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 docs/assets/demo/aidoc-flow.gif
  ```

  The temporary PNGs stay outside the repository. Git tracks the five SVG
  sources, final GIF, and static poster only.

- [ ] **Step 5: Write the 60 to 90 second production kit**

  `aidoc-walkthrough-script.md` uses this exact narrative order:

  ```text
  0-10s   The code changed, and two docs may now be stale.
  10-25s  Install the beta and run aidoc plan.
  25-50s  Codex uses AiDoc's bounded prepare and validate tools.
  50-70s  Review the focused README and API diff before writing.
  70-80s  AiDoc is an open source public beta. Try it on a real change.
  ```

  The script must distinguish the live Codex recording from the deterministic
  animation. The VTT contains English captions for the same sequence.
  `recording-checklist.md` requires a fresh disposable repository, no visible
  accounts or keys, 1080p capture, readable 24-pixel equivalent text, captions,
  final privacy review, and a note that ElevenLabs narration is synthetic if
  used.

  The edited MP4 is not committed to Git. After review it can be attached to
  the beta.6 GitHub prerelease. Its absence does not block Gate A1 or A2.

- [ ] **Step 6: Run GREEN and inspect motion**

  ```bash
  node --test tests/e2e/storefront-assets.test.mjs tests/e2e/public-beta-preflight.test.mjs
  test "$(stat -f%z docs/assets/demo/aidoc-flow.gif)" -le 6291456
  git diff --check
  ```

  Expected: tests pass, the loop lasts about 15 seconds, first and last frames
  transition cleanly, text is readable at README width, and there is no idle
  animation.

- [ ] **Step 7: Commit the animation kit**

  ```bash
  git add docs/assets/demo docs/demo tests/e2e/storefront-assets.test.mjs scripts/public-beta-preflight.mjs tests/e2e/public-beta-preflight.test.mjs
  git commit -m "feat: add reproducible AiDoc demo media"
  ```

---

### Task 5: Replace the overloaded README with a progressive OSS storefront

**Files:**

- Modify: `README.md`
- Create: `docs/CLI.md`
- Create: `docs/GITHUB_ACTION.md`
- Modify: `docs/PUBLIC_BETA.md`
- Modify: `docs/integrations/codex.md`
- Modify: `docs/integrations/claude.md`
- Create: `tests/e2e/storefront-readme.test.mjs`
- Modify: `package.json`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

- [ ] **Step 1: Add RED semantic storefront tests**

  `tests/e2e/storefront-readme.test.mjs` reads the README and linked docs. It
  asserts section order, exact hero copy, four badges at most before the first
  `##`, existing files for every relative link, valid image files, both user
  jobs, all three honest model paths, and the current safety boundaries.

  Require this order:

  ```js
  const sections = [
    "Create docs and keep them current",
    "How a code change becomes a docs update",
    "See the workflow",
    "What AiDoc can do",
    "Why AST-first matters",
    "Quick starts",
    "Safety and boundaries",
    "Supported languages and current limits",
    "Contributing and feedback",
  ];
  ```

  Reject the old generic phrase, emoji headings, broken relative links,
  unsupported claims, testimonial language, grant language, and Unicode em
  dash. Extend `public-beta-config.test.ts` so moving detail out of README does
  not remove any provider, subscription/API, Qwen, Ollama, Trust Gate, MCP
  scope, Action, or release truth from the complete documentation corpus.

- [ ] **Step 2: Run RED**

  ```bash
  node --test tests/e2e/storefront-readme.test.mjs
  npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
  ```

  Expected: the current command catalogue and generic hero violate the new
  information architecture.

- [ ] **Step 3: Write the exact first screen**

  Use this content before the first level-two section:

  ````md
  <p align="center">
    <img src="./docs/assets/brand/aidoc-wordmark.svg" alt="AiDoc" width="240">
  </p>

  <p align="center"><strong>Public beta</strong></p>
  <p align="center"><strong>Documentation that keeps up with your code.</strong></p>

  <p align="center">
    AiDoc helps Codex, Claude, or a supported model create READMEs, API docs,
    changelogs, diagrams, and code comments, then keep them aligned as code
    changes. It analyzes code structure first, focuses the relevant context,
    and keeps change-driven updates reviewable.
  </p>

  ```bash
  npm install -g @mr-min-max/aidoc-gen@beta
  aidoc
  ```

  [![npm beta](https://img.shields.io/npm/v/@mr-min-max/aidoc-gen/beta?label=npm%20beta)](https://www.npmjs.com/package/@mr-min-max/aidoc-gen)
  [![CI](https://github.com/mr-min-max/aidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-min-max/aidoc/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/license-MIT-3FB950.svg)](./LICENSE)
  [![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-58A6FF.svg)](https://nodejs.org/)

  ![AiDoc turns a code signature change into a validated documentation update](./docs/assets/demo/aidoc-flow.gif)

  [Static demo poster](./docs/assets/demo/aidoc-flow-poster.png)

  Code signature change -> impact plan -> focused README/API draft ->
  validation -> maintainer review.
  ````

  During the candidate PR, place a compact notice immediately after this block
  that says npm `beta` is still beta.5 while this branch prepares beta.6. Do
  not say beta.6 is public before Gate A2.

- [ ] **Step 4: Implement progressive disclosure**

  Keep README focused on outcomes and short quick starts. Move the complete CLI
  command catalogue to `docs/CLI.md`. Move Action inputs, outputs, generation
  mode, check mode, permissions, and exact examples to
  `docs/GITHUB_ACTION.md`. Keep full provider variables and Trust details in
  `docs/PUBLIC_BETA.md`. Keep local host setup and MCP scope details in the two
  existing integration guides.

  README must still contain:

  - Create: `readme`, `api`, `changelog`, `diagram`, `annotate`;
  - Maintain: `plan`, `update`, `watch`, `check`, `score`;
  - Connect: Codex MCP, Claude MCP, GitHub Action, direct providers, Ollama;
  - three-step change flow;
  - seeded demo, changed-repository, initial-generation, Codex, and provider
    quick starts;
  - explicit statement that `score` measures AST-derived coverage, not prose
    quality;
  - explicit statement that `check` is a co-change guard, not semantic proof;
  - provider-free host workflow boundary;
  - pinned MCP repository scope and Trust Gate boundary;
  - supported TypeScript, JavaScript, and Python parsers;
  - public-beta limits and feedback links.

  Keep the workflow comparison generic. Label the first column `One-shot
generation pattern`, not a competitor name.

- [ ] **Step 5: Synchronize linked guides and artifact preflight**

  Add `docs/CLI.md`, `docs/GITHUB_ACTION.md`, static assets, demo test, and
  README test to the bounded source-artifact lists. Update Codex and Claude
  guides only where the new README links or exact terminology require it. Do
  not repeat the whole README in each guide.

  Extend `test:storefront` one final time:

  ```json
  {
    "scripts": {
      "test:storefront": "node --test tests/e2e/storefront-demo.test.mjs tests/e2e/storefront-assets.test.mjs tests/e2e/storefront-readme.test.mjs && jest tests/unit/release/storefront-copy.test.ts --runInBand"
    }
  }
  ```

- [ ] **Step 6: Run GREEN and render-review the README**

  ```bash
  node --test tests/e2e/storefront-readme.test.mjs tests/e2e/storefront-assets.test.mjs tests/e2e/public-beta-preflight.test.mjs
  npm test -- tests/unit/release/storefront-copy.test.ts tests/unit/release/public-beta-config.test.ts --runInBand
  npm run test:codex-plugin
  npm run test:storefront
  git diff --check
  ```

  Open the README in GitHub-compatible preview at desktop and narrow width.
  Verify the first screen has one promise, one install block, four badges, and
  one animation. Verify deep technical detail is reachable in one click and
  not duplicated into a wall of text.

- [ ] **Step 7: Commit the storefront documentation**

  ```bash
  git add README.md docs/CLI.md docs/GITHUB_ACTION.md docs/PUBLIC_BETA.md docs/integrations/codex.md docs/integrations/claude.md tests/e2e/storefront-readme.test.mjs package.json tests/unit/release/public-beta-config.test.ts scripts/public-beta-preflight.mjs tests/e2e/public-beta-preflight.test.mjs
  git commit -m "docs: build progressive OSS storefront"
  ```

---

### Task 6: Prepare a truthful beta.6 candidate without claiming publication

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `integrations/codex/aidoc/.codex-plugin/plugin.json`
- Modify: `tests/e2e/codex-plugin-smoke.mjs`
- Modify: `tests/e2e/npm-unpublished.test.mjs`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `tests/unit/release/release-tag.test.ts`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `.github/ISSUE_TEMPLATE/question.yml`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/PUBLIC_BETA.md`
- Modify: `docs/RELEASING.md`
- Create: `docs/releases/v0.2.0-beta.6.md`

- [ ] **Step 1: Write RED candidate/public split assertions**

  Require local package, lockfile, plugin, issue templates, candidate release
  note, preflight, and release-tag test to use `0.2.0-beta.6`. Require active
  current-public install and Action references to remain `0.2.0-beta.5` until
  publication. Require npm registry gates to prove all three facts:

  ```text
  beta.5 exists and remains the current beta tag before publication
  beta.4 remains latest
  beta.6 returns exact 404
  ```

  Change the mocked unpublished candidate in
  `tests/e2e/npm-unpublished.test.mjs` to beta.6. Keep the old unscoped
  `aidoc-gen@0.2.0-beta.3` collision check intact.

- [ ] **Step 2: Run RED**

  ```bash
  node --test tests/e2e/npm-unpublished.test.mjs tests/e2e/npm-published.test.mjs
  npm test -- tests/unit/release/public-beta-config.test.ts tests/unit/release/release-tag.test.ts --runInBand
  node tests/e2e/codex-plugin-smoke.mjs
  ```

  Expected: version-consistency and candidate-note failures.

- [ ] **Step 3: Set candidate version and candidate wording**

  Set package, root lockfile package, and Codex plugin version to
  `0.2.0-beta.6`. During the candidate window, set each issue-template version
  prompt to `0.2.0-beta.5, 0.2.0-beta.6 candidate, or commit SHA`. Update
  preflight version assertions. Create `docs/releases/v0.2.0-beta.6.md` with status
  `Forthcoming candidate` and these factual groups:

  - aligned AST-first storefront copy;
  - deterministic `createUser` provider-free demo;
  - original logo, poster, social preview, and short GIF;
  - progressive CLI and Action documentation;
  - no runtime, provider, MCP, security, or model change;
  - intended OIDC-only beta publication;
  - `latest` remains beta.4.

  Add the same candidate entry to `CHANGELOG.md` and a new beta.6 section to
  `docs/RELEASING.md`. Do not rewrite beta.4 or beta.5 history.

- [ ] **Step 4: Make the candidate gate exercise live registry truth**

  During the candidate state, set scripts to this logical order:

  ```json
  {
    "scripts": {
      "test:npm-published": "node --test tests/e2e/npm-published.test.mjs && node scripts/verify-npm-published.mjs --version 0.2.0-beta.5 --latest 0.2.0-beta.4",
      "test:npm-unpublished": "node --test tests/e2e/npm-unpublished.test.mjs",
      "test:public-beta": "node --test tests/e2e/public-beta-preflight.test.mjs && npm run test:npm-unpublished && node scripts/verify-npm-unpublished.mjs && npm run test:npm-published && jest tests/unit/release/public-beta-config.test.ts --runInBand"
    }
  }
  ```

  The test file validates failure handling with mocks. The direct script call
  verifies the real beta.6 registry 404. Preserve fixed diagnostics and do not
  print registry response bodies.

- [ ] **Step 5: Run GREEN candidate checks**

  ```bash
  node --test tests/e2e/npm-unpublished.test.mjs tests/e2e/npm-published.test.mjs
  node scripts/verify-npm-unpublished.mjs
  node scripts/verify-npm-published.mjs --version 0.2.0-beta.5 --latest 0.2.0-beta.4
  npm test -- tests/unit/release/public-beta-config.test.ts tests/unit/release/release-tag.test.ts --runInBand
  node tests/e2e/codex-plugin-smoke.mjs
  npm run test:public-beta
  ```

  Expected: beta.6 is absent, beta.5 is still the supported beta, beta.4 is
  still `latest`, and every local versioned artifact is beta.6.

- [ ] **Step 6: Commit the beta.6 candidate metadata**

  ```bash
  git add package.json package-lock.json integrations/codex/aidoc/.codex-plugin/plugin.json tests/e2e/codex-plugin-smoke.mjs tests/e2e/npm-unpublished.test.mjs tests/unit/release/public-beta-config.test.ts tests/unit/release/release-tag.test.ts scripts/public-beta-preflight.mjs tests/e2e/public-beta-preflight.test.mjs .github/ISSUE_TEMPLATE README.md ROADMAP.md CHANGELOG.md docs/PUBLIC_BETA.md docs/RELEASING.md docs/releases/v0.2.0-beta.6.md
  git commit -m "chore: prepare beta.6 storefront candidate"
  ```

---

### Task 7: Verify and integrate one complete storefront candidate

**Files:** all Task 1 through Task 6 paths only.

- [ ] **Step 1: Reinstall exactly from the locked dependency graph**

  ```bash
  export AIDOC_NPM_CACHE=/private/tmp/aidoc-npm-cache-beta6
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm ci
  ```

  Expected: no package-lock diff.

- [ ] **Step 2: Run the complete local acceptance matrix**

  ```bash
  export AIDOC_NPM_CACHE=/private/tmp/aidoc-npm-cache-beta6
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run lint
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm test -- --runInBand
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npx tsc --noEmit
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run build
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run test:storefront
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run demo:storefront
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run test:hybrid-beta
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run test:mcp
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run test:package
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run test:codex-plugin
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run test:public-beta
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run verify:release
  node dist/cli/index.js score --min 80
  node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD
  git diff --check
  ```

  Expected: all configured gates pass after the build restores compiled MCP
  artifacts. The maintainer's prior decision about an old historical path
  remains unchanged, but it does not waive any configured preflight check. Any
  new secret, email, or absolute-path finding blocks.

- [ ] **Step 3: Run explicit copy, asset, privacy, and package probes**

  ```bash
  rg -n $'\u2014' README.md docs/CLI.md docs/GITHUB_ACTION.md docs/PUBLIC_BETA.md docs/integrations docs/demo docs/assets package.json action.yml src/cli/index.ts
  rg -n 'AI-powered documentation generator for codebases|professional documentation|🤖' README.md docs/PUBLIC_BETA.md package.json action.yml src/cli/index.ts
  git log origin/main..HEAD --format='%h%x09%an%x09%ae%x09%s'
  git diff --stat origin/main...HEAD
  git diff --name-only origin/main...HEAD
  git diff --cached --name-only
  npm pack --dry-run --json
  ```

  Expected: the first two searches return no active-copy matches, all new
  commits use the protected noreply identity, no staged residue exists, and
  the tarball contains only intended runtime artifacts.

- [ ] **Step 4: Perform visual review before push**

  Inspect:

  - mark at 32, 64, and 512 pixels;
  - README at desktop and mobile widths;
  - social preview at full size and a center crop;
  - poster as the GIF fallback;
  - all five frames and the 15-second loop;
  - English captions against the walkthrough script.

  Confirm the repository also retains `LICENSE`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, issue-template config,
  and the pull-request template. After pushing, inspect the public community
  profile without treating its percentage as a marketing metric:

  ```bash
  for file in LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md SUPPORT.md .github/ISSUE_TEMPLATE/config.yml .github/PULL_REQUEST_TEMPLATE.md; do test -f "$file"; done
  gh api repos/mr-min-max/aidoc/community/profile --jq '{health_percentage,files}'
  ```

  Fix clipping, low contrast, unreadable text, excessive first-screen content,
  or any visual claim that is not produced by Task 2. Re-run affected tests
  after every correction.

- [ ] **Step 5: Push one branch and open one ready pull request**

  Create `/private/tmp/aidoc-beta6-pr.md` with this reviewed content:

  ```md
  ## Outcome

  Prepares the AiDoc OSS storefront and the unpublished 0.2.0-beta.6
  candidate. npm beta remains 0.2.0-beta.5 until the OIDC release succeeds.

  ## Evidence

  - Active package, CLI, Action, README, and Public Beta copy use one AST-first position.
  - The provider-free createUser demo is deterministic and no-write.
  - Original logo, social preview, poster, and GIF pass size and privacy budgets.
  - Full Jest, TypeScript, package, MCP, plugin, storefront, score, and preflight gates pass.

  ## Boundaries

  No runtime, provider, parser, MCP tool, security policy, npm token, marketplace,
  or stable-release behavior changes in this pull request.
  ```

  ```bash
  git push -u origin codex/oss-evidence-sprint
  gh pr create --repo mr-min-max/aidoc --base main --head codex/oss-evidence-sprint --title "feat: prepare AiDoc OSS storefront and beta.6" --body-file /private/tmp/aidoc-beta6-pr.md
  ```

  The PR body lists Gate A1 checks, links the design and plan, embeds the
  social preview and poster, records beta.5 current/beta.6 candidate truth,
  and states that no runtime or security behavior changed.

- [ ] **Step 6: Wait for hosted CI and merge only reviewed green evidence**

  ```bash
  gh pr checks --watch --repo mr-min-max/aidoc
  gh pr view --repo mr-min-max/aidoc --json mergeable,reviewDecision,statusCheckRollup,files,commits
  ```

  Require Node 22 and 24 success, no conflict, expected file scope, and final
  maintainer visual approval. Merge the PR once. Do not tag before the merged
  commit is visible on protected `origin/main`.

---

### Task 8: Publish beta.6 from the exact merged commit through OIDC

**Files:** no source edits before publication.

- [ ] **Step 1: Pin and verify the merged protected-main commit**

  ```bash
  git fetch origin main --tags
  test ! -e /private/tmp/aidoc-beta6-release
  git worktree add --detach /private/tmp/aidoc-beta6-release origin/main
  cd /private/tmp/aidoc-beta6-release
  git status --short
  AIDOC_RELEASE_SHA="$(git rev-parse HEAD)"
  test "$AIDOC_RELEASE_SHA" = "$(git rev-parse origin/main)"
  gh run list --repo mr-min-max/aidoc --branch main --limit 10
  node scripts/verify-npm-unpublished.mjs
  node scripts/verify-npm-published.mjs --version 0.2.0-beta.5 --latest 0.2.0-beta.4
  export AIDOC_NPM_CACHE=/private/tmp/aidoc-npm-cache-beta6-release
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm ci
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run verify:release
  ```

  Capture the single SHA. Require a clean tree, green hosted CI at that SHA,
  beta.6 exact 404, beta.5 present, and beta.4 still `latest`.

- [ ] **Step 2: Confirm the release authentication boundary**

  ```bash
  cd /private/tmp/aidoc-beta6-release
  gh secret list --repo mr-min-max/aidoc
  rg -n 'NPM_TOKEN|NODE_AUTH_TOKEN' .github/workflows/release.yml
  ```

  Expected: no `NPM_TOKEN` secret by name and no token reference in the
  workflow. npm Trusted Publisher must still show repository
  `mr-min-max/aidoc` and workflow `release.yml`.

- [ ] **Step 3: Apply the reviewed repository metadata before tagging**

  ```bash
  gh repo edit mr-min-max/aidoc --description "AST-first documentation for Codex, Claude, and supported models. Generate project docs, map code changes to affected files, and review focused updates." --homepage "https://www.npmjs.com/package/@mr-min-max/aidoc-gen" --add-topic documentation --add-topic documentation-generator --add-topic developer-tools --add-topic ast --add-topic codex --add-topic claude --add-topic mcp --add-topic readme --add-topic typescript --add-topic python
  ```

  Upload `docs/assets/social/aidoc-social-preview.png` in GitHub repository
  settings after the final visual review. This UI step is required because the
  repository API does not provide a reliable social-preview upload contract.
  Reopen the public repository page and verify description, homepage, topics,
  social crop, README logo, badges, GIF, and static fallback before tagging.

- [ ] **Step 4: Create one annotated release tag at the verified SHA**

  ```bash
  cd /private/tmp/aidoc-beta6-release
  AIDOC_RELEASE_SHA="$(git rev-parse HEAD)"
  git tag -a v0.2.0-beta.6 -m "release: v0.2.0-beta.6" "$AIDOC_RELEASE_SHA"
  git show --no-patch --format=fuller v0.2.0-beta.6
  git push origin v0.2.0-beta.6
  ```

  Verify the tagger uses the noreply email and the tag points directly to the
  captured protected-main SHA. Never move an existing tag.

- [ ] **Step 5: Wait for the OIDC release workflow**

  ```bash
  cd /private/tmp/aidoc-beta6-release
  AIDOC_RELEASE_SHA="$(git rev-parse HEAD)"
  release_run_id=""
  for attempt in {1..12}; do
    release_run_id="$(gh run list --repo mr-min-max/aidoc --workflow Release --commit "$AIDOC_RELEASE_SHA" --limit 1 --json databaseId,event --jq 'map(select(.event == "push"))[0].databaseId // empty')"
    test -n "$release_run_id" && break
    sleep 5
  done
  test -n "$release_run_id"
  gh run watch "$release_run_id" --repo mr-min-max/aidoc --exit-status
  ```

  Require both verification matrix jobs, publish, and GitHub release to pass.
  If any job fails, stop. Do not manually publish and do not create a token.

- [ ] **Step 6: Verify immutable external release evidence**

  ```bash
  cd /private/tmp/aidoc-beta6-release
  export AIDOC_NPM_CACHE=/private/tmp/aidoc-npm-cache-beta6-release
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm view @mr-min-max/aidoc-gen@0.2.0-beta.6 version dist.integrity dist.tarball dist.attestations --json
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm view @mr-min-max/aidoc-gen dist-tags --json
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm view @mr-min-max/aidoc-gen@0.2.0-beta.6 --json
  gh release view v0.2.0-beta.6 --repo mr-min-max/aidoc --json isPrerelease,tagName,targetCommitish,assets,url
  ```

  Require version beta.6, `beta` equal to beta.6, `latest` equal to beta.4,
  npm provenance tied to `mr-min-max/aidoc`, one tarball plus checksum in the
  GitHub prerelease, and checksum equality with the registry tarball. Install
  the registry version in a fresh temporary directory. Run its version command,
  package smoke, and MCP smoke against that exact artifact:

  ```bash
  test ! -e /private/tmp/aidoc-beta6-registry
  test ! -e /private/tmp/aidoc-beta6-consumer
  mkdir -p /private/tmp/aidoc-beta6-registry
  mkdir -p /private/tmp/aidoc-beta6-consumer
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm pack @mr-min-max/aidoc-gen@0.2.0-beta.6 --ignore-scripts --json --pack-destination /private/tmp/aidoc-beta6-registry > /private/tmp/aidoc-beta6-registry/pack.json
  registry_tarball="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(p.length!==1||typeof p[0].filename!=="string") process.exit(1); process.stdout.write(`/private/tmp/aidoc-beta6-registry/${p[0].filename}`)' /private/tmp/aidoc-beta6-registry/pack.json)"
  cd /private/tmp/aidoc-beta6-consumer
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm init -y
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm install --ignore-scripts @mr-min-max/aidoc-gen@0.2.0-beta.6
  ./node_modules/.bin/aidoc --version
  AIDOC_TEST_TARBALL="$registry_tarball" NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm --prefix /private/tmp/aidoc-beta6-release run test:package
  AIDOC_TEST_TARBALL="$registry_tarball" NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm --prefix /private/tmp/aidoc-beta6-release run test:mcp
  ```

  Download the GitHub checksum and compare it with the registry tarball:

  ```bash
  gh release download v0.2.0-beta.6 --repo mr-min-max/aidoc --pattern '*.sha256' --dir /private/tmp/aidoc-beta6-registry
  cd /private/tmp/aidoc-beta6-registry
  registry_name="$(basename "$registry_tarball")"
  checksum_file="$(find . -maxdepth 1 -name '*.sha256' -print -quit)"
  recorded_hash="$(cut -d ' ' -f 1 "$checksum_file")"
  registry_hash="$(shasum -a 256 "$registry_name" | cut -d ' ' -f 1)"
  test "$recorded_hash" = "$registry_hash"
  ```

  If the reviewed full walkthrough MP4 exists, resolve its actual local path,
  verify the file and privacy review, and attach it with `gh release upload`
  without replacing the tarball or checksum. The video is optional. Do not
  place an unreviewed local path in documentation and do not delay registry
  publication for editing.

---

### Task 9: Merge a bounded postpublication truth update

**Files:**

- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/PUBLIC_BETA.md`
- Modify: `docs/RELEASING.md`
- Modify: `docs/releases/v0.2.0-beta.6.md`
- Modify: `docs/GITHUB_ACTION.md`
- Modify: `tests/e2e/npm-published.test.mjs`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `package.json`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `.github/ISSUE_TEMPLATE/question.yml`

- [ ] **Step 1: Create a new bounded branch from postrelease main**

  ```bash
  cd /Users/davyd/Documents/aidoc/.worktrees/oss-evidence-sprint
  git fetch origin main
  test ! -e /private/tmp/aidoc-beta6-public-truth
  git worktree add -b codex/beta6-public-truth /private/tmp/aidoc-beta6-public-truth origin/main
  cd /private/tmp/aidoc-beta6-public-truth
  ```

  Do not reuse the candidate branch. There are no production-source changes in
  this pull request.

- [ ] **Step 2: Write RED assertions for published beta.6 truth**

  Change current-public assertions from beta.5 to beta.6. Require:

  ```text
  npm beta version: 0.2.0-beta.6
  npm beta dist-tag: 0.2.0-beta.6
  npm latest dist-tag: 0.2.0-beta.4
  GitHub prerelease: v0.2.0-beta.6
  candidate/forthcoming wording: absent from active beta.6 surfaces
  OIDC provenance: documented and externally verified
  ```

  Run the focused tests and observe RED against candidate wording.

- [ ] **Step 3: Promote active documentation and registry gates**

  Update README, Public Beta, Roadmap, changelog, release note, release runbook,
  Action examples, and all three issue-template version prompts to beta.6.
  Change package scripts to:

  ```json
  {
    "scripts": {
      "test:npm-published": "node --test tests/e2e/npm-published.test.mjs && node scripts/verify-npm-published.mjs --version 0.2.0-beta.6 --latest 0.2.0-beta.4",
      "test:public-beta": "node --test tests/e2e/public-beta-preflight.test.mjs && npm run test:npm-published && jest tests/unit/release/public-beta-config.test.ts --runInBand"
    }
  }
  ```

  Keep the mocked unpublished-state tests as utility regression coverage, but
  remove the live unpublished verifier from the public gate. Do not invent a
  beta.7 candidate.

- [ ] **Step 4: Run complete postpublication verification**

  ```bash
  cd /private/tmp/aidoc-beta6-public-truth
  export AIDOC_NPM_CACHE=/private/tmp/aidoc-npm-cache-beta6-public
  npm run test:npm-published
  npm run test:public-beta
  npm run test:storefront
  NPM_CONFIG_CACHE="$AIDOC_NPM_CACHE" npm run verify:release
  node dist/cli/index.js score --min 80
  node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD
  npx tsc --noEmit
  git diff --check
  ```

  Re-check npm tags, provenance, GitHub release assets, GitHub secret absence,
  protected noreply identity, and no Unicode em dash in active copy.

- [ ] **Step 5: Commit, push, and merge the truth-only PR**

  Create `/private/tmp/aidoc-beta6-public-pr.md` with this exact content:

  ```md
  ## Outcome

  Records externally verified 0.2.0-beta.6 publication after the OIDC release.

  ## Evidence

  - npm beta points to 0.2.0-beta.6.
  - npm latest remains 0.2.0-beta.4.
  - npm provenance points to mr-min-max/aidoc.
  - The GitHub prerelease tarball and checksum match the registry artifact.

  ## Scope

  Documentation, issue prompts, and published-state assertions only. No product
  runtime or release authentication change.
  ```

  ```bash
  git add README.md ROADMAP.md CHANGELOG.md docs/PUBLIC_BETA.md docs/RELEASING.md docs/releases/v0.2.0-beta.6.md docs/GITHUB_ACTION.md tests/e2e/npm-published.test.mjs tests/unit/release/public-beta-config.test.ts package.json .github/ISSUE_TEMPLATE/bug_report.yml .github/ISSUE_TEMPLATE/feature_request.yml .github/ISSUE_TEMPLATE/question.yml
  git commit -m "docs: record published beta.6 storefront"
  git push -u origin codex/beta6-public-truth
  gh pr create --repo mr-min-max/aidoc --base main --head codex/beta6-public-truth --title "docs: record published beta.6 storefront" --body-file /private/tmp/aidoc-beta6-public-pr.md
  gh pr checks --watch --repo mr-min-max/aidoc
  ```

  Merge only after hosted CI and registry assertions are green. This second PR
  is required because the first PR must not claim an external publication that
  had not happened yet.

---

## Final Phase A Acceptance Checklist

- [ ] README first screen communicates one concrete promise without generic AI
      copy, excessive badges, or a wall of setup detail.
- [ ] Creation and maintenance are both visible, while the Codex plugin remains
      accurately maintenance-specific.
- [ ] Package, CLI, Action, Public Beta, repository metadata, and README use one
      compatible AST-first product position.
- [ ] Default hybrid demo JSON remains deterministic and the presentation mode
      shows the exact `createUser` scenario without provider calls or writes.
- [ ] Logo, wordmark, social preview, poster, frames, and GIF are original,
      accessible, within budgets, and free of private data or third-party logos.
- [ ] The short GIF has a static fallback. The full-video script, captions, and
      privacy checklist are tracked. The MP4 remains optional and external to Git.
- [ ] Detailed CLI, Action, provider, MCP, Trust, and release information is one
      click away and remains covered by semantic tests.
- [ ] beta.6 is published only once from protected main through OIDC and exact
      verified artifact reuse.
- [ ] `beta` points to beta.6, `latest` remains beta.4, provenance is valid, and
      the GitHub prerelease assets match.
- [ ] No GitHub npm secret, traditional token fallback, public Gmail commit,
      Unicode em dash, new private path, unverified claim, testimonial, or grant
      claim is introduced.
- [ ] Postpublication docs report beta.6 only after external evidence exists.
- [ ] Phase B and Phase C remain separate and start from the exact published
      beta.6 release.
