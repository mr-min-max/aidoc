# OpenAI Codex for OSS Application Notes

This document keeps the OpenAI Codex for Open Source application ready to submit.
It is intentionally factual and avoids unverified adoption claims.

## Official Fit

OpenAI's Codex for OSS program is for maintainers of active public open-source
projects. The program considers repository usage, ecosystem importance, active
maintenance, and maintainer role. Benefits can include six months of ChatGPT Pro
with Codex, API credits for eligible OSS maintainer workflows, and conditional
Codex Security access.

Program page: https://openai.com/ru-RU/form/codex-for-oss/
Developer page: https://developers.openai.com/community/codex-for-oss
Terms: https://developers.openai.com/codex/codex-for-oss-terms

## Form Fields To Fill

- First name: TODO
- Last name: TODO
- Email: TODO, must match the ChatGPT account email
- GitHub username: TODO, profile must be public
- GitHub repository URL: TODO, repository must be public
- Role: Primary maintainer
- Interested in:
  - Codex Security
  - API credits for my project
- OpenAI organization ID: TODO, from https://platform.openai.com/settings/organization/general

## Repository Evidence Checklist

Fill these before submitting:

- GitHub stars: TODO
- Forks: TODO
- Open issues / PRs: TODO
- Recent commit activity: TODO
- npm package URL: TODO
- Monthly npm downloads: TODO
- Current release tag: v0.1.0
- CI status: TODO, public GitHub Actions URL
- Maintainer permissions proof: public GitHub ownership or write access

## Field: Why This Repository Qualifies

Use this after replacing TODO metrics.

```text
aidoc is a public MIT TypeScript CLI/MCP tool that helps OSS maintainers keep README, API, changelog, and architecture docs current. It uses AST-first analysis, supports OpenAI/Anthropic/Ollama, includes a GitHub Action, and has active tests/CI. TODO: add stars/downloads/recent activity before submitting.
```

## Field: How API Credits Will Be Used

```text
We will use API credits for Codex-powered maintainer workflows: PR documentation review, stale-doc detection, release note generation, issue triage, parser/provider test generation, and security-oriented review of changes that affect LLM providers, prompt templates, MCP tools, and CI automation.
```

## Field: Anything Else

```text
aidoc is built for the same maintainer burden this program targets: reviewing code changes, keeping docs fresh, and reducing OSS maintenance toil. The project is privacy-first and provider-agnostic, with local Ollama support and an MCP server so maintainers can use it inside their existing AI coding tools.
```

## Pre-Submit Repository Work

- Make the GitHub repository public.
- Make the maintainer GitHub profile public.
- Publish or verify the npm package page for `aidoc-gen`.
- Add current stars/downloads/activity numbers to this file.
- Add a short demo GIF or video to the README.
- Add 3-5 starter issues labeled `good first issue`.
- Confirm the OpenAI organization ID belongs to the account that will receive credits.

