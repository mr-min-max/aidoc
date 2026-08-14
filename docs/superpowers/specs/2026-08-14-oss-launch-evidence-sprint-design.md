# AiDoc OSS Launch and Evidence Sprint Design

**Date:** 2026-08-14

**Status:** Approved in conversation, pending written-spec review

**Repository:** `mr-min-max/aidoc`

**Starting release:** `@mr-min-max/aidoc-gen@0.2.0-beta.5`

## 1. Objective

Turn the technically complete public beta into a product that a new maintainer
can understand, try, and evaluate without prior knowledge of AiDoc.

The sprint has three connected outcomes:

1. A clear GitHub storefront that explains the broad documentation benefit
   before introducing the AST, bounded-context, and Trust Gate details.
2. A reproducible demonstration that shows a real code change becoming a
   focused, reviewable documentation update.
3. Honest adoption evidence from unrelated public repositories, a clean-account
   onboarding run, and at least one independent tester.

The goal is not to imitate traction. The goal is to make AiDoc useful enough to
earn real usage and to make every future grant claim traceable to public
evidence.

## 2. Product Position

### 2.1 Primary user

The primary user is an open-source maintainer who uses Codex, Claude, or a
direct model provider and wants project documentation to stay aligned with code
changes.

The first screen must solve the user's immediate question:

> Can this help me create and update my project documentation?

The second layer must answer why AiDoc is more useful than a one-shot AI
documentation generator:

- it analyzes supported code through ASTs before model generation;
- it maps code changes to documentation targets;
- it prepares bounded, relevant context instead of broad repository dumps;
- it keeps generation and validation reviewable;
- it supports provider-free host workflows for Codex and Claude;
- it preserves explicit provider, billing, trust, and repository boundaries.

### 2.2 Core promise

The approved Russian meaning is:

> Документация, которая успевает за вашим кодом.

The public English headline is:

> Documentation that keeps up with your code.

The supporting copy is:

> AiDoc helps Codex, Claude, or your chosen model create and update READMEs,
> API docs, changelogs, and diagrams. It analyzes code changes first, finds the
> docs that need attention, then gives you a focused update to review.

This copy deliberately starts with the familiar outcome, then explains the
technical difference. The phrase "documentation preflight" may appear later as
a compact category description, but it must not be the main headline.

### 2.3 Repository description

Use this short GitHub description:

> AST-first documentation updates for Codex, Claude, and your own model. AiDoc
> finds affected docs, prepares bounded context, and keeps every change
> reviewable.

Recommended repository topics:

- `documentation`
- `documentation-generator`
- `developer-tools`
- `ast`
- `codex`
- `claude`
- `mcp`
- `readme`
- `typescript`
- `python`

The repository homepage should point to the public npm package until a real
documentation site exists. A placeholder website must not be created for this
sprint.

### 2.4 Market and grant rationale

Codex already presents documentation maintenance as a first-class use case.
Other documentation products also advertise repository-aware generation and
automated update workflows. AiDoc therefore cannot stand out by saying only
"AI documentation generator."

The defensible distinction is the complete path from semantic change analysis
to a bounded, reviewable update. This position is useful to maintainers and is
also relevant to the Codex for Open Source program because it demonstrates a
concrete Codex workflow, maintainer automation, release discipline, and public
OSS evidence.

The program does not publish a required testimonial count or a fixed number of
users. We will not invent either. The application should use exact evidence
available at submission time.

Reference pages:

- <https://learn.chatgpt.com/use-cases/update-documentation>
- <https://developers.openai.com/community/codex-for-oss>

## 3. Editorial Rules

Public copy must sound like a maintained developer tool, not an advertisement
assembled from generic AI phrases.

Required rules:

- lead with a concrete user result;
- use short sentences and ordinary words;
- explain technical terms when they first appear;
- use exact commands, versions, and boundaries;
- state limitations close to the relevant claim;
- prefer a real output or diff over an adjective;
- use `AiDoc` as the product name and `aidoc` for the CLI command;
- do not use the Unicode em dash character;
- do not decorate every section heading with emoji;
- do not describe the project as autonomous, hallucination-free, guaranteed,
  effortless, revolutionary, or production-ready;
- do not claim adoption, trust, or endorsement without attributable evidence;
- do not write testimonials for testers or ask testers to praise the project.

Energy is allowed. The README should feel confident and interested. Its
credibility must come from a visible workflow, exact evidence, and honest
limits.

## 4. Storefront Information Architecture

### 4.1 First screen

The visible first screen of the README contains only:

1. the AiDoc logo and product name;
2. a small `Public beta` label;
3. the approved headline;
4. the two-sentence supporting copy;
5. one two-line installation and launch block;
6. one short demonstration animation;
7. no more than four useful badges.

Recommended badges:

- npm beta version;
- CI status;
- MIT license;
- supported Node version.

The simplest first run is:

```bash
npm install -g @mr-min-max/aidoc-gen@beta
aidoc
```

The bare `aidoc` entry remains the recommended path because it can guide an
interactive user without requiring them to memorize the command surface. The
provider-free `aidoc plan` command remains visible in the first quick-start
section for users who want an explicit or non-interactive planning path.

The first screen must not contain provider tables, environment-variable lists,
all MCP tools, architecture details, grant language, or a wall of badges.

### 4.2 Three-step explanation

Immediately after the first screen, show the workflow in three steps:

1. **Analyze the change.** AiDoc compares supported code through ASTs.
2. **Focus the update.** AiDoc identifies affected documentation and prepares
   bounded context.
3. **Review before writing.** The model drafts the change, then AiDoc validates
   the result and presents a reviewable diff.

This section should use one compact diagram or three small visual cells. It
must remain understandable as plain text and on a narrow mobile screen.

The three-step path describes change-driven planning and update workflows.
Standalone README, API, changelog, diagram, and annotation commands retain
their documented behavior and must not be presented as if they all use the
same target-selection sequence.

### 4.3 README sequence

After the three-step explanation, use this order:

1. real demonstration;
2. what AiDoc can create or update;
3. why it is different from one-shot generation;
4. quick starts for Codex, provider-free planning, and direct providers;
5. safety and trust boundaries;
6. supported languages and known limits;
7. contribution and public-beta feedback links;
8. links to detailed provider, MCP, release, and security documents.

Detailed provider variables, Qwen regions, complete MCP tool reference, and
long architecture explanations stay in linked documents or lower sections.

### 4.4 Comparison language

AiDoc should not attack or name competitors in the README. The comparison is
between workflows:

| One-shot generation                      | AiDoc workflow                        |
| ---------------------------------------- | ------------------------------------- |
| Starts from a broad prompt               | Starts from AST-derived changes       |
| Rewrites whatever it is asked to rewrite | Maps changes to affected docs         |
| Context scope is left to the caller      | Prepares bounded context              |
| Output is the end of the flow            | Validation and review remain explicit |

The table must not imply that every alternative always behaves this way. Label
the first column as a workflow pattern, not a universal competitor claim.

## 5. Visual System and Assets

### 5.1 Direction

The visual system should look like a serious developer tool:

- graphite background;
- soft white text;
- cyan accent for analysis and navigation;
- calm green for validated states;
- restrained motion;
- generous whitespace;
- terminal and diff surfaces that resemble real output.

Avoid generic robots, magic wands, sparkles, purple AI gradients, fake product
screens, and decorative graphs without data.

Suggested palette:

- background: `#0D1117`;
- elevated surface: `#161B22`;
- primary text: `#F0F6FC`;
- secondary text: `#8B949E`;
- cyan accent: `#58A6FF`;
- validation green: `#3FB950`;
- warning amber: `#D29922`.

### 5.2 Logo

The mark combines a document page with a small AST node structure. It must be
recognizable at 32 pixels, work in one color, and avoid detailed illustration.

Required deliverables:

- a source SVG mark;
- a horizontal wordmark SVG;
- dark and light PNG exports;
- a square avatar export;
- alt text and a short usage note.

The mark must be original and must not imitate the GitHub, OpenAI, Anthropic,
or another product logo.

### 5.3 Social preview

Create a 1280 by 640 pixel preview containing:

- the logo and `AiDoc`;
- the line `Documentation that keeps up with your code.`;
- the three-step path `Code change`, `Impact plan`, `Reviewable docs update`;
- no provider logos;
- no unverified metrics.

Keep all critical content inside a central safe area so GitHub crops remain
legible. Store the source asset in the repository and upload the final PNG as
the GitHub social preview after visual review.

## 6. Demonstration Design

### 6.1 Canonical scenario

Use a small, purpose-built TypeScript repository with an existing README and
API document. The public function changes from:

```ts
createUser(email);
```

to:

```ts
createUser(email, role);
```

The demonstration shows:

1. the code signature change;
2. `aidoc plan` identifying the affected README and API documentation;
3. Codex receiving the bounded preparation from AiDoc;
4. only the relevant documentation sections changing;
5. AiDoc validating the draft;
6. the maintainer reviewing the final diff before any write.

The demo must use the provider-free host workflow. It must not contain API
keys, private paths, personal data, hidden setup, or paid-provider output.

### 6.2 Short animation

Create a silent 12 to 18 second loop for the README:

1. show the signature change;
2. run the impact plan;
3. highlight the two affected documents;
4. show the focused documentation diff;
5. end on a validated state.

The animation must remain readable when embedded at README width. Crop terminal
chrome, enlarge important text, remove idle time, and keep the tracked asset
small enough for a fast repository page load.

Provide a static poster and equivalent text summary beside the animation. The
README must remain complete when animation is disabled or unsupported.

Performance budgets:

- logo SVG: no more than 50 KiB;
- static demo poster: no more than 500 KiB;
- README animation: no more than 6 MiB;
- social-preview PNG: no more than 1.5 MiB.

### 6.3 Full walkthrough

Create a 60 to 90 second video with English captions:

- 0 to 10 seconds: the maintenance problem and code change;
- 10 to 25 seconds: installation and `aidoc plan`;
- 25 to 50 seconds: Codex host workflow and focused generation;
- 50 to 70 seconds: validation and reviewable diff;
- final seconds: public beta invitation and repository link.

Human narration is not required. ElevenLabs English narration is acceptable if
it improves clarity. If synthetic narration is used, disclose that fact in the
video description. Captions remain mandatory because many viewers watch muted.
Store the final caption text and a WebVTT file with the video-production
materials so the walkthrough remains searchable and editable.

The short animation is a launch requirement. The narrated walkthrough is a
polish item and must not delay the storefront if its editing is unfinished.

## 7. Five-Repository Evaluation

### 7.1 Purpose

The five-repository evaluation is technical compatibility evidence, not five
users and not five endorsements.

Select five unrelated public repositories before looking at AiDoc's result:

- at least two TypeScript or JavaScript repositories;
- at least two Python repositories;
- one additional supported-language or mixed repository;
- a mix of small and medium projects;
- a mix of documentation-rich and documentation-light projects;
- no repository controlled by the AiDoc maintainer;
- no target selected only because it already produces a favorable result.

Record each repository URL and exact commit SHA. If a repository is later
replaced for a valid compatibility reason, preserve and explain the original
result instead of silently removing it.

### 7.2 Safety protocol

For every target:

1. clone it into an isolated temporary directory;
2. use the published `0.2.0-beta.5` package, not unpublished local code;
3. select a real recent source-changing commit and its parent;
4. run the human and JSON impact-plan paths;
5. exercise the provider-free MCP prepare and validate path with a bounded
   deterministic draft;
6. compare complete repository snapshots before and after every dry run;
7. do not push, open a pull request, contact maintainers, or write to the
   original repository;
8. do not send repository content to a remote model during the compatibility
   matrix.

One external repository may receive a deeper Codex-hosted dry-run after the
matrix, still in a disposable clone and without writing or pushing. The
canonical demo repository remains the primary visual demonstration.

### 7.3 Recorded outcomes

Use four result classes:

- `pass`: the documented path works and the result is relevant;
- `degraded`: the path completes but important output needs improvement;
- `unsupported`: the repository falls outside a documented product boundary;
- `failed`: a supported path does not complete safely.

Record at least:

- setup result;
- plan result and affected target count;
- manual relevance notes;
- schema and path-safety result;
- no-write snapshot result;
- any error code;
- exact limitation or issue opened.

Publish the method and all five outcomes, including weak results. Repository
names may be listed because they are public test inputs, but the report must
state that inclusion does not imply maintainer endorsement.

The public report may include repository-relative paths, counts, commands, and
short factual observations. It must not republish source files, prompts,
generated documents, or substantial excerpts from a target repository.

Security, privacy, or unintended-write failures block public claims and require
a focused fix. Ordinary mapping weaknesses become honest issues and evidence
for the roadmap. A new beta release is created only if a real product blocker
requires code changes.

## 8. Onboarding and External Feedback

### 8.1 Maintainer clean-account run

The maintainer will repeat the public setup from a second account or clean Codex
configuration. This run is valuable because the maintainer has not yet used all
new host features from the public instructions.

It verifies:

- the public README is sufficient;
- authentication and local MCP setup do not depend on hidden state;
- the first successful plan is understandable;
- setup reversal is clear;
- the product does not require private instructions from this development
  conversation.

This is a clean-environment test, not an independent user or testimonial.
Any public summary removes account identifiers, login details, local paths,
screenshots of personal settings, and unrelated Codex history.

### 8.2 First independent tester

Ask one friend who can use a terminal to follow only the public instructions.
Give them one task:

> Install the beta, run the demo workflow, and note every point where you are
> unsure what to do next.

Do not guide the first attempt. Do not ask for a star, praise, a prepared quote,
or a positive outcome. Record:

- whether installation succeeds;
- time to the first useful plan;
- where the tester pauses or guesses;
- any privacy or trust concern;
- whether the final diff is understandable;
- what they expected but could not do.

Fix launch-blocking confusion. Convert product defects into focused issues.

### 8.3 Feedback publication

Use this order:

1. A real bug, confusing behavior, or missing instruction becomes a GitHub
   Issue written in the tester's own words where practical.
2. Private non-bug feedback may be summarized anonymously with explicit
   permission.
3. A short public case study is created only later, when real usage produced a
   concrete before-and-after result and the tester approves the exact wording.

Do not place friend testimonials in the initial hero section. Early generic
praise would look staged and would weaken trust. The strongest early social
proof is a resolved real issue plus a transparent five-repository report.

### 8.4 Later pilot growth

After the storefront is public, invite beta testing through the README and
existing GitHub channels. Aim for two additional independent users over time,
but do not block the storefront or grant preparation on reaching three users.

Count only distinct people who used the public product. A second maintainer
account, simulated sessions, automated agents, and repeated runs by one person
do not increase the user count.

## 9. Evidence Package

Create a small public evidence index that links to facts instead of repeating
marketing claims.

Expected evidence:

- npm beta package and exact version;
- GitHub prerelease and matching source;
- green CI and release-integrity checks;
- short reproducible demo;
- five-repository method and results;
- clean-account onboarding notes;
- independent tester issue or consented summary;
- security and trust boundaries;
- relevant roadmap issues;
- exact Codex integration documentation.

Grant or launch copy may say only what this index supports. Examples:

- acceptable after completion: `Evaluated on five unrelated public
repositories using a published protocol.`
- unacceptable: `Trusted by open-source maintainers.`
- acceptable after one tester: `One independent onboarding test identified and
helped resolve issue #N.`
- unacceptable: `Used by a growing community.`

No download number, star count, user count, or success percentage appears
without a timestamp and a reproducible source.

## 10. Scope and Delivery Gates

### 10.1 Phase A: storefront and reproducible demo

Repository-owned deliverables:

- logo and brand exports;
- social preview source and final image;
- progressive-disclosure README rewrite;
- canonical demo repository or fixture;
- short animation;
- full-video script, captions, and shot list;
- concise feedback invitation;
- semantic tests for factual documentation claims;
- repository description, topics, homepage, and community-profile review.

Gate A passes when a new reader can identify the outcome, install the beta,
understand the three-step workflow, and reproduce the demo without private
instructions.

### 10.2 Phase B: compatibility evidence

Deliverables:

- preregistered five-repository list and SHAs;
- isolated evaluation runner or exact command record;
- complete no-write checks;
- public methodology and results;
- issues for every supported-path defect;
- one deeper external-repository host dry-run if safe.

Gate B passes when the report includes all selected outcomes, not only passes,
and every run is reproducible without credentials or writes.

### 10.3 Phase C: human onboarding and evidence packaging

Deliverables:

- clean-account maintainer notes;
- one independent no-help onboarding run;
- real issue or consented anonymous summary;
- updated setup copy based on observed friction;
- public evidence index;
- factual grant-application evidence draft.

Gate C does not require a testimonial, three users, a star target, or a new
release.

Prepare the final grant application after Gate C or after equivalent public
evidence exists. Apply as an important emerging OSS workflow, not as a widely
adopted project unless real usage data supports that description.

### 10.4 Explicit non-goals

This sprint does not include:

- a large new product feature;
- `verify` or `explain` implementation;
- a documentation website;
- a stable `latest` release;
- a marketplace launch;
- paid advertising;
- manufactured issues, users, stars, or testimonials;
- a beta.6 release unless testing finds a code-level blocker;
- history rewriting or maintainer-identity changes.

## 11. Safety and Failure Handling

- Work begins from the current `origin/main` in an isolated branch.
- Demo and evaluation repositories are disposable clones with complete
  before-and-after snapshots.
- No evaluation command pushes, publishes, opens external pull requests, or
  writes to an original repository.
- Provider-free paths are preferred for public evidence.
- All screenshots and recordings are scanned for tokens, emails, private
  paths, terminal history, unrelated tabs, and personal notifications.
- Test fixtures use synthetic names and secrets only.
- Any accidental secret or personal-data exposure stops publication until the
  asset and its retained copies are removed.
- External repository failures are reported without blaming the target
  project.
- User quotes require approval of the exact final text and context.

## 12. Verification Contract

### 12.1 Repository checks

Before a storefront pull request:

- run the full Jest suite;
- run TypeScript compilation;
- run focused ESLint and Prettier checks;
- run `npm run verify:release` where the artifact scope changes;
- run semantic README and public-beta claim tests;
- verify every new internal link and media path;
- scan new public prose for the prohibited Unicode em dash character;
- inspect the packed package if package-visible files change;
- confirm the Git index and worktree contain only planned changes.

### 12.2 Visual checks

Review assets at desktop and mobile README widths. Confirm:

- the logo remains legible at 32 pixels;
- the headline and command appear before the fold;
- the animation is readable without sound;
- terminal text is large enough to read;
- color contrast remains clear;
- reduced-motion users still receive an equivalent static result;
- the social preview survives GitHub cropping;
- no private or synthetic evidence is presented as real.

### 12.3 Demo checks

The canonical run must start from a clean fixture and produce the same logical
result on repetition. Verify:

- exact code change;
- exact affected docs;
- bounded preparation;
- no provider credential requirement;
- validation result;
- final diff;
- unchanged repository state until explicit host approval;
- absence of secrets and local absolute paths from captured output.

### 12.4 Human checks

The maintainer and independent tester use the public README, not a private
script. Their notes preserve failed steps and confusion. Improvements are
verified through a second clean run before the evidence is summarized.

## 13. Responsibility Split

### 13.1 Codex-owned work

Codex prepares and verifies:

- repository copy, README structure, and detailed documentation links;
- original logo and social-preview candidates;
- the deterministic demo fixture, commands, and short animation;
- the long-video script, captions, and shot list;
- technical evaluation on five public repositories;
- result tables, evidence index, and factual grant-evidence draft;
- tests, privacy scans, links, pull requests, and review evidence.

Codex must not invent tester statements, approve its own public visual upload,
or count simulated usage as adoption.

### 13.2 Maintainer-owned work

The maintainer is responsible only for decisions that require personal identity
or human participation:

- approve the final logo, README presentation, and social preview;
- optionally record or generate the English narration;
- approve publication of externally hosted video assets;
- complete the clean-account onboarding run using the public instructions;
- invite one friend to an independent test;
- obtain consent before publishing any feedback or quote;
- review and submit any grant application under the maintainer's identity.

The maintainer does not need to find three users before launch and does not need
to write marketing copy, edit the demonstration, or conduct the five-repository
technical matrix.

## 14. Implementation Planning Boundary

This document defines the complete OSS launch and evidence program. Execution
must remain sequential:

1. plan and implement Phase A;
2. review the public storefront and demo;
3. plan and run Phase B against the approved Phase A surface;
4. complete Phase C with real people and observed results.

The first implementation plan covers Phase A only. Phase B repository choices
and exact probes are finalized after the storefront demo is stable. Phase C
cannot be fully scripted because it depends on honest human behavior.

This boundary prevents a large speculative implementation and keeps later
claims tied to the product that users actually see.
