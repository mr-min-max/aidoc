# Contributing to aidoc

First off, thanks for taking the time to contribute! 🎉

## Development Setup

1. Clone the repo
2. Install dependencies: `npm install`
3. Build the CLI: `npm run build`
4. Link it locally: `npm link` (now you can run `aidoc` anywhere)

## Running Tests

We use Jest for testing.

```bash
npm run test
# Run with coverage
npm run test:coverage
```

## Architecture

`aidoc` uses a modular architecture:
- `src/cli/` - Commander.js CLI interface
- `src/core/` - Business logic (Analyzer, Generator, Differ)
- `src/parsers/` - Language-specific AST parsers (e.g., `ts-morph`)
- `src/providers/` - LLM Adapters (OpenAI, Anthropic, Ollama)

## Code Style

- We use TypeScript strictly (`strict: true`).
- Follow the existing ESLint and Prettier rules.
- Run `npm run lint:fix` before submitting a PR.
