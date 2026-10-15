import { For, onMount } from "solid-js";
import type { Polarity } from "../core/types";

/**
 * A direction on its own, for when there's no port or wire to point an
 * arrow at (the user's drawings, 2026-10-15). Giving is a pebble dropped in
 * a lake: rings leave the middle, thinning and fading as they go. Taking is
 * water down a drain: rings close in, turning and collapsing into a jagged
 * star. Used wherever the app talks about giving and taking, so the
 * pictures are familiar by the time they matter.
 *
 * They loop slowly, all on one clock, so an icon that's drawn again (a
 * panel re-rendering) carries on where it was instead of starting over.
 * Under reduced motion, or with `playing` false, they stand still, caught
 * at staggered moments, like the drawings.
 */
export function PolarityIcon(props: { pol: Polarity; playing?: boolean; class?: string }) {
  let svg!: SVGSVGElement;
  onMount(() => {
    if (STILL) return;
    // An outermost <svg> keeps its own animation clock; set it to the shared one.
    const sync = () => (svg.isConnected ? svg.setCurrentTime((performance.now() / 1000) % (DUR * 1000)) : requestAnimationFrame(sync));
    sync();
  });
  return (
    <svg ref={svg} class={`pol-icon ${props.pol} ${props.class ?? ""}`} viewBox="-12 -12 24 24" aria-hidden="true">
      <PolarityMark pol={props.pol} playing={props.playing} />
    </svg>
  );
}

/**
 * The drawing itself, centred on 0,0 and 24 across, for placing inside
 * another SVG (the canvas). There the canvas's own clock drives it, which
 * the negative begin times keep in phase across redraws.
 */
export function PolarityMark(props: { pol: Polarity; playing?: boolean }) {
  // Not playing, it's the still frame: rings caught at chosen moments, not wherever the loop had got to.
  const moving = () => !STILL && props.playing !== false;
  return <g class="pol-mark">{props.pol === "give" ? <Giving moving={moving()} /> : <Taking moving={moving()} />}</g>;
}

const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Two moving rings: any more crowd together at icon sizes and read as plain circles.
const RINGS = 2;
const DUR = 2.7;
const RIM = 11;

/** Repeating forever, this ring's share of the loop in. */
const loop = (i: number) => ({ dur: `${DUR}s`, begin: `${(-i * DUR) / RINGS}s`, repeatCount: "indefinite" as const });

/** Rings from the stone's edge out to the rim. */
function Giving(props: { moving: boolean }) {
  const from = 2.9;
  return (
    <>
      <circle r={from} stroke-width={2} />
      <For each={Array.from({ length: RINGS }, (_, i) => i)}>
        {(i) => {
          // Where this ring is in its journey when standing still.
          const t = (i + 0.5) / RINGS;
          return (
            <circle r={from + (RIM - from) * t} stroke-width={2 - 1 * t} opacity={1 - 0.6 * t}>
              {props.moving && [
                <animate attributeName="r" values={`${from};${RIM}`} {...loop(i)} />,
                <animate attributeName="stroke-width" values="2;1" {...loop(i)} />,
                // Clear for most of the way out, so the movement reads even when small.
                <animate attributeName="opacity" values="1;0.75;0" keyTimes="0;0.6;1" {...loop(i)} />,
              ]}
            </circle>
          );
        }}
      </For>
    </>
  );
}

/** A fixed rim, and rings inside it closing in. */
function Taking(props: { moving: boolean }) {
  const frames = 18;
  const values = Array.from({ length: frames + 1 }, (_, k) => drain(k / frames)).join(";");
  return (
    <>
      <circle r={RIM} stroke-width={1.5} />
      <For each={Array.from({ length: RINGS }, (_, i) => i)}>
        {(i) => {
          const t = (i + 0.35) / RINGS;
          return (
            // Thinning as it shrinks, so the star stays open instead of clogging into a blob.
            <path d={drain(t)} stroke-width={1.9 - 0.7 * t} stroke-linejoin="round">
              {props.moving && [
                <animate attributeName="d" values={values} {...loop(i)} />,
                <animate attributeName="stroke-width" values="1.9;1.2" {...loop(i)} />,
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" {...loop(i)} />,
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
  const radius = 9.2 - 6.8 * Math.pow(t, 0.85);
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

/** Text with each "give(s)" and "take(s)" led by its icon, for sentences that explain directions. */
export function DirWords(props: { text: string }) {
  return (
    <For each={props.text.split(/\b(gives?|takes?)\b/)}>
      {(part, i) =>
        i() % 2 ? (
          <span class="dir-word">
            <PolarityIcon pol={part.startsWith("give") ? "give" : "take"} />
            {part}
          </span>
        ) : (
          part
        )
      }
    </For>
  );
}

/** Two of the same direction side by side: the clash when both ends of a wire give, or both take. */
export const ClashIcons = (props: { pol: Polarity }) => (
  <span class="clash-icons">
    <PolarityIcon pol={props.pol} />
    <PolarityIcon pol={props.pol} />
  </span>
);
