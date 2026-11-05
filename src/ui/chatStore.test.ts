import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE } from "../create/prompt";
import { createEditor } from "../state/editor";
import { printProgram } from "../core/programText";
import { decode } from "../state/persist";
import { openChats } from "./chatDb";
import { type Chat, createChat } from "./chatStore";

const OLD_KEY = "netties:chat";

const storage = (store: Map<string, string>) => ({
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

/** Tabs of one browser: localStorage and the database are shared, and what a tab announces is heard by the others. */
function browser() {
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", storage(local));
  vi.stubGlobal("indexedDB", new IDBFactory());
  const channels: { onmessage?: (e: { data: unknown }) => void; postMessage(m: unknown): void }[] = [];
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage?: (e: { data: unknown }) => void;
      constructor() {
        channels.push(this);
      }
      postMessage(m: unknown) {
        const copy = structuredClone(m);
        for (const c of channels) if (c !== this) setTimeout(() => c.onmessage?.({ data: copy }), 0);
      }
    },
  );
  /** A tab, or a tab reloaded: that keeps its own sessionStorage. */
  const open = (session = new Map<string, string>()) => {
    const on: Record<string, ((e?: unknown) => void)[]> = {};
    vi.stubGlobal("window", { addEventListener: (k: string, f: (e?: unknown) => void) => (on[k] ??= []).push(f) });
    vi.stubGlobal("sessionStorage", storage(session));
    const ed = createEditor(undefined);
    const chat = createRoot(() => createChat(ed));
    /** sessionStorage is only used at the moment a tab moves, so stubbing it then is enough. */
    const as = <T,>(f: () => T): T => {
      vi.stubGlobal("sessionStorage", storage(session));
      return f();
    };
    return {
      chat,
      ed,
      session,
      send: (text: string) => as(() => chat.send(text)),
      newChat: () => as(() => chat.newChat()),
      openChat: (id: string) => as(() => chat.openChat(id)),
      deleteChat: (id: string) => as(() => chat.deleteChat(id)),
      leave: () => on.beforeunload?.forEach((f) => f()),
      canvas: () => printProgram(decode(ed.toDoc())),
    };
  };
  return { local, open };
}

/** The model, one call at a time, saying what it's told to. It names chats only if it's told how. */
function model(title?: (said: string) => string | Promise<string>) {
  const calls: { body: { messages: { role: string; content: unknown }[] }; signal?: AbortSignal; say(ev: object): void; end(text: string): void }[] = [];
  const enc = new TextEncoder();
  vi.stubGlobal("fetch", async (url: string, o: { body: string; signal?: AbortSignal }) => {
    if (url.endsWith("/title")) {
      if (!title) return new Response("Not found", { status: 404 });
      const named = await title((JSON.parse(o.body) as { messages: { content: string }[] }).messages[0]!.content);
      return new Response(JSON.stringify({ type: "text", text: named }) + "\n" + JSON.stringify({ type: "done", content: [] }) + "\n");
    }
    let c!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (x) => void (c = x) });
    o.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
    const say = (ev: object) => c.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
    calls.push({
      body: JSON.parse(o.body),
      signal: o.signal,
      say,
      end(text) {
        say({ type: "text", text });
        say({ type: "done", content: [{ type: "text", text }] });
        c.close();
      },
    });
    return new Response(body);
  });
  return calls;
}

const settled = () => new Promise((r) => setTimeout(r, 5));
const ready = (t: { chat: Chat }) => vi.waitFor(() => expect(t.chat.loaded()).toBe(true));
const reading = async (id: string) => (await openChats()).read(id);

describe("chats", () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Tab = ReturnType<ReturnType<typeof browser>["open"]>;
  type Calls = ReturnType<typeof model>;
  const say = async (t: Tab, calls: Calls, text: string, reply = "Hi there.") => {
    const before = calls.length;
    const going = t.send(text);
    await vi.waitFor(() => expect(calls.length).toBe(before + 1));
    calls.at(-1)!.end(reply);
    await going;
    await settled();
  };

  describe("the chat from before there was a list", () => {
    const old = { entries: [{ kind: "user", text: "kept\nand more" }, { kind: "turn", turn: { tries: [], phase: { kind: "over", end: { kind: "said" } }, since: 1 } }], conversation: { messages: [] } };

    it("moves over and carries on, and only once", async () => {
      const b = browser();
      b.local.set(OLD_KEY, JSON.stringify(old));
      const first = b.open();
      await ready(first);
      expect(first.chat.entries()).toHaveLength(2);
      expect(first.chat.chats().map((c) => c.title)).toEqual(["kept"]);
      expect(b.local.has(OLD_KEY)).toBe(false);
      const second = b.open();
      await ready(second);
      expect(second.chat.chats()).toHaveLength(1);
      expect(second.chat.id()).toBe(first.chat.id());
    });

    it("stays where it was if it can't be moved", async () => {
      const b = browser();
      b.local.set(OLD_KEY, JSON.stringify(old));
      vi.stubGlobal("indexedDB", { open: () => { throw new Error("no IndexedDB here"); } });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const t = b.open();
      await ready(t);
      expect(b.local.get(OLD_KEY)).toBe(JSON.stringify(old));
    });
  });

  describe("the list", () => {
    it("has a chat from its first message, named after that message, newest first", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      expect(t.chat.chats()).toEqual([]);
      await say(t, calls, "first chat\nwith two lines");
      await t.newChat();
      expect(t.chat.entries()).toEqual([]);
      expect(t.chat.chats()).toHaveLength(1);
      now += 1000;
      await say(t, calls, "second chat");
      expect(t.chat.chats().map((c) => c.title)).toEqual(["second chat", "first chat"]);
    });

    it("moving between chats brings back each one's words, and the model's memory of them", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "one");
      const one = t.chat.id();
      await t.newChat();
      await say(t, calls, "two");
      await t.openChat(one);
      expect(t.chat.entries()[0]).toMatchObject({ text: "one" });
      await say(t, calls, "one more");
      expect(JSON.stringify(calls.at(-1)!.body.messages)).toContain("one");
      expect(JSON.stringify(calls.at(-1)!.body.messages)).not.toContain("two");
    });

    it("moving between chats leaves the canvas alone, and the next message shows the model what's there", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      t.chat.setOpen(true);
      await say(t, calls, "make it", "Here.\n\n```inet\n" + EXAMPLE + "\n```");
      const made = t.canvas();
      const reply = t.chat.entries()[1];
      if (reply?.kind !== "turn" || reply.turn.phase.kind !== "over") throw new Error("expected a finished reply");
      const end = reply.turn.phase.end;
      expect(t.chat.onCanvas(end)).toBe(true);
      const first = t.chat.id();

      await t.newChat();
      await say(t, calls, "just a question");
      expect(t.canvas()).toBe(made);
      t.chat.loadDocument("agent A 0 \"a\"\n");
      const changed = t.canvas();
      expect(changed).not.toBe(made);

      await t.openChat(first);
      expect(t.canvas()).toBe(changed);
      expect(t.chat.onCanvas(end)).toBe(false);
      const going = t.send("next");
      await vi.waitFor(() => expect(JSON.stringify(calls.at(-1)!.body.messages)).toContain("next"));
      expect(JSON.stringify(calls.at(-1)!.body.messages.at(-1))).toContain("The document as it stands now");
      calls.at(-1)!.end("Fine.");
      await going;
    });

    it("a reply carries on while its chat isn't on the screen, and is still there going on when you come back", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      void t.send("long one");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "thinking", text: "Going along. " });
      await settled();
      const first = t.chat.id();

      await t.newChat();
      expect(calls[0]!.signal?.aborted).toBe(false);
      expect(t.chat.busy()).toBe(false);
      expect(t.chat.replying().has(first)).toBe(true);
      expect(t.chat.entries()).toEqual([]);

      calls[0]!.say({ type: "thinking", text: "Still going." });
      await settled();
      await t.openChat(first);
      expect(t.chat.busy()).toBe(true);
      expect(t.chat.entries()[1]).toMatchObject({ turn: { tries: [{ thinking: "Going along. Still going." }] } });

      calls[0]!.say({ type: "thinking", text: " And on." });
      await settled();
      expect(t.chat.entries()[1]).toMatchObject({ turn: { tries: [{ thinking: "Going along. Still going. And on." }] } });
      t.chat.stop();
      await vi.waitFor(() => expect(t.chat.busy()).toBe(false));
      expect(t.chat.entries()[1]).toMatchObject({ turn: { phase: { end: { kind: "stopped", by: "stop" } } } });
    });

    it("a reply that finishes elsewhere waits for its Load button, and then says it's on the canvas", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      t.chat.setOpen(true);
      const before = t.canvas();
      const going = t.send("make it");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const first = t.chat.id();
      await t.newChat();
      calls[0]!.end("Here.\n\n```inet\n" + EXAMPLE + "\n```");
      await going;
      await settled();
      expect(t.canvas()).toBe(before);
      expect(t.chat.replying().size).toBe(0);
      expect((await reading(first))?.entries.at(-1)).toMatchObject({ turn: { phase: { end: { kind: "applied" } } } });

      await t.openChat(first);
      expect(t.canvas()).toBe(before);
      const end = () => {
        const reply = t.chat.entries()[1];
        if (reply?.kind !== "turn" || reply.turn.phase.kind !== "over") throw new Error("expected a finished reply");
        return reply.turn.phase.end;
      };
      expect(t.chat.onCanvas(end())).toBe(false);
      const code = end().kind === "applied" ? (end() as { code: string }).code : "";
      t.chat.loadDocument(code);
      expect(t.canvas()).not.toBe(before);
      expect(t.chat.onCanvas(end())).toBe(true);
    });

    it("a reply that finishes after you've come back goes on the canvas as usual", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      t.chat.setOpen(true);
      const before = t.canvas();
      const going = t.send("make it");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const first = t.chat.id();
      await t.newChat();
      await t.openChat(first);
      calls[0]!.end("Here.\n\n```inet\n" + EXAMPLE + "\n```");
      await going;
      expect(t.canvas()).not.toBe(before);
    });

    it("replies can go on in several chats at once, each to its own", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      const one = t.send("one");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const first = t.chat.id();
      await t.newChat();
      const two = t.send("two");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      const second = t.chat.id();
      expect(t.chat.replying().size).toBe(2);
      calls[1]!.end("Reply two.");
      calls[0]!.end("Reply one.");
      await Promise.all([one, two]);
      await settled();
      expect(t.chat.replying().size).toBe(0);
      expect(JSON.stringify((await reading(first))?.conversation)).toContain("Reply one.");
      expect(JSON.stringify((await reading(first))?.conversation)).not.toContain("Reply two.");
      expect(JSON.stringify((await reading(second))?.conversation)).toContain("Reply two.");
    });

    it("Stop only stops the chat on the screen", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      void t.send("one");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await t.newChat();
      void t.send("two");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      t.chat.stop();
      await settled();
      expect(calls[1]!.signal?.aborted).toBe(true);
      expect(calls[0]!.signal?.aborted).toBe(false);
    });

    it("deleting a chat from the list stops a reply going on in it, and it doesn't come back", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      void t.send("doomed");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const doomed = t.chat.id();
      await t.newChat();
      await say(t, calls, "safe");
      const safe = t.chat.id();
      await t.deleteChat(doomed);
      await settled();
      expect(calls[0]!.signal?.aborted).toBe(true);
      expect(t.chat.replying().size).toBe(0);
      expect(t.chat.id()).toBe(safe);
      expect(t.chat.chats().map((c) => c.title)).toEqual(["safe"]);
      expect(await reading(doomed)).toBeUndefined();
    });

    it("leaving the page saves every reply that was going as cut off, on the screen or not", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      void t.send("one");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const first = t.chat.id();
      calls[0]!.say({ type: "thinking", text: "Thought one." });
      await settled();
      await t.newChat();
      void t.send("two");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      const second = t.chat.id();
      t.leave();
      await settled();
      for (const id of [first, second]) expect((await reading(id))?.entries.at(-1)).toMatchObject({ turn: { phase: { end: { kind: "stopped", by: "reload" } } } });
      expect(JSON.stringify((await reading(first))?.conversation)).toContain("Thought one.");
    });

    it("a reply held back for an open panel doesn't reach the canvas after moving to another chat", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      const empty = t.canvas();
      const going = t.send("make it");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const screen = vi.spyOn(t.ed, "screen").mockReturnValue({ kind: "rule" } as never);
      calls[0]!.end("Here.\n\n```inet\n" + EXAMPLE + "\n```");
      await going;
      expect(t.chat.entries()[1]).toMatchObject({ turn: { phase: { end: { kind: "ready" } } } });
      await t.newChat();
      screen.mockRestore();
      await settled();
      expect(t.canvas()).toBe(empty);
    });

    it("deleting a chat takes it out of the database and off every tab's list; a tab on it starts empty", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      await say(a, calls, "doomed");
      const doomed = a.chat.id();
      const onIt = b.open();
      await ready(onIt);
      expect(onIt.chat.id()).toBe(doomed);
      await a.newChat();
      await say(a, calls, "safe");
      const safe = a.chat.id();

      await a.deleteChat(doomed);
      await settled();
      expect(await reading(doomed)).toBeUndefined();
      expect(await reading(safe)).toBeDefined();
      expect(a.chat.id()).toBe(safe);
      expect(a.chat.chats().map((c) => c.title)).toEqual(["safe"]);
      expect(onIt.chat.chats().map((c) => c.title)).toEqual(["safe"]);
      expect(onIt.chat.entries()).toEqual([]);
      expect(onIt.chat.id()).not.toBe(doomed);
    });

    it("deleting the chat you're on, partway through a reply, stops it and doesn't bring the chat back", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      void t.send("doomed");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "thinking", text: "Going along." });
      await settled();
      const doomed = t.chat.id();
      await t.deleteChat(doomed);
      await settled();
      expect(calls[0]!.signal?.aborted).toBe(true);
      expect(t.chat.busy()).toBe(false);
      expect(t.chat.entries()).toEqual([]);
      expect(t.chat.chats()).toEqual([]);
      expect(await reading(doomed)).toBeUndefined();
    });
  });

  describe("names", () => {
    it("a chat goes by its first line until the model has named it, then by that, through a reload", async () => {
      const b = browser();
      let answer!: (t: string) => void;
      const calls = model(() => new Promise((r) => (answer = r)));
      const t = b.open();
      await ready(t);
      await say(t, calls, "can you make me an adder\nplease");
      expect(t.chat.title()).toBe("can you make me an adder");
      const updated = t.chat.chats()[0]!.updated;
      now += 1000;
      answer("\"Adding two numbers.\"");
      await vi.waitFor(() => expect(t.chat.title()).toBe("Adding two numbers"));
      await settled();
      expect(t.chat.chats()[0]).toMatchObject({ title: "Adding two numbers", updated });
      const reloaded = b.open(t.session);
      await ready(reloaded);
      expect(reloaded.chat.title()).toBe("Adding two numbers");
    });

    it("the name stays as the chat goes on, and is asked for only once", async () => {
      const b = browser();
      const said: string[] = [];
      const calls = model((s) => (said.push(s), "Adding"));
      const t = b.open();
      await ready(t);
      await say(t, calls, "one");
      await say(t, calls, "two");
      expect(said).toEqual(["one"]);
      expect(t.chat.chats()[0]!.title).toBe("Adding");
    });

    it("a chat stays by its first line if naming it fails", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "plain");
      expect(t.chat.title()).toBe("plain");
    });

    it("changing the first message names the chat again, and a name for the old one is dropped", async () => {
      const b = browser();
      const answers: ((t: string) => void)[] = [];
      const calls = model(() => new Promise((r) => answers.push(r)));
      const t = b.open();
      await ready(t);
      await say(t, calls, "about cats");
      await vi.waitFor(() => expect(answers).toHaveLength(1));
      const going = t.chat.edit(0, "about dogs");
      await vi.waitFor(() => expect(answers).toHaveLength(2));
      answers[0]!("Cats");
      await settled();
      expect(t.chat.title()).toBe("about dogs");
      answers[1]!("Dogs");
      await vi.waitFor(() => expect(t.chat.title()).toBe("Dogs"));
      calls.at(-1)!.end("Woof.");
      await going;
      await settled();
      expect(t.chat.title()).toBe("Dogs");
    });

    it("a name reaches other tabs without stopping the reply going on there, and sticks when they save", async () => {
      const b = browser();
      let answer!: (t: string) => void;
      const calls = model(() => new Promise((r) => (answer = r)));
      const a = b.open();
      await ready(a);
      const first = a.send("first");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const other = b.open();
      await ready(other);
      await vi.waitFor(() => expect(answer).toBeDefined());
      // The tab that asked goes elsewhere, and the name arrives while the other tab has a reply going.
      calls[0]!.end("Hi.");
      await first;
      await settled();
      const second = other.send("second");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      answer("The name");
      await vi.waitFor(() => expect(other.chat.title()).toBe("The name"));
      expect(calls[1]!.signal?.aborted).toBe(false);
      calls[1]!.end("Hi again.");
      await second;
      await settled();
      expect((await (await openChats()).list())[0]!.title).toBe("The name");
    });

    it("a name that comes after the chat is deleted doesn't bring it back", async () => {
      const b = browser();
      let answer!: (t: string) => void;
      const calls = model(() => new Promise((r) => (answer = r)));
      const t = b.open();
      await ready(t);
      await say(t, calls, "doomed");
      const doomed = t.chat.id();
      await t.deleteChat(doomed);
      answer("Late");
      await settled();
      expect(t.chat.chats()).toEqual([]);
      expect(await (await openChats()).list()).toEqual([]);
    });
  });

  describe("across tabs and reloads", () => {
    it("a reload stays on this tab's chat; a new tab starts on the one last moved to", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      await say(a, calls, "one");
      const one = a.chat.id();
      await a.newChat();
      await say(a, calls, "two");
      const two = a.chat.id();

      const other = b.open();
      await ready(other);
      expect(other.chat.id()).toBe(two);
      await other.openChat(one);
      expect(a.chat.id()).toBe(two);

      const next = b.open();
      await ready(next);
      expect(next.chat.id()).toBe(one);
      const reloaded = b.open(a.session);
      await ready(reloaded);
      expect(reloaded.chat.id()).toBe(two);
    });

    it("two tabs starting empty don't end up in the same chat", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      const c = b.open();
      await ready(c);
      expect(c.chat.id()).not.toBe(a.chat.id());
      await say(a, calls, "from a");
      expect(c.chat.entries()).toEqual([]);
      expect(c.chat.chats().map((x) => x.title)).toEqual(["from a"]);
    });

    it("a tab with nothing new leaves what's saved alone when it closes", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      await say(a, calls, "hello");
      const id = a.chat.id();
      const old = b.open();
      await ready(old);
      const before = await reading(id);
      now += 1000;
      await say(a, calls, "again");
      const after = await reading(id);
      old.leave();
      await settled();
      expect(before?.entries).toHaveLength(2);
      expect(await reading(id)).toEqual(after);
    });

    it("a tab that closes partway through a reply saves it as cut off", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      void a.send("hello");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "thinking", text: "Let me see." });
      await settled();
      a.leave();
      await settled();
      const saved = await reading(a.chat.id());
      expect(saved?.entries.at(-1)).toMatchObject({ turn: { tries: [{ thinking: "Let me see." }], phase: { kind: "over", end: { kind: "stopped", by: "reload" } } } });
      expect(JSON.stringify(saved?.conversation)).toContain("My reasoning so far");
    });

    it("another tab on the chat sees a reply come in, without disturbing what hasn't changed", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      void a.send("hello");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const other = b.open();
      await ready(other);
      const said = other.chat.entries()[0];
      now += 5000;
      calls[0]!.say({ type: "thinking", text: "Let me see." });
      await vi.waitFor(() => expect(other.chat.entries()[1]).toMatchObject({ turn: { tries: [{ thinking: "Let me see." }] } }));
      expect(other.chat.entries()[0]).toBe(said);
      expect(other.chat.busy()).toBe(false);
      expect(a.chat.busy()).toBe(true);
    });

    it("speaking in another tab on the chat stops a reply going in the first, and the model hears how far it got", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      void a.send("first");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const other = b.open();
      await ready(other);
      now += 5000;
      calls[0]!.say({ type: "thinking", text: "Going along." });
      await vi.waitFor(() => expect(other.chat.entries()[1]).toMatchObject({ turn: { tries: [{ thinking: "Going along." }] } }));

      const second = other.send("second");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      await vi.waitFor(() => expect(calls[0]!.signal?.aborted).toBe(true));
      expect(a.chat.busy()).toBe(false);
      expect(JSON.stringify(calls[1]!.body.messages)).toContain("Going along.");

      calls[1]!.end("Second reply.");
      await second;
      await vi.waitFor(() => expect(a.chat.entries()[3]).toMatchObject({ turn: { phase: { kind: "over", end: { kind: "said" } } } }));
      expect(a.chat.entries()[1]).toMatchObject({ turn: { phase: { end: { kind: "stopped", by: "message" } } } });
      a.leave();
      other.leave();
      await settled();
      expect((await reading(a.chat.id()))?.entries).toHaveLength(4);
    });

    it("a reply going in a tab on another chat is left alone", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      void a.send("first");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const other = b.open();
      await ready(other);
      await other.newChat();
      const second = other.send("second");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      calls[1]!.end("Second reply.");
      await second;
      await settled();
      expect(calls[0]!.signal?.aborted).toBe(false);
      expect(a.chat.busy()).toBe(true);
      expect(a.chat.entries()).toHaveLength(2);
    });

    it("a document from another tab isn't put on this tab's canvas, so the next message here shows the model this one", async () => {
      const b = browser();
      const calls = model();
      const a = b.open();
      await ready(a);
      const going = a.send("make it");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const other = b.open();
      await ready(other);
      calls[0]!.end("Here.\n\n```inet\n" + EXAMPLE + "\n```");
      await going;
      await settled();
      const reply = other.chat.entries()[1];
      if (reply?.kind !== "turn" || reply.turn.phase.kind !== "over") throw new Error("expected a finished reply");
      expect(other.chat.onCanvas(reply.turn.phase.end)).toBe(false);
      void other.send("next");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(JSON.stringify(calls[1]!.body.messages.at(-1))).toMatch(/The document (as it stands now|is empty)/);
    });
  });
});
