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

/**
 * The page's height without the keyboard, given what it was and how it is now. On
 * a touch screen, a page getting shorter at the same width is the keyboard, as some
 * browsers make room for it that way. Anything else is the window really changing.
 */
export const restingHeight = (was: { width: number; height: number }, width: number, height: number, touch: boolean) => (!touch || width !== was.width ? height : Math.max(was.height, height));

/** How much a page has to lose before that's a keyboard, rather than a browser's bar coming and going. */
const KEYBOARD_MIN = 120;

/**
 * What the screen has room for, kept on the root for styles.css: whether the phone
 * is on its side (data-sideways), whether the keyboard is up (data-keyboard), how
 * much it covers (--keyboard) and what's left to see (--visible). Media queries can't
 * tell the keyboard from a short screen: on the browsers that shrink the page for it,
 * an upright phone would look like one on its side as soon as a field is tapped.
 */
const room = createRoot(() => {
  const [isSideways, setSideways] = createSignal(false);
  if (typeof window === "undefined" || typeof document === "undefined") return { sideways: () => false, height: () => 0 };
  const root = document.documentElement;
  const touch = matchMedia("(pointer: coarse)");
  let rest = { width: innerWidth, height: innerHeight };
  const look = () => {
    rest = { width: innerWidth, height: restingHeight(rest, innerWidth, innerHeight, touch.matches) };
    const side = rest.height <= 500 && rest.width > rest.height;
    setSideways(side);
    root.toggleAttribute("data-sideways", side);
    const vv = window.visualViewport;
    // Zoomed in with a pinch, the visual viewport is smaller without anything being in the way.
    const seen = vv && Math.abs(vv.scale - 1) < 0.01 ? vv : undefined;
    root.toggleAttribute("data-keyboard", touch.matches && rest.height - (seen?.height ?? innerHeight) > KEYBOARD_MIN);
    root.style.setProperty("--visible", `${seen?.height ?? innerHeight}px`);
    root.style.setProperty("--keyboard", `${seen ? Math.max(0, innerHeight - seen.height - seen.offsetTop) : 0}px`);
  };
  look();
  window.addEventListener("resize", look);
  window.visualViewport?.addEventListener("resize", look);
  window.visualViewport?.addEventListener("scroll", look);
  return { sideways: isSideways, height: () => rest.height };
});

/** A phone on its side: short and wider than tall, going by its height without the keyboard. */
export const sideways = room.sideways;

/** The page's height without the keyboard. */
export const heightAtRest = room.height;
