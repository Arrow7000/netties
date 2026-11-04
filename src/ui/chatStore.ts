import { createEffect, createMemo, createSignal, on } from "solid-js";
import { parseProgram, printProgram } from "../core/programText";
import { type Conversation, type CutBy, type Entry, type Rewind, type Turn, type TurnEnd, type TurnMsg, newConversation, newTurn, rewind, runTurn, settle, unhold, updateTurn } from "../create/chat";
import type { Editor } from "../state/editor";
import { decode } from "../state/persist";

/**
 * Whether there's a chat at all: the build's VITE_CHAT is "on" (in .env
 * locally). The server's CHAT_MODEL decides which model answers, and without
 * it /api/chat doesn't exist.
 */
export const CHAT = import.meta.env.VITE_CHAT === "on";

const KEY = "netties:chat";

export type { Entry };

interface Saved {
  entries: Entry[];
  conversation: Conversation;
}

export type Chat = ReturnType<typeof createChat>;

/**
 * The conversation beside the net: what's been said, and the turn in progress.
 * It lasts until someone asks for a new one, whatever happens to the document.
 */
export function createChat(ed: Editor) {
  const saved = load();
  const [entries, setEntries] = createSignal<Entry[]>(saved?.entries ?? []);
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  let conversation = saved?.conversation ?? newConversation();
  /** The turn going on, to stop it and to wait until it has. */
  let running: { stop: AbortController; done: Promise<void> } | undefined;

  // Leaving the page kills the request first. That's not the model's failure, so it isn't recorded as one: what has come in so far is saved instead.
  let leaving = false;
  const onLeave = () => {
    if (!leaving) persist();
    leaving = true;
  };
  window.addEventListener("beforeunload", onLeave);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("pageshow", () => (leaving = false));
  /** What's about to end the reply going on. */
  let cutBy: CutBy = "stop";

  const printed = () => printProgram(decode(ed.toDoc()));

  const updateAt = (index: number, f: (t: Turn) => Turn) => setEntries((es) => es.map((e, i) => (i === index && e.kind === "turn" ? { ...e, turn: f(e.turn) } : e)));
  const endAt = (index: number, end: TurnEnd) => updateAt(index, (t) => ({ ...t, phase: { kind: "over", end } }));

  /** Save the chat. If it's too big for the browser, the oldest thinking goes first. */
  const persist = () => {
    let es = entries();
    const thinks = (e: Entry) => e.kind === "turn" && e.turn.tries.some((t) => t.thinking);
    for (;;) {
      try {
        return localStorage.setItem(KEY, JSON.stringify({ entries: es, conversation } satisfies Saved));
      } catch {
        const oldest = es.findIndex(thinks);
        if (oldest < 0) return;
        es = es.map((e, i) => (i === oldest && e.kind === "turn" ? { ...e, turn: { ...e.turn, tries: e.turn.tries.map((t) => ({ ...t, thinking: "" })) } } : e));
      }
    }
  };

  /** Replace what's on the canvas, as a step that can be undone. Returns how many wires didn't fit its types. */
  const put = (code: string) => {
    if (ed.screen().kind !== "net") ed.dispatch({ kind: "screen/close" });
    const { system, net, components, groups } = parseProgram(code);
    const cut = ed.loadParsed(system, net, components, groups);
    if (cut) ed.notify(`Cut ${cut === 1 ? "1 wire" : `${cut} wires`} that didn't fit the types into loose ends.`, true);
    return cut;
  };

  /** Put a reply's document on the canvas, or if something's open over it, hold it until that closes: it may be someone's unsaved work. */
  const apply = (index: number, end: Extract<TurnEnd, { kind: "ready" }>) => {
    if (ed.screen().kind !== "net") return endAt(index, end);
    const asked = entries()[index - 1];
    const changed = asked?.kind === "user" && asked.at && printed() !== asked.at.doc;
    const cut = put(end.code);
    if (changed && !cut) ed.notify("That reply replaced your changes to the net.", true);
    const shown = printed();
    // If its last word wasn't this document, or it was changed on the way in, the next message shows it again.
    conversation = { ...conversation, seen: conversation.unsaid || cut ? undefined : shown };
    endAt(index, { ...end, kind: "applied", shown });
  };

  createEffect(
    on(
      () => ed.screen().kind,
      (kind) => {
        const index = entries().length - 1;
        const e = entries()[index];
        if (kind !== "net" || e?.kind !== "turn" || e.turn.phase.kind !== "over" || e.turn.phase.end.kind !== "ready") return;
        apply(index, e.turn.phase.end);
        persist();
      },
    ),
  );

  /** The canvas as text, while the chat can see it. A run's steps don't count until it ends. */
  const canvas = createMemo<string | undefined>((before) => {
    ed.rev();
    return !open() || ed.running() ? before : printed();
  });

  const stop = () => {
    cutBy = "stop";
    running?.stop.abort();
  };

  const interrupt = async () => {
    if (!running) return;
    cutBy = "message";
    running.stop.abort();
    await running.done;
  };

  const send = async (text: string) => {
    await interrupt();
    return begin(text);
  };

  const begin = async (text: string) => {
    const index = entries().length + 1;
    const at: Rewind = { messages: conversation.messages.length, seen: conversation.seen, unsaid: conversation.unsaid, doc: printed() };
    setEntries((es) => [...es.map(unhold), { kind: "user", text, at }, { kind: "turn", turn: newTurn(Date.now()) }]);
    persist();
    const ctrl = new AbortController();
    const onMessage = (m: TurnMsg) => {
      if (running?.stop === ctrl) updateAt(index, (t) => updateTurn(t, m));
    };
    const go = async () => {
      setBusy(true);
      const { end, conversation: next } = await runTurn(conversation, text, printed(), { onMessage, signal: ctrl.signal, cutBy: () => cutBy });
      // Started over while this was going: it no longer belongs to anything.
      if (running?.stop !== ctrl || leaving) return;
      conversation = next;
      onMessage({ kind: "over", end, at: Date.now() });
      if (end.kind === "ready") apply(index, end);
      running = undefined;
      setBusy(false);
      persist();
    };
    let finished!: () => void;
    running = { stop: ctrl, done: new Promise((r) => (finished = r)) };
    await go().finally(finished);
  };

  /** Say something else at this point instead: what came after it goes, and the net goes back to how it was then. */
  const edit = async (index: number, text: string) => {
    if (ed.screen().kind !== "net") return ed.notify("Close what's open first.");
    await interrupt();
    const e = entries()[index];
    if (e?.kind !== "user" || !e.at) return;
    setEntries((es) => es.slice(0, index));
    conversation = rewind(conversation, e.at);
    if (printed() !== e.at.doc && !put(e.at.doc)) ed.notify("The net is back as it was before that message.", true);
    return begin(text);
  };

  return {
    entries,
    open,
    setOpen,
    busy,
    draft,
    setDraft,
    send,
    stop,
    /** A new conversation, when asked for. */
    reset() {
      stop();
      running = undefined;
      setBusy(false);
      setEntries([]);
      conversation = newConversation();
      try {
        localStorage.removeItem(KEY);
      } catch {
        // ignore
      }
    },
    edit,
    /** Ask again what this turn was asked. */
    retry(index: number) {
      const asked = entries()[index - 1];
      if (asked?.kind === "user") void edit(index - 1, asked.text);
    },
    /** Go back to a document from earlier in the chat. If it isn't what the model last saw, its next message shows it. */
    loadDocument(code: string) {
      if (ed.screen().kind !== "net") return ed.notify("Close what's open first.");
      if (!put(code)) ed.notify("Loaded it. You can undo this.", true);
    },
    /** Whether this reply's document is what's on the canvas now. */
    onCanvas: (end: TurnEnd) => end.kind === "applied" && end.shown !== undefined && end.shown === canvas(),
  };
}

function load(): Saved | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as Saved;
    // Nothing that was held back goes on the canvas just because the page came back: it may be showing something else by now.
    return settle(saved.entries.map(unhold), saved.conversation);
  } catch {
    return undefined;
  }
}
