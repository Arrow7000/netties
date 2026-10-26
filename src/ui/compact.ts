import { createRoot, createSignal } from "solid-js";

/**
 * Phones, upright or sideways: too narrow for the palette, or too short for
 * the desktop bars. styles.css has the same query, written out.
 */
export const COMPACT = "(max-width: 760px), (max-height: 500px)";

/** Whether the compact layout is showing. It follows rotation and resizing. */
export const compact = createRoot(() => {
  if (typeof matchMedia === "undefined") return () => false;
  const mq = matchMedia(COMPACT);
  const [on, setOn] = createSignal(mq.matches);
  mq.addEventListener("change", (e) => setOn(e.matches));
  return on;
});

/**
 * Whether the last pointer pressed was a finger (or pen) rather than a
 * mouse, so hints can say "tap" instead of "click". Decided per press, not
 * per device: an iPad may have a trackpad too.
 */
export const fingers = createRoot(() => {
  const [on, setOn] = createSignal(typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", (e) => setOn(e.pointerType !== "mouse"), { capture: true, passive: true });
  }
  return on;
});
