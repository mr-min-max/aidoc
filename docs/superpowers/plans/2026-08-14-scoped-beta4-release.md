# Scoped beta.4 release recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and publish `@mr-min-max/aidoc-gen@0.2.0-beta.4` without moving the failed beta.3 tag or weakening the verified-artifact release chain.

**Architecture:** Keep the `aidoc` executable and runtime unchanged. Replace only the npm package identity/version, make the release verifier fail closed on the exact scoped name, teach process smokes the scoped `node_modules` path, and synchronize current release documentation and evidence before a new reviewed tag.

**Tech Stack:** Node.js 22/24, npm, TypeScript, Jest, Node test runner, GitHub Actions, npm provenance.

## Global Constraints

- Exact package identity: `@mr-min-max/aidoc-gen@0.2.0-beta.4`.
- Exact release tag: `v0.2.0-beta.4`; never move, delete, or reuse `v0.2.0-beta.3`.
- Executable name remains `aidoc`.
- Historical `docs/superpowers/specs/**` and `docs/superpowers/plans/**` remain historical except this design and plan.
- Do not claim npm/GitHub publication until external post-publication proof succeeds.
- All commits use `mr-min-max <254284659+mr-min-max@users.noreply.github.com>`.

---

### Task 1: Fail-closed scoped release identity

**Files:**

- Modify: `tests/unit/release/release-candidate.test.ts`
- Modify: `scripts/verify-release-candidate.mjs`

**Interfaces:**

- Consumes: `package.json` fields `name` and `version`.
- Produces: a verifier that accepts only `@mr-min-max/aidoc-gen` and a tag exactly equal to `v${version}`.

- [ ] **Step 1: Write the failing unscoped-name regression**

Change the fixture defaults to the future identity and add this assertion:

```ts
it("rejects the superseded unscoped package name", () => {
  fs.writeFileSync(
    path.join(repository, "package.json"),
    JSON.stringify({ name: "aidoc-gen", version: "0.2.0-beta.4" }),
  );

  const result = runVerifier(repository);

  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    "Release package metadata could not be verified.\n",
  );
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm test -- tests/unit/release/release-candidate.test.ts --runInBand
```

Expected: the unscoped-name regression fails because the current verifier reads only `version`.

- [ ] **Step 3: Enforce the exact package identity**

Read both fields and enter the existing fixed package error boundary unless:

```js
packageJson.name === "@mr-min-max/aidoc-gen" &&
  typeof packageJson.version === "string";
```

Keep every diagnostic value-free and keep tag/ancestry/expected-SHA behavior unchanged.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run the same Jest command and require all tests to pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-release-candidate.mjs tests/unit/release/release-candidate.test.ts
git commit -m "fix(release): require scoped package identity"
```

### Task 2: Scoped package metadata and process smokes

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/e2e/package-smoke.mjs`
- Modify: `tests/e2e/mcp-smoke.mjs`
- Modify: `tests/unit/action/runner.test.ts`

**Interfaces:**

- Consumes: npm's scoped installation layout.
- Produces: package metadata for beta.4 while preserving the `aidoc` bin and exact packed runtime behavior.

- [ ] **Step 1: Change smoke expectations before package metadata**

Use the scoped package root everywhere:

```js
const packageRoot = join(consumer, "node_modules", "@mr-min-max", "aidoc-gen");
assert.equal(packedPackage.name, "@mr-min-max/aidoc-gen");
```

Update action metadata expectation to
`@mr-min-max/aidoc-gen@$version`.

- [ ] **Step 2: Run process/action checks and confirm RED**

Run:

```bash
npm run build
npm run test:package
npm run test:mcp
npm run test:action
```

Expected: the old unscoped package metadata/layout fails the new assertions.

- [ ] **Step 3: Update package and lock metadata**

Set the root package fields in both files to:

```json
{
  "name": "@mr-min-max/aidoc-gen",
  "version": "0.2.0-beta.4"
}
```

Do not change dependencies, scripts, `bin.aidoc`, or runtime exports.

- [ ] **Step 4: Run process/action checks and confirm GREEN**

Run the four commands from Step 2 and require success.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/e2e/package-smoke.mjs tests/e2e/mcp-smoke.mjs tests/unit/action/runner.test.ts
git commit -m "fix(release): adopt scoped beta4 package"
```

### Task 3: Synchronize current beta.4 evidence and documentation

**Files:**

- Modify: `integrations/codex/aidoc/.codex-plugin/plugin.json`
- Modify: `scripts/public-beta-preflight.mjs`
- Modify: `tests/e2e/codex-plugin-smoke.mjs`
- Modify: `tests/e2e/public-beta-preflight.test.mjs`
- Modify: `tests/unit/release/public-beta-config.test.ts`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `.github/ISSUE_TEMPLATE/question.yml`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/PUBLIC_BETA.md`
- Modify: `docs/integrations/codex.md`
- Modify: `docs/integrations/claude.md`
- Modify: `docs/releases/v0.2.0-beta.3.md`
- Create: `docs/releases/v0.2.0-beta.4.md`
- Modify: `docs/RELEASING.md`

**Interfaces:**

- Consumes: scoped package identity, beta.4 version, and the preserved failed beta.3 tag.
- Produces: truthful source-candidate documentation and deterministic preflight/plugin evidence.

- [ ] **Step 1: Advance assertions first**

Require exact current identity and documents:

```ts
expect(packageJson.name).toBe("@mr-min-max/aidoc-gen");
expect(packageJson.version).toBe("0.2.0-beta.4");
expect(documentationPaths).toContain("docs/releases/v0.2.0-beta.4.md");
```

Update plugin/preflight assertions to beta.4 and add a negative assertion that
current public surfaces do not describe beta.3 as published.

- [ ] **Step 2: Run focused checks and confirm RED**

```bash
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
node tests/e2e/codex-plugin-smoke.mjs
node --test tests/e2e/public-beta-preflight.test.mjs
```

Expected: current beta.3 metadata/docs fail the beta.4 contract.

- [ ] **Step 3: Update current source-candidate surfaces**

Describe beta.4 as forthcoming and source-checkout-only. Keep the local setup
commands (`npm install`, `npm run build`, `npm link`) until publication proof.
Use `npm unlink -g @mr-min-max/aidoc-gen` for reversal. Record beta.3 as an
unpublished registry-rejected candidate, without exposing token data.

- [ ] **Step 4: Update the runbook**

Use exact commands:

```bash
npm view @mr-min-max/aidoc-gen@0.2.0-beta.4 version --json
node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha"
git tag -a v0.2.0-beta.4 "$release_sha" -m "v0.2.0-beta.4"
npm dist-tag ls @mr-min-max/aidoc-gen
```

State that beta.3 must not be repointed or rerun.

- [ ] **Step 5: Run focused checks and confirm GREEN**

Run the commands from Step 2 and require success.

- [ ] **Step 6: Commit**

```bash
git add .github/ISSUE_TEMPLATE README.md ROADMAP.md CHANGELOG.md docs integrations/codex/aidoc/.codex-plugin/plugin.json scripts/public-beta-preflight.mjs tests/e2e/codex-plugin-smoke.mjs tests/e2e/public-beta-preflight.test.mjs tests/unit/release/public-beta-config.test.ts
git commit -m "docs(release): prepare scoped beta4 candidate"
```

### Task 4: Release verification, review, and publication

**Files:**

- Verify all changed files; no new implementation files.

**Interfaces:**

- Consumes: Tasks 1-3.
- Produces: a reviewed main commit, new beta.4 tag, exact npm beta artifact, provenance, and GitHub prerelease.

- [ ] **Step 1: Run all local gates**

```bash
npm ci
npm run verify:release
npm run build
node dist/cli/index.js score --min 80
npm run test:public-beta
node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD
npx tsc --noEmit
git diff --check
```

- [ ] **Step 2: Inspect scope and identities**

Require a clean index/worktree after commits, no personal email/secret/local
absolute path in the new commits, and exact GitHub noreply author/committer
identity.

- [ ] **Step 3: Push and open a PR**

```bash
git push -u origin codex/scoped-beta4-release
gh pr create --base main --head codex/scoped-beta4-release
```

Wait for hosted CI and independent review before merge.

- [ ] **Step 4: Verify exact merged main**

Repeat the full candidate gates on a detached worktree at the new `origin/main`.
Confirm `@mr-min-max/aidoc-gen@0.2.0-beta.4` is unpublished, `NPM_TOKEN` exists,
and no beta.4 tag or release exists.

- [ ] **Step 5: Publish beta.4 once**

Create and push only the annotated `v0.2.0-beta.4` tag. Watch the Release
workflow to completion. Verify the registry version, `beta` dist-tag,
provenance, GitHub prerelease, checksum, and packed CLI/MCP smoke from the
downloaded release bytes.

- [ ] **Step 6: Post-publication documentation**

Only after Step 5 succeeds, create a separate reviewed PR replacing
forthcoming/source-checkout-only claims with the exact public installation
command:

```bash
npm install -g @mr-min-max/aidoc-gen@beta
aidoc --version
```
