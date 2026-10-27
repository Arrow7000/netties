import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { closeOnEscape } from "./dismiss";
import { compact } from "./compact";
import { Close } from "./icons";

/**
 * Feedback goes to Netlify Forms, which emails each one on. The form named
 * here is also written out, hidden, in index.html: Netlify finds forms by
 * reading the built HTML, and this one is drawn by script.
 */
const FORM = "feedback";

/**
 * Whether to ask for feedback at all: the build's VITE_FEEDBACK is "on"
 * (in .env locally, in the site's environment variables on Netlify).
 */
export const FEEDBACK = import.meta.env.VITE_FEEDBACK === "on";

const DONE_KEY = "netties:feedback";
const ACTIVE_KEY = "netties:active";
/** Seconds of use, over all visits, before the nudge shows. */
const NUDGE_AFTER = 10 * 60;
/** Time since the last touch or key that still counts as using it. */
const IDLE = 60_000;

/** Send feedback, with a link to the net if wanted. Resolves to whether it went. */
async function send(fields: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ "form-name": FORM, ...fields }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The feedback form, over a scrim. `netLink` makes a link to the net as it is. */
export function FeedbackDialog(props: { netLink: () => Promise<string>; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [withNet, setWithNet] = createSignal(true);
  const [state, setState] = createSignal<"idle" | "sending" | "failed">("idle");
  let area!: HTMLTextAreaElement;

  closeOnEscape(props.onClose, true);
  onMount(() => area.focus());

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!message().trim() || state() === "sending") return;
    setState("sending");
    const ok = await send({
      message: message().trim(),
      email: email().trim(),
      net: withNet() ? await props.netLink() : "",
      device: `${compact() ? "phone layout" : "desktop layout"}; ${navigator.userAgent}`,
    });
    if (!ok) return setState("failed");
    markDone();
    props.onSent();
  };

  return (
    <div class="feedback-scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="feedback" role="dialog" aria-label="Send feedback" onSubmit={submit}>
        <h2>Send feedback</h2>
        <p class="muted">What's confusing, what's broken, what you'd like. It goes straight to me.</p>
        <textarea
          ref={area}
          class="input"
          rows={6}
          placeholder="Your feedback"
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit(e)}
        />
        <label class="field">
          <span>Your email, if you'd like a reply</span>
          <input class="input" type="email" autocomplete="email" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <label class="feedback-check">
          <input type="checkbox" checked={withNet()} onChange={(e) => setWithNet(e.currentTarget.checked)} />
          Include a link to the net I have open
        </label>
        <Show when={state() === "failed"}>
          <p class="feedback-error">Couldn't send it. Check your connection and try again.</p>
        </Show>
        <div class="feedback-actions">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={!message().trim() || state() === "sending"}>
            {state() === "sending" ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * A small card asking for feedback, once, after a while of use. Closing it or
 * sending feedback puts it away for good. `quiet` holds it back while
 * something else is open.
 */
export function FeedbackNudge(props: { quiet: () => boolean; onOpen: () => void }) {
  const [show, setShow] = createSignal(false);

  onMount(() => {
    if (isDone()) return;
    let active = Number(safeGet(ACTIVE_KEY)) || 0;
    let last = Date.now();
    const touched = () => (last = Date.now());
    const tick = setInterval(() => {
      if (document.hidden || Date.now() - last > IDLE) return;
      active += 5;
      safeSet(ACTIVE_KEY, String(active));
      if (active >= NUDGE_AFTER && !props.quiet() && !isDone()) {
        setShow(true);
        clearInterval(tick);
      }
    }, 5000);
    window.addEventListener("pointerdown", touched, { passive: true });
    window.addEventListener("keydown", touched);
    onCleanup(() => {
      clearInterval(tick);
      window.removeEventListener("pointerdown", touched);
      window.removeEventListener("keydown", touched);
    });
  });

  const dismiss = () => {
    markDone();
    setShow(false);
  };

  return (
    <Show when={show() && !props.quiet()}>
      <div class="feedback-nudge" role="status">
        <button
          class="feedback-nudge-ask"
          onClick={() => {
            dismiss();
            props.onOpen();
          }}
        >
          <b>How are you finding netties?</b>
          <span>Tell me what's confusing or broken →</span>
        </button>
        <button class="btn icon small" onClick={dismiss} title="Don't ask again" aria-label="Don't ask again">
          <Close />
        </button>
      </div>
    </Show>
  );
}

const isDone = () => safeGet(DONE_KEY) === "done";
const markDone = () => safeSet(DONE_KEY, "done");

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // ignore
  }
}
