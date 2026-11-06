import { For, Index, type JSX, Show, createComputed, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { type ModelTag, SEAM_MARKS, type Seam, type ShownTry, type Turn, type TurnEnd, canResume, joinResumed, seamIndex, triesSoFar } from "../create/chat";
import { TRIES } from "../create/client";
import type { Chat, Entry } from "./chatStore";
import { fingers } from "./compact";
import { closeOnEscape } from "./dismiss";
import * as I from "./icons";
import { Menu, MenuItem } from "./Menu";
import { effortName } from "../create/provider";
import { EffortPicker, ModelPicker, ModelSettingsForm, Trouble } from "./ModelSettingsForm";
import { nameOf } from "./modelSettings";
import { pieces } from "./pieces";

/** Width of the panel on a desktop, which the canvas leaves room for. */
export const CHAT_WIDTH = 360;

/** How far along the document is, while it's being written. */
const linesWritten = (reply: string) => {
  const open = /```(?!examples)[^\n]*\n((?:(?!```)[\s\S])*)$/.exec(reply);
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
  /** Where it was when last looked at, and how far down it could go then. */
  let top = 0;
  let max = 0;
  /**
   * What matters is which way it moved, not how far it is from the end: more
   * may have come in since it was last at the end. Going up without the content
   * shrinking is someone scrolling; going down to where the end was takes hold again.
   */
  const look = () => {
    const now = el.scrollTop;
    const can = el.scrollHeight - el.clientHeight;
    if (now < top - 1 && can >= max) set(false);
    else if (now > top && now >= Math.min(max, can) - 24) set(true);
    top = now;
    max = can;
  };
  const toBottom = () => {
    el.scrollTop = el.scrollHeight;
    top = el.scrollTop;
    max = el.scrollHeight - el.clientHeight;
  };
  // Reading the height makes the browser lay out what has changed, so it's done once a frame however many tokens came in.
  let frame = 0;
  const soon = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      look();
      if (atEnd) toBottom();
    });
  };
  el.addEventListener("scroll", look, { passive: true });
  const changes = new MutationObserver(soon);
  changes.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open"] });
  const resizes = new ResizeObserver(soon);
  resizes.observe(el);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    el.removeEventListener("scroll", look);
    changes.disconnect();
    resizes.disconnect();
  });
  return {
    toEnd() {
      set(true);
      toBottom();
    },
  };
}

function styled(s: string): (JSX.Element | string)[] {
  return s.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/g).map((p) => {
    if (p.startsWith("`") && p.length > 2) return <code classList={{ whole: p.length < 24 }}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.length > 4) return <b>{p.slice(2, -2)}</b>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em>{p.slice(1, -1)}</em>;
    return p;
  });
}

/** What a line of a reply says, with a quiet marker at any place it was picked up. */
function inline(s: string, seams: string[]): (JSX.Element | string)[] {
  const out: (JSX.Element | string)[] = [];
  let from = 0;
  for (const m of s.matchAll(SEAM_MARKS)) {
    out.push(...styled(s.slice(from, m.index)), <span class="chat-seam">{seams[seamIndex(m[0])]}</span>);
    from = m.index + m[0].length;
  }
  out.push(...styled(s.slice(from)));
  return out;
}

type Block = { kind: "p" | "h" | "table"; lines: string[] } | { kind: "ul" | "ol"; lines: string[]; start: number };

/** The blocks of what a model wrote. A list can follow a line straight on, and blank lines don't end one. */
function blocksOf(text: string): Block[] {
  const out: Block[] = [];
  let blank = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const last = out.at(-1);
    const item = /^\s*(?:([-*])|(\d+)\.) (.*)$/.exec(line);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      if (last?.kind === kind) last.lines.push(item[3]!);
      else out.push({ kind, lines: [item[3]!], start: Number(item[2] ?? 1) });
    } else if (/^#+ /.test(line)) out.push({ kind: "h", lines: [line.replace(/^#+ /, "")] });
    else if (line.trimStart().startsWith("|")) {
      if (last?.kind === "table") last.lines.push(line);
      else out.push({ kind: "table", lines: [line] });
    } else if (last?.kind === "p" && !blank) last.lines.push(line);
    else out.push({ kind: "p", lines: [line] });
    blank = false;
  }
  return out;
}

/** Enough of Markdown for what models write. */
function Prose(props: { text: string; seams: string[] }) {
  // Blocks that haven't changed stay the same objects, so For leaves them on the page and only the one being written is rebuilt.
  let kept = new Map<string, Block>();
  const blocks = () => {
    const next = new Map<string, Block>();
    const out = blocksOf(props.text).map((b) => {
      const key = JSON.stringify(b);
      const same = kept.get(key) ?? next.get(key) ?? b;
      next.set(key, same);
      return same;
    });
    kept = next;
    return out;
  };
  return (
    <For each={blocks()}>
      {(b) => {
        switch (b.kind) {
          case "ul":
            return <ul>{b.lines.map((l) => <li>{inline(l, props.seams)}</li>)}</ul>;
          case "ol":
            return <ol start={b.start}>{b.lines.map((l) => <li>{inline(l, props.seams)}</li>)}</ol>;
          case "h":
            return <p><b>{inline(b.lines[0]!, props.seams)}</b></p>;
          case "table":
            return <pre>{b.lines.join("\n").replace(SEAM_MARKS, "")}</pre>;
          case "p":
            return <p>{inline(b.lines.join("\n"), props.seams)}</p>;
        }
      }}
    </For>
  );
}

/** Where a reply was picked up, naming the model if it changed there. */
const seamText = (s: Seam) => (s.to ? `Resumed on ${nameOf(s.to.provider)}: ${s.to.model}` : "Resumed");

function TryView(props: { t: ShownTry; n: number; last: boolean; turn: Turn; now: number }) {
  const going = () => props.last && props.turn.phase.kind !== "over";
  const thinking = () => going() && props.turn.phase.kind === "thinking";
  /** "Thinking" or "Try 2 of 3: thinking", and so on. */
  const doing = (what: string) => (triesSoFar(props.turn.tries) > 1 ? `Try ${props.n} of ${TRIES}: ${what}` : what[0]!.toUpperCase() + what.slice(1));
  const words = () => props.t.words.trim();
  const lines = () => (going() ? linesWritten(props.t.reply) : undefined);
  let trace: ReturnType<typeof anchored> | undefined;
  return (
    <>
      <Show when={props.t.note}>
        <div class="chat-status">{props.t.note}</div>
      </Show>
      <Show when={props.t.thinking}>
        <details class="chat-thought" onToggle={(e) => e.currentTarget.open && trace?.toEnd()}>
          <summary classList={{ live: thinking() }}>{thinking() ? `${doing("thinking")}, ${seconds(props.now - (props.t.thoughtFrom ?? props.turn.since))}` : `Thought for ${seconds(props.t.thoughtMs ?? 0)}`}</summary>
          <div ref={(el) => (trace = anchored(el))}>
            <Index each={pieces(props.t.thinking)}>{(p) => <div>{p()}</div>}</Index>
          </div>
        </details>
      </Show>
      <Show when={props.t.pickedUp}>
        {(s) => <div class="chat-seam">{seamText(s())}</div>}
      </Show>
      <Show when={words()}>
        <div class="chat-words">
          <Prose text={words()} seams={props.t.seams.map(seamText)} />
        </div>
      </Show>
      <Show when={props.t.sources?.length}>
        <div class="chat-sources" aria-label="Sources">
          <For each={props.t.sources}>{(source) => <Show when={/^https?:\/\//i.test(source.url)}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a></Show>}</For>
        </div>
      </Show>
      <Show when={props.t.looked}>
        {(names) => <div class="chat-status">Looked at {names().length === 1 ? "the example" : "the examples"} {names().join(", ")}</div>}
      </Show>
      <Show when={lines() !== undefined}>
        <div class="chat-status live">
          {doing("writing the document")}, {lines()} {lines() === 1 ? "line" : "lines"}
        </div>
      </Show>
      {/* Once it's over, the result says what's left to say about the last try and anything that wasn't an outright failure. */}
      <Show when={props.t.problem && !(props.turn.phase.kind === "over" && (props.last || props.t.soft))}>
        <details class="chat-problem">
          <summary>
            {props.t.soft ? "Checking if this is what you want: " : `Try ${props.n} didn't pass: `}
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
          <div class="chat-user">
            <ImagePreviews images={props.entry.images ?? []} />
            {props.entry.text}
          </div>
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

/** What's wrong that the settings might put right. */
const SETTINGS_CAN_FIX = ["key", "model", "unreachable", "blocked"];

function ResumeButton(props: { chat: Chat }) {
  return (
    <button class="btn primary chat-again" onClick={props.chat.resume} title="Carry on from here, keeping what's there">
      Resume
    </button>
  );
}

/** A model and how hard it was asked to think, as a few words. */
const tagText = (chat: Chat, b: ModelTag) => `${nameOf(b.provider)}: ${b.model}${b.effort === "default" || chat.models.refusesLevel(b.provider, b.model, b.effort) ? "" : `, reasoning ${effortName(b.effort).toLowerCase()}`}`;

/** How a turn stands, under what it has said. */
function TurnStatus(props: { chat: Chat; index: number; turn: Turn; now: number }) {
  /** Starting over from further back would throw away what came after, so that's left to Edit. */
  const latest = () => props.index === props.chat.entries().length - 1;
  return (
    <Show when={props.turn.phase.kind === "over" ? (props.turn.phase as Extract<Turn["phase"], { kind: "over" }>).end : undefined} keyed fallback={<Show when={props.turn.phase.kind === "waiting"}><div class="chat-status live">{triesSoFar(props.turn.tries) > 1 ? `Try ${triesSoFar(props.turn.tries)} of ${TRIES}: asking` : "Asking the model"}, {seconds(props.now - props.turn.since)}</div></Show>}>
      {(end) => {
        switch (end.kind) {
          case "said":
            return null;
          case "stopped":
            return (
              <div class="chat-status">
                {end.by === "message" ? "Interrupted by your next message." : end.by === "reload" ? "Cut off by a reload. The canvas hasn't changed." : "Stopped. The canvas hasn't changed."}
                <Show when={latest() && canResume(props.turn)}>
                  <ResumeButton chat={props.chat} />
                </Show>
              </div>
            );
          case "failed":
            return (
              <div class="chat-status">
                <Trouble message={end.message} />
                <Show when={latest()}>
                  <div class="chat-actions">
                    {/* Going again with a key that was turned down won't help, so changing it comes first. */}
                    <Show when={end.code === "key"}>
                      <button class="btn primary chat-again" onClick={() => props.chat.fixSettings(props.index)}>
                        Change the key
                      </button>
                    </Show>
                    <Show when={canResume(props.turn)}>
                      <ResumeButton chat={props.chat} />
                    </Show>
                    <button class="btn outline chat-again" onClick={() => props.chat.retry(props.index)} title="Start this reply over">
                      Try again
                    </button>
                    <Show when={end.code !== "key" && SETTINGS_CAN_FIX.includes(end.code)}>
                      <button class="btn outline chat-again" onClick={() => props.chat.fixSettings(props.index)}>
                        Check settings
                      </button>
                    </Show>
                  </div>
                  {/* There are no tooltips on a touch screen. */}
                  <Show when={canResume(props.turn)}>
                    <p class="chat-note">Resume keeps what's here and carries on. Try again starts this reply over.</p>
                  </Show>
                </Show>
              </div>
            );
          case "gave-up":
            return (
              <div class="chat-result bad">
                <div>Three tries, and none passed the checks, so the canvas hasn't changed.</div>
                <Show when={latest()}>
                  <button class="btn outline chat-again" onClick={() => props.chat.retry(props.index)} title="Start this reply over">
                    Try again
                  </button>
                </Show>
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
  /** Which model a turn came from is only worth saying when it has changed in this chat. */
  const changedTo = () => {
    // Who started it: a reply that moved model part way says so where it did.
    const by = props.entry.kind === "turn" ? (props.entry.turn.tries[0]?.by ?? props.entry.turn.by) : undefined;
    // A turn follows a message, so the one before is two back.
    const before = props.chat.entries()[props.index - 2];
    return by && before?.kind === "turn" && before.turn.by && tagText(props.chat, before.turn.by) !== tagText(props.chat, by) ? tagText(props.chat, by) : undefined;
  };
  return (
    <Show when={props.entry.kind === "turn" ? (props.entry as Extract<Entry, { kind: "turn" }>).turn : undefined} fallback={<UserView chat={props.chat} entry={props.entry as Extract<Entry, { kind: "user" }>} index={props.index} />}>
      {(turn) => (
        <div class="chat-turn">
          <Show when={changedTo()}>
            <div class="chat-by">{changedTo()}</div>
          </Show>
          <Index each={joinResumed(turn().tries)}>{(t) => <TryView t={t()} n={triesSoFar(turn().tries.slice(0, t().upTo + 1))} last={t().upTo === turn().tries.length - 1} turn={turn()} now={props.now} />}</Index>
          <TurnStatus chat={props.chat} index={props.index} turn={turn()} now={props.now} />
        </div>
      )}
    </Show>
  );
}

/** When a chat was last added to: the time if that's today, otherwise the day. */
function changedOn(at: number): string {
  const then = new Date(at);
  const today = new Date();
  if (then.toDateString() === today.toDateString()) return then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return then.toLocaleDateString([], { month: "short", day: "numeric", year: then.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** The chat's name, which opens the list of chats. Going to one changes the conversation and nothing on the canvas. */
function ChatList(props: { chat: Chat; onPick: () => void }) {
  const chat = props.chat;
  /** The chat being asked about, by id since its listing changes if it's being added to in another tab. */
  const [deleting, setDeleting] = createSignal<string>();
  return (
    <Menu class="chat-title" menuClass="chat-list" title="All chats" label={<span>{chat.title() || "Chat"}</span>}>
      {(close) => (
        <For each={chat.chats()} fallback={<div class="menu-head">No chats yet.</div>}>
          {(c) => (
            <Show
              when={deleting() === c.id}
              fallback={
                <div class="chat-row" classList={{ current: c.id === chat.id() }}>
                  <MenuItem
                    title={c.title}
                    note={chat.replying().has(c.id) ? "Replying" : changedOn(c.updated)}
                    onClick={() => {
                      close();
                      void chat.openChat(c.id);
                      props.onPick();
                    }}
                  />
                  <button class="btn icon" title="Delete this chat" aria-label={`Delete ${c.title}`} onClick={() => setDeleting(c.id)}>
                    <I.Trash />
                  </button>
                </div>
              }
            >
              <div class="chat-row-confirm" role="alertdialog" aria-label="Delete this chat?">
                <b>Delete "{c.title}"?</b>
                <p>This can't be undone. What's on the canvas stays.</p>
                <div class="row">
                  <button class="btn outline" onClick={() => setDeleting(undefined)}>
                    Cancel
                  </button>
                  <button
                    class="btn dangerfill"
                    onClick={() => {
                      setDeleting(undefined);
                      void chat.deleteChat(c.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Show>
          )}
        </For>
      )}
    </Menu>
  );
}

/** Object URLs last only as long as their thumbnails; the saved data is the Blob. */
function ImagePreview(props: { image: Blob }) {
  const [url, setUrl] = createSignal("");
  createEffect(() => {
    const next = URL.createObjectURL(props.image);
    setUrl(next);
    onCleanup(() => URL.revokeObjectURL(next));
  });
  return <a href={url()} target="_blank" rel="noopener noreferrer"><img src={url()} alt="Attached image" /></a>;
}

function ImagePreviews(props: { images: Blob[]; remove?: (index: number) => void }) {
  return <Show when={props.images.length}><div class="chat-images"><For each={props.images}>{(image, index) => <div><ImagePreview image={image} /><Show when={props.remove}><button type="button" class="btn" aria-label={`Remove image ${index() + 1}`} onClick={() => props.remove?.(index())}>×</button></Show></div>}</For></div></Show>;
}

/** The chat, beside the net on a desktop and in the lower part of a phone's screen. */
export function ChatPanel(props: { chat: Chat; onEscape: () => void; onClose: () => void }) {
  const chat = props.chat;
  let log!: HTMLDivElement;
  let area!: HTMLTextAreaElement;
  let panel!: HTMLDivElement;
  let files!: HTMLInputElement;
  const [imageError, setImageError] = createSignal("");
  const [draggingFiles, setDraggingFiles] = createSignal(false);
  // Enter/leave also fire for children: count them so crossing the composer or
  // a thumbnail doesn't flicker the drop target.
  let dragDepth = 0;
  const resetDrag = () => { dragDepth = 0; setDraggingFiles(false); };
  const attach = (incoming: File[]) => {
    setImageError("");
    for (const file of incoming) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setImageError("Choose PNG, JPEG, WebP or GIF images."); continue; }
      if (file.size > 5 * 1024 * 1024) { setImageError("Each image must be under 5 MB."); continue; }
      if (chat.draftImages().length >= 4) { setImageError("Attach up to four images per message."); break; }
      chat.setDraftImages((images) => [...images, file]);
    }
  };
  const [now, setNow] = createSignal(Date.now());
  const [atEnd, setAtEnd] = createSignal(true);
  let following: ReturnType<typeof anchored> | undefined;

  /** A new chat that has no model to go to starts with setting one up. An old one is there to read until it's added to. */
  const setting = createMemo(() => !!chat.settings() || (chat.loaded() && !chat.entries().length && !chat.usable()));
  /** What had the keyboard when the settings came up, to go back to. This runs before they take it. */
  let opener: Element | null = null;
  createComputed(on(setting, (now) => void (now && (opener = document.activeElement)), { defer: true }));

  const escape = () => (chat.settings() ? chat.closeSettings() : props.onEscape());
  closeOnEscape(escape);

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
    // The panel changes size as the keyboard comes up, which can leave the field being typed in out of sight.
    const reveal = new ResizeObserver(() => {
      const on = document.activeElement;
      if (panel.contains(on) && on?.matches("input, textarea")) on.scrollIntoView({ block: "nearest" });
    });
    reveal.observe(panel);
    onCleanup(() => reveal.disconnect());
  });

  // Back from the settings: the chat is at its end, and the keyboard is back where it came from if that's still there, or else in the box.
  createEffect(
    on(
      setting,
      (now) => {
        if (now) return;
        following?.toEnd();
        size();
        if (opener instanceof HTMLElement && opener !== document.body && opener.getClientRects().length && !(fingers() && opener.matches("input, textarea"))) opener.focus();
        else refocus();
      },
      { defer: true },
    ),
  );

  // Having chosen a model or a level, what comes next is saying something.
  createEffect(
    on(
      createMemo(() => JSON.stringify(chat.choice())),
      refocus,
      { defer: true },
    ),
  );

  // Going, the keyboard goes back to the button that opens it rather than being dropped at the top of the page.
  onCleanup(() => {
    if (panel.contains(document.activeElement)) document.querySelector<HTMLElement>(".chat-toggle")?.focus();
  });

  // Another chat starts from its latest message, wherever this one was scrolled to.
  createEffect(on(chat.id, () => following?.toEnd(), { defer: true }));

  const size = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight + 2, 140)}px`;
  };

  const submit = () => {
    const text = chat.draft().trim();
    const images = chat.draftImages();
    if (!text && !images.length) return;
    // What's typed stays in the box until there's a model to send it to.
    if (!chat.usable()) return chat.withModel(submit);
    chat.setDraft("");
    chat.setDraftImages([]);
    setImageError("");
    area.value = "";
    size();
    following?.toEnd();
    void chat.send(text || "Please look at the attached images.", images);
  };

  return (
    <div
      class="chat"
      ref={panel}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth++;
        setDraggingFiles(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dragDepth) return;
        e.stopPropagation();
        if (--dragDepth === 0) setDraggingFiles(false);
      }}
      onDragEnd={resetDrag}
      onDrop={(e) => {
        resetDrag();
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        attach(Array.from(e.dataTransfer.files));
        refocus();
      }}
      role="complementary"
      aria-label="Chat"
      // So a click anywhere in it keeps the keyboard here, not on the canvas.
      tabindex={-1}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !(e.target as Element).closest("textarea, input")) {
          e.preventDefault();
          getSelection()?.selectAllChildren(log);
        }
      }}
    >
      <Show when={draggingFiles()}><div class="chat-drop-hint" aria-hidden="true">Drop images to attach</div></Show>
      <header class="chat-head">
        <ChatList chat={chat} onPick={refocus} />
        <button class="btn" onClick={() => (void chat.newChat(), refocus())} disabled={!chat.entries().length} title="Start a new conversation">
          New chat
        </button>
        <button class="btn icon" onClick={() => props.onClose()} title="Minimise. A reply that's coming keeps coming." aria-label="Minimise">
          <I.Minimise />
        </button>
      </header>
      <Show when={setting()}>
        <div class="model-form-wrap">
          <ModelSettingsForm chat={chat} first={!chat.entries().length && !chat.settings()} onSaved={refocus} onEscape={escape} />
        </div>
      </Show>
      {/* Hidden rather than taken away, so a chat comes back from the settings just as it was. */}
      <div class="chat-log-wrap" style={{ display: setting() ? "none" : undefined }}>
        <div class="chat-log" ref={log}>
          {/* Keyed, so what's open or being edited in one chat doesn't carry over to the next. */}
          <Show when={chat.id()} keyed>
            <Show when={chat.entries().length} fallback={<Show when={chat.loaded()}><p class="chat-empty">Describe a system, ask for a change to the one on the canvas, or ask how something works.</p></Show>}>
              <Index each={chat.entries()}>{(e, i) => <EntryView chat={chat} entry={e()} index={i} now={now()} />}</Index>
            </Show>
          </Show>
        </div>
        <Show when={!atEnd()}>
          <button class="btn chat-latest" onClick={() => following?.toEnd()} title="Back to the latest">
            Latest
          </button>
        </Show>
      </div>
      <div class="chat-attachments" style={{ display: setting() ? "none" : undefined }}>
        <ImagePreviews images={chat.draftImages()} remove={(i) => chat.setDraftImages((images) => images.filter((_, n) => n !== i))} />
        <Show when={imageError()}><p role="alert" class="chat-note">{imageError()}</p></Show>
      </div>
      <form
        class="chat-compose"
        style={{ display: setting() ? "none" : undefined }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input ref={files} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { attach(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ""; }} />
        <button type="button" class="btn" onClick={() => files.click()} title="Attach images (up to four, 5 MB each). Choose a model that accepts images." aria-label="Attach images">+</button>
        <div class="chat-field">
        <textarea
          ref={area}
          class="input"
          rows={1}
          placeholder="Message"
          aria-label="Message"
          value={chat.draft()}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
            if (images.length) { e.preventDefault(); attach(images); }
          }}
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
          <button type="button" class="btn icon chat-stop" onClick={() => (chat.stop(), refocus())} title="Stop" aria-label="Stop">
            <I.Stop />
          </button>
        </Show>
        </div>
        <button type="submit" class="btn icon primary" disabled={!chat.draft().trim() && !chat.draftImages().length} title={chat.busy() ? "Stop this reply and send" : "Send"} aria-label="Send">
          <I.Send />
        </button>
      </form>
      <div class="chat-model" style={{ display: setting() ? "none" : undefined }}>
        <ModelPicker chat={chat} />
        <EffortPicker chat={chat} />
        <button
          class="btn"
          disabled={!chat.choice()}
          aria-pressed={!!chat.models.searchMode(chat.choice())}
          onClick={() => {
            const choice = chat.choice();
            if (!choice) return;
            if (!chat.models.searchMode({ ...choice, webSearch: true })) {
              chat.setWebSearch(true);
              chat.openSettings();
            } else chat.setWebSearch(!chat.models.searchMode(choice));
          }}
          title={chat.choice() && chat.models.searchMode({ ...chat.choice()!, webSearch: true }) ? "Let the model search the web. Searches are billed by your search provider." : "Set up a Tavily key to let this model search the web."}
        >Web</button>
        <button class="btn icon chat-settings" onClick={() => chat.openSettings()} title="Providers and keys" aria-label="Providers and keys">
          <I.Gear />
        </button>
      </div>
    </div>
  );
}
