# Public Beta Readiness Design

**Date:** 2026-08-09
**Status:** Approved from the maintainer's existing publication decision and
the current request to prepare the repository
**Repository:** `mr-min-max/aidoc`
**Candidate branch:** `codex/release-integrity`

## Objective

Prepare the existing AiDoc repository for a privacy-safe public beta while
preserving its authentic repository age, commit dates, commit messages, and
sanitized author attribution. The work must make the first public clone honest,
usable, contributor-friendly, and reproducibly verified.

The repository must remain private until GitHub confirms that the legacy pull
request references and cached views from the email-history rewrite have been
removed.

## Decisions Already Made

- Keep the existing `mr-min-max/aidoc` repository. Do not create a replacement
  public repository.
- Keep the rewritten commit history. Do not squash it, rebuild it, or perform a
  second history rewrite.
- Preserve historical author and committer dates, messages, file contents, and
  commit count. Sanitized commits use the GitHub noreply identity associated
  with `mr-min-max`.
- Keep Git identity configuration repository-local. Do not modify global Git
  identity on the shared machine.
- Treat the legacy closed pull request cache as a publication blocker. Resolve
  it through GitHub Support before changing visibility.
- Present the project as a public beta, not as a stable v1 release.
- Do not publish an npm package, create a tag, create a GitHub Release, or make
  the repository public as an implicit part of preparation. Each is a distinct
  external release action.

## Verified Starting State

The publication candidate has the following evidence as of this design:

- `main` is an ancestor of `codex/release-integrity`; integrating the candidate
  cannot restore the pre-rewrite commit chain.
- The candidate and its remote branch are synchronized at `27b334e`.
- All commits reachable from current local branches, tracked remote branches,
  and the local historical tag use either the account's GitHub noreply address
  or an automation/vendor noreply address. No iCloud author email is reachable.
- Repository-local `user.name` and `user.email` are configured for
  `mr-min-max` and its GitHub noreply address.
- The legacy closed pull request still references an old commit whose metadata
  contains the private email. It is accessible by exact object ID while the
  repository is private and must not become public.
- The GitHub repository is private, has three remote branches, one open draft
  pull request, no issues, standard labels, and Discussions disabled.
- The candidate has passed 46 Jest suites / 452 tests and hosted CI on Node 22
  and Node 24.
- The npm registry has no public `aidoc-gen` package. A README that begins with
  `npx aidoc-gen` is therefore not a working public-beta installation path.

## Publication Architecture

Public-beta preparation is divided into four independently gated layers:

1. **Reachable repository state** — code, branches, tags, commit metadata, and
   repository-local identity must be safe to publish.
2. **GitHub-retained state** — pull request refs, cached commit views, Actions
   runs/logs, artifacts, obsolete branches, and other server-side surfaces must
   be audited independently from local Git.
3. **Public product surface** — README, installation, beta status, security
   policy, contribution flow, issue templates, and starter backlog must state
   what actually exists.
4. **Visibility gate** — public visibility is allowed only after the first
   three layers pass and GitHub Support confirms removal of the legacy cached
   references.

Failure at any layer leaves the repository private. No step uses a temporary
public visibility change as a test.

## Privacy and History Controls

### Reachable history audit

The preflight must enumerate every local and remote branch and tag intended to
remain on GitHub. It must verify:

- author and committer emails use approved noreply domains;
- the private email and other maintainer identifiers do not occur in commit
  metadata, paths, committed text, tags, or release metadata;
- no branch or tag points into the pre-rewrite history;
- `main` remains an ancestor of the release candidate before integration;
- repository-local Git identity is still noreply-configured;
- the candidate contains no credential, private key, token, or high-confidence
  secret according to a pinned external secret scanner and focused repository
  checks.

The external scanner must run from a pinned version outside production
dependencies. Its binary checksum and invocation must be recorded in the
private preflight report. Scanner allowlisting must be narrow and explain each
false positive; it must not blanket-ignore documentation or test fixtures.

### GitHub-retained state audit

The preflight must inventory remote branches, pull requests, Actions runs,
artifacts, tags, releases, forks, and collaborators. Obsolete branches may be
deleted only after confirming that they contain no work absent from the release
candidate. Actions logs and artifacts must be reviewed because GitHub exposes
their history when a private repository becomes public.

The existing legacy pull request cannot be repaired by another force-push.
Prepare a private GitHub Support packet containing:

- repository owner/name;
- affected pull request count and number;
- the first changed commit from the prior rewrite;
- confirmation that all ordinary branches/tags are cleaned;
- a request to dereference/delete affected pull request refs, run server-side
  garbage collection, and remove cached views.

Exact private email values and old object IDs must stay in an ignored local
support packet, not in committed documentation, issues, or the current pull
request.

GitHub Support confirmation is a hard gate. If Support will not purge the
cached reference, publication remains blocked and the maintainer chooses a new
strategy explicitly; the agent must not silently fall back to exposing the
email.

## Public Beta Product Surface

### README and installation

The README must lead with a visible **Public Beta** notice covering stability,
feedback, supported Node versions, and known limitations. It must distinguish
the provider-free `plan` workflow from provider-backed generation/update.

Because `aidoc-gen` is not currently published, the default quick start must be
a tested source checkout:

```bash
git clone https://github.com/mr-min-max/aidoc.git
cd aidoc
npm ci
npm run build
node dist/cli/index.js plan
```

`npx aidoc-gen` may remain only in a clearly labeled future npm-beta section or
be introduced after a verified npm publication. Public documentation must not
claim an install path that returns registry 404.

The README's update description must match the implemented bounded semantic
impact plan and must not claim raw Git diff transport.

### Beta documentation and contribution flow

Add a focused public-beta document describing:

- what is ready for testing;
- what requires an LLM/API key and what does not;
- the Node/runtime and language support boundaries;
- current known limitations from the final review;
- how to report a bug, propose a feature, or report a vulnerability;
- the expectation that beta behavior and JSON schemas remain explicitly
  versioned but may evolve before v1.

Update issue and pull-request templates so their version examples and
verification instructions match `0.2.0-beta.2`. Add Dependabot configuration
for npm and GitHub Actions with a low-noise weekly cadence and bounded open PRs.

Create a small, real starter backlog. Issues must be derived from verified
limitations or scoped onboarding improvements, carry accurate `good first
issue` or `help wanted` labels, include acceptance criteria, and avoid fake
activity. Discussions are enabled only at the final publication stage so its
links are live when external users arrive.

## Integration and Release Sequence

1. Commit this design and an implementation plan on
   `codex/release-integrity`.
2. Implement and test documentation, metadata, Dependabot, and preflight
   tooling/report changes on the same candidate branch.
3. Run an independent privacy/security review of the complete candidate.
4. Run the full release gate, exact packed-package smoke, source-clone quick
   start, author/ref audit, secret scan, and diff/status checks.
5. Push the verified candidate and require hosted CI success.
6. Mark pull request #2 ready and integrate it into `main` without rewriting
   history. Do not merge until the candidate review and CI are green.
7. Confirm `main` exactly contains the reviewed candidate and rerun the
   publication audit against the remote default branch.
8. Close or otherwise settle all open pull requests before the Support purge.
9. Save the prepared GitHub Support request in the ignored private preflight
   area. Submission is deferred until the maintainer explicitly resumes that
   step; keep the repository private in the meantime.
10. After the maintainer submits it and receives written Support confirmation,
   perform a final server-side inventory,
    request the maintainer's visibility confirmation, then change the existing
    repository to public.
11. Immediately verify an unauthenticated fresh clone, README links, Actions,
    security reporting, issue templates, and Discussions from the public view.

No tag is pushed during this sequence. The existing tag-triggered release
workflow is not invoked. npm publication and a GitHub prerelease require a
separate release decision after the public source beta is stable.

## Verification Contract

The final pre-Support checkpoint must include exact results for:

- `npm run verify:release`;
- `node dist/cli/index.js score --min 80 --json`;
- provider-free human and JSON `plan` smoke tests;
- source-checkout quick start in a fresh temporary clone;
- installed-tarball CLI and MCP smoke tests;
- `git diff --check` and clean `git status --short`;
- current-branch and all-retained-ref email audit;
- pinned secret scan of Git history and the working tree;
- GitHub branch/PR/tag/release/Actions/artifact/fork inventory;
- hosted Node 22 and Node 24 CI at the exact integration commit.

An online `npm audit` is not implied. If a fresh dependency audit is desired,
it requires separate authorization and its timestamp/result must be reported
without overstating transitive risk remediation.

## Rollback and Failure Handling

- Before visibility changes, rollback is simply to leave the repository
  private and address the failed gate.
- A failed Support purge blocks publication; it does not authorize a new
  repository or disclosure of the legacy email.
- If an accidental visibility change occurs, immediately return the repository
  to private and inventory forks/log exposure. This is incident response, not a
  reliable rollback: public forks and cached data may persist.
- After publication, do not toggle visibility casually. GitHub documents that
  visibility changes affect forks, Actions visibility, stars, watchers, and
  repository-network state.

## Success Criteria

The design is complete when:

- the existing repository and authentic sanitized history are preserved;
- no retained ref exposes the private email or a secret;
- a complete private Support packet is ready, and eventual publication remains
  gated on GitHub confirming removal of legacy pull request refs/cache;
- the default branch contains the fully verified release candidate;
- the public onboarding path works without npm publication or an API key for
  `plan`;
- community/security surfaces are live and accurate;
- a public unauthenticated clone passes the documented smoke path;
- npm publication, tags, GitHub Releases, and grant submission remain separate
  follow-up decisions.
