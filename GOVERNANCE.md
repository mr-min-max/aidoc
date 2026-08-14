# Governance

aidoc is an MIT-licensed project developed in the public canonical repository
at [`mr-min-max/aidoc`](https://github.com/mr-min-max/aidoc).

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
The complete maintainer procedure is documented in
[`docs/RELEASING.md`](docs/RELEASING.md). Before a release, maintainers must
run:

```bash
npm run verify:release
```

## Security

Security reports should follow `SECURITY.md`. Codex Security, if granted, will
only be used on repositories the maintainer owns or is authorized to administer.
