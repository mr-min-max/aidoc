# MCP Repository Scope Hardening Design

- **Date:** 2026-08-13
- **Target:** `v0.2.0-beta.3` pre-OSS hardening
- **Status:** Approved for implementation

## 1. Objective

Prevent every MCP tool from using caller-controlled paths or project
configuration to read or send project content outside the Git worktree where
the AiDoc MCP server started. AiDoc's own installed runtime, templates, and
dependencies remain application-owned reads outside this project boundary.

The server-start repository is the host-controlled authorization boundary. A
tool caller may choose that repository or one of its real subdirectories, but
cannot widen the boundary through an absolute path, traversal, glob, symbolic
link, configuration lookup, or documentation target.

This closes the caller-directory gap in the five legacy MCP tools:

- `analyze_codebase`
- `generate_readme`
- `generate_api_docs`
- `generate_diagram`
- `check_docs_freshness`

It also closes an implicit configuration-search gap in the provider-free
`plan_documentation_impact`, `prepare_documentation_update`, and
`validate_documentation_draft` tools. Those tools already pin source and target
reads to the startup repository, but their shared planning configuration must
also be loaded through this scope.

This design supersedes the unimplemented multi-root environment allowlist in
Section 7 of the 2026-07-31 Trust Gate design. It does not change the Trust
Gate's provider-boundary behavior.

## 2. Selected Approach

### 2.1 One pinned repository per MCP server

At startup, AiDoc discovers and canonicalizes the Git worktree containing the
server working directory. That worktree is pinned for the lifetime of the MCP
server and shared as the authorization boundary by all eight MCP tools. The
five legacy tools use the new read-scope APIs directly; the three provider-free
tools retain their existing startup-root source/target guards and use the new
scope for safe configuration.

This is deliberately simpler than an environment-configured multi-root
allowlist:

- the MCP host already selects the repository by choosing the server working
  directory;
- one server has one understandable authorization boundary;
- no new environment variable or hidden global permission is introduced;
- users who need two repositories can start two MCP server instances.

The server fails closed when its working directory is not an inspectable Git
worktree.

### 2.2 Compatible directory input

The five legacy tools keep their existing names, `directory` field, and
content-oriented return shapes.

- An absolute directory remains accepted when it is inside the pinned
  worktree.
- A relative directory is resolved from the pinned worktree root.
- The worktree root and real subdirectories are accepted.
- `.git`, external paths, missing paths, non-directories, and paths containing
  a symbolic-link component are rejected.

Subdirectory support preserves monorepo use without granting access to a
sibling repository or the rest of the user's machine.

The only intentional response normalization is that source `filePath` values
returned by `analyze_codebase` become repository-relative POSIX paths instead
of local absolute paths.

## 3. Security Boundary

### 3.1 Opaque authorized directory

A new MCP-only read scope owns the canonical repository root and returns an
opaque authorized-directory value. Downstream MCP code receives this value
rather than trusting a caller string repeatedly.

Authorization verifies:

1. the input is an own data property with a nonempty string value no larger
   than 4,096 UTF-8 bytes;
2. the lexical path has no control characters or invalid platform syntax;
3. every existing path component is inspected without following symbolic
   links;
4. the canonical target is a directory contained by the pinned canonical
   worktree root;
5. the path does not enter the worktree's Git metadata directory; and
6. the pinned root and authorized directory still have their inspected
   identities before a sensitive read phase.

Getters, inherited properties, hostile proxies, and implicit string coercion
do not become an input channel. Tool schemas advertise
`additionalProperties:false`, and the runtime independently copies only the
exact own data-property keys allowed by each route before authorization.

Authorized file reads use no-follow descriptor opens where the platform
supports them, verify file identity before and after reading, and pass the
captured source text to the existing AST parser snapshot interface. An MCP AST
parser does not reopen the caller-controlled pathname after authorization.

### 3.2 Relative file inputs

`doc_file` remains relative to the authorized directory. It must be a bounded
relative path with no absolute prefix, control character, parent traversal, or
symbolic-link component. Its resolved physical path must stay inside the
pinned repository and outside Git metadata.

Freshness evaluation applies the same authorization to each changed source
file before an AST parser reads it. A rejected documentation or source path
produces an MCP error rather than an `unknown` freshness report.

### 3.3 Glob inputs and matches

Both caller-provided and project-configured include/exclude patterns are
validated before glob expansion. A pattern is rejected when it is empty,
oversized, absolute, URI-like, contains a control character or backslash, or
contains parent traversal. Ordinary repository-relative glob syntax remains
supported.

Each include/exclude list is limited to 64 patterns, each pattern to 1,024
UTF-8 bytes, and the combined list to 16,384 UTF-8 bytes. The legacy
comma-separated input remains accepted; an empty exclude input means no
exclusions rather than one empty pattern.

MCP uses a symlink-pruned directory walk rather than relying on glob's default
traversal behavior. Before parsing or cache lookup, every matched entry must be
a regular non-symlink file whose canonical path remains inside the pinned
repository and outside Git metadata. Parser output receives only the
repository-relative display path.

### 3.4 Configuration and package metadata

MCP uses a dedicated bounded configuration loader after directory
authorization. Search walks from the authorized directory up to and including
the pinned repository root, then stops. It never performs cosmiconfig's global
or home fallback.

Only declarative JSON/YAML configuration and the `aidoc` field in
`package.json` are supported by MCP. JavaScript/TypeScript/CommonJS config is
rejected rather than executed. This restriction applies only to MCP; direct
CLI behavior is unchanged. It is necessary because executable configuration
could itself read any host path before AiDoc could enforce repository scope.

Any configuration artifact or `package.json` used by a legacy MCP tool must
be an authorized regular non-symlink file before it is read. Caller and
configuration globs pass the same validator.

The three provider-free workflow tools receive an immutable planning config
from this same loader instead of allowing the shared impact planner to run its
ordinary CLI config search. Normal CLI planning keeps its existing loader and
behavior. Prepare and validate load the safe config afresh, so a configuration
change that alters the effective plan participates in their existing
stale-plan rejection; an unsafe replacement configuration is rejected before
planning.

Provider credentials already present in the MCP process environment remain
supported. For source-checkout convenience, only the exact pinned-root `.env`
may supplement missing provider environment variables: AiDoc opens it as a
verified regular non-symlink file, parses it as data, imports only the
existing exact `AIDOC_*` provider mappings and five documented provider-key
variables into an immutable per-request environment snapshot, and never
mutates `process.env`. The host process environment wins. No implicit dotenv
search is used. The legacy secret-bearing `apiKey` project-config field is
rejected by MCP; provider credentials stay in the host environment or the
bounded root `.env` data path.

### 3.5 Ordering invariant

Every legacy path-bearing tool follows this order:

```text
read own bounded arguments
  -> authorize pinned repository directory
  -> validate doc/glob inputs
  -> load only repository-scoped configuration/metadata
  -> validate configured globs
  -> enumerate and authorize source files
  -> AST parse / Git freshness work
  -> construct provider when the tool requires one
  -> generate or return sanitized output
```

For a denied request, configuration loading, package reads, globbing, Git
history access, AST parsing, provider construction, provider transport, and
repository writes must all remain uncalled.

`check_docs_freshness.since` is validated as a bounded Git reference before
Git execution. Leading option syntax and NUL/newline characters produce the
existing fixed `PLAN_INVALID_REF` failure; Git never receives a caller value
as an option.

The provider-free tools follow the same startup-scope and safe-config prefix,
then retain their current deterministic plan/prepare/validate ordering. A
planning-config denial occurs before snapshot Git access or AST parsing.

## 4. Errors and Privacy

Stable protocol codes are:

- `MCP_INVALID_PATH_INPUT`
  - Message: `The MCP path input is invalid.`
  - Used for malformed `directory`, `doc_file`, or glob input.
- `MCP_DIRECTORY_DENIED`
  - Message: `The requested directory is outside the MCP repository scope.`
  - Used for a valid-looking path that is not an authorized real repository
    directory or attempts a symbolic-link/Git-metadata boundary.
- `MCP_UNSAFE_CONFIGURATION`
  - Message: `The MCP project configuration cannot be loaded safely.`
  - Used when executable, symbolic-link, malformed, or otherwise unsupported
    project configuration would be required.

Errors are value-free. They never include the rejected path, glob, repository
root, username, home directory, source content, config content, provider
credential, raw filesystem/provider error, or stack trace. Existing MCP error
allowlisting continues to emit exactly one stable prefix. Legacy generation
maps an otherwise unknown provider/factory/transport/generator failure to one
fixed MCP failure instead of returning even a redacted derivative of its
message.

The formatter recognizes authentic fixed-message error types rather than
trusting a caller-controlled object that merely claims an allowlisted code.

Successful protocol results use repository-relative paths. Generated content
continues through the existing Trust Gate; this read scope is an authorization
boundary, not a replacement for secret scanning.

## 5. Compatibility and UX

- No tool is removed or renamed.
- No output/write parameter is added.
- Existing absolute in-repository paths continue to work.
- Repository-relative directory inputs become explicitly supported.
- Monorepo subdirectories remain supported.
- Provider selection, API keys, subscription-host behavior, and billing do not
  change.
- MCP no longer executes project config or performs implicit home/global
  config and `.env` lookup; an unsafe configuration fails closed with the
  stable error above.
- The provider-free Codex/Claude workflow remains the recommended path and is
  unchanged.
- The bundled Codex skill continues to prohibit the provider-backed legacy
  generation tools; defense in depth remains intentional.

Tool descriptions and public beta documentation will state that the server is
restricted to its startup Git worktree. The old statement that MCP directory
allowlisting is unimplemented will be removed only after the executable guard
and its tests pass.

## 6. Honest Limits

This boundary prevents AiDoc from intentionally resolving and reading another
path. It is not an operating-system sandbox and does not protect against a
privileged same-host process that races filesystem entries between checks.
AiDoc will pin and revalidate identities and avoid following symlinks, but
native descriptor-relative traversal would be required for a formal
race-proof filesystem sandbox.

Hard links are indistinguishable from ordinary repository files at this API
level. Network access remains governed by the selected provider transport and
Trust Gate, not by the repository scope.

## 7. Test Strategy

Implementation follows red-green-refactor. Required evidence includes:

1. root and real-subdirectory success for absolute and relative inputs;
2. malformed, empty, inherited, accessor, proxy, control-character, and
   oversized input rejection;
3. traversal, sibling-prefix, external absolute, missing, non-directory,
   `.git`, parent/leaf/dangling symlink, and symlink-to-inside rejection;
4. unsafe caller and configured glob rejection before expansion, plus matched
   file/directory symlink rejection before parser or cache access;
5. unsafe `doc_file` and changed-source rejection before freshness parsing,
   and invalid Git reference rejection before Git execution;
6. scoped config/package/`.env` discovery that cannot read above the pinned
   root or follow an artifact symlink, including rejection of executable
   config and proof that process environment takes precedence over the
   pinned-root `.env` snapshot, while provider-free plan/prepare/validate
   configuration uses the same loader before Git or AST work;
7. spies proving zero config, package, glob, Git, parser, provider, transport,
   and write calls after denial;
8. stable, single-prefix, value-free error serialization with seeded paths and
   fake secrets absent;
9. repository-relative successful `filePath` values and unchanged legacy
   content schemas;
10. a built and packed stdio MCP smoke using repository A, an external
    repository B with a seeded sentinel, and proof that denial neither returns
    the sentinel nor changes either tree;
11. the complete provider, MCP, package, plugin, hybrid-demo, public-beta, and
    release verification gates.

## 8. Non-Goals

- Multiple allowed roots in one MCP server.
- A new authentication or subscription bridge.
- New write-capable MCP tools.
- Changing CLI directory behavior outside MCP.
- Removing the legacy provider-backed tools in this beta.
- Claiming prompt-injection immunity or operating-system sandboxing.

## 9. Acceptance Criteria

The hardening is complete when:

- all eight MCP routes share one pinned startup-worktree authorization
  boundary; the five legacy routes use the MCP read scope for their project
  reads, while all eight use it for project configuration;
- no caller-supplied unapproved path can reach a content read, parser, Git
  command, provider, or response;
- allowed root/subdirectory workflows retain their documented behavior;
- all errors and successful paths satisfy the privacy contract;
- documentation matches the executable boundary; and
- all required tests and full release verification pass on the final tree.
