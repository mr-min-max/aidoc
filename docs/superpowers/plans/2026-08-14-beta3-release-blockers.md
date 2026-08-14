# Beta.3 Release Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two accepted beta.3 blockers and prove the actual packed
candidate is ready for an explicitly authorized public-beta release without
publishing anything.

**Architecture:** Keep issue #3 at the human-presentation boundary so canonical
plan JSON remains unchanged. Keep issue #4 at the Git snapshot input boundary,
validating caller and environment refs before repository discovery and again
before resolution. Use the existing release-integrity scripts for the final
tarball, MCP, plugin, privacy, and source-artifact evidence.

**Tech Stack:** Node.js `>=22.12.0`, TypeScript, Jest, Git, npm package scripts,
Node ESM smoke tests, GitHub Actions.

## Global Constraints

- Work only in `.worktrees/beta3-release-blockers` on
  `codex/beta3-release-blockers`, based on remote `main` commit
  `d866b9f1d95c14318f30135964632012c296dc05`.
- Preserve `aidoc.impact-plan.v1` plan objects and canonical JSON bytes.
- Preserve fixed value-safe planning diagnostics; never echo hostile refs, Git
  stderr, credentials, or absolute local paths.
- Use real `GitSnapshotReader` and formatter behavior in tests; do not assert
  on a mock.
- Use one RED→GREEN cycle per issue and do not bundle unrelated refactors.
- Add no dependencies and do not merge Dependabot pull requests.
- Make no live or paid provider call.
- Do not create or push a tag, publish npm, create a GitHub Release, merge the
  candidate, or alter branch protection.
- Use the GitHub noreply identity already configured for the repository.

---

## File Map

- `src/output/impact.ts` — human snapshot presentation only.
- `tests/unit/output/impact.test.ts` — working-tree and immutable human-output
  regressions plus unchanged canonical JSON evidence.
- `src/git/snapshot.ts` — early and defense-in-depth Git ref validation.
- `tests/unit/git/snapshot.test.ts` — complete C0/DEL and pre-Git ordering
  regressions through the real reader.
- `CHANGELOG.md` — concise user-facing record of both beta fixes.
- `docs/releases/v0.2.0-beta.3.md` — forthcoming beta.3 inclusion record.
- Existing `scripts/public-beta-preflight.mjs`, `tests/e2e/*`, and package
  scripts — unchanged release-rehearsal machinery.

---

### Task 1: Prepare and verify the isolated baseline

**Files:**

- Inspect only: `package.json`, `package-lock.json`, `.gitignore`
- No tracked modifications.

**Interfaces:**

- Consumes: existing lockfile and writable populated npm cache.
- Produces: a clean Node dependency tree and a known-green pre-change test
  baseline.

- [ ] **Step 1: Confirm branch, base, cleanliness, and identity**

Run:

```bash
git branch --show-current
git merge-base --is-ancestor d866b9f1d95c14318f30135964632012c296dc05 HEAD
git status --short
git config --get user.email
```

Expected: branch `codex/beta3-release-blockers`, ancestor command exit `0`,
clean status, and
`254284659+mr-min-max@users.noreply.github.com`.

- [ ] **Step 2: Install exactly the locked dependency graph**

First check whether the known writable populated cache exists:

```bash
test -d /private/tmp/aidoc-cache-full-UNOlh9
```

When present, run:

```bash
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 \
NPM_CONFIG_OFFLINE=true npm ci
```

If it is absent, run `npm ci` with a newly created writable cache after the
required network approval. Do not modify `package.json` or `package-lock.json`.

- [ ] **Step 3: Run the pre-change baseline**

Run:

```bash
npm test -- --runInBand
npx tsc --noEmit
git status --short
```

Expected: all existing suites pass, TypeScript exits `0`, and only the already
committed design/plan history differs from `main`.

---

### Task 2: Render working-tree comparisons truthfully

**Files:**

- Modify: `tests/unit/output/impact.test.ts:90-98,236-245`
- Modify: `src/output/impact.ts:91-95`

**Interfaces:**

- Consumes: `SnapshotDescriptor.type`, `.label`, and optional `.commit`.
- Produces: `formatImpactPlan(plan, true)` output with
  `Head: working-tree` for working-tree descriptors while
  `serializePlanCommandResult()` remains unchanged.

- [ ] **Step 1: Write the failing human-output regression**

Replace the existing verbose test with:

```ts
// Break caught: a working-tree descriptor displays its anchor label as though
// it were an immutable head instead of naming the current working tree.
it("renders working-tree and immutable snapshot labels truthfully", () => {
  const workingTreePlan = plan({
    head: { type: "working-tree", label: "HEAD" },
  });
  const workingOutput = formatImpactPlan(workingTreePlan, true);

  expect(workingOutput).toContain(`Base: main (${"a".repeat(40)})`);
  expect(workingOutput).toContain("Head: working-tree");
  expect(workingOutput).not.toContain("Head: HEAD");

  const immutableOutput = formatImpactPlan(
    plan({
      head: { type: "git", label: "release-candidate", commit: "d".repeat(40) },
    }),
    true,
  );
  expect(immutableOutput).toContain(
    `Head: release-candidate (${"d".repeat(40)})`,
  );
});
```

In the canonical serialization test, construct one named value with the
working-tree anchor label and compare against that exact object:

```ts
const workingTreePlan = plan({
  head: { type: "working-tree", label: "HEAD" },
});
const value = serializePlanCommandResult({
  ok: true,
  plan: workingTreePlan,
});

expect(JSON.parse(value)).toEqual({ ok: true, plan: workingTreePlan });
expect(JSON.parse(value).plan.head).toEqual({
  type: "working-tree",
  label: "HEAD",
});
```

- [ ] **Step 2: Run RED and verify the expected failure**

Run:

```bash
npm test -- tests/unit/output/impact.test.ts --runInBand
```

Expected: FAIL because output contains `Head: HEAD` and lacks
`Head: working-tree`. The canonical JSON assertions must already pass.

- [ ] **Step 3: Implement the minimal presentation fix**

Change only `formatSnapshot()`:

```ts
function formatSnapshot(snapshot: SnapshotDescriptor): string {
  if (snapshot.type === "working-tree") return "working-tree";
  return snapshot.commit === undefined
    ? snapshot.label
    : `${snapshot.label} (${snapshot.commit})`;
}
```

- [ ] **Step 4: Run GREEN and focused compatibility coverage**

Run:

```bash
npm test -- tests/unit/output/impact.test.ts tests/unit/impact/planner.test.ts \
  tests/unit/cli/plan.test.ts --runInBand
npx tsc --noEmit
npx eslint src/output/impact.ts tests/unit/output/impact.test.ts
npx prettier --check src/output/impact.ts tests/unit/output/impact.test.ts
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 5: Commit issue #3**

```bash
git add src/output/impact.ts tests/unit/output/impact.test.ts
git commit -m "fix(plan): label working-tree output truthfully"
```

---

### Task 3: Reject the full C0/DEL Git ref set before Git execution

**Files:**

- Modify: `tests/unit/git/snapshot.test.ts:1-109`
- Modify: `src/git/snapshot.ts:140-160,279-291`

**Interfaces:**

- Consumes: explicit `base`, explicit `head`, and `AIDOC_BASE_REF`.
- Produces: authentic `PlanFailure` payload
  `{ code: "PLAN_INVALID_REF", message: "The Git reference is invalid." }`
  before repository discovery for all issue-defined controls.

- [ ] **Step 1: Write the failing complete boundary regression**

Add a new direct import and define the literal test code points near the
helpers:

```ts
import { PlanFailure } from "../../../src/impact/types";
```

```ts
const INVALID_REF_CODE_POINTS = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
  0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
  0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x7f,
] as const;

const INVALID_REF_SOURCES = ["head", "base", "environment"] as const;
```

Replace the current unsafe-ref test with a retained leading-hyphen assertion
and this table-driven real-reader regression:

```ts
test.each(
  INVALID_REF_SOURCES.flatMap((source) =>
    INVALID_REF_CODE_POINTS.map((codePoint) => ({ source, codePoint })),
  ),
)(
  "rejects $source control code point $codePoint before repository discovery",
  async ({ source, codePoint }) => {
    const fixture = mkdtempSync(join(tmpdir(), "aidoc-invalid-ref-"));
    const missingRepository = join(fixture, "missing");
    const hostileRef = `valid${String.fromCodePoint(codePoint)}tail`;
    const options = {
      include: [],
      exclude: [],
      ...(source === "head" ? { head: hostileRef } : {}),
      ...(source === "base" ? { base: hostileRef } : {}),
    };
    const environment = {
      ...process.env,
      ...(source === "environment" ? { AIDOC_BASE_REF: hostileRef } : {}),
    };

    const error = await new GitSnapshotReader(missingRepository, environment)
      .read(options)
      .catch((value: unknown) => value);

    expect(PlanFailure.read(error)).toEqual({
      code: "PLAN_INVALID_REF",
      message: "The Git reference is invalid.",
    });
    expect(String(error)).not.toContain(hostileRef);
  },
);
```

Keep the real-repository `base: "-bad"` case and the missing-repository case
for valid default refs as separate tests.

- [ ] **Step 2: Run RED and verify the ordering failure**

Run:

```bash
npm test -- tests/unit/git/snapshot.test.ts --runInBand
```

Expected: the new table cases fail with `PLAN_NOT_GIT_REPOSITORY` because the
current reader invokes Git root discovery before complete ref validation.

- [ ] **Step 3: Implement early and defense-in-depth validation**

At the beginning of `read()` derive and validate supplied values before
`gitRoot()`:

```ts
const headLabel = options.head ?? "HEAD";
this.validateRef(headLabel);
let baseLabel = options.base ?? this.env.AIDOC_BASE_REF;
if (baseLabel !== undefined && baseLabel.length > 0) {
  this.validateRef(baseLabel);
}
const root = await this.gitRoot();
this.repositoryRoot = root;
const headCommit = await this.resolveCommit(headLabel, "PLAN_HEAD_NOT_FOUND");
if (!baseLabel) baseLabel = await this.discoverBase(headCommit);
```

Replace the incomplete predicate inside `validateRef()`:

```ts
const code = char.codePointAt(0) ?? 0;
return code <= 0x1f || code === 0x7f;
```

Keep the existing validation calls inside `resolveCommit()` and
`resolveBase()`.

- [ ] **Step 4: Run GREEN and Git-boundary compatibility coverage**

Run:

```bash
npm test -- tests/unit/git/snapshot.test.ts tests/unit/impact/planner.test.ts \
  tests/unit/mcp/scoped-freshness.test.ts --runInBand
npx tsc --noEmit
npx eslint src/git/snapshot.ts tests/unit/git/snapshot.test.ts
npx prettier --check src/git/snapshot.ts tests/unit/git/snapshot.test.ts
git diff --check
```

Expected: all table cases and existing valid-ref/snapshot paths pass.

- [ ] **Step 5: Commit issue #4**

```bash
git add src/git/snapshot.ts tests/unit/git/snapshot.test.ts
git commit -m "fix(git): reject control characters before ref resolution"
```

---

### Task 4: Record the completed beta fixes truthfully

**Files:**

- Modify: `CHANGELOG.md:5-19`
- Modify: `docs/releases/v0.2.0-beta.3.md:7-28`

**Interfaces:**

- Consumes: verified Task 2 and Task 3 behavior.
- Produces: human release notes without changing package/version claims.

- [ ] **Step 1: Add the exact changelog entries**

Under `## [Unreleased]` → `### Fixed`, add:

```markdown
- Label working-tree comparisons truthfully in verbose human plan output while
  preserving the versioned JSON descriptor.
- Reject every C0 control character and DEL in Git revision inputs before Git
  execution.
```

Under `docs/releases/v0.2.0-beta.3.md` → `## Included`, add equivalent concise
bullets without changing the `Forthcoming`/source-checkout status.

- [ ] **Step 2: Verify documentation and release claims**

Run:

```bash
npx prettier --check CHANGELOG.md docs/releases/v0.2.0-beta.3.md
npm test -- tests/unit/release/public-beta-config.test.ts --runInBand
git diff --check
```

Expected: all commands exit `0`; no text claims npm, tag, GitHub Release, or
marketplace publication.

- [ ] **Step 3: Commit the release notes**

```bash
git add CHANGELOG.md docs/releases/v0.2.0-beta.3.md
git commit -m "docs(beta): record release-blocker fixes"
```

---

### Task 5: Execute the complete local release rehearsal

**Files:**

- No intended tracked modifications.
- Temporary artifacts only under `/private/tmp/aidoc-beta3-*`.

**Interfaces:**

- Consumes: exact candidate `HEAD`, existing release/package/MCP/plugin scripts.
- Produces: command evidence and one actual local tarball; no registry or
  GitHub release side effect.

- [ ] **Step 1: Run the complete repository gate**

Run with the writable populated cache:

```bash
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 \
NPM_CONFIG_OFFLINE=true npm run verify:public-beta
```

Expected: lint, full Jest, provider contracts, build, demos, CLI, action,
package, MCP, plugin, hybrid-beta, public-beta tests, and preflight all pass.

- [ ] **Step 2: Require the documentation score and clean diff gates**

```bash
node dist/cli/index.js score --min 80 --json
npx tsc --noEmit
git diff --check
git status --short
```

Expected: score at least `80`, TypeScript/diff checks exit `0`, and status is
clean.

- [ ] **Step 3: Build one actual tarball and inspect its manifest**

Create a temporary pack directory and run:

```bash
AIDOC_PACK_DIR=$(mktemp -d /private/tmp/aidoc-beta3-pack.XXXXXX)
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 \
NPM_CONFIG_OFFLINE=true npm pack --pack-destination "$AIDOC_PACK_DIR" --json
```

Record the one `.tgz` absolute path from the JSON result, then inspect it:

```bash
tar -tzf "$AIDOC_TARBALL"
```

Required package roots are `package/package.json`, `package/README.md`,
`package/LICENSE`, and `package/dist/**`. Reject `.git`, `.github`, `.private`,
tests, coverage, caches, environment files, editor state, or unexpected source
files.

- [ ] **Step 4: Scan extracted artifact content**

Extract only into a new `/private/tmp/aidoc-beta3-unpack.*` directory. Search
regular files for:

- the maintainer's private Gmail value held outside tracked files;
- `/Users/`, `/home/`, Windows user-profile prefixes, and the source checkout
  absolute path;
- PEM private-key headers and common API credential prefixes;
- `.env`, `.private`, Git metadata, coverage, and cache filenames.

Expected: no private value, secret, absolute local path, or unexpected file.
Source maps are allowed only when their `sources` entries remain package-relative
and contain no local absolute path.

- [ ] **Step 5: Exercise the exact tarball through existing consumer smokes**

Run:

```bash
AIDOC_TEST_TARBALL="$AIDOC_TARBALL" \
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 \
NPM_CONFIG_OFFLINE=true npm run test:package

AIDOC_TEST_TARBALL="$AIDOC_TARBALL" \
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 \
NPM_CONFIG_OFFLINE=true npm run test:mcp

npm run test:codex-plugin
npm run test:hybrid-beta
```

Expected: actual packed CLI/package, built/packed MCP, Codex integration, and
hybrid evidence all pass without a provider credential or network call.

- [ ] **Step 6: Run the official local plugin validator**

Use the official `validate_plugin.py` from the active Codex `plugin-creator`
skill with an environment-owned Python runtime that provides PyYAML. Validate
`integrations/codex/aidoc` and keep machine-local runtime/cache paths outside
tracked files.

Expected: `Plugin validation passed.`

---

### Task 6: Review, publish the candidate branch, and obtain hosted evidence

**Files:**

- Modify only if review finds a demonstrated blocker, using a new RED→GREEN
  cycle.
- No version, tag, registry, or release metadata mutation.

**Interfaces:**

- Consumes: all Task 1–5 commits and evidence.
- Produces: a normal pushed branch, one reviewable pull request, hosted Node
  22/24 results, and a final GO/NO-GO recommendation.

- [ ] **Step 1: Review the complete candidate against the design**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git log --format='%h %an <%ae> %cn <%ce> %s' main..HEAD
git status --short
```

Inspect every changed line for scope, JSON compatibility, ref ordering,
value-safe diagnostics, exact tests, truthful release claims, and accidental
publication behavior.

- [ ] **Step 2: Run a final fresh focused and full verification**

```bash
npm test -- tests/unit/output/impact.test.ts tests/unit/git/snapshot.test.ts \
  tests/unit/impact/planner.test.ts --runInBand
NPM_CONFIG_CACHE=/private/tmp/aidoc-cache-full-UNOlh9 \
NPM_CONFIG_OFFLINE=true npm run verify:public-beta
git diff --check
git status --short
```

Expected: all commands pass and the worktree is clean.

- [ ] **Step 3: Push normally and create the pull request**

```bash
git push -u origin codex/beta3-release-blockers
gh pr create --repo mr-min-max/aidoc --base main \
  --head codex/beta3-release-blockers \
  --title "fix(beta): close release blockers before beta.3" \
  --body-file /private/tmp/aidoc-beta3-pr-body.md
```

The PR body must contain:

- `Closes #3` and `Closes #4`;
- root causes and compatibility boundaries;
- RED→GREEN evidence;
- exact local gate and tarball results;
- explicit statement that no npm publish, tag, GitHub Release, paid provider
  call, Dependabot merge, or protection change occurred.

- [ ] **Step 4: Require hosted checks at the exact PR head**

Wait for required `test (22)` and `test (24)`. Confirm their run head SHA
equals the pushed candidate. A failure returns to systematic diagnosis and a
new focused TDD cycle before another normal push.

- [ ] **Step 5: Issue the final release recommendation**

Return `GO` only when:

- issues #3/#4 acceptance evidence passes;
- complete local and hosted gates pass;
- actual tarball contents and installation pass;
- branch/PR identity metadata is noreply-only;
- no external publication action has happened.

Otherwise return `NO-GO` with the exact failing gate. Do not merge the PR or
publish beta.3 without a separate maintainer decision.

## Plan Self-Review

- **Spec coverage:** Tasks 2 and 3 cover both defects and compatibility
  requirements. Tasks 5 and 6 cover every release-rehearsal and integration
  success criterion.
- **Placeholder scan:** The plan contains no unresolved marker or unspecified
  production/test behavior. Temporary paths are generated with bounded
  `mktemp` patterns.
- **Type consistency:** `SnapshotDescriptor`, `PlanFailure.read()`,
  `GitSnapshotReader` options, error code, and message are identical between
  tests and implementation steps.
- **Security consistency:** Invalid refs are validated before Git and again at
  ref resolution; tests use a missing repository to prove ordering and assert
  fixed output.
- **Release consistency:** Only a candidate branch and PR are authorized. Tag,
  npm publication, GitHub Release, merge, Dependabot changes, and branch-rule
  changes remain outside this plan.
