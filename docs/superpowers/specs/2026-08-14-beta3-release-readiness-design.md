# Beta.3 Release Readiness Design

- **Date:** 2026-08-14
- **Status:** Approved in conversation; pending written-spec review
- **Repository:** `mr-min-max/aidoc`
- **Candidate branch:** `codex/beta3-release-readiness`

## Objective

Prepare AiDoc `0.2.0-beta.3` for a safe first npm beta release without
publishing a package, pushing a tag, or creating a GitHub Release during this
work. The preparation must leave one focused pull request whose merge makes a
later release explicit, reproducible, provenance-backed, and easy to reverse
before publication.

The release should strengthen the project's OSS credibility: public project
statements must be true, the release artifact must be the exact artifact that
passed verification, prerelease users must opt into the `beta` npm channel,
and long-lived publishing credentials must be removed after the one-time
bootstrap release.

## Decisions

- Produce one release-readiness pull request rather than a sequence of small
  dependency and documentation pull requests.
- Do not publish to npm, push `v0.2.0-beta.3`, create a GitHub Release, merge
  the pull request, or change repository settings as part of implementation.
- Keep the package name `aidoc-gen` and version `0.2.0-beta.3`.
- Publish the eventual prerelease under the npm `beta` dist-tag, never
  `latest`.
- Preserve the existing verify-on-Node-22-and-24, pack-once, checksum, exact
  tarball smoke, and publish-after-verification architecture.
- Use a temporary granular npm automation token only to bootstrap the first
  package version. Never place that token in source, command arguments, logs,
  issue text, or chat.
- After the first successful publication, configure npm Trusted Publishing for
  `mr-min-max/aidoc` and `.github/workflows/release.yml`, verify an OIDC
  release, delete the GitHub `NPM_TOKEN` secret, revoke the bootstrap token,
  and restrict token-based publishing on npm.
- Keep unrelated library upgrades and product features outside this pull
  request. GitHub Action runtime upgrades are in scope because they directly
  remove release/CI deprecation warnings and harden the release path.

## Approaches Considered

### 1. Staged bootstrap followed by OIDC (selected)

Harden the existing workflow, use one narrowly scoped token for the first
publication, then switch to npm Trusted Publishing. This preserves the exact
verified artifact and gives the initial package provenance while avoiding a
permanent write token.

### 2. Manual local first publication

Publish from the maintainer's workstation, then configure OIDC. This is
simpler to start but weakens auditability: the published bytes could diverge
from the tarball verified by GitHub Actions, and a local npm session becomes a
release-critical dependency. Rejected.

### 3. Remain source-checkout-only

Create only a GitHub source prerelease and defer npm indefinitely. This has the
smallest operational surface but leaves installation harder for testers and
provides weaker real-world adoption evidence for the public beta. Rejected as
the target, while remaining the fallback if npm bootstrap cannot pass safely.

## Scope

### Public OSS truth

Update public project text that is already stale:

- `GOVERNANCE.md` must state that the canonical repository is public.
- `SUPPORT.md` must route current questions to a channel that actually exists.
  GitHub Discussions may be mentioned only as a future channel while it is
  disabled.
- Add a maintainer release guide that separates preparation from external
  release actions and contains copyable, secret-safe bootstrap and cleanup
  commands.
- Keep `docs/PUBLIC_BETA.md` and the release note truthful: they remain
  source-checkout/forthcoming-npm documentation until publication succeeds.

### Release workflow

The tag-triggered workflow keeps three boundaries:

1. **Verify** on Node 22 and 24, validate protected Git identities, run the
   complete release gate, build once on Node 24, checksum the tarball, and
   smoke the exact tarball.
2. **Publish** only the downloaded checksum-verified tarball. The job must use
   GitHub-hosted Node 24, fail if the npm CLI is below the minimum supported by
   Trusted Publishing, grant only `contents: read` and `id-token: write`, and
   run an explicit command equivalent to:

   ```bash
   npm publish VERIFIED_TARBALL \
     --ignore-scripts \
     --access public \
     --tag beta \
     --provenance
   ```

   `NODE_AUTH_TOKEN` is exposed only to this publish step for the first
   bootstrap. No earlier verification, packaging, or artifact-validation step
   receives it.

3. **GitHub prerelease** runs only after npm publication. It downloads the same
   verified tarball and checksum, marks `0.2.0-beta.3` as a prerelease, and
   attaches both files without rebuilding or reinstalling dependencies.

The tag/version check remains fail-closed. A tag is created only in the later
release operation, after the readiness pull request is merged and the
maintainer explicitly says to publish.

### GitHub Action runtime maintenance

Update release- and CI-critical actions to reviewed Node-24-compatible release
lines, pinned to exact 40-character commit SHAs. This includes the current
Node-20-runtime warnings and the already-open Dependabot proposals for
CodeCov, artifact download, and GitHub Release creation. The implementation
must inspect upstream release notes, preserve every existing security option,
and update the immutable-revision tests. Existing Dependabot pull requests are
not merged independently; after the consolidated change lands, redundant
pull requests can be closed by Dependabot or handled separately.

## Authentication and External Release Sequence

Implementation stops before this sequence. The later release operation is:

1. The maintainer signs in to npm, enables strong 2FA, and creates the
   shortest-lived granular automation token that can bootstrap a new public
   package. Restrict it to `aidoc-gen` if npm permits selecting the unpublished
   name; otherwise revoke it immediately after the first publication.
2. From a trusted terminal, the maintainer runs
   `gh secret set NPM_TOKEN --repo mr-min-max/aidoc` and pastes the token into
   the hidden prompt. The token is never sent through chat.
3. Re-run remote `main` checks and verify that `aidoc-gen` is still available.
4. With a separate explicit publication authorization, create and push only
   `v0.2.0-beta.3` at the verified `main` commit.
5. Confirm npm contains `aidoc-gen@0.2.0-beta.3`, the `beta` dist-tag points to
   it, `latest` is absent, provenance is visible, the packed file installs, and
   the GitHub prerelease contains the same tarball/checksum.
6. Configure npm Trusted Publishing for GitHub Actions using owner
   `mr-min-max`, repository `aidoc`, workflow `release.yml`, and permission to
   run `npm publish`.
7. Exercise the OIDC path with the next intentionally versioned prerelease;
   then run `gh secret delete NPM_TOKEN --repo mr-min-max/aidoc`, revoke the npm
   bootstrap token, and disable traditional token publishing for the package.

No step attempts to configure Trusted Publishing before the package exists.
If npm authentication, package-name ownership, provenance, checksum, install,
or dist-tag verification fails, stop without changing or deleting evidence.

## Tests and Evidence

The readiness pull request must add or extend deterministic tests that assert:

- public governance/support statements match the live repository state;
- the publish job has `id-token: write` but no broader write permission;
- only the publish step receives `NODE_AUTH_TOKEN`;
- the command includes `--access public`, `--tag beta`, `--provenance`, and
  `--ignore-scripts` while publishing the checksum-verified artifact;
- the GitHub Release is a prerelease created only after publish and reuses the
  exact tarball/checksum without checkout, install, build, pack, or publish;
- every external action is pinned to an explicitly reviewed immutable SHA;
- stale private/source-only claims are removed only where they are already
  false, while no document claims that npm publication has happened;
- no Gmail address, local absolute path, credential, token value, placeholder,
  or secret-like material enters the diff or packed artifact.

Required final gates include focused release/documentation tests, YAML parsing,
TypeScript, lint, formatting, the full Jest suite, `npm run verify:release`,
documentation score, exact package/MCP smokes, `git diff --check`, candidate
history identity scanning, and a clean index. Hosted Node 22/24 CI must pass at
the exact pushed commit before the pull request is considered ready.

## Security and Failure Handling

- Source changes alone cannot publish anything; no release tag is created in
  this stage.
- Publishing remains downstream of complete verification and checksum
  validation.
- OIDC permission is job-scoped to publish. Repository contents stay read-only
  there; only the GitHub Release job receives `contents: write`.
- The bootstrap token is a temporary compatibility bridge, not the steady-state
  architecture.
- `--tag beta` prevents a prerelease from becoming the default `latest`
  installation.
- `--ignore-scripts` prevents lifecycle scripts from being executed during the
  registry publish step.
- Failure before npm accepts the package leaves the source release unpublished.
- Failure after npm accepts the immutable version does not authorize deleting
  or overwriting it. Record the failure, verify the registry state, and repair
  only the missing GitHub release or metadata in a separately reviewed step.

## Non-Goals

- No product feature, provider, MCP, parser, CLI, schema, or package-name
  change.
- No npm publication, tag, GitHub Release, repository-setting change,
  Discussions enablement, or pull-request merge.
- No automatic merging of unrelated Dependabot dependency upgrades.
- No claim that a beta package or marketplace listing exists before external
  verification proves it.
- No rewriting of published Git history or removal of the previously accepted
  historical private path.

## Success Criteria

The stage is complete when one reviewed pull request contains truthful OSS
documentation, a pinned and provenance-capable release workflow, deterministic
tests for every release boundary, clean local and hosted verification, and a
short maintainer runbook. It must be possible to stop after merging that pull
request with no package, tag, or GitHub Release created.

The first npm beta remains a distinct, explicitly authorized operation.
