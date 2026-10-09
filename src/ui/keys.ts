import { createRoot, createSignal } from "solid-js";

/**
 * Modifier keys held right now, so the canvas can change what a click will
 * do (and show it) the moment a key goes down, not on the next mouse move.
 */
export const held = createRoot(() => {
  const [alt, setAlt] = createSignal(false);
  const sync = (e: KeyboardEvent | MouseEvent) => setAlt(e.altKey);
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
      // Alt alone would focus the browser menu on some systems.
      if (e.key === "Alt") e.preventDefault();
      sync(e);
    });
    window.addEventListener("keyup", sync);
    window.addEventListener("pointermove", sync, { passive: true });
    window.addEventListener("blur", () => setAlt(false));
  }
  return { alt };
});
