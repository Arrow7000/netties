/**
 * Escape cancels whatever is being dragged, before anything else hears it:
 * the rule editor would close, and the main editor would clear the
 * selection. Anything that drags registers a canceller, which says whether
 * there was a drag to cancel.
 */
const cancellers = new Set<() => boolean>();

export function onEscapeCancels(cancel: () => boolean) {
  cancellers.add(cancel);
  return () => {
    cancellers.delete(cancel);
  };
}

// Installed when first imported, before the UI's own keyboard listeners.
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      let any = false;
      for (const cancel of cancellers) any = cancel() || any;
      if (!any) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
