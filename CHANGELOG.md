# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Fixed

- Ship Handlebars prompt templates with the compiled npm package.
- Propagate GitHub Action generation and push failures.
- Reject malformed generated Markdown before the Action writes or commits it.
- Use a deterministic AST-backed document co-change guard in Action check mode.
- Replace the bespoke MCP stdio framing with the official TypeScript SDK.
- Read Action provider and model inputs through validated CLI configuration.
- Prevent raw source and raw Git diffs from entering provider impact context.
- Harden Git snapshot reads against path replacement, unsafe refs, and rename
  endpoint confusion.

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

### Changed

- Require Node.js 22.12 or newer and test supported LTS lines in CI.
- Replace raw-diff updates with deterministic byte-bounded semantic plans.
- Align the source candidate at `0.2.0-beta.2`; no package or tag is published.
