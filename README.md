# 🤖 aidoc

> **AI-powered documentation generator for codebases.**

> [!IMPORTANT]
> **Public Beta candidate (`0.2.0-beta.2`).** The source tree is ready for
> early testing on Node.js `>=22.12.0`, but the npm package and GitHub Action
> tag are not published yet. `aidoc plan` is deterministic and provider-free;
> generation and non-empty updates require a configured LLM provider. Feedback
> and focused contributions are welcome before v1.

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
- 🔌 **MCP Server** — Integrate with AI assistants (ChatGPT, Claude, Cursor) via the Model Context Protocol.
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

See [Codex maintainer workflows](./docs/codex-maintainer-workflows.md) for the API-credit plan we use for OpenAI Codex for OSS readiness.

## 🚀 Quick Start

```bash
git clone https://github.com/mr-min-max/aidoc.git
cd aidoc
npm ci
npm run build
node dist/cli/index.js plan
node dist/cli/index.js plan --json
```

`plan` is deterministic, AST-backed, and requires no provider or API key. It
reports structured public-code changes, documentation references, and the
bounded context available to a later update. `update --dry-run` previews an
LLM-backed documentation update and therefore still needs a configured
provider when the plan indicates documentation impact.

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

`aidoc-gen` is not published to npm yet. For this source beta, use the checkout
steps above. You can optionally run `npm link` after building to make the
`aidoc` command available globally in your local development environment.

Do not depend on the `0.2.0-beta.2` package or Action ref until a matching tag,
npm package, and GitHub prerelease are deliberately published.

## ⚙️ Configuration

Generation and non-empty updates require an API key for OpenAI or Anthropic
(unless using Ollama). Documentation-impact planning requires no key.

```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
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
output for high-confidence secrets. CLI and MCP configuration defaults to
`redact`, which replaces detected values with typed placeholders before
transport or return. Set `.aidocrc.json` `trustPolicy` to `strict` to block
detected input or output. `warn` is explicitly permissive: it allows the
original detected material to cross the provider boundary and reach consumers.

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
policy check, so progressive token display is temporarily unavailable. This
beta does not yet provide filesystem containment, MCP directory allowlisting,
`aidoc doctor --security`, or persisted receipts. Secret redaction is not a
prompt-injection defense or an operating-system sandbox.

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

## 🔌 MCP Server

Use aidoc as a tool in AI assistants like ChatGPT, Claude, or Cursor:

```bash
# Start the source-beta MCP server
node /absolute/path/to/aidoc/dist/cli/index.js --mcp
```

### Claude Desktop / Cursor config

```json
{
  "mcpServers": {
    "aidoc": {
      "command": "node",
      "args": ["/absolute/path/to/aidoc/dist/cli/index.js", "--mcp"]
    }
  }
}
```

### Available MCP Tools

| Tool                        | Description                                                   |
| :-------------------------- | :------------------------------------------------------------ |
| `analyze_codebase`          | Parse code and return structure (functions, classes, types)   |
| `generate_readme`           | Generate README from code analysis                            |
| `generate_api_docs`         | Generate API reference documentation                          |
| `generate_diagram`          | Generate Mermaid architecture diagram                         |
| `check_docs_freshness`      | Run an AST-backed source/document co-change guard             |
| `plan_documentation_impact` | Plan deterministic impact for the server's startup repository |

`plan_documentation_impact` accepts `base`, `head`, and
`max_context_bytes`. Its scope is the repository where the MCP server process
started; it does not accept an arbitrary directory. For the same immutable
base and head, MCP returns the same plan object as `aidoc plan --json`.

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
