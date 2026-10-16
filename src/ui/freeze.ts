import { createSignal } from "solid-js";

/** Pause interaction updates until Shift+F or Escape restores normal input. */
export function installFreeze(host: Window, thaw: () => void, changed: (frozen: boolean) => void = () => {}) {
  let frozen = false;
  const key = (event: Event) => {
    const e = event as KeyboardEvent;
    const editing = (e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])");
    const toggle = e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyF";
    if ((toggle && (!editing || frozen)) || (frozen && e.key === "Escape")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) {
        frozen = !frozen;
        changed(frozen);
        if (!frozen) thaw();
      }
    } else if (frozen) {
      // Leave OS/browser shortcuts, including screenshots, available.
      e.stopImmediatePropagation();
    }
  };
  const block = (e: Event) => {
    if (!frozen) return;
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const events = [
    "pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout",
    "pointerenter", "pointerleave", "lostpointercapture",
    "mousedown", "mousemove", "mouseup", "mouseover", "mouseout", "mouseenter", "mouseleave",
    "click", "dblclick", "contextmenu", "wheel", "blur", "focusout",
  ];
  host.addEventListener("keydown", key, true);
  host.addEventListener("keyup", block, true);
  for (const type of events) host.addEventListener(type, block, { capture: true, passive: false });
  return () => {
    host.removeEventListener("keydown", key, { capture: true });
    host.removeEventListener("keyup", block, { capture: true });
    for (const type of events) host.removeEventListener(type, block, { capture: true });
    if (frozen) {
      changed(false);
      thaw();
    }
  };
}

const thawHandlers = new Set<() => void>();
const [freezeState, setFreezeState] = createSignal(false);
export { freezeState };
export function onThaw(handler: () => void) {
  thawHandlers.add(handler);
  return () => { thawHandlers.delete(handler); };
}

// Install before the UI's keyboard and pointer listeners, including capture listeners.
if (import.meta.env.DEV && typeof window !== "undefined") {
  const dispose = installFreeze(window, () => {
    for (const handler of thawHandlers) handler();
  }, setFreezeState);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
