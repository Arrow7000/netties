# netties

A playground for interaction nets and interaction combinators, drawn in the
style of Lafont's figures.

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

## Layout

- `src/core` — nets, agent types, rules, and reduction (one pair at a time or
  every active pair at once). No UI code.
- `src/layout` — automatic placement and wire routing. Nets are split into
  trees by following principal ports; trees and active pairs become units,
  stacked in levels so facing wires meet as S-curves. The router draws the
  rest as caps, cups and side lanes.
- `src/render` — SVG path generation and standalone SVG export.
- `src/state` — the editor store: history, saving, share links.
- `src/ui` — Solid components.

Aux ports are numbered clockwise from the principal port, so rotating an
agent keeps its port order and nets stay planar-oriented.
