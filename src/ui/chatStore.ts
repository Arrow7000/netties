import { type Accessor, type Setter, createEffect, createMemo, createSignal, on } from "solid-js";
import { parseProgram, printProgram } from "../core/programText";
import { type Conversation, type CutBy, type Entry, type ModelTag, RESUME, type Rewind, type Turn, type TurnEnd, type TurnMsg, askTitle, canResume, newConversation, newTurn, resumedTurn, rewind, runTurn, settle, unhold, updateTurn } from "../create/chat";
import { CHAT_SYSTEM, TITLE_SYSTEM } from "../create/prompt";
import { type Effort, levelRefused } from "../create/provider";
import type { Editor } from "../state/editor";
import { decode } from "../state/persist";
import { type ChatDb, type Listing, type Saved, openChats, titleOf } from "./chatDb";
import { chatUnlocked } from "./chatUnlock";
import { type Choice, createModelSettings } from "./modelSettings";

/**
 * Whether there's a chat at all: the build's VITE_CHAT is "on" (in .env locally),
 * or this browser has been let in by a link. It's only a switch, as nothing is
 * behind it: which model answers is up to each visitor, with their own key.
 */
export const CHAT = import.meta.env.VITE_CHAT === "on" || chatUnlocked();

/** Which chat this tab is on (sessionStorage), and which one a new tab starts on (localStorage). */
const CURRENT_KEY = "netties:chat-id";
const OPEN_KEY = "netties:chat-open";
/** How often a reply in progress is saved, in case the page goes without warning. */
const SAVE_EVERY = 2000;

export type { Entry };

/** What can be held up for want of a model. */
export type Waiting = "send" | "resume" | "retry";

/** Why the settings are on the screen. */
export type SettingsWhy =
  /** Asked for from the menu. */
  | { kind: "asked" }
  /** Something needs a model, and goes ahead once there is one. */
  | { kind: "waiting"; action: Waiting; then: () => void }
  /** A reply failed in a way the settings might put right, and goes again after them. */
  | { kind: "fixing"; code: string; message: string; action: "resume" | "retry"; then: () => void };

/** What saving the settings changes for the chat on the screen. */
export interface ChatTakes {
  model: boolean;
  level: boolean;
}

/** What tabs tell each other. Tabs on the same chat follow each other; others just keep their lists up to date. */
type News = { id: string; listing: Listing; chat: Saved } | { id: string; gone: true } | { id: string; title: string };

export type Chat = ReturnType<typeof createChat>;

/** One conversation, with the reply going on in it if there is one. Replies carry on whichever chat is on the screen. */
interface Thread {
  id: string;
  entries: Accessor<Entry[]>;
  setEntries: Setter<Entry[]>;
  conversation: Conversation;
  /** What the model called it, once it has. Until then it goes by its first line. */
  title?: string;
  /** The reply going on, to stop it and to wait until it has. */
  running?: { stop: AbortController; done: Promise<void> };
  /** What's about to end it. */
  cutBy: CutBy;
  /** The model it uses. Until it has one of its own, it goes by the choice for new chats. */
  choice: Accessor<Choice | undefined>;
  setChoice: Setter<Choice | undefined>;
}

const newThread = (id: string, entries: Entry[] = [], conversation = newConversation(), chosen?: Choice): Thread => {
  const [got, set] = createSignal(entries);
  const [choice, setChoice] = createSignal(chosen);
  return { id, entries: got, setEntries: set, conversation, cutBy: "stop", choice, setChoice };
};

/**
 * The conversations beside the net: what's been said in each, and the replies
 * in progress. A chat lasts until someone deletes it, whatever happens to the
 * document. Moving between chats leaves the canvas as it is, and a reply that
 * finishes while its chat isn't on the screen doesn't touch it either.
 */
export function createChat(ed: Editor, models = createModelSettings()) {
  /** The chat on the screen. */
  const [current, setCurrent] = createSignal(newThread(newId()));
  const id = () => current().id;
  const entries = () => current().entries();
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
  const [draft, setDraft] = createSignal("");
  /** The settings on the screen, and why. */
  const [settings, setSettings] = createSignal<SettingsWhy | undefined>();
  const chosen = (t: Thread) => t.choice() ?? models.defaults();
  const usable = () => models.usable(chosen(current()));
  /** Do this if there's a model to do it with, and otherwise ask for one first. Reading what's been said never needs one. */
  const withModel = (f: () => void, action: Waiting = "send") => (usable() ? f() : setSettings({ kind: "waiting", action, then: f }));
  let store: ChatDb | undefined;
  const news = new BroadcastChannel("netties:chat");
  /** The chats with a reply going on in this tab. */
  const live = new Map<string, Thread>();
  const [replying, setReplying] = createSignal<ReadonlySet<string>>(new Set());
  const setRunning = (t: Thread, running: Thread["running"]) => {
    t.running = running;
    if (running) live.set(t.id, t);
    else live.delete(t.id);
    setReplying(new Set(live.keys()));
  };

  // Leaving the page kills the requests first. That's not the model's failure, so it isn't recorded as one: what has come in so far is saved instead.
  // Everything else was saved as it happened. Saving it again could put back an older chat over what another tab has done since.
  let leaving = false;
  const onLeave = () => {
    if (!leaving) for (const t of live.values()) persist(t, settle(t.entries(), t.conversation));
    leaving = true;
  };
  window.addEventListener("beforeunload", onLeave);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("pageshow", () => (leaving = false));

  /**
   * Another tab has moved a chat on: follow it, letting go of any reply going on
   * in it here. Tabs only write when they have something new, so hearing from
   * another one means just that.
   */
  news.onmessage = ({ data }: MessageEvent<News>) => {
    const here = current().id === data.id;
    const t = here ? current() : live.get(data.id);
    // A new name isn't anything said, so a reply carries on.
    if ("title" in data) return named(data.id, data.title);
    setChats((l) => ("gone" in data ? l.filter((c) => c.id !== data.id) : listed(l, data.listing)));
    if (!t) return;
    if ("listing" in data) t.title = data.listing.named ? data.listing.title : undefined;
    t.running?.stop.abort();
    setRunning(t, undefined);
    if (!here) return;
    if ("gone" in data) return fresh();
    t.conversation = data.chat.conversation;
    t.setChoice(data.chat.choice);
    // What hasn't changed stays as it is on the screen, so an open document doesn't close whenever the other tab saves.
    t.setEntries((old) => data.chat.entries.map(unhold).map((entry, i) => (JSON.stringify(entry) === JSON.stringify(old[i]) ? old[i]! : entry)));
  };

  const printed = () => printProgram(decode(ed.toDoc()));

  const updateAt = (t: Thread, index: number, f: (turn: Turn) => Turn) => t.setEntries((es) => es.map((e, i) => (i === index && e.kind === "turn" ? { ...e, turn: f(e.turn) } : e)));
  const endAt = (t: Thread, index: number, end: TurnEnd) => updateAt(t, index, (turn) => ({ ...turn, phase: { kind: "over", end } }));

  let warned = false;
  /** A browser with no room or no IndexedDB can still chat. It should just say so, once. */
  const trouble = (e: unknown) => {
    console.error("couldn't save the chat", e);
    if (!warned) ed.notify("This browser isn't saving your chats.");
    warned = true;
  };

  /** Save a chat, and tell other tabs. The tabs don't wait for the database, since a page on its way out might not see that finish. */
  const persist = (t: Thread, kept: Omit<Saved, "choice"> = { entries: t.entries(), conversation: t.conversation }) => {
    if (!kept.entries.length) return;
    const chat: Saved = { ...kept, choice: t.choice() };
    const listing: Listing = { id: t.id, title: t.title ?? titleOf(chat.entries), named: t.title !== undefined, updated: Date.now() };
    setChats((l) => listed(l, listing));
    store?.write(listing, chat).catch(trouble);
    news.postMessage({ id: t.id, listing, chat } satisfies News);
  };

  /** Change the model a chat uses. That isn't anything said, so it keeps its place in the list, and a reply going on in another tab carries on. */
  const choose = (t: Thread, choice: Choice) => {
    t.setChoice(choice);
    const listing = chats().find((c) => c.id === t.id);
    if (listing) store?.write(listing, { entries: t.entries(), conversation: t.conversation, choice }).catch(trouble);
  };

  const tagOf = (t: Thread): ModelTag | undefined => {
    const c = chosen(t);
    return c ? { provider: c.provider, model: c.model, effort: models.effective(c) } : undefined;
  };

  /** The chat with this id, if this tab has it in hand. */
  const threadOf = (chatId: string) => (current().id === chatId ? current() : live.get(chatId));

  const named = (chatId: string, title: string) => {
    const t = threadOf(chatId);
    if (t) t.title = title;
    setChats((l) => l.map((c) => (c.id === chatId ? { ...c, title, named: true } : c)));
  };

  /** Chats this tab has asked to name. If it didn't work, the next load gets another go when the chat is next added to. */
  const askedToName = new Set<string>();

  /**
   * Ask for a name for a chat, on the visitor's key. So only when they've just
   * sent something, which costs them anyway: never for chats merely sitting
   * there. If what was first said has changed by the time it comes, it's no longer the right name.
   */
  const name = async (t: Thread, text: string) => {
    const choice = chosen(t);
    if (!models.usable(choice)) return;
    askedToName.add(t.id);
    const title = await askTitle(text, models.asker({ ...choice, effort: "off" }, TITLE_SYSTEM));
    if (!title) return;
    const first = threadOf(t.id)?.entries().find((e) => e.kind === "user");
    if (first?.kind === "user" && first.text !== text) return;
    named(t.id, title);
    store?.retitle(t.id, title).catch(trouble);
    news.postMessage({ id: t.id, title } satisfies News);
  };

  /** Put a chat from storage on the screen. A reply that was going, or a document held back, stays off the canvas: it may be showing something else by now. */
  const show = (chatId: string, chat: Saved) => {
    const whole = settle(chat.entries.map(unhold), chat.conversation);
    const t = newThread(chatId, whole.entries, whole.conversation, chat.choice);
    const listing = chats().find((c) => c.id === chatId);
    t.title = listing?.named ? listing.title : undefined;
    setCurrent(t);
    remember(chatId);
  };

  /** An empty chat. It isn't saved or listed until something is said in it. */
  const fresh = () => {
    const t = newThread(newId());
    setCurrent(t);
    remember(t.id);
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

  /**
   * What becomes of a reply's document. It goes on the canvas if its chat is the
   * one on the screen, unless something's open over it, which may be someone's
   * unsaved work: then it's held until that closes. In a chat that isn't on the
   * screen it waits for its Load button.
   */
  const apply = (t: Thread, index: number, end: Extract<TurnEnd, { kind: "ready" }>) => {
    if (t !== current()) return endAt(t, index, { ...end, kind: "applied" });
    if (ed.screen().kind !== "net") return endAt(t, index, end);
    const asked = t.entries()[index - 1];
    const changed = asked?.kind === "user" && asked.at && printed() !== asked.at.doc;
    const cut = put(end.code);
    if (changed && !cut) ed.notify("That reply replaced your changes to the net.", true);
    const shown = printed();
    // If its last word wasn't this document, or it was changed on the way in, the next message shows it again.
    t.conversation = { ...t.conversation, seen: t.conversation.unsaid || cut ? undefined : shown };
    endAt(t, index, { ...end, kind: "applied", shown });
  };

  createEffect(
    on(
      () => ed.screen().kind,
      (kind) => {
        const t = current();
        const index = t.entries().length - 1;
        const e = t.entries()[index];
        if (kind !== "net" || e?.kind !== "turn" || e.turn.phase.kind !== "over" || e.turn.phase.end.kind !== "ready") return;
        apply(t, index, e.turn.phase.end);
        persist(t);
      },
    ),
  );

  /** The canvas as text, while the chat can see it. A run's steps don't count until it ends. */
  const canvas = createMemo<string | undefined>((before) => {
    ed.rev();
    return !open() || ed.running() ? before : printed();
  });

  /** End the reply going on in a chat, if there is one. It gets saved like any other. */
  const interrupt = async (t: Thread, by: CutBy) => {
    if (!t.running) return;
    t.cutBy = by;
    t.running.stop.abort();
    await t.running.done;
  };

  const send = async (text: string) => {
    await moving;
    const t = current();
    await interrupt(t, "message");
    return begin(t, text);
  };

  const begin = async (t: Thread, text: string) => {
    // A reply going on in another tab ends here: that tab stops when it hears about this.
    const first = !t.entries().length;
    const before = settle(t.entries(), t.conversation, "message");
    t.conversation = before.conversation;
    t.setEntries(before.entries);
    const index = t.entries().length + 1;
    const at: Rewind = { messages: t.conversation.messages.length, seen: t.conversation.seen, unsaid: t.conversation.unsaid, doc: printed() };
    // From here on it has a model of its own, whatever becomes of the choice for new chats.
    t.setChoice(chosen(t));
    t.setEntries((es) => [...es.map(unhold), { kind: "user", text, at }, { kind: "turn", turn: newTurn(Date.now(), tagOf(t)) }]);
    if (first) {
      t.title = undefined;
      void name(t, text);
    } else if (t.title === undefined && !askedToName.has(t.id)) {
      const said = t.entries().find((e) => e.kind === "user");
      if (said?.kind === "user") void name(t, said.text);
    }
    persist(t);
    return run(t, index, text, false);
  };

  /** Get a reply for the turn at this index, asking this. */
  const run = async (t: Thread, index: number, request: string, resuming: boolean) => {
    const ctrl = new AbortController();
    let saved = Date.now();
    const choice = chosen(t)!;
    const level = models.effective(choice);
    const onMessage = (m: TurnMsg) => {
      if (t.running?.stop !== ctrl) return;
      if (m.kind === "note" && level !== "default" && m.text === levelRefused(level)) models.refusedLevel(choice.provider, choice.model, level);
      updateAt(t, index, (turn) => updateTurn(turn, m));
      if (Date.now() - saved > SAVE_EVERY) {
        saved = Date.now();
        persist(t);
      }
    };
    const go = async () => {
      const ask = models.asker(choice, CHAT_SYSTEM);
      const { end, conversation: next } = await runTurn(t.conversation, request, printed(), { ask, onMessage, signal: ctrl.signal, cutBy: () => t.cutBy, resuming });
      // Started over while this was going, or deleted: it no longer belongs to anything.
      if (t.running?.stop !== ctrl || leaving) return;
      t.conversation = next;
      onMessage({ kind: "over", end, at: Date.now() });
      if (end.kind === "ready") apply(t, index, end);
      setRunning(t, undefined);
      persist(t);
    };
    let finished!: () => void;
    setRunning(t, { stop: ctrl, done: new Promise((r) => (finished = r)) });
    await go().finally(finished);
  };

  /** Pick the last reply back up from where it was cut short, in the same turn. The model has how far it got, and the visitor doesn't have to say anything. */
  const resume = async () => {
    await moving;
    const t = current();
    const index = t.entries().length - 1;
    const e = t.entries()[index];
    if (t.running || e?.kind !== "turn" || !canResume(e.turn)) return;
    t.cutBy = "stop";
    t.setEntries((es) => es.map((x, i) => (i === index && x.kind === "turn" ? { ...x, turn: resumedTurn(x.turn, Date.now(), tagOf(t)) } : x)));
    persist(t);
    return run(t, index, RESUME, true);
  };

  // What was waiting belongs to the chat it was asked for in, so going to another one lets go of it.
  createEffect(
    on(
      id,
      () => {
        if (settings()?.kind !== "asked") setSettings(undefined);
      },
      { defer: true },
    ),
  );

  /** Say something else at this point instead: what came after it goes, and the net goes back to how it was then. */
  const edit = async (index: number, text: string) => {
    if (ed.screen().kind !== "net") return ed.notify("Close what's open first.");
    await moving;
    const t = current();
    await interrupt(t, "message");
    const e = t.entries()[index];
    if (e?.kind !== "user" || !e.at) return;
    t.setEntries((es) => es.slice(0, index));
    t.conversation = rewind(t.conversation, e.at);
    try {
      if (printed() !== e.at.doc && !put(e.at.doc)) ed.notify("The net is back as it was before that message.", true);
    } catch (err) {
      console.error("couldn't restore the net", err);
      ed.notify("Couldn't put the net back as it was, so it's staying as it is.");
    }
    return begin(t, text);
  };

  /** Ask again what this turn was asked. A message saved before edits existed has nowhere to go back to, so it's simply sent again. */
  const retry = (index: number) => {
    const asked = entries()[index - 1];
    if (asked?.kind !== "user") return;
    withModel(() => void (asked.at ? edit(index - 1, asked.text) : send(asked.text)), "retry");
  };

  return {
    id,
    entries,
    chats,
    /** What the chat on the screen is called. */
    title: () => chats().find((c) => c.id === id())?.title ?? titleOf(entries()),
    loaded,
    open,
    setOpen,
    /** Whether a reply is going on in the chat on the screen. */
    busy: () => replying().has(id()),
    /** The chats with a reply going on in this tab, on the screen or not. */
    replying,
    draft,
    setDraft,
    models,
    /** The model the chat on the screen uses, if there is one yet. */
    choice: () => chosen(current()),
    /** Whether the chat on the screen has a model it can use right now. */
    usable,
    setModel(provider: string, model: string) {
      const c = chosen(current());
      choose(current(), { provider, model, effort: c?.effort ?? "default" });
    },
    setEffort(effort: Effort) {
      const c = chosen(current());
      if (!c) return;
      models.forgetRefusal(c.provider, c.model, effort);
      choose(current(), { ...c, effort });
    },
    /** The settings on the screen. */
    settings,
    openSettings: () => setSettings({ kind: "asked" }),
    /** The settings, to put right what stopped this turn. Once saved, it goes again by itself: from where it got to if there's anything to go on, otherwise from the start. */
    fixSettings(index: number) {
      const t = current();
      const e = t.entries()[index];
      if (e?.kind !== "turn" || e.turn.phase.kind !== "over" || e.turn.phase.end.kind !== "failed") return;
      const { code, message } = e.turn.phase.end;
      const action = canResume(e.turn) ? "resume" : "retry";
      setSettings({
        kind: "fixing",
        code,
        message,
        action,
        then: () => {
          // Another tab may have moved the chat on by now.
          if (t !== current() || index !== t.entries().length - 1) return;
          if (action === "resume") withModel(() => void resume(), "resume");
          else retry(index);
        },
      });
    },
    /**
     * Leave the settings. Having saved them, a chat that needed a model takes the new
     * choice, one that already has a model takes the parts of it that `takes` says were
     * changed, and whatever was waiting goes ahead. A chat that goes by the choice for
     * new chats has nothing to change.
     */
    closeSettings(saved = false, takes: ChatTakes = { model: true, level: false }) {
      const why = settings();
      setSettings(undefined);
      if (!saved) return;
      const t = current();
      const made = models.defaults();
      const had = t.choice();
      if (made && why?.kind !== "waiting" && had && models.usable(had)) {
        if (takes.model || takes.level) choose(t, { ...(takes.model ? made : had), effort: takes.level ? made.effort : had.effort });
      } else if (made && (why?.kind === "waiting" || !models.usable(chosen(t)))) t.setChoice(made);
      if (why?.kind !== "asked") why?.then();
    },
    withModel,
    send,
    stop() {
      const t = current();
      t.cutBy = "stop";
      t.running?.stop.abort();
    },
    /** Start another conversation. This one stays in the list, and any reply going on in it carries on. */
    newChat: () => move(async () => fresh()),
    /** Go to a chat from the list. The canvas stays as it is. */
    openChat: (chatId: string) =>
      move(async () => {
        if (chatId === id()) return;
        const going = live.get(chatId);
        if (going) {
          setCurrent(going);
          return remember(chatId);
        }
        const saved = await store?.read(chatId);
        if (saved) show(chatId, saved);
        else setChats((l) => l.filter((c) => c.id !== chatId));
      }),
    /** Delete a chat for good. This is the one thing that ends a reply without saving how far it got. */
    deleteChat: (chatId: string) =>
      move(async () => {
        const t = current().id === chatId ? current() : live.get(chatId);
        if (t) {
          t.running?.stop.abort();
          setRunning(t, undefined);
        }
        await store?.remove(chatId);
        setChats((l) => l.filter((c) => c.id !== chatId));
        news.postMessage({ id: chatId, gone: true } satisfies News);
        if (t === current()) fresh();
      }),
    edit,
    retry,
    resume: () => withModel(() => void resume(), "resume"),
    /** Go back to a document from earlier in the chat. If it isn't what the model last saw, its next message shows it. */
    loadDocument(code: string) {
      if (ed.screen().kind !== "net") return ed.notify("Close what's open first.");
      if (!put(code)) ed.notify("Loaded it. You can undo this.", true);
      // So a reply that finished elsewhere says it's on the canvas now. It's not news worth another tab's while, so it's saved along with whatever comes next.
      const shown = printed();
      current().setEntries((es) => es.map((e) => (e.kind === "turn" && e.turn.phase.kind === "over" && e.turn.phase.end.kind === "applied" && e.turn.phase.end.code === code ? { ...e, turn: { ...e.turn, phase: { kind: "over", end: { ...e.turn.phase.end, shown } } } } : e)));
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
