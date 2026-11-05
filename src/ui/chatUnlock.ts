/**
 * Letting someone try the chat before it's out for everyone: `?chat=on` in the
 * address turns it on in that browser for good, and `?chat=off` turns it back off.
 * It's taken out of the address straight away, so that passing on a link to a net doesn't pass this on too.
 */

const KEY = "netties:chat-unlocked";

/** What a page's address says to do, and the address without it. */
export function readUnlock(search: string): { say?: "on" | "off"; search: string } {
  const params = new URLSearchParams(search);
  const said = params.get("chat");
  if (said !== "on" && said !== "off") return { search };
  params.delete("chat");
  const rest = params.toString();
  return { say: said, search: rest ? `?${rest}` : "" };
}

export function chatUnlocked(): boolean {
  try {
    const { say, search } = readUnlock(location.search);
    if (say === "on") localStorage.setItem(KEY, "1");
    if (say === "off") localStorage.removeItem(KEY);
    if (say) history.replaceState(history.state, "", `${location.pathname}${search}${location.hash}`);
    return localStorage.getItem(KEY) === "1";
  } catch {
    // No address or no storage: nothing has let this browser in.
    return false;
  }
}
