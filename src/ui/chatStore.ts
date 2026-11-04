import { batch, createEffect, createMemo, createSignal, on } from "solid-js";
import { parseProgram, printProgram } from "../core/programText";
import { type CutBy, type Entry, type Rewind, type Turn, type TurnEnd, type TurnMsg, newConversation, newTurn, rewind, runTurn, settle, unhold, updateTurn } from "../create/chat";
import type { Editor } from "../state/editor";
import { decode } from "../state/persist";
import { type ChatDb, type Listing, type Saved, openChats, titleOf } from "./chatDb";

/**
 * Whether there's a chat at all: the build's VITE_CHAT is "on" (in .env
 * locally). The server's CHAT_MODEL decides which model answers, and without
 * it /api/chat doesn't exist.
 */
export const CHAT = import.meta.env.VITE_CHAT === "on";

/** Which chat this tab is on (sessionStorage), and which one a new tab starts on (localStorage). */
const CURRENT_KEY = "netties:chat-id";
const OPEN_KEY = "netties:chat-open";
/** How often a reply in progress is saved, in case the page goes without warning. */
const SAVE_EVERY = 2000;

export type { Entry };

/** What tabs tell each other. Tabs on the same chat follow each other; others just keep their lists up to date. */
type News = { id: string; listing: Listing; chat: Saved } | { id: string; gone: true };

export type Chat = ReturnType<typeof createChat>;

/**
 * The conversation beside the net: what's been said, and the turn in progress.
 * It lasts until someone moves to another or deletes it, whatever happens to the
 * document, and moving between chats leaves the canvas as it is.
 */
export function createChat(ed: Editor) {
  const [id, setId] = createSignal<string>(newId());
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [chats, setChats] = createSignal<Listing[]>([]);
  /** Whether what's saved has been read yet. */
  const [loaded, setLoaded] = createSignal(false);
  const [open, setOpenNow] = createSignal(wasOpen());
  const setOpen = (v: boolean) => {
    setOpenNow(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "");
    } catch {
      // It just won't be remembered.
    }
  };
  const [busy, setBusy] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  let conversation = newConversation();
  let store: ChatDb | undefined;
  const news = new BroadcastChannel("netties:chat");
  /** The turn going on, to stop it and to wait until it has. */
  let running: { stop: AbortController; done: Promise<void> } | undefined;

  // Leaving the page kills the request first. That's not the model's failure, so it isn't recorded as one: what has come in so far is saved instead.
  // Everything else was saved as it happened. Saving it again could put back an older chat over what another tab has done since.
  let leaving = false;
  const onLeave = () => {
    if (running && !leaving) persist(settle(entries(), conversation));
    leaving = true;
  };
  window.addEventListener("beforeunload", onLeave);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("pageshow", () => (leaving = false));

  /**
   * Another tab has moved this chat on: follow it, letting go of any reply going
   * on here. Tabs only write when they have something new, so hearing from
   * another one means just that.
   */
  news.onmessage = ({ data }: MessageEvent<News>) => {
    const here = data.id === id();
    setChats((l) => ("gone" in data ? l.filter((c) => c.id !== data.id) : listed(l, data.listing)));
    if (!here) return;
    running?.stop.abort();
    running = undefined;
    setBusy(false);
    if ("gone" in data) return fresh();
    conversation = data.chat.conversation;
    // What hasn't changed stays as it is on the screen, so an open document doesn't close whenever the other tab saves.
    setEntries((old) => data.chat.entries.map(unhold).map((entry, i) => (JSON.stringify(entry) === JSON.stringify(old[i]) ? old[i]! : entry)));
  };

  /** What's about to end the reply going on. */
  let cutBy: CutBy = "stop";

  const printed = () => printProgram(decode(ed.toDoc()));

  const updateAt = (index: number, f: (t: Turn) => Turn) => setEntries((es) => es.map((e, i) => (i === index && e.kind === "turn" ? { ...e, turn: f(e.turn) } : e)));
  const endAt = (index: number, end: TurnEnd) => updateAt(index, (t) => ({ ...t, phase: { kind: "over", end } }));

  let warned = false;
  /** A browser with no room or no IndexedDB can still chat. It should just say so, once. */
  const trouble = (e: unknown) => {
    console.error("couldn't save the chat", e);
    if (!warned) ed.notify("This browser isn't saving your chats.");
    warned = true;
  };

  /** Save the chat, and tell other tabs. The tabs don't wait for the database, since a page on its way out might not see that finish. */
  const persist = (chat: Saved = { entries: entries(), conversation }) => {
    if (!chat.entries.length) return;
    const listing: Listing = { id: id(), title: titleOf(chat.entries), updated: Date.now() };
    setChats((l) => listed(l, listing));
    store?.write(listing, chat).catch(trouble);
    news.postMessage({ id: id(), listing, chat } satisfies News);
  };

  /** Put a chat from storage on the screen. A reply that was going, or a document held back, stays off the canvas: it may be showing something else by now. */
  const show = (chatId: string, chat: Saved) => {
    const whole = settle(chat.entries.map(unhold), chat.conversation);
    conversation = whole.conversation;
    batch(() => {
      setId(chatId);
      setEntries(whole.entries);
    });
    remember(chatId);
  };

  /** An empty chat. It isn't saved or listed until something is said in it. */
  const fresh = () => {
    const chatId = newId();
    conversation = newConversation();
    batch(() => {
      setId(chatId);
      setEntries([]);
    });
    remember(chatId);
  };

  /** Whatever this tab is doing with chats, in order, so that a message waits for the chat it's meant for. */
  let moving: Promise<unknown> = (async () => {
    try {
      store = await openChats();
      const list = await store.list();
      setChats(list);
      const want = sessionItem() ?? localItem() ?? list[0]?.id;
      const saved = want ? await store.read(want) : undefined;
      if (want && saved) show(want, saved);
      else fresh();
    } catch (e) {
      trouble(e);
    }
    setLoaded(true);
  })();
  const move = (f: () => Promise<void>) => {
    moving = moving.then(f).catch(trouble);
    return moving;
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

  /** End the reply going on, if there is one. It gets saved like any other. */
  const interrupt = async (by: CutBy) => {
    if (!running) return;
    cutBy = by;
    running.stop.abort();
    await running.done;
  };

  const send = async (text: string) => {
    await moving;
    await interrupt("message");
    return begin(text);
  };

  const begin = async (text: string) => {
    // A reply going on in another tab ends here: that tab stops when it hears about this.
    const before = settle(entries(), conversation, "message");
    conversation = before.conversation;
    setEntries(before.entries);
    const index = entries().length + 1;
    const at: Rewind = { messages: conversation.messages.length, seen: conversation.seen, unsaid: conversation.unsaid, doc: printed() };
    setEntries((es) => [...es.map(unhold), { kind: "user", text, at }, { kind: "turn", turn: newTurn(Date.now()) }]);
    persist();
    const ctrl = new AbortController();
    let saved = Date.now();
    const onMessage = (m: TurnMsg) => {
      if (running?.stop !== ctrl) return;
      updateAt(index, (t) => updateTurn(t, m));
      if (Date.now() - saved > SAVE_EVERY) {
        saved = Date.now();
        persist();
      }
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
    await moving;
    await interrupt("message");
    const e = entries()[index];
    if (e?.kind !== "user" || !e.at) return;
    setEntries((es) => es.slice(0, index));
    conversation = rewind(conversation, e.at);
    try {
      if (printed() !== e.at.doc && !put(e.at.doc)) ed.notify("The net is back as it was before that message.", true);
    } catch (err) {
      console.error("couldn't restore the net", err);
      ed.notify("Couldn't put the net back as it was, so it's staying as it is.");
    }
    return begin(text);
  };

  return {
    id,
    entries,
    chats,
    loaded,
    open,
    setOpen,
    busy,
    draft,
    setDraft,
    send,
    stop,
    /** Start another conversation. This one stays in the list. */
    newChat: () =>
      move(async () => {
        await interrupt("stop");
        fresh();
      }),
    /** Go to a chat from the list. A reply going on here stops, and can be picked up with Continue. The canvas stays as it is. */
    openChat: (chatId: string) =>
      move(async () => {
        if (chatId === id()) return;
        await interrupt("stop");
        const saved = await store?.read(chatId);
        if (saved) show(chatId, saved);
        else setChats((l) => l.filter((c) => c.id !== chatId));
      }),
    /** Delete a chat for good. */
    deleteChat: (chatId: string) =>
      move(async () => {
        const here = chatId === id();
        if (here) await interrupt("stop");
        await store?.remove(chatId);
        setChats((l) => l.filter((c) => c.id !== chatId));
        news.postMessage({ id: chatId, gone: true } satisfies News);
        if (here) fresh();
      }),
    edit,
    /** Ask again what this turn was asked. A message saved before edits existed has nowhere to go back to, so it's simply sent again. */
    retry(index: number) {
      const asked = entries()[index - 1];
      if (asked?.kind !== "user") return;
      void (asked.at ? edit(index - 1, asked.text) : send(asked.text));
    },
    /** Pick a reply back up: the history already has how far it got. */
    carryOn: () => void send("Carry on from where you left off."),
    /** Go back to a document from earlier in the chat. If it isn't what the model last saw, its next message shows it. */
    loadDocument(code: string) {
      if (ed.screen().kind !== "net") return ed.notify("Close what's open first.");
      if (!put(code)) ed.notify("Loaded it. You can undo this.", true);
    },
    /** Whether this reply's document is what's on the canvas now. */
    onCanvas: (end: TurnEnd) => end.kind === "applied" && end.shown !== undefined && end.shown === canvas(),
  };
}

function wasOpen(): boolean {
  try {
    return !!localStorage.getItem(OPEN_KEY);
  } catch {
    return false;
  }
}

/** A list with this chat brought up to date, and at the top. */
const listed = (l: Listing[], c: Listing) => [c, ...l.filter((x) => x.id !== c.id)];

const newId = () => crypto.randomUUID();

function sessionItem(): string | null {
  try {
    return sessionStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function localItem(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function remember(chatId: string) {
  try {
    sessionStorage.setItem(CURRENT_KEY, chatId);
    localStorage.setItem(CURRENT_KEY, chatId);
  } catch {
    // It just won't be remembered.
  }
}
