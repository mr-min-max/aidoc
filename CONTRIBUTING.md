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
npm run test              # Run all tests
npm run test:watch        # Run in watch mode
npm run test:coverage     # Run with coverage report
```

## Architecture

`aidoc` uses a modular architecture with the following principles:

1. **AST First, LLM Second** — We rely on deterministic AST parsing (`ts-morph` for TS, Python's `ast` module for Python) to extract code structure BEFORE sending anything to the LLM. Do not try to parse code using regex.

2. **Provider Agnostic** — When adding LLM features, do not hardcode OpenAI logic. Use the `LLMProvider` interface in `src/providers/types.ts`.

3. **Template Driven** — All prompts must be stored as Handlebars templates in `src/templates/`. Do not inline large prompt strings in the TypeScript code.

4. **Testing** — Write unit tests for all new parsers, providers, and core modules.

### Directory Structure

- `src/cli/` — Commander.js CLI interface
- `src/core/` — Business logic (Analyzer, Generator, Cache, Retry, Logger)
- `src/parsers/` — Language-specific AST parsers
- `src/providers/` — LLM Adapters (OpenAI, Anthropic, Ollama)
- `src/mcp/` — Model Context Protocol server
- `src/templates/` — Handlebars prompt templates
- `src/output/` — Markdown output and diff display

## Adding a New Language Parser

1. Create `src/parsers/yourlang.ts` implementing the `LanguageParser` interface
2. Register it in `src/parsers/registry.ts`
3. Create test fixtures in `tests/fixtures/`
4. Write comprehensive tests in `tests/unit/parsers/`

## Adding a New LLM Provider

1. Create `src/providers/yourprovider.ts` implementing `LLMProvider`
2. Add it to the factory in `src/providers/factory.ts`
3. Update the config schema in `src/config/schema.ts`
4. Write unit tests

## Code Style

- We use TypeScript strictly (`strict: true`).
- Follow the existing ESLint and Prettier rules.
- Run `npm run lint:fix` before submitting a PR.
- Use `--verbose` flag for debug logging during development.
