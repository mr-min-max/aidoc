# Codex Maintainer Workflows

This project is a good fit for OpenAI Codex for OSS because it directly targets
maintainer work: reviewing documentation impact, generating release notes,
triaging documentation gaps, and keeping public APIs understandable as code
changes.

## Planned Use Of API Credits

API credits will be used only for OSS maintainer workflows around this public
repository:

1. PR documentation review
   - Analyze changed exported symbols with AST parsing.
   - Ask Codex to identify documentation sections that need updates.
   - Produce a review comment or patch proposal for stale README/API docs.

2. Release workflows
   - Summarize commits into changelog entries.
   - Cross-check release notes against public API changes.
   - Draft migration notes when CLI flags, providers, or parser behavior change.

3. Issue triage
   - Classify bug reports by area: parser, provider, CLI, templates, MCP, CI.
   - Draft reproduction steps and test plans for maintainers.
   - Suggest labels and identify likely duplicate reports.

4. Test generation for maintainer review
   - Generate focused unit test drafts for new parsers and providers.
   - Keep tests aligned with the project's AST-first, provider-agnostic rules.
   - Never merge generated tests without human review.

5. Security and reliability review
   - Review changes in provider calls, prompt templates, env handling, and CI.
   - Use Codex Security if granted for deeper scanning of authorized repo code.
   - Track findings as public issues when disclosure is safe.

## Guardrails

- Maintainers review every generated patch before merge.
- Secrets and API keys are not committed or stored in templates.
- The project remains provider-agnostic; OpenAI support must go through
  `LLMProvider`.
- Prompt text remains template-driven in `src/templates/`.
- Code structure extraction remains AST-first; regex parsing is not accepted for
  new language parsers.

## Success Metrics

During the first six months of Codex-supported maintenance, track:

- Time from PR opened to first maintainer review.
- Number of PRs receiving documentation impact review.
- Number of release notes generated or improved with Codex.
- Documentation health score before and after each release.
- Number of test cases added for parser/provider changes.
- Number of valid security/reliability issues found and fixed.

