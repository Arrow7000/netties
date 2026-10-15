import { For, onMount } from "solid-js";
import type { Polarity } from "../core/types";

/**
 * A direction on its own, for when there's no port or wire to point an
 * arrow at: a port's circle with a line from it, and an arrowhead moving
 * along the line, out from the circle for giving and in towards it for
 * taking. (A fount and a drain were tried first, from the user's drawings,
 * and didn't read well at icon size: `src/dev/fountDrain.tsx`.)
 *
 * It loops, every icon on one clock, so one that's drawn again (a panel
 * re-rendering) carries on where it was instead of starting over. Under
 * reduced motion, or with `playing` false, the head stands still where the
 * old static badge put it.
 */
export function PolarityIcon(props: { pol: Polarity; playing?: boolean; class?: string }) {
  let svg!: SVGSVGElement;
  onMount(() => {
    if (STILL) return;
    // An outermost <svg> keeps its own animation clock; set it to the shared one.
    const sync = () => (svg.isConnected ? svg.setCurrentTime((performance.now() / 1000) % (DUR * 1000)) : requestAnimationFrame(sync));
    sync();
  });
  const moving = () => !STILL && props.playing !== false;
  const give = () => props.pol === "give";
  return (
    <svg ref={svg} class={`pol-icon ${props.pol} ${props.class ?? ""}`} viewBox="0 0 26 10" aria-hidden="true">
      <circle class="port" cx={2.8} cy={5} r={2.2} />
      <path class="shaft" d="M5 5H24.5" />
      {/* The head drawn with its tip at 0,0, pointing the way it travels. */}
      <g transform={`translate(${give() ? HEAD.give.still : HEAD.take.still} 5)`}>
        <path class="head" d={give() ? "M0 0L-5.5 -3.4V3.4Z" : "M0 0L5.5 -3.4V3.4Z"} />
        {moving() && [
          <animateTransform
            attributeName="transform"
            type="translate"
            values={give() ? `${HEAD.give.from} 5;${HEAD.give.to} 5` : `${HEAD.take.from} 5;${HEAD.take.to} 5`}
            dur={`${DUR}s`}
            repeatCount="indefinite"
          />,
          // Comes in gently and goes at the end of the line, out of the icon or into the port.
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur={`${DUR}s`} repeatCount="indefinite" />,
        ]}
      </g>
    </svg>
  );
}

const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const DUR = 1.6;
/** Where the head's tip runs along the line, and where it rests when still. */
const HEAD = {
  give: { from: 10, to: 25, still: 21 },
  take: { from: 19, to: 6, still: 5.5 },
};

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
