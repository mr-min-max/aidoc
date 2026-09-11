# Limitations

## What StaleDocs does not check

StaleDocs maps changed public symbols to documentation sections. It does not prove that prose is correct, complete, or appropriate for readers.

## Public boundary

A public symbol is one that a consumer can import from the package entry. StaleDocs discovers entries from `package.json` (`exports`, then `types`, `module`, `main`; build paths such as `dist/index.js` are mapped to `src/index.ts` when that file exists) for the root package and one level of workspace packages, then follows static `export ... from` statements with relative specifiers. `export * as ns from` is followed one level. Bare specifiers, `require()`, dynamic `import()`, `tsconfig` path aliases, and CommonJS are not followed. Set `entry` in the configuration to override discovery. When no entry can be resolved, every export in a changed file is treated as public and the report says so.

## Languages and syntax not enumerated

TypeScript and JavaScript analysis follows static relative re-exports but does not enumerate CommonJS exports. Python analysis does not enumerate module constants or dynamic exports. Generated exports and runtime registration are outside the AST snapshot.

## Documentation discovery

The planner recognizes root `README.md` and `CHANGELOG.md` names without case sensitivity. It recursively scans files with a case-insensitive `.md` extension under `docs` and under a configured output directory. Planning exclusion globs are applied while selecting candidates. After discovery, `.staledocsignore` removes documentation through case-sensitive path patterns whose literal suffix is `.md`, such as `docs/legacy/*.md`.

## Git requirements

Base discovery checks the configured reference, the remote default branch, `origin/main`, `main`, `origin/master`, `master`, and then `HEAD~1`. A shallow clone may not contain the base commit; use `fetch-depth: 0` for pull request reviews.

## Python interpreter requirement

Python analysis invokes the local `python3` interpreter. Its version must understand the syntax used by the project. Set `STALEDOCS_PYTHON` to an approved executable when `python3` is not the right interpreter.

## Trust Gate scope

The Trust Gate inspects prepared input and validated output for secret-like values. It does not replace prompt-injection defenses, a model sandbox, host permissions, or repository access controls.

## MCP scope

The MCP server is pinned to the Git worktree where it starts. It reads only repository-contained paths and does not write during prepare or validate. The host remains responsible for model choice, permissions, and applying approved Markdown.

## Action fork limitations

Review mode can read fork pull requests but may not receive permission to post comments or labels. The Action reports the result in the job summary when the token is read-only.
