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
- GitHub username: `mr-min-max`, profile must be public before submission
- GitHub repository URL: `https://github.com/mr-min-max/aidoc`, repository is
  currently private and must be public before submission
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
- Unreleased release candidate: v0.1.1
- CI status: TODO, public GitHub Actions URL
- Maintainer permissions proof: public GitHub ownership or write access

## Field: Why This Repository Qualifies

Use this after replacing TODO metrics.

```text
aidoc is an MIT TypeScript CLI/MCP tool that helps OSS maintainers work on README, API, changelog, and architecture docs. It uses AST-first analysis, supports OpenAI/Anthropic/Ollama, and includes a GitHub Action and automated tests. The canonical repository is https://github.com/mr-min-max/aidoc and must be made public before this application is submitted. TODO: add stars/downloads/recent activity before submitting.
```

## Field: How API Credits Will Be Used

```text
We will use API credits for Codex-powered maintainer workflows: PR documentation review, stale-doc detection, release note generation, issue triage, parser/provider test generation, and security-oriented review of changes that affect LLM providers, prompt templates, MCP tools, and CI automation.
```

## Field: Anything Else

```text
aidoc is built for the same maintainer burden this program targets: reviewing code changes, maintaining docs, and reducing OSS maintenance toil. The project is provider-agnostic, offers Ollama as a local-provider option, and includes an MCP server so maintainers can use it inside compatible AI coding tools.
```

## Pre-Submit Repository Work

- Make the GitHub repository public.
- Make the maintainer GitHub profile public.
- Publish or verify the npm package page for `aidoc-gen`.
- Add current stars/downloads/activity numbers to this file.
- Add a short demo GIF or video to the README.
- Add 3-5 starter issues labeled `good first issue`.
- Confirm the OpenAI organization ID belongs to the account that will receive credits.
