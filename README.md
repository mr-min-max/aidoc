# 🤖 aidoc

> **AI-powered documentation generator for codebases.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-green.svg)](https://nodejs.org/)
[![CI](https://github.com/aidoc-dev/aidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/aidoc-dev/aidoc/actions)

`aidoc` is a local, privacy-first CLI tool that analyzes your codebase using **AST parsing** and generates professional documentation (READMEs, API docs, JSDocs, Changelogs, and Architecture Diagrams) using LLMs.

It is specifically designed for **Open Source maintainers** who want to spend less time writing docs and more time writing code.

---

## ✨ Features

- 🧠 **AST-Powered Context** — Doesn't just read text; understands your code structure (functions, classes, exports) via `ts-morph` (TypeScript) and Python's `ast` module.
- 🐍 **Multi-Language** — Built-in support for TypeScript, JavaScript, and Python with real AST parsing. Extensible parser architecture for adding more languages.
- 🔄 **Diff-Aware Updates** — Don't regenerate your entire README. `aidoc update` only rewrites sections affected by your latest Git commits.
- 🔐 **Privacy First (BYOK)** — Bring Your Own Key. Supports OpenAI, Anthropic, or run it 100% locally and privately using **Ollama**.
- 🎨 **Customizable** — Uses Handlebars templates for prompts. Override them to match your exact documentation style.
- 🚀 **GitHub Action** — Automate documentation updates in CI/CD with `aidoc-action`.
- 🔌 **MCP Server** — Integrate with AI assistants (ChatGPT, Claude, Cursor) via the Model Context Protocol.
- ⚡ **Smart Caching** — AST parsing results are cached; unchanged files are never re-parsed.
- 🔁 **Resilient** — Built-in retry with exponential backoff for API rate limits and transient errors (wired into every provider).
- 📊 **Doc Health Scoring** — `aidoc score` grades documentation coverage 0–100 from the AST. No LLM, no API key, instant — with a CI gate (`--min`).
- 🔎 **PR Doc Review** — `aidoc review` flags exported symbols changed in a PR that aren't documented. Deterministic, no API key; the GitHub Action posts it as a PR comment.
- 👁️ **Live Watch Mode** — `aidoc watch` regenerates docs in real time as you save files. Streaming LLM output makes generation feel instant.
- 🧩 **Pluggable Providers** — A provider registry lets you add Gemini/Mistral/vLLM without touching core.

## 🧰 Maintainer Workflows

`aidoc` is designed for the ongoing work open-source maintainers already do:

- Review documentation impact in pull requests before stale docs land.
- Generate release notes and changelog drafts from Git history.
- Gate documentation health in CI with `aidoc score --min`.
- Triage parser/provider/template issues using deterministic AST context.
- Run privacy-preserving local workflows with Ollama when code should not leave the machine.

See [Codex maintainer workflows](./docs/codex-maintainer-workflows.md) for the API-credit plan we use for OpenAI Codex for OSS readiness.

## 🚀 Quick Start

```bash
# Generate a README for your project
npx aidoc-gen readme

# Preview what it would generate without saving
npx aidoc-gen readme --dry-run

# Use the mock mode for testing (no API key needed)
npx aidoc-gen readme --mock --dry-run
```

## 📦 Installation

```bash
npm install -g aidoc-gen
```

## ⚙️ Configuration

`aidoc` requires an API key for OpenAI or Anthropic (unless using Ollama).

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
  "include": ["src/**/*.ts", "src/**/*.py"],
  "exclude": ["**/node_modules/**", "**/*.test.ts"],
  "language": "en"
}
```

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
aidoc update --target README.md --since HEAD~5  # Update only changed sections
```

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

### Review Documentation Impact (PR workflow)
```bash
aidoc review                          # exports changed since HEAD~1 vs README.md
aidoc review --since origin/main      # compare against a base branch
aidoc review --target docs/API.md     # check against API docs instead
aidoc review --json                   # machine-readable (CI)
aidoc review --fail-on-issues         # exit non-zero when docs gaps are found
```

`aidoc review` uses deterministic AST analysis (no LLM, no API key): it lists
the exported functions, classes, and types touched by your changes and checks
whether each is referenced in the target doc and has an inline doc comment.

## 🎬 GitHub Action

Automate documentation in your CI/CD pipeline:

```yaml
# .github/workflows/docs.yml
name: Documentation
on:
  push:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aidoc-dev/aidoc@v1
        with:
          provider: openai
          api-key: ${{ secrets.OPENAI_API_KEY }}
          commands: readme,api
          auto-commit: true
```

### Check Mode (fail CI if docs are stale)

```yaml
      - uses: aidoc-dev/aidoc@v1
        with:
          mode: check
          commands: readme
```

### Review Mode (comment on PRs with documentation impact)

```yaml
# .github/workflows/docs-review.yml
name: Docs Review
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
  pull-requests: write        # allow the bot to comment
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # needed to compute the PR merge base
      - uses: aidoc-dev/aidoc@v1
        with:
          mode: review
          review-target: README.md
          fail-on-issues: false # set true to block merges on doc gaps
```

Review mode needs no API key — it runs the deterministic `aidoc review` and
posts (or updates) a single PR comment summarizing which changed exports still
need documentation.

## 🔌 MCP Server

Use aidoc as a tool in AI assistants like ChatGPT, Claude, or Cursor:

```bash
# Start MCP server
aidoc --mcp
```

### Claude Desktop / Cursor config

```json
{
  "mcpServers": {
    "aidoc": {
      "command": "npx",
      "args": ["aidoc-gen", "--mcp"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|:-----|:------------|
| `analyze_codebase` | Parse code and return structure (functions, classes, types) |
| `generate_readme` | Generate README from code analysis |
| `generate_api_docs` | Generate API reference documentation |
| `generate_diagram` | Generate Mermaid architecture diagram |
| `check_docs_freshness` | Check if documentation is up-to-date |

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
