# netties

A playground for interaction nets and Lafont's interaction combinators, drawn
in the style of his figures.

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

## What it does

- The net fills the window. Drag agent types in from the palette on the
  right; click a type to edit it. The rule grid shows every pair of types,
  whether it has a rule, and whether it's in the net now; click a cell to
  draw its rule.
- Drag from an empty port to draw a wire, or from a wired port to unplug
  that end and move it. The wire being dragged is routed like the real one;
  wired ports refuse a drop; letting go on the canvas leaves a loose end (a
  free port). Left-drag selects, middle- or right-drag or space-drag pans.
- Click an active pair to fire it (Alt-click selects its wire instead), step
  every pair at once, or run, at any speed down to slow motion. Steps and
  edits animate as rewiring. Hovering over a pair whose rule only
  reconnects wires shows the joins it will make.
- A hover panel says what's under the pointer and what a click or drag will
  do; a selection panel holds the actions for what's selected.
- Auto layout in Lafont's style, or manual placement with automatic wires.
- Components: make one from a selection; instances collapse to boxes, nest,
  update when the component is edited, and dissolve when anything inside
  them interacts.
- The combinator translation turns the net and its system into γ, δ, ε
  using Lafont's universality construction (general case, or the restricted
  code-free case where it applies), and follows the source step by step.
- Text import/export in an Inpla-like syntax; SVG export; share links.

The redesign started from clickable prototypes in `design/prototypes` and
the brief in `design/brief.md`.

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
