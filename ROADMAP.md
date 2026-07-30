# 🗺️ Roadmap

This roadmap separates the unreleased release candidate from shipped and future
work. We welcome community feedback and contributions.

## Release candidate

### v0.1.1 — Release Integrity

- Packaged Handlebars templates with tarball smoke coverage
- Failure-propagating GitHub Action generate/check modes
- Deterministic AST-backed documentation co-change command
- Standards-compliant MCP stdio transport

`v0.1.1` remains unreleased until its tag, npm publication, and release checks
all succeed.

### Additional current-branch capabilities

- Python AST parser (Python `ast` subprocess)
- In-process AST cache for repeated analysis
- Retry logic with exponential backoff
- Structured logging with `--verbose`
- Documentation health scoring (`aidoc score`)
- Live watch mode with streaming LLM output (`aidoc watch`)
- Pluggable provider registry

## Planned

### v0.2.0 — Trust Gate (planned next)

- Provider-context secret detection and redaction
- Repository-contained atomic writes
- Security doctor and bounded run receipts

### v0.3.0 — ProofGraph

- Semantic AST documentation impact
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
not release-integrity verified. The unreleased v0.1.1 candidate repairs those
packaging, automation, and transport paths and adds verification evidence
before release.

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
