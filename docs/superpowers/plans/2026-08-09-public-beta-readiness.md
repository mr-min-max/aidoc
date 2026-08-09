# Public Beta Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a privacy-audited, source-installable, contributor-friendly
public-beta candidate in the existing `mr-min-max/aidoc` repository without
publishing npm, creating a tag/release, contacting Support, or changing
repository visibility.

**Architecture:** Treat publication readiness as three testable artifacts: a
truthful public documentation surface, a deterministic value-safe Git preflight,
and an ignored private Support/audit packet. Keep GitHub community objects and
integration as a final external checkpoint after the tracked candidate is
reviewed and verified.

**Tech Stack:** Node.js 22.12+, TypeScript/Jest, Node test runner, ESM `.mjs`
scripts, `js-yaml`, Git, GitHub Actions, Dependabot, Gitleaks v8.30.1.

## Global Constraints

- Work only in
  `.worktrees/release-integrity` on
  `codex/release-integrity`.
- Preserve the existing repository and sanitized authentic history; never run
  another history rewrite, squash the historical commits, or force-push.
- The repository stays private. Do not contact GitHub Support, change
  visibility, create/push tags, create a GitHub Release, or publish npm.
- The deferred Support purge remains a hard blocker for eventual public
  visibility.
- Exact private email values and old object IDs never enter tracked files,
  commit messages, PR text, issues, test fixtures, or tool diagnostics.
- Repository-local Git identity remains
  `254284659+mr-min-max@users.noreply.github.com`; do not change global Git
  configuration.
- No new production dependencies. `js-yaml` is already available in the
  existing test toolchain.
- Documentation must not advertise `npx aidoc-gen` while the npm registry
  returns 404 for the package.
- Use TDD for every script/config behavior: RED, GREEN, refactor, focused
  verification, then a cohesive commit.
- Do not run online `npm audit` without separate maintainer authorization.
- Preserve the AST-first, provider-agnostic, template-driven architecture and
  do not put raw source, diffs, secrets, or hostile values in public reports.

---

## File Map

- `README.md` — canonical public-beta status, source installation, first run,
  accurate feature/security boundaries, and links.
- `docs/PUBLIC_BETA.md` — beta scope, supported paths, known limits, feedback,
  and release boundaries.
- `CHANGELOG.md` — factual unreleased `0.2.0-beta.2` changes.
- `ROADMAP.md` — current candidate/shipped/planned status without stale
  `v0.1.1` or ProofGraph claims.
- `docs/releases/v0.2.0-beta.2.md` — source-beta release-candidate notes.
- `docs/releases/v0.1.1.md` — remove the superseded unreleased draft from the
  current tree; history remains untouched.
- `docs/openai-codex-for-oss-application.md` — remove the private application
  worksheet from the current public tree; preserve a local ignored copy.
- `CONTRIBUTING.md`, `SUPPORT.md`, `SECURITY.md` — contributor setup, help
  routing, and private vulnerability reporting.
- `.github/ISSUE_TEMPLATE/*.yml`, `.github/PULL_REQUEST_TEMPLATE.md` — beta
  version and verification-aligned contribution intake.
- `.github/dependabot.yml` — bounded weekly npm and GitHub Actions updates.
- `.github/public-beta-policy.json` — non-secret canonical repository and
  protected maintainer identity policy consumed by the preflight.
- `scripts/public-beta-preflight.mjs` — deterministic Git/ref/content preflight
  with value-safe JSON and human output.
- `tests/unit/release/public-beta-config.test.ts` — executable GitHub YAML and
  private-ignore boundary tests; human prose is verified through its real
  fresh-clone workflow rather than source-text assertions.
- `tests/e2e/public-beta-preflight.test.mjs` — temporary-repository behavior
  tests for privacy and ancestry checks.
- `package.json` — `test:public-beta` and `verify:public-beta` scripts.
- `.gitignore` — ignore `.private/` publication material.
- `.private/public-beta-support.md` — untracked exact Support draft and audit
  ledger.
- `.private/public-beta-needles.txt` — untracked exact private values, one per
  line, consumed without echoing them.

---

### Task 1: Lock the truthful public-beta surface

**Files:**

- Create: `docs/PUBLIC_BETA.md`
- Create: `docs/releases/v0.2.0-beta.2.md`
- Create: `SUPPORT.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `ROADMAP.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Delete: `docs/releases/v0.1.1.md`
- Delete: `docs/openai-codex-for-oss-application.md`

**Interfaces:**

- Consumes: `package.json` fields `name`, `version`, and `engines.node`.
- Produces: one public status surface for candidate `0.2.0-beta.2`; later tasks
  use `docs/PUBLIC_BETA.md` as the canonical known limits link. Human prose is
  not unit-tested; the documented commands are executed from a fresh clone in
  Task 5.

- [ ] **Step 1: Implement the public-beta documentation**

Update the tracked surface with this content contract:

- Put a visible `Public Beta` block immediately below the README title. State
  that `plan` is provider-free, generation/update need a configured provider,
  Node `>=22.12.0` is required, behavior can evolve before v1, and feedback is
  welcome.
- Replace the first Quick Start with the tested source checkout:

```bash
git clone https://github.com/mr-min-max/aidoc.git
cd aidoc
npm ci
npm run build
node dist/cli/index.js plan
node dist/cli/index.js plan --json
```

- Remove every `npx aidoc-gen` and `npm install -g aidoc-gen` instruction from
  the current README. Use `node /absolute/path/to/aidoc/dist/cli/index.js --mcp`
  for the source-beta MCP example.
- Correct the feature description so `update` consumes the bounded semantic
  impact plan, not a raw Git diff.
- Label the Action ref examples as unavailable until a tag is deliberately
  published.
- Put the four non-blocking final-review limitations into
  `docs/PUBLIC_BETA.md`: full Git control-character rejection, working-tree
  display label, astral-Unicode Markdown masking, and SHA-256 empty-tree
  derivation. Also state that the planner cannot prove semantic correctness.
- Add `SUPPORT.md` routing usage questions to Discussions (once enabled), bugs
  to Issues, and vulnerabilities to private vulnerability reporting.
- Update `CHANGELOG.md` with the completed Trust Gate and Semantic
  Documentation Impact work under `[Unreleased]`.
- Make `ROADMAP.md` identify `0.2.0-beta.2` as the current source beta
  candidate and move implemented Trust Gate/impact planning out of planned
  sections.
- Add factual `docs/releases/v0.2.0-beta.2.md` notes with 46 suites / 452 tests,
  Node 22/24 CI, no npm publication, no tag, and the known limits.
- Delete the superseded `v0.1.1` draft and the current grant application
  worksheet from the tree. Before deletion, copy the worksheet verbatim to the
  ignored private area created in Task 4; if Task 4 has not run yet, preserve it
  in `/private/tmp/aidoc-oss-application.md` and move it during Task 4.
- Update issue/PR templates to ask for candidate version/commit, Node version,
  provider-free reproduction when possible, focused tests, and
  `npm run verify:release` evidence.

- [ ] **Step 2: Run formatting and the real local command examples**

Run:

```bash
npx prettier --check README.md CHANGELOG.md ROADMAP.md CONTRIBUTING.md \
  SECURITY.md SUPPORT.md docs/PUBLIC_BETA.md \
  docs/releases/v0.2.0-beta.2.md \
  .github/ISSUE_TEMPLATE/bug_report.yml \
  .github/ISSUE_TEMPLATE/feature_request.yml \
  .github/PULL_REQUEST_TEMPLATE.md
npm run build
node dist/cli/index.js plan
node dist/cli/index.js plan --json
git diff --check
```

Expected: PASS. Manually inspect the rendered Markdown headings/links; Task 5
pressure-tests the documented source checkout in a fresh clone.

- [ ] **Step 3: Commit the public surface**

```bash
git add README.md CHANGELOG.md ROADMAP.md CONTRIBUTING.md SECURITY.md \
  SUPPORT.md docs/PUBLIC_BETA.md docs/releases \
  docs/openai-codex-for-oss-application.md .github/ISSUE_TEMPLATE \
  .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs(beta): publish honest source onboarding"
```

---

### Task 2: Build a value-safe, repeatable publication preflight

**Files:**

- Create: `.github/public-beta-policy.json`
- Create: `scripts/public-beta-preflight.mjs`
- Create: `tests/e2e/public-beta-preflight.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes policy schema `aidoc.public-beta-policy.v1`:

```json
{
  "schemaVersion": "aidoc.public-beta-policy.v1",
  "canonicalRepository": "mr-min-max/aidoc",
  "defaultBranch": "main",
  "candidateBranch": "codex/release-integrity",
  "protectedIdentities": [
    {
      "name": "mr-min-max",
      "emails": ["254284659+mr-min-max@users.noreply.github.com"]
    }
  ],
  "allowedAutomationEmails": ["noreply@anthropic.com"]
}
```

- Produces:

```js
runPreflight({
  repositoryRoot,
  policyPath,
  privateNeedlesPath,
  mainRef,
  candidateRef,
}) => Promise<{
  schemaVersion: "aidoc.public-beta-preflight.v1",
  status: "pass" | "fail",
  checks: Array<{
    id: string,
    status: "pass" | "fail",
    summary: string
  }>,
  counts: {
    refs: number,
    commits: number,
    protectedIdentityCommits: number,
    privateNeedles: number
  }
}>
```

No report field may contain an observed email, private needle, absolute path,
Git stderr, blob contents, or commit message.

- [ ] **Step 1: Write failing preflight behavior tests**

Create `tests/e2e/public-beta-preflight.test.mjs` using `node:test`, temporary
Git repositories, and injected policy/needle files. Include these cases:

```js
test("fails a protected identity using an unapproved email without echoing it");
test("passes the protected identity after rewriting it to the approved noreply");
test("fails when main is not an ancestor of the candidate");
test("finds a private needle in reachable metadata or blobs without echoing it");
test("ignores unreachable objects and scans every retained branch and tag");
test("emits deterministic schema-valid JSON with fixed diagnostic text");
```

Use dummy values such as `private-person@example.invalid`; never embed the
maintainer's real private email or old object IDs in tests.

- [ ] **Step 2: Run tests and capture RED**

Run:

```bash
node --test tests/e2e/public-beta-preflight.test.mjs
```

Expected: FAIL with module-not-found for
`scripts/public-beta-preflight.mjs`.

- [ ] **Step 3: Implement policy validation and Git adapters**

Implement `scripts/public-beta-preflight.mjs` with only Node built-ins:

- validate the exact policy schema and reject unknown/malformed values;
- use `execFile`/`spawn` argument arrays for Git, never shell interpolation;
- enumerate retained `refs/heads`, `refs/remotes/origin`, and `refs/tags`;
- deduplicate commits reachable from those refs;
- inspect author and committer name/email fields as NUL-delimited records;
- require each protected identity email to match its policy allowlist;
- check `merge-base --is-ancestor mainRef candidateRef`;
- load optional private needles from an absolute ignored file, reject empty or
  newline-containing entries, scan reachable commit metadata and blobs, and
  report only the number of matched needles;
- exclude unreachable objects by deriving blobs from the retained refs rather
  than `git fsck` or the object directory;
- map all Git/process errors to fixed safe check summaries;
- sort refs, commit IDs, and check IDs before counting/output;
- make `--json` write only JSON to stdout and human output concise;
- exit 0 only when every check passes, 1 for an authentic failed check, and 2
  for malformed invocation/policy.

- [ ] **Step 4: Add package scripts without new dependencies**

Add:

```json
{
  "scripts": {
    "test:public-beta": "node --test tests/e2e/public-beta-preflight.test.mjs && jest tests/unit/release/public-beta-config.test.ts --runInBand",
    "verify:public-beta": "npm run verify:release && npm run test:public-beta && node scripts/public-beta-preflight.mjs --json"
  }
}
```

Update the lockfile root scripts/metadata mechanically through `npm install
--package-lock-only --ignore-scripts` only if npm changes it; no dependency
version changes belong to this task.

- [ ] **Step 5: Run GREEN, safety probes, and existing release tests**

Run:

```bash
node --test tests/e2e/public-beta-preflight.test.mjs
npx jest tests/unit/release/public-beta-config.test.ts --runInBand
npm run build
npm run lint
node scripts/public-beta-preflight.mjs --json
git diff --check
```

Expected: all PASS; JSON contains no email address or absolute path.

- [ ] **Step 6: Commit the preflight**

```bash
git add .github/public-beta-policy.json scripts/public-beta-preflight.mjs \
  tests/e2e/public-beta-preflight.test.mjs package.json package-lock.json
git commit -m "feat(beta): add privacy-safe publication preflight"
```

---

### Task 3: Add low-noise dependency and community readiness

**Files:**

- Create: `.github/dependabot.yml`
- Create: `tests/unit/release/public-beta-config.test.ts`
- Modify: `docs/PUBLIC_BETA.md`

**Interfaces:**

- Consumes: existing `js-yaml` test dependency and standard GitHub labels.
- Produces: two weekly Dependabot update streams and six exact starter issues
  ready in the private repository for eventual public visibility.

- [ ] **Step 1: Add failing Dependabot behavior contract tests**

Create `tests/unit/release/public-beta-config.test.ts`. Parse the file through
the same YAML library used by the workflow tests and assert the schedule the
GitHub consumer receives:

```ts
import * as fs from "fs";
import * as path from "path";

const { load } = require("js-yaml") as { load(source: string): unknown };

const read = (file: string): string =>
  fs.readFileSync(path.resolve(file), "utf8");

it("bounds weekly npm and Actions dependency updates", () => {
  const dependabot = load(read(".github/dependabot.yml")) as {
    version: number;
    updates: Array<{
      "package-ecosystem": string;
      schedule: { interval: string };
      "open-pull-requests-limit": number;
    }>;
  };
  expect(dependabot.version).toBe(2);
  expect(dependabot.updates.map((item) => item["package-ecosystem"]).sort())
    .toEqual(["github-actions", "npm"]);
  for (const update of dependabot.updates) {
    expect(update.schedule.interval).toBe("weekly");
    expect(update["open-pull-requests-limit"]).toBeLessThanOrEqual(5);
  }
});
```

- [ ] **Step 2: Run focused RED**

Run:

```bash
npx jest tests/unit/release/public-beta-config.test.ts --runInBand
```

Expected: FAIL because `.github/dependabot.yml` does not exist.

- [ ] **Step 3: Add bounded Dependabot configuration**

Create version-2 config with:

- npm ecosystem at `/`, Mondays 09:00 Europe/Kiev, maximum five open PRs,
  `dependencies` label, and grouped minor/patch production updates;
- GitHub Actions ecosystem at `/`, Mondays 09:15 Europe/Kiev, maximum three
  open PRs, `dependencies` label;
- no automatic major-version grouping;
- no registry credentials or secrets.

Document in `docs/PUBLIC_BETA.md` that dependency PRs still require the same CI
and review gates as human PRs.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
npx jest tests/unit/release/public-beta-config.test.ts --runInBand
npx prettier --check .github/dependabot.yml docs/PUBLIC_BETA.md
git diff --check
```

Then commit:

```bash
git add .github/dependabot.yml docs/PUBLIC_BETA.md \
  tests/unit/release/public-beta-config.test.ts
git commit -m "chore(beta): prepare dependency maintenance"
```

- [ ] **Step 5: Create accurate GitHub labels**

After the tracked candidate is pushed, use GitHub label APIs to create only
missing labels:

- `triage` — `fbca04` — “Needs maintainer triage”
- `dependencies` — `0366d6` — “Dependency updates”
- `area: cli` — `5319e7` — “CLI and terminal output”
- `area: git` — `5319e7` — “Git snapshots and revision handling”
- `area: docs` — `0075ca` — “Documentation and onboarding”
- `area: security` — `d73a4a` — “Security boundaries and hardening”

Do not duplicate existing standard labels.

- [ ] **Step 6: Create six real starter issues**

Search for duplicates first, then create these exact issues in the still-private
repository. Each body must link `docs/PUBLIC_BETA.md`, describe current
behavior, list acceptance criteria, name focused tests, and say that a PR must
run `npm run verify:release`.

1. `Display working-tree explicitly in aidoc plan output`
   - Labels: `good first issue`, `area: cli`
   - Acceptance: human output says `working-tree`; JSON keeps the existing
     working-tree discriminator; focused output tests cover both paths.
2. `Reject every Git control character in revision inputs`
   - Labels: `help wanted`, `area: git`, `area: security`
   - Acceptance: reject all C0/DEL control characters before Git execution,
     retain fixed safe diagnostics, add adversarial tests.
3. `Make Markdown inline-code masking astral-Unicode safe`
   - Labels: `help wanted`, `area: docs`
   - Acceptance: one offset model, emoji-before-span regression, no changed
     behavior for BMP input.
4. `Derive the empty-tree object for SHA-256 Git repositories`
   - Labels: `help wanted`, `area: git`
   - Acceptance: detect object format, derive correct empty tree, test SHA-1
     and SHA-256 where supported, fixed error where unsupported.
5. `Add Windows source-beta setup troubleshooting`
   - Labels: `good first issue`, `documentation`, `area: docs`
   - Acceptance: verified PowerShell source install/build/plan steps, Node
     version check, no npm-registry claim.
6. `Add a provider-free public-beta demo recording guide`
   - Labels: `good first issue`, `documentation`, `area: docs`
   - Acceptance: reproducible `npm run demo:impact` capture steps, no keys or
     local paths in output, README link ready for a future GIF/video.

Do not enable Discussions yet; its link becomes live only in the final
visibility stage after Support clearance.

---

### Task 4: Produce the ignored private audit and Support packet

**Files:**

- Modify: `.gitignore`
- Create ignored: `.private/public-beta-support.md`
- Create ignored: `.private/public-beta-needles.txt`
- Create ignored: `.private/gitleaks-8.30.1/` extracted verified binary
- Modify: `tests/unit/release/public-beta-config.test.ts`

**Interfaces:**

- Consumes: `AIDOC_PRIVATE_NEEDLES_FILE` or CLI
  `--private-needles-file`; Gitleaks v8.30.1 Darwin arm64 artifact checksum
  `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`.
- Produces: an untracked audit ledger and ready-to-copy Support request. No
  network message is sent.

- [ ] **Step 1: Add a failing executable ignore-boundary test**

Append:

```ts
import { execFileSync } from "child_process";

it("keeps private publication material outside tracked Git", () => {
  expect(() =>
    execFileSync("git", ["check-ignore", "-q", ".private/probe"], {
      cwd: path.resolve("."),
      stdio: "pipe",
    }),
  ).not.toThrow();
});
```

Run the focused Jest test and capture FAIL.

- [ ] **Step 2: Ignore the private publication area and get GREEN**

Add exactly `.private/` to `.gitignore`, rerun the test, then commit only the
ignore/test change:

```bash
git add .gitignore tests/unit/release/public-beta-config.test.ts
git commit -m "chore(beta): isolate private publication evidence"
```

- [ ] **Step 3: Create the private needle and Support files**

Create `.private/public-beta-needles.txt` with the exact private email and any
other maintainer-only identifiers, one literal per line. Create
`.private/public-beta-support.md` containing:

- exact repository owner/name;
- affected closed pull request number and affected count `1`;
- first changed old/new commit IDs from the prior email rewrite;
- exact old pull request base/head IDs;
- current cleaned branch/ref inventory;
- explicit request for PR dereference/deletion, cached-view removal,
  server-side garbage collection, and confirmation;
- a note that submission is intentionally deferred;
- a result ledger for every command in Tasks 4–5.

Copy the removed OSS application worksheet into `.private/` for maintainer use.
Verify `git status --short --ignored` reports these files as ignored and never
stage them.

- [ ] **Step 4: Download and checksum Gitleaks v8.30.1 outside tracked files**

Download official artifacts only:

```bash
curl --fail --location --proto '=https' --tlsv1.2 \
  --output .private/gitleaks_8.30.1_darwin_arm64.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_arm64.tar.gz
printf '%s  %s\n' \
  b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 \
  .private/gitleaks_8.30.1_darwin_arm64.tar.gz | shasum -a 256 --check
mkdir -p .private/gitleaks-8.30.1
tar -xzf .private/gitleaks_8.30.1_darwin_arm64.tar.gz \
  -C .private/gitleaks-8.30.1 gitleaks
```

Network approval is required for the download. Do not install it globally.

- [ ] **Step 5: Run independent history/worktree secret scans**

Run:

```bash
.private/gitleaks-8.30.1/gitleaks git --redact --no-banner \
  --report-format json --report-path .private/gitleaks-history.json .
.private/gitleaks-8.30.1/gitleaks dir --redact --no-banner \
  --report-format json --report-path .private/gitleaks-working-tree.json .
node scripts/public-beta-preflight.mjs --json \
  --private-needles-file .private/public-beta-needles.txt \
  > .private/public-beta-preflight.json
```

Expected: zero Gitleaks findings and preflight status `pass`. If Gitleaks finds
test/documentation fixtures, investigate each exact finding; fix authentic
secrets and record narrow false-positive rationale without committing secret
values or broad allowlists.

- [ ] **Step 6: Audit GitHub-retained surfaces read-only**

Inventory via GitHub APIs:

- current visibility, branches, tags, releases, forks, collaborators;
- all pull requests and their base/head commits;
- all Actions runs, jobs, downloadable logs, and artifacts;
- confirm old pre-rewrite workflow runs were deleted;
- confirm each retained run belongs to sanitized commits and its logs contain
  no private needles or credential material.

Record safe counts/results in the private Support packet. Do not delete runs,
branches, artifacts, or PR data in this task; list exact proposed deletions for
the final external checkpoint.

---

### Task 5: Final review, verification, push, and private integration

**Files:**

- Modify only files required by verified review findings.
- Update ignored: `.private/public-beta-support.md`

**Interfaces:**

- Consumes: all tracked commits from Tasks 1–4 and private scan evidence.
- Produces: a synchronized private `main` containing the reviewed public-beta
  candidate, six starter issues, green hosted CI, and no visibility/release
  side effects.

- [ ] **Step 1: Run an independent whole-candidate review**

Review the range `27b334e..HEAD` against the design and plan with these scopes:

- privacy/history and value-safe diagnostics;
- truthful install/onboarding and public claims;
- Git command safety and cross-platform behavior;
- Dependabot/workflow permissions and supply-chain pinning;
- no tracked private identifiers;
- no accidental npm/tag/release/public operations.

Classify Critical/Important/Minor. Fix Critical/Important findings through
`receiving-code-review` and TDD, then obtain scoped re-review. Ledger remaining
Minors explicitly.

- [ ] **Step 2: Run the complete local gate**

Run in order:

```bash
npm run verify:release
npm run test:public-beta
AIDOC_PRIVATE_NEEDLES_FILE=.private/public-beta-needles.txt \
  node scripts/public-beta-preflight.mjs --json
node dist/cli/index.js score --min 80 --json
node dist/cli/index.js plan
node dist/cli/index.js plan --json
git diff --check
git status --short
```

Also create a fresh temporary source clone from the candidate, run the exact
README source Quick Start, and verify `plan` human/JSON paths need no provider
or API key. Run packed-package CLI/MCP smoke through `npm run verify:release`.

Expected: 46/46 suites, 452/452 or a higher deliberate count, all smoke tests
PASS, documentation score at least 80, preflight PASS, no raw private values,
and clean status.

- [ ] **Step 3: Push the candidate and require hosted CI**

Push `codex/release-integrity` without force. Wait for Node 22 and Node 24 jobs
at the exact HEAD. If either fails, diagnose through `systematic-debugging`, fix
with TDD, rerun local gates, push the new normal commit, and wait again.

- [ ] **Step 4: Update pull request #2 for the source beta**

Update the existing PR body with:

- Public Beta positioning and source-install command;
- privacy-preflight scope and explicit Support/visibility blocker;
- exact local and hosted verification results;
- Gitleaks version/checksum/result without private values;
- remaining non-blocking limitations;
- explicit “no npm publish, tag, GitHub Release, Support submission, or
  visibility change.”

Mark it ready only after checks and independent review pass.

- [ ] **Step 5: Integrate without rewriting authentic history**

Confirm immediately before integration:

```bash
git merge-base --is-ancestor origin/main origin/codex/release-integrity
git rev-list --count origin/main..origin/codex/release-integrity
git status --short
```

Fast-forward `main` to the exact candidate commit using a normal non-force push
or GitHub's equivalent history-preserving merge. Never squash or force-push.
Confirm PR #2 is recorded as merged/closed and remote `main` equals the reviewed
candidate tree.

- [ ] **Step 6: Require post-integration CI and rerun publication audit**

Wait for the `push` CI run on `main`; require Node 22/24 success. From a fresh
authenticated clone of remote `main`, rerun:

```bash
npm ci
npm run build
node dist/cli/index.js plan
node dist/cli/index.js plan --json
node scripts/public-beta-preflight.mjs --json
```

Update the private ledger with exact SHAs, test counts, workflow URLs, branch
parity, issue URLs, review verdict, and blockers.

- [ ] **Step 7: Stop at the external publication gate**

Final state must be:

- repository still private;
- Support request ready but not submitted;
- legacy PR cache still explicitly blocks visibility;
- no tags/releases/npm publications created;
- Discussions still disabled;
- default `main` contains the verified source-beta candidate;
- private packet states the next safe sequence: submit Support request, receive
  purge confirmation, rerun server inventory, confirm visibility with the
  maintainer, then enable public/Discussions/security settings and verify an
  unauthenticated clone.

## Plan Self-Review

- **Spec coverage:** All design layers map to Tasks 1–5: public truthfulness,
  deterministic preflight, private Support evidence, dependency/community
  readiness, independent review, exact verification, integration, and the
  deferred visibility gate.
- **Placeholder-token scan:** The plan contains no unresolved markers, generic
  “add tests,” or unspecified production behavior. GitHub issue bodies have
  exact titles, labels, and acceptance criteria.
- **Type consistency:** Policy schema
  `aidoc.public-beta-policy.v1`, report schema
  `aidoc.public-beta-preflight.v1`, and `runPreflight` argument/result names are
  identical in Task 2 tests, implementation, package commands, and Task 5.
- **Privacy consistency:** Exact old emails/object IDs exist only in ignored
  Task 4 artifacts. Tracked policy contains only the public GitHub noreply
  identity. Diagnostics are count/fixed-text only.
- **External-state consistency:** The plan authorizes normal candidate/main
  pushes and issue/label creation needed for preparation, but stops before
  Support submission, tag, release, npm publication, Discussions enablement,
  and visibility change.
