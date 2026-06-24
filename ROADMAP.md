# 🗺️ Roadmap

This roadmap outlines the development plan for aidoc. We welcome community feedback and contributions!

## v0.1.0 — Foundation (Current) ✅

- [x] TypeScript/JavaScript AST parser (ts-morph)
- [x] Multi-provider LLM support (OpenAI, Anthropic, Ollama)
- [x] 6 CLI commands: readme, api, annotate, changelog, diagram, update
- [x] Diff-aware documentation updates
- [x] Handlebars template system
- [x] Zod-validated configuration
- [x] CI/CD with GitHub Actions

## v0.2.0 — Multi-Language & Intelligence

- [x] Python AST parser (via Python `ast` module subprocess)
- [x] AST caching for faster repeated runs
- [x] Retry logic with exponential backoff (now wired into every provider)
- [x] Structured logging with `--verbose` flag
- [x] MCP (Model Context Protocol) server
- [x] GitHub Action for CI/CD integration
- [x] Documentation health scoring (`aidoc score`) — deterministic, CI-gateable
- [x] Live watch mode with streaming LLM output (`aidoc watch`)
- [x] Pluggable provider registry
- [ ] Go parser (via `go/ast`)
- [ ] Rust parser (via `syn` subprocess)

## v0.3.0 — Ecosystem & Polish

- [ ] Plugin system for custom language parsers
- [ ] Custom template overrides via `.aidocrc.json`
- [ ] VS Code extension
- [ ] Interactive `aidoc init` wizard
- [ ] Monorepo support (workspaces)

## v1.0.0 — Stable Release

- [ ] Comprehensive E2E test suite
- [ ] 90%+ code coverage
- [ ] Published npm package with stable API
- [ ] Documentation website
- [ ] Support for 5+ programming languages
- [ ] Community-contributed parser plugins

---

## How to Contribute

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines. We especially welcome:

- 🐍 **Language parsers** — Help us support more languages
- 🔌 **LLM providers** — Add support for new AI providers
- 📝 **Templates** — Create better documentation templates
- 🐛 **Bug fixes** — Help us improve reliability

Use [GitHub Issues](https://github.com/aidoc-dev/aidoc/issues) to propose features or report bugs.
