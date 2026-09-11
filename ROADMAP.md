# Roadmap

## Done

`0.3.0-beta.1` (2026-09-10): deterministic PR review Action with sticky comments and labels, before/after signatures, plan-aware `check`, `.staledocsignore`, MCP fix path, first external evaluation. Details in [CHANGELOG.md](./CHANGELOG.md).

## Now: 0.4.0-beta.1

- Public API means reachable from the package entry (`package.json` `exports`/`main`, Python `__init__.py` and `__all__`). Internal exports no longer count.
- Symbols that become public or stop being public through a re-export are reported.
- Quieter comments: one row per real change, no false "not mentioned", CHANGELOG history is never stale, files the parser cannot read are listed as not analyzed.
- Documentation is discovered in package READMEs, `doc/`, and `documentation/`.
- Before/after evaluation on external pull requests selected by a rule recorded before the run.

## Next

- Model-drafted fix text in the review comment (API key provided by the repository owner; nothing is written to the repository).
- Instance-style mentions such as `client.get(url)` mapped to `Client.get` when the class is named in the same document.
- reStructuredText documentation for Python projects.

## Not planned

- New languages until users ask.
- VS Code extension.
- Website.
- Image generation.
- README beautification.
