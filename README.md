# netties

A playground for interaction nets and Lafont's interaction combinators, drawn
in the style of his figures.

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

## What it does

- Design agent types in the sidebar; draw rules graphically (click a pair
  under Rules, or click a stuck pair on the canvas).
- Wire nets by dragging between ports; drop a wire on the top or bottom edge
  for a free port. Fire an active pair by clicking it, step everything at
  once, or run. Steps animate as rewiring.
- Auto layout in Lafont's style, or manual placement with automatic wires.
- Components: select agents (shift-click / shift-drag) and make a component;
  instances collapse to boxes, nest, update when the component is edited,
  and dissolve when anything inside them interacts.
- "To combinators" translates the net and its system into γ, δ, ε using
  Lafont's universality construction (general case, or the restricted
  code-free case where it applies), and follows the source step by step.
- Text import/export in an Inpla-like syntax; SVG export; share links.

## Code

- `src/core`: nets, systems, reduction, components, the combinator
  translation, the text format. No UI code.
- `src/layout`: automatic placement and wire routing. Nets are split into
  trees by following principal ports; trees and active pairs become units,
  stacked in levels so facing wires meet as S-curves. The router draws the
  rest as caps, cups and side lanes.
- `src/anim`: step animation from the engine's wire lineage.
- `src/render`: SVG paths and standalone SVG export.
- `src/state`: the net model (shared by every canvas) and the editor store.
- `src/ui`: Solid components.

Aux ports are numbered clockwise from the principal port, as in Lafont's
papers, so rotating an agent keeps its port order and nets stay
planar-oriented.
