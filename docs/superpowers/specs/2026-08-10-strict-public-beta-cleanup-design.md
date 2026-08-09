# Strict Public-Beta Cleanup Design

**Date:** 2026-08-10
**Status:** Approved by the maintainer
**Supersedes:** The no-second-rewrite constraint in the 2026-08-09 public-beta readiness design
**Repository:** `mr-min-max/aidoc`

## Objective

Remove the two known private identifiers from every ordinary Git ref that will
remain on GitHub, remediate dependency advisories without weakening runtime or
release guarantees, and integrate the verified public-beta candidate into the
private default branch. GitHub Support submission and public visibility remain
separate, deferred actions.

## Maintainer Decisions

- Privacy takes precedence over preserving existing commit object IDs.
- One additional narrowly scoped history rewrite is authorized.
- Preserve commit order, author and committer identities, author and committer
  dates, messages, and commit count. Only blobs containing the approved private
  path prefix may change.
- Delete the obsolete remote Claude branch after a verified offline backup.
- Use `force-with-lease` with the exact observed candidate head; never use an
  unguarded force-push.
- Investigate the reported npm advisories and apply the smallest compatible
  dependency remediation. Do not use `npm audit fix --force`.
- Merge the verified candidate into private `main` with a merge commit so the
  rewritten development history remains visible.
- Continue to describe the project as `0.2.0-beta.2`. A merge into `main` does
  not imply stable status, npm publication, a tag, or a GitHub Release.

## Cleanup Boundaries

The exact private strings and old object IDs live only in ignored local audit
files. The tracked design identifies them by category:

1. A historical personal-email string exists only in a document on an obsolete
   remote branch. Removing that branch removes it from ordinary retained refs.
2. A historical local-checkout prefix exists in earlier blobs on the candidate
   branch. Rewrite that literal to the already-selected neutral example prefix
   in every candidate commit.

The candidate's current tree must remain byte-identical across the rewrite,
because its current files are already clean. A rewrite is accepted only if:

- the candidate commit count is unchanged;
- ordered author/committer names, emails, dates, and full messages are unchanged;
- the final tree object is unchanged;
- the obsolete branch is absent from the remote branch inventory;
- the exact-needle preflight reports zero retained-history matches;
- Gitleaks reports zero unapproved findings.

## Backup and Recovery

Before mutation, create both a no-hardlink mirror and a complete Git bundle in
the dated external history-backup directory. Verify the mirror with `git fsck`,
verify the bundle with `git bundle verify`, and record the bundle checksum.

The backups are recovery material and intentionally retain the private values.
They must never be pushed or copied into the repository. Old local clones must
not push after the rewrite; active worktrees are realigned to the rewritten
remote branch before any new commit.

## GitHub-Retained Objects

Force-pushing the candidate and deleting the obsolete branch do not guarantee
that GitHub has removed historical pull-request objects or cached commit pages.
The ignored Support packet must therefore include both affected pull requests
and their pre-cleanup object IDs. The repository remains private until the
maintainer later submits the packet and GitHub confirms the purge.

## Dependency Remediation

Run fresh production-only and complete npm audits after the history rewrite.
Classify every advisory by dependency path, runtime/dev scope, affected range,
and available compatible fix. Prefer direct version or lockfile-only updates
that retain Node 22/24 support. Any source behavior change follows TDD; a pure
dependency resolution change is verified by the existing focused and full
release gates.

The remediation is complete only when the full audit has no high-severity
finding and the production-only audit has no unresolved vulnerability. Any
remaining lower-severity advisory must be explicitly documented with scope and
rationale rather than hidden.

## Integration Sequence

1. Back up and verify every current ref.
2. Commit this approved design and its implementation plan.
3. Rewrite the candidate in an isolated mirror and prove the invariants.
4. Push with an exact lease and delete the obsolete remote branch.
5. Realign the local candidate worktree and update the private Support packet.
6. Diagnose and remediate dependency advisories in focused commits.
7. Run the full release, public-beta, exact-needle, Gitleaks, fresh-clone, and
   hosted Node 22/24 gates.
8. Mark draft pull request #2 ready and merge it into private `main` with a merge
   commit.
9. Verify the exact integration commit locally and on hosted CI.

## Deferred Actions

- Do not submit the GitHub Support request in this task.
- Do not make the repository public.
- Do not enable Discussions.
- Do not publish npm, push a tag, or create a GitHub Release.

## Success Criteria

- Ordinary remote branches and tags contain neither approved private needle.
- The rewritten candidate preserves the approved historical invariants.
- Dependency audits meet the remediation criteria.
- Local and hosted release gates pass at the reviewed candidate and integrated
  `main` commits.
- Private `main` contains the public-beta candidate while all product copy still
  labels it as an early public beta.
- The ignored Support packet contains the remaining GitHub-cache cleanup work.
