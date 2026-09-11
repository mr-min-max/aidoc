# StaleDocs GitHub Action

The StaleDocs Action reviews pull requests for deterministic documentation drift. Review
mode reports only the drift this pull request introduces; pre-existing stale
documentation is not reported. It uses no model, API key, or repository write for
analysis.

## Review mode

Add one workflow to a repository:

```yaml
name: StaleDocs review
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - uses: mr-min-max/staledocs@v0.3.0-beta.1
        with:
          mode: review
          fail-on: none
```

The review workflow is pinned to the current release candidate. The moving `@v0`
major convenience pin is available after publication and may move to a later
release. The check and generate examples below use the same release candidate.

The comment starts with a hidden marker and lists changed signatures, affected
sections, and whether each section changed in the pull request:

```markdown
<!-- staledocs-review -->
### StaleDocs: documentation impact

**1 public API change**, 0 potentially breaking. **1 documentation section** mention changed symbols and were not updated in this PR.

| Symbol | Change | Before | After |
| --- | --- | --- | --- |
| `createUser` | parameters | `createUser(email: string): string` | `createUser(email: string, role: string): string` |
| `helperExport` | now exported |  | `helperExport(): void` |

**Needs a documentation update**
- `README.md` > API: `createUser`

Public boundary (TypeScript): `src/index.ts`. 2 internal changes not shown.

<sub>Deterministic AST analysis; no model was used. Suppress a symbol with `.staledocsignore`. <a href="https://github.com/mr-min-max/staledocs">StaleDocs</a></sub>
```

Review mode needs `permissions: contents: read` and `pull-requests: write` for
comments and labels. Use `actions/checkout` with `fetch-depth: 0`, because the
planner needs the pull request base commit. A fork pull request can have a
read-only token. In that case the Action emits a notice and writes the Markdown
report to the job summary without failing because of posting.

The review mode wording is intentional: review mode reports only the public drift
this pull request introduces; the footer names the resolved boundary and reports
hidden internal changes. Pre-existing stale documentation is not reported.

### Review inputs

| Input | Default | Behavior |
| --- | --- | --- |
| `mode` | `review` | `review`, `check`, or `generate`; review is the default. |
| `fail-on` | `none` | `none`, `stale`, or `breaking`. The report is still produced before an opt-in failure. |
| `comment` | `true` | Update the token user's marked comment, post it if absent, or delete it when there are no public API changes. |
| `labels` | `true` | Ensure and update `docs-stale` and `breaking-change`. A missing label on deletion is tolerated. |
| `github-token` | `${{ github.token }}` | Token used for pull request API calls. |
| `source` | `npm` | `npm` installs the package version from this Action ref. `local` runs `npm ci`, `npm run build`, and `npm link`. |

In review mode, `provider`, `api-key`, `model`, `commands`, `output-dir`, and
`auto-commit` are ignored. The Action resolves the pull request base and head
SHAs from the event, writes JSON to its temporary report path, and exposes
`verdict`, `public-api-changes`, `stale-documents`, `breaking`, and `report`.
Non-pull-request runs use `since` as the base, inspect the working tree, print the
text report, and do not invoke `gh`.

Labels use the following stable metadata:

- `docs-stale`, color `e4e669`, description `Documentation sections mentioning changed public symbols are stale`;
- `breaking-change`, color `d73a4a`, description `Potentially breaking public API changes detected`.

### Suppressions

Create `.staledocsignore` at the repository root. Each line is an exact symbol or a
small glob, a source path glob, or a Markdown documentation path glob:

```text
# symbols
UserService.*
# source paths
src/internal/**
# documentation paths
docs/legacy/*.md
```

Blank lines and `#` comments are ignored. Suppressions are deliberate, not a
baseline: a new adopter sees existing stale documentation once and can then add
specific entries.

## Check mode

Check mode is provider-free and reports only whether selected documents changed with
public symbols they directly mention. It does not compare prose correctness.

```yaml
- uses: mr-min-max/staledocs@v0.3.0-beta.1
  with:
    mode: check
    since: ${{ github.event.pull_request.base.sha }}
    commands: readme,api
```

The `commands` input is a comma-separated list of `readme`, `api`, `changelog`, and
`diagram`. Check mode does not need an API key. The checkout must contain `since`.

## Generate mode

Generate mode remains available for provider-backed documentation creation:

```yaml
- uses: mr-min-max/staledocs@v0.3.0-beta.1
  with:
    mode: generate
    provider: openai
    api-key: ${{ secrets.OPENAI_API_KEY }}
    model: gpt-5.6-luna
    commands: readme,api
```

Generate mode accepts the existing `provider`, `api-key`, `model`, `commands`,
`output-dir`, `dry-run`, and `auto-commit` inputs. `auto-commit` is opt-in and
requires `contents: write`; it stages only paths emitted by StaleDocs.

## Outputs

The Action exposes these outputs:

| Output | Meaning |
| --- | --- |
| `verdict` | `clean`, `stale`, or `breaking` in review mode. |
| `public-api-changes` | Number of contract-level public changes. |
| `stale-documents` | Number of stale documentation files. |
| `breaking` | Number of potentially breaking changes. |
| `report` | Temporary path to the complete JSON review report. |
| `changed`, `files`, `summary` | Existing generate/check outputs. |

Review comments are deterministic, contain no timestamps, and are owned by the
GitHub token user as well as the `<!-- staledocs-review -->` marker. A token cannot
modify another user's marked comment.

For provider credentials, Trust Gate behavior, and MCP boundaries, see
[PUBLIC_BETA.md](./PUBLIC_BETA.md) and [LIMITATIONS.md](./LIMITATIONS.md). For the CLI
review command and suppression syntax, see [CLI.md](./CLI.md).
