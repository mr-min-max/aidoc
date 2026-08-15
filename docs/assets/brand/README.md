# Semantic Graphite

Semantic Graphite treats structure and negative space as the primary language of a serious documentation system. Forms should make relationships legible before words arrive. The mark and every composition should feel like a carefully ordered page with room for its syntax to breathe.

Graphite surfaces carry soft-white document geometry, giving the system a material sense of paper held inside a dark developer workspace. Cyan is reserved for AST analysis and navigation, green for validated states, and amber only for warnings. Color is signal, never ornament.

Repeated nodes, connectors, and exact grid rhythm encode semantic structure rather than decoration. Alignments should reveal how a change moves through code, impact planning, and documentation. Scale and spacing should be deliberate enough that the eye can follow the system without a legend.

Typography is sparse system monospace and subordinate to form. Labels act as quiet anchors while geometry, hierarchy, and negative space carry the meaning. Composition stays calm, balanced, and generous so the artifact remains useful in a repository, an avatar, or a narrow crop.

Every alignment and export must look meticulously crafted, repeatedly refined, and master-level precise. The final identity should feel labored over by a practitioner with deep expertise, with no convenient flourish left unexamined. Precision is the personality.

## Usage rules

- Palette: background `#0D1117`, surface `#161B22`, text `#F0F6FC`, secondary `#8B949E`, analysis `#58A6FF`, validated `#3FB950`, warning `#D29922`.
- Alt text: `AiDoc mark: a document page connected to four semantic nodes.`
- Avatar alt text: `AiDoc avatar: a numbered code document connected to a three-step repository graph.`
- Clear space: reserve one node diameter, 8 viewBox units, around the 64-unit mark on every side.
- Minimum size: use the mark at 32-pixel minimum when it is a standalone identifier.
- Dark use: place `aidoc-mark-on-dark.svg` or `aidoc-mark-dark.png` on graphite surfaces such as `#0D1117` or `#161B22`.
- Light use: place `aidoc-mark-on-light.svg` or `aidoc-mark-light.png` on a white surface when a light GitHub or document context needs stronger contrast.
- Wordmark: use `aidoc-wordmark.svg` for horizontal repository and storefront placements. Keep the label plain and let the mark carry the semantic detail.
- Repository avatar: use `aidoc-avatar.png` as the 512-pixel platform export. Preserve its square white canvas, graphite repository layer, numbered code page, AiDoc label, and green current-state indicator without recropping.
- Storefront imagery: use the dimensional code-to-docs system in the social preview, static poster, and README animation. Preserve the graphite repository layer, cyan history rail, warm-white document sheets, and green validated endpoint as one connected physical story.
- Raster sources: `aidoc-social-preview-source.png`, `aidoc-flow-poster-source.png`, and `aidoc-flow-scene.png` are the maintainer-approved high-resolution sources. Their neighboring SVG compositions define accessible descriptions, exact copy contracts, safe output canvases, and deterministic overlays; every image reference must remain local to this repository.
- Semantic color: cyan indicates AST analysis or navigation, green indicates a validated state, and amber indicates a warning only.
- Accessibility: preserve the title and description in the SVG sources, provide the alt text above for rendered images, and do not rely on color alone to communicate state.
- Original design: these assets are repository-owned original work and must not include a third-party logo, remote font, remote image, or borrowed brand shape.
- Typography: use the system monospace stacks declared by the wordmark and keep text sparse, legible, and subordinate to the geometry.

The source SVGs remain canonical for the scalable mark and wordmark. `aidoc-avatar-source.png` is the maintainer-selected 1254-pixel source for the repository avatar, and `aidoc-avatar.png` is its 512-pixel platform export. Re-export the avatar with `sips -s format png --resampleHeightWidth 512 512 docs/assets/brand/aidoc-avatar-source.png --out docs/assets/brand/aidoc-avatar.png`. Re-export storefront PNGs from their neighboring SVG compositions and tracked local raster sources. Do not patch PNG bytes or add decorative metrics, graphs without data, robots, people, wands, sparkles, or provider marks.
