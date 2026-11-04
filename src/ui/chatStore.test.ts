import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE } from "../create/prompt";
import { createEditor } from "../state/editor";
import { type Chat, createChat } from "./chatStore";

const KEY = "netties:chat";

/** Tabs of one browser: storage is shared, and a write is heard by every tab but the one that made it. */
function browser() {
  const store = new Map<string, string>();
  const tabs: { on: Record<string, ((e?: unknown) => void)[]>; chat: Chat; leave: () => void }[] = [];
  let writing: unknown;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem(k: string, v: string) {
      store.set(k, v);
      for (const t of tabs) if (t !== writing) t.on.storage?.forEach((f) => f({ key: k, newValue: v }));
    },
    removeItem(k: string) {
      store.delete(k);
      for (const t of tabs) if (t !== writing) t.on.storage?.forEach((f) => f({ key: k, newValue: null }));
    },
  });
  /** Everything a tab does happens as that tab. */
  const as = <T,>(t: unknown, f: () => T): T => {
    writing = t;
    return f();
  };
  const open = () => {
    const on: Record<string, ((e?: unknown) => void)[]> = {};
    vi.stubGlobal("window", { addEventListener: (k: string, f: (e?: unknown) => void) => (on[k] ??= []).push(f) });
    const chat = createRoot(() => createChat(createEditor(undefined)));
    const tab = { on, chat, leave: () => as(tab, () => on.beforeunload?.forEach((f) => f())) };
    tabs.push(tab);
    return { ...tab, send: (text: string) => as(tab, () => chat.send(text)), reset: () => as(tab, () => chat.reset()) };
  };
  return { store, open };
}

/** The model, one call at a time, saying what it's told to. */
function model() {
  const calls: { body: { messages: { role: string; content: unknown }[] }; signal?: AbortSignal; say(ev: object): void; end(text: string): void }[] = [];
  const enc = new TextEncoder();
  vi.stubGlobal("fetch", async (_: string, o: { body: string; signal?: AbortSignal }) => {
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

const settled = () => new Promise((r) => setTimeout(r, 0));
const saved = (store: Map<string, string>) => JSON.parse(store.get(KEY) ?? "null") as { entries: { kind: string; turn?: { phase: { kind: string; end?: { kind: string; by?: string } } } }[] } | null;

describe("the chat across tabs", () => {
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

  const chatWithOneReply = async (b: ReturnType<typeof browser>, calls: ReturnType<typeof model>) => {
    const a = b.open();
    const going = a.send("hello");
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    calls.at(-1)!.end("Hi there.");
    await going;
    return a;
  };

  it("a tab with nothing new leaves what's saved alone when it closes", () => {
    const b = browser();
    const old = b.open();
    // Put there behind its back, as when a chat was moved here from another port.
    b.store.set(KEY, JSON.stringify({ entries: [{ kind: "user", text: "kept" }], conversation: { messages: [] } }));
    old.leave();
    expect(saved(b.store)?.entries).toHaveLength(1);
  });

  it("a tab follows what's said in another, and closing it changes nothing", async () => {
    const b = browser();
    const calls = model();
    const other = b.open();
    await chatWithOneReply(b, calls);
    expect(other.chat.entries()).toHaveLength(2);
    const before = b.store.get(KEY);
    other.leave();
    expect(b.store.get(KEY)).toBe(before);
  });

  it("New chat in one tab empties the others, for good", async () => {
    const b = browser();
    const calls = model();
    const other = b.open();
    const a = await chatWithOneReply(b, calls);
    a.reset();
    expect(other.chat.entries()).toEqual([]);
    other.leave();
    expect(b.store.has(KEY)).toBe(false);
  });

  it("a tab that closes partway through a reply saves it as cut off", async () => {
    const b = browser();
    const calls = model();
    const a = b.open();
    void a.send("hello");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.say({ type: "thinking", text: "Let me see." });
    await settled();
    a.leave();
    const end = saved(b.store)?.entries.at(-1)?.turn?.phase;
    expect(end).toMatchObject({ kind: "over", end: { kind: "stopped", by: "reload" } });
    expect(b.store.get(KEY)).toContain("Let me see.");
    expect(b.store.get(KEY)).toContain("My reasoning so far");
  });

  it("another tab sees a reply come in, without disturbing what hasn't changed", async () => {
    const b = browser();
    const calls = model();
    const other = b.open();
    const a = b.open();
    void a.send("hello");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const said = other.chat.entries()[0];
    now += 5000;
    calls[0]!.say({ type: "thinking", text: "Let me see." });
    await settled();
    const es = other.chat.entries();
    expect(es[0]).toBe(said);
    expect(es[1]).toMatchObject({ turn: { tries: [{ thinking: "Let me see." }] } });
    expect(other.chat.busy()).toBe(false);
    expect(a.chat.busy()).toBe(true);
  });

  it("speaking in another tab stops a reply going in the first, and the model hears how far it got", async () => {
    const b = browser();
    const calls = model();
    const other = b.open();
    const a = b.open();
    void a.send("first");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    now += 5000;
    calls[0]!.say({ type: "thinking", text: "Going along." });
    await settled();

    const second = other.send("second");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(a.chat.busy()).toBe(false);
    expect(JSON.stringify(calls[1]!.body.messages)).toContain("Going along.");

    calls[1]!.end("Second reply.");
    await second;
    await settled();
    expect(a.chat.entries()).toHaveLength(4);
    expect(a.chat.entries()[1]).toMatchObject({ turn: { phase: { end: { kind: "stopped", by: "message" } } } });
    expect(a.chat.entries()[3]).toMatchObject({ turn: { phase: { kind: "over", end: { kind: "said" } } } });
    a.leave();
    other.leave();
    expect(saved(b.store)?.entries).toHaveLength(4);
  });

  it("a document from another tab isn't put on this tab's canvas, so the next message here shows the model this one", async () => {
    const b = browser();
    const calls = model();
    const other = b.open();
    const a = b.open();
    const going = a.send("make it");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.end("Here.\n\n```inet\n" + EXAMPLE + "\n```");
    await going;
    const reply = other.chat.entries()[1];
    if (reply?.kind !== "turn" || reply.turn.phase.kind !== "over") throw new Error("expected a finished reply");
    expect(other.chat.onCanvas(reply.turn.phase.end)).toBe(false);
    void other.send("next");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.stringify(calls[1]!.body.messages.at(-1))).toMatch(/The document (as it stands now|is empty)/);
  });
});
