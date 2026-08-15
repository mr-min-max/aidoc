# AiDoc Gate A1 Corrections and Visual Exploration Design

**Status:** Approved for implementation by the maintainer on 2026-08-15.

## Goal

Close the remaining Gate A1 gaps without changing AiDoc runtime, provider,
parser, MCP security, or release authentication behavior. The corrected
storefront must be understandable to a first-time visitor, technically
defensible to an OSS maintainer, and useful as evidence for a grant reviewer.

The work has two connected outcomes:

1. make every public claim reproducible and durable across the candidate and
   published package states;
2. improve the visual identity and animation without replacing evidence with
   decoration.

No push, pull request, tag, npm publication, GitHub Release, repository
metadata mutation, or social-preview upload belongs to this correction.

## Audience order

The storefront is designed in this order:

1. a visitor who does not know AiDoc or MCP terminology;
2. a maintainer evaluating whether the workflow is safe and useful;
3. a technical or grant reviewer checking whether the evidence supports the
   claims.

Plain-language outcomes therefore lead. Exact commands, tool names, and
no-write boundaries remain visible as supporting proof.

## Evidence corrections

### Canonical demo draft

The seeded fixture documents must contain the baseline signature
`createUser(email)`. The provider-free host draft must update that exact text
to `createUser(email, role)` for both `README.md` and `docs/API.md`.

AiDoc must prepare both targets, validate both exact candidates, and preserve
the repository snapshot before and after every MCP call. The existing v1 JSON
schema and nine check names remain stable. The approved MCP check may pass only
when both validated candidates contain the exact focused update.

This makes the visible documentation diff a rendering of demonstrated
behavior rather than an illustrative claim.

### Evergreen packaged README

The package README must not state that beta.6 is currently unpublished. That
sentence would become false inside the immutable beta.6 tarball immediately
after publication.

The README candidate notice instead states two durable facts:

- the source targets `0.2.0-beta.6`;
- `@beta` resolves to the currently published npm beta at install time, while
  the linked Public Beta guide records the verified release state.

Candidate-specific beta.5 and beta.6 facts remain in release documentation,
tests, and the pull-request evidence where they can later be updated without
making the packaged README false.

### Reproducible seeded demo

The public quick start must include the complete clean path:

```bash
git clone https://github.com/mr-min-max/aidoc.git
cd aidoc
npm ci
npm run demo:storefront
```

The command remains provider-free and performs no repository write. No private
setup step is required.

### Quality and accessibility

All changed tests must pass the repository ESLint command. The current mark
contains four visible semantic nodes, so every SVG description and brand
usage note must say four nodes until the maintainer selects a replacement.

## Visual philosophy: Proof Geometry

Proof Geometry treats a developer-tool identity as a compact piece of
evidence. Form should reveal a transition from source structure to reviewed
documentation before a label explains it. Empty space is active: it separates
input, transformation, validation, and human control with the precision of a
carefully reviewed diff.

Color is semantic rather than atmospheric. Graphite provides a quiet working
surface, cyan marks analysis or movement, and green appears only when a state
has been checked. The palette should feel engineered and restrained, with
painstaking calibration at both favicon and storefront scale.

Geometry must avoid the familiar collection of glowing AI nodes, sparkles,
robots, and generic neural-network clusters. Each concept uses a small number
of deliberate strokes, an asymmetric detail, and a silhouette that remains
recognizable without color. The work should look meticulously constructed by
an expert, not assembled from a stock symbol vocabulary.

Rhythm comes from before-and-after relationships: folds, brackets, paths, and
negative space. Typography stays secondary and system-native. Every alignment,
curve, and optical correction receives repeated refinement so the final mark
feels intentional rather than procedurally generated.

The quiet conceptual reference is a reviewed patch: one bounded change moves
through structure, becomes a documentation candidate, and reaches a validated
handoff without erasing human judgment. Someone familiar with code review
should feel that sequence even when the mark is shown without words.

## Logo exploration

Create three original vector concepts as temporary review artifacts. Do not
replace the canonical repository mark until the maintainer chooses a concept.

### A. Semantic Fold

A document fold becomes a single directional path. One cyan analysis segment
enters the page and one green validation terminal completes it. This is the
recommended balance of distinctiveness, immediate documentation meaning, and
small-size clarity.

### B. Diff Bracket

Two opposing code brackets create a page in negative space. A bounded cyan
change crosses the center and resolves into a green review point. This is the
most technical concept and the strongest reference to a focused diff.

### C. AD Ligature

A custom `A` and `D` ligature is constructed from a document edge and one AST
branch. It is the most ownable silhouette, but its product meaning is less
literal for a first-time visitor.

Each concept receives:

- one source SVG;
- dark and light 512-pixel PNG previews;
- 32-pixel previews;
- one 1536 by 720 comparison sheet with equal visual weight and no ranking
  metrics.

Concept artifacts remain outside Git until the maintainer selects one.

## Animation design

Keep five 1280 by 720 vector source frames and one 960 by 540, 15-second
infinite GIF. English remains the public language, but primary labels use
plain words and the picture carries the sequence without narration.

Every frame uses:

- an 80-pixel protected outer margin inside the existing 64-pixel contract;
- a persistent five-step progress rail;
- at least 28-pixel body text and 42-pixel headlines in the SVG source;
- no more than two short explanatory lines;
- one dominant visual action;
- no text or connector crossing a panel boundary;
- graphite, cyan, green, and amber only for their documented meanings.

### Frame 1: Code changed

Show the old and new function signatures. Highlight only the added `role`
parameter. Plain-language takeaway: one code contract changed.

### Frame 2: Two docs affected

Show a short analysis path from the changed function to `README.md` and
`docs/API.md`. Plain-language takeaway: AiDoc narrows the work to two files.

### Frame 3: Bounded draft

Show a compact context container and a host-owned draft. Keep
`prepare_documentation_update` as a small evidence label, not the headline.
Plain-language takeaway: only relevant context moves forward and no provider
call is required by AiDoc.

### Frame 4: Draft validated

Show the exact demonstrated documentation replacement in both targets, plus a
validation check. Keep `validate_documentation_draft` as a secondary evidence
label. Plain-language takeaway: the proposed text matches the prepared change.

### Frame 5: You review

Show the validated state stopping before a write boundary. Make `No repository
writes` and `You decide what is applied` visually dominant. Plain-language
takeaway: validation does not bypass maintainer review.

The final frame must transition cleanly back to the first graphite shell. The
static poster remains an equivalent reduced-motion fallback.

## Tests

Use TDD for every behavior correction.

Automated contracts must cover:

- exact baseline and candidate signature text in the real demo path;
- both targets validated and all repository snapshots unchanged;
- absence of the generic `Validated by the host` candidate;
- evergreen README wording and the complete clone/install/demo sequence;
- four-node accessibility truth across the current brand sources;
- animation source order, plain-language headlines, 80-pixel protected
  content placement, minimum font sizes, exact evidence labels, and factual
  no-write claims;
- GIF dimensions, duration, looping, and size budget;
- full ESLint, Jest, TypeScript, build, storefront, hybrid, MCP, package,
  plugin, public-beta, score, preflight, Prettier, and diff checks.

Visual review must cover README desktop and mobile widths, all five GIF frames,
the loop transition, social preview crop, 32-pixel marks, and all three concept
previews.

## Acceptance

The correction is ready for maintainer review when:

1. the complete local Gate A1 matrix is green;
2. the animation can be explained accurately in one sentence per frame;
3. every visible draft line was produced and validated by the deterministic
   demo;
4. the packed README remains truthful before and after beta.6 publication;
5. a clean reader can reproduce the demo from public commands;
6. three distinct logo concepts are visible side by side, while the tracked
   canonical mark remains unchanged pending selection;
7. the worktree is clean after one bounded corrective commit;
8. no external repository or registry state has changed.
