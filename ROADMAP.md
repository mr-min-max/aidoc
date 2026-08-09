# 🗺️ Roadmap

This roadmap separates the unreleased release candidate from shipped and future
work. We welcome community feedback and contributions.

## Current source-beta candidate

### v0.2.0-beta.2 — Trust and Semantic Documentation Impact

- Provider Trust Gate for rendered input and completed output
- Provider-free `aidoc plan` with human and versioned JSON output
- Stable AST snapshots for TypeScript, JavaScript, and Python
- Deterministic change classification and documentation mapping
- Exact byte-bounded provider context without raw source or raw Git diffs
- Shared planning core for CLI, MCP, and `aidoc update`
- Packaged CLI, GitHub Action, and MCP release-integrity smoke coverage

This candidate remains source-only until its public-beta checks, tag, npm
publication, and GitHub prerelease are separately approved and completed.

### Additional current-branch capabilities

- Python AST parser (Python `ast` subprocess)
- In-process AST cache for repeated analysis
- Retry logic with exponential backoff
- Structured logging with `--verbose`
- Documentation health scoring (`aidoc score`)
- Live watch mode with non-streaming LLM regeneration (`aidoc watch`)
- Pluggable provider registry

## Planned

### v0.2.0 — Trust Gate follow-ups

- Repository-contained atomic writes
- MCP directory allowlisting
- Security doctor and bounded run receipts

### v0.3.0 — Evidence and verification

- Evidence-backed technical claims
- `aidoc verify` and `aidoc explain`

## Shipped

### v0.1.0 — Source-level foundation

- TypeScript/JavaScript AST parser (`ts-morph`)
- Multi-provider LLM support (OpenAI, Anthropic, Ollama)
- CLI commands for README, API, annotation, changelog, diagrams, and updates
- Git-aware documentation updates
- Handlebars prompt templates in the source tree
- Zod-validated configuration
- CI/CD with GitHub Actions

These bullets describe source-level foundations, not release-integrity-verified
distribution paths. The v0.1.0 distributed template, Action, and MCP paths were
not release-integrity verified. The current `v0.2.0-beta.2` source candidate
repairs those packaging, automation, and transport paths and adds verification
evidence before release.

## Later ideas

### Language support

- Go parser via `go/ast`
- Rust parser via a `syn` subprocess

### Ecosystem and polish

- Plugin system for custom language parsers
- Future custom template overrides through `.aidocrc.json` after the
  configuration field is wired
- VS Code extension
- Interactive `aidoc init` wizard
- Monorepo/workspace support

### Stable release goals

- Comprehensive end-to-end test suite
- 90%+ code coverage
- Published npm package with a stable API
- Documentation website
- Support for at least five programming languages
- Community-contributed parser plugins

---

## How to Contribute

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. We especially welcome:

- 🐍 **Language parsers** — Help us support more languages
- 🔌 **LLM providers** — Add support for new AI providers
- 📝 **Templates** — Improve the built-in prompt templates
- 🐛 **Bug fixes** — Help us improve reliability

Use [GitHub Issues](https://github.com/mr-min-max/aidoc/issues) to propose
features or report bugs.
