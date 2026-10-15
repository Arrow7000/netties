# Notes for agents

## Checking layouts

With the dev server running (`npm run dev`), open
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
