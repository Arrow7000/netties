import { onCleanup, onMount } from "solid-js";
import "./escape"; // a drag in progress hears Escape before any panel does

/** How far the pointer may move and still count as a click rather than a pan or a drag. */
const CLICK_SLOP = 5;

/** Floating things that belong to whatever opened them: a click in one isn't a click outside. The phone's action sheets and their scrims are too. */
const ATTACHED = ".popover, .menu, .toast, .action-sheet, .action-sheet-scrim";

/**
 * Whatever is open that Escape closes: panels, popovers and menus, the one
 * opened last on top. Escape goes to the top one only, so a popover inside a
 * panel closes before the panel does.
 */
type Layer = {
  escape: () => void;
  /** Close even when Escape is pressed in a text field; otherwise the field is left first. */
  fromFields?: boolean;
};
const layers: Layer[] = [];

/** While mounted, Escape calls `escape` when this is the topmost thing open. */
export function closeOnEscape(escape: () => void, fromFields = false) {
  const layer: Layer = { escape, fromFields };
  layers.push(layer);
  onCleanup(() => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  });
}

// Installed when first imported, after escape.ts's drag cancelling and before the screens' own keyboard listeners.
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      const top = layers[layers.length - 1];
      if (e.key !== "Escape" || !top) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const field = (e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]");
      if (field && !top.fromFields) (field as HTMLElement).blur();
      else top.escape();
    },
    true,
  );
}

/**
 * Close a panel when the user clicks outside it or presses Escape. Pans,
 * drags and wheel zooms on the canvas leave it open, and a panel holding
 * unsaved changes stays open whatever happens (`onBlocked` hears about the
 * click or key). Clicks on `also` count as inside. `escape` replaces what
 * Escape does, for a panel that has other things to let go of first.
 */
export function dismissOnClickOutside(
  el: () => HTMLElement | undefined,
  onClose: () => void,
  dirty?: () => boolean,
  onBlocked?: () => void,
  also?: string,
  escape?: () => void,
) {
  const tryClose = () => {
    if (!dirty?.()) onClose();
    else onBlocked?.();
  };
  closeOnEscape(escape ?? tryClose);
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
      tryClose();
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
    });
  });
}
