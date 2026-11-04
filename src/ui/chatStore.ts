import { createSignal } from "solid-js";
import { parseProgram, printProgram } from "../core/programText";
import { type Conversation, type Turn, type TurnEnd, type TurnMsg, newConversation, newTurn, runTurn, updateTurn } from "../create/chat";
import type { Editor } from "../state/editor";
import { type Doc, decode } from "../state/persist";
import { canLeave } from "./subEditor";

/**
 * Whether there's a chat at all: the build's VITE_CHAT is "on" (in .env
 * locally). The server's CHAT_MODEL decides which model answers, and without
 * it /api/chat doesn't exist.
 */
export const CHAT = import.meta.env.VITE_CHAT === "on";

const KEY = "netties:chat";

export type Entry = { kind: "user"; text: string } | { kind: "turn"; turn: Turn };

interface Saved {
  entries: Entry[];
  conversation: Conversation;
}

export type Chat = ReturnType<typeof createChat>;

/** The conversation beside the net: what's been said, and the turn in progress. */
export function createChat(ed: Editor) {
  const saved = load();
  const [entries, setEntries] = createSignal<Entry[]>(saved?.entries ?? []);
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  let conversation = saved?.conversation ?? newConversation();
  /** The turn going on, to stop it and to wait until it has. */
  let running: { stop: AbortController; done: Promise<void> } | undefined;
  /** For each applied turn, the document to swap back in: not kept over a reload, like the undo history. */
  const swaps = new Map<number, Doc>();

  const printed = () => printProgram(decode(ed.toDoc()));

  const updateAt = (index: number, f: (t: Turn) => Turn) => setEntries((es) => es.map((e, i) => (i === index && e.kind === "turn" ? { ...e, turn: f(e.turn) } : e)));
  const endAt = (index: number, end: TurnEnd) => updateAt(index, (t) => ({ ...t, phase: { kind: "over", end } }));

  const persist = () => {
    // Thinking is long and only of interest while it's happening.
    const light = entries().map((e) => (e.kind === "turn" ? { ...e, turn: { ...e.turn, tries: e.turn.tries.map((t) => ({ ...t, thinking: "" })) } } : e));
    try {
      localStorage.setItem(KEY, JSON.stringify({ entries: light, conversation } satisfies Saved));
    } catch {
      // Too big for the browser, or storage is off: it just won't survive a reload.
    }
  };

  /** Put a document on the canvas. Whatever's open that can be closed is closed first; with unsaved changes open it waits, as "ready", for a click. */
  const apply = (index: number, end: Extract<TurnEnd, { kind: "ready" }>) => {
    if (!canLeave()) return endAt(index, end);
    if (ed.screen().kind !== "net") ed.dispatch({ kind: "screen/close" });
    const before = ed.toDoc();
    const { system, net, components, groups } = parseProgram(end.code);
    const cut = ed.loadParsed(system, net, components, groups);
    if (cut) ed.notify(`Cut ${cut === 1 ? "1 wire" : `${cut} wires`} that didn't fit the types into loose ends.`, true);
    swaps.set(index, before);
    // If its last word wasn't this document, or it was changed on the way in, the next message shows it again.
    conversation = { ...conversation, seen: conversation.unsaid || cut ? undefined : printed() };
    endAt(index, { ...end, kind: "applied" });
  };

  const stop = () => running?.stop.abort();

  const send = async (text: string) => {
    if (running) {
      stop();
      await running.done;
    }
    const index = entries().length + 1;
    setEntries((es) => [...es, { kind: "user", text }, { kind: "turn", turn: newTurn(Date.now()) }]);
    const ctrl = new AbortController();
    const onMessage = (m: TurnMsg) => {
      if (running?.stop === ctrl) updateAt(index, (t) => updateTurn(t, m));
    };
    const go = async () => {
      setBusy(true);
      const { end, conversation: next } = await runTurn(conversation, text, printed(), { onMessage, signal: ctrl.signal });
      // Started over while this was going: it no longer belongs to anything.
      if (running?.stop !== ctrl) return;
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

  return {
    entries,
    open,
    setOpen,
    busy,
    draft,
    setDraft,
    send,
    stop,
    /** A new conversation, for a new document or when asked. */
    reset() {
      stop();
      running = undefined;
      setBusy(false);
      setEntries([]);
      conversation = newConversation();
      swaps.clear();
      try {
        localStorage.removeItem(KEY);
      } catch {
        // ignore
      }
    },
    /** Put a document that was waiting on the canvas. */
    applyHeld(index: number) {
      const e = entries()[index];
      if (e?.kind === "turn" && e.turn.phase.kind === "over" && e.turn.phase.end.kind === "ready") {
        apply(index, e.turn.phase.end);
        persist();
      }
    },
    canUndo: (index: number) => swaps.has(index),
    /** Swap between the document before this turn and the one now on the canvas, as a step that can be undone. */
    undo(index: number) {
      const e = entries()[index];
      const other = swaps.get(index);
      if (!other || !canLeave() || e?.kind !== "turn" || e.turn.phase.kind !== "over" || e.turn.phase.end.kind !== "applied") return;
      swaps.set(index, ed.toDoc());
      ed.load(other);
      endAt(index, { ...e.turn.phase.end, undone: !e.turn.phase.end.undone });
      persist();
    },
  };
}

function load(): Saved | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : undefined;
  } catch {
    return undefined;
  }
}
