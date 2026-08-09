# AiDoc Public Beta

AiDoc `0.2.0-beta.2` is a source-beta candidate for maintainers who want to
plan, generate, and review documentation changes from deterministic AST
analysis. It requires Node.js `>=22.12.0`.

## Ready to test

- `aidoc plan` and `aidoc plan --json` require no LLM provider or API key.
- TypeScript, JavaScript, and Python public symbols are compared through AST
  snapshots and stable fingerprints.
- Provider impact context is deterministic, versioned, and byte-bounded.
- `aidoc update` builds the same plan before constructing a provider.
- CLI, GitHub Action, npm tarball, and MCP paths have automated smoke coverage.
- OpenAI, Anthropic, and Ollama remain available through one provider-neutral
  interface for generation workflows.

The npm package and GitHub Action tag are not published. Use the source
checkout in the README until a separately verified prerelease exists.

## Beta boundaries

- Planning identifies structured public-code changes and documentation
  references; it does not prove that prose is semantically correct.
- Git revision validation rejects NUL, LF, and CR but not every other control
  character yet.
- Working-tree plans use the correct internal discriminator but currently show
  the display label `HEAD` instead of `working-tree`.
- Markdown inline-code masking can misalign after astral Unicode because one
  path mixes code-point and UTF-16 offsets.
- First-commit comparison uses Git's SHA-1 empty-tree object; SHA-256
  repositories need derived empty-tree support.
- Provider-backed generation can produce incorrect content. Review diffs before
  writing or committing documentation.
- Trust Gate redaction is not a prompt-injection defense or operating-system
  sandbox.

Beta behavior can evolve before v1. Versioned JSON envelopes will change only
through an explicit schema version.

## Feedback and contributions

- Reproduce planning issues without a provider when possible.
- File bugs with a minimal fixture and exact version/commit.
- Use feature requests for observable problems and acceptance criteria.
- Use private vulnerability reporting for security issues.
- Run `npm run verify:release` before submitting a pull request.

Dependency update pull requests are held to the same CI and review gates as
human contributions. See [CONTRIBUTING.md](../CONTRIBUTING.md),
[SUPPORT.md](../SUPPORT.md), and [SECURITY.md](../SECURITY.md).

## Not part of this source beta

- npm publication
- a GitHub tag or Release
- a stable-v1 compatibility promise
- hosted documentation or a managed service
- automatic acceptance of generated content
