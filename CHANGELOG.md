# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

- Resolve the TypeScript and JavaScript public boundary from package entries and bounded static relative re-exports, with loud fallback when no entry is available.
- Add the optional `entry` configuration override and support `.mts`, `.cts`, `.mjs`, and `.cjs` module files.
- Add optional `boundary`, symbol `visibility`, and `summary.internalChanges` fields without changing the v1 plan, context, or review schema versions.

## [0.3.0-beta.1] - 2026-09-10

- Impact snapshots now carry deterministic AST-rendered before/after signatures and callable arity, with conservative arity-based breaking-risk classification.
- Provider update context propagates safe signatures, groups changes in an unescaped plain-text prompt, and preserves schema v1 additive semantics.
- Impact summaries count only contract-level public API changes and report informational implementation/documentation changes separately.
- Verbose plans and deterministic mock updates show before/after signatures; the provider-free storefront demo proves prompt sufficiency.
- Breaking: `check` now follows the impact plan: it fails only when an unchanged Markdown section directly mentions a changed public symbol. Its JSON report includes the target, referenced symbols, stale sections, unmapped symbols, source files, and message; clean, co-changed, stale, missing, and unknown statuses retain exit codes 0, 0, 1, 1, and 2.

- Parser: enumerate arrow-function, function-expression, default, aliased, and constant exports. New impact symbol kind `variable`.
- Removed historical planning records from the public tree; Git history retains them.
- Add `staledocs review` with deterministic JSON, Markdown, and text reports, before/after signatures, stale and breaking verdicts, and opt-in failure thresholds.
- Add Action review mode as the default, with pull request comments, token-owned sticky updates, optional `docs-stale` and `breaking-change` labels, fork read-only fallback, and local source installation for dogfooding. Generate and check modes remain available.
- Add `.staledocsignore` suppressions and the additive `plan.ignored.suppressed` count.
- Review mode reports only the drift this pull request introduces; pre-existing stale documentation is not reported.
- Add the false-positive issue form and `staledocs-check` pre-commit hook.
- Rename the product, package, executable, Action, MCP server, environment variables, config namespace, ignore file, and review marker to StaleDocs.
- Rewrite the README around documentation drift and add a consolidated limitations guide.

## [0.2.0-beta.6] - 2026-08-16

### Changed

- Align AST-first storefront copy and add a deterministic provider-free
  `createUser` demo.
- Add the original logo, poster, social preview, short GIF, and progressive CLI
  and Action documentation.
- Keep runtime, provider, MCP, security, and model behavior unchanged.
- Publish through npm Trusted Publishing (OIDC) with matching npm and GitHub
  prerelease artifacts. npm `beta` is `0.2.0-beta.6`; `latest` remains
  `0.2.0-beta.4`.

## [0.2.0-beta.5] - 2026-08-14

### Changed

- Publish `@mr-min-max/aidoc-gen@0.2.0-beta.5` through npm Trusted Publishing
  and GitHub Actions OIDC with no `NPM_TOKEN` fallback.
- Require a protected annotated release tag that points directly to the
  reviewed commit and uses the approved GitHub noreply identity.
- Verify the exact npm and GitHub tarballs, checksum, clean installation, and
  SLSA provenance before promoting beta.5 as the current public beta.

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
