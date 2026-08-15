# Dimensional Storefront Media Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy static and animated storefront media with the three maintainer-approved dimensional AiDoc compositions while preserving the beta.6 truth, safety, size, and release contracts.

**Architecture:** Track the approved high-resolution PNG compositions as repository-owned sources. Keep inspectable SVG composition wrappers for the social preview, poster, and five animation frames; permit only exact local PNG references, then render deterministic final PNG/GIF exports from those sources.

**Tech Stack:** SVG, PNG, GIF89a, Node.js `node:test`, Quick Look rasterization, `sips`, `ffmpeg`, Jest, TypeScript, Prettier.

## Global Constraints

- Work only in `/Users/davyd/Documents/aidoc/.worktrees/oss-evidence-sprint` on `codex/oss-evidence-sprint`.
- Do not create or switch worktrees or branches.
- Do not push, create a pull request, tag, upload GitHub media, publish beta.6, or change package versions.
- Preserve the canonical `createUser(email)` to `createUser(email, role)` story and the `README.md` plus `docs/API.md` targets.
- Preserve `No provider calls`, `No repository writes`, and `You decide what is applied`.
- Keep final dimensions and budgets at 1280x640 / 1.5 MiB, 1280x720 / 500 KiB, and 960x540 / 6 MiB.
- Reject private paths, credentials, raw digests, provider or third-party logos, synthetic adoption claims, and Unicode em dashes.

---

### Task 1: Lock the raster-source storefront contract

**Files:**

- Modify: `tests/e2e/storefront-assets.test.mjs`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

**Interfaces:**

- Consumes: the existing `requiredAssets`, `animationFrames`, `BETA_SOURCE_ARTIFACTS`, and mirrored fixture registry.
- Produces: exact source paths for `aidoc-social-preview-source.png`, `aidoc-flow-poster-source.png`, and `aidoc-flow-scene.png`, plus a local-only SVG image-reference policy.

- [ ] **Step 1: Write the failing asset-contract test**

  Add the three source PNGs to the required static/media lists. Assert their exact 1774x887 dimensions, non-empty distinct buffers, 2 MiB source budgets, `data-visual-system="dimensional-code-to-docs-v1"` on each wrapper/frame, exact copy metadata, and exact local image references. Continue rejecting remote or data URLs, scripts, event handlers, `foreignObject`, and unapproved local image paths.

- [ ] **Step 2: Write the failing preflight registry test**

  Mirror the three new source paths in the production and fixture registries and raise the expected source-artifact count from 48 to 51.

- [ ] **Step 3: Run RED**

  Run `node --test tests/e2e/storefront-assets.test.mjs tests/e2e/public-beta-preflight.test.mjs`. Expect missing-source and missing-metadata/reference failures caused only by the new contract.

- [ ] **Step 4: Commit after the assets make this contract GREEN**

  Stage the contract files together with the static assets from Task 2 and commit them as one independently verified static-media change.

---

### Task 2: Install the approved social preview and static poster

**Files:**

- Create: `docs/assets/social/aidoc-social-preview-source.png`
- Modify: `docs/assets/social/aidoc-social-preview.svg`
- Modify: `docs/assets/social/aidoc-social-preview.png`
- Create: `docs/assets/demo/aidoc-flow-poster-source.png`
- Modify: `docs/assets/demo/aidoc-flow-poster.svg`
- Modify: `docs/assets/demo/aidoc-flow-poster.png`
- Modify: `docs/assets/brand/README.md`

**Interfaces:**

- Consumes: approved visual concepts `exec-b5096173-6e06-4bac-ad13-817157f2faa4.png` and `exec-07b39e5b-8a04-4bf7-ac12-4f56331e3ded.png`.
- Produces: final 1280x640 social PNG and 1280x720 poster PNG plus inspectable, safe composition wrappers.

- [ ] **Step 1: Copy the approved source compositions**

  Copy the light hero concept to `aidoc-social-preview-source.png` and the dark developer-tool concept to `aidoc-flow-poster-source.png` without modifying the originals under the Codex generated-images directory.

- [ ] **Step 2: Build the social composition wrapper**

  Set a 1280x640 viewBox, local source href, accessibility title/description, exact three-line copy metadata, and a crop-safe full-canvas image composition.

- [ ] **Step 3: Build the poster composition wrapper**

  Place the approved 2:1 dark source above a bottom graphite proof strip. Add visible 28px-or-larger proof labels for `No provider calls`, `No repository writes`, and `You decide what is applied`, and exact metadata for the canonical code change, targets, and validated state.

- [ ] **Step 4: Render and optimize the final PNGs**

  Rasterize each wrapper at its native canvas, resize only when necessary, and use indexed PNG optimization only if required to meet the existing budgets without visibly damaging typography or shadows.

- [ ] **Step 5: Run GREEN and inspect**

  Run the focused asset/preflight tests, PNG signature/dimension/budget probes, XML validation, and `git diff --check`. Inspect both final PNGs at original size and README/social-card width.

- [ ] **Step 6: Commit the static refresh**

  Commit the Task 1 contract, preflight registry, source compositions, wrappers, final PNGs, and brand usage note with the configured noreply identity.

---

### Task 3: Rebuild the README animation from one stable dimensional scene

**Files:**

- Create: `docs/assets/demo/aidoc-flow-scene.png`
- Modify: `docs/assets/demo/frame-01-change.svg`
- Modify: `docs/assets/demo/frame-02-plan.svg`
- Modify: `docs/assets/demo/frame-03-targets.svg`
- Modify: `docs/assets/demo/frame-04-diff.svg`
- Modify: `docs/assets/demo/frame-05-validated.svg`
- Modify: `docs/assets/demo/aidoc-flow.gif`
- Modify: `tests/e2e/storefront-assets.test.mjs`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`

**Interfaces:**

- Consumes: approved person-free horizontal concept `exec-44cac575-ef9b-406c-b8cf-b7d398c611a8.png`.
- Produces: five fixed-camera 1280x720 SVG frames and one 15-second 960x540 infinite GIF.

- [ ] **Step 1: Copy the approved shared scene**

  Copy the person-free horizontal concept to `aidoc-flow-scene.png` and keep its exact 1774x887 source dimensions.

- [ ] **Step 2: Rebuild all five SVG frames**

  Reference only `aidoc-flow-scene.png`. Use the same camera and geometry in every frame, a 64px safe area, at least 28px text, a visible `N / 5` counter, a changing stage headline, restrained cyan focus treatments, and a green-only final state. Store the canonical prepare/validate and no-write evidence in inspectable metadata and visible stage copy.

- [ ] **Step 3: Render numbered frame PNGs outside the repository**

  Use Quick Look only as the local SVG rasterizer when `sips` cannot read SVG, normalize each render to 1280x720, and inspect every frame for clipping and stable geometry.

- [ ] **Step 4: Generate the GIF**

  Use the locked 3-seconds-per-frame `ffmpeg` palette workflow, scale to 960x540, and set infinite looping. Keep the final file at or below 6 MiB.

- [ ] **Step 5: Run GREEN and inspect motion**

  Run focused asset/preflight tests, `npm run test:storefront`, XML validation, `ffprobe`, raw GIF signature/loop checks, and `git diff --check`. Extract and inspect the first, middle, and final GIF frames at 960x540.

- [ ] **Step 6: Commit the animation refresh**

  Commit the shared scene, five source frames, GIF, and corresponding contract/registry changes with the configured noreply identity.

---

### Task 4: Verify the complete candidate without releasing it

**Files:**

- Verify only; make corrections solely when a failed check identifies a refresh regression.

**Interfaces:**

- Consumes: the completed static and motion commits.
- Produces: fresh evidence that the local candidate is internally consistent and remains unpublished.

- [ ] **Step 1: Review both commits and repository scope**

  Inspect full diffs, binary dimensions, file budgets, worktree status, branch, HEAD ancestry, and absence of release tags.

- [ ] **Step 2: Run code and format checks**

  Run focused Prettier, `npx tsc --noEmit`, XML validation, and `git diff --check`.

- [ ] **Step 3: Run storefront and preflight checks**

  Run `npm run test:storefront`, the focused public-beta preflight suite, and `node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD`.

- [ ] **Step 4: Run the full release verification**

  Run `env npm_config_cache=/Users/davyd/Documents/aidoc/.npm npm_config_prefer_offline=true npm run verify:release` and inspect the complete result.

- [ ] **Step 5: Perform final visual QA**

  Inspect the social preview, poster, all five source frames, and extracted first/middle/final GIF frames. Confirm social cropping, README-width readability, stable fixed-camera motion, clear code-to-docs meaning, and no private or synthetic claims.

- [ ] **Step 6: Stop before external actions**

  Report the exact local commits and verification evidence. Do not push, open a pull request, tag, upload assets, or publish beta.6.
