import { onCleanup, onMount } from "solid-js";

/** How far the pointer may move and still count as a click rather than a pan or a drag. */
const CLICK_SLOP = 5;

/** Floating things that belong to whatever opened them: a click in one isn't a click outside. */
const ATTACHED = ".popover, .menu, .toast";

/**
 * Close a panel when the user clicks outside it. Pans, drags and wheel
 * zooms on the canvas leave it open, and a panel holding unsaved changes
 * stays open whatever happens (`onBlocked` hears about the click). Clicks
 * on `also` count as inside.
 */
export function dismissOnClickOutside(
  el: () => HTMLElement | undefined,
  onClose: () => void,
  dirty?: () => boolean,
  onBlocked?: () => void,
  also?: string,
) {
  onMount(() => {
    let down: { x: number; y: number } | undefined;
    const outside = (t: EventTarget | null) => {
      const node = t as Element | null;
      const panel = el();
      return !!panel && !!node && !panel.contains(node) && !node.closest?.(also ? `${ATTACHED}, ${also}` : ATTACHED);
    };
    const press = (e: PointerEvent) => {
      down = e.button === 0 && outside(e.target) ? { x: e.clientX, y: e.clientY } : undefined;
    };
    const release = (e: PointerEvent) => {
      const d = down;
      down = undefined;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
      if (!dirty?.()) onClose();
      else onBlocked?.();
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
    });
  });
}
