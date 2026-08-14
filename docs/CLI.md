# AiDoc CLI reference

This is the complete command catalogue for the published `0.2.0-beta.5`
CLI. The executable is `aidoc`. For provider credentials, subscription and API
billing boundaries, and repository safety details, see the [Public Beta guide](./PUBLIC_BETA.md)
and [SECURITY.md](../SECURITY.md).

## Invocation and provider boundary

Install the beta from npm with the explicit channel:

```bash
npm install -g @mr-min-max/aidoc-gen@beta
aidoc --version
```

The global options are:

| Option      | Behavior                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| `--version` | Print the installed CLI version.                                                     |
| `--verbose` | Enable verbose debug logging.                                                        |
| `--mcp`     | Start the local Model Context Protocol server instead of the CLI command dispatcher. |

Real generation commands use a configured direct provider or an explicit local
Ollama model. The `--mock` option is the credential-free test path. Planning,
checking, scoring without `--output`, and the MCP prepare/validate workflow are
provider-free. The MCP workflow prepares and validates Markdown but never writes
the repository; the host decides whether to apply the approved Markdown under
its normal permission boundary.

All document writes use the repository-contained safety checks described in the
[Public Beta guide](./PUBLIC_BETA.md). A dry run previews output without
writing. `--yes` applies a generated diff without the normal interactive
confirmation where that option is available.

## Default `aidoc` workflow

Run `aidoc` in an interactive terminal to plan the current repository first.
The plan is deterministic and provider-free. If supported source changes affect
a safe Markdown target, AiDoc asks whether to prepare an update and then enters
the normal provider-backed update flow. It does not write documentation merely
because the command was run.

In a changed repository, the bare command is a convenient plan-first entry
point. In a clean repository there is no change impact to demonstrate; use the
seeded provider-free storefront fixture instead:

```bash
npm run demo:storefront
```

In a non-interactive terminal, bare `aidoc` prints its short command help. Use
`aidoc plan` or another explicit command for automation.

## Create project documentation

The `readme`, `api`, `diagram`, and `annotate` commands analyze supported source
files through the AST before a real provider generation request. `changelog`
instead uses normalized Git commit metadata. They accept `--mock` for local
tests and demos.

### `aidoc readme`

Generates `README.md` from code analysis.

```bash
aidoc readme
aidoc readme --output docs/README.md
aidoc readme --dry-run
aidoc readme --yes --strict-output
aidoc readme --no-badges
aidoc readme --mock
```

Options:

- `-o, --output <path>` changes the output file. The default is `./README.md`.
- `--dry-run` previews the generated document without writing.
- `--yes` applies the generated changes without an interactive prompt.
- `--strict-output` fails instead of writing malformed Markdown.
- `--no-badges` disables badge generation in the generated README.
- `--mock` uses the mock generator and does not require a provider credential.

### `aidoc api`

Generates API documentation from the analyzed modules. The default output is
`./docs/API.md`.

```bash
aidoc api
aidoc api --output docs/API.md
aidoc api --dry-run --strict-output
aidoc api --yes
aidoc api --mock
```

The options are `-o, --output <path>`, `--dry-run`, `--yes`,
`--strict-output`, and `--mock` with the same meanings as `readme`.

### `aidoc changelog`

Generates a changelog entry from Git history and prepends it to the changelog
file. If the file already begins with the standard `# Changelog` header, that
header is retained while the new entry is inserted after it.

```bash
aidoc changelog
aidoc changelog --from v0.2.0-beta.4 --to HEAD
aidoc changelog --version 0.2.0-beta.6
aidoc changelog --output docs/CHANGELOG.md
aidoc changelog --dry-run --yes --strict-output
aidoc changelog --mock
```

Options:

- `--from <ref>` selects the starting tag, commit, or branch. The default is
  the latest tag, or `HEAD~20` when no tag is available.
- `--to <ref>` selects the ending ref. The default is `HEAD`.
- `--version <ver>` names the entry. The default is `Unreleased`.
- `-o, --output <path>` changes the output file. The default is
  `./CHANGELOG.md`.
- `--dry-run`, `--yes`, `--strict-output`, and `--mock` behave as described
  above.

### `aidoc diagram`

Generates a Mermaid architecture diagram from code analysis and wraps it in an
`# Architecture` Markdown document.

```bash
aidoc diagram
aidoc diagram --output docs/architecture.md
aidoc diagram --dry-run --strict-output
aidoc diagram --yes
aidoc diagram --mock
```

The default output is `./docs/architecture.md`. The options are
`-o, --output <path>`, `--dry-run`, `--yes`, `--strict-output`, and `--mock`.

### `aidoc annotate`

Generates JSDoc or TSDoc comments for undocumented functions and shows each
proposed source diff. Without `--dry-run`, the command asks before applying
each proposed annotation. `--dry-run` previews proposals and skips writes.

```bash
aidoc annotate --all
aidoc annotate --file src/index.ts
aidoc annotate --all --dry-run
aidoc annotate --all --mock
```

Options:

- `--file <path>` limits analysis to one source file.
- `--all` considers all configured source files.
- `--dry-run` previews annotations without writing or prompting for approval.
- `--mock` uses the mock generator without a provider credential.

## Keep documentation current

### `aidoc plan`

Creates a deterministic AST-backed documentation-impact plan from Git changes.
It does not construct a provider, call a model, or write a file. Human output
is intended for review. JSON output is a versioned
`aidoc.impact-plan.v1` success or error envelope.

```bash
aidoc plan
aidoc plan --json
aidoc plan --base origin/main
aidoc plan --base v1.2.0 --head release-candidate
aidoc plan --max-context-bytes 24000
```

Options:

- `--base <ref>` selects the comparison base. Without it, AiDoc uses
  `AIDOC_BASE_REF` when configured; otherwise it checks the remote default
  branch, `origin/main`, `main`, `origin/master`, `master`, and then `HEAD~1`.
- `--head <ref>` compares two immutable commits. Without it, the selected base
  is compared with the current working tree.
- `--json` emits only the versioned JSON result.
- `--max-context-bytes <count>` overrides the deterministic provider-context
  byte ceiling. It does not permit raw source or raw diffs into that context.

The first commit is compared with Git's empty tree. A shallow repository must
contain the selected base. A supported source file that cannot be parsed stops
the plan before provider construction or a document write.

### `aidoc update`

Runs the plan first, resolves affected Markdown targets, selects targets, and
then generates updates. It never guesses through an ambiguous target. With no
explicit target, one safe affected Markdown target is selected automatically;
multiple targets require `--target` or `--all`.

```bash
aidoc update
aidoc update --target README.md
aidoc update --target README.md --target docs/API.md
aidoc update --all
aidoc update --base origin/main --dry-run
aidoc update --since HEAD~5 --provider openai --model gpt-5.6-luna
```

Options:

- `--base <ref>` selects the comparison base.
- `--since <ref>` is a compatibility alias for `--base`. If both are supplied,
  they must match.
- `--target <file>` selects an existing Markdown target. It can be repeated.
- `--all` updates every automatically affected document. It cannot be combined
  with `--target`.
- `--provider <name>` selects a direct provider profile.
- `--model <model>` overrides the provider model.
- `--provider-base-url <url>` sets an advanced compatible-provider base URL.
- `--allow-local-http` allows confirmed loopback HTTP for a compatible provider.
- `--yes` applies every generated diff without prompting.
- `--dry-run` previews the update without writing.
- `--mock` uses the mock response for tests.

Target selection and repository checks happen before provider construction. If
there is no documentation impact, the command prints the plan and exits without
provider setup. If the user cancels selection or provider setup, no model
request is sent. For multiple selected targets, progress and partial-failure
messages identify how many targets were processed.

### `aidoc watch`

Watches configured source globs and regenerates one document when a relevant
source change is detected. The process stays alive until interrupted.

```bash
aidoc watch
aidoc watch --target docs/README.md
aidoc watch --target docs/README.md --auto
aidoc watch --mock
```

Options:

- `--target <file>` selects the document. The default is `./README.md`.
- `--auto` writes without prompting. Without it, the normal write confirmation
  remains in place.
- `--mock` uses the mock generator without an API key.

Live generation uses a configured direct provider or explicit local Ollama
model. Watch mode uses the same repository-contained write and Trust Gate
boundaries as other real CLI generation.

### `aidoc check`

Runs the AST-backed source/document co-change guard. It parses changed supported
source files and checks whether the selected Markdown target changed in the same
Git range. It does not compare generated prose and is not semantic proof that a
document is correct.

```bash
aidoc check
aidoc check --target docs/API.md --since origin/main
aidoc check --json
```

Options:

- `--target <file>` selects the document. The default is `README.md`.
- `--since <ref>` selects the Git ref. The default is `HEAD~1`.
- `--json` emits the machine-readable freshness report.

The report status is `clean`, `co-changed`, `stale`, `missing`, or
`unknown`. `clean` and `co-changed` exit with status `0`; `stale` and
`missing` exit with status `1`; operationally unknown results exit with
status `2`.

### `aidoc score`

Calculates AST-derived documentation coverage for exported symbols. The score
is a coverage measure, not a judgment of prose quality. It performs no provider
request.

```bash
aidoc score
aidoc score --json
aidoc score --min 80
aidoc score --dir src --output docs/score.md
aidoc score --output docs/score.md --dry-run
```

Options:

- `--dir <path>` selects the directory to analyze. The default is the current
  working directory.
- `-o, --output <path>` writes a Markdown report to the path.
- `--json` emits the score result as JSON instead of the human report.
- `--min <n>` exits non-zero when the score is below the threshold.
- `--dry-run` previews an output report without writing it.

Without `--output`, score is non-mutating. With an output path, normal
repository write safety applies.

## Related setup

- [Public Beta boundaries](./PUBLIC_BETA.md) covers provider profiles, API
  billing, Qwen PAYG, Ollama discovery, Trust Gate, and MCP scope.
- [GitHub Action reference](./GITHUB_ACTION.md) covers the composite Action's
  inputs, outputs, modes, and auto-commit boundary.
- [Codex local MCP setup](./integrations/codex.md) and [Claude local MCP setup](./integrations/claude.md)
  cover host-managed preparation and validation.
- [Security policy](../SECURITY.md) is the private reporting path for security
  issues.
