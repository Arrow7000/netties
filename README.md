# Netties

> An interactive playground for interaction nets and Lafont's interaction combinators.

Netties is a visual tool that lets you build, explore, and simulate interaction nets right in your browser. Since this is a full frontend application rather than a library, the best way to understand what it can do is to just try it out!

**[Play with Netties live! 🚀](https://netties.adler.dev/)**

![Netties demo](assets/netties-demo.gif)

## Development

Netties is built with [SolidJS](https://www.solidjs.com/) and powered by [Vite](https://vitejs.dev/).

To run it locally:

```sh
# Install dependencies
npm install

# Start the dev server (http://localhost:5173)
npm run dev

# Run tests
npm test
```

### Checking layouts

With the dev server running, open
[localhost:5173/layouts.html](http://localhost:5173/layouts.html): a gallery
of laid-out nets for checking placement and wire routing by eye. It shows
every example step by step and generated nets of growing size (trees in
pairs, random tangles, agents scattered as if placed by hand). Each drawing
has a label to point at, like `E3.2` (example 3 after two steps) or `T39`.
The generated nets are seeded, so a label always means the same net. Auto
and Manual switch between automatic layout's routing and manual mode's on
the same positions. Drawings that the routing checks
(`src/layout/routeCheck.ts`) fault are outlined; click one to see it large
with the wires at fault marked. The page is `src/dev/layouts.ts` and isn't
part of the production build.

For numbers instead of pictures:

```sh
# Count wires by agents and wires too close, over the examples and 300 hand-placed nets
npx vite-node scripts/route-check.ts

# Also write each problem drawing as an SVG (--all writes every example step)
npx vite-node scripts/route-check.ts --svg some/dir
```

## Codebase Tour

For those interested in how it works under the hood:

- `src/core` — The engine: nets, systems, reduction, port types, components, and the combinator translation.
- `src/layout` — Automatic placement and wire routing algorithms.
- `src/anim` — Step animation from the engine's wire lineage.
- `src/render` — SVG paths and standalone SVG export.
- `src/state` — The net model and the editor store.
- `src/ui` — SolidJS UI components.

## Archived TC formalization

The TC interaction-net Lean experiment is archived in
[`../boom/src/archive/triage`](../boom/src/archive/triage/README.md).
It is excluded from the default `boom` build. These commands explicitly
maintain the archive:

```sh
npm run formal:export  # regenerate its Lean rule table
npm run formal:check   # check the rule table and build TriageArchive
```

The current research target is a small universal interaction-net system with
native reflection of graph structure, including sharing. Its working brief
is in [`../boom/README.md`](../boom/README.md).
