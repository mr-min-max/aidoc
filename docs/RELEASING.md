# Releasing AiDoc

This is the maintainer procedure for publishing AiDoc. It separates repository
preparation from irreversible external release actions.

## Release Boundary

Merging a release-readiness pull request does not publish a package. The
release workflow runs only after a matching `v*` tag is pushed. Do not create
or push a release tag without a separate explicit publication decision made
after every pre-release check below passes.

The first npm beta is `@mr-min-max/aidoc-gen@0.2.0-beta.4`. The release workflow
publishes prereleases with the npm `beta` dist-tag and never selects `latest`.
Every npm package must have a `latest` dist-tag, however, so a package whose
only version is a prerelease can still have registry-managed `latest` pointing
to that version. Do not try to remove that required tag. The supported public
installation command is always explicit:

```bash
npm install -g @mr-min-max/aidoc-gen@beta
```

The public `v0.2.0-beta.3` tag records a failed first-publication attempt. npm
verified provenance but rejected the unscoped name under its package-similarity
policy; no npm version or GitHub Release was created. That tag must not be
moved, deleted, repointed, rerun, or reused. Recovery continues only through
the scoped beta.4 package and a new tag.

## Historical beta.4 Verification Record

beta.4 was published successfully on 2026-08-14. The commands below preserve
the exact procedure that produced the immutable version and tag; do not rerun
them for beta.4. For a later release, first update every pinned version and tag
in a reviewed release-readiness change, then repeat the equivalent gates.

Run the verification and publication commands in the same trusted shell session
and keep that session open through tag creation. The `release_sha` variable is
readonly by design; if the session closes or `origin/main` changes, restart this
section and repeat every gate.

1. Fetch the remote default branch, capture its exact commit once, and prove the
   checked-out candidate is that commit:

   ```bash
   git fetch origin main &&
   release_sha="$(git rev-parse origin/main)" &&
   readonly release_sha &&
   node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha" &&
   test -z "$(git status --porcelain=v1)"
   ```

   The worktree and index must be clean. Hosted CI on Node 22 and 24 must be
   green at that exact commit.

2. Confirm `package.json` and `package-lock.json` both identify
   `0.2.0-beta.4`, and confirm the intended tag will be
   `v0.2.0-beta.4`.

3. Before the first publication, verify both registry invariants:

   - the rejected `aidoc-gen@0.2.0-beta.3` version remains unpublished;
   - `@mr-min-max/aidoc-gen@0.2.0-beta.4` remains available.

   The checker is pinned to `https://registry.npmjs.org`, accepts only an exact
   `404` for each version, and fails closed on an existing version, redirect,
   authentication/rate/server response, or transport failure:

   ```bash
   node scripts/verify-npm-unpublished.mjs
   ```

4. Install from the lockfile and run every release gate:

   ```bash
   node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha" &&
   test -z "$(git status --porcelain=v1)" &&
   npm ci &&
   npm run verify:release &&
   npm run build &&
   node dist/cli/index.js score --min 80 &&
   npm run test:public-beta &&
   node scripts/public-beta-preflight.mjs --json --candidate-ref "$release_sha" &&
   node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha" &&
   node scripts/verify-npm-unpublished.mjs &&
   test -z "$(git status --porcelain=v1)" &&
   release_verified_sha="$release_sha" &&
   readonly release_verified_sha
   ```

   The block checks the exact commit and clean tree both before and after the
   gates. The final variable is created only if the whole chain succeeds. Do
   not assign it manually or continue after any command in the chain fails.

5. Review candidate commit identities, changed paths, and workflow permissions.
   Stop if a personal email, secret candidate, user-specific absolute path,
   unexpected file, or broader permission appears.

## Historical First-publication Bootstrap

Trusted Publishing is configured on an existing npm package, so the first
version required a temporary bootstrap credential. The following steps are a
historical record, not instructions to mint another token for beta.4.

1. Sign in to npm and enable strong account 2FA.
2. Create the shortest-lived granular automation token that can publish the
   new public package. Grant only the required package read/write permission
   and the CI-specific 2FA bypass required for unattended publishing. Restrict
   it to `@mr-min-max/aidoc-gen` if npm permits selecting the unpublished name.
3. From a trusted terminal, store it through the hidden GitHub CLI prompt:

   ```bash
   gh secret set NPM_TOKEN --repo mr-min-max/aidoc
   ```

Never paste the token into chat, a command argument, an environment dump, an
issue, a tracked `.npmrc`, or another repository file. Do not print the secret
after GitHub accepts it.

## Historical beta.4 Publication

Continue only in the same trusted shell session, after the maintainer explicitly
authorizes publication. Re-fetch `main` and prove both the remote tip and local
checkout still equal the one SHA that passed every gate. If either comparison
fails, do not tag; restart pre-release verification at the new commit.

1. Revalidate and create an annotated tag at that exact verified commit:

   ```bash
   test "${release_verified_sha:-}" = "$release_sha" &&
   git fetch origin main &&
   node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha" &&
   node scripts/verify-npm-unpublished.mjs &&
   test -z "$(git status --porcelain=v1)" &&
   git tag -a v0.2.0-beta.4 "$release_sha" -m "v0.2.0-beta.4" &&
   git show --no-patch --format=fuller v0.2.0-beta.4
   ```

2. Inspect the tag target and identity. Then push only that tag:

   ```bash
   git push origin v0.2.0-beta.4
   ```

3. Watch the `Release` workflow. It verifies Node 22/24, packs once, checksums
   and smokes that exact tarball, then publishes the downloaded verified file
   with `--ignore-scripts --access public --tag beta --provenance`.
4. The GitHub prerelease is created only after npm accepts the package. It
   attaches the same tarball and checksum without rebuilding.

## Post-publication Proof

The completed beta.4 publication was verified across every external surface:

```bash
npm view @mr-min-max/aidoc-gen@0.2.0-beta.4 version --json
npm dist-tag ls @mr-min-max/aidoc-gen
node scripts/verify-npm-published.mjs
gh release view v0.2.0-beta.4 --repo mr-min-max/aidoc
```

The `beta` dist-tag must point to `0.2.0-beta.4`. npm also reports the required
`latest` tag at `0.2.0-beta.4` because this is the package's only published
version; that registry invariant is not a release-channel decision. Confirm npm
displays provenance from `mr-min-max/aidoc`, download the release tarball and
checksum, verify the checksum, and repeat the packed CLI/MCP smoke against
those exact bytes.

Only after this proof may public documentation claim that npm installation or
a GitHub prerelease exists.

npm maintainer metadata is public. Confirm that the `mr-min-max` entry uses an
approved privacy alias and never a personal or private email address. Review it
without copying the full address into logs, issues, or test fixtures; change the
"email address added to package metadata" in npm profile settings before the
next publication if the approved alias changes.

## OIDC-only beta.5 Publication Record and Account Cleanup

The npm Trusted Publisher was configured on 2026-08-14 with provider GitHub
Actions, owner `mr-min-max`, repository `aidoc`, workflow filename
`release.yml`, and allowed action `npm publish`. npm does not validate that
relationship when it is saved; only a real publish can prove that the OIDC
claims match.

`0.2.0-beta.5` is the completed OIDC verification release. Its reviewed change
removed the last `NODE_AUTH_TOKEN` wiring from the workflow. The GitHub
bootstrap secret was deleted on 2026-08-14 after this Trusted Publisher was
configured; `gh secret list --repo mr-min-max/aidoc` returned no Actions
secrets. Do not recreate it during ordinary release recovery.

The completed migration record is:

1. The GitHub bootstrap secret was absent before the OIDC verification run:

   ```bash
   gh secret list --repo mr-min-max/aidoc
   ```

   The output contained no `NPM_TOKEN`. The command exposes only secret names
   and timestamps, never stored values.

2. Hosted Node 22 and 24 CI passed on the reviewed `main` commit. The protected
   annotated `v0.2.0-beta.5` tag points directly to that commit and uses the
   approved GitHub noreply tagger identity.
3. [Release workflow run 31825128025](https://github.com/mr-min-max/aidoc/actions/runs/31825128025)
   completed successfully. Because both the GitHub secret and workflow wiring
   were absent, the successful npm publication proves the configured Trusted
   Publisher OIDC relationship authenticated the publish job.
4. npm accepted `@mr-min-max/aidoc-gen@0.2.0-beta.5`, moved the supported
   `beta` channel to it, and exposed SLSA provenance for
   `mr-min-max/aidoc/.github/workflows/release.yml`. The
   [GitHub prerelease](https://github.com/mr-min-max/aidoc/releases/tag/v0.2.0-beta.5)
   contains a checksum-matching copy of the exact npm tarball, and a clean
   installation reports `0.2.0-beta.5`.
5. Current-public documentation is promoted from beta.4 to beta.5 in a bounded
   reviewed post-publication change. The registry-managed `latest` tag is not
   the supported prerelease channel and must not be removed merely because it
   still names beta.4.

The account-level cleanup was completed on 2026-08-14 in the authenticated npm
UI and CLI session without recording token identifiers, values, or
authenticator codes in repository logs:

1. Set package publishing access to **Require two-factor authentication and
   disallow bypass tokens**:

   ```bash
   npm access set mfa=publish @mr-min-max/aidoc-gen
   ```

2. Both temporary granular bypass tokens created for the beta.4
   bootstrap/recovery attempts were deleted with **Delete Selected Tokens**.
   A safe authenticated follow-up audit reported zero active npm tokens and
   zero temporary bypass tokens without printing token metadata.
3. The Trusted Publisher entry for `mr-min-max/aidoc` and `release.yml` remains
   configured after cleanup. Ordinary releases must continue to use OIDC; do
   not recreate `NPM_TOKEN` or mint another automation token as a shortcut.

If OIDC fails on a future release, diagnose the trust configuration first.
Restoring the bootstrap secret requires a separate deliberate recovery
decision; do not silently add it back during the failed run.

Trusted Publishing requires a GitHub-hosted runner, `id-token: write`, Node
`>=22.14.0`, and npm `>=11.5.1`. The release workflow checks the npm floor and
grants OIDC only to its publish job.

## Forthcoming beta.6 Candidate

The source checkout may carry `0.2.0-beta.6` as a local candidate for Gate A
review. This candidate records the aligned AST-first storefront copy,
deterministic provider-free `createUser` demo, original visual assets,
progressive CLI and Action documentation, and no runtime, provider, MCP,
security, or model change. The intended publication path is OIDC only, and it
requires a separate human decision after the candidate gates pass.

Before that decision, verify the candidate gate with `npm run test:public-beta`.
It must prove the candidate version is absent from npm, the legacy unscoped
beta.3 collision remains absent, npm `beta` remains `0.2.0-beta.5`, and npm
`latest` remains `0.2.0-beta.4`. Do not create or push a tag, publish a package,
move a dist-tag, or create a GitHub release during this candidate window.

## Failure Handling

- Before npm accepts the package, stop on any identity, version, name,
  permission, checksum, smoke, authentication, or provenance mismatch. Do not
  push another tag as an experiment.
- An npm version is immutable after successful publication. Never attempt to
  overwrite or silently replace it.
- If npm succeeds but GitHub prerelease creation fails, preserve the workflow
  evidence, verify the registry state, and repair only the missing GitHub
  release in a separately reviewed operation.
- If the beta dist-tag is wrong, inspect registry state before changing it.
  Never try to remove npm's required `latest` tag; prerelease documentation and
  tests must use explicit `@beta` instead of treating `latest` as supported.
- Do not delete logs or artifacts while diagnosing a partial release.

## Primary References

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
- [npm dist-tags](https://docs.npmjs.com/cli/dist-tag/)
- [npm registry package metadata](https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md)
