# Strict Public-Beta Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove known private identifiers from ordinary retained Git history, remediate npm advisories, and merge the verified beta candidate into private `main`.

**Architecture:** Perform history mutation only in an isolated mirror, guard the remote update with an exact lease, and prove metadata/tree invariants before touching GitHub. Diagnose dependency advisories separately, then run the complete privacy and release gates before a merge-commit integration.

**Tech Stack:** Git 2.x, git-filter-repo, Node.js 22/24, npm, Jest, Gitleaks 8.30.1, GitHub CLI and Actions.

## Global Constraints

- Exact private strings and old object IDs remain in ignored `.private` files only.
- Preserve candidate commit count, ordered identities, dates, and full messages.
- Preserve the candidate's current final tree object exactly across the rewrite.
- Use only an exact `force-with-lease`; never use an unguarded force-push.
- Do not use `npm audit fix --force`.
- Keep the repository private and defer GitHub Support submission.
- Do not publish npm, push tags, create Releases, or enable Discussions.

---

### Task 1: Verify Recoverable Backups

**Files:**
- Read: external dated mirror and bundle
- Update: `.private/public-beta-support.md`

**Interfaces:**
- Consumes: every current local head, remote-tracking ref, tag, and Codex checkpoint ref
- Produces: independently verified mirror, complete bundle, and checksum evidence

- [ ] Run `git fsck --full` in the no-hardlink mirror and require exit code 0.
- [ ] Run `git bundle verify` on the dated bundle and require complete-history output.
- [ ] Record the exact bundle SHA-256 and pre-rewrite candidate/PR heads in the ignored Support packet.
- [ ] Confirm the repository worktree is clean before creating tracked design commits.

### Task 2: Commit the Approved Cleanup Contract

**Files:**
- Create: `docs/superpowers/specs/2026-08-10-strict-public-beta-cleanup-design.md`
- Create: `docs/superpowers/plans/2026-08-10-strict-public-beta-cleanup.md`

**Interfaces:**
- Consumes: the maintainer's explicit strict-cleanup and merge authorization
- Produces: a public-safe operational contract that contains no private needle

- [ ] Run the exact-needle search against both new files and require zero matches.
- [ ] Run `git diff --check`.
- [ ] Commit only the design and plan as `docs(beta): authorize strict history cleanup`.

### Task 3: Rewrite and Prove Candidate History

**Files:**
- Create ignored: `.private/history-replacements.txt`
- Read: `.private/public-beta-needles.txt`
- Mutate: candidate Git objects in a fresh isolated mirror

**Interfaces:**
- Consumes: the exact current remote candidate head and ignored replacement rule
- Produces: a rewritten candidate ref with the same current tree and ordered metadata stream

- [ ] Fetch the private remote and confirm PR #2's head equals the candidate branch head.
- [ ] Capture candidate commit count, final tree ID, and the ordered full metadata/message stream.
- [ ] Clone a fresh isolated mirror from GitHub into an explicit new temporary directory.
- [ ] Run git-filter-repo only on `refs/heads/codex/release-integrity` with the ignored literal replacement file, `--prune-empty never`, and `--prune-degenerate never`.
- [ ] Require the old and new final tree IDs to match.
- [ ] Require the old and new commit counts and ordered metadata/message streams to match byte-for-byte.
- [ ] Require the private path needle to be absent from every object reachable from the rewritten candidate.
- [ ] Push the rewritten candidate with `--force-with-lease=refs/heads/codex/release-integrity:<validated-old-head>`.
- [ ] Delete only the obsolete Claude remote branch recorded in the private packet.
- [ ] Fetch with pruning and require the ordinary remote inventory to contain neither old branch nor either private needle.

### Task 4: Realign the Active Worktree

**Files:**
- Update ignored: `.private/public-beta-support.md`
- Update: local candidate branch ref and worktree checkout

**Interfaces:**
- Consumes: the verified rewritten remote candidate
- Produces: a clean active worktree tracking the rewritten remote without any old local backup ref

- [ ] Detach the active worktree without changing its clean files.
- [ ] Update the local candidate ref to the exact rewritten remote head using the expected old local head as a guard.
- [ ] Reattach the worktree to `codex/release-integrity` and verify upstream equality.
- [ ] Confirm repository-local name/email still use the approved protected identity.
- [ ] Add PR #2's pre-rewrite head and cleanup request to the ignored Support packet.

### Task 5: Diagnose and Remediate npm Advisories

**Files:**
- Modify as evidence requires: `package.json`
- Modify: `package-lock.json`
- Test: existing focused tests for any directly affected package boundary

**Interfaces:**
- Consumes: complete and `--omit=dev` npm audit JSON reports
- Produces: the smallest compatible dependency graph with no high advisory and no production vulnerability

- [ ] Run fresh complete and production-only audits and save ignored JSON reports.
- [ ] For every advisory, identify dependency path, installed version, affected range, fix availability, and runtime/dev scope before editing.
- [ ] Choose the smallest non-forced compatible update; do not change unrelated dependencies.
- [ ] If source behavior must change, first add a focused failing test and observe the expected failure.
- [ ] Apply the dependency update and regenerate the lockfile with the project's supported npm runtime.
- [ ] Rerun focused tests, complete audit, and production-only audit.
- [ ] Commit only the verified remediation as `fix(deps): resolve beta audit findings`.

### Task 6: Run Candidate Publication Gates

**Files:**
- Update ignored: `.private/public-beta-preflight.json`
- Update ignored: Gitleaks and GitHub Actions audit reports

**Interfaces:**
- Consumes: rewritten, dependency-remediated candidate
- Produces: fresh local, packaged, history, and hosted evidence at one exact SHA

- [ ] Run `npm run verify:release` with network access for the packed-tarball install.
- [ ] Run `npm run test:public-beta`.
- [ ] Run the real public-beta preflight with the ignored needle file and require status `pass` with zero private needles.
- [ ] Run Gitleaks 8.30.1 against all reachable history and a clean `git archive` tree; require zero unapproved findings.
- [ ] Run `git diff --check` and require a clean tracked worktree.
- [ ] Push normally and require hosted Node 22 and Node 24 CI success at the exact candidate SHA.
- [ ] Audit all available Actions logs and require zero private-needle or credential-pattern matches.

### Task 7: Merge and Verify Private Main

**Files:**
- Mutate remote: pull request #2 and `refs/heads/main`
- Keep: all beta labels and source-only release copy

**Interfaces:**
- Consumes: green PR #2 at the exact reviewed candidate SHA
- Produces: a merge commit on private `main` with the candidate as its second parent

- [ ] Confirm the repository is private, PR #2 is draft, and both hosted checks are successful at the reviewed head.
- [ ] Mark PR #2 ready and merge with a merge commit; do not squash or rebase.
- [ ] Fetch the exact remote `main` integration commit into a clean checkout.
- [ ] Verify the merge commit's second parent equals the reviewed candidate SHA.
- [ ] Run the full release gate and real preflight on integrated `main`.
- [ ] Require hosted Node 22 and Node 24 CI success at the exact integration commit.
- [ ] Confirm README/release metadata still says `0.2.0-beta.2`, with zero remote tags, Releases, npm publication actions, or visibility changes.
