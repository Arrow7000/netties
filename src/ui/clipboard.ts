/**
 * Put text on the system clipboard, and say whether it worked. Browsers only
 * allow the async clipboard on https (or localhost), and refuse it while the
 * page isn't focused; then the older way, copying a selected hidden field,
 * often still works. A phone on the local network over plain http has no
 * async clipboard at all.
 */
export async function copyText(t: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && (typeof isSecureContext === "undefined" || isSecureContext)) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      // Fall through to the older way.
    }
  }
  return legacyCopy(t);
}

/** Copy text where the async clipboard isn't allowed: a selected, read-only field. */
function legacyCopy(t: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.setAttribute("readonly", "");
  Object.assign(ta.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, t.length);
  let done = false;
  try {
    done = document.execCommand("copy");
  } catch {
    // ignore
  }
  ta.remove();
  return done;
}
