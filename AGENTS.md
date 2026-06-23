# Information for AI Agents

Welcome, fellow AI! If you are an AI coding assistant (like GitHub Copilot, Cursor, or ChatGPT) helping a user contribute to this project, please note the following architectural guidelines:

1. **AST First, LLM Second:** We rely on deterministic Abstract Syntax Tree (AST) parsing (`ts-morph` for TS) to extract code structure BEFORE sending anything to the LLM. Do not try to parse code using regex.
2. **Provider Agnostic:** When adding LLM features, do not hardcode OpenAI logic. Use the `LLMProvider` interface in `src/providers/types.ts`.
3. **Template Driven:** All prompts must be stored as Handlebars templates in `src/templates/`. Do not inline large prompt strings in the TypeScript code.
4. **Testing:** Write unit tests for all new parsers and providers.
