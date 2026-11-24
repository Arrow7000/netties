import { onCleanup, onMount } from "solid-js";

/** How many steps of tightening styles.css has for the bottom bar. */
const TIGHTEST = 6;

/**
 * Keeps the bottom bar within the window: while it doesn't fit, it gives up a
 * little more (data-tight, a list of the steps taken). It's measured, rather than
 * going by the window's width, as what's in the bar comes and goes.
 */
export function fitBar(bar: HTMLElement) {
  const fit = () => {
    let tight = "";
    bar.removeAttribute("data-tight");
    for (let n = 1; n <= TIGHTEST && spills(bar); n++) bar.setAttribute("data-tight", (tight = `${tight} ${n}`.trim()));
  };
  onMount(() => {
    const sizes = new ResizeObserver(fit);
    sizes.observe(bar);
    for (const island of bar.children) sizes.observe(island);
    onCleanup(() => sizes.disconnect());
  });
}

const spills = (bar: HTMLElement) => bar.lastElementChild!.getBoundingClientRect().right > bar.getBoundingClientRect().right + 0.5;
