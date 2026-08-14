# OIDC-only beta.5 Design

- **Date:** 2026-08-14
- **Status:** Approved
- **Repository:** `mr-min-max/aidoc`
- **Candidate branch:** `codex/oidc-beta5`

## Objective

Retire the temporary npm bootstrap credential and prove that the existing npm
Trusted Publisher can publish `@mr-min-max/aidoc-gen@0.2.0-beta.5` from
`.github/workflows/release.yml` using only GitHub Actions OIDC. Preserve the
verified-artifact release architecture and keep all public statements truthful
before, during, and after the immutable publication.

## Selected Approach

Use a fail-closed migration. Delete the GitHub `NPM_TOKEN` secret before the
verification release, remove every `NPM_TOKEN` reference from the release
workflow, and publish a new intentionally versioned prerelease. The publish job
keeps only `contents: read` and `id-token: write`, runs on a GitHub-hosted Node
24 runner, verifies npm is at least 11.5.1, and publishes the already verified
tarball with the `beta` dist-tag.

Two alternatives are rejected:

- Keeping the token during the test cannot prove whether npm used OIDC or the
  fallback credential.
- Switching to staged publishing in this migration changes the release UX and
  permission model at the same time; it can be evaluated separately after the
  direct OIDC path is proven.

## Release-state Model

The repository must distinguish the immutable candidate from the currently
published public release:

- `package.json`, `package-lock.json`, and the bundled Codex plugin identify
  the beta.5 candidate.
- Until npm accepts beta.5, README, integration guides, and supported Action
  examples continue to identify beta.4 as the currently published release.
- The live-publication checker receives an explicit published version instead
  of assuming the package candidate is already public.
- The unpublished checker reads the beta.5 candidate from `package.json` and
  must receive an exact registry 404 before tagging.
- After OIDC publication succeeds, a bounded post-publication documentation
  change promotes the public claims and live checker from beta.4 to beta.5.

## npm Distribution Tags

Publication uses `--tag beta`; the supported install remains
`npm install -g @mr-min-max/aidoc-gen@beta`. The workflow never publishes with
`--tag latest`. The registry-managed `latest` tag is not removed: with beta.4
as the package's first and only version, npm retained it as the default
fallback. After beta.5, `beta` must point to beta.5 while `latest` may remain on
an existing version. Public documentation must never recommend a bare or
`@latest` install during prerelease.

## Security Boundaries

- No npm secret value, token identifier, personal email, or local absolute path
  enters Git, CI logs, release notes, or chat.
- The GitHub secret is deleted before the OIDC verification release. A failed
  OIDC exchange stops publication; it does not authorize silently restoring a
  token.
- The bootstrap granular token is revoked after OIDC succeeds, and package
  publishing access is changed to disallow traditional tokens.
- Only an annotated `v0.2.0-beta.5` tag at the exact verified `origin/main`
  commit and created with the protected noreply identity can trigger
  publication. The workflow verifies the pushed object itself and rejects a
  lightweight, indirectly targeted, or stale tag before dependency install.
- npm publication precedes GitHub prerelease creation; failure after npm accepts
  the immutable version is repaired without republishing or moving the tag.

## Verification

The change is accepted only when deterministic tests prove zero
`NPM_TOKEN` references, exact OIDC permissions and publish flags, candidate and
published-version separation, beta.5 registry-unpublished checks, and
version/plugin consistency. Full release verification, package/MCP smokes,
documentation score, history identity checks, hosted Node 22/24 CI, npm
registry metadata/provenance, GitHub release assets, and clean-tree checks must
all pass at their applicable stage.
