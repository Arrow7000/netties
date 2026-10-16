import { createRoot, createSignal } from "solid-js";
import { onThaw } from "./freeze";

/**
 * Modifier keys held right now, so the canvas can change what a click will
 * do (and show it) the moment a key goes down, not on the next mouse move.
 */
export const held = createRoot(() => {
  const [alt, setAlt] = createSignal(false);
  const sync = (e: KeyboardEvent | MouseEvent) => setAlt(e.altKey);
  onThaw(() => setAlt(false));
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

/** Apple keyboards say ⌘ and ⌥; everything else says Ctrl and Alt. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NAMES: Record<string, string> = { "⌃": "Ctrl", "⌘": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
const ORDER = ["Ctrl", "Alt", "Shift"];
const KEYS: Record<string, string> = { "↵": "Enter", "⌫": "Backspace" };

/**
 * Shortcuts in text, written the Mac way ("⇧⌘Z"), for this platform: as
 * written on a Mac, "Ctrl+Shift+Z" elsewhere.
 */
export function shortcuts(text: string): string {
  if (isMac) return text;
  return text.replace(/([⌃⌥⇧⌘]+)(\S)/g, (_, mods: string, key: string) => {
    const names = [...new Set([...mods].map((m) => NAMES[m]!))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    return [...names, KEYS[key] ?? key].join("+");
  });
}
