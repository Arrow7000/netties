import { For, onMount } from "solid-js";
import type { Polarity } from "../core/types";

/**
 * A direction on its own, for when there's no port or wire to point an
 * arrow at (the user's drawings, 2026-10-15). Giving is a pebble dropped in
 * a lake: rings leave the middle, thinning and fading as they go. Taking is
 * water down a drain: the rim creases inward and collapses, straight
 * towards the middle, into a jagged star (not turning: that read as a
 * flower, the user said). Used wherever the app talks about giving and taking, so the
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

/** Repeating forever, ring `i` of `n` its share of the loop in. */
const loop = (i: number, n = RINGS) => ({ dur: `${DUR}s`, begin: `${(-i * DUR) / n}s`, repeatCount: "indefinite" as const });

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

/**
 * Rings that start as the rim and collapse: each creases inward as it
 * shrinks, straight towards the middle, until it's a small jagged star.
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
              <animate attributeName="stroke-width" values="1.8;1.2" {...loop(i, rings)} />,
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.85;1" {...loop(i, rings)} />,
            ]}
          </path>
        );
      }}
    </For>
  );
}

/**
 * The collapse is steered by ten control points round the ring, alternating
 * creases (which sink) and the arms between them (which mostly hold). How
 * far each crease sinks, how much each arm gives way, and each point's
 * angle off even spacing are all uneven, so it collapses lopsidedly like
 * the drawing rather than into a regular star.
 */
const DENTS = [1.15, 0.55, 1, 0.8, 1.2];
const TIPS = [0, 0.4, 0.12, 0.3, 0.2];
const SKEW = [0, 0.3, -0.25, 0.1, 0.35, -0.2, 0.15, 0.4, -0.3, 0.05];
const CONTROLS = DENTS.length * 2;
const ANGLES = Array.from({ length: CONTROLS }, (_, i) => ((i + SKEW[i]!) / CONTROLS) * 2 * Math.PI - 1.2);
/** The ring is drawn through this many points, each at a fixed angle, so every one moves straight in. */
const SAMPLES = 60;

/**
 * The draining ring at `t` (0 to 1): a circle at the rim at 0, shrinking and
 * creasing inward until it's a small jagged star. The same number of curves
 * at every `t`, so the shapes in between interpolate.
 */
function drain(t: number): string {
  const radius = RIM - 8.6 * Math.pow(t, 0.9);
  // Creases start shallow and deepen as it goes down.
  const depth = 0.62 * Math.pow(t, 0.8);
  const sink = (j: number) => {
    const i = j % CONTROLS;
    return i % 2 ? DENTS[(i - 1) / 2]! : TIPS[i / 2]!;
  };
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
