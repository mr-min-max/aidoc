# aidoc OSS Credibility Sprint Design

- **Date:** 2026-07-30
- **Duration:** 6 calendar days, starting today
- **Status:** Approved for implementation

## 1. Objective

Turn the current `v0.1.0` repository into a credible, demonstrably maintained
open-source project without manufacturing activity.

By the end of the sprint, a reviewer should be able to verify:

- the published CLI works from its npm tarball;
- CI and the GitHub Action exercise real behavior and expose failures;
- security boundaries around credentials, provider context, and writes are
  documented and tested;
- documentation updates are derived from semantic AST changes rather than a
  truncated raw diff;
- generated technical claims have machine-verifiable evidence;
- issues, pull requests, commits, releases, and feedback correspond to real
  work;
- application claims are supported by public repository evidence.

## 2. Authenticity Policy

Repository activity is a by-product of the work, not a metric to manipulate.

We will:

- create an issue before substantial work begins;
- use focused branches and pull requests;
- preserve useful atomic commits when they explain the implementation;
- merge only after fresh tests and review;
- publish releases only when their documented behavior is verified;
- report real dogfooding and external feedback, including limitations.

We will not:

- backdate commits or delay completed work solely to alter the activity graph;
- add empty commits, cosmetic churn, or comments solely to increase volume;
- fabricate users, reviews, downloads, stars, issues, or contributors;
- use multiple identities for one contributor;
- intentionally add typos, slang, or abbreviated prose to disguise assisted
  development;
- describe planned or mocked behavior as shipped.

## 3. Two Workstreams

### 3.1 Maintainer workstream

The maintainer owns actions that require identity, credentials, personal
judgment, or external relationships:

- revoke the credential currently embedded in the local Git remote URL;
- configure GitHub authentication without embedding a token in the URL;
- keep the GitHub profile and repository public;
- complete npm authentication and two-factor approval;
- approve merges and release publication;
- invite real developers to test the package;
- respond to external feedback from the maintainer account;
- verify personal application fields and submit the application.

The maintainer must not paste replacement credentials into chat, source files,
issues, or pull requests.

### 3.2 Engineering workstream

Codex owns repository-scoped implementation work:

- root-cause investigation and reproductions;
- design and implementation plans;
- production code and tests using test-driven development;
- pull-request, issue, changelog, release-note, and application drafts;
- package, CLI, MCP, GitHub Action, and security verification;
- dogfooding scripts and public benchmark methodology;
- README architecture, security model, and demonstration materials.

External writes such as publishing packages, pushing branches, opening public
issues, and submitting forms require explicit authorization or maintainer
action.

## 4. Six-Day Delivery Roadmap

### Day 1 — Release Integrity

Goal: produce a release candidate for `v0.1.1` whose existing claims work from
the distributed artifact.

Deliverables:

1. **Package integrity**
   - reproduce the missing-template failure from the built CLI;
   - ship Handlebars templates with the compiled package;
   - centralize template-directory resolution;
   - add a tarball smoke test that renders a real template through a stub
     provider without network access.

2. **GitHub Action correctness**
   - remove forced `--mock` execution from production modes;
   - stop swallowing generator failures with `|| true`;
   - make `generate` and `check` behavior explicit;
   - add a fixture test proving a failed generation fails the Action.

3. **MCP correctness**
   - replace the mixed newline-input/Content-Length-output transport;
   - use one standards-compliant stdio framing implementation;
   - add initialize, tools/list, and tools/call integration tests;
   - keep tool behavior provider-agnostic.

4. **Release verification**
   - run unit tests, lint, TypeScript build, package inspection, and tarball
     smoke tests;
   - draft the `v0.1.1` changelog and release notes;
   - do not publish until all checks pass from the packed artifact.

Day 1 intentionally does not include Trust Gate or ProofGraph. It restores
trust in behavior already advertised by the project.

### Day 2 — Trust Gate

Goal: prevent credentials and repository secrets from crossing the provider
boundary or reappearing in generated output.

Deliverables:

- a provider-agnostic `ContextEnvelope`;
- high-confidence detectors for API keys, private keys, credential URLs, and
  sensitive file patterns;
- a final scan of the rendered prompt before every provider call;
- stable typed redaction placeholders;
- a second scan of provider output;
- `warn`, `redact`, and `strict` policies;
- removal of plaintext credential recommendations from documentation;
- deprecation of config-file API keys before removal in a later release;
- repository-contained, symlink-safe, atomic writes;
- `aidoc doctor --security`;
- bounded JSON receipts that never store secret values, prompts, or responses.

Target release: `v0.2.0-beta.1`.

### Day 3 — Semantic Documentation Impact

Goal: replace the truncated raw-diff workflow with an AST-first change model.

Deliverables:

- base/head AST snapshots;
- stable symbol fingerprints;
- added, removed, and changed public-symbol records;
- affected-document-section mapping;
- `aidoc plan --base <ref>`;
- deterministic context budgeting;
- removal of raw git diff from normal provider context.

### Day 4 — ProofGraph MVP

Goal: make generated documentation technically attributable to code evidence.

Deliverables:

- stable evidence IDs for supported AST symbols;
- a repository-relative evidence manifest;
- structured generation slots that reference existing evidence IDs;
- deterministic checks for symbols, signatures, parameters, paths, and links;
- `aidoc verify <document>`;
- `aidoc explain <document>#<section>`;
- explicit `verified`, `unsupported`, `stale`, and `degraded` states.

### Day 5 — Dogfooding and Public Workflow

Goal: gather real operational evidence and fix what actual use exposes.

Deliverables:

- run the packed CLI against `aidoc`;
- run it against at least one other public repository with permission;
- record reproducible commands and sanitized results;
- convert discovered problems into issues and focused fixes;
- publish a GitHub Check summary;
- create a short demonstration showing a seeded fake secret being blocked;
- publish benchmark methodology and results without unsupported claims.

### Day 6 — Stable Release and Application Evidence

Goal: publish a coherent stable milestone and prepare a factual application.

Deliverables:

- release `v0.2.0` if the beta exit criteria pass;
- update README, roadmap, changelog, security model, and release notes;
- mark shipped, in-progress, and planned capabilities accurately;
- close the completed milestone and retain unresolved limitations as issues;
- collect public links for releases, CI, npm, issues, pull requests, demo, and
  dogfooding;
- produce final application drafts using only verified metrics and claims.

## 5. Day 1 Component Design

Day 1 is the first independently implementable subproject. Later days receive
their own focused specifications and implementation plans.

### 5.1 Template distribution boundary

A single resolver will identify the template directory. Production builds use
templates copied under `dist/templates`; tests may provide an explicit
directory. Commands and MCP must use the same resolver rather than constructing
paths independently.

The build must fail if required templates are absent. The package smoke test
must install or unpack the generated tarball in a temporary directory and
render at least one real Handlebars template with a deterministic stub
provider. `--mock` alone is insufficient because it bypasses template loading.

### 5.2 GitHub Action boundary

Production Action modes invoke the same compiled CLI distributed to users.
Mock behavior remains available only in explicit test fixtures. A missing
credential, provider failure, invalid output, or CLI crash must produce a
non-zero result rather than a successful-looking summary.

Check mode must compare a deterministic artifact. Non-deterministic remote LLM
generation is not a valid freshness oracle; where deterministic regeneration
is unavailable, check mode must use AST-derived freshness or fail with a clear
configuration error.

For Day 1, this is an AST-backed **co-change guard**: it can prove that a
documentation target did or did not change in the same Git range as parseable
source files. It must not label co-change as semantic correctness or claim that
the resulting prose is current. Semantic base/head comparison and claim-level
verification remain Day 3 and Day 4 work.

### 5.3 MCP transport boundary

The server will use one framing protocol for both input and output. Protocol
parsing is separated from aidoc tool handlers so transport tests do not require
an LLM or repository scan. Tool handlers continue to depend on the existing
provider and parser abstractions.

Directory authorization and write containment are implemented with Trust Gate
on Day 2; Day 1 must not broaden the current MCP tool surface.

### 5.4 Error handling

- Missing packaged templates fail before a provider request.
- Action errors preserve the originating command and exit status.
- MCP parse errors return protocol errors without corrupting stdout framing.
- Test fixtures use fake credentials and seeded fake secrets only.
- Logs and snapshots must never contain the credential found in local Git
  configuration.

### 5.5 Testing

Every behavior change follows red-green-refactor:

- first reproduce the packaged-template failure;
- first prove Action failures are currently masked;
- first reproduce the MCP framing incompatibility;
- implement the smallest fix for one failing test at a time;
- run the focused test after each change;
- run the complete unit suite, lint, build, package inspection, and tarball
  smoke test before review and release.

## 6. Repository Presentation

### Commit style

Use concise conventional commits where the prefix adds information:

```text
test(package): reproduce missing templates in packed CLI
fix(package): ship prompt templates with compiled output
fix(action): propagate documentation generation failures
test(mcp): cover stdio initialize and tools/list framing
```

Commit bodies explain the failure or tradeoff when the subject is not enough.
Commits are not split or merged merely to influence activity counts.

### Code comments

Comments explain security boundaries, invariants, non-obvious protocol rules,
and reasons for a tradeoff. They do not restate syntax or imitate casual human
mistakes.

### Pull requests

Each pull request contains four short sections:

1. Problem
2. Change
3. Verification
4. Known limits

### Public roadmap

`ROADMAP.md` will distinguish:

- **Shipped:** verified in a published artifact;
- **In progress:** active issue or pull request;
- **Planned:** approved direction without a shipped claim.

## 7. Sprint Exit Criteria

The sprint succeeds when:

- existing release claims work from packed and published artifacts;
- no production workflow hides errors or silently substitutes mock output;
- provider input and output pass the Trust Gate;
- update context is AST-derived;
- technical claims can be traced to valid evidence IDs;
- public repository activity maps to real implementation or maintenance work;
- at least one external dogfooding run is documented honestly;
- the application contains no placeholders or unsupported adoption claims.

Stars, download counts, and external feedback are recorded as outcomes, not
manufactured success criteria.
