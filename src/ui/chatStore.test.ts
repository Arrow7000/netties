import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE, TITLE_SYSTEM } from "../create/prompt";
import { createEditor } from "../state/editor";
import { printProgram } from "../core/programText";
import { decode } from "../state/persist";
import { openChats } from "./chatDb";
import { type Chat, createChat } from "./chatStore";

const OLD_KEY = "netties:chat";
/** A browser that has a model set up already. */
const SET_UP = { providers: { custom: { url: "https://model.test/v1" } }, default: { provider: "custom", model: "m", effort: "default" } };

const storage = (store: Map<string, string>) => ({
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

/** Tabs of one browser: localStorage and the database are shared, and what a tab announces is heard by the others. */
function browser() {
  const local = new Map<string, string>();
  local.set("netties:models", JSON.stringify(SET_UP));
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
  const calls: { url: string; headers: Record<string, string>; body: { model: string; reasoning_effort?: string; messages: { role: string; content: unknown }[] }; signal?: AbortSignal; say(ev: { type: "thinking" | "text"; text: string }): void; end(text: string): void; fail(): void; finish(reason: string): void }[] = [];
  const enc = new TextEncoder();
  const data = (o: object | string) => enc.encode(`data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`);
  const delta = (d: object, finish_reason: string | null = null) => data({ choices: [{ delta: d, finish_reason }] });
  vi.stubGlobal("fetch", async (url: string, o: { body?: string; signal?: AbortSignal; headers?: Record<string, string> }) => {
    if (!o.body) return new Response("Not found", { status: 404 });
    const sent = JSON.parse(o.body) as (typeof calls)[number]["body"];
    const [system, ...messages] = sent.messages;
    if (system!.content === TITLE_SYSTEM) {
      if (!title) return new Response("Not found", { status: 404 });
      const named = await title(messages[0]!.content as string);
      const dec = new TextDecoder();
      return new Response(dec.decode(delta({ content: named }, "stop")) + dec.decode(data("[DONE]")));
    }
    let c!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (x) => void (c = x) });
    o.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
    const say = (ev: { type: "thinking" | "text"; text: string }) => c.enqueue(delta(ev.type === "thinking" ? { reasoning: ev.text } : { content: ev.text }));
    calls.push({
      url,
      headers: o.headers ?? {},
      body: { ...sent, messages },
      signal: o.signal,
      say,
      end(text) {
        say({ type: "text", text });
        c.enqueue(delta({}, "stop"));
        c.enqueue(data("[DONE]"));
        c.close();
      },
      fail: () => c.error(new TypeError("network error")),
      finish(reason) {
        c.enqueue(delta({}, reason));
        c.enqueue(data("[DONE]"));
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

    describe("chats from before the model named them", () => {
      const chat = (text: string) => ({ entries: [{ kind: "user" as const, text }, { kind: "turn" as const, turn: { tries: [], phase: { kind: "over" as const, end: { kind: "said" as const } }, since: 1 } }], conversation: { messages: [] } });
      const put = async (id: string, title: string, updated: number, named?: boolean) => (await openChats()).write({ id, title, updated, named }, chat(title + " and the rest of it"));

      it("aren't named just for being there, since that's the visitor's money", async () => {
        const b = browser();
        const said: string[] = [];
        model((s) => (said.push(s), "Named"));
        await put("newer", "cats", 2000);
        await put("older", "dogs", 1000);
        const t = b.open();
        await ready(t);
        await settled();
        expect(said).toEqual([]);
        expect(t.chat.chats().map((c) => c.title)).toEqual(["cats", "dogs"]);
      });

      it("get a name from what they first said when they're next added to, and it's asked only once", async () => {
        const b = browser();
        const said: string[] = [];
        const calls = model((s) => (said.push(s), "Named"));
        await put("it", "cats", 2000);
        const t = b.open();
        await ready(t);
        await say(t, calls, "more");
        await vi.waitFor(() => expect(t.chat.title()).toBe("Named"));
        await say(t, calls, "and more");
        expect(said).toEqual(["cats and the rest of it"]);
        expect(t.chat.chats()[0]).toMatchObject({ id: "it", title: "Named", named: true });
      });

      it("a reply going on when the name arrives isn't disturbed", async () => {
        const b = browser();
        let answer!: (t: string) => void;
        const calls = model(() => new Promise((r) => (answer = r)));
        await put("it", "cats", 2000);
        const t = b.open();
        await ready(t);
        void t.send("more");
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        await vi.waitFor(() => expect(answer).toBeDefined());
        answer("Named");
        await vi.waitFor(() => expect(t.chat.title()).toBe("Named"));
        expect(calls[0]!.signal?.aborted).toBe(false);
        expect(t.chat.busy()).toBe(true);
      });

      it("if naming fails it keeps the first line, and gets another go after a reload", async () => {
        const b = browser();
        const seen: string[] = [];
        let up = false;
        const calls = model((s) => {
          seen.push(s);
          if (!up) throw new Error("offline");
          return "Named";
        });
        await put("one", "cats", 2000);
        const t = b.open();
        await ready(t);
        await say(t, calls, "more");
        await say(t, calls, "and more");
        expect(seen).toHaveLength(1);
        expect(t.chat.title()).toBe("cats and the rest of it");
        up = true;
        const next = b.open(t.session);
        await ready(next);
        await say(next, calls, "again");
        await vi.waitFor(() => expect(next.chat.title()).toBe("Named"));
      });

      it("a chat deleted while it's being named stays gone", async () => {
        const b = browser();
        let answer!: (t: string) => void;
        const calls = model(() => new Promise((r) => (answer = r)));
        await put("it", "cats", 2000);
        const t = b.open();
        await ready(t);
        await say(t, calls, "more");
        await vi.waitFor(() => expect(answer).toBeDefined());
        await t.deleteChat("it");
        answer("Late");
        await settled();
        expect(t.chat.chats()).toEqual([]);
        expect(await (await openChats()).list()).toEqual([]);
      });
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

  describe("the model", () => {
    const noModel = (b: ReturnType<typeof browser>) => b.local.delete("netties:models");

    it("picked in a chat stays with that chat, leaving the default and what's saved for the provider alone", async () => {
      const b = browser();
      model();
      const t = b.open();
      await ready(t);
      t.chat.setModel("custom", "picked");
      expect(t.chat.choice()).toMatchObject({ model: "picked" });
      expect(t.chat.models.defaults()).toMatchObject({ model: "m" });
      expect(t.chat.models.entry("custom")?.model).toBeUndefined();
    });

    it("that turns down a reasoning level is said once, and the chat doesn't go on claiming it", async () => {
      const b = browser();
      const calls = model();
      const real = fetch;
      const sent: string[] = [];
      vi.stubGlobal("fetch", async (url: string, o: { body?: string }) => (o.body && sent.push(o.body) && "reasoning_effort" in JSON.parse(o.body) ? new Response("Unknown argument: reasoning_effort", { status: 400 }) : real(url, o as RequestInit)));
      const t = b.open();
      await ready(t);
      t.chat.setEffort("high");
      const note = (i: number) => {
        const e = t.chat.entries()[i];
        return e?.kind === "turn" ? e.turn.tries[0]?.note : undefined;
      };
      expect(t.chat.models.refusesLevel("custom", "m", "high")).toBe(false);
      const first = t.send("One.");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.end("Done.");
      await first;
      expect(note(1)).toContain("reasoning level High");
      expect(t.chat.models.refusesLevel("custom", "m", "high")).toBe(true);
      expect(t.chat.models.refusesLevel("custom", "m", "low")).toBe(false);
      const second = t.send("Two.");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      calls[1]!.end("Done.");
      await second;
      expect(note(3)).toBeUndefined();
      // Not asked for again, unless it's picked again.
      expect("reasoning_effort" in JSON.parse(sent.at(-1)!)).toBe(false);
      t.chat.setEffort("high");
      expect(t.chat.models.refusesLevel("custom", "m", "high")).toBe(false);
    });

    describe("when a provider goes", () => {
      /** OpenAI and a local server, with the default on OpenAI. */
      const two = { providers: { openai: { key: "k", model: "gpt" }, ollama: { url: "http://localhost:11434/v1", model: "llama" } }, default: { provider: "openai", model: "gpt", effort: "high" } };

      it("forgetting a key keeps the address and model, and a new chat falls back on what's still set up", async () => {
        const b = browser();
        model();
        b.local.set("netties:models", JSON.stringify(two));
        const t = b.open();
        await ready(t);
        t.chat.models.forgetKey("openai");
        expect(t.chat.models.entry("openai")).toEqual({ model: "gpt" });
        expect(t.chat.models.ready()).toEqual(["ollama"]);
        expect(t.chat.models.defaults()).toEqual({ provider: "ollama", model: "llama", effort: "high" });
        expect(t.chat.usable()).toBe(true);
      });

      it("removing one takes it off the list, and the default with it if it was there", async () => {
        const b = browser();
        model();
        b.local.set("netties:models", JSON.stringify({ ...two, default: { provider: "ollama", model: "llama", effort: "default" } }));
        const t = b.open();
        await ready(t);
        t.chat.models.remove("ollama");
        expect(t.chat.models.entry("ollama")).toBeUndefined();
        expect(t.chat.models.ready()).toEqual(["openai"]);
        expect(t.chat.models.defaults()).toMatchObject({ provider: "openai", model: "gpt" });
      });

      it("asks all over again only when nothing's left", async () => {
        const b = browser();
        model();
        b.local.set("netties:models", JSON.stringify({ providers: { openai: { key: "k", model: "gpt" } }, default: { provider: "openai", model: "gpt", effort: "default" } }));
        const t = b.open();
        await ready(t);
        t.chat.models.forgetKey("openai");
        expect(t.chat.usable()).toBe(false);
        // Still knows where it was, to ask for the key there.
        expect(t.chat.models.defaults()).toMatchObject({ provider: "openai", model: "gpt" });
      });
    });

    it("isn't needed to read past chats, even with the keys gone", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "kept", "Still here.");
      t.chat.models.remove("custom");
      const again = b.open(t.session);
      await ready(again);
      expect(again.chat.entries()).toHaveLength(2);
      expect(again.chat.usable()).toBe(false);
      expect(again.chat.settings()).toBeUndefined();
    });

    it("is asked for when going on with a chat, and what was waiting goes ahead once there is one", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "kept");
      t.chat.models.remove("custom");
      let went = false;
      t.chat.withModel(() => (went = true));
      expect(t.chat.settings()).toBeDefined();
      expect(went).toBe(false);
      t.chat.closeSettings();
      expect(t.chat.settings()).toBeUndefined();
      expect(went).toBe(false);
      t.chat.withModel(() => (went = true));
      t.chat.models.save("custom", { url: "https://new.test/v1", model: "fresh" }, "default");
      t.chat.closeSettings(true);
      expect(went).toBe(true);
      expect(t.chat.choice()).toMatchObject({ model: "fresh" });
    });

    describe("put right from a failed reply", () => {
      /** A chat whose reply was refused. */
      const refused = async (b: ReturnType<typeof browser>, calls: ReturnType<typeof model>) => {
        const t = b.open();
        await ready(t);
        const real = fetch;
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "The key was turned down." } }), { status: 401 }));
        await t.send("Double 2.");
        vi.stubGlobal("fetch", real);
        expect(calls).toHaveLength(0);
        return t;
      };

      it("says why it's there, and goes again after saving, on what was saved", async () => {
        const b = browser();
        const calls = model();
        const t = await refused(b, calls);
        t.chat.fixSettings(1);
        expect(t.chat.settings()).toMatchObject({ kind: "fixing", code: "key", message: expect.stringContaining("The key was turned down."), action: "retry" });
        t.chat.models.save("custom", { url: "https://other.test/v1", model: "better" }, "default");
        t.chat.closeSettings(true);
        expect(t.chat.choice()).toMatchObject({ provider: "custom", model: "better" });
        await vi.waitFor(() => expect(calls).toHaveLength(1));
      });

      it("stays on the chat's own model when it only keeps a new key, and leaves the default alone", async () => {
        const b = browser();
        const calls = model();
        const t = await refused(b, calls);
        t.chat.setModel("custom", "picked");
        t.chat.fixSettings(1);
        t.chat.models.save("custom", { url: "https://model.test/v1", key: "new", model: "m" }, "default", false);
        t.chat.closeSettings(true, { model: false, level: false });
        expect(t.chat.choice()).toMatchObject({ model: "picked" });
        expect(t.chat.models.defaults()).toMatchObject({ model: "m" });
        await vi.waitFor(() => expect(calls).toHaveLength(1));
      });

      it("does nothing on Cancel, and lets go on moving to another chat", async () => {
        const b = browser();
        const calls = model();
        const t = await refused(b, calls);
        t.chat.fixSettings(1);
        t.chat.closeSettings();
        expect(t.chat.settings()).toBeUndefined();
        t.chat.fixSettings(1);
        await t.chat.newChat();
        await settled();
        expect(t.chat.settings()).toBeUndefined();
        expect(calls).toHaveLength(0);
      });
    });

    it("a new chat with nothing set up can't start, and starts going by the settings", async () => {
      const b = browser();
      noModel(b);
      const t = b.open();
      await ready(t);
      expect(t.chat.usable()).toBe(false);
      t.chat.models.save("custom", { url: "https://new.test/v1", model: "fresh" }, "high");
      expect(t.chat.usable()).toBe(true);
      expect(t.chat.choice()).toEqual({ provider: "custom", model: "fresh", effort: "high" });
    });

    it("can be changed part way through a chat, the next reply uses it, and each turn says which it came from", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "one");
      t.chat.setModel("custom", "other");
      t.chat.setEffort("high");
      await say(t, calls, "two");
      expect(calls[0]!.body).toMatchObject({ model: "m" });
      expect(calls[0]!.body.reasoning_effort).toBeUndefined();
      expect(calls[1]!.body).toMatchObject({ model: "other", reasoning_effort: "high" });
      const turns = t.chat.entries().flatMap((e) => (e.kind === "turn" ? [e.turn.by?.model] : []));
      expect(turns).toEqual(["m", "other"]);
    });

    it("stays with each chat, through a reload, without changing the choice for new ones or the order of the list", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "old chat");
      const id = t.chat.id();
      now += 1000;
      await t.newChat();
      await say(t, calls, "new chat");
      await t.openChat(id);
      now += 1000;
      t.chat.setModel("custom", "other");
      await settled();
      expect(t.chat.chats().map((c) => c.title)).toEqual(["new chat", "old chat"]);
      expect((await (await openChats()).list()).map((c) => c.title)).toEqual(["new chat", "old chat"]);
      const again = b.open(t.session);
      await ready(again);
      expect(again.chat.choice()?.model).toBe("other");
      await again.newChat();
      expect(again.chat.choice()?.model).toBe("m");
    });

    it("a chat keeps the model it started with when the choice for new chats changes", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      await say(t, calls, "one");
      t.chat.models.save("custom", { url: "https://model.test/v1", model: "later" }, "default");
      expect(t.chat.choice()?.model).toBe("m");
      await t.newChat();
      expect(t.chat.choice()?.model).toBe("later");
    });

    describe("changed in the settings during a chat", () => {
      const started = async () => {
        const b = browser();
        const calls = model();
        const t = b.open();
        await ready(t);
        await say(t, calls, "one");
        return { t, calls };
      };

      it("moves the chat to the new model, and the next reply goes there", async () => {
        const { t, calls } = await started();
        t.chat.openSettings();
        t.chat.models.save("custom", { url: "https://model.test/v1", model: "smaller" }, "default");
        t.chat.closeSettings(true, { model: true, level: false });
        expect(t.chat.choice()).toMatchObject({ model: "smaller" });
        await say(t, calls, "two");
        expect(calls.at(-1)!.body).toMatchObject({ model: "smaller" });
      });

      it("keeps the chat's own reasoning level when only the model changed", async () => {
        const { t } = await started();
        t.chat.setEffort("high");
        t.chat.openSettings();
        t.chat.models.save("custom", { url: "https://model.test/v1", model: "smaller" }, "default");
        t.chat.closeSettings(true, { model: true, level: false });
        expect(t.chat.choice()).toMatchObject({ model: "smaller", effort: "high" });
      });

      it("takes a new reasoning level and stays on its model when that's all that changed", async () => {
        const { t } = await started();
        t.chat.setModel("custom", "picked");
        t.chat.openSettings();
        t.chat.models.save("custom", { url: "https://model.test/v1", model: "m" }, "high");
        t.chat.closeSettings(true, { model: false, level: true });
        expect(t.chat.choice()).toMatchObject({ model: "picked", effort: "high" });
      });

      it("stays as it is when neither changed, as with only a new key", async () => {
        const { t } = await started();
        t.chat.setModel("custom", "picked");
        t.chat.openSettings();
        t.chat.models.save("custom", { url: "https://model.test/v1", key: "new", model: "m" }, "default");
        t.chat.closeSettings(true, { model: false, level: false });
        expect(t.chat.choice()).toMatchObject({ model: "picked" });
      });

      it("stays as it is on Cancel", async () => {
        const { t } = await started();
        t.chat.openSettings();
        t.chat.closeSettings();
        expect(t.chat.choice()).toMatchObject({ model: "m" });
      });

      it("leaves a chat with nothing in it going by the choice for new chats", async () => {
        const b = browser();
        model();
        const t = b.open();
        await ready(t);
        t.chat.openSettings();
        t.chat.models.save("custom", { url: "https://model.test/v1", model: "later" }, "default");
        t.chat.closeSettings(true, { model: true, level: false });
        t.chat.models.save("custom", { url: "https://model.test/v1", model: "later still" }, "default");
        expect(t.chat.choice()).toMatchObject({ model: "later still" });
      });
    });

    it("keeps the key out of what's saved with the chats", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      t.chat.models.save("custom", { url: "https://model.test/v1", key: "sekret", model: "m" }, "default");
      await say(t, calls, "hello");
      expect(calls[0]!.headers.authorization).toBe("Bearer sekret");
      expect(JSON.stringify(await reading(t.chat.id()))).not.toContain("sekret");
    });
  });

  describe("resuming", () => {
    const lastTurn = (t: Tab) => {
      const e = t.chat.entries().at(-1);
      if (e?.kind !== "turn") throw new Error("no turn");
      return e.turn;
    };

    it("picks up a dropped reply in the same turn, with no new message, and it can land on the canvas", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      const going = t.send("Double 2.");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "thinking", text: "First the zero." });
      calls[0]!.say({ type: "text", text: "Here go" });
      await settled();
      calls[0]!.fail();
      await going;
      expect(lastTurn(t).phase).toMatchObject({ kind: "over", end: { kind: "failed", code: "dropped" } });
      expect(t.chat.entries()).toHaveLength(2);

      t.chat.resume();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(t.chat.busy()).toBe(true);
      expect(t.chat.entries()).toHaveLength(2);
      const sent = JSON.stringify(calls[1]!.body.messages);
      expect(sent).toContain("First the zero.");
      expect(sent).toContain("Here go");
      expect(sent).toContain("Carry on from exactly where you left off");
      calls[1]!.end("es.\n\n```inet\n" + EXAMPLE + "\n```");
      await vi.waitFor(() => expect(t.chat.busy()).toBe(false));
      expect(t.chat.entries()).toHaveLength(2);
      expect(lastTurn(t).tries.map((x) => x.reply.slice(0, 7))).toEqual(["Here go", "es.\n\n``"]);
      expect(lastTurn(t).phase).toMatchObject({ kind: "over", end: { kind: "applied" } });
      expect(t.canvas()).toContain("agent");
    });

    it("picks up a reply that hit its length limit", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      const going = t.send("Long.");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "text", text: "Part" });
      await settled();
      calls[0]!.finish("length");
      await going;
      expect(lastTurn(t).phase).toMatchObject({ kind: "over", end: { kind: "failed", code: "cut-off" } });
      t.chat.resume();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      calls[1]!.end("And the rest.");
      await vi.waitFor(() => expect(t.chat.busy()).toBe(false));
      expect(lastTurn(t).phase).toMatchObject({ kind: "over", end: { kind: "said" } });
    });

    it("picks up a reply cut off by a reload, on whichever model is chosen now", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      void t.send("Double 2.");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "thinking", text: "Going along." });
      await settled();
      now += 3000;
      calls[0]!.say({ type: "thinking", text: " More." });
      await settled();
      t.leave();
      const again = b.open(t.session);
      await ready(again);
      expect(lastTurn(again).phase).toMatchObject({ kind: "over", end: { kind: "stopped", by: "reload" } });
      again.chat.setModel("custom", "other");
      again.chat.resume();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]!.body.model).toBe("other");
      expect(JSON.stringify(calls[1]!.body.messages)).toContain("Going along.");
      calls[1]!.end("Done.");
      await vi.waitFor(() => expect(again.chat.busy()).toBe(false));
      expect(lastTurn(again).by?.model).toBe("other");
    });

    it("asks for a model first if there isn't one, and doesn't start without it", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      const going = t.send("Double 2.");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "text", text: "Part" });
      await settled();
      calls[0]!.fail();
      await going;
      t.chat.models.remove("custom");
      t.chat.resume();
      await settled();
      expect(calls).toHaveLength(1);
      expect(t.chat.settings()).toBeDefined();
    });

    it("isn't offered twice at once", async () => {
      const b = browser();
      const calls = model();
      const t = b.open();
      await ready(t);
      const going = t.send("Double 2.");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]!.say({ type: "text", text: "Part" });
      await settled();
      calls[0]!.fail();
      await going;
      t.chat.resume();
      t.chat.resume();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      await settled();
      expect(calls).toHaveLength(2);
    });
  });
});
