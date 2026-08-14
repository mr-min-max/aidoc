# AiDoc Public Beta

`0.2.0-beta.5` is published to npm as `@mr-min-max/aidoc-gen` and as a
[GitHub prerelease](https://github.com/mr-min-max/aidoc/releases/tag/v0.2.0-beta.5);
the executable remains `aidoc`. The release was published by GitHub Actions
through npm Trusted Publishing (OIDC), without a reusable npm credential in
the workflow. The repository-owned Codex plugin is not installed from a
marketplace, and ChatGPT web does not read local STDIO.

AiDoc requires Node.js `>=22.12.0`.

## Fast paths

The simple CLI entry points are:

```bash
aidoc
aidoc plan
aidoc update
```

`aidoc plan` is deterministic, AST-backed, and provider-free. It does not
require a key, login, or network request. Bare `aidoc` begins with the same
provider-free plan and offers an update only when a safe target is indicated.
If you accept an update, generation still needs either explicit direct-provider
setup or the separate host-managed MCP candidate path. One affected Markdown
target is selected automatically; multiple targets require an explicit
`--target` or `--all`. AiDoc never guesses through target ambiguity, and a
no-impact plan has no misleading update next action.

`aidoc update --dry-run --mock` is a credential-free local demonstration path.
Real non-empty generation uses the direct provider path described below, unless
the host-managed MCP workflow supplies the model candidate.

## Subscription-hosted local MCP

ChatGPT subscription use means signing in to the official local Codex host and
letting it invoke AiDoc through local STDIO MCP. A ChatGPT Plus/Pro
subscription is host authentication, not an OpenAI API key. AiDoc receives no
ChatGPT OAuth token. ChatGPT web does not read local Codex configuration or
local STDIO servers.

Claude subscription use means using Claude Desktop or Claude Code as the local
MCP host. Claude authenticates itself; AiDoc receives no Claude subscription
token or OAuth credential. Consumer subscriptions and API billing are
separate for both ecosystems.

### Pinned repository boundary

Each MCP server is pinned to the canonical Git worktree containing its startup
cwd. One MCP server serves one repository; to work on another repository,
start another server from that repository. The worktree root and real
subdirectories are allowed, including absolute in-worktree paths and
repository-relative directory paths.

External paths, parent traversal, `.git` or other Git metadata, missing or
non-directory paths, and every symlink or junction path fail closed before
project reads. Successful MCP path fields are repository-relative POSIX paths.

MCP configuration search is bounded from the selected directory up to the
pinned root. MCP accepts declarative JSON/YAML/no-extension configuration,
`package.json#aidoc`, and the bounded root `.env` allowlist. It rejects
malformed or symlinked selected configuration, executable JavaScript,
TypeScript, CJS, or MJS configuration, and the legacy secret-bearing `apiKey`
field. Direct CLI cosmiconfig and dotenv behavior remains unchanged.

This is a repository path/read boundary, not an operating-system sandbox. A
privileged same-host process can race entries between checks, hard links are
indistinguishable from ordinary repository files at this API level, and
network access remains controlled by the selected provider transport and Trust
Gate.

The host-managed update sequence is:

1. Call `prepare_documentation_update`.
2. If multiple targets are returned, ask the user to choose a safe relative
   target; never guess.
3. Generate one complete Markdown candidate from the returned
   `generation.system_prompt` and `generation.prompt` only.
4. Call `validate_documentation_draft` with the unchanged preparation digest,
   target, and exact candidate Markdown.
5. Stop or reprepare when validation is invalid, stale, blocked, or asks for a
   fresh preparation.
6. Show the approved safe diff metadata, obtain the host's normal write
   permission, apply only `approved_markdown` to the exact approved relative
   target, and then call `check_docs_freshness`.

AiDoc Trust Gate inspects AiDoc's prepared input and validated output for
secret findings. Configured `strict` blocks findings; configured `warn` or
`redact` redacts detected sensitive values before host generation or return.
An `allowed` result means no findings were detected. Trust Gate does not
control the host's context window, model, sandbox, isolation, or permission
system. The host's official permissions remain authoritative.

See [Codex integration](./integrations/codex.md) and [Claude integration](./integrations/claude.md).

## Direct AiDoc provider mode

Direct provider mode is separate from consumer subscriptions and never silently
falls back to another provider. The exact built-in profiles are:

| Profile             | Credential or requirement                                   | Billing/boundary                   |
| ------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `openai`            | `OPENAI_API_KEY`                                            | OpenAI API billing, remote         |
| `anthropic`         | `ANTHROPIC_API_KEY`                                         | Anthropic API billing, remote      |
| `deepseek`          | `DEEPSEEK_API_KEY`                                          | DeepSeek API billing, remote       |
| `qwen`              | `DASHSCOPE_API_KEY`                                         | Qwen Model Studio PAYG API, remote |
| `openai-compatible` | `AIDOC_COMPAT_API_KEY` plus an explicitly approved endpoint | Remote API billing                 |
| `ollama`            | Local Ollama and an explicit installed model                | Local                              |

Ollama is local but requires an explicit model. In an interactive terminal,
when no Ollama model is configured, AiDoc uses the approved loopback
`/api/tags` endpoint to discover installed models and asks you to select one.
It never downloads a model. Non-interactive runs must set `AIDOC_PROVIDER` and
`AIDOC_MODEL` explicitly. Qwen custom AiDoc calls are pay-as-you-go API use; a
Qwen consumer or coding-plan subscription is not a subscription bridge for
AiDoc.

## Installation

Install the published prerelease through the explicit beta channel:

```bash
npm install -g @mr-min-max/aidoc-gen@beta
aidoc --version
```

npm requires every package to have a `latest` tag. AiDoc still publishes this
prerelease with `--tag beta`, and `@beta` is the supported install path while
the project remains pre-v1.

For development from a source checkout:

```bash
npm install
npm run build
npm link
aidoc --version
```

Reverse the global development link with:

```bash
npm unlink -g @mr-min-max/aidoc-gen
```

The repository-owned Codex plugin lives at
`integrations/codex/aidoc`. After the npm install or `npm link`, the copyable
local Codex MCP setup is:

```bash
codex mcp add aidoc -- aidoc --mcp
codex mcp list
```

Verify with `/mcp` in Codex if preferred, and reverse with
`codex mcp remove aidoc`. No marketplace entry or public plugin installation
exists yet; marketplace distribution is a later step.

## Repository-contained safety

Planning is AST-first: supported source files are parsed before any provider
could be constructed, and raw source, raw diffs, prompts, and credentials are
not part of the bounded impact context. The repository writer rejects unsafe
paths, symlinks, and stale snapshots and uses same-directory atomic
replacement. These controls are repository-contained checks, not an operating
system sandbox or a guarantee about what a host model can see.

Trust Gate redaction is not a prompt-injection defense. Review the approved
diff and host permission request before applying documentation.

## Beta boundaries

- Planning does not prove that generated prose is semantically correct.
- Provider-backed direct generation can be incorrect; review every diff.
- Local MCP preparation/validation does not write the repository.
- A host subscription does not provide a general AiDoc or vendor API key.
- ChatGPT web local STDIO support is not part of this beta.
- npm publication and the GitHub prerelease are available; marketplace
  distribution is not part of this beta.
- Beta behavior and versioned JSON envelopes may evolve before v1.

Report reproducible issues with the command, fixture, and observed output.
Security issues should use the private reporting path in `SECURITY.md`.
