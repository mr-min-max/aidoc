# AiDoc Public Beta

This page describes the forthcoming/source-checkout `0.2.0-beta.3`
integration. The repository package metadata remains curator-owned in this
slice: beta.3 is not claimed to be published to npm, installed from a
marketplace, or available through ChatGPT web local STDIO.

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

Ollama is local but requires an explicit model. Qwen custom AiDoc calls are
pay-as-you-go API use; a Qwen consumer or coding-plan subscription is not a
subscription bridge for AiDoc.

## Source-checkout setup

From a checkout, use the following development setup:

```bash
npm install
npm run build
npm link
aidoc --version
```

Reverse the global development link with:

```bash
npm unlink -g aidoc-gen
```

The repository-owned Codex plugin lives at
`integrations/codex/aidoc`. After `npm link`, the copyable local Codex MCP
setup is:

```bash
codex mcp add aidoc -- aidoc --mcp
codex mcp list
```

Verify with `/mcp` in Codex if preferred, and reverse with
`codex mcp remove aidoc`. No marketplace entry or public plugin installation
is created by this source-checkout slice; marketplace distribution is a later
step.

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
- npm publication, a GitHub release/tag, and marketplace distribution are not
  part of this source-checkout slice.
- Beta behavior and versioned JSON envelopes may evolve before v1.

Report reproducible issues with the command, fixture, and observed output.
Security issues should use the private reporting path in `SECURITY.md`.
