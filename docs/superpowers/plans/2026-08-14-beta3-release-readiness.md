# Beta.3 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one fully verified pull request that makes the future
`aidoc-gen@0.2.0-beta.3` release explicit, provenance-capable, beta-tagged, and
truthfully documented without publishing, tagging, releasing, merging, or
changing repository settings.

**Architecture:** Preserve the current verify → checksum-verified artifact →
publish → GitHub prerelease pipeline, but harden each boundary and upgrade all
workflow actions to reviewed Node-24-compatible immutable revisions. Keep the
first-publication token confined to the publish step, then document the
post-bootstrap migration to npm Trusted Publishing. Add a real question issue
form so public support text points only to a live surface.

**Tech Stack:** GitHub Actions YAML, npm 11.5.1+, Node.js 22/24, Jest 30,
TypeScript, `js-yaml`, GitHub issue forms, Markdown, npm provenance/OIDC.

## Global Constraints

- Work only in the isolated `codex/beta3-release-readiness` worktree, based on
  `origin/main` commit
  `73c6f0f199bcd05cac222f2541e620df638b1dd7`.
- Do not publish to npm, create or push a tag, create a GitHub Release, merge a
  pull request, enable Discussions, change repository settings, or rewrite
  history.
- Keep package name `aidoc-gen` and version `0.2.0-beta.3` unchanged.
- The future prerelease must use npm dist-tag `beta`, never `latest`.
- Preserve verification on Node 22 and 24, pack exactly once, checksum the
  tarball, smoke that exact tarball, and publish only the downloaded verified
  artifact.
- Keep `NODE_AUTH_TOKEN` out of every step except the one future `npm publish`
  step. The bootstrap credential must be shortest-lived, granular,
  package-write-only where npm permits, and use CI-specific 2FA bypass only
  until OIDC is proven. Never record a token value in source, tests, logs,
  issues, or chat.
- Publish permissions are exactly `contents: read` and `id-token: write`;
  GitHub Release permissions are exactly `contents: write`.
- Pin every external GitHub Action to a reviewed 40-character commit SHA and
  retain a human-readable release comment.
- Keep product code, package metadata, dependency versions, lockfiles,
  providers, MCP, parsers, CLI behavior, and public schemas unchanged.
- Every behavior change follows RED → GREEN and every commit must use
  `mr-min-max <254284659+mr-min-max@users.noreply.github.com>`.
- Do not merge the existing Dependabot pull requests individually in this
  stage; this plan consolidates only release/CI action runtime updates.

## File Responsibility Map

- `.github/workflows/ci.yml` — hosted pull-request/default-branch checks and
  reviewed CI action revisions.
- `.github/workflows/release.yml` — tag-triggered verification, artifact
  transfer, future npm publication, and GitHub prerelease creation.
- `tests/unit/release/ci-workflow.test.ts` — immutable CI action and permission
  policy.
- `tests/unit/release/workflow.test.ts` — release ordering, permissions,
  artifact identity, authentication, npm flags, and prerelease policy.
- `.github/ISSUE_TEMPLATE/question.yml` — live structured question/support
  intake.
- `.github/ISSUE_TEMPLATE/config.yml` — issue chooser with no dead Discussions
  link.
- `GOVERNANCE.md` — current public repository and release governance truth.
- `SUPPORT.md` — live support channels and privacy-safe reproduction guidance.
- `docs/RELEASING.md` — maintainer-only preparation/bootstrap/OIDC cleanup
  runbook that clearly stops before external actions.
- `tests/unit/release/public-beta-config.test.ts` — semantic assertions tying
  the public documentation and issue forms to the live repository state.

---

### Task 1: Harden the release workflow and remove deprecated action runtimes

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Create: `scripts/verify-release-candidate.mjs`
- Modify: `tests/unit/release/ci-workflow.test.ts`
- Modify: `tests/unit/release/workflow.test.ts`
- Create: `tests/unit/release/release-candidate.test.ts`

**Interfaces:**

- Consumes: the existing `aidoc-npm-package` artifact containing exactly one
  `.tgz` and its matching `.sha256` file.
- Produces: a tag-triggered workflow whose publish job accepts only the
  checksum-verified tarball and whose GitHub prerelease job reuses the same
  files without rebuilding. Before installation, it also proves that the tag
  target is contained in protected `main` and matches the package version.

- [ ] **Step 1: Replace expected action revisions in the tests**

  In `tests/unit/release/ci-workflow.test.ts`, replace the reviewed map with:

  ```ts
  const reviewedActions = {
    "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
    "codecov/codecov-action": "fb8b3582c8e4def4969c97caa2f19720cb33a72f",
  };
  ```

  In `tests/unit/release/workflow.test.ts`, replace the reviewed map with:

  ```ts
  const reviewedActions = {
    "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/download-artifact": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "softprops/action-gh-release": "3d0d9888cb7fd7b750713d6e236d1fcb99157228",
  };
  ```

  Keep the existing assertion that every `uses:` value is an exact immutable
  revision and has a `# v...` review comment.

- [ ] **Step 2: Add failing publish-boundary assertions**

  Extend `WorkflowStep.with` to accept booleans and add these assertions to the
  existing publish test:

  ```ts
  expect(publish.permissions).toEqual({
    contents: "read",
    "id-token": "write",
  });

  const npmGuard = stepNamed(publish, "Verify npm trusted-publishing support");
  expect(npmGuard.run).toContain("11.5.1");
  expect(npmGuard.env?.NODE_AUTH_TOKEN).toBeUndefined();

  expect(publishStep.run).toContain("--ignore-scripts");
  expect(publishStep.run).toContain("--access public");
  expect(publishStep.run).toContain("--tag beta");
  expect(publishStep.run).toContain("--provenance");
  expect(publishStep.env).toEqual({
    NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}",
  });
  expect(
    publish.steps
      .filter((step) => step !== publishStep)
      .every((step) => step.env?.NODE_AUTH_TOKEN === undefined),
  ).toBe(true);
  ```

  Preserve the checksum and exactly-one-tarball assertions already present.

- [ ] **Step 3: Add failing GitHub prerelease artifact assertions**

  Replace the old single-step expectation with semantic checks equivalent to:

  ```ts
  const download = githubRelease.steps.find((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  const validate = stepNamed(githubRelease, "Validate release assets");
  const release = githubRelease.steps.find((step) =>
    step.uses?.startsWith("softprops/action-gh-release@"),
  );

  expect(download?.with).toMatchObject({
    name: "aidoc-npm-package",
    path: "${{ runner.temp }}/aidoc-artifact",
  });
  expect(validate.run).toContain("sha256sum --check --strict");
  expect(release?.with).toMatchObject({
    generate_release_notes: true,
    prerelease: true,
    fail_on_unmatched_files: true,
  });
  expect(String(release?.with?.files)).toContain("*.tgz");
  expect(String(release?.with?.files)).toContain("*.sha256");

  const serializedSteps = JSON.stringify(githubRelease.steps);
  expect(serializedSteps).not.toMatch(
    /actions\/checkout|npm ci|npm install|npm pack|npm publish|npm run build/i,
  );
  ```

- [ ] **Step 4: Run the focused tests and confirm RED**

  Run:

  ```bash
  npm test -- tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts --runInBand
  ```

  Expected: failures for the old action SHAs, missing `id-token: write`, missing
  npm version guard/flags, and missing GitHub prerelease artifacts. No parser or
  TypeScript compile failure is acceptable.

- [ ] **Step 5: Upgrade CI action pins**

  In `.github/workflows/ci.yml`, use these exact revisions and comments:

  ```yaml
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  - uses: codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f # v7.0.0
  ```

  Preserve `fetch-depth: 0`, `persist-credentials: false`, the Node 22/24
  matrix, npm caching, identity preflight ordering, and
  `fail_ci_if_error: false`.

- [ ] **Step 6: Upgrade release action pins**

  In `.github/workflows/release.yml`, replace every occurrence with:

  ```yaml
  actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
  softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3.0.2
  ```

  Preserve artifact name, one-day retention, checksum creation, and exact
  tarball smoke environment.

- [ ] **Step 7: Implement the publish permission and npm-version boundary**

  Change the job permissions and add the guard immediately after setup-node:

  ```yaml
  publish:
    needs: verify
    permissions:
      contents: read
      id-token: write
  ```

  ```yaml
  - name: Verify npm trusted-publishing support
    shell: bash
    run: |
      set -euo pipefail
      npm_version="$(npm --version)"
      node -e 'const p=process.argv[1].split(".").map(Number); const ok=p.length===3 && p.every(Number.isInteger) && (p[0]>11 || (p[0]===11 && (p[1]>5 || (p[1]===5 && p[2]>=1)))); if (!ok) { console.error("npm 11.5.1 or newer is required"); process.exit(1); }' "$npm_version"
  ```

  Do not add `NODE_AUTH_TOKEN` to this step, job scope, or setup-node.

- [ ] **Step 8: Harden the future publish command**

  Replace only the publish step with:

  ```yaml
  - name: Publish verified artifact
    run: >-
      npm publish "${{ steps.artifact.outputs.tarball }}"
      --ignore-scripts
      --access public
      --tag beta
      --provenance
    env:
      NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
  ```

- [ ] **Step 9: Reuse verified files in the GitHub prerelease**

  Keep `needs: publish` and `permissions: { contents: write }`, then implement:

  ```yaml
  steps:
    - name: Download verified artifact
      uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
      with:
        name: aidoc-npm-package
        path: ${{ runner.temp }}/aidoc-artifact
    - name: Validate release assets
      shell: bash
      run: |
        set -euo pipefail
        cd "$RUNNER_TEMP/aidoc-artifact"
        shopt -s nullglob
        tarballs=(*.tgz)
        checksums=(*.sha256)
        test "${#tarballs[@]}" -eq 1
        test "${#checksums[@]}" -eq 1
        test "${checksums[0]}" = "${tarballs[0]}.sha256"
        sha256sum --check --strict "${checksums[0]}"
    - name: Create GitHub prerelease
      uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3.0.2
      with:
        generate_release_notes: true
        prerelease: true
        fail_on_unmatched_files: true
        files: |
          ${{ runner.temp }}/aidoc-artifact/*.tgz
          ${{ runner.temp }}/aidoc-artifact/*.sha256
  ```

- [ ] **Step 10: Run focused workflow tests and confirm GREEN**

  Run:

  ```bash
  npm test -- tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts --runInBand
  npx tsc --noEmit
  npx prettier --check .github/workflows/ci.yml .github/workflows/release.yml tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts
  git diff --check
  ```

  Expected: both suites pass, TypeScript exits 0, formatting passes, and no
  whitespace errors remain.

- [ ] **Step 10a: Close independent-review release-boundary gaps**

  Add `scripts/verify-release-candidate.mjs` and execute it before `npm ci`.
  The verifier resolves refs without a shell, accepts only fixed bounded
  arguments, compares the tag to `package.json`, and checks:

  ```bash
  git merge-base --is-ancestor CANDIDATE_COMMIT MAIN_COMMIT
  ```

  Add a real temporary Git regression proving an unmerged descendant fails.
  Tighten workflow tests so the complete action multiset equals the reviewed
  allowlist, there is exactly one normalized `npm publish` command, no
  `--tag latest`, no job/workflow token exposure, and both artifact downloads
  have only the current-run `name` and `path` inputs. Update the runbook to
  capture one readonly `release_sha`, test that exact checkout, revalidate the
  same remote and local SHA before tagging, and tag only the stored SHA.

- [ ] **Step 11: Review and commit Task 1**

  Verify identity and staged scope before committing:

  ```bash
  git config --local --get user.email
  git diff --check
  git diff -- .github/workflows/ci.yml .github/workflows/release.yml tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts
  git add .github/workflows/ci.yml .github/workflows/release.yml tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts
  git diff --cached --check
  git commit -m "ci(release): harden beta publication"
  ```

  Expected email:
  `254284659+mr-min-max@users.noreply.github.com`.

---

### Task 2: Make OSS governance and support surfaces truthful

**Files:**

- Create: `.github/ISSUE_TEMPLATE/question.yml`
- Modify: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `GOVERNANCE.md`
- Modify: `SUPPORT.md`
- Create: `docs/RELEASING.md`
- Modify: `tests/unit/release/public-beta-config.test.ts`

**Interfaces:**

- Consumes: the hardened workflow contract from Task 1 and current public
  repository state (public repo, Issues enabled, Discussions disabled).
- Produces: one live question/support issue route plus a maintainer runbook
  that stops before tag/publish/release operations.

- [ ] **Step 1: Add a failing live-support-route test**

  Add a test that parses the issue chooser and new question form, then checks
  that `SUPPORT.md` routes users to that real form:

  ```ts
  const support = fs.readFileSync(path.resolve("SUPPORT.md"), "utf8");
  const issueConfig = load(
    fs.readFileSync(path.resolve(".github/ISSUE_TEMPLATE/config.yml"), "utf8"),
  ) as { blank_issues_enabled?: boolean; contact_links?: unknown[] };
  const question = load(
    fs.readFileSync(
      path.resolve(".github/ISSUE_TEMPLATE/question.yml"),
      "utf8",
    ),
  ) as { name?: string; labels?: string[]; body?: unknown[] };

  expect(issueConfig).toEqual({ blank_issues_enabled: false });
  expect(question.name).toMatch(/question|support/i);
  expect(question.labels).toContain("question");
  expect(question.body?.length).toBeGreaterThan(0);
  expect(support).toContain(
    "https://github.com/mr-min-max/aidoc/issues/new?template=question.yml",
  );
  expect(support).not.toContain("/discussions");
  ```

  The regression catches a missing/invalid form, a reintroduced dead contact
  link, blank-issue bypass, or a support URL that no longer names the actual
  form. Human governance/release prose is reviewed against live GitHub/npm
  state in Task 3 rather than frozen as exact source text.

- [ ] **Step 2: Run the public-beta test and confirm RED**

  Run:

  ```bash
  npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
  ```

  Expected: fail because `question.yml` does not exist and the issue chooser
  plus `SUPPORT.md` still route to disabled Discussions.

- [ ] **Step 3: Create the structured question form**

  Create `.github/ISSUE_TEMPLATE/question.yml` with this contract:

  ```yaml
  name: "❓ Question / Support"
  description: Ask for help using the AiDoc public beta
  title: "[Question]: "
  labels: ["question"]
  body:
    - type: markdown
      attributes:
        value: |
          Please remove credentials, private source, absolute local paths, and personal data before submitting.
    - type: input
      id: version
      attributes:
        label: AiDoc version or commit
        placeholder: "0.2.0-beta.3 or commit SHA"
      validations:
        required: true
    - type: input
      id: node-version
      attributes:
        label: Node.js version
        placeholder: "22.x or 24.x"
      validations:
        required: true
    - type: textarea
      id: question
      attributes:
        label: Question
        description: What are you trying to do, what command did you run, and where are you blocked?
      validations:
        required: true
    - type: textarea
      id: attempts
      attributes:
        label: What you already tried
        description: Include a minimal provider-free reproduction when possible. Never include API keys.
  ```

- [ ] **Step 4: Remove the dead Discussions contact link**

  Reduce `.github/ISSUE_TEMPLATE/config.yml` to:

  ```yaml
  blank_issues_enabled: false
  ```

  The three issue forms remain the only issue-chooser options. Do not enable
  blank issues or Discussions.

- [ ] **Step 5: Correct governance and support prose**

  In `GOVERNANCE.md`, replace the private-repository paragraph with:

  ```markdown
  aidoc is an MIT-licensed project developed in the public canonical repository
  at `mr-min-max/aidoc`.
  ```

  Link the Release Process section to `docs/RELEASING.md` and keep
  `npm run verify:release` as the mandatory local gate.

  In `SUPPORT.md`, route usage help to the question form:

  ```markdown
  - **Questions and usage help:** use the
    [Question / Support form](https://github.com/mr-min-max/aidoc/issues/new?template=question.yml).
  ```

  Keep bugs, feature proposals, and private vulnerability reporting separate.
  State that Discussions is not currently enabled rather than linking to it.

- [ ] **Step 6: Write the maintainer release runbook**

  Create `docs/RELEASING.md` with these exact sections:

  1. `Release boundary` — preparation/merge does not publish; tag creation
     needs separate explicit authorization.
  2. `Pre-release verification` — remote `main` CI, clean tree, exact version,
     npm name availability, `npm run verify:release`, score, and public-beta
     preflight.
  3. `First-publication bootstrap` — strong npm account 2FA, shortest-lived
     granular read/write token, CI-specific 2FA bypass for unattended
     publishing, hidden `gh secret set NPM_TOKEN` prompt, and immediate
     post-OIDC revocation. Never paste the token into chat or command
     arguments.
  4. `Publication` — create annotated `v0.2.0-beta.3` only at the verified main
     SHA after explicit approval; workflow publishes with
     `--access public --tag beta --provenance --ignore-scripts`.
  5. `Post-publication proof` — version, beta/latest dist-tags, provenance,
     exact tarball checksum, packed install/MCP smoke, GitHub prerelease.
  6. `OIDC migration and cleanup` — configure `mr-min-max/aidoc` +
     `release.yml`, remove the GitHub secret before the next intentionally
     versioned prerelease so fallback is impossible, verify OIDC-only
     publication, then revoke the npm token and restrict token access.
  7. `Failure handling` — stop before publish on any mismatch; never overwrite
     an immutable npm version; preserve evidence after partial success.

  Do not include a live token, npm account email, Gmail address, local absolute
  path, or claim that beta.3 has already been published.

- [ ] **Step 7: Run focused documentation checks and confirm GREEN**

  Run:

  ```bash
  npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
  npx prettier --check .github/ISSUE_TEMPLATE/config.yml .github/ISSUE_TEMPLATE/question.yml GOVERNANCE.md SUPPORT.md docs/RELEASING.md tests/unit/release/public-beta-config.test.ts
  git diff --check
  ```

  Expected: 0 failures, no stale Discussions/private-repository assertion, and
  no formatting error.

- [ ] **Step 8: Scan the Task 2 diff for unsafe content**

  Run:

  ```bash
  rg -n '[A-Za-z0-9._%+-]+@gmail\.com|npm_[A-Za-z0-9]+' GOVERNANCE.md SUPPORT.md docs/RELEASING.md .github/ISSUE_TEMPLATE tests/unit/release/public-beta-config.test.ts
  rg -n 'currently private|/discussions' GOVERNANCE.md SUPPORT.md docs/RELEASING.md .github/ISSUE_TEMPLATE
  ```

  Expected: both commands return no unsafe matches. The intentional word
  `token` is allowed; token-shaped values are not.

- [ ] **Step 9: Review and commit Task 2**

  ```bash
  git config --local --get user.email
  git add .github/ISSUE_TEMPLATE/config.yml .github/ISSUE_TEMPLATE/question.yml GOVERNANCE.md SUPPORT.md docs/RELEASING.md tests/unit/release/public-beta-config.test.ts
  git diff --cached --check
  git commit -m "docs(oss): align public release support"
  ```

  Expected email:
  `254284659+mr-min-max@users.noreply.github.com`.

---

### Task 3: Prove the complete candidate and open one reviewable pull request

**Files:**

- Verify only: all Task 1 and Task 2 paths
- The bounded release-candidate guard and its regression may be introduced in
  response to independent review; no product runtime path is introduced.

**Interfaces:**

- Consumes: the two implementation commits plus the approved design/plan.
- Produces: one remote branch and one ready-for-review pull request with hosted
  Node 22/24 evidence. It does not produce a tag, npm package, GitHub Release,
  merge, or settings change.

- [ ] **Step 1: Run all focused release tests**

  ```bash
  npm test -- tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts tests/unit/release/release-candidate.test.ts tests/unit/release/public-beta-config.test.ts --runInBand
  ```

  Expected: all suites and tests pass.

- [ ] **Step 2: Run static and formatting gates**

  ```bash
  npx tsc --noEmit
  npx eslint scripts/verify-release-candidate.mjs tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts tests/unit/release/release-candidate.test.ts tests/unit/release/public-beta-config.test.ts
  npx prettier --check .github/workflows/ci.yml .github/workflows/release.yml .github/ISSUE_TEMPLATE/config.yml .github/ISSUE_TEMPLATE/question.yml GOVERNANCE.md SUPPORT.md docs/RELEASING.md docs/superpowers/specs/2026-08-14-beta3-release-readiness-design.md docs/superpowers/plans/2026-08-14-beta3-release-readiness.md scripts/verify-release-candidate.mjs tests/unit/release/ci-workflow.test.ts tests/unit/release/workflow.test.ts tests/unit/release/release-candidate.test.ts tests/unit/release/public-beta-config.test.ts
  git diff --check origin/main...HEAD
  ```

  Expected: every command exits 0.

- [ ] **Step 3: Run the complete release evidence**

  Use a task-specific writable temporary npm cache so release verification
  never depends on the maintainer's user-level npm cache:

  ```bash
  release_npm_cache="$(mktemp -d)"
  NPM_CONFIG_CACHE="$release_npm_cache" npm run verify:release
  npm run build
  node dist/cli/index.js score --min 80
  NPM_CONFIG_CACHE="$release_npm_cache" npm run test:public-beta
  node scripts/public-beta-preflight.mjs --json --candidate-ref HEAD
  ```

  Expected: full Jest, provider contracts, build, demos, CLI, exact package,
  action, MCP, Codex plugin, hybrid beta, public-beta tests, score, and preflight
  all pass. If the already accepted historical private-path preflight remains
  the sole failure, record it exactly and do not rewrite history.

- [ ] **Step 4: Run final identity, scope, and publication-negative checks**

  ```bash
  git log origin/main..HEAD --format='%H%x09%an%x09%ae%x09%cn%x09%ce'
  git diff --name-only origin/main...HEAD
  git status --short
  git tag --points-at HEAD
  gh release list --repo mr-min-max/aidoc --limit 5
  gh repo view mr-min-max/aidoc --json visibility,hasIssuesEnabled,hasDiscussionsEnabled
  npm view aidoc-gen version --json
  ```

  Expected:

  - every candidate author/committer uses the GitHub noreply address;
  - only planned files changed;
  - worktree and index are clean after commits;
  - no release tag points at the candidate;
  - no GitHub Release exists for beta.3;
  - GitHub reports `PUBLIC`, Issues enabled, and Discussions disabled, matching
    `GOVERNANCE.md`, `SUPPORT.md`, and the issue chooser;
  - npm still reports `aidoc-gen` as unpublished before explicit release.

- [ ] **Step 5: Review the complete diff against the design**

  ```bash
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- .github/workflows .github/ISSUE_TEMPLATE GOVERNANCE.md SUPPORT.md docs/RELEASING.md scripts/verify-release-candidate.mjs tests/unit/release
  ```

  Confirm no package/lock/product-source change, no extra workflow permission,
  no hidden publication trigger, no raw secret, and no claim of successful npm
  publication.

- [ ] **Step 6: Push only the candidate branch**

  ```bash
  git push --set-upstream origin codex/beta3-release-readiness
  ```

  Do not push any tag and do not force-push.

- [ ] **Step 7: Open one ready pull request**

  ```bash
  release_pr_body=$'## Outcome\nPrepares provenance-backed beta publication without publishing.\n\n## Boundaries\nUpdates pinned Node 24 Actions, npm beta/provenance permissions, verified release assets, live support intake, and the maintainer runbook.\n\n## Evidence\nFocused release tests, full verify:release, score, public-beta preflight, and hosted Node 22/24 CI.\n\n## External state\nNO npm publish. NO tag. NO GitHub Release. The bootstrap token remains a later maintainer-only step.'
  gh pr create \
    --repo mr-min-max/aidoc \
    --base main \
    --head codex/beta3-release-readiness \
    --title "ci(release): prepare provenance-backed beta publication" \
    --body "$release_pr_body"
  ```

  The body must contain: outcome, exact changed boundaries, action versions,
  focused/full checks, explicit `NO npm publish / NO tag / NO GitHub Release`,
  and the later maintainer-only bootstrap step. Do not include a token, local
  absolute path, Gmail address, or unpublished package credentials.

- [ ] **Step 8: Wait for hosted CI and inspect annotations**

  ```bash
  gh pr checks --watch --fail-fast PR_NUMBER --repo mr-min-max/aidoc
  gh run view RUN_ID --repo mr-min-max/aidoc --json conclusion,jobs,url
  ```

  Expected: Node 22 and Node 24 both pass at the exact branch head. Confirm the
  old Node-20 action-runtime warning is absent. Do not merge the pull request.

- [ ] **Step 9: Report the release boundary to the maintainer**

  Provide the pull-request URL, exact head SHA, local/hosted check totals, and
  one plain-language statement: merging the PR still does not publish
  anything; npm bootstrap remains a later separately authorized operation.

---

## Plan Completion Contract

Implementation is complete only when Tasks 1–3 are checked, the branch has one
coherent ready pull request, hosted Node 22/24 CI is green, and no external
release side effect exists. Stop before merge, tag, npm publication, GitHub
Release, Discussions enablement, npm trusted-publisher configuration, token
creation, or repository-setting changes.
