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

### Added

- Tarball smoke tests that render a real packaged template without an API call.
- MCP client/server integration coverage over stdio.
- A non-interactive `--yes` option for documentation generation in CI.

### Changed

- Require Node.js 22.12 or newer and test supported LTS lines in CI.
