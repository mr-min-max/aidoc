# Releasing AiDoc

This is the maintainer procedure for publishing AiDoc. It separates repository
preparation from irreversible external release actions.

## Release Boundary

Merging a release-readiness pull request does not publish a package. The
release workflow runs only after a matching `v*` tag is pushed. Do not create
or push a release tag without a separate explicit publication decision made
after every pre-release check below passes.

The first npm beta is `@mr-min-max/aidoc-gen@0.2.0-beta.4`. It must use the npm
`beta` dist-tag, not `latest`.

The public `v0.2.0-beta.3` tag records a failed first-publication attempt. npm
verified provenance but rejected the unscoped name under its package-similarity
policy; no npm version or GitHub Release was created. That tag must not be
moved, deleted, repointed, rerun, or reused. Recovery continues only through
the scoped beta.4 package and a new tag.

## Pre-release Verification

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

3. Before the first publication, verify that the package name is still
   available. A registry `404` is the expected unpublished result:

   ```bash
   npm view @mr-min-max/aidoc-gen@0.2.0-beta.4 version --json
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

## First-publication Bootstrap

npm Trusted Publishing is configured on an existing package, so the first
version needs a temporary bootstrap credential.

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

## Publication

Continue only in the same trusted shell session, after the maintainer explicitly
authorizes publication. Re-fetch `main` and prove both the remote tip and local
checkout still equal the one SHA that passed every gate. If either comparison
fails, do not tag; restart pre-release verification at the new commit.

1. Revalidate and create an annotated tag at that exact verified commit:

   ```bash
   test "${release_verified_sha:-}" = "$release_sha" &&
   git fetch origin main &&
   node scripts/verify-release-candidate.mjs --main-ref origin/main --candidate-ref HEAD --tag v0.2.0-beta.4 --expected-sha "$release_sha" &&
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

Verify every external surface before updating installation documentation:

```bash
npm view @mr-min-max/aidoc-gen@0.2.0-beta.4 version --json
npm dist-tag ls @mr-min-max/aidoc-gen
gh release view v0.2.0-beta.4 --repo mr-min-max/aidoc
```

The `beta` dist-tag must point to `0.2.0-beta.4`; `latest` must not point to the
prerelease. Confirm npm displays provenance from `mr-min-max/aidoc`, download
the release tarball and checksum, verify the checksum, and repeat the packed
CLI/MCP smoke against those exact bytes.

Only after this proof may public documentation claim that npm installation or
a GitHub prerelease exists.

## OIDC Migration and Token Cleanup

After the first package exists:

1. In the npm package settings, configure Trusted Publishing with:
   - provider: GitHub Actions;
   - owner: `mr-min-max`;
   - repository: `aidoc`;
   - workflow filename: `release.yml`;
   - allowed action: `npm publish`.
2. Keep the npm token active temporarily as an off-GitHub recovery credential,
   but delete the GitHub bootstrap secret before the OIDC verification run:

   ```bash
   gh secret delete NPM_TOKEN --repo mr-min-max/aidoc
   ```

3. Publish the next intentionally versioned prerelease through the same
   workflow. Because the secret is absent, the run must fail rather than fall
   back to token authentication. Verify that npm accepted the OIDC identity and
   generated provenance.
4. After OIDC succeeds, revoke the granular npm bootstrap token and configure
   npm to disallow traditional token publishing for the package. Remove the
   now-obsolete `NODE_AUTH_TOKEN` wiring in a reviewed follow-up change.

If OIDC fails, diagnose the trust configuration first. Restoring the bootstrap
secret requires a separate deliberate recovery decision; do not silently add
it back during the failed run.

Trusted Publishing requires a GitHub-hosted runner, `id-token: write`, Node
`>=22.14.0`, and npm `>=11.5.1`. The release workflow checks the npm floor and
grants OIDC only to its publish job.

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
  Do not assign `latest` to a prerelease.
- Do not delete logs or artifacts while diagnosing a partial release.

## Primary References

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
- [npm dist-tags](https://docs.npmjs.com/cli/dist-tag/)
