# AiDoc with Claude Desktop or Claude Code

This guide covers local MCP hosting for the published beta.5 CLI. It does not
provide Claude.ai OAuth access to AiDoc and does not turn a consumer
subscription into an AiDoc provider credential.

For the complete command catalogue and beta boundaries, see [CLI.md](../CLI.md)
and [Public Beta](../PUBLIC_BETA.md). The [GitHub Action reference](../GITHUB_ACTION.md)
covers the separate CI generate and check path.

## Subscription boundary

Claude Desktop and Claude Code authenticate their own host session. Claude Pro
or Max is a consumer/host subscription; Anthropic API billing is separate.
AiDoc receives no Claude subscription token and no Claude OAuth credential.
For direct AiDoc Anthropic generation, use the separate `anthropic` profile and
`ANTHROPIC_API_KEY`.

Official references: [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp),
[Claude Code Pro/Max](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan),
and [consumer/API billing separation](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console).

## Setup

Install the published prerelease:

```bash
npm install -g @mr-min-max/aidoc-gen@beta
aidoc --version
```

For development, build and link the local CLI from a checkout:

```bash
npm install
npm run build
npm link
aidoc --version
```

Configure the Claude Desktop or Claude Code local MCP entry using the linked
command:

```json
{
  "mcpServers": {
    "aidoc": {
      "command": "aidoc",
      "args": ["--mcp"]
    }
  }
}
```

This local MCP integration is not a marketplace installation or a ChatGPT web
local-STDIO path. The beta.5 npm package and GitHub prerelease are public.

Reverse the global development link with:

```bash
npm unlink -g @mr-min-max/aidoc-gen
```

## Pinned MCP repository scope

Each `aidoc --mcp` server is pinned to the canonical Git worktree containing
its startup cwd. One server serves one repository; start another server from
another repository when you change repositories. The root and real
subdirectories are allowed, and both absolute in-worktree paths and
repository-relative directory paths work.

External paths, parent traversal, `.git` or other Git metadata, missing or
non-directory paths, and every symlink or junction fail closed before project
reads. Successful MCP paths are repository-relative POSIX paths.

MCP reads only bounded declarative JSON/YAML/no-extension configuration,
`package.json#aidoc`, and the pinned-root `.env` allowlist. It rejects
malformed or symlinked selected configuration, executable JavaScript,
TypeScript, CJS, or MJS configuration, and the legacy `apiKey` project field.
Direct CLI cosmiconfig and dotenv behavior is unchanged. This is a repository
path/read boundary, not an operating-system sandbox: privileged same-host
races and hard-link identity are outside this API-level guarantee, and network
access remains controlled by the provider transport and Trust Gate.

## Safe update sequence

Use the provider-free MCP boundary in this order:

1. Call `prepare_documentation_update`.
2. Ask the user to choose a target if preparation reports multiple targets;
   never guess.
3. Generate one Markdown candidate from only the returned
   `generation.system_prompt` and `generation.prompt`.
4. Validate it with `validate_documentation_draft`, preserving the preparation
   digest and selected relative target unchanged.
5. Stop or reprepare on invalid, stale, blocked, or reprepare-required output.
6. Show the approved diff metadata, request Claude's normal permission, apply
   only `approved_markdown` to the exact target, and call
   `check_docs_freshness`.

AiDoc Trust Gate inspects AiDoc input/output for secret findings. Configured
`strict` blocks findings; configured `warn` or `redact` redacts detected
sensitive values before host generation or return. An `allowed` result means
no findings were detected. Trust Gate does not control Claude's context
window, model, sandbox, isolation, or permission system. AiDoc does not read
Claude authentication files or receive a Claude subscription token.

Direct provider mode supports `openai`, `anthropic`, `deepseek`, `qwen`,
`openai-compatible`, and `ollama` separately; it never silently falls back.
See [Public Beta](../PUBLIC_BETA.md) for exact API credential variables,
including `ANTHROPIC_API_KEY`.
