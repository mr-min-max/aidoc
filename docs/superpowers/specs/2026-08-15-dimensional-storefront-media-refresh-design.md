# Dimensional Storefront Media Refresh Design

**Status:** Approved in the maintainer review on 2026-08-15.

## Goal

Replace the flat legacy storefront media with one coherent visual system based
on the selected AiDoc repository avatar. The refreshed assets must make the
maintenance workflow understandable to a new reader while preserving every
truth and safety boundary already enforced by the beta.6 storefront tests.

## Approved visual system

All refreshed media uses the same four-part physical metaphor:

1. a satin graphite repository or worktree layer;
2. a cyan Git/history rail for deterministic code analysis;
3. warm-white documentation sheets produced from bounded context;
4. a green terminal node for validation and maintainer review.

The style is a polished three-dimensional product illustration with restrained
folded-paper corners, soft contact shadows, large readable typography, and only
graphite, warm white, cyan, green, and muted gray. It excludes robots, people,
provider logos, browser chrome, generic AI gradients, decorative sparkles,
unverified metrics, and dashboard-like collections of unrelated cards.

## Asset roles

### Social preview

The approved light `hero object` composition becomes the 1280 by 640 social
preview. It shows the before/after `createUser` change, `README.md`,
`docs/API.md`, a green validated node, the AiDoc wordmark, and the exact
storefront headline and three-step path.

### Static demo poster

The approved dark `developer tool` composition becomes the 1280 by 720 static
poster. Its existing dimensional code and document layers occupy the main
stage. A deterministic proof strip adds the exact boundaries `No provider
calls`, `No repository writes`, and `You decide what is applied` without
claiming that the illustration is a terminal capture.

### README animation

The approved person-free horizontal workflow becomes the shared scene for five
1280 by 720 animation frames. The camera and object geometry stay fixed while
the headline, focus treatment, progress counter, and cyan-to-green emphasis
advance through:

1. `Code changed`;
2. `Two docs affected`;
3. `Bounded draft`;
4. `Draft validated`;
5. `You review`.

The final GIF remains 960 by 540, loops indefinitely, lasts approximately 15
seconds, and stays understandable without sound. Every frame keeps its visible
text inside the established 64-pixel safe area and uses at least 28-pixel
source typography.

## Source and export model

The three approved high-resolution PNG compositions are repository-owned source
assets. The social preview and poster retain small SVG composition wrappers so
their crop, output canvas, accessibility description, exact copy contract, and
poster proof strip remain inspectable. The five animation SVGs reference one
local repository-owned scene PNG and add deterministic vector focus and text
layers. SVG safety checks allow only those exact local PNG references and
continue to reject scripts, remote resources, event handlers, and unsafe SVG
features.

Final PNG and GIF exports are derived locally from these tracked sources. The
existing final-size and performance budgets remain unchanged:

- social preview: 1280 by 640 and no more than 1.5 MiB;
- static poster: 1280 by 720 and no more than 500 KiB;
- README GIF: 960 by 540, approximately 15 seconds, and no more than 6 MiB.

## Truth and safety contract

The refreshed media continues to state only the canonical provider-free demo:

- `createUser(email)` becomes `createUser(email, role)`;
- the affected targets are `README.md` and `docs/API.md`;
- AiDoc prepares bounded context and validates a host draft;
- there are no provider calls and no repository writes in the deterministic
  demo;
- the maintainer decides what is applied.

No asset may expose a private path, credential, raw digest, personal account,
third-party logo, synthetic adoption claim, or Unicode em dash. The release
state does not change: beta.6 remains an unpublished local candidate, and this
refresh performs no push, pull request, tag, GitHub upload, or npm publication.

## Acceptance

Acceptance requires focused RED/GREEN asset tests, preflight source-artifact
coverage, exact dimension and budget probes, XML validation, GIF timing and
loop inspection, README-width visual review of the first/middle/last frames,
the complete storefront suite, TypeScript checking, formatting, and the full
release verification command.
