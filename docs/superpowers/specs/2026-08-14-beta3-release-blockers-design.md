# Beta.3 Release Blockers Design

**Date:** 2026-08-14
**Status:** Approved by the maintainer's decision to proceed with the
release-blocker stage
**Repository:** `mr-min-max/aidoc`
**Candidate branch:** `codex/beta3-release-blockers`

## Objective

Remove the two small known blockers that should not ship in the first public
beta, then produce reproducible release-candidate evidence without creating a
Git tag, publishing npm, or creating a GitHub Release.

The changes must preserve the existing versioned plan JSON contract, fixed
value-safe Git diagnostics, provider-free planning boundary, and current
source-beta behavior outside the two accepted fixes.

## Verified Starting State

- Remote `main` is `d866b9f1d95c14318f30135964632012c296dc05`.
- The hosted `main` gate passes on Node.js 22 and Node.js 24.
- Package metadata is already `0.2.0-beta.3`.
- No npm package, Git tag, or GitHub Release exists for beta.3.
- Open issue #3 records that a working-tree plan has the correct JSON
  discriminator but human verbose output displays `Head: HEAD`.
- Open issue #4 records that revision validation rejects NUL, LF, and CR but
  does not reject every C0 control character and DEL.
- Open Dependabot pull requests are separate major-version maintenance work
  and are not part of this release-blocker candidate.

## Root Causes

### Working-tree label

`GitSnapshotReader.read()` intentionally returns a working-tree descriptor
with `type: "working-tree"` and `label: "HEAD"`. The label records the commit
used to anchor the comparison, but `formatSnapshot()` renders only `label` for
descriptors without a commit. Human verbose output therefore hides the more
truthful working-tree discriminator even though canonical JSON is correct.

### Git control characters

`GitSnapshotReader.validateRef()` iterates Unicode code points but rejects only
codes `0`, `10`, and `13`. Other C0 characters and DEL reach Git as argument
content. Argument-array execution prevents shell interpolation, but the reader
should reject the entire issue-defined set before repository discovery or ref
resolution.

## Considered Approaches

### 1. Boundary-only compatibility fix — selected

- Render `working-tree` from the descriptor type in human output.
- Keep the JSON descriptor and its `label` unchanged.
- Reject every code point from `U+0000` through `U+001F`, plus `U+007F`.
- Validate caller/environment refs before the first Git command and retain
  validation immediately before each ref resolution as defense in depth.

This is the smallest change that fixes the observable defects and preserves
all existing contracts.

### 2. Change descriptor labels in the planner — rejected

Changing `head.label` from `HEAD` to `working-tree` would also change canonical
JSON, impact digests, fixtures, and downstream consumers. The issue explicitly
requires the JSON contract to remain unchanged.

### 3. Document both limitations and publish unchanged — rejected

The defects are small and deterministic. Carrying a misleading primary UX
label and a known revision-validation gap into the first beta would weaken the
release evidence without creating useful contributor scope.

## Detailed Design

### Human presentation

`formatSnapshot(snapshot)` will branch on `snapshot.type` first:

- `working-tree` renders exactly `working-tree`;
- immutable Git descriptors retain `label (commit)`;
- other existing label behavior remains unchanged.

Only human verbose output changes. `serializePlanCommandResult()` and all plan
objects remain byte-for-byte governed by the current schema.

### Revision validation

At the start of `GitSnapshotReader.read()`:

1. Derive `headLabel` from `options.head ?? "HEAD"` and validate it.
2. Derive a caller/environment base candidate from
   `options.base ?? AIDOC_BASE_REF`; validate it when present.
3. Only then discover the repository root and resolve commits.

`validateRef()` will continue rejecting leading `-` and will reject a code
point when `code <= 0x1f || code === 0x7f`. Revalidation remains in
`resolveCommit()` and `resolveBase()` so discovered or later-routed refs cannot
bypass the boundary.

Every invalid value returns only:

- code `PLAN_INVALID_REF`;
- message `The Git reference is invalid.`;
- no hostile ref, local path, or Git stderr.

## Test Design

### Issue #3

Extend real formatter tests with literal expected output:

- a descriptor `{ type: "working-tree", label: "HEAD" }` renders
  `Head: working-tree` in verbose mode and never renders `Head: HEAD`;
- an immutable descriptor retains its existing label and commit rendering;
- canonical JSON serialization remains unchanged.

The production mutation caught is removing the type-sensitive display branch.

### Issue #4

Use the real `GitSnapshotReader`, not a mock. For each of the 33 forbidden
characters (`U+0000`–`U+001F`, `U+007F`), pass an explicit hostile head while
the reader cwd is deliberately not a repository. The required
`PLAN_INVALID_REF` result proves validation happened before repository
discovery; `PLAN_NOT_GIT_REPOSITORY` would prove Git was reached first.

Add the equivalent explicit-base/environment-base boundary cases, retain valid
branch/tag/commit coverage, and assert that diagnostics contain none of the
hostile value.

## Release Rehearsal

After both focused RED→GREEN cycles:

1. Run the focused output/planner and Git snapshot suites.
2. Run TypeScript, lint, formatting, and the full Jest suite.
3. Run `npm run verify:public-beta` from the candidate worktree.
4. Build an actual beta.3 tarball into a temporary directory.
5. Inspect the package file list and scan it for credentials, private paths,
   local absolute paths, source maps, caches, and unexpected files.
6. Install the tarball into a fresh temporary consumer and exercise version,
   provider-free plan, package smoke, MCP smoke, and Codex plugin smoke through
   the existing release-integrity commands.
7. Produce a GO/NO-GO report tied to the exact candidate commit.

No live or paid provider call is permitted. The rehearsal must not create or
push a tag, publish npm, create a GitHub Release, merge Dependabot pull
requests, or change repository protection.

## Integration and Issue Handling

- Commit the design, implementation plan, each focused fix, and final evidence
  as reviewable commits on `codex/beta3-release-blockers`.
- Push normally and create a pull request targeting `main` only after local
  release evidence passes.
- The pull request may close issues #3 and #4 after merge; it must not close or
  absorb issues #5–#8.
- Require Node.js 22 and 24 hosted checks before recommending merge.

## Failure and Rollback

- A failing baseline stops implementation until understood.
- A wrong RED failure is repaired in the test before production code changes.
- Any release-rehearsal failure produces `NO-GO`; no external publication
  action follows.
- The current root checkout remains untouched. The candidate worktree and
  branch can be preserved for diagnosis or removed after integration.

## Success Criteria

- Human working-tree output is truthful while canonical JSON is unchanged.
- Every C0 control character and DEL is rejected before Git execution with one
  fixed value-safe error.
- Valid refs and immutable comparison labels retain existing behavior.
- Focused and complete local gates pass with zero failures.
- The actual packed artifact installs and passes CLI/MCP/plugin smoke checks.
- The candidate contains no unexpected package files or private values.
- The final report says GO or NO-GO without publishing anything.
