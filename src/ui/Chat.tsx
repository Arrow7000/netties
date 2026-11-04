import { For, Index, type JSX, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Try, Turn, TurnEnd } from "../create/chat";
import { TRIES } from "../create/client";
import type { Chat, Entry } from "./chatStore";
import { fingers } from "./compact";
import { closeOnEscape } from "./dismiss";
import * as I from "./icons";

/** Width of the panel on a desktop, which the canvas leaves room for. */
export const CHAT_WIDTH = 360;

/** The part of a reply that's words: the document is shown apart from it. */
const wordsOf = (reply: string) => reply.replace(/```[\s\S]*?(?:```|$)/g, "").trim();
/** How far along the document is, while it's being written. */
const linesWritten = (reply: string) => {
  const open = /```[^\n]*\n((?:(?!```)[\s\S])*)$/.exec(reply);
  return open ? open[1]!.split("\n").length - 1 : undefined;
};
const firstLine = (s: string) => s.split("\n")[0]!;
const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

/**
 * Keep a scrolling box at its end as what's in it grows. Scrolling up lets go;
 * scrolling back down to the end takes hold again.
 */
function anchored(el: HTMLElement, onChange?: (atEnd: boolean) => void) {
  let atEnd = true;
  const set = (v: boolean) => {
    if (v !== atEnd) onChange?.(v);
    atEnd = v;
  };
  /** Where following last left it: above that, someone has scrolled up, even if the browser hasn't said so yet. */
  let left = 0;
  const follow = () => {
    if (!atEnd) return;
    if (el.scrollTop < left - 1) return set(false);
    el.scrollTop = el.scrollHeight;
    left = el.scrollTop;
  };
  const onScroll = () => {
    set(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
    if (atEnd) left = el.scrollTop;
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  const changes = new MutationObserver(follow);
  changes.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open"] });
  const resizes = new ResizeObserver(follow);
  resizes.observe(el);
  onCleanup(() => {
    el.removeEventListener("scroll", onScroll);
    changes.disconnect();
    resizes.disconnect();
  });
  return {
    toEnd() {
      set(true);
      el.scrollTop = el.scrollHeight;
      left = el.scrollTop;
    },
  };
}

function inline(s: string): JSX.Element[] {
  return s.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((p) => (p.startsWith("`") && p.length > 2 ? <code>{p.slice(1, -1)}</code> : p.startsWith("**") && p.length > 4 ? <b>{p.slice(2, -2)}</b> : p));
}

/** Enough of Markdown for what models write: paragraphs, lists, bold and inline code. */
function Prose(props: { text: string }) {
  const blocks = createMemo(() => props.text.split(/\n{2,}/).filter((b) => b.trim()));
  return (
    <For each={blocks()}>
      {(b) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul>{lines.map((l) => <li>{inline(l.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
        if (lines.every((l) => /^\s*\d+\. /.test(l))) return <ol>{lines.map((l) => <li>{inline(l.replace(/^\s*\d+\. /, ""))}</li>)}</ol>;
        if (/^#+ /.test(b)) return <p><b>{b.replace(/^#+ /, "")}</b></p>;
        return <p>{inline(b)}</p>;
      }}
    </For>
  );
}

function TryView(props: { t: Try; n: number; last: boolean; turn: Turn; now: number }) {
  const going = () => props.last && props.turn.phase.kind !== "over";
  const thinking = () => going() && props.turn.phase.kind === "thinking";
  /** "Thinking" or "Try 2 of 3: thinking", and so on. */
  const doing = (what: string) => (props.turn.tries.length > 1 ? `Try ${props.n} of ${TRIES}: ${what}` : what[0]!.toUpperCase() + what.slice(1));
  const words = () => wordsOf(props.t.reply);
  const lines = () => (going() ? linesWritten(props.t.reply) : undefined);
  let trace: ReturnType<typeof anchored> | undefined;
  return (
    <>
      <Show when={props.t.thinking}>
        <details class="chat-thought" onToggle={(e) => e.currentTarget.open && trace?.toEnd()}>
          <summary classList={{ live: thinking() }}>{thinking() ? `${doing("thinking")}, ${seconds(props.now - (props.t.thoughtFrom ?? props.turn.since))}` : `Thought for ${seconds(props.t.thoughtMs ?? 0)}`}</summary>
          <div ref={(el) => (trace = anchored(el))}>{props.t.thinking}</div>
        </details>
      </Show>
      <Show when={words()}>
        <div class="chat-words">
          <Prose text={words()} />
        </div>
      </Show>
      <Show when={lines() !== undefined}>
        <div class="chat-status live">
          {doing("writing the document")}, {lines()} {lines() === 1 ? "line" : "lines"}
        </div>
      </Show>
      <Show when={props.t.problem && !(props.last && props.turn.phase.kind === "over")}>
        <details class="chat-problem">
          <summary>
            {props.turn.tries.length > 1 || !props.last ? `Try ${props.n}: ` : ""}
            {firstLine(props.t.problem!)}
          </summary>
          <pre class="chat-message">{props.t.problem}</pre>
          <Show when={props.t.code}>
            <pre>{props.t.code}</pre>
          </Show>
        </details>
      </Show>
    </>
  );
}

/** A reply's system: whether it's on the canvas now, and the way back to it. */
function ResultCard(props: { chat: Chat; end: Extract<TurnEnd, { kind: "ready" | "applied" }> }) {
  const [shown, setShown] = createSignal(false);
  const here = () => props.chat.onCanvas(props.end);
  let text!: HTMLPreElement;
  return (
    <div class="chat-result">
      <Show when={here()}>
        <div class="chat-here">
          <I.Check />
          On the canvas
        </div>
      </Show>
      <Show when={props.end.kind === "ready"}>
        <div class="chat-here">Goes on the canvas when you close what's open</div>
      </Show>
      <div>{props.end.summary}.</div>
      <Show when={props.end.note}>
        <div class="chat-note">{firstLine(props.end.note!)}</div>
      </Show>
      <div class="chat-doc">
        <details
          onToggle={(e) => {
            setShown(e.currentTarget.open);
            if (e.currentTarget.open) text.scrollIntoView({ block: "nearest" });
          }}
        >
          <summary>{shown() ? "Hide text" : "Show as text"}</summary>
          <pre ref={text}>{props.end.code}</pre>
        </details>
        <Show when={props.end.kind === "applied"}>
          <button class="btn chat-load" disabled={here()} onClick={() => props.chat.loadDocument(props.end.code)} title={here() ? "This is what's on the canvas" : "Replace what's on the canvas with this. You can undo it."}>
            Load
          </button>
        </Show>
      </div>
    </div>
  );
}

/** What was said, and the way to say something else instead. */
function UserView(props: { chat: Chat; entry: Extract<Entry, { kind: "user" }>; index: number }) {
  const [editing, setEditing] = createSignal(false);
  return (
    <Show
      when={editing()}
      fallback={
        <div class="chat-said">
          <div class="chat-user">{props.entry.text}</div>
          <Show when={props.entry.at}>
            <button class="chat-edit" onClick={() => setEditing(true)} title="Change this message and send it again">
              Edit
            </button>
          </Show>
        </div>
      }
    >
      <EditBox
        text={props.entry.text}
        onCancel={() => setEditing(false)}
        onSend={(text) => {
          setEditing(false);
          void props.chat.edit(props.index, text);
        }}
      />
    </Show>
  );
}

function EditBox(props: { text: string; onCancel: () => void; onSend: (text: string) => void }) {
  const [text, setText] = createSignal(props.text);
  let area!: HTMLTextAreaElement;
  const size = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight + 2, 200)}px`;
  };
  const send = () => text().trim() && props.onSend(text().trim());
  closeOnEscape(() => props.onCancel(), true);
  onMount(() => {
    size();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
  return (
    <div class="chat-editing">
      <textarea
        ref={area}
        class="input"
        aria-label="Edit your message"
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          size();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !fingers()) {
            e.preventDefault();
            send();
          }
        }}
      />
      <p class="chat-note">Sending this removes everything after it and puts the net back as it was then.</p>
      <div class="chat-editing-actions">
        <button class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button class="btn primary" disabled={!text().trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

/** How a turn stands, under what it has said. */
function TurnStatus(props: { chat: Chat; index: number; turn: Turn; now: number }) {
  return (
    <Show when={props.turn.phase.kind === "over" ? (props.turn.phase as Extract<Turn["phase"], { kind: "over" }>).end : undefined} keyed fallback={<Show when={props.turn.phase.kind === "waiting"}><div class="chat-status live">{props.turn.tries.length > 1 ? `Try ${props.turn.tries.length} of ${TRIES}: asking` : "Asking the model"}, {seconds(props.now - props.turn.since)}</div></Show>}>
      {(end) => {
        switch (end.kind) {
          case "said":
            return null;
          case "stopped":
            return <div class="chat-status">{end.by === "message" ? "Interrupted by your next message." : end.by === "reload" ? "Cut off by a reload. The canvas hasn't changed." : "Stopped. The canvas hasn't changed."}</div>;
          case "failed":
            return (
              <div class="chat-status bad">
                {end.message}
                <button class="btn chat-again" onClick={() => props.chat.retry(props.index)}>
                  Try again
                </button>
              </div>
            );
          case "gave-up":
            return (
              <div class="chat-result bad">
                <div>Three tries, and none passed the checks, so the canvas hasn't changed.</div>
                <button class="btn chat-again" onClick={() => props.chat.retry(props.index)}>
                  Try again
                </button>
                <details>
                  <summary>{firstLine(end.feedback)}</summary>
                  <pre class="chat-message">{end.feedback}</pre>
                  <Show when={end.code}>
                    <pre>{end.code}</pre>
                  </Show>
                </details>
              </div>
            );
          case "ready":
          case "applied":
            return <ResultCard chat={props.chat} end={end} />;
        }
      }}
    </Show>
  );
}

function EntryView(props: { chat: Chat; entry: Entry; index: number; now: number }) {
  return (
    <Show when={props.entry.kind === "turn" ? (props.entry as Extract<Entry, { kind: "turn" }>).turn : undefined} fallback={<UserView chat={props.chat} entry={props.entry as Extract<Entry, { kind: "user" }>} index={props.index} />}>
      {(turn) => (
        <div class="chat-turn">
          <Index each={turn().tries}>{(t, i) => <TryView t={t()} n={i + 1} last={i === turn().tries.length - 1} turn={turn()} now={props.now} />}</Index>
          <TurnStatus chat={props.chat} index={props.index} turn={turn()} now={props.now} />
        </div>
      )}
    </Show>
  );
}

/** The chat, beside the net on a desktop and in the lower part of a phone's screen. */
export function ChatPanel(props: { chat: Chat; onEscape: () => void }) {
  const chat = props.chat;
  let log!: HTMLDivElement;
  let area!: HTMLTextAreaElement;
  let panel!: HTMLDivElement;
  const [now, setNow] = createSignal(Date.now());
  const [atEnd, setAtEnd] = createSignal(true);
  let following: ReturnType<typeof anchored> | undefined;

  closeOnEscape(() => props.onEscape());

  /** Back to the box after a button, but not on a phone, where that brings up the keyboard. */
  const refocus = () => {
    if (!fingers()) area.focus();
  };

  onMount(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(tick));
    if (!fingers()) area.focus();
    following = anchored(log, setAtEnd);
    following.toEnd();
    size();
    // A phone's keyboard covers the page rather than shrinking it: stay above it.
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => panel.style.setProperty("--chat-keyboard", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
      vv.addEventListener("resize", fit);
      vv.addEventListener("scroll", fit);
      onCleanup(() => {
        vv.removeEventListener("resize", fit);
        vv.removeEventListener("scroll", fit);
      });
    }
  });

  const size = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight + 2, 140)}px`;
  };

  const submit = () => {
    const text = chat.draft().trim();
    if (!text) return;
    chat.setDraft("");
    area.value = "";
    size();
    following?.toEnd();
    void chat.send(text);
  };

  return (
    <div
      class="chat"
      ref={panel}
      role="complementary"
      aria-label="Chat"
      // So a click anywhere in it keeps the keyboard here, not on the canvas.
      tabindex={-1}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !(e.target as Element).closest("textarea")) {
          e.preventDefault();
          getSelection()?.selectAllChildren(log);
        }
      }}
    >
      <header class="chat-head">
        <h2>Chat</h2>
        <button class="btn" onClick={() => (chat.reset(), refocus())} disabled={!chat.entries().length} title="Start a new conversation">
          New chat
        </button>
        <button class="btn icon" onClick={() => chat.setOpen(false)} title="Close" aria-label="Close">
          <I.Close />
        </button>
      </header>
      <div class="chat-log-wrap">
        <div class="chat-log" ref={log}>
          <Show when={chat.entries().length} fallback={<p class="chat-empty">Describe a system, ask for a change to the one on the canvas, or ask how something works.</p>}>
            <Index each={chat.entries()}>{(e, i) => <EntryView chat={chat} entry={e()} index={i} now={now()} />}</Index>
          </Show>
        </div>
        <Show when={!atEnd()}>
          <button class="btn chat-latest" onClick={() => following?.toEnd()} title="Back to the latest">
            Latest
          </button>
        </Show>
      </div>
      <form
        class="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={area}
          class="input"
          rows={1}
          placeholder="Message"
          aria-label="Message"
          value={chat.draft()}
          onInput={(e) => {
            chat.setDraft(e.currentTarget.value);
            size();
          }}
          onKeyDown={(e) => {
            // On a touch keyboard, Enter is the only way to a new line.
            if (e.key === "Enter" && !e.shiftKey && !fingers()) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Show when={chat.busy()}>
          <button type="button" class="btn icon" onClick={() => (chat.stop(), refocus())} title="Stop" aria-label="Stop">
            <I.Stop />
          </button>
        </Show>
        <button type="submit" class="btn icon primary" disabled={!chat.draft().trim()} title={chat.busy() ? "Stop this reply and send" : "Send"} aria-label="Send">
          <I.Send />
        </button>
      </form>
    </div>
  );
}
