import { For } from "solid-js";
import type { Polarity } from "../core/types";

/**
 * A direction on its own, for when there's no port or wire to point an
 * arrow at (the user's drawings, 2026-10-15). Giving is a pebble dropped in
 * a lake: rings leave the middle, thinning and fading as they go. Taking is
 * water down a drain: rings close in, turning and collapsing into a jagged
 * star. They loop slowly; under reduced motion they stand still, caught at
 * staggered moments, like the drawings.
 */
export function PolarityIcon(props: { pol: Polarity }) {
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <svg class="pol-icon" classList={{ [props.pol]: true }} viewBox="-12 -12 24 24" aria-hidden="true">
      {props.pol === "give" ? <Giving still={still} /> : <Taking still={still} />}
    </svg>
  );
}

const RINGS = 3;
const DUR = 2.7;

/** Rings from the stone's edge out to the rim. */
function Giving(props: { still: boolean }) {
  const from = 3.6;
  const to = 11.2;
  return (
    <>
      <circle r={from} stroke-width={1.8} />
      <For each={Array.from({ length: RINGS }, (_, i) => i)}>
        {(i) => {
          // Where this ring is in its journey when standing still.
          const t = (i + 0.5) / RINGS;
          const begin = `${(-i * DUR) / RINGS}s`;
          const anim = (attr: string, a: number, b: number) => (
            <animate attributeName={attr} values={`${a};${b}`} dur={`${DUR}s`} begin={begin} repeatCount="indefinite" />
          );
          return (
            <circle r={from + (to - from) * t} stroke-width={1.5 - 1.1 * t} opacity={1 - 0.75 * t}>
              {!props.still && [anim("r", from, to), anim("stroke-width", 1.5, 0.35), anim("opacity", 1, 0)]}
            </circle>
          );
        }}
      </For>
    </>
  );
}

/** A fixed rim, and rings inside it closing in. */
function Taking(props: { still: boolean }) {
  const frames = 18;
  const ts = Array.from({ length: frames + 1 }, (_, k) => k / frames);
  const values = ts.map(drain).join(";");
  return (
    <>
      <circle r={11.2} stroke-width={1} />
      <For each={Array.from({ length: RINGS }, (_, i) => i)}>
        {(i) => {
          const t = (i + 0.4) / RINGS;
          const begin = `${(-i * DUR) / RINGS}s`;
          return (
            <path d={drain(t)} stroke-width={1.2 + 0.5 * t} stroke-linejoin="round">
              {!props.still && [
                <animate attributeName="d" values={values} dur={`${DUR}s`} begin={begin} repeatCount="indefinite" />,
                <animate attributeName="stroke-width" values="1.2;1.7" dur={`${DUR}s`} begin={begin} repeatCount="indefinite" />,
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.12;0.82;1"
                  dur={`${DUR}s`}
                  begin={begin}
                  repeatCount="indefinite"
                />,
              ]}
            </path>
          );
        }}
      </For>
    </>
  );
}

/**
 * Uneven dents and tips, and a little slant to each point, so it collapses
 * lopsidedly like the drawing rather than into a regular star.
 */
const DENTS = [1, 0.65, 1.2, 0.8, 1.05];
const TIPS = [0.18, -0.12, 0.05, -0.2, 0.1];
const SLANT = [0.12, -0.08, 0.15, -0.1, 0.05, 0.1, -0.14, 0.06, -0.05, 0.09];
const POINTS = DENTS.length * 2;

/**
 * The draining ring at `t` (0 to 1): a circle just inside the rim at 0,
 * shrinking, turning and denting inward until it's a small jagged star.
 * Always the same number of curves, so the shapes in between interpolate.
 */
function drain(t: number): string {
  const radius = 10 - 8.4 * Math.pow(t, 0.85);
  const depth = 0.6 * Math.pow(t, 0.9);
  const turn = 1.1 * t;
  const pts = Array.from({ length: POINTS }, (_, i) => {
    const a = ((i + SLANT[i]! * t) / POINTS) * 2 * Math.PI + turn;
    const r = radius * (i % 2 ? 1 - depth * DENTS[(i - 1) / 2]! : 1 + depth * TIPS[i / 2]!);
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  // Catmull–Rom through the points; a smaller tension sharpens the corners as it drains.
  const k = (1 - 0.8 * t) / 6;
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 0; i < POINTS; i++) {
    const p0 = pts[(i - 1 + POINTS) % POINTS]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % POINTS]!;
    const p3 = pts[(i + 2) % POINTS]!;
    d += `C${f(p1.x + (p2.x - p0.x) * k)} ${f(p1.y + (p2.y - p0.y) * k)} ${f(p2.x - (p3.x - p1.x) * k)} ${f(p2.y - (p3.y - p1.y) * k)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + "Z";
}
