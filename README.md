# 🤖 aidoc

> **AI-powered documentation generator for codebases.**

> [!IMPORTANT]
> **Public Beta source-checkout integration (`0.2.0-beta.3` forthcoming).**
> The repository is ready for early testing on Node.js `>=22.12.0`. The beta.3
> plugin/integration is source-checkout work in this task; it is not an npm
> artifact, marketplace installation, or ChatGPT-web local-STDIO integration.
> `aidoc plan` is deterministic and provider-free. Feedback and focused
> contributions are welcome before v1.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.12-green.svg)](https://nodejs.org/)
[![CI](https://github.com/mr-min-max/aidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-min-max/aidoc/actions)

`aidoc` is a CLI tool that analyzes your codebase using **AST parsing** before generating documentation (READMEs, API docs, JSDocs, changelogs, and architecture diagrams) with a configured LLM provider.

It is specifically designed for **Open Source maintainers** who want to spend less time writing docs and more time writing code.

---

## ✨ Features

- 🧠 **AST-Powered Context** — Doesn't just read text; understands your code structure (functions, classes, exports) via `ts-morph` (TypeScript) and Python's `ast` module.
- 🐍 **Multi-Language** — Built-in support for TypeScript, JavaScript, and Python with real AST parsing. Extensible parser architecture for adding more languages.
- 🔄 **Impact-Aware Updates** — `aidoc update` builds a deterministic,
  byte-bounded semantic impact plan before provider construction; raw source
  and raw Git diffs are excluded from provider impact context.
- 🏠 **Local Provider Option** — Use **Ollama** when the model and code context should stay on your machine; OpenAI and Anthropic are remote provider options.
- 🎨 **Packaged Prompts** — Built-in Handlebars prompt templates ship with the npm package.
- 🚀 **GitHub Action** — Automate documentation generation and AST-backed source/document co-change checks with `mr-min-max/aidoc`.
- 🔌 **MCP Server** — Let a local Codex, Claude Desktop, or Claude Code host
  run the provider-free preparation/validation workflow via Model Context
  Protocol (MCP).
- ⚡ **In-Process Caching** — Repeated analysis in one process, such as watch mode, can reuse AST parsing results.
- 🔁 **Resilient** — Built-in retry with exponential backoff for API rate limits and transient errors (wired into every provider).
- 📊 **Doc Health Scoring** — `aidoc score` grades documentation coverage 0–100 from the AST. No LLM, no API key, instant — with a CI gate (`--min`).
- 👁️ **Live Watch Mode** — `aidoc watch` regenerates docs as you save files. Provider streams are buffered until the Trust Gate approves the completed output.
- 🧩 **Pluggable Providers** — A provider registry lets you add Gemini/Mistral/vLLM without touching core.

## 🧰 Maintainer Workflows

`aidoc` is designed for the ongoing work open-source maintainers already do:

- Review documentation impact in pull requests before stale docs land.
- Generate release notes and changelog drafts from Git history.
- Gate documentation health in CI with `aidoc score --min`.
- Triage parser/provider/template issues using deterministic AST context.
- Run local-provider workflows with Ollama when the model and code context
  should stay on the machine.

See [Codex maintainer workflows](./docs/codex-maintainer-workflows.md) for the
OSS workflow background, [Codex integration](./docs/integrations/codex.md) for
the source-checkout host path, and [Claude integration](./docs/integrations/claude.md)
for the equivalent local MCP setup.

## 🚀 Quick Start

```bash
git clone https://github.com/mr-min-max/aidoc.git
cd aidoc
npm install
npm run build
npm link
aidoc --version
```

The simple paths are `aidoc`, `aidoc plan`, and `aidoc update`. Bare `aidoc`
begins with a provider-free plan and offers an update only when a safe
documentation target is indicated. `aidoc plan` is deterministic and requires
no provider, API key, login, or network request. If you accept an update,
generation still needs either explicit direct-provider setup or a separate
host-managed MCP candidate. `aidoc update` resolves one safe target
automatically; several targets require explicit selection or `--all`, and it
never guesses an ambiguous target. A dry run previews the bounded update
without writing.

`npm link` is only a source-checkout development convenience. To reverse it,
run `npm unlink -g aidoc-gen`. The beta.3 integration and plugin are not
published to npm or installed from a marketplace by this repository slice.

### Three honest beta paths

1. **Provider-free CLI:** use `aidoc`, `aidoc plan`, `aidoc check`, or
   `aidoc score` for deterministic AST-backed work without a model credential.
2. **Subscription-hosted local MCP:** authenticate the official local Codex
   host with an eligible ChatGPT subscription, or use Claude Desktop/Claude
   Code with its own account, and let the host call AiDoc's local MCP tools.
   This is host authentication, not an OpenAI/Claude API key; AiDoc receives no
   ChatGPT or Claude OAuth token. ChatGPT web does not read local Codex
   configuration or local STDIO servers.
3. **Direct AiDoc provider mode:** choose an explicit API provider or local
   Ollama. Consumer subscriptions and API billing are separate, and direct
   provider mode never silently falls back to another provider.

### Plan documentation impact without a key

```bash
aidoc plan                                      # concise human report
aidoc plan --json                               # versioned JSON envelope
aidoc plan --base origin/main                   # explicit comparison base
aidoc plan --base v1.2.0 --head release-candidate
aidoc plan --max-context-bytes 24000
```

Without `--base`, aidoc checks the remote default branch, `origin/main`,
`main`, `origin/master`, `master`, then the previous commit; a repository's
first commit is compared with Git's empty tree. Set `AIDOC_BASE_REF` to choose
a default base for local and CI runs. Supplying `--head` compares two immutable
commits; otherwise the selected base is compared with the current working
tree. Shallow history must contain the selected base.

Human output is designed for review. `--json` emits an
`aidoc.impact-plan.v1` success/error envelope for automation. The byte budget
limits the deterministic provider-impact context; it does not allow raw code
to enter that context.

Try the complete fixed, temporary-repository fixture locally:

```bash
npm run demo:impact
```

## 📦 Source Beta Installation

The beta.3 integration is a forthcoming/source-checkout release note, not a
published npm package or marketplace listing. From the checkout, run:

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

See [the beta.3 release note](./docs/releases/v0.2.0-beta.3.md) for the
integration scope and [the public-beta guide](./docs/PUBLIC_BETA.md) for the
supported access boundaries.

## ⚙️ Direct provider configuration

Direct AiDoc provider mode is separate from ChatGPT Plus/Pro, Claude Pro/Max,
and other consumer subscriptions. It supports exactly these profiles:

| Profile             | Credential / requirement                                   | Boundary                   |
| ------------------- | ---------------------------------------------------------- | -------------------------- |
| `openai`            | `OPENAI_API_KEY`                                           | Remote API billing         |
| `anthropic`         | `ANTHROPIC_API_KEY`                                        | Remote API billing         |
| `deepseek`          | `DEEPSEEK_API_KEY`                                         | Remote API billing         |
| `qwen`              | `DASHSCOPE_API_KEY`                                        | Qwen Model Studio PAYG API |
| `openai-compatible` | `AIDOC_COMPAT_API_KEY` and an explicitly approved endpoint | Remote API billing         |
| `ollama`            | Local Ollama plus an explicit installed model              | Local                      |

Direct provider mode never silently falls back. For non-interactive runs set
`AIDOC_PROVIDER` and `AIDOC_MODEL` explicitly. Ollama is local but still
requires an explicit model. Qwen custom AiDoc calls use a pay-as-you-go Model
Studio API key; a Qwen consumer or coding-plan subscription is not an AiDoc
API bridge.

Documentation-impact planning and the host-managed local MCP preparation/
validation workflow require no AiDoc provider key.

```bash
export AIDOC_PROVIDER=openai
export AIDOC_MODEL=gpt-5.6-luna
export OPENAI_API_KEY="sk-..."
```

Or create a `.aidocrc.json` in your project root:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "trustPolicy": "redact",
  "include": ["src/**/*.ts", "src/**/*.py"],
  "exclude": ["**/node_modules/**", "**/*.test.ts"],
  "language": "en"
}
```

## 🛡️ Trust Gate beta

The in-progress Trust Gate scans rendered provider input and completed provider
output for high-confidence secrets. For direct/general provider flows,
configured `strict` blocks findings, configured `redact` replaces detected
values with typed placeholders, and configured `warn` preserves the detected
text while reporting findings. The host-managed MCP prepare/validate workflow
has a stricter privacy floor: configured `warn` and `redact` both use effective
redaction before host generation or return, while the result still reports the
configured policy. An `allowed` result means no findings were detected.

The GitHub Action defaults to `strict` and exports its selected policy over
project configuration. Override it explicitly when needed:

```yaml
with:
  trust-policy: redact
```

Use provider-specific environment variables such as `OPENAI_API_KEY` and
`ANTHROPIC_API_KEY` for credentials. The legacy `.aidocrc` `apiKey` field is
deprecated, has lower precedence than environment credentials, and remains
readable only for a beta compatibility window.

Streaming responses are buffered until the complete output passes the same
policy check, so progressive token display is temporarily unavailable.

Real CLI, GitHub Action, and watch-mode file mutations require a current Git
worktree. They reject traversal, external, and symlink or junction targets,
compare the prepared file snapshot before replacement, and commit through a
same-directory rename. Dry-run, `check`, `plan`, current MCP generation tools,
and `score` without `--output` are non-mutating. MCP directory allowlisting,
`aidoc doctor --security`, and persisted receipts remain unimplemented. These
repository-contained write controls are not an operating-system sandbox;
Trust Gate redaction is not a prompt-injection defense. In the host-managed
MCP workflow, Trust Gate inspects AiDoc's prepared input and validated output;
it does not control the host's context window, model, sandbox, isolation, or
permission system.

## 🛠️ Commands

### Generate README

```bash
aidoc readme                          # Generate README.md
aidoc readme --dry-run                # Preview without saving
aidoc readme --output docs/README.md  # Custom output path
```

### Generate API Docs

```bash
aidoc api --output docs/API.md        # Generate API reference
```

### Auto-Annotate Code

```bash
aidoc annotate --all                  # Add JSDoc to all undocumented functions
aidoc annotate --file src/index.ts    # Annotate specific file
```

### Generate Changelog

```bash
aidoc changelog --version v1.0.0      # From latest tag
aidoc changelog --from HEAD~10        # From specific ref
```

### Generate Architecture Diagram

```bash
aidoc diagram --output docs/arch.md   # Mermaid diagram
```

### Diff-Aware Update

```bash
aidoc update --target README.md --base HEAD~5
aidoc update --target README.md --since HEAD~5  # compatibility alias for --base
```

`update` always constructs the deterministic plan first. `--since` remains a
compatibility alias for `--base`; when both are supplied they must match.
With no explicit target, one safe affected Markdown target is selected
automatically. Multiple targets require `--target` or `--all`; automatic
selection never guesses.

### Debug Mode

```bash
aidoc readme --verbose                # Enable debug logging
```

### Score Documentation Health

```bash
aidoc score                        # 0-100 doc coverage report
aidoc score --json                 # machine-readable (CI)
aidoc score --min 80               # fail CI if below 80
aidoc score -o docs/score.md       # write a report
```

### Watch Mode (live docs)

```bash
aidoc watch                        # regenerate README on save
aidoc watch --auto --target docs/README.md   # no prompts (great for demos)
```

## 🎬 GitHub Action

The `v0.2.0-beta.2` examples below identify the unreleased release candidate.
Do not use that ref until the corresponding tag is published.

Generate documentation and push the resulting commit:

```yaml
# .github/workflows/docs.yml
name: Documentation
on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mr-min-max/aidoc@v0.2.0-beta.2
        with:
          provider: openai
          api-key: ${{ secrets.OPENAI_API_KEY }}
          commands: readme,api
          auto-commit: true
```

### AST-backed source/document co-change guard

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - uses: mr-min-max/aidoc@v0.2.0-beta.2
    with:
      mode: check
      since: ${{ github.event.pull_request.base.sha }}
      commands: readme,api
```

Check mode is a deterministic co-change guard. It reports a document as stale
when AST-parseable source files changed in the selected Git range without the
target document changing in that range. `fetch-depth: 0` makes the selected
base ref available. A successful `co-changed` result does not prove that the
document content is semantically correct, and check mode never compares
non-deterministic LLM output.

Pull-request workflows should use
`${{ github.event.pull_request.base.sha }}`. Push workflows can use
`${{ github.event.before }}`.

## 🔌 Local MCP integrations

The repository-owned beta.3 integration is designed for an official local
Codex host authenticated with ChatGPT, or for Claude Desktop/Claude Code. It
uses local STDIO MCP and the command `aidoc --mcp`; it does not turn a consumer
subscription into an AiDoc API credential. ChatGPT web does not read local
Codex configuration or local STDIO servers.

Read [Codex integration](./docs/integrations/codex.md) or [Claude integration](./docs/integrations/claude.md)
for host-specific setup. The local server can also be started directly after
the source-checkout build:

```bash
# Start the local MCP server from a built source checkout
aidoc --mcp
```

### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "aidoc": {
      "command": "aidoc",
      "args": ["--mcp"]
    }
  }
}
```

### Available MCP Tools

The subscription-friendly, provider-free path is
`plan_documentation_impact` → `prepare_documentation_update` →
`validate_documentation_draft` → `check_docs_freshness`. The legacy/direct
provider-backed generation tools below are separate: `generate_readme`,
`generate_api_docs`, and `generate_diagram` require an explicit AiDoc provider
credential and the provider's API billing. The bundled documentation skill
never calls those provider-backed generation tools.

| Tool                           | Description                                                               |
| :----------------------------- | :------------------------------------------------------------------------ |
| `analyze_codebase`             | Parse code and return structure (functions, classes, types)               |
| `generate_readme`              | Generate README from code analysis                                        |
| `generate_api_docs`            | Generate API reference documentation                                      |
| `generate_diagram`             | Generate Mermaid architecture diagram                                     |
| `check_docs_freshness`         | Run an AST-backed source/document co-change guard                         |
| `plan_documentation_impact`    | Plan deterministic impact for the server's startup repository             |
| `prepare_documentation_update` | Prepare one bounded Markdown target without writing or calling a provider |
| `validate_documentation_draft` | Validate host-generated Markdown without writing files                    |

`plan_documentation_impact` accepts `base`, `head`, and
`max_context_bytes`. Its scope is the repository where the MCP server process
started; it does not accept an arbitrary directory. For the same immutable
base and head, MCP returns the same plan object as `aidoc plan --json`.

For the safe host-managed update, call `prepare_documentation_update`, generate
one candidate only from its `generation.system_prompt` and `generation.prompt`,
then call `validate_documentation_draft` with the unchanged preparation digest,
target, and exact candidate before asking the host for write permission. The
MCP prepare/validate path never writes the repository and never receives the
host's subscription token.

For a source-checkout Codex host, after `npm link` add the local MCP server
directly:

```bash
codex mcp add aidoc -- aidoc --mcp
codex mcp list
```

You can also verify the server with `/mcp` in Codex. Reverse this host
configuration with `codex mcp remove aidoc`. The repository-owned plugin is
not installed from a marketplace here; marketplace distribution is a later
step, and no marketplace entry is created by this slice.

## 🔐 Planning security and limits

The planner detects structured changes to exported TypeScript/JavaScript and
Python APIs plus deterministic references in repository documentation. It can
identify contract, implementation, documentation, and dependency impact, but
it does not prove that documentation is semantically correct.

Raw source, raw diffs, and provider credentials are excluded from provider
impact context. Plans contain normalized identities, change categories,
documentation locations, counts, and cryptographic fingerprints—not source
values. Planning is AST-first: a supported source file that cannot be parsed
stops the plan, and `update` stops before provider construction or document
writes. Unsupported and configured-excluded files are counted rather than
sent to a provider.

## 🏗️ Architecture

```
src/
├── cli/           # Commander.js CLI interface
│   └── commands/  # Individual command implementations
├── core/          # Business logic
│   ├── analyzer   # Codebase analysis orchestrator
│   ├── generator  # LLM-powered doc generation
│   ├── cache      # AST parsing cache
│   ├── retry      # Exponential backoff retry
│   └── logger     # Structured logging
├── parsers/       # Language-specific AST parsers
│   ├── typescript # ts-morph based parser
│   ├── python     # Python ast module based parser
│   └── registry   # Parser discovery & registration
├── providers/     # LLM Adapters
│   ├── openai     # OpenAI (GPT-4o, GPT-4o-mini)
│   ├── anthropic  # Anthropic (Claude)
│   └── ollama     # Local LLM via Ollama
├── mcp/           # Model Context Protocol server
├── templates/     # Handlebars prompt templates
└── output/        # Markdown output & diff display
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

Check our [ROADMAP.md](./ROADMAP.md) for planned features and areas where we need help.
Project governance is documented in [GOVERNANCE.md](./GOVERNANCE.md), and community expectations are documented in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

### Good First Issues

Look for issues labeled `good first issue` — they're specifically designed for new contributors.

## 📄 License

MIT License. See [LICENSE](./LICENSE) for more details.
