# Governance

aidoc is an MIT-licensed project intended for public open-source development.
The canonical repository is currently private pending separate repository
privacy cleanup.

## Maintainer Role

The primary maintainer is responsible for:

- Reviewing and merging pull requests.
- Triage of issues and security reports.
- Release planning and package publishing.
- Keeping project direction aligned with the AST-first, provider-agnostic,
  template-driven architecture described in `AGENTS.md`.

## Contribution Decisions

Changes are accepted when they:

- Preserve deterministic AST parsing before LLM generation.
- Use the `LLMProvider` interface for model/provider features.
- Store prompt text in Handlebars templates under `src/templates/`.
- Include tests for new parsers, providers, and shared behavior.
- Keep CLI behavior predictable and documented.

## Release Process

Releases are tagged with `v*` tags and published through the release workflow.
Before a release, maintainers should run:

```bash
npm run verify:release
```

## Security

Security reports should follow `SECURITY.md`. Codex Security, if granted, will
only be used on repositories the maintainer owns or is authorized to administer.
