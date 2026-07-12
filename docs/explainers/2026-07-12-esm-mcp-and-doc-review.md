# Explainer: ESM migration, an official MCP server, and PR documentation review

> This document explains a three-part change to `aidoc`. It is written to be
> readable start to finish, but each section stands on its own. If you already
> know how Node resolves modules, skim the Background and jump to Code.

## Background

### For newcomers: how Node decides what `import` means

When you write `import { x } from "y"`, Node has to answer two questions: _what
file does `"y"` point to_, and _is that file CommonJS or ES modules_. These are
two different worlds:

- **CommonJS (CJS)** is the original Node module system: `require()` returns
  `module.exports`. It is synchronous, and inside every file you get free
  variables like `__dirname` and `require`.
- **ES modules (ESM)** is the standardized system: `import`/`export`, resolved
  asynchronously. There is no `__dirname`; instead you get `import.meta.url`.

A package declares its world with the `"type"` field in `package.json`
(`"module"` = ESM, absent or `"commonjs"` = CJS) and, increasingly, with an
`"exports"` map that lists exactly which files consumers may import and which
build (CJS or ESM) to hand them.

> [!IMPORTANT]
> Modern packages ship an `"exports"` map and **no legacy `"main"`**. TypeScript
> only reads `"exports"` when `moduleResolution` is `node16`/`nodenext`. Under
> the older `"node"` resolution, those subpath imports simply cannot be found.

### The narrow background: where `aidoc` was

`aidoc` was authored in TypeScript, compiled to **CommonJS**, and resolved
modules with the legacy algorithm. That worked until two things collided:

1. Two runtime dependencies — `commander@15` and `chokidar@5` — became
   **ESM-only** (`"type": "module"`, no `require` build). Requiring them from
   CommonJS throws `ERR_REQUIRE_ESM` on Node 18, which `package.json` lists as a
   supported engine. The CLI happened to run on Node 22 (which can `require()`
   ESM) so the breakage was latent.
2. The advertised, flagship **MCP server** was hand-rolled. It framed responses
   with LSP-style `Content-Length` headers. But the Model Context Protocol's
   stdio transport is **newline-delimited JSON-RPC** — no headers. Real clients
   (Claude Desktop, Cursor, ChatGPT) therefore never parsed a single response.

To use the official `@modelcontextprotocol/sdk` (which is `"exports"`-only), we
needed `nodenext` resolution — which in turn surfaces the ESM-only dependency
problem. The clean fix for both is the same: **make the project ESM.**

## Intuition

Think of the module system as the language everyone at a table speaks. `aidoc`
was speaking CommonJS while more and more of its guests (commander, chokidar,
the MCP SDK) only spoke ESM. You can keep hiring interpreters (dynamic
`import()`, shims), or everyone can just speak ESM. We chose the latter.

Concretely, three mechanical things change when a file becomes ESM:

| CommonJS | ESM |
|:--|:--|
| `import { x } from "./util"` | `import { x } from "./util.js"` (explicit extension) |
| `__dirname` | `path.dirname(fileURLToPath(import.meta.url))` |
| `const fs = require("fs")` | `import * as fs from "fs"` |

The MCP change is smaller than it looks: the _business logic_ of each tool is
unchanged. We only swap the transport. Before, a response went out as:

```
Content-Length: 57\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{ ... }}
```

After, the SDK writes exactly what the protocol wants:

```
{"jsonrpc":"2.0","id":1,"result":{ ... }}\n
```

The third change, `aidoc review`, follows the same philosophy as the existing
`aidoc score`: **derive an answer from the AST, deterministically, with no LLM.**
Given a diff, list the exported symbols that changed and ask two boring
questions of each: _is it mentioned in the docs?_ and _does it have a doc
comment?_ Toy example — a PR adds:

```ts
export function createWidget() {} // no doc comment
```

If `README.md` never says `createWidget`, review reports:

> **createWidget** (function) — not referenced in README.md; missing inline doc comment

## Code

### 1. Fix `npm ci`

The committed `package-lock.json` had drifted from `package.json` (npm's
resolver expected optional `@emnapi/*` entries that weren't in the lock), so
`npm ci` — used by CI and every fresh clone — aborted with `EUSAGE`.
Regenerating the lockfile resynced them.

### 2. The ESM migration

`package.json` gains a single decisive line, plus the SDK:

```jsonc
{
  "type": "module",
  "dependencies": { "@modelcontextprotocol/sdk": "^1.29.0", /* ... */ }
}
```

`tsconfig.json` switches resolution and turns on `isolatedModules` (required for
NodeNext + ts-jest, and a good discipline anyway):

```jsonc
{
  "module": "nodenext",
  "moduleResolution": "nodenext",
  "isolatedModules": true
}
```

Every relative import gains a `.js` extension, and the two CJS-only idioms are
replaced. For example, in `src/cli/context.ts`:

```ts
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

One interop wrinkle: `simple-git` under NodeNext must be imported by name.

```ts
import { simpleGit } from "simple-git"; // was: import simpleGit from "simple-git"
```

Finally, a small but important correctness fix — dotenv v17 prints a banner to
stdout, which is noise for the CLI and **fatal** for the MCP stdio channel:

```ts
dotenv.config({ quiet: true });
```

### 3. The MCP server on the official SDK

`src/mcp/server.ts` keeps `handleToolCall` (the logic) and swaps everything
around it for the reference implementation. Tools are declared with Zod, which
the SDK turns into the advertised JSON Schema _and_ uses to validate inputs:

```ts
const server = new McpServer({ name: "aidoc", version: "0.1.0" });
for (const def of TOOL_DEFINITIONS) {
  server.registerTool(
    def.name,
    { description: def.description, inputSchema: def.inputSchema }, // Zod shape
    async (args) => toTextResult(await handleToolCall(def.name, args)),
  );
}
await server.connect(new StdioServerTransport());
```

### 4. `aidoc review`

The engine (`src/core/review.ts`) is pure and deterministic:

```ts
export function reviewDocImpact(changedModules, { docText, docLabel }) {
  // for each exported function/class/type:
  //   - reasons += "not referenced in <doc>"  if the name is absent from docText
  //   - reasons += "missing inline doc comment" if existingDoc is empty
  // issue recorded when reasons.length > 0
}
```

The command (`src/cli/commands/review.ts`) parses **only the changed files**
(via `getChangedFiles` + the parser registry), relativizes their paths so the
report is portable, and gates CI with `--fail-on-issues`. The GitHub Action
gains a `mode: review` that diffs against the PR merge base and posts a single,
self-updating PR comment — and `.github/workflows/docs-review.yml` dogfoods it
on this very repository.

## Verification

Automated (all green):

- `npm ci` on a clean checkout — succeeds (was failing).
- `npm run build` — clean under NodeNext.
- `npm run lint` and `prettier --check` — clean.
- `node dist/cli/index.js score --min 80` — 100/100.
- `npm test` — **96 tests**, including a new MCP integration test that drives
  the server through a real `Client` over `InMemoryTransport`, and 8 tests for
  the review engine.

Manual QA you can reproduce:

1. **MCP handshake.** Pipe newline-delimited JSON-RPC into the server and watch
   the responses:
   ```bash
   npm run build
   printf '%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
   | node dist/cli/index.js --mcp
   ```
   Each line of output is a standalone JSON object (no `Content-Length`).
2. **Review.** Make a change that adds an exported function without documenting
   it, then run `node dist/cli/index.js review --since HEAD~1`.

## Alternatives

**A. For the module problem: keep CommonJS, dynamic-`import()` the ESM deps.**

| Pros | Cons |
|:--|:--|
| Smallest diff | Interpreters everywhere: every ESM dep becomes `await import()` |
| No `.js` extensions | Doesn't fix the Node 18 `require(ESM)` breakage for commander/chokidar |
| | Fights the tooling instead of aligning with it; spreads async into sync code paths |

**B. For MCP: keep the hand-rolled server, just fix the framing.**

| Pros | Cons |
|:--|:--|
| Tiny change (newline instead of `Content-Length`) | Reimplements a spec we don't own; future MCP features (resources, prompts, capabilities negotiation) are ours to maintain |
| No new dependency | Less credible for a project that advertises MCP as a headline feature |

We took the SDK route because the grant-relevant signal is _correctness and
ecosystem alignment_, not minimal diff.

## Suggested people to talk to

- **Jewi (`panjewi@icloud.com`)** — the author of essentially all of `aidoc`,
  including the original MCP server, the provider layer, and the CLI command
  structure. They are the right person to sanity-check the ESM cutover
  (especially the Python-parser subprocess and the watch command, which use the
  filesystem and `chokidar`) and to confirm the tool catalog we expose over MCP
  still matches the product intent. Because most of this PR was AI-authored,
  a human pass from the project's primary maintainer is the highest-value
  review here.

## Quiz

<details>
<summary>1. Why did adopting <code>@modelcontextprotocol/sdk</code> force a module-resolution change?</summary>

**Answer: The SDK publishes only an `"exports"` map (no legacy `"main"`), and TypeScript only honors `"exports"` under `node16`/`nodenext` resolution.**
Under the old `"node"` resolution, `@modelcontextprotocol/sdk/server/mcp.js`
cannot be resolved at type-check time. Switching to `nodenext` fixes that — but
`nodenext` also enforces ESM semantics, which is why the rest of the migration
followed.
</details>

<details>
<summary>2. The CLI ran fine on the developer's machine. Why was it still broken?</summary>

**Answer: It was tested on Node 22, which can `require()` ESM; Node 18 cannot.**
`commander@15` and `chokidar@5` are ESM-only. Requiring them from CommonJS
throws `ERR_REQUIRE_ESM` on Node 18 (a supported engine). The bug was latent,
not absent.
</details>

<details>
<summary>3. What was actually wrong with the old MCP server's output?</summary>

**Answer: It used LSP-style `Content-Length` framing instead of newline-delimited JSON-RPC.**
The MCP stdio transport expects one JSON object per line. Clients reading
newline-delimited input would never parse a response prefixed with
`Content-Length: N\r\n\r\n`.
</details>

<details>
<summary>4. Why does <code>aidoc review</code> deliberately avoid calling an LLM?</summary>

**Answer: Determinism and zero-cost CI.**
Like `aidoc score`, review derives its answer from the AST, so it is instant,
reproducible, needs no API key, and is safe to gate merges on. (An LLM could
add prose, but the core signal — "is this changed export documented?" — does
not need one.)
</details>

<details>
<summary>5. Why <code>dotenv.config({ quiet: true })</code>, and why does it matter for MCP specifically?</summary>

**Answer: dotenv v17 prints a banner to stdout; MCP's stdout is the JSON-RPC channel.**
Any non-protocol byte on stdout corrupts the stream, so the first client message
failed to parse. `quiet: true` also de-noises normal CLI output. (Warnings and
logs already go to stderr, which is safe.)
</details>
