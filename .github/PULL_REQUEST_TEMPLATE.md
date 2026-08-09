## Problem

<!-- What user, maintainer, or release problem does this PR address? -->

## Change

<!-- Describe the change, organized by component when useful. -->

-

## Verification

<!-- Give reproducible commands and results. -->

- [ ] Added/updated unit tests where behavior changed
- [ ] `npm run verify:release` passes
- [ ] `npm run test:public-beta` passes for beta/onboarding changes

## Known limits

<!-- State remaining constraints, deferred work, or "None known." -->

-

## Type

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 📝 Documentation update
- [ ] ♻️ Refactoring
- [ ] 🧪 Test improvements
- [ ] 🔧 Configuration/CI

## Checklist

- [ ] Code follows existing patterns (AST First, Provider Agnostic, Template Driven)
- [ ] No hardcoded prompts — all LLM prompts use Handlebars templates
- [ ] New parsers/providers have unit tests
- [ ] LLM features use the `LLMProvider` interface rather than provider-specific core logic
- [ ] Documentation updated if needed (README, CONTRIBUTING)
- [ ] No API keys, personal contact data, raw provider context, or private paths are included
