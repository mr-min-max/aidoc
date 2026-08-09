# Semantic Documentation Impact Design

**Status:** Approved product design

**Date:** 2026-08-01

**Target:** `v0.2.0-beta.2`

## 1. Goal

Make documentation-impact analysis useful without configuration or LLM access.
Running `aidoc plan` in a Git repository must deterministically compare the
current work with the repository's base branch, identify changed public code
symbols through language ASTs, map those changes to documentation that needs
review, and produce a bounded context that agents can consume without receiving
raw source or a raw Git diff.

The same planning core must serve three interfaces:

- a concise human CLI;
- a stable JSON contract for CI and coding agents;
- an MCP tool scoped to the server's current repository.

`aidoc update` must consume that plan instead of its current raw-diff context.

## 2. Product Principles

1. **Zero configuration first.** `aidoc plan` is the primary command. Base-ref
   discovery, supported-language filtering, documentation discovery, and a safe
   context budget have useful defaults.
2. **AST first, LLM optional.** Planning never calls an LLM. Updating calls the
   configured provider only after a deterministic plan exists.
3. **One core, three interfaces.** Human output, JSON, and MCP are projections of
   the same `ImpactPlan`; they must not implement separate comparison logic.
4. **No source-shaped provider context.** Plans contain symbol identities,
   change categories, counts, documentation references, and hashes. They never
   contain raw diffs, bodies, literals, docstrings, or complete signatures.
5. **Fail closed for supported source.** A changed TS, JS, or Python file that
   cannot be parsed prevents both a successful plan and a provider call.
6. **Honest attribution.** Direct documentation matches and rule-based
   recommendations are labeled separately. Unknown mappings remain `unmapped`.
7. **Stable automation contract.** JSON is versioned, deterministic, free of
   ANSI/spinner output, and byte-for-byte stable for equivalent snapshots.

## 3. Primary User Experience

### 3.1 Human CLI

The default command requires no flags:

```bash
aidoc plan
```

Representative output:

```text
Documentation impact: 3 public API changes
! 1 potentially breaking change

Docs to review:
  README.md -> Pluggable Providers
  docs/API.md -> LLMProvider

1 changed symbol is not mapped to documentation.
Context: 812 / 12000 bytes

Next: aidoc update
```

The output must show the resolved base and head when verbose mode is enabled.
Ordinary output favors the conclusion and next action over implementation
details. No API key or provider configuration is required.

The command uses a planning-only configuration loader for `include`, `exclude`,
the documentation/output paths, and the context budget. It must not call
`loadCommandContext`, resolve a template directory, validate provider settings,
resolve provider credentials, or construct `LLMProvider`. CLI bootstrap no longer
loads `.env` globally; provider-backed context loads it only when required.
Planning may select safe fields from an Aidoc config file, but it ignores
`provider`, `model`, and `apiKey` and never inspects provider-specific environment
variables.

Advanced options:

```text
--base <ref>                 Explicit comparison base
--head <ref>                 Compare two committed refs instead of the worktree
--json                       Emit only the versioned JSON result
--max-context-bytes <count>  Override the provider-context byte ceiling
```

`--max-context-bytes` accepts integers from 1024 through 1048576. Its default is
12000 bytes. This is deliberately described as a byte budget, not a token count.

### 3.2 Automatic snapshot selection

When `--base` is absent, base discovery uses the first valid candidate:

1. `AIDOC_BASE_REF`;
2. the symbolic target of `refs/remotes/origin/HEAD`;
3. `origin/main`;
4. local `main`;
5. `origin/master`;
6. local `master`;
7. `HEAD~1`;
8. Git's empty-tree object for a repository without a parent commit.

When `--head` is absent, the head snapshot is the current working tree. It
includes committed branch changes, staged changes, unstaged changes, deletions,
renames reported by Git, and untracked supported source files not excluded by
configuration. The result labels this snapshot `working-tree`.

When `--head` is present, both snapshots are immutable Git trees. This is the
recommended CI mode and the result records both resolved commit IDs.

Refs beginning with `-`, containing control characters, or failing commit
resolution are rejected before any Git content command runs. Git commands use
argument arrays, never shell interpolation.

### 3.3 Update flow

`aidoc update` runs the same planner automatically:

1. resolve the base and current worktree;
2. build and display the concise impact summary;
3. stop without a provider call when there is no documentation impact;
4. render a bounded provider context from the plan;
5. pass the existing document and bounded plan through the Trust Gate;
6. request an update and preserve the existing preview/confirmation flow.

`aidoc update --base <ref>` is the documented spelling. Existing
`aidoc update --since <ref>` remains a compatibility alias for one beta cycle.
Supplying conflicting `--base` and `--since` values is an input error.

## 4. Architecture

### 4.1 Git snapshot reader

`GitSnapshotReader` owns repository and ref operations. It returns normalized,
repository-relative POSIX paths and status records for added, modified, deleted,
and renamed files. It reads base/head blobs directly from Git and reads the
working-tree snapshot from disk without changing checkout state.

For working-tree files, the reader rejects symbolic links and verifies that the
resolved regular file remains inside the repository root before reading it.
Unsupported and excluded files may be counted but are never parsed as code.

No network fetch is automatic. If a shallow clone lacks the selected base, the
command returns an actionable fixed diagnostic rather than silently choosing a
different comparison.

### 4.2 Parser-owned symbol snapshots

The parser boundary gains a snapshot operation in addition to its existing
full-module analysis. TypeScript/JavaScript continue to use `ts-morph`; Python
continues to use the standard-library `ast` module.

Each parser consumes a repository-relative path and source content, then emits
only a value-free module snapshot:

```ts
interface ParserModuleSnapshot {
  language: "typescript" | "python";
  dependencyFingerprint: string;
  symbols: ParserSymbolSnapshot[];
}

interface ParserSymbolSnapshot {
  language: "typescript" | "python";
  kind: "function" | "class" | "method" | "interface" | "type" | "enum";
  qualifiedName: string;
  contractFacets: Partial<
    Record<
      "parameters" | "return" | "inheritance" | "members" | "modifiers",
      string
    >
  >;
  contractFingerprint: string;
  implementationFingerprint: string;
  documentationFingerprint: string | null;
}
```

Fingerprints are lowercase SHA-256 hex digests. Parsers calculate them before
returning so raw bodies, default literals, comments, and docstrings never enter
the impact model.

The contract facets are SHA-256 hashes for independently comparable categories;
they let the impact engine report safe labels such as `parameters` or `members`
without returning their values. The combined contract fingerprint covers the
normalized syntactically declared public shape: parameters, types, optionality,
default-expression ASTs, return annotations, inheritance, public properties,
enum members, modifiers, and grouped overloads. A change to an inferred but
undeclared TypeScript type is classified as an implementation change rather than
an asserted contract change. The implementation fingerprint covers a
location-free normalized AST subtree. The documentation fingerprint covers the
symbol's source documentation without returning that text. The module dependency
fingerprint covers normalized import module specifiers without returning them.

Private/protected class members and underscore-prefixed Python members are not
public symbols. Line numbers, formatting, comments, and absolute paths never
participate in identity or contract fingerprints. TypeScript overloads are
grouped and sorted under one qualified name.

### 4.3 Stable symbol identity

The impact layer constructs readable IDs:

```text
typescript:src/providers/types.ts#interface:LLMProvider
typescript:src/providers/types.ts#method:LLMProvider.generate
python:src/client.py#function:request
```

IDs use normalized repository paths, language, kind, and qualified name. A Git
file rename with an otherwise identical symbol is reported as `moved` with
`beforeId` and `afterId`. Other apparent renames are represented honestly as one
removal and one addition; the planner does not guess based on name similarity.

### 4.4 Impact comparison

The comparison engine emits these public change categories:

- `added`;
- `removed`;
- `moved`;
- `contract-changed`;
- `implementation-changed`;
- `documentation-changed`.

Contract changes suppress a redundant implementation-change record for the same
symbol. Documentation-only changes remain visible but have the lowest context
priority. Removed symbols are `potentially-breaking`; contract changes are
`review-required` because the MVP does not claim language-level compatibility
analysis. Other changes are `informational`.

Module import changes that cannot be attributed to one public symbol are emitted
as bounded module-level `dependency-changed` records. Changes to unsupported
files appear only in aggregate metadata.

### 4.5 Documentation mapping

The mapper indexes Markdown files selected from `README.md`, `docs/**/*.md`, and
the configured output directory, respecting existing exclusions. It parses
ATX/Setext headings and records stable `file#slug` sections.

A direct mapping requires one of:

- the exact qualified symbol name inside an inline/fenced code span;
- a Markdown link whose repository-relative target is the changed source path;
- a heading containing a non-generic exact symbol name.

Names shorter than four characters and a fixed generic-name set such as
`get`, `set`, `run`, `main`, and `open` cannot create heading-only matches.

Rule-based recommendations are separate from direct evidence:

- public additions/removals and contract changes recommend API documentation;
- potentially breaking changes recommend `CHANGELOG.md`;
- exported entry-point and module dependency changes recommend README or
  architecture documentation review.

The mapper never claims that a rule-based recommendation is a direct reference.
Symbols with neither type remain `unmapped` and are counted prominently.

### 4.6 Deterministic context budget

`ImpactContextBuilder` projects the complete plan into the smaller structure sent
to a provider. It uses `Buffer.byteLength(serialized, "utf8")` and adds complete
JSON records one at a time; it never truncates a JSON string or field.

Priority order is stable:

1. removals;
2. contract changes;
3. moves;
4. additions;
5. dependency changes;
6. implementation changes;
7. documentation-only changes.

Ties sort by repository path, kind, and qualified name. If the next record does
not fit, the context retains total counts, included counts, omitted counts, and
the semantic impact digest. A pathological oversized identifier is represented
by its digest and category rather than partially truncated text.

The provider projection includes no absolute path, source text, raw diff,
literal, signature, documentation text, or Git error output.

## 5. Data Contracts

The public JSON envelope uses `schemaVersion: "aidoc.impact-plan.v1"` and a
discriminated result:

```ts
type PlanCommandResult =
  | { ok: true; plan: ImpactPlan }
  | { ok: false; error: PlanError };

interface ImpactPlan {
  schemaVersion: "aidoc.impact-plan.v1";
  base: SnapshotDescriptor;
  head: SnapshotDescriptor;
  summary: ImpactSummary;
  changes: SymbolChange[];
  documentation: DocumentationImpact[];
  context: ContextBudgetReport;
  ignored: IgnoredChangeSummary;
  digest: string;
}
```

Arrays are deterministically sorted. Object fields with no value are omitted,
not serialized as environment-dependent `undefined`. The plan digest is SHA-256
over the canonical base/head, summary, changes, documentation, and ignored
payload. The context report may reference that digest, but neither the context
report nor the digest field participates in digest calculation; this avoids a
circular contract.

`--json` writes exactly one JSON object to stdout on success or failure. Progress
and diagnostics do not share stdout. Human mode writes errors to stderr and uses
the same stable error codes.

## 6. Agent Interfaces

### 6.1 CLI/CI

Agents may call:

```bash
aidoc plan --json
aidoc plan --base origin/main --head HEAD --json
```

No provider configuration or credentials are read for planning. Exit `0` means a
complete valid plan, including a valid plan with zero impact. Operational,
validation, and parse failures exit `1`. Exit `2` remains reserved for Trust Gate
policy rejection in provider-backed commands.

### 6.2 MCP

The MCP server adds `plan_documentation_impact`. It accepts optional `base`,
`head`, and `max_context_bytes` inputs and returns the same `ImpactPlan` object.
It does not accept a directory argument: it operates only on the repository in
which the MCP server started, so the new tool does not expand the existing MCP
filesystem boundary.

MCP errors use allowlisted plan codes and value-free messages through the
existing diagnostic sanitizer. The tool never constructs an LLM provider.

## 7. Error Handling

Stable plan error codes are:

- `PLAN_NOT_GIT_REPOSITORY`;
- `PLAN_BASE_NOT_FOUND`;
- `PLAN_HEAD_NOT_FOUND`;
- `PLAN_INVALID_REF`;
- `PLAN_SHALLOW_HISTORY`;
- `PLAN_UNSAFE_WORKTREE_PATH`;
- `PLAN_SOURCE_READ_FAILED`;
- `PLAN_PARSE_FAILED`;
- `PLAN_INVALID_CONTEXT_BUDGET`.

Messages may contain a normalized repository-relative supported-source path but
never source content, a raw thrown value, an absolute path, or Git stderr.

An added file has no base snapshot and a deleted file has no head snapshot; these
are normal states. Unsupported extensions and excluded files do not degrade a
plan. A parse failure in any changed supported file is fatal, because partial
analysis could incorrectly report documentation as current.

## 8. Integration with `aidoc update`

`UpdateContext` replaces `diffSummary` with a bounded `impactPlan` projection.
The Handlebars update template describes each selected change by safe symbol ID,
category, risk, changed contract fields, and documentation target. The complete
existing document remains a separate Trust Gate input.

The legacy `getDiff` helper may remain for non-provider diagnostics only if an
existing consumer needs it. No normal generation template or provider call may
receive its output. A recording-provider regression test must prove that a
seeded raw source sentinel and its diff are absent while the corresponding safe
symbol change is present.

## 9. Demonstration and Documentation

The repository adds a deterministic `npm run demo:impact` script. It creates an
isolated temporary Git repository, commits a small TypeScript API, changes one
public contract, adds an implementation-only change, and runs the built CLI in
human and JSON modes. It needs no API key and cleans up its temporary repository.

README documentation leads with the three-command path:

```bash
npx aidoc-gen plan
npx aidoc-gen update --dry-run
npx aidoc-gen plan --json
```

The documentation must state that impact analysis detects structured public-code
changes and deterministic documentation references; it does not prove semantic
documentation correctness. A recorded demo asset may be added later, but the
script and copied commands are the source of truth.

## 10. Testing Strategy

All implementation follows strict red-green TDD.

1. **Parser tests** prove stable fingerprints across formatting/line movement,
   changed fingerprints for contract and implementation changes, public/private
   filtering, overload grouping, and value-free snapshots for TS/JS/Python.
2. **Git snapshot tests** cover automatic base resolution, committed/staged/
   unstaged/untracked changes, add/delete/rename, explicit head refs, shallow
   history diagnostics, invalid refs, exclusions, symlinks, and containment.
3. **Impact tests** cover every change category, risk label, rename behavior,
   deterministic ordering, and canonical digest stability.
4. **Documentation tests** cover heading parsing, code references, path links,
   generic-name suppression, recommendations, and honest unmapped output.
5. **Budget tests** prove exact UTF-8 byte limits, priority order, complete JSON,
   oversized identifiers, omitted counts, and stable results.
6. **CLI tests** prove zero-flag human output, clean JSON stdout, exit semantics,
   no provider construction, and useful next actions.
7. **Update regression tests** prove raw source/diff absence, bounded impact-plan
   presence, Trust Gate enforcement, and zero provider calls on planner failure.
8. **MCP tests** prove schema parity with CLI, startup-directory scope, no
   provider construction, and sanitized errors.
9. **Package/demo smoke tests** run the packed tarball and the no-key demo on the
   supported Node floor.

The full release gate remains `npm run verify:release` and must include the new
CLI, package, MCP, and demo coverage before integration.

## 11. Scope and Non-Goals

This increment includes deterministic planning and update integration for
TypeScript, JavaScript, and Python. It does not include:

- LLM classification of changes;
- exact provider-token counting;
- semantic compatibility proofs;
- automatic network fetches;
- automatic documentation writes from `aidoc plan`;
- ProofGraph evidence manifests, `aidoc verify`, or `aidoc explain`;
- expanding MCP access to arbitrary new directories;
- publication, tagging, release creation, or repository visibility changes.

ProofGraph will consume the stable symbol and plan contracts in a later focused
increment rather than being partially embedded here.

Implementation uses the existing runtime dependencies and Node.js standard
library. No new production dependency is added for Git, hashing, Markdown
heading discovery, canonical JSON, or byte budgeting.

## 12. Acceptance Criteria

- `aidoc plan` works in a normal repository without flags, API keys, or an LLM.
- Default planning includes committed and current working-tree changes.
- Explicit base/head mode is reproducible in CI.
- Equivalent AST snapshots produce identical IDs, fingerprints, order, and plan
  digest across runs.
- Changed supported files cannot silently disappear after a parse failure.
- Human output is concise and actionable; JSON is versioned and machine-clean.
- CLI JSON and MCP return the same plan contract for the same snapshots.
- `aidoc update` sends no raw Git diff or source body to a provider.
- Provider context never exceeds the configured UTF-8 byte budget.
- Direct documentation evidence, recommendations, and unmapped symbols are
  distinguishable.
- The packed CLI runs the deterministic no-key demo successfully.
- All existing and new release verification passes before push.
