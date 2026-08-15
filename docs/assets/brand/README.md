# Semantic Graphite

Semantic Graphite treats structure and negative space as the primary language of a serious documentation system. Forms should make relationships legible before words arrive. The mark and every composition should feel like a carefully ordered page with room for its syntax to breathe.

Graphite surfaces carry soft-white document geometry, giving the system a material sense of paper held inside a dark developer workspace. Cyan is reserved for AST analysis and navigation, green for validated states, and amber only for warnings. Color is signal, never ornament.

Repeated nodes, connectors, and exact grid rhythm encode semantic structure rather than decoration. Alignments should reveal how a change moves through code, impact planning, and documentation. Scale and spacing should be deliberate enough that the eye can follow the system without a legend.

Typography is sparse system monospace and subordinate to form. Labels act as quiet anchors while geometry, hierarchy, and negative space carry the meaning. Composition stays calm, balanced, and generous so the artifact remains useful in a repository, an avatar, or a narrow crop.

Every alignment and export must look meticulously crafted, repeatedly refined, and master-level precise. The final identity should feel labored over by a practitioner with deep expertise, with no convenient flourish left unexamined. Precision is the personality.

## Usage rules

- Palette: background `#0D1117`, surface `#161B22`, text `#F0F6FC`, secondary `#8B949E`, analysis `#58A6FF`, validated `#3FB950`, warning `#D29922`.
- Alt text: `AiDoc mark: a document page connected to four semantic nodes.`
- Clear space: reserve one node diameter, 8 viewBox units, around the 64-unit mark on every side.
- Minimum size: use the mark at 32-pixel minimum when it is a standalone identifier.
- Dark use: place `aidoc-mark-on-dark.svg` or `aidoc-mark-dark.png` on graphite surfaces such as `#0D1117` or `#161B22`.
- Light use: place `aidoc-mark-on-light.svg` or `aidoc-mark-light.png` on a white surface when a light GitHub or document context needs stronger contrast.
- Wordmark: use `aidoc-wordmark.svg` for horizontal repository and storefront placements. Keep the label plain and let the mark carry the semantic detail.
- Semantic color: cyan indicates AST analysis or navigation, green indicates a validated state, and amber indicates a warning only.
- Accessibility: preserve the title and description in the SVG sources, provide the alt text above for rendered images, and do not rely on color alone to communicate state.
- Original design: these assets are repository-owned original work and must not include a third-party logo, remote font, remote image, or borrowed brand shape.
- Typography: use the system monospace stacks declared by the wordmark and keep text sparse, legible, and subordinate to the geometry.

The source SVGs are the canonical assets. PNGs are fixed exports for platforms that need raster artwork. Re-export from the source SVG when dimensions or theme treatment change. Do not patch PNG bytes or add decorative metrics, graphs without data, robots, wands, sparkles, or provider marks.
