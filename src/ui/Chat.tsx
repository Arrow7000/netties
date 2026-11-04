import { For, Index, type JSX, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Try, Turn } from "../create/chat";
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
const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

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
  return (
    <>
      <Show when={props.t.thinking}>
        <details class="chat-thought">
          <summary>{thinking() ? `${doing("thinking")}, ${seconds(props.now - props.turn.since)}` : "What it was thinking"}</summary>
          <div>{props.t.thinking}</div>
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

/** How a turn stands, under what it has said. */
function TurnStatus(props: { chat: Chat; index: number; turn: Turn; now: number }) {
  return (
    <Show when={props.turn.phase.kind === "over" ? (props.turn.phase as Extract<Turn["phase"], { kind: "over" }>).end : undefined} keyed fallback={<Show when={props.turn.phase.kind === "waiting"}><div class="chat-status live">{props.turn.tries.length > 1 ? `Try ${props.turn.tries.length} of ${TRIES}: asking` : "Asking the model"}, {seconds(props.now - props.turn.since)}</div></Show>}>
      {(end) => {
        switch (end.kind) {
          case "said":
            return null;
          case "stopped":
            return <div class="chat-status">Stopped. The canvas is as it was.</div>;
          case "failed":
            return <div class="chat-status bad">{end.message}</div>;
          case "gave-up":
            return (
              <div class="chat-result bad">
                <div>{TRIES} tries and netties still can't use the document, so the canvas is as it was.</div>
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
            return (
              <div class="chat-result" classList={{ note: !!end.note }}>
                <div class="chat-result-head">
                  <Show when={end.kind === "applied" && !end.undone} fallback={<span />}>
                    <I.Check />
                  </Show>
                  <span>{end.kind === "ready" ? "Ready for the canvas once you've closed what's open." : end.undone ? "Undone." : "On the canvas."} {end.summary}.</span>
                  <Show when={end.kind === "ready"}>
                    <button class="btn" onClick={() => props.chat.applyHeld(props.index)}>
                      Apply
                    </button>
                  </Show>
                  <Show when={end.kind === "applied" && props.chat.canUndo(props.index)}>
                    <button class="btn" onClick={() => props.chat.undo(props.index)}>
                      {end.kind === "applied" && end.undone ? "Redo" : "Undo"}
                    </button>
                  </Show>
                </div>
                <Show when={end.note}>
                  <div class="chat-note">{firstLine(end.note!)}</div>
                </Show>
                <div class="chat-doc">
                  <details>
                    <summary>Show the document</summary>
                    <pre>{end.code}</pre>
                  </details>
                  <button class="btn chat-load" onClick={() => props.chat.loadDocument(end.code)} title="Replace what's on the canvas with this document. You can undo it.">
                    Load
                  </button>
                </div>
              </div>
            );
        }
      }}
    </Show>
  );
}

function EntryView(props: { chat: Chat; entry: Entry; index: number; now: number }) {
  return (
    <Show when={props.entry.kind === "turn" ? (props.entry as Extract<Entry, { kind: "turn" }>).turn : undefined} fallback={<div class="chat-user">{(props.entry as Extract<Entry, { kind: "user" }>).text}</div>}>
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
  const [stuckToEnd, setStuckToEnd] = createSignal(true);

  closeOnEscape(() => props.onEscape());

  /** Back to the box after a button, but not on a phone, where that brings up the keyboard. */
  const refocus = () => {
    if (!fingers()) area.focus();
  };

  onMount(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(tick));
    if (!fingers()) area.focus();
    log.scrollTop = log.scrollHeight;
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

  // Follow the reply as it comes, unless someone has scrolled back to read.
  createEffect(() => {
    chat.entries();
    if (stuckToEnd()) log.scrollTop = log.scrollHeight;
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
    setStuckToEnd(true);
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
      <div class="chat-log" ref={log} onScroll={() => setStuckToEnd(log.scrollHeight - log.scrollTop - log.clientHeight < 40)}>
        <Show when={chat.entries().length} fallback={<p class="chat-empty">Describe a system, ask for a change to the one on the canvas, or ask how something works.</p>}>
          <Index each={chat.entries()}>{(e, i) => <EntryView chat={chat} entry={e()} index={i} now={now()} />}</Index>
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
