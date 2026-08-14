# Scoped beta.4 release recovery design

## Context

The `v0.2.0-beta.3` release workflow verified the exact artifact on Node 22 and
24, generated provenance, and then npm rejected the first publication because
the unscoped name `aidoc-gen` is too similar to the existing package
`aidocgen`. npm did not create a package version and GitHub did not create a
release. The failed public tag remains an immutable record and must not be
moved, deleted, or reused.

## Decision

Publish the next candidate as
`@mr-min-max/aidoc-gen@0.2.0-beta.4` from tag `v0.2.0-beta.4`.

The scoped name is the registry-recommended recovery, makes ownership clear,
and removes the global unscoped-name collision class. The executable remains
`aidoc`; users will invoke `aidoc` after installation. Historical design and
plan documents remain unchanged because they record earlier decisions.

Rejected alternatives:

- Moving or deleting `v0.2.0-beta.3` would rewrite a public release marker.
- Choosing another unscoped name would retain npm similarity and squatting
  risk.
- Publishing manually would bypass the verified-artifact, provenance, and
  GitHub Release chain.

## Metadata and release boundary

- Change `package.json` and the root lockfile package to the exact scoped name
  and beta.4 version.
- Advance current integration metadata, issue forms, public-beta source
  checks, release notes, and the release runbook to beta.4.
- Add a beta.4 release note. Reclassify the beta.3 note as an unpublished
  candidate so no public document claims that beta.3 reached npm.
- Keep the release workflow generic: it continues to verify, pack once, smoke
  the exact tarball, publish it with `beta` and provenance, then create the
  GitHub prerelease.
- Keep installation documentation in source-checkout/forthcoming mode until
  external npm and GitHub proof succeeds. A post-publication documentation PR
  will add the public install command.

## Fail-closed safeguards

The release-candidate verifier must accept only the exact package identity
`@mr-min-max/aidoc-gen` and derive the tag from the package version. Tests must
fail when the old unscoped name returns. Package and MCP smoke tests must
install and locate the scoped dependency through
`node_modules/@mr-min-max/aidoc-gen` while continuing to assert the `aidoc`
binary and all existing runtime behavior.

The runbook must explicitly verify that the scoped package/version is absent
before publication, that the old beta.3 attempt is unpublished, and that the
new `beta` dist-tag points only to `0.2.0-beta.4` afterward.

## Error and recovery policy

- Do not rerun the failed beta.3 workflow and do not repoint its tag.
- Stop before a beta.4 tag if any metadata, identity, history, CI, package,
  artifact, or documentation check fails.
- If beta.4 publish fails before npm accepts it, preserve evidence and diagnose
  the exact registry response; do not create another tag as an experiment.
- If npm accepts beta.4 but GitHub release creation fails, repair only the
  missing GitHub prerelease from the already verified artifact.

## Verification

Use test-first changes for release identity and scoped package installation.
The acceptance gate is the full `verify:release` suite, provider contracts,
package and MCP process smokes, public-beta tests, documentation score, release
candidate verification, public-beta preflight, clean Git state, protected
Git identities, and green hosted CI on the exact main commit. Publication then
uses a new annotated `v0.2.0-beta.4` tag and the existing release workflow.
