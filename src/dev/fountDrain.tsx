import { For, onMount } from "solid-js";
import type { Polarity } from "../core/types";

/**
 * Dev only, for comparing with the animated arrows on /polarity.html (the
 * app uses `src/ui/PolarityIcon.tsx`). Delete whichever the user doesn't pick.
 *
 * A direction on its own, for when there's no port or wire to point an
 * arrow at (the user's drawings, 2026-10-15). Giving is a pebble dropped in
 * a lake: rings leave the middle, thinning and fading as they go. Taking is
 * water down a drain: the rim creases inward and collapses, straight
 * towards the middle, into a star (not turning: that read as a flower,
 * the user said). Used wherever the app talks about giving and taking, so the
 * pictures are familiar by the time they matter.
 *
 * They loop slowly, all on one clock, so an icon that's drawn again (a
 * panel re-rendering) carries on where it was instead of starting over.
 * Under reduced motion, or with `playing` false, they stand still, caught
 * at staggered moments, like the drawings.
 */
export function FountDrainIcon(props: { pol: Polarity; playing?: boolean; class?: string }) {
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
// Two moving rings for giving: any more crowd together at icon sizes and read as plain circles.
const RINGS = 2;
const DUR = 2.7;
const RIM = 11;

/** Repeating forever, ring `i` of `n` its share of the loop in. */
const loop = (i: number, n = RINGS) => ({ dur: `${DUR}s`, begin: `${(-i * DUR) / n}s`, repeatCount: "indefinite" as const });

/** How many rays the fount sends out, and the band they fill outside its rings. */
const RAYS = 12;
const RAYS_FROM = 8.6;

/**
 * Rings from the stone's edge out to where the rays begin, and a ring of
 * short straight rays beyond, so that even standing still it reads as
 * something sending out, not just circles (the user's sketch, 2026-10-16).
 */
function Giving(props: { moving: boolean }) {
  const from = 2.2;
  // Moving, the rings have the whole icon; still, they make room for the rays.
  const to = () => (props.moving ? RIM : 7.4);
  return (
    <>
      <For each={props.moving ? [] : Array.from({ length: RAYS }, (_, i) => (i / RAYS) * 2 * Math.PI)}>
        {(a) => (
          <line
            x1={RAYS_FROM * Math.cos(a)}
            y1={RAYS_FROM * Math.sin(a)}
            x2={RIM * Math.cos(a)}
            y2={RIM * Math.sin(a)}
            stroke-width={1.1}
            stroke-linecap="round"
          />
        )}
      </For>
      <circle r={from} stroke-width={1.6} />
      <For each={Array.from({ length: RINGS }, (_, i) => i)}>
        {(i) => {
          // Where this ring is in its journey when standing still.
          const t = (i + 0.5) / RINGS;
          return (
            <circle r={from + (to() - from) * t} stroke-width={1.4 - 0.6 * t} opacity={1 - 0.6 * t}>
              {props.moving && [
                <animate attributeName="r" values={`${from};${to()}`} {...loop(i)} />,
                <animate attributeName="stroke-width" values="1.4;0.8" {...loop(i)} />,
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

/**
 * Rings that start as the rim and collapse: each creases inward as it
 * shrinks, straight towards the middle, until it's a small star.
 * Three, since the shapes differ enough not to blur together.
 */
function Taking(props: { moving: boolean }) {
  const rings = 3;
  const frames = 18;
  const values = Array.from({ length: frames + 1 }, (_, k) => drain(k / frames)).join(";");
  return (
    <For each={Array.from({ length: rings }, (_, i) => i)}>
      {(i) => {
        // The still frame: the rim, a creased ring, and the star, like the drawing.
        const t = [0, 0.4, 0.8][i]!;
        return (
          <path d={drain(t)} stroke-width={1.8 - 0.6 * t} stroke-linejoin="round">
            {props.moving && [
              <animate attributeName="d" values={values} {...loop(i, rings)} />,
              // Thinning as it shrinks, so the star stays open instead of clogging into a blob.
              // Thinning to nothing as it shrinks to nothing: it goes, rather than fading out.
              <animate attributeName="stroke-width" values="1.8;1.4;0" keyTimes="0;0.6;1" {...loop(i, rings)} />,
              // Faint at the rim, coming in slowly, so it feels ever-falling, like a
              // Shepard tone: a ring that popped in at the rim read as a pulse outward.
              // Coming in at the rim gently, but as a full circle before it starts to crease.
              <animate attributeName="opacity" values="0;1;1" keyTimes="0;0.25;1" {...loop(i, rings)} />,
            ]}
          </path>
        );
      }}
    </For>
  );
}

/**
 * The collapse is steered by control points evenly round the ring,
 * alternating creases, which sink, and the arms between them, which sink
 * much less, so the valleys fall in faster than the tips.
 */
const CREASES = 5;
const ARMS_SINK = 0.15;
const CONTROLS = CREASES * 2;
const ANGLES = Array.from({ length: CONTROLS }, (_, i) => (i / CONTROLS) * 2 * Math.PI - Math.PI / 2);
/** The ring is drawn through this many points, each at a fixed angle, so every one moves straight in. */
const SAMPLES = 60;

/**
 * The draining ring at `t` (0 to 1): a circle at the rim at 0, shrinking and
 * creasing inward until it's a small star. The same number of curves
 * at every `t`, so the shapes in between interpolate.
 */
function drain(t: number): string {
  const radius = RIM - 10.6 * Math.pow(t, 0.9);
  // A plain circle while it fades in at the rim, then creases that deepen as it goes down.
  const depth = 0.62 * Math.pow(Math.max(0, (t - 0.25) / 0.75), 0.8);
  const sink = (j: number) => (j % 2 ? 1 : ARMS_SINK);
  const pts = Array.from({ length: SAMPLES }, (_, n) => {
    const a = ANGLES[0]! + (n / SAMPLES) * 2 * Math.PI;
    // Between which two control points, and how far along.
    let j = 0;
    while (j < CONTROLS - 1 && ANGLES[j + 1]! <= a) j++;
    const from = ANGLES[j]!;
    const to = j < CONTROLS - 1 ? ANGLES[j + 1]! : ANGLES[0]! + 2 * Math.PI;
    const u = (a - from) / (to - from);
    // Eased while round, straight once it's a star, so the creases sharpen as it drains.
    const w = ((1 - Math.cos(Math.PI * u)) / 2) * (1 - t) + u * t;
    const r = radius * (1 - depth * (sink(j) + (sink(j + 1) - sink(j)) * w));
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  // Catmull–Rom through the points.
  const k = 1 / 6;
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 0; i < SAMPLES; i++) {
    const p0 = pts[(i - 1 + SAMPLES) % SAMPLES]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % SAMPLES]!;
    const p3 = pts[(i + 2) % SAMPLES]!;
    d += `C${f(p1.x + (p2.x - p0.x) * k)} ${f(p1.y + (p2.y - p0.y) * k)} ${f(p2.x - (p3.x - p1.x) * k)} ${f(p2.y - (p3.y - p1.y) * k)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d + "Z";
}

