# Smart Plan to Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:test-driven-development` task-by-task and
> `superpowers:verification-before-completion` before the terminal report. This
> SUBCULTURE worker executes directly; do not create agents, threads, or
> worktrees.

**Goal:** Make `aidoc`, `aidoc plan`, and `aidoc update` form a provider-free
planning path and a safe one-command update path that automatically resolves
the affected existing Markdown documents.

**Architecture:** A new impact target resolver turns `ImpactPlan` mappings into
repository-prepared candidates and projects provider context to one selected
document. CLI selection is separate from deterministic collection. The update
command prepares all selected snapshots before provider construction, then
generates, previews, confirms, and atomically writes each target.

**Tech Stack:** TypeScript, Commander, prompts, existing `ImpactPlan`,
`RepositoryWriteScope`, Jest.

## Global Constraints

- Read first: `AGENTS.md`, the accepted hybrid beta spec, `src/impact/types.ts`,
  `src/cli/commands/plan.ts`, `src/cli/commands/update.ts`,
  `src/security/repository-writer.ts`, and their focused tests.
- Do not edit `src/config/**`, `src/providers/**`, `src/mcp/**`, `package.json`,
  or lockfiles; another owner controls those surfaces.
- Do not edit `src/cli/context.ts`; provider/context integration is owned by
  Slice B and Sol.
- Do not parse source or diffs; consume only the accepted AST-first impact plan.
- Automatic and explicit update targets must be existing, repository-contained
  Markdown regular files prepared through `RepositoryWriteScope` before
  `loadCommandContext()`.
- `aidoc plan --json` retains `aidoc.impact-plan.v1` byte-for-byte schema
  compatibility and never includes interactive target state.
- No-impact and cancelled flows exit `0` without provider construction.
- Ambiguous non-interactive selection exits `1`; repository/Trust failures use
  the existing safe exit-code mapping.
- Stage only this plan's files. Do not run repository-wide formatting or the
  full release gate while Slice B is active.

---

## Task 1: Repository-prepared documentation target resolver

**Files:**

- Create: `src/impact/targets.ts`
- Create: `tests/unit/impact/targets.test.ts`

**Interfaces:**

- Consumes: `ImpactPlan`, `ImpactProviderContext`, and
  `RepositoryWriteScope.prepare(rawTarget)`.
- Produces:

```ts
export type DocumentationTargetReason =
  | "direct-reference"
  | "recommendation"
  | "unmapped-public-change-fallback"
  | "explicit";

export interface DocumentationTargetCandidate {
  readonly path: string;
  readonly reasons: readonly DocumentationTargetReason[];
  readonly sections: readonly string[];
}

export interface ResolvedDocumentationTarget extends DocumentationTargetCandidate {
  readonly prepared: PreparedRepositoryTarget;
}

export function hasDocumentationImpact(plan: ImpactPlan): boolean;

export async function resolveDocumentationTargets(input: {
  plan: ImpactPlan;
  scope: RepositoryWriteScope;
  explicitTargets?: readonly string[];
}): Promise<ResolvedDocumentationTarget[]>;

export function projectProviderContextForTarget(
  context: ImpactProviderContext,
  target: DocumentationTargetCandidate,
): ImpactProviderContext;
```

- [ ] **Step 1: Write failing collection and safety tests**

Cover these exact behaviors:

```ts
expect(paths(result)).toEqual(["README.md", "docs/API.md"]);
expect(result[0].reasons).toEqual(["direct-reference", "recommendation"]);
expect(await resolve(explicit("docs/Guide.md", "docs/Guide.md"))).toHaveLength(
  1,
);
await expect(resolve(explicit("../outside.md"))).rejects.toMatchObject({
  code: "TRUST_INVALID_PATH",
});
```

Also assert zero impact, case-insensitive `.md` eligibility, non-Markdown
rejection, duplicate de-duplication by prepared `displayPath`, missing mapped
files, absent README fallback, and existing README fallback.

- [ ] **Step 2: Run the resolver test and verify RED**

Run: `npm test -- tests/unit/impact/targets.test.ts --runInBand`

Expected: FAIL because `src/impact/targets.ts` does not exist.

- [ ] **Step 3: Implement deterministic candidate collection**

Collect unique file values in sorted path order from direct references and
recommendations. Aggregate reasons and unique sorted sections. Reject an
invalid/non-Markdown mapped path through repository target validation; do not
silently replace it with README.

When no mapped candidate exists and at least one public symbol impact is
`unmapped`, prepare `README.md`; include it only when `existingText !== null`.
Explicit targets replace all automatic candidates and receive reason
`explicit`.

- [ ] **Step 4: Implement target-specific provider-context projection**

For mapped targets, retain only documentation references whose normalized file
equals the target path and only changes referenced by the retained
documentation entries. For the README fallback, retain unmapped public symbol
changes. Preserve `schemaVersion`, `impactDigest`, `summary`, and
`omittedRecords`; never add source text or Git diff fields.

- [ ] **Step 5: Run resolver tests and verify GREEN**

Run: `npm test -- tests/unit/impact/targets.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/impact/targets.ts tests/unit/impact/targets.test.ts
git commit -m "feat: resolve affected documentation targets"
```

## Task 2: Truthful plan presentation

**Files:**

- Modify: `src/output/impact.ts`
- Modify: `src/cli/commands/plan.ts`
- Modify: `tests/unit/output/impact.test.ts`
- Modify: `tests/unit/cli/plan.test.ts`

**Interfaces:**

- Consumes: `resolveDocumentationTargets()` and
  `DocumentationTargetCandidate[]`.
- Produces:

```ts
export interface ImpactPlanPresentation {
  readonly targets: readonly DocumentationTargetCandidate[];
  readonly requiresExplicitTarget: boolean;
}

export function formatImpactPlan(
  plan: ImpactPlan,
  verbose?: boolean,
  presentation?: ImpactPlanPresentation,
): string;
```

- [ ] **Step 1: Write failing output-state tests**

```ts
expect(format(noImpact)).toContain("No documentation updates are indicated.");
expect(format(noImpact)).not.toContain("Next: aidoc update");
expect(format(oneTarget)).toContain("Target: docs/API.md");
expect(format(manyTargets)).toContain("Targets:\n  docs/API.md\n  README.md");
expect(format(noSafeTarget)).toContain("Use --target <file>");
```

Assert verbose Base/Head output remains unchanged and JSON serialization stays
canonical.

- [ ] **Step 2: Run focused tests and verify RED**

Run:
`npm test -- tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts --runInBand`

Expected: FAIL because the current formatter always prints the next command.

- [ ] **Step 3: Implement four terminal presentation states**

Use exactly these decisions:

1. no impact: completed message, context line, no next command;
2. one target: one `Target:` line plus `Next: aidoc update`;
3. several targets: sorted `Targets:` list plus `Next: aidoc update`;
4. impact/no target: explicit `--target <file>` guidance, no misleading
   automatic-target claim.

Human `executePlanCommand()` may open one `RepositoryWriteScope` and resolve
targets; JSON mode must skip presentation-only resolution and serialize only
the public plan.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:
`npm test -- tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/output/impact.ts src/cli/commands/plan.ts tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts
git commit -m "fix: make impact plan next steps truthful"
```

## Task 3: Multi-target plan-first update command

**Files:**

- Create: `src/cli/update-target-selection.ts`
- Modify: `src/cli/commands/update.ts`
- Modify: `tests/unit/cli/update-impact.test.ts`
- Modify: `tests/unit/cli/commands.test.ts`

**Interfaces:**

- Consumes: Task 1 resolver/context projection, existing
  `loadCommandContext()`, `writeDoc()`, and `toWriteDocOptions()`.
- Produces:

```ts
export interface UpdateSelectionRuntime {
  readonly interactive: boolean;
  choose(
    candidates: readonly DocumentationTargetCandidate[],
  ): Promise<readonly string[]>;
}

export async function selectUpdateTargets(input: {
  candidates: readonly ResolvedDocumentationTarget[];
  explicit: boolean;
  all: boolean;
  runtime?: UpdateSelectionRuntime;
}): Promise<ResolvedDocumentationTarget[]>;
```

- [ ] **Step 1: Write failing command-order and ambiguity tests**

Assert event ordering and negative boundaries:

```ts
expect(events.indexOf("prepare:docs/API.md")).toBeLessThan(
  events.indexOf("provider"),
);
expect(events.indexOf("prepare:README.md")).toBeLessThan(
  events.indexOf("provider"),
);
expect(providerFactory).not.toHaveBeenCalled(); // no impact / unsafe / ambiguous
```

Cover one automatic target, interactive multi-select, repeated explicit
`--target`, `--all`, invalid `--target` + `--all`, non-interactive ambiguity,
empty/cancelled selection, `--yes`, per-target cancellation, and partial
progress summary.

- [ ] **Step 2: Run focused tests and verify RED**

Run:
`npm test -- tests/unit/cli/update-impact.test.ts tests/unit/cli/commands.test.ts --runInBand`

Expected: FAIL on default README behavior and missing options.

- [ ] **Step 3: Register exact CLI options**

Use a Commander collector so repeated targets accumulate:

```ts
.option("--target <file>", "Existing Markdown file to update", collect, [])
.option("--all", "Update every automatically affected document")
.option("--yes", "Apply every generated diff without prompting")
```

Keep `--base`, `--since`, `--dry-run`, and `--mock`. `--base` and `--since`
must still match when both are provided.

- [ ] **Step 4: Implement plan, prepare, select, generate, write ordering**

Open one `RepositoryWriteScope`, resolve candidates, select targets, and ensure
every selected target already has an existing snapshot before calling
`loadCommandContext()`. For each target, call `generateUpdate()` with its
projected provider context, then `writeDoc()` with
`toWriteDocOptions(options)`. Do not re-read a target after generation.

Interactive multiple-candidate choice uses a `multiselect` prompt sorted by
path with reason labels. Non-interactive means either stdin or stdout is not a
TTY. Explicit repeated targets and `--all` do not prompt for selection.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:
`npm test -- tests/unit/cli/update-impact.test.ts tests/unit/cli/commands.test.ts tests/unit/impact/targets.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/cli/update-target-selection.ts src/cli/commands/update.ts tests/unit/cli/update-impact.test.ts tests/unit/cli/commands.test.ts
git commit -m "feat: make update choose affected documents"
```

## Task 4: Useful no-subcommand entry point

**Files:**

- Create: `src/cli/commands/default.ts`
- Modify: `src/cli/index.ts`
- Create: `tests/unit/cli/default.test.ts`

**Interfaces:**

- Produces:

```ts
export interface DefaultCommandRuntime {
  readonly interactive: boolean;
  confirmUpdate(): Promise<boolean>;
  showHelp(): void;
  stdout(value: string): void;
  stderr(value: string): void;
}

export async function executeDefaultCommand(
  runtime?: DefaultCommandRuntime,
  cwd?: string,
): Promise<0 | 1 | 2>;
```

- [ ] **Step 1: Write failing default-entry tests**

Cover non-interactive help/no plan, interactive no-impact, interactive impact +
decline, impact + accept forwarding into `executeUpdateCommand({})`, and safe
plan failure.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/cli/default.test.ts --runInBand`

Expected: FAIL because the default command module does not exist.

- [ ] **Step 3: Implement the default action**

Non-interactive execution calls `showHelp()` only. Interactive execution builds
and prints the same deterministic plan/presentation used by `aidoc plan`. Ask
`Prepare an update now?` only when impact and a safe target exist. An accepted
answer calls the regular update command; do not duplicate generation logic.

Register the handler as the root Command action without changing the existing
`--mcp` early-start path.

- [ ] **Step 4: Verify the entire slice**

Run:

```bash
npm test -- tests/unit/impact/targets.test.ts tests/unit/output/impact.test.ts tests/unit/cli/plan.test.ts tests/unit/cli/update-impact.test.ts tests/unit/cli/commands.test.ts tests/unit/cli/default.test.ts --runInBand
npx tsc --noEmit
```

Expected: all focused tests pass and TypeScript exits `0`.

- [ ] **Step 5: Inspect scope and commit Task 4**

Run `git status --short` and verify no config/provider/MCP/package files are
staged.

```bash
git add src/cli/commands/default.ts src/cli/index.ts tests/unit/cli/default.test.ts
git commit -m "feat: guide interactive aidoc startup"
```
