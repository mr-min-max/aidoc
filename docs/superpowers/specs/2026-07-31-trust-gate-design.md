# Aidoc Trust Gate Design

- **Date:** 2026-07-31
- **Target:** `v0.2.0-beta.1`
- **Status:** Approved for implementation

## 1. Objective

Prevent repository credentials and high-confidence secrets from crossing an
LLM provider boundary or reappearing in generated output. Apply the same
security policy to the CLI, GitHub Action, MCP tools, watch mode, annotations,
and third-party providers registered through the existing `LLMProvider`
extension point.

The Trust Gate also constrains application-owned reads and writes to an
authorized repository scope, adds an offline security doctor, and produces
optional bounded receipts that contain no prompt, response, or secret value.

This beta is a deterministic secret and path-safety boundary. It is not a
general prompt-injection sandbox, operating-system sandbox, or guarantee
against a privileged process racing filesystem operations on the same host.

## 2. Design Principles

1. **AST first, Trust Gate second, provider last.** Structured extraction
   remains deterministic. The final rendered prompt is always scanned because
   AST metadata, documentation, commit messages, paths, and diffs may still
   contain secrets.
2. **Provider agnostic.** Security logic sits above `LLMProvider`; OpenAI,
   Anthropic, Ollama, and registered third-party providers receive only the
   policy-approved request.
3. **Fail before exposure.** Strict violations occur before a provider call,
   stream callback, file write, or MCP response.
4. **Allowlist receipts.** Receipts are constructed from an explicit safe
   schema. They are never produced by serializing sensitive state and trying to
   redact it afterward.
5. **Honest limits.** The project will distinguish secret redaction, path
   containment, and best-effort race detection from full sandbox isolation.

## 3. Provider Boundary

### 3.1 Context envelope

Every generation operation creates a `ContextEnvelope` after Handlebars
rendering and before transport. It contains:

- operation: `readme`, `api`, `jsdoc`, `changelog`, `diagram`, or `update`;
- origin: `cli`, `action`, or `mcp`;
- system message and rendered user prompt;
- effective `warn`, `redact`, or `strict` policy;
- non-sensitive receipt metadata.

Provider credentials never belong to the envelope. Provider adapters remain
transport implementations and do not implement detectors independently.

### 3.2 Trusted generation gateway

`Generator` routes every `generate` and `generateStream` call through one
`TrustedGenerationGateway`:

1. scan system and user messages;
2. apply the selected policy;
3. call the underlying provider only with approved text;
4. scan the completed provider output;
5. apply the same policy before returning output to CLI, MCP, or a write sink;
6. record only bounded, value-free receipt events.

The gateway wraps the public provider extension seam, so a provider registered
through `registerProvider` cannot bypass the policy.

### 3.3 Streaming

The beta buffers a streaming result until the completed response passes the
output scan. Only the approved or redacted response reaches the callback. This
temporarily trades token-by-token display for a simple guarantee that a secret
split across chunks cannot appear before detection. A later stateful streaming
scanner may restore progressive display without weakening this invariant.

## 4. Detection and Policies

### 4.1 High-confidence detectors

The initial detector set covers:

- provider and platform tokens with reliable prefixes, including OpenAI,
  Anthropic, and GitHub token families;
- PEM and SSH private-key blocks;
- credential-bearing URLs such as `scheme://user:password@host`;
- secret-bearing assignments and serialized fields named `apiKey`, `token`,
  `password`, `clientSecret`, or close canonical variants;
- sensitive paths and basenames such as `.env*`, `.npmrc`, `.pypirc`,
  `.netrc`, AWS credential files, and common SSH private-key names.

Entropy-only guesses are excluded from the beta because their false-positive
rate would make strict mode unreliable. Tests use seeded fake credentials only.

### 4.2 Stable typed placeholders

A per-run redaction session maps each repeated secret to the same typed,
ordinal placeholder, for example:

```text
<AIDOC_REDACTED:API_KEY:1>
```

Placeholders contain no prefix fragment, suffix, length, hash, or other value
derived from the secret. The secret-to-placeholder map exists only in memory
for the current run and is never included in a receipt.

### 4.3 Policy semantics

- `redact` is the default. It replaces findings before provider transport and
  before generated output reaches a consumer.
- `strict` throws a typed, value-free violation. Input findings prevent the
  provider call; output findings prevent callbacks, writes, and MCP return.
- `warn` permits the original content and emits only categories and counts. It
  must be explicitly selected because it can disclose detected content.

`strict-output` remains a separate Markdown/JSON/Mermaid shape validation and
does not imply a Trust Gate policy.

## 5. Credential Configuration

Provider-specific environment variables remain the supported credential path.
The GitHub Action continues to convert its secret input into the appropriate
provider environment variable.

The legacy config-file `apiKey` field remains readable for one beta
compatibility window but:

- emits one warning that never prints the value;
- loses precedence to provider-specific environment credentials;
- is removed from setup recommendations and examples;
- is marked for removal in the next compatible release plan.

Programmatic provider construction may still accept an in-memory credential;
this is distinct from persisting it in an Aidoc config file.

## 6. Repository Scope and Atomic Writes

### 6.1 Workspace scope

Each CLI invocation creates a canonical `WorkspaceScope` from the real project
root. Config search, scanning, reads, and application-owned writes use that
scope consistently.

The path boundary:

- accepts only targets contained by the canonical root;
- rejects traversal, external absolute targets, the root itself, and `.git`;
- rejects symlinked or non-directory existing ancestors;
- rejects symlink, directory, device, FIFO, or socket leaves;
- reports repository-relative display paths only.

All document commands, watch mode, score output, and annotation replacements
use this boundary. `annotate` no longer writes directly with `writeFileSync`.

### 6.2 Atomic replacement

Generated content is written to an exclusive temporary file in the verified
target directory, flushed, revalidated, and renamed within that directory.
Failure preserves the prior file and removes the temporary artifact.

Node path APIs cannot formally eliminate a malicious, privileged same-host
process racing directory renames without a native directory-descriptor helper.
The beta therefore claims repository containment, symlink rejection, atomic
replacement, and race detection—not OS-level isolation.

## 7. MCP Authorization

MCP startup reads a host-controlled allowlist from
`AIDOC_MCP_ALLOWED_ROOTS`. Each entry is canonicalized once. If no root is
configured, MCP fails closed for repository-reading tools.

The caller-provided `directory` must resolve to an allowlisted root or its
canonical descendant. Authorization happens before config loading, globbing,
Git access, AST parsing, package reads, or provider creation. `doc_file` and
glob inputs must be relative and every resolved result remains inside the same
scope.

The client may select a directory inside the allowlist but cannot add or widen
authorized roots. MCP errors contain a stable code and sanitized message, not
the rejected absolute path.

## 8. Security Doctor

`aidoc doctor --security` is deterministic, read-only, and provider-free. It
supports human-readable and `--json` output and checks:

- whether the project root can be canonicalized safely;
- deprecated config-file credential presence without reading it into output;
- unsafe output configuration;
- sensitive tracked filenames and detector category counts;
- effective Trust Gate policy;
- MCP allowlist configuration when MCP use is requested.

Exit codes are `0` for clean, `1` for findings, and `2` when evaluation cannot
be completed safely.

## 9. Bounded Receipts

Receipt persistence is opt-in so Aidoc does not silently dirty repositories or
change Action staging. A receipt uses an explicit schema containing only:

- schema version and run identifier;
- command/operation, policy, and provider name;
- status and duration;
- finding kinds and aggregate counts;
- redacted/blocked decisions;
- repository-relative write outcomes and byte counts;
- stable error code;
- truncation flags and aggregate totals.

Receipts never contain prompts, responses, system messages, secret values,
secret-derived hashes, absolute paths, raw provider errors, stack traces, or
snippets. Arrays and serialized bytes have deterministic caps. Persisted
receipts use the same scoped atomic writer.

## 10. Error Semantics

Initial stable codes include:

- `TRUST_SECRET_BLOCKED`
- `TRUST_PATH_OUTSIDE_ROOT`
- `TRUST_UNSAFE_SYMLINK`
- `TRUST_INVALID_TARGET_TYPE`
- `TRUST_RACE_DETECTED`
- `TRUST_ATOMIC_WRITE_FAILED`
- `MCP_DIRECTORY_DENIED`
- `MCP_INVALID_PATH_INPUT`

CLI policy/input rejections exit `2`; operational provider or write failures
exit `1`. MCP returns `isError: true` with the stable code and a sanitized
message. Annotation parsing, retry logging, and provider error handling must not
echo raw response or request content.

## 11. Test Strategy

Every behavior change follows red-green-refactor with fake secrets and
temporary repositories.

Required coverage:

1. detector matches, false-positive boundaries, repeated placeholders, and
   proof that errors/findings/receipts omit the seeded value;
2. all six generator operations, system messages, final rendered prompts,
   outputs, third-party registered providers, and zero calls in strict mode;
3. secrets split across streaming chunks and retry behavior without raw token
   replay;
4. traversal, sibling-prefix escape, absolute external paths, leaf/parent/
   dangling symlinks, invalid target types, failure preservation, and temp-file
   cleanup;
5. every document command, watch, score, and annotate using the scoped writer;
6. MCP allowed root/descendant success and pre-read denial for external paths,
   symlink escapes, unsafe `doc_file`, and glob inputs;
7. security doctor output and exit codes without provider construction;
8. receipt schema caps and explicit forbidden-field/value checks;
9. tarball, Action, MCP, Node 22/24, and full release verification regression
   gates.

## 12. Implementation Slices

1. `feat(security): add provider-boundary secret policies`
   - trust types, detector, redaction session, gateway, streaming buffering,
     policy configuration, credential deprecation, and core tests.
2. `fix(output): contain and atomically write generated files`
   - workspace scope, safe reader/writer, all CLI sinks, and path tests.
3. `feat(mcp): authorize repository directories`
   - host allowlist, relative input constraints, sanitized protocol errors, and
     MCP tests.
4. `feat(cli): add security doctor and bounded receipts`
   - provider-free doctor, opt-in receipts, documentation, and package tests.

Each slice receives an implementation review before the next begins. The beta
is not tagged or published until the complete private-PR gate passes and the
remaining online production audit is explicitly authorized.

## 13. Acceptance Criteria

- No generation route can reach an `LLMProvider` without the final input scan.
- No provider output can reach a callback, parser, MCP response, or write sink
  without the output scan.
- Strict findings prove zero provider calls and zero writes.
- Redaction is stable within a run and reveals no secret-derived information.
- All application-owned repository writes are contained, symlink-rejecting,
  and atomic.
- MCP repository access is constrained by a host-owned allowlist before reads.
- Doctor and receipts are deterministic, bounded, and value-free.
- Documentation describes the Trust Gate and its limitations without claiming
  sandbox or prompt-injection guarantees.
