# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.2.0-beta.5] - 2026-08-14

### Changed

- Prepare the next immutable beta candidate to verify npm Trusted Publishing
  through GitHub Actions OIDC with no `NPM_TOKEN` fallback.
- Keep beta.4 as the truthfully documented public release until npm accepts
  beta.5 and the post-publication evidence is complete.

## [0.2.0-beta.4] - 2026-08-14

### Fixed

- Label working-tree comparisons truthfully in verbose human plan output while
  preserving the versioned JSON descriptor.
- Reject every C0 control character and DEL in Git revision inputs before Git
  execution.
- Ship Handlebars prompt templates with the compiled npm package.
- Propagate GitHub Action generation and push failures.
- Reject malformed generated Markdown before the Action writes or commits it.
- Use a deterministic AST-backed document co-change guard in Action check mode.
- Replace the bespoke MCP stdio framing with the official TypeScript SDK.
- Read Action provider and model inputs through validated CLI configuration.
- Prevent raw source and raw Git diffs from entering provider impact context.
- Harden Git snapshot reads against path replacement, unsafe refs, and rename
  endpoint confusion.
- Move the first public beta to the scoped `@mr-min-max/aidoc-gen` identity
  after npm rejected the superseded unscoped name under its similarity policy.

### Added

- Tarball smoke tests that render a real packaged template without an API call.
- MCP client/server integration coverage over stdio.
- A non-interactive `--yes` option for documentation generation in CI.
- Provider Trust Gate scanning/redaction for rendered provider input and
  completed output.
- Provider-free `aidoc plan` with versioned JSON output.
- TypeScript, JavaScript, and Python public-symbol snapshots with deterministic
  change classification and documentation mapping.
- Shared CLI/MCP planning core and a no-key impact demo.
- Smart one-or-many documentation target selection before provider creation.
- Explicit provider profiles and a confirmation boundary for direct updates.
- Provider-free MCP preparation and draft validation for subscription hosts.
- A repository-owned Codex plugin and bounded documentation workflow skill.
- Offline hybrid-beta evidence and plugin/source-artifact preflight checks.
- Current OpenAI Responses, Anthropic Messages, hardened compatible-provider,
  and pinned loopback Ollama transports with interactive model discovery.

### Changed

- Require Node.js 22.12 or newer and test supported LTS lines in CI.
- Replace raw-diff updates with deterministic byte-bounded semantic plans.
- Publish the scoped `@mr-min-max/aidoc-gen@0.2.0-beta.4` package on the npm
  `beta` channel with matching provenance-backed GitHub prerelease assets.
