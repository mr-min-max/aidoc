# 🤖 aidoc

> **AI-powered documentation generator for codebases.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![NPM Version](https://img.shields.io/npm/v/aidoc-gen.svg)](https://www.npmjs.com/package/aidoc-gen)

`aidoc` is a local, privacy-first CLI tool that analyzes your codebase using AST parsing and generates professional documentation (READMEs, API docs, JSDocs, Changelogs, and Architecture Diagrams) using LLMs.

It is specifically designed for Open Source maintainers who want to spend less time writing docs and more time writing code.

---

## ✨ Features

- 🧠 **AST-Powered Context:** Doesn't just read text; understands your code structure (functions, classes, exports) via `ts-morph` and `tree-sitter`.
- 🔄 **Diff-Aware Updates:** Don't regenerate your entire README. `aidoc update` only rewrites sections affected by your latest Git commits.
- 🔐 **Privacy First (BYOK):** Bring Your Own Key. Supports OpenAI, Anthropic, or run it 100% locally and privately using **Ollama**.
- 🔌 **Multi-Language:** Built-in TypeScript/JavaScript support, with Python (tree-sitter) architecture ready.
- 🎨 **Customizable:** Uses Handlebars templates for prompts. Override them to match your exact documentation style.

## 🚀 Quick Start

You don't even need to install it. Just run it via `npx`:

```bash
# Generate a README for your project
npx aidoc-gen readme

# Preview what it would generate without saving
npx aidoc-gen readme --dry-run
```

## 📦 Installation

To install globally:

```bash
npm install -g aidoc-gen
```

## ⚙️ Configuration

`aidoc` requires an API key for OpenAI or Anthropic (unless using Ollama).
You can set this via an environment variable:

```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or create a `.aidocrc.json` in your project root:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "include": ["src/**/*.ts"],
  "exclude": ["**/node_modules/**", "**/*.test.ts"],
  "language": "en"
}
```

## 🛠️ Commands

### 1. Generate README
Scans your exports and package metadata to generate a comprehensive README.
```bash
aidoc readme
```

### 2. Generate API Docs
Extracts all exported symbols, types, and methods to create an `API.md` reference.
```bash
aidoc api --output docs/API.md
```

### 3. Auto-Annotate Code
Finds undocumented functions and interactive prompts you to add generated JSDoc/TSDoc comments directly into your source code.
```bash
aidoc annotate --all
```

### 4. Generate Changelog
Reads your git history (Conventional Commits) and generates a human-readable CHANGELOG.md entry.
```bash
aidoc changelog --version v1.0.0
```

### 5. Generate Architecture Diagram
Analyzes imports and exports to build a Mermaid diagram of your codebase structure.
```bash
aidoc diagram --output docs/architecture.md
```

### 6. Diff-Aware Update
Updates an existing document by only looking at the files changed since a specific commit.
```bash
aidoc update --target README.md --since HEAD~5
```

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on how to run tests and submit PRs.

## 📄 License

MIT License. See [LICENSE](./LICENSE) for more details.
