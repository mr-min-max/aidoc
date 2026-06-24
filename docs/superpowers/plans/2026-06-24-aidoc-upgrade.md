# aidoc Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make aidoc work as advertised (retry, validation) and add two standout features — doc-quality scoring (`aidoc score`) and live watch mode with streaming (`aidoc watch`) — that differentiate it from README-AI/Mintlify.

**Architecture:** Four logical phases. Phase 1 fixes what the README already promises (retry wiring, shared ts-morph Project, hardened JSON). Phase 2 introduces a provider registry + shared command layer to remove the 6-way duplication before features pile on. Phase 3 adds deterministic doc-quality scoring. Phase 4 adds watch mode + streaming LLM output. Each phase ends with a green test suite and a commit.

**Tech Stack:** TypeScript (Node ≥18), ts-morph, Handlebars, commander, zod, simple-git, chokidar (new), jest + ts-jest. AST-first per AGENTS.md §1; tests per AGENTS.md §4.

**Reference spec:** `docs/superpowers/specs/2026-06-24-aidoc-upgrade-design.md`

**Conventions (from existing code):** `error: any` catch blocks + `error.message`; chalk for CLI output; ora spinners; prompts for confirmations; `logger` from `src/core/logger.ts`; mock branches currently inlined per command.

---

## File Structure (map of what gets created/modified)

**New files:**
- `src/providers/registry.ts` — provider registry (register/lookup/create).
- `src/cli/context.ts` — `loadCommandContext()` + `writeDoc()` helper.
- `src/cli/mock-generator.ts` — `MockGenerator` (relocates inline mock strings).
- `src/core/score.ts` — deterministic scoring engine.
- `src/cli/commands/score.ts` — `aidoc score` command.
- `src/templates/score.hbs` — score report template.
- `src/core/watcher.ts` — debounced file watcher orchestration.
- `src/cli/commands/watch.ts` — `aidoc watch` command.
- Tests: `tests/unit/providers/registry.test.ts`, `tests/unit/providers/streaming.test.ts`, `tests/unit/core/score.test.ts`, `tests/unit/core/watcher.test.ts`, `tests/unit/cli/context.test.ts`.

**Modified files:**
- `src/providers/types.ts` — add optional `generateStream`.
- `src/providers/openai.ts`, `anthropic.ts`, `ollama.ts` — wrap in `withRetry`, add streaming.
- `src/providers/factory.ts` — delegate to registry.
- `src/config/schema.ts` — validate provider via registry.
- `src/parsers/typescript.ts` — reuse one `Project`.
- `src/cli/commands/{readme,api,annotate,changelog,diagram,update}.ts` — use shared context, drop mock branches.
- `src/cli/index.ts` — register `score` + `watch` commands.
- `src/core/generator.ts` — add `*Stream` variants.
- `package.json` — add `chokidar`.

---

## PHASE 1 — Critical Fixes

### Task 1: Wire `withRetry` into OpenAI provider

**Files:**
- Modify: `src/providers/openai.ts`
- Test: `tests/unit/providers/openai.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/providers/openai.test.ts`:

```typescript
import { OpenAIProvider } from '../../../src/providers/openai';

// Mock the openai module
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});
import OpenAI from 'openai';

describe('OpenAIProvider retry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries on 429 then succeeds', async () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4o-mini');
    const create = (provider as any).client.chat.completions.create as jest.Mock;

    create
      .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

    const result = await provider.generate('hi', { maxTokens: 10 });
    expect(result).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error', async () => {
    const provider = new OpenAIProvider('test-key', 'gpt-4o-mini');
    const create = (provider as any).client.chat.completions.create as jest.Mock;
    create.mockRejectedValue({ status: 401, message: 'Invalid key' });

    await expect(provider.generate('hi')).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/providers/openai.test.ts`
Expected: FAIL — first test sees only 1 call (no retry) or timeout.

- [ ] **Step 3: Implement retry wrapping**

Replace the body of `src/providers/openai.ts` `generate()` so the network call is wrapped in `withRetry`. Keep the existing error-translation but let `withRetry` decide retryability. Full file:

```typescript
import OpenAI from 'openai';
import { LLMProvider, GenerateOptions } from './types';
import { withRetry } from '../core/retry';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string, private model: string = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const run = async (): Promise<string> => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature ?? 0.3,
          ...(options.responseFormat === 'json' && {
            response_format: { type: 'json_object' as const },
          }),
        });
        return response.choices[0]?.message?.content || '';
      } catch (error: any) {
        if (error.status === 429) {
          throw new Error('429 rate limited: OpenAI');
        }
        throw new Error(`OpenAI API error: ${error.message}`);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
```

Note: the thrown error now contains `429` so `isRetryableError` matches it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/providers/openai.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai.ts tests/unit/providers/openai.test.ts
git commit -m "fix(openai): wrap generate in withRetry for resilience"
```

---

### Task 2: Wire `withRetry` into Anthropic + Ollama providers

**Files:**
- Modify: `src/providers/anthropic.ts`, `src/providers/ollama.ts`
- Test: `tests/unit/providers/ollama.test.ts` (create)

- [ ] **Step 1: Write the failing test for Ollama retry**

Create `tests/unit/providers/ollama.test.ts`:

```typescript
import { OllamaProvider } from '../../../src/providers/ollama';

describe('OllamaProvider retry', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('retries on ECONNREFUSED pattern then succeeds', async () => {
    const provider = new OllamaProvider('http://localhost:11434', 'llama3');
    const ok = { ok: true, json: async () => ({ response: 'hi' }) };

    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce({ cause: { code: 'ECONNREFUSED' }, message: 'refused' })
      .mockResolvedValueOnce(ok as any);

    const result = await provider.generate('hi');
    expect(result).toBe('hi');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const provider = new OllamaProvider('http://localhost:11434', 'llama3');
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false, status: 400, statusText: 'Bad Request',
    } as any);

    await expect(provider.generate('hi')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/providers/ollama.test.ts`
Expected: FAIL — no retry yet.

- [ ] **Step 3: Implement retry in Ollama**

Replace `src/providers/ollama.ts`:

```typescript
import { LLMProvider, GenerateOptions } from './types';
import { withRetry } from '../core/retry';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  constructor(
    private host: string = 'http://localhost:11434',
    private model: string = 'llama3'
  ) {}

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const run = async (): Promise<string> => {
      try {
        const response = await fetch(`${this.host}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt: fullPrompt,
            stream: false,
            options: {
              temperature: options.temperature ?? 0.3,
              num_predict: options.maxTokens || 4096,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as { response: string };
        return data.response;
      } catch (error: any) {
        if (error.cause?.code === 'ECONNREFUSED') {
          throw new Error(
            `ECONNREFUSED: cannot connect to Ollama at ${this.host}`
          );
        }
        throw new Error(`Ollama error: ${error.message}`);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
```

- [ ] **Step 4: Implement retry in Anthropic**

Replace `src/providers/anthropic.ts` (keep the dynamic import; wrap call in `withRetry`):

```typescript
import { LLMProvider, GenerateOptions } from './types';
import { withRetry } from '../core/retry';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(private apiKey: string, private model: string = 'claude-sonnet-4-20250514') {}

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    let Anthropic: any;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }
    const client = new Anthropic({ apiKey: this.apiKey });

    const run = async (): Promise<string> => {
      try {
        const response = await client.messages.create({
          model: this.model,
          max_tokens: options.maxTokens || 4096,
          system: options.systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        });
        const textBlock = response.content.find((block: any) => block.type === 'text');
        return (textBlock as any)?.text || '';
      } catch (error: any) {
        const status = error.status ?? '';
        if (status === 429) throw new Error('429 rate limited: Anthropic');
        throw new Error(`Anthropic API error: ${error.message}`);
      }
    };

    return withRetry(run, { maxRetries: 3 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/providers/ollama.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/providers/anthropic.ts src/providers/ollama.ts tests/unit/providers/ollama.test.ts
git commit -m "fix(providers): wrap anthropic+ollama generate in withRetry"
```

---

### Task 3: Reuse a single ts-morph `Project` in TypeScriptParser

**Files:**
- Modify: `src/parsers/typescript.ts`
- Test: `tests/unit/parsers/typescript.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/parsers/typescript.test.ts` (before the final `});`):

```typescript
  it('reuses a single Project instance across parses (performance)', async () => {
    const before = (TypeScriptParser as any).sharedProjectCount ?? 0;
    await parser.parse(fixturePath);
    await parser.parse(fixturePath);
    const after = (TypeScriptParser as any).sharedProjectCount ?? 0;
    expect(after).toBe(before + 1); // Project created once, not per parse
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/parsers/typescript.test.ts`
Expected: FAIL — `sharedProjectCount` is undefined.

- [ ] **Step 3: Implement shared Project**

Modify `src/parsers/typescript.ts`. Add a module-level singleton and a static counter the test can observe. Replace the top of the class:

```typescript
import { Project, SourceFile, Scope, MethodDeclaration, ParameterDeclaration } from 'ts-morph';
import {
  LanguageParser, ParsedModule, FunctionInfo, ClassInfo,
  TypeInfo, MethodInfo, ImportStatement, ParameterInfo
} from './types';

// One shared Project for the whole process — avoids re-booting the
// TypeScript compiler for every file (was a major perf bottleneck).
let sharedProject: Project | null = null;

export class TypeScriptParser implements LanguageParser {
  readonly name = 'typescript';
  readonly supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'];

  /** Visible for tests: how many times the Project was constructed. */
  static sharedProjectCount = 0;

  private getProject(): Project {
    if (!sharedProject) {
      sharedProject = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: true },
      });
      TypeScriptParser.sharedProjectCount++;
    }
    return sharedProject;
  }

  async parse(filePath: string): Promise<ParsedModule> {
    const project = this.getProject();
    const sourceFile = project.addSourceFileAtPath(filePath);

    return {
      filePath,
      language: 'typescript',
      functions: this.extractFunctions(sourceFile),
      classes: this.extractClasses(sourceFile),
      types: this.extractTypes(sourceFile),
      imports: this.extractImports(sourceFile),
    };
  }
```

Leave the private extraction methods (`extractFunctions`, etc.) unchanged below.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/parsers/typescript.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/parsers/typescript.ts tests/unit/parsers/typescript.test.ts
git commit -m "fix(typescript-parser): reuse single ts-morph Project per run"
```

---

### Task 4: Harden `annotate` JSON parsing

**Files:**
- Modify: `src/cli/commands/annotate.ts:51-57`

- [ ] **Step 1: Locate the fragile line**

`src/cli/commands/annotate.ts` line ~55: `annotations = JSON.parse(response);` — crashes on malformed LLM output.

- [ ] **Step 2: Implement guarded parsing**

Replace the block (inside the `else` after the mock branch):

```typescript
      } else {
        const provider = createProvider(config);
        const templatesDir = path.resolve(__dirname, '../../templates');
        const generator = new Generator(provider, templatesDir);
        const response = await generator.generateJsDoc(undocumented);
        try {
          annotations = JSON.parse(stripCodeFences(response));
        } catch {
          throw new Error(
            'LLM returned malformed JSON for annotations. ' +
            'Try again or use --mock. Raw response:\n' + response.slice(0, 500)
          );
        }
      }
```

Add a small helper at the top of the file (after imports):

```typescript
/** Strips ```json ... ``` fences an LLM may wrap around a JSON response. */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return match ? match[1].trim() : trimmed;
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/annotate.ts
git commit -m "fix(annotate): guard JSON.parse, strip code fences from LLM output"
```

---

## PHASE 2 — Provider Registry + Shared Command Layer

### Task 5: Create provider registry

**Files:**
- Create: `src/providers/registry.ts`
- Test: `tests/unit/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/providers/registry.test.ts`:

```typescript
import { registerProvider, listProviders, createProvider } from '../../../src/providers/registry';

describe('provider registry', () => {
  it('lists built-in providers', () => {
    const names = listProviders().map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['openai', 'anthropic', 'ollama']));
  });

  it('creates a known provider', () => {
    const p = createProvider({ provider: 'ollama' });
    expect(p.name).toBe('ollama');
  });

  it('throws on unknown provider', () => {
    expect(() => createProvider({ provider: 'nope' as any })).toThrow('Unknown provider: nope');
  });

  it('lets third parties register a provider', () => {
    const fake = { generate: async () => 'fake' };
    registerProvider({
      name: 'fake',
      available: () => true,
      create: () => fake as any,
    });
    const p = createProvider({ provider: 'fake' });
    expect(p.name).toBe('fake');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/providers/registry.test.ts`
Expected: FAIL — module doesn't export yet.

- [ ] **Step 3: Implement the registry**

Create `src/providers/registry.ts`:

```typescript
import { LLMProvider } from './types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';

export interface ProviderDefinition {
  name: string;
  /** Returns true when all prerequisites are met (key present, SDK installed). */
  available: (config: ProviderConfig) => boolean;
  /** Human-readable reason when not available. */
  missingMessage?: string;
  create: (config: ProviderConfig) => LLMProvider;
}

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  ollamaHost?: string;
}

const registry = new Map<string, ProviderDefinition>();

/** Registers a provider. Lets the community add providers without editing core. */
export function registerProvider(def: ProviderDefinition): void {
  registry.set(def.name, def);
}

export function listProviders(): ProviderDefinition[] {
  return Array.from(registry.values());
}

export function createProvider(config: ProviderConfig): LLMProvider {
  const def = registry.get(config.provider);
  if (!def) {
    throw new Error(
      `Unknown provider: ${config.provider}. Available: ${listProviders().map(p => p.name).join(', ')}`
    );
  }
  if (!def.available(config)) {
    throw new Error(def.missingMessage || `Provider "${config.provider}" is not available.`);
  }
  return def.create(config);
}

// --- Built-in providers (self-register) ---
registerProvider({
  name: 'openai',
  available: (c) => !!(c.apiKey || process.env.OPENAI_API_KEY),
  missingMessage:
    'OpenAI API key is required.\nSet it via:\n' +
    '  • Environment variable: export OPENAI_API_KEY="sk-..."\n' +
    '  • Config file: add "apiKey" to .aidocrc.json\n' +
    '  • .env file: OPENAI_API_KEY=sk-...',
  create: (c) => new OpenAIProvider(c.apiKey || process.env.OPENAI_API_KEY!, c.model),
});

registerProvider({
  name: 'anthropic',
  available: (c) => !!(c.apiKey || process.env.ANTHROPIC_API_KEY),
  missingMessage:
    'Anthropic API key is required.\n' +
    'Set it via:\n' +
    '  • Environment variable: export ANTHROPIC_API_KEY="sk-ant-..."\n' +
    '  • Config file: add "apiKey" to .aidocrc.json',
  create: (c) => new AnthropicProvider(c.apiKey || process.env.ANTHROPIC_API_KEY!, c.model),
});

registerProvider({
  name: 'ollama',
  available: () => true,
  create: (c) => new OllamaProvider(c.ollamaHost, c.model),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/providers/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/unit/providers/registry.test.ts
git commit -m "feat(providers): add pluggable provider registry"
```

---

### Task 6: Point factory + schema at the registry

**Files:**
- Modify: `src/providers/factory.ts`, `src/config/schema.ts`
- Test: `tests/unit/providers/factory.test.ts` (existing, must stay green)

- [ ] **Step 1: Slim the factory to delegate**

Replace `src/providers/factory.ts`:

```typescript
// The factory is kept as a thin re-export for backwards compatibility.
// New code should import createProvider/listProviders from ./registry.
export { createProvider, listProviders, registerProvider } from './registry';
export type { ProviderConfig, ProviderDefinition } from './registry';
```

- [ ] **Step 2: Validate provider name dynamically in schema**

Modify `src/config/schema.ts` — replace the static enum with a lazy check so the schema and registry share one source of truth:

```typescript
import { z } from 'zod';
import { listProviders } from '../providers/registry';

export const ConfigSchema = z.object({
  provider: z.string().default('openai').refine(
    (val) => listProviders().some(p => p.name === val),
    (val) => ({ message: `Unknown provider: ${val}. Available: ${listProviders().map(p => p.name).join(', ')}` })
  ),
  model: z.string().default('gpt-4o-mini'),
  apiKey: z.string().optional(),
  ollamaHost: z.string().default('http://localhost:11434'),
  include: z.array(z.string()).default(['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py']),
  exclude: z.array(z.string()).default([
    '**/node_modules/**', '**/dist/**', '**/build/**',
    '**/.git/**', '**/coverage/**', '**/*.test.*', '**/*.spec.*',
    '**/package-lock.json', '**/yarn.lock'
  ]),
  language: z.string().default('en'),
  outputDir: z.string().default('./docs'),
  templates: z.string().optional(),
  readme: z.object({
    badges: z.boolean().default(true),
    tableOfContents: z.boolean().default(true),
    installSection: z.boolean().default(true),
    usageExamples: z.boolean().default(true),
  }).default({
    badges: true,
    tableOfContents: true,
    installSection: true,
    usageExamples: true,
  }),
});

export type AidocConfig = z.infer<typeof ConfigSchema>;
export const defaultConfig: AidocConfig = ConfigSchema.parse({});
```

- [ ] **Step 3: Run the full provider + config test suites**

Run: `npx jest tests/unit/providers/ tests/unit/config/`
Expected: PASS (factory tests still green via re-export; registry tests green).

- [ ] **Step 4: Commit**

```bash
git add src/providers/factory.ts src/config/schema.ts
git commit -m "refactor(providers): factory delegates to registry; schema validates dynamically"
```

---

### Task 7: Shared command context + `MockGenerator`

**Files:**
- Create: `src/cli/mock-generator.ts`, `src/cli/context.ts`
- Test: `tests/unit/cli/context.test.ts`

- [ ] **Step 1: Create MockGenerator**

Create `src/cli/mock-generator.ts` — relocates the inline mock strings from each command into one place implementing the same method surface as `Generator`:

```typescript
import * as path from 'path';
import { ParsedModule } from '../parsers/types';

/**
 * Drop-in stand-in for Generator used by --mock. Produces deterministic output
 * without calling an LLM, so the CLI can be demoed/tested with no API key.
 */
export class MockGenerator {
  async generateReadme(ctx: {
    projectName: string; description: string; modules: ParsedModule[]; dependencies: string[];
  }): Promise<string> {
    const funcList = ctx.modules.flatMap(m =>
      m.functions.map(f => `- \`${f.name}()\` — ${f.existingDoc || 'No description'}`)
    );
    const classList = ctx.modules.flatMap(m =>
      m.classes.map(c => `- \`${c.name}\` — ${c.existingDoc || 'No description'}`)
    );
    return [
      `# ${ctx.projectName}`, '',
      `> ${ctx.description || 'An awesome project'}`, '',
      '[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)',
      '[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://typescriptlang.org/)', '',
      '## Features', '',
      '- 🧠 AI-powered documentation generation',
      '- 📊 AST-based code analysis',
      '- 🔄 Diff-aware documentation updates', '',
      '## Installation', '',
      '```bash', `npm install ${ctx.projectName}`, '```', '',
      '## API', '',
      ...(funcList.length ? ['### Functions', '', ...funcList, ''] : []),
      ...(classList.length ? ['### Classes', '', ...classList, ''] : []),
      '## License', '', 'MIT',
    ].join('\n');
  }

  async generateApiDocs(modules: ParsedModule[]): Promise<string> {
    const sections = modules.map(m => {
      const funcs = m.functions.map(f =>
        `### \`${f.name}(${f.parameters.map(p => p.name).join(', ')})\`\n\n${f.existingDoc || 'No description available.'}\n\n**Returns:** \`${f.returnType}\`\n`
      ).join('\n');
      const classes = m.classes.map(c =>
        `### Class: \`${c.name}\`\n\n${c.existingDoc || 'No description available.'}\n`
      ).join('\n');
      return `## ${path.basename(m.filePath)}\n\n${funcs}${classes}`;
    });
    return `# API Documentation\n\n${sections.join('\n---\n\n')}`;
  }

  async generateDiagram(modules: ParsedModule[]): Promise<string> {
    const nodes = modules.map((m, i) => {
      const name = path.basename(m.filePath, path.extname(m.filePath));
      return `    N${i}["${name}"]`;
    });
    const edges = modules.slice(1).map((_, i) => `    N0 --> N${i + 1}`);
    return `graph TD\n${nodes.join('\n')}\n${edges.join('\n')}`;
  }

  async generateJsDoc(symbols: any[]): Promise<string> {
    return JSON.stringify(symbols.map((f: any) => ({
      name: f.name,
      jsdoc: `/**\n * ${f.name} — auto-generated documentation.\n${(f.parameters || []).map((p: any) => ` * @param ${p.name} - The ${p.name} parameter\n`).join('')} * @returns ${f.returnType || 'void'}\n */`,
    })));
  }

  async generateChangelog(ctx: { commits: any[]; version: string }): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    return [
      `## [${ctx.version}] - ${today}`, '',
      '### Added',
      ...ctx.commits.filter((c: any) => c.message.startsWith('feat')).map((c: any) => `- ${c.message}`),
      '', '### Fixed',
      ...ctx.commits.filter((c: any) => c.message.startsWith('fix')).map((c: any) => `- ${c.message}`),
      '', '### Changed',
      ...ctx.commits.filter((c: any) => !c.message.startsWith('feat') && !c.message.startsWith('fix')).map((c: any) => `- ${c.message}`),
    ].join('\n');
  }

  async generateUpdate(ctx: { existingDoc: string; changedFiles: string[] }): Promise<string> {
    return ctx.existingDoc + `\n\n> 📅 Last updated: ${new Date().toISOString().split('T')[0]} (${ctx.changedFiles.length} files changed)\n`;
  }
}
```

- [ ] **Step 2: Create the shared context + writeDoc helper**

Create `src/cli/context.ts`:

```typescript
import * as path from 'path';
import * as fs from 'fs';
import prompts from 'prompts';
import chalk from 'chalk';
import { loadConfig, AidocConfig } from '../config/loader';
import { createProvider } from '../providers/registry';
import { Generator } from '../core/generator';
import { MockGenerator } from './mock-generator';
import { analyzeCodebase } from '../core/analyzer';
import { writeMarkdown, readExistingMarkdown, validateMarkdown } from '../output/markdown';
import { displayDiff } from '../output/diff-display';
import { logger } from '../core/logger';

export interface CommandOptions {
  mock?: boolean;
  dryRun?: boolean;
}

export interface CommandContext {
  config: AidocConfig;
  cwd: string;
  generator: Generator | MockGenerator;
  isMock: boolean;
}

/** Builds the shared context every command needs. Chooses real/mock generator. */
export async function loadCommandContext(options: CommandOptions, cwd = process.cwd()): Promise<CommandContext> {
  const config = loadConfig();
  const isMock = !!options.mock;
  const generator = isMock
    ? new MockGenerator()
    : new Generator(createProvider(config), path.resolve(__dirname, '../templates'));
  return { config, cwd, generator, isMock };
}

/**
 * Writes a generated document with the standard flow: show diff if a file
 * exists, confirm (unless dry-run/--auto), write, validate. Centralizes the
 * logic that was copy-pasted across commands.
 */
export async function writeDoc(
  outputPath: string,
  content: string,
  opts: { dryRun?: boolean; auto?: boolean; label?: string } = {}
): Promise<void> {
  const label = opts.label || path.basename(outputPath);
  const existing = readExistingMarkdown(outputPath);

  // Warn (don't fail) on malformed output — e.g. unclosed code fences.
  const { warnings } = validateMarkdown(content);
  warnings.forEach(w => logger.warn(w));

  if (existing) {
    displayDiff(label, existing, content);
    if (opts.dryRun) return;
    const { confirm } = opts.auto
      ? { confirm: true }
      : await prompts({ type: 'confirm', name: 'confirm', message: `Apply changes to ${label}?`, initial: true });
    if (confirm) {
      writeMarkdown(outputPath, content);
      console.log(chalk.green(`✔ Updated ${label}`));
    } else {
      console.log(chalk.yellow('Skipped.'));
    }
  } else if (opts.dryRun) {
    console.log('\n' + content);
  } else {
    writeMarkdown(outputPath, content);
    console.log(chalk.green(`✔ Created ${label}`));
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `tests/unit/cli/context.test.ts`:

```typescript
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { loadCommandContext, writeDoc } from '../../../src/cli/context';

describe('loadCommandContext', () => {
  it('returns a mock generator when mock is set', async () => {
    const ctx = await loadCommandContext({ mock: true });
    expect(ctx.isMock).toBe(true);
    expect(ctx.generator.constructor.name).toBe('MockGenerator');
  });
});

describe('writeDoc', () => {
  const tmp = path.join(os.tmpdir(), `aidoc-test-${Date.now()}.md`);

  afterEach(() => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } });

  it('creates a new file (no existing, no dry-run)', async () => {
    await writeDoc(tmp, '# Hello\n', {});
    expect(fs.readFileSync(tmp, 'utf8')).toBe('# Hello\n');
  });

  it('dry-run writes nothing', async () => {
    await writeDoc(tmp, '# Hello\n', { dryRun: true });
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/cli/context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/context.ts src/cli/mock-generator.ts tests/unit/cli/context.test.ts
git commit -m "refactor(cli): shared CommandContext + writeDoc helper + MockGenerator"
```

---

### Task 8: Migrate commands onto the shared layer

**Files:**
- Modify: all 6 commands in `src/cli/commands/`

This task is mechanical: replace each command's duplicated skeleton + mock branch with `loadCommandContext` + `writeDoc`. Do them one at a time, running the build after each.

- [ ] **Step 1: Rewrite `readme.ts`**

Replace the action body of `src/cli/commands/readme.ts` to use the shared layer:

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeCodebase } from '../../core/analyzer';
import { loadCommandContext, writeDoc } from '../context';

export const readmeCommand = new Command('readme')
  .description('Generate README.md from code analysis')
  .option('-o, --output <path>', 'Output file path', './README.md')
  .option('--dry-run', 'Preview without writing to file')
  .option('--no-badges', 'Skip badges generation')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Scanning codebase...').start();
    try {
      const ctx = await loadCommandContext(options);
      const modules = await analyzeCodebase(ctx.cwd, ctx.config.include, ctx.config.exclude);

      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found.'));
        return;
      }
      spinner.succeed(chalk.green(`Found ${modules.length} modules to analyze`));

      const pkgPath = path.join(ctx.cwd, 'package.json');
      let projectName = path.basename(ctx.cwd);
      let description = '';
      let dependencies: string[] = [];
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        projectName = pkg.name || projectName;
        description = pkg.description || '';
        dependencies = Object.keys(pkg.dependencies || {});
      }

      const genSpinner = ora('Generating README with AI...').start();
      const readme = await ctx.generator.generateReadme({
        projectName, description, modules, dependencies,
        badges: options.badges !== false,
        tableOfContents: ctx.config.readme.tableOfContents,
        installSection: ctx.config.readme.installSection,
        usageExamples: ctx.config.readme.usageExamples,
      } as any);
      genSpinner.succeed(chalk.green('README generated!'));

      await writeDoc(path.resolve(ctx.cwd, options.output), readme, { dryRun: options.dryRun, label: options.output });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate README'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 2: Rewrite `api.ts`**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { analyzeCodebase } from '../../core/analyzer';
import { loadCommandContext, writeDoc } from '../context';

export const apiCommand = new Command('api')
  .description('Generate API documentation from code analysis')
  .option('-o, --output <path>', 'Output file path', './docs/API.md')
  .option('--dry-run', 'Preview without writing to file')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Scanning codebase for API symbols...').start();
    try {
      const ctx = await loadCommandContext(options);
      const modules = await analyzeCodebase(ctx.cwd, ctx.config.include, ctx.config.exclude);
      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found.'));
        return;
      }
      spinner.succeed(chalk.green(`Found ${modules.length} modules`));

      const genSpinner = ora('Generating API documentation...').start();
      const apiDocs = await ctx.generator.generateApiDocs(modules);
      genSpinner.succeed(chalk.green('API documentation generated!'));

      await writeDoc(path.resolve(ctx.cwd, options.output), apiDocs, { dryRun: options.dryRun, label: options.output });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate API docs'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Rewrite `diagram.ts`**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { analyzeCodebase } from '../../core/analyzer';
import { loadCommandContext, writeDoc } from '../context';

export const diagramCommand = new Command('diagram')
  .description('Generate architecture diagram (Mermaid) from code analysis')
  .option('-o, --output <path>', 'Output file path', './docs/architecture.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Analyzing project architecture...').start();
    try {
      const ctx = await loadCommandContext(options);
      const modules = await analyzeCodebase(ctx.cwd, ctx.config.include, ctx.config.exclude);
      if (modules.length === 0) {
        spinner.warn(chalk.yellow('No supported source files found.'));
        return;
      }
      spinner.succeed(chalk.green(`Analyzed ${modules.length} modules`));

      const genSpinner = ora('Generating architecture diagram...').start();
      const diagram = await ctx.generator.generateDiagram(modules);
      genSpinner.succeed(chalk.green('Architecture diagram generated!'));

      const output = `# Architecture\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
      await writeDoc(path.resolve(ctx.cwd, options.output), output, { dryRun: options.dryRun, label: options.output });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate diagram'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Rewrite `changelog.ts`** (uses git history, not codebase analysis)

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { loadCommandContext, writeDoc } from '../context';
import { readExistingMarkdown } from '../../output/markdown';
import { getCommitsSince, getLatestTag } from '../../git/history';

export const changelogCommand = new Command('changelog')
  .description('Generate CHANGELOG from git history')
  .option('--from <ref>', 'Start ref (tag, commit, or branch)')
  .option('--to <ref>', 'End ref', 'HEAD')
  .option('--version <ver>', 'Version string for the entry', 'Unreleased')
  .option('-o, --output <path>', 'Output file path', './CHANGELOG.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Reading git history...').start();
    try {
      const ctx = await loadCommandContext(options);
      const fromRef = options.from || (await getLatestTag()) || 'HEAD~20';
      const toRef = options.to;
      const commits = await getCommitsSince(fromRef, toRef);

      if (commits.length === 0) {
        spinner.warn(chalk.yellow('No commits found in the specified range.'));
        return;
      }
      spinner.succeed(chalk.green(`Found ${commits.length} commits`));

      const genSpinner = ora('Generating CHANGELOG entry...').start();
      const entry = await ctx.generator.generateChangelog({
        commits, version: options.version,
        date: new Date().toISOString().split('T')[0], fromRef, toRef,
      } as any);
      genSpinner.succeed(chalk.green('CHANGELOG entry generated!'));

      // Changelog prepends to an existing file rather than replacing it.
      const outputPath = path.resolve(ctx.cwd, options.output);
      const header = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n';
      const existing = readExistingMarkdown(outputPath);
      const content = existing
        ? existing.replace(/^# Changelog.*?\n\n/s, header + entry + '\n\n')
        : header + entry;

      await writeDoc(outputPath, content, { dryRun: options.dryRun, label: options.output });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to generate CHANGELOG'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 5: Rewrite `update.ts`**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { loadCommandContext, writeDoc } from '../context';
import { readExistingMarkdown } from '../../output/markdown';
import { getChangedFiles, getDiff } from '../../git/history';
import { buildUpdateContext } from '../../core/differ';

export const updateCommand = new Command('update')
  .description('Update existing documentation based on code changes (diff-aware)')
  .option('--since <ref>', 'Git ref to compare from (default: last commit)')
  .option('--target <file>', 'Which doc file to update', './README.md')
  .option('--dry-run', 'Preview without writing')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Checking for code changes...').start();
    try {
      const ctx = await loadCommandContext(options);
      const sinceRef = options.since || 'HEAD~5';
      const targetPath = path.resolve(ctx.cwd, options.target);

      const existingDoc = readExistingMarkdown(targetPath);
      if (!existingDoc) {
        spinner.fail(chalk.red(`File not found: ${options.target}. Run 'aidoc readme' first.`));
        process.exit(1);
      }

      const changedFiles = await getChangedFiles(sinceRef, 'HEAD', ctx.cwd);
      if (changedFiles.length === 0) {
        spinner.succeed(chalk.green('No code changes found. Documentation is up to date! ✅'));
        return;
      }
      spinner.succeed(chalk.yellow(`Found ${changedFiles.length} changed files since ${sinceRef}`));

      const genSpinner = ora('Updating documentation with AI...').start();
      let updatedDoc: string;
      if (ctx.isMock) {
        updatedDoc = await ctx.generator.generateUpdate({ existingDoc, changedFiles } as any);
      } else {
        const diffSummary = await getDiff(sinceRef, 'HEAD', ctx.cwd);
        const updateCtx = buildUpdateContext(existingDoc, changedFiles, diffSummary);
        updatedDoc = await ctx.generator.generateUpdate(updateCtx);
      }
      genSpinner.succeed(chalk.green('Documentation updated!'));

      await writeDoc(targetPath, updatedDoc, { dryRun: options.dryRun, label: options.target });
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to update documentation'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 6: Simplify `annotate.ts`** (keep its file-rewrite logic; use context for provider/mock selection)

Modify `src/cli/commands/annotate.ts` — replace the provider/mock branching (lines ~43-89) with context, keeping the file-insertion loop. New full file:

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import * as fs from 'fs';
import * as path from 'path';
import { loadCommandContext } from '../context';
import { analyzeCodebase } from '../../core/analyzer';
import { displayDiff } from '../../output/diff-display';

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return match ? match[1].trim() : trimmed;
}

export const annotateCommand = new Command('annotate')
  .description('Add JSDoc/TSDoc comments to undocumented functions')
  .option('--file <path>', 'Annotate a specific file')
  .option('--all', 'Annotate all files in the project')
  .option('--dry-run', 'Preview without writing changes')
  .option('--mock', 'Use mock LLM response for testing')
  .action(async (options) => {
    const spinner = ora('Finding undocumented functions...').start();
    try {
      const ctx = await loadCommandContext(options);
      const include = options.file ? [options.file] : ctx.config.include;
      const modules = await analyzeCodebase(ctx.cwd, include, ctx.config.exclude);

      const undocumented = modules.flatMap(m =>
        m.functions.filter(f => !f.existingDoc).map(f => ({ ...f, filePath: m.filePath }))
      );
      if (undocumented.length === 0) {
        spinner.succeed(chalk.green('All exported functions are already documented! 🎉'));
        return;
      }
      spinner.succeed(chalk.yellow(`Found ${undocumented.length} undocumented functions`));

      const genSpinner = ora('Generating JSDoc comments with AI...').start();
      const response = await ctx.generator.generateJsDoc(undocumented);
      let annotations: { name: string; jsdoc: string }[];
      try {
        annotations = JSON.parse(stripCodeFences(response));
      } catch {
        throw new Error('LLM returned malformed JSON for annotations. Try again or use --mock.');
      }
      genSpinner.succeed(chalk.green('JSDoc comments generated!'));

      for (const ann of annotations) {
        const func = undocumented.find(f => f.name === ann.name);
        if (!func) continue;
        const filePath = (func as any).filePath;
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const insertLine = func.lineRange[0] - 1;
        const indent = lines[insertLine]?.match(/^(\s*)/)?.[1] || '';
        const jsdocLines = ann.jsdoc.split('\n').map(l => indent + l).join('\n');
        lines.splice(insertLine, 0, jsdocLines);
        const newContent = lines.join('\n');

        console.log(chalk.cyan(`\n📝 ${path.basename(filePath)}: ${ann.name}`));
        displayDiff(path.basename(filePath), content, newContent);

        if (!options.dryRun) {
          const { apply } = await prompts({ type: 'confirm', name: 'apply', message: `Apply JSDoc to ${ann.name}?`, initial: true });
          if (apply) {
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(chalk.green(`✔ Updated ${path.basename(filePath)}`));
          }
        }
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to annotate code'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 7: Verify the build + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: build clean; all existing tests still PASS (behavior preserved).

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/
git commit -m "refactor(cli): migrate all commands onto shared context layer"
```

---

## PHASE 3 — Doc-Quality Scoring

### Task 9: Scoring engine

**Files:**
- Create: `src/core/score.ts`
- Test: `tests/unit/core/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/score.test.ts`:

```typescript
import { scoreModules, bucket } from '../../../src/core/score';
import { ParsedModule } from '../../../src/parsers/types';

const mod = (overrides: Partial<ParsedModule>): ParsedModule => ({
  filePath: 'x.ts', language: 'typescript',
  functions: [], classes: [], types: [], imports: [],
  ...overrides,
});

describe('scoreModules', () => {
  it('scores 100 when all exported symbols are documented', () => {
    const m = mod({
      functions: [{ name: 'f', parameters: [], isAsync: false, isExported: true, lineRange: [1, 1], signature: '', existingDoc: 'doc' } as any],
      classes: [{ name: 'C', implements: [], methods: [], properties: [], isExported: true, lineRange: [1, 1], existingDoc: 'doc' } as any],
    });
    expect(scoreModules([m]).score).toBe(100);
  });

  it('scores 0 when nothing is documented', () => {
    const m = mod({
      functions: [{ name: 'f', parameters: [], isAsync: false, isExported: true, lineRange: [1, 1], signature: '' } as any],
    });
    expect(scoreModules([m]).score).toBe(0);
  });

  it('ignores non-exported symbols', () => {
    const m = mod({
      functions: [{ name: 'f', parameters: [], isAsync: false, isExported: false, lineRange: [1, 1], signature: '' } as any],
    });
    // no exportable symbols -> vacuously fully documented
    expect(scoreModules([m]).score).toBe(100);
  });

  it('counts undocumented methods against the class', () => {
    const m = mod({
      classes: [{
        name: 'C', implements: [], isExported: true, lineRange: [1, 5],
        existingDoc: 'doc', properties: [],
        methods: [
          { name: 'a', parameters: [], isAsync: false, isExported: true, lineRange: [1, 1], signature: '', visibility: 'public', isStatic: false },
          { name: 'b', parameters: [], isAsync: false, isExported: true, lineRange: [2, 2], signature: '', visibility: 'public', isStatic: false, existingDoc: 'doc' },
        ],
      } as any],
    });
    // 1 of 2 methods documented -> 50
    expect(scoreModules([m]).score).toBe(50);
  });

  it('flags stub docs as low-quality', () => {
    const m = mod({
      functions: [{ name: 'f', parameters: [], isAsync: false, isExported: true, lineRange: [1, 1], signature: '', existingDoc: 'TODO' } as any],
    });
    const result = scoreModules([m]);
    expect(result.score).toBe(100); // presence-based score unaffected
    expect(result.lowQualityCount).toBe(1);
  });
});

describe('bucket', () => {
  it('returns the right band', () => {
    expect(bucket(0)).toBe('poor');
    expect(bucket(39)).toBe('poor');
    expect(bucket(40)).toBe('fair');
    expect(bucket(69)).toBe('fair');
    expect(bucket(70)).toBe('good');
    expect(bucket(100)).toBe('good');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/core/score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine**

Create `src/core/score.ts`:

```typescript
import { ParsedModule } from '../parsers/types';

export interface ModuleScore {
  filePath: string;
  totalSymbols: number;
  documentedSymbols: number;
  coverage: number; // 0-100
  undocumented: string[]; // symbol names
}

export interface ScoreResult {
  score: number; // 0-100 project aggregate
  band: 'poor' | 'fair' | 'good';
  modules: ModuleScore[];
  totalSymbols: number;
  documentedSymbols: number;
  lowQualityCount: number; // docs that are placeholders
}

const STUB_PATTERNS = /^(todo|fixme|placeholder|no description|stub|tbd|\.{3})/i;

/** Counts a single symbol toward coverage. Returns [documented?, lowQuality?]. */
function assessDoc(doc: string | undefined): [boolean, boolean] {
  if (!doc || !doc.trim()) return [false, false];
  const low = STUB_PATTERNS.test(doc.trim());
  return [true, low];
}

export function scoreModules(modules: ParsedModule[]): ScoreResult {
  const moduleScores: ModuleScore[] = [];
  let totalSymbols = 0;
  let documentedSymbols = 0;
  let lowQualityCount = 0;

  for (const m of modules) {
    let total = 0;
    let documented = 0;
    const undocumented: string[] = [];

    for (const f of m.functions) {
      if (!f.isExported) continue;
      total++;
      const [isDoc, isLow] = assessDoc(f.existingDoc);
      if (isDoc) documented++; else undocumented.push(f.name);
      if (isLow) lowQualityCount++;
    }

    for (const c of m.classes) {
      if (!c.isExported) continue;
      total++;
      const [isDoc, isLow] = assessDoc(c.existingDoc);
      if (isDoc) documented++; else undocumented.push(c.name);
      if (isLow) lowQualityCount++;

      for (const meth of c.methods) {
        total++;
        const [mDoc, mLow] = assessDoc(meth.existingDoc);
        if (mDoc) documented++; else undocumented.push(`${c.name}.${meth.name}`);
        if (mLow) lowQualityCount++;
      }
    }

    totalSymbols += total;
    documentedSymbols += documented;
    moduleScores.push({
      filePath: m.filePath,
      totalSymbols: total,
      documentedSymbols: documented,
      coverage: total === 0 ? 100 : Math.round((documented / total) * 100),
      undocumented,
    });
  }

  const score = totalSymbols === 0 ? 100 : Math.round((documentedSymbols / totalSymbols) * 100);
  return {
    score,
    band: bucket(score),
    modules: moduleScores,
    totalSymbols,
    documentedSymbols,
    lowQualityCount,
  };
}

export function bucket(score: number): 'poor' | 'fair' | 'good' {
  if (score < 40) return 'poor';
  if (score < 70) return 'fair';
  return 'good';
}

export const BAND_META: Record<'poor' | 'fair' | 'good', { emoji: string; label: string }> = {
  poor: { emoji: '🔴', label: 'Poor' },
  fair: { emoji: '🟡', label: 'Fair' },
  good: { emoji: '🟢', label: 'Good' },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/core/score.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/score.ts tests/unit/core/score.test.ts
git commit -m "feat(score): deterministic documentation coverage engine"
```

---

### Task 10: `aidoc score` command + template

**Files:**
- Create: `src/templates/score.hbs`, `src/cli/commands/score.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create the score template**

Create `src/templates/score.hbs`:

```handlebars
# Documentation Health Report

**Overall score:** {{result.score}}/100 ({{bandMeta.emoji}} {{bandMeta.label}})
**Symbols documented:** {{result.documentedSymbols}}/{{result.totalSymbols}}
{{#if result.lowQualityCount}}**Low-quality (stub) docs:** {{result.lowQualityCount}}{{/if}}

## Per-module breakdown

| Module | Coverage | Documented | Missing |
|:-------|---------:|-----------:|:--------|
{{#each result.modules}}
| `{{this.filePath}}` | {{this.coverage}}% | {{this.documentedSymbols}}/{{this.totalSymbols}} | {{#each this.undocumented}}`{{this}}`{{#unless @last}}, {{/unless}}{{else}}—{{/each}} |
{{/each}}

_Generated by aidoc. Deterministic AST analysis — no LLM required._
```

- [ ] **Step 2: Write the failing command test**

Create `tests/unit/cli/score.test.ts`:

```typescript
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

const BIN = path.resolve(__dirname, '../../../dist/cli/index.js');

describe('aidoc score (integration)', () => {
  it('prints a numeric score for the fixtures dir', () => {
    const dir = path.resolve(__dirname, '../../fixtures');
    const out = execFileSync('node', [BIN, 'score', '--dir', dir, '--mock'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(out).toMatch(/\d+\/100/);
  }, 35000);
});
```

Note: this integration test needs a build. Mark it with a longer timeout and ensure Task 12's build step runs it. (If the harness lacks a prebuilt `dist/`, the test is still valid as a TDD target.)

- [ ] **Step 3: Implement the command**

Create `src/cli/commands/score.ts`:

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import Handlebars from 'handlebars';
import * as fs from 'fs';
import { analyzeCodebase } from '../../core/analyzer';
import { scoreModules, BAND_META } from '../../core/score';
import { writeDoc } from '../context';
import { loadConfig } from '../../config/loader';

export const scoreCommand = new Command('score')
  .description('Score documentation health (0-100) from AST coverage')
  .option('--dir <path>', 'Directory to score (default: cwd)')
  .option('-o, --output <path>', 'Write a markdown report to this path')
  .option('--json', 'Emit JSON instead of text (for CI)')
  .option('--min <n>', 'Exit non-zero if score is below this threshold', parseInt)
  .option('--dry-run', 'Preview report without writing')
  .action(async (options) => {
    const spinner = ora('Scoring documentation health...').start();
    try {
      const cwd = options.dir || process.cwd();
      const config = loadConfig();
      const modules = await analyzeCodebase(cwd, config.include, config.exclude);
      const result = scoreModules(modules);
      spinner.succeed(chalk.green('Scored'));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const band = BAND_META[result.band];
        console.log(chalk.bold(`\n${band.emoji} Documentation health: ${result.score}/100 (${band.label})`));
        console.log(chalk.gray(`Symbols documented: ${result.documentedSymbols}/${result.totalSymbols}`));
        if (result.lowQualityCount > 0) {
          console.log(chalk.yellow(`Stub/low-quality docs: ${result.lowQualityCount}`));
        }
        console.log('\nPer-module:');
        for (const m of result.modules) {
          const cov = chalk.cyan(`${m.coverage}%`);
          console.log(`  ${cov}  ${path.basename(m.filePath)}  ${m.undocumented.length ? chalk.gray('(' + m.undocumented.length + ' undocumented)') : chalk.green('✓')}`);
        }
      }

      if (options.output) {
        const band = BAND_META[result.band];
        const tplSrc = fs.readFileSync(path.resolve(__dirname, '../../templates/score.hbs'), 'utf8');
        const report = Handlebars.compile(tplSrc)({ result, bandMeta: band });
        await writeDoc(path.resolve(options.output), report, { dryRun: options.dryRun, label: options.output });
      }

      if (options.min !== undefined && result.score < options.min) {
        console.error(chalk.red(`\nScore ${result.score} is below threshold ${options.min}.`));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red('Failed to score documentation'));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Register the command**

In `src/cli/index.ts`, add the import and registration (after the diagram import block):

```typescript
import { scoreCommand } from './commands/score';
```
and after `program.addCommand(updateCommand);`:
```typescript
program.addCommand(scoreCommand);
```

- [ ] **Step 5: Run unit + build, then the integration test**

Run: `npx tsc --noEmit && npx jest tests/unit/core/score.test.ts`
Expected: PASS.

Then build and run the integration test:
Run: `npx tsc && npx jest tests/unit/cli/score.test.ts`
Expected: PASS (output contains `N/100`).

- [ ] **Step 6: Commit**

```bash
git add src/templates/score.hbs src/cli/commands/score.ts src/cli/index.ts tests/unit/cli/score.test.ts
git commit -m "feat(cli): add aidoc score command with report + CI gate"
```

---

## PHASE 4 — Watch Mode + Streaming

### Task 11: Streaming interface + provider implementations

**Files:**
- Modify: `src/providers/types.ts`, `src/providers/openai.ts`, `src/providers/anthropic.ts`, `src/providers/ollama.ts`
- Test: `tests/unit/providers/streaming.test.ts`

- [ ] **Step 1: Extend the interface**

Modify `src/providers/types.ts` — add an optional streaming method (optional so mock/older providers keep working):

```typescript
export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
}

export interface LLMProvider {
  readonly name: string;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  /** Streams tokens as they arrive. Optional — falls back to generate() if absent. */
  generateStream?(prompt: string, options: GenerateOptions, onToken: (token: string) => void): Promise<string>;
}
```

- [ ] **Step 2: Write the failing test for streaming**

Create `tests/unit/providers/streaming.test.ts`:

```typescript
import { OllamaProvider } from '../../../src/providers/ollama';

describe('OllamaProvider.generateStream', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('accumulates streamed tokens and calls onToken per chunk', async () => {
    const provider = new OllamaProvider('http://localhost:11434', 'llama3');
    // ndjson stream: two chunks then a [done]
    const chunks = [
      { response: 'Hel' },
      { response: 'lo' },
      { response: '', done: true },
    ];
    const body = new ReadableStream({
      start(controller) {
        chunks.forEach(c => controller.enqueue(Buffer.from(JSON.stringify(c) + '\n')));
        controller.close();
      },
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, body } as any);

    const tokens: string[] = [];
    const full = await provider.generateStream!('hi', {}, (t) => tokens.push(t));
    expect(full).toBe('Hello');
    expect(tokens).toEqual(['Hel', 'lo']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/providers/streaming.test.ts`
Expected: FAIL — `generateStream` undefined.

- [ ] **Step 4: Implement streaming in Ollama** (ndjson)

Add to `src/providers/ollama.ts` inside the class (after `generate`):

```typescript
  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void
  ): Promise<string> {
    const fullPrompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
    const run = async (): Promise<string> => {
      const response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model, prompt: fullPrompt, stream: true,
          options: { temperature: options.temperature ?? 0.3, num_predict: options.maxTokens || 4096 },
        }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      let full = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const data = JSON.parse(line);
          if (data.response) { full += data.response; onToken(data.response); }
          if (data.done) return full;
        }
      }
      return full;
    };
    return withRetry(run, { maxRetries: 3 });
  }
```

- [ ] **Step 5: Implement streaming in OpenAI** (SSE)

Add to `src/providers/openai.ts` (uses `stream: true` and iterates chunks):

```typescript
  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void
  ): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const run = async (): Promise<string> => {
      const stream = await this.client.chat.completions.create({
        model: this.model, messages, stream: true,
        max_tokens: options.maxTokens, temperature: options.temperature ?? 0.3,
      });
      let full = '';
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) { full += token; onToken(token); }
      }
      return full;
    };
    return withRetry(run, { maxRetries: 3 });
  }
```

- [ ] **Step 6: Implement streaming in Anthropic**

Add to `src/providers/anthropic.ts`:

```typescript
  async generateStream(
    prompt: string,
    options: GenerateOptions,
    onToken: (token: string) => void
  ): Promise<string> {
    let Anthropic: any;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }
    const client = new Anthropic({ apiKey: this.apiKey });

    const run = async (): Promise<string> => {
      const stream = client.messages.stream({
        model: this.model, max_tokens: options.maxTokens || 4096,
        system: options.systemPrompt, messages: [{ role: 'user', content: prompt }],
      });
      let full = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          full += event.delta.text; onToken(event.delta.text);
        }
      }
      return full;
    };
    return withRetry(run, { maxRetries: 3 });
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest tests/unit/providers/streaming.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/providers/types.ts src/providers/openai.ts src/providers/anthropic.ts src/providers/ollama.ts tests/unit/providers/streaming.test.ts
git commit -m "feat(providers): add generateStream (openai/anthropic/ollama)"
```

---

### Task 12: Generator streaming variants + chokidar dependency

**Files:**
- Modify: `src/core/generator.ts`
- Modify: `package.json` (add chokidar)

- [ ] **Step 1: Add streaming variants to Generator**

Add to `src/core/generator.ts` inside the class (after existing methods, before `renderTemplate`):

```typescript
  /** Streams a readme, calling onToken for each chunk. Falls back if unsupported. */
  async generateReadmeStream(
    context: ReadmeContext,
    onToken: (token: string) => void
  ): Promise<string> {
    const prompt = this.renderTemplate('readme', context);
    if (this.provider.generateStream) {
      return this.provider.generateStream(prompt, {
        systemPrompt: 'You are a professional open-source documentation writer. Output only valid Markdown.',
        temperature: 0.3,
      }, onToken);
    }
    const result = await this.generateReadme(context);
    onToken(result);
    return result;
  }
```

- [ ] **Step 2: Add chokidar**

Run: `npm install chokidar`

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/generator.ts package.json package-lock.json
git commit -m "feat(generator): streaming readme variant; add chokidar dep"
```

---

### Task 13: Watcher orchestration

**Files:**
- Create: `src/core/watcher.ts`
- Test: `tests/unit/core/watcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/watcher.test.ts`:

```typescript
import { debounce, isRelevantChange } from '../../../src/core/watcher';

describe('debounce', () => {
  jest.useFakeTimers();

  it('coalesces rapid calls into one', () => {
    const fn = jest.fn();
    const d = debounce(fn, 300);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isRelevantChange', () => {
  it('includes source files', () => {
    expect(isRelevantChange('src/index.ts')).toBe(true);
    expect(isRelevantChange('src/app.py')).toBe(true);
  });
  it('excludes tests, dist, node_modules', () => {
    expect(isRelevantChange('src/foo.test.ts')).toBe(false);
    expect(isRelevantChange('dist/x.js')).toBe(false);
    expect(isRelevantChange('node_modules/y.js')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/core/watcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the watcher helpers**

Create `src/core/watcher.ts`:

```typescript
/** Debounce: coalesce rapid invocations into one trailing call. */
export function debounce(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

const RELEVANT_EXT = /\.(ts|tsx|js|jsx|py)$/;

/** True for source files we'd want to regenerate docs from. */
export function isRelevantChange(filePath: string): boolean {
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return false;
  if (filePath.includes('node_modules/') || filePath.includes('dist/') || filePath.includes('build/')) return false;
  return RELEVANT_EXT.test(filePath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/core/watcher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/watcher.ts tests/unit/core/watcher.test.ts
git commit -m "feat(watcher): debounce + relevance helpers"
```

---

### Task 14: `aidoc watch` command

**Files:**
- Create: `src/cli/commands/watch.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Implement the command**

Create `src/cli/commands/watch.ts`:

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { loadCommandContext, writeDoc } from '../context';
import { analyzeCodebase } from '../../core/analyzer';
import { debounce, isRelevantChange } from '../../core/watcher';
import { logger } from '../../core/logger';

export const watchCommand = new Command('watch')
  .description('Watch source files and regenerate docs live on save')
  .option('--target <file>', 'Doc file to keep fresh', './README.md')
  .option('--auto', 'Write without prompting (for live demos)')
  .option('--mock', 'Use mock generator (no API key needed)')
  .action(async (options) => {
    const ctx = await loadCommandContext(options);
    const targetPath = path.resolve(ctx.cwd, options.target);
    const globs = ctx.config.include.map(g => path.join(ctx.cwd, g));

    console.log(chalk.cyan(`👁  Watching ${ctx.config.include.join(', ')}…`));
    console.log(chalk.gray(`    Target: ${options.target}   (Ctrl-C to stop)`));
    console.log(chalk.gray(`    ${options.auto ? 'Auto-write ON' : 'Prompt before writing'}`));

    const regenerate = debounce(async () => {
      const start = Date.now();
      try {
        logger.info('Change detected — regenerating…');
        const modules = await analyzeCodebase(ctx.cwd, ctx.config.include, ctx.config.exclude);
        const pkgPath = path.join(ctx.cwd, 'package.json');
        let projectName = path.basename(ctx.cwd);
        let description = '';
        let dependencies: string[] = [];
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          projectName = pkg.name || projectName;
          description = pkg.description || '';
          dependencies = Object.keys(pkg.dependencies || {});
        }
        const readme = await ctx.generator.generateReadme({
          projectName, description, modules, dependencies,
        } as any);
        await writeDoc(targetPath, readme, { auto: options.auto, label: options.target });
        console.log(chalk.green(`✔ Regenerated in ${Date.now() - start}ms`));
      } catch (error: any) {
        logger.error(`Regeneration failed: ${error.message}`);
      }
    }, 300);

    const watcher = chokidar.watch(globs, {
      ignored: ctx.config.exclude,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('all', (_event, changedPath: string) => {
      if (!isRelevantChange(changedPath)) return;
      regenerate();
    });

    // Keep the process alive; clean exit on Ctrl-C.
    await new Promise(() => {});
  });
```

- [ ] **Step 2: Register the command**

In `src/cli/index.ts`, add:
```typescript
import { watchCommand } from './commands/watch';
```
and after `program.addCommand(scoreCommand);`:
```typescript
program.addCommand(watchCommand);
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/watch.ts src/cli/index.ts
git commit -m "feat(cli): add aidoc watch with debounced live regeneration"
```

---

### Task 15: Streaming output in `readme` command

Wire streaming into the live readme command so generation feels instant (not strictly required for watch, but completes the streaming feature).

**Files:**
- Modify: `src/cli/commands/readme.ts`

- [ ] **Step 1: Use the streaming variant when available**

In `src/cli/commands/readme.ts`, after building the context, replace the generation block so it streams to the spinner when a real provider supports it:

```typescript
      const genSpinner = ora('Generating README with AI...').start();
      let readme: string;
      if (ctx.isMock) {
        readme = await ctx.generator.generateReadme({
          projectName, description, modules, dependencies,
        } as any);
      } else {
        const realGen = ctx.generator as any;
        readme = await realGen.generateReadmeStream(
          { projectName, description, modules, dependencies } as any,
          (token: string) => { genSpinner.text = token.slice(-40); } // live tail in spinner
        );
      }
      genSpinner.succeed(chalk.green('README generated!'));
```

(This calls the new streaming path for real providers; mock keeps its path. Falls back to non-streaming inside `generateReadmeStream` if the provider lacks `generateStream`.)

- [ ] **Step 2: Verify build + tests**

Run: `npx tsc --noEmit && npx jest`
Expected: build clean; all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/readme.ts
git commit -m "feat(readme): stream LLM output live during generation"
```

---

## PHASE 5 — Polish

### Task 16: Update README + ROADMAP

**Files:**
- Modify: `README.md`, `ROADMAP.md`

- [ ] **Step 1: Document the two new commands**

In `README.md`, add a new section after the existing commands (e.g. after "Debug Mode"):

```markdown
### Score Documentation Health
```bash
aidoc score                        # 0-100 doc coverage report
aidoc score --json                 # machine-readable (CI)
aidoc score --min 80               # fail CI if below 80
aidoc score -o docs/score.md       # write a report
```

### Watch Mode (live docs)
```bash
aidoc watch                        # regenerate README on save
aidoc watch --auto --target docs/README.md   # no prompts (great for demos)
```
```

Update the Features list bullets to mention "Doc health scoring" and "Live watch mode with streaming".

- [ ] **Step 2: Update ROADMAP**

In `ROADMAP.md`, move the relevant v0.3 items to "done" and add the new capabilities:

```markdown
## v0.2.0 — Multi-Language & Intelligence (updated)
- [x] Retry logic with exponential backoff (now actually wired into providers)
- [x] Documentation health scoring (`aidoc score`)
- [x] Live watch mode with streaming LLM output (`aidoc watch`)
- [x] Pluggable provider registry
```

- [ ] **Step 3: Commit**

```bash
git add README.md ROADMAP.md
git commit -m "docs: document score + watch commands, mark roadmap items done"
```

---

### Task 17: Final verification

- [ ] **Step 1: Full build**

Run: `npx tsc`
Expected: clean build, `dist/` populated.

- [ ] **Step 2: Full test suite with coverage**

Run: `npx jest --coverage`
Expected: all PASS; coverage meets `jest.config.js` thresholds (branches 50, functions 60, lines 60, statements 60).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (fix with `npm run lint:fix` if minor style issues).

- [ ] **Step 4: Smoke test mock mode end-to-end**

Run: `node dist/cli/index.js readme --mock --dry-run && node dist/cli/index.js score --mock`
Expected: both produce output without needing an API key.

- [ ] **Step 5: Commit any leftover fixes**

```bash
git add -A
git commit -m "test: verify full suite + coverage thresholds pass" || echo "nothing to commit"
```

---

## Verification checklist (maps spec → tasks)

| Spec section | Task(s) |
|:--|:--|
| 1.1 Retry wired to providers | Task 1, 2 |
| 1.2 Single ts-morph Project | Task 3 |
| 1.3 Hardened annotate JSON | Task 4 (+ Task 8 step 6) |
| 1.4 validateMarkdown used | Task 7 (in writeDoc) |
| 2 Provider registry | Task 5, 6 |
| 3 Shared command layer | Task 7, 8 |
| 4 Doc-quality scoring | Task 9, 10 |
| 5 Watch + streaming | Task 11, 12, 13, 14, 15 |
| Commit plan (incremental) | each Task ends with a commit |
| AGENTS.md: AST-first, tests | scoring is AST-only (Task 9); every task has tests |
