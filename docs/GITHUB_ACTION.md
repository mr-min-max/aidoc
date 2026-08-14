# AiDoc GitHub Action

This document describes the composite Action at the repository root. The
examples use the currently published beta.5 tag:

```yaml
- uses: mr-min-max/aidoc@v0.2.0-beta.5
```

The Action's install step reads the AiDoc package version from the same Action
ref and installs @mr-min-max/aidoc-gen at that version globally. This keeps the
runtime package and Action source on one reviewed beta.5 ref.

For the complete command catalogue, see [CLI.md](./CLI.md). For provider
credentials, billing, Ollama discovery, Trust Gate details, and public beta
boundaries, see [PUBLIC_BETA.md](./PUBLIC_BETA.md).

## Modes and commands

The mode input accepts exactly:

- generate creates or updates the selected documentation files;
- check runs the deterministic AST-backed source/document co-change guard.

The commands input is a comma-separated list. Each value is trimmed and must
be one of:

- readme, which targets ./README.md;
- api, which targets <output-dir>/API.md;
- changelog, which targets ./CHANGELOG.md;
- diagram, which targets <output-dir>/architecture.md.

In generate mode, each command invokes the corresponding CLI command with
--output, --yes, and --strict-output. In check mode, each command invokes
aidoc check --target <file> --since <since>. Check mode does not generate or
write documentation and does not need an API key.

## Inputs

| Input        | Default  | Accepted values and behavior                                                                                                                                          |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| provider     | openai   | openai, anthropic, or ollama. Other values fail before AiDoc starts.                                                                                                  |
| api-key      | empty    | Passed to the selected remote provider as its API key. In generate mode, openai and anthropic require a non-empty value. It is not required for ollama or check mode. |
| trust-policy | strict   | warn, redact, or strict. Invalid values fail before AiDoc starts.                                                                                                     |
| model        | empty    | Model override passed through as AIDOC_MODEL. Ollama requires an explicit installed model for a real non-interactive generation run.                                  |
| commands     | readme   | Comma-separated values from readme, api, changelog, and diagram.                                                                                                      |
| mode         | generate | generate or check.                                                                                                                                                    |
| output-dir   | ./docs   | Directory used by the api and diagram command targets.                                                                                                                |
| auto-commit  | false    | When true, enables the separate auto-commit step after changed generated files are reported. It has no effect in check or dry-run mode.                               |
| dry-run      | false    | true or false. In generate mode, previews without writing and reports no changed files.                                                                               |
| since        | HEAD~1   | Git ref passed to check mode. The checkout must contain the ref.                                                                                                      |

The Action passes the selected trust policy through AIDOC_TRUST_POLICY and
marks the process as Action-originated. It passes the provider, model, command
list, mode, output directory, dry-run flag, and since value to the runner.

## Outputs

The composite step exposes these outputs from the step with id aidoc:

| Output  | Meaning                                                                             |
| ------- | ----------------------------------------------------------------------------------- |
| changed | true when a non-dry-run generate command changed a target file; otherwise false.    |
| files   | Newline-delimited documentation paths whose checksums changed during generate mode. |
| summary | Human-readable lines for each generated command or successful co-change check.      |

For a generate run, the runner compares each target checksum before and after
the CLI call. A dry run deliberately does not compare or report changed files.
For check mode, changed remains false and files remains empty when the checks
pass.

## Provider and credential requirements

The Action supports the provider values implemented by action/run.sh: openai,
anthropic, and ollama.

- For generate mode with openai, set api-key from a GitHub Actions secret. The
  runner exports it as OPENAI_API_KEY.
- For generate mode with anthropic, set api-key from a GitHub Actions secret.
  The runner exports it as ANTHROPIC_API_KEY.
- For ollama, the runner does not export a remote API key. Provide an explicit
  installed Ollama model through model and use a runner where the local Ollama
  service is available.
- Check mode is deterministic and does not require api-key, but it still
  requires a complete checkout containing the since ref. Use actions/checkout
  with fetch-depth: 0 when the base is outside the default shallow history.

Consumer subscriptions for Codex or Claude are not Action API credentials. The
Action's supported provider list is narrower than the direct CLI provider
registry; use [PUBLIC_BETA.md](./PUBLIC_BETA.md) for the separate direct CLI
profiles.

## Trust-policy behavior

The default is strict, and the Action exports the selected policy over project
configuration. The Trust Gate evaluates rendered provider input and completed
provider output:

- strict blocks a finding;
- redact replaces detected values with typed placeholders;
- warn preserves detected text while reporting findings.

The Action runner does not reinterpret these findings. A failed Trust Gate
causes the underlying aidoc command to fail, so no changed-file output is
claimed for that command. Trust Gate is not a prompt-injection defense or an
operating-system sandbox; repository and host permissions still matter.

## Generate example

Use readme and API generation with a secret-backed provider:

```yaml
name: Documentation

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mr-min-max/aidoc@v0.2.0-beta.5
        with:
          provider: openai
          api-key: ${{ secrets.OPENAI_API_KEY }}
          model: gpt-5.6-luna
          commands: readme,api
          trust-policy: strict
```

Generation uses --yes and --strict-output for each selected command. It still
requires a provider path and the repository writer's normal safety checks. Add
dry-run: true to preview the command without writing.

## Check example

Use check mode to guard documentation co-change in a pull request:

```yaml
name: Documentation freshness

on:
  pull_request:

permissions:
  contents: read

jobs:
  docs-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: mr-min-max/aidoc@v0.2.0-beta.5
        with:
          mode: check
          since: ${{ github.event.pull_request.base.sha }}
          commands: readme,api
```

Check mode reports a document as stale when AST-parseable source changed in
the selected range without the target document changing in that range. A
successful co-changed result does not prove that the document content is
semantically correct, and check mode never compares non-deterministic LLM
output.

For a push workflow, the repository's prior commit can be supplied with
${{ github.event.before }} when that ref is present in the checkout.

## Dry runs and changed files

Set dry-run: true in generate mode to preview each selected command. The runner
still invokes the command with --dry-run, but it does not compare checksums or
append paths to the changed-file list. The changed output is false and the
files output is empty. The summary describes the command that was attempted.

Without dry-run, a generated path is reported only when its checksum differs
after the command returns successfully. The temporary changed-file list is
used by the auto-commit step and contains only those emitted paths.

## Auto-commit and push boundary

Auto-commit runs only when all of these are true:

- auto-commit: true;
- mode: generate;
- dry-run: false;
- the aidoc step reports changed=true.

Before staging, the Action configures the bot identity:

```text
aidoc[bot] <aidoc[bot]@users.noreply.github.com>
```

It then refuses to continue if the checkout already has any staged changes.
This protects staged work that was present before the Action started. If the
index is clean, it runs git add -- <file> only for paths emitted by AiDoc. It
does not run git add -A and does not stage unrelated changes. When the scoped
index has a diff, it creates exactly this commit:

```text
docs: update documentation via aidoc [skip ci]
```

Finally it runs git push. A workflow that enables this step needs
permissions: contents: write; read-only workflows should leave auto-commit
disabled. The Action does not open pull requests, install a marketplace
package, or provide a provider credential.

## Security recommendations

- Pin the Action to the reviewed beta.5 ref shown above rather than using a
  moving branch.
- Store remote provider keys in GitHub Actions secrets and pass them only to
  api-key.
- Use permissions: contents: read for check and dry-run workflows.
- Grant contents: write only when the scoped auto-commit and push behavior is
  intentional.
- Use fetch-depth: 0 for check ranges that require a pull request base or
  another ref not present in a shallow checkout.
- Review generated diffs. The co-change guard is an AST-backed freshness check,
  not semantic validation of prose.

Report reproducible Action issues with the command, workflow inputs, and
observed output. Use [SECURITY.md](../SECURITY.md) for private security reports.
