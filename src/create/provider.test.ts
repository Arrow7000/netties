import { afterEach, describe, expect, it, vi } from "vitest";
import { type Ask, type Connection, type ReplyEvent, ModelError, isLocalAddress, listModels, localSetup, normalizeUrl, streamReply, thinkSplitter, troubleParts } from "./provider";

const OPENAI: Connection = { name: "Test", url: "https://x.test/v1", wire: "openai", key: "k" };
const ANTHROPIC: Connection = { name: "Claude", url: "https://a.test/v1", wire: "anthropic", key: "k", maxTokens: 1000 };

const sse = (...chunks: (object | string)[]) => chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
const piece = (delta: object, finish_reason: string | null = null) => ({ choices: [{ delta, finish_reason }] });

/** A provider answering each call in turn, keeping what it was asked. */
function provider(...replies: (Response | (() => Response) | Error)[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  let i = 0;
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body as string) : {} });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r.clone();
  }) as unknown as typeof fetch;
  return { f, calls };
}

const ask = (connection: Connection, f: typeof fetch, more: Partial<Ask> = {}): Ask => ({ connection, model: "m", effort: "default", system: "S", messages: [{ role: "user", content: "hi" }], fetch: f, ...more });

async function collect(a: Ask) {
  const events: ReplyEvent[] = [];
  try {
    for await (const e of streamReply(a)) events.push(e);
    return { events };
  } catch (error) {
    return { events, error: error as ModelError };
  }
}

describe("what a failure says", () => {
  it("puts what's wrong first, with commands picked out of what to do", () => {
    const { head, rest } = troubleParts(`Ollama is running, but isn't letting this site in.\n\n${localSetup("lmstudio", "https://x")}`);
    expect(head).toBe("Ollama is running, but isn't letting this site in.");
    expect(rest).toEqual([{ text: "In LM Studio, turn on Developer → Server Settings → Enable CORS, or run:" }, { command: "lms server start --cors" }]);
    expect(troubleParts("Just this.")).toEqual({ head: "Just this.", rest: [] });
  });

  it("has no web page in it", async () => {
    const page = "<!doctype html><html><head><title>x</title><style>h1{}</style></head><body><h1>nope</h1></body></html>";
    const { f } = provider(new Response(page, { status: 500 }));
    const { error } = await collect(ask(OPENAI, f));
    expect(error?.message).toContain("nope");
    expect(error?.message).not.toContain("<");
    expect(error?.message).not.toContain("h1{}");
  });

  it("doesn't blame a model when an address doesn't list any", async () => {
    const { f } = provider(new Response("<h1>nope</h1>", { status: 404 }));
    const error = await listModels(OPENAI, { fetch: f }).catch((e: ModelError) => e);
    expect((error as ModelError).message).toContain("Nothing at this address lists models");
    expect((error as ModelError).message).not.toContain("nope");
  });

  describe("about a local server that isn't there", () => {
    const LOCAL: Connection = { name: "Ollama", url: "http://localhost:11434/v1", wire: "openai" };
    const gone = () => provider(new TypeError("Failed to fetch")).f;
    afterEach(() => vi.unstubAllGlobals());

    it("only brings up phones on one", async () => {
      vi.stubGlobal("matchMedia", () => ({ matches: false }));
      expect((await collect(ask(LOCAL, gone()))).error?.message).not.toContain("phone");
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      expect((await collect(ask(LOCAL, gone()))).error?.message).toContain("phone");
    });
  });
});

describe("a provider with somewhere to check a key", () => {
  const CHECKED: Connection = { ...OPENAI, keyCheck: "/key" };
  const list = new Response(JSON.stringify({ data: [{ id: "a" }] }));

  it("says so when the key is no good, though the list is public", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ error: { message: "Missing Authentication header" } }), { status: 401 }), list);
    const error = await listModels(CHECKED, { fetch: f }).catch((e: ModelError) => e);
    expect(error).toMatchObject({ code: "key", message: "Test didn't accept the API key." });
    expect(calls.map((c) => c.url)).toEqual(["https://x.test/v1/key"]);
    expect(calls[0]!.init.headers).toMatchObject({ authorization: "Bearer k" });
    expect(calls[0]!.init.method).toBeUndefined();
  });

  it("goes on to the list when it's fine, or when the check can't be made", async () => {
    expect(await listModels(CHECKED, { fetch: provider(new Response("{}"), list).f })).toEqual([{ id: "a" }]);
    expect(await listModels(CHECKED, { fetch: provider(new TypeError("Failed to fetch"), list).f })).toEqual([{ id: "a" }]);
    expect(await listModels(CHECKED, { fetch: provider(new Response("", { status: 500 }), list).f })).toEqual([{ id: "a" }]);
  });

  it("doesn't check without a key", async () => {
    const { f, calls } = provider(list);
    await listModels({ ...CHECKED, key: undefined }, { fetch: f });
    expect(calls).toHaveLength(1);
  });
});

describe("normalizing an address", () => {
  it("takes however it was pasted", () => {
    expect(normalizeUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeUrl("https://api.example.com/v1/chat/completions")).toBe("https://api.example.com/v1");
    expect(normalizeUrl("api.example.com")).toBe("https://api.example.com/v1");
    expect(normalizeUrl("localhost:11434")).toBe("http://localhost:11434/v1");
    expect(normalizeUrl("192.168.0.5:8080/api")).toBe("http://192.168.0.5:8080/api");
    expect(normalizeUrl("  ")).toBe("");
    expect(normalizeUrl("https://")).toBe("");
  });

  it("knows what's local", () => {
    for (const u of ["http://localhost:1", "http://127.0.0.1", "http://[::1]:3", "http://10.0.0.1", "http://192.168.1.1", "http://172.20.0.1", "http://box.local"]) expect(isLocalAddress(u), u).toBe(true);
    for (const u of ["https://api.openai.com", "http://172.32.0.1", "http://localhost.example.com"]) expect(isLocalAddress(u), u).toBe(false);
  });
});

describe("an OpenAI-style reply", () => {
  it("sends the system prompt first and the key as a bearer token, asking for no settings by default", async () => {
    const { f, calls } = provider(new Response(sse(piece({ content: "ok" }, "stop"), "[DONE]")));
    await collect(ask(OPENAI, f));
    expect(calls[0]!.url).toBe("https://x.test/v1/chat/completions");
    expect(calls[0]!.body).toEqual({ model: "m", stream: true, messages: [{ role: "system", content: "S" }, { role: "user", content: "hi" }] });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("sends no authorization at all without a key, for a local server", async () => {
    const { f, calls } = provider(new Response(sse(piece({ content: "ok" }, "stop"))));
    await collect(ask({ ...OPENAI, key: undefined }, f));
    expect(calls[0]!.init.headers).not.toHaveProperty("authorization");
  });

  it("finds reasoning under either name", async () => {
    const { f } = provider(new Response(sse(piece({ reasoning: "a" }), piece({ reasoning_content: "b" }), piece({ content: "c" }, "stop"), "[DONE]")));
    expect((await collect(ask(OPENAI, f))).events).toEqual([{ kind: "thinking", text: "a" }, { kind: "thinking", text: "b" }, { kind: "text", text: "c" }]);
  });

  it("asks for the reasoning level chosen", async () => {
    const { f, calls } = provider(new Response(sse(piece({ content: "ok" }, "stop"))));
    await collect(ask(OPENAI, f, { effort: "high" }));
    expect(calls[0]!.body.reasoning_effort).toBe("high");
    const off = provider(new Response(sse(piece({ content: "ok" }, "stop"))));
    await collect(ask(OPENAI, off.f, { effort: "off" }));
    expect(off.calls[0]!.body.reasoning_effort).toBe("none");
  });

  it("goes again without a reasoning level the model turns down, and says so", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } }), { status: 400 }), new Response(sse(piece({ content: "ok" }, "stop"))));
    const { events, error } = await collect(ask(OPENAI, f, { effort: "high" }));
    expect(error).toBeUndefined();
    expect(calls[1]!.body).not.toHaveProperty("reasoning_effort");
    expect(events[0]).toEqual({ kind: "note", text: expect.stringMatching(/doesn't take a reasoning level/) });
    expect(events[1]).toEqual({ kind: "text", text: "ok" });
  });

  it("goes again without a length limit the model turns down, quietly", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ error: { message: "max_tokens is too large" } }), { status: 400 }), new Response(sse(piece({ content: "ok" }, "stop"))));
    const { events } = await collect(ask({ ...OPENAI, maxTokens: 64_000 }, f));
    expect(calls[1]!.body).not.toHaveProperty("max_tokens");
    expect(events).toEqual([{ kind: "text", text: "ok" }]);
  });

  it("doesn't go on for ever if something else is wrong", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ error: { message: "bad messages" } }), { status: 400 }));
    const { error } = await collect(ask(OPENAI, f, { effort: "high" }));
    expect(calls).toHaveLength(1);
    expect(error).toMatchObject({ code: "failed", message: expect.stringContaining("bad messages") });
  });

  it("says what each kind of refusal means, in the provider's words", async () => {
    const cases: [number, string][] = [[401, "key"], [403, "key"], [402, "rate"], [429, "rate"], [404, "model"], [500, "failed"]];
    for (const [status, code] of cases) {
      const { f } = provider(new Response(JSON.stringify({ error: { message: "because" } }), { status }));
      expect((await collect(ask(OPENAI, f))).error, String(status)).toMatchObject({ code, message: expect.stringContaining("because") });
    }
  });

  it("reads an error however it's shaped", async () => {
    for (const body of [JSON.stringify({ error: "because" }), JSON.stringify({ detail: "because" }), JSON.stringify([{ error: { message: "because" } }]), "because"]) {
      const { f } = provider(new Response(body, { status: 500 }));
      expect((await collect(ask(OPENAI, f))).error?.message).toContain("because");
    }
  });

  it("calls a reply that hit its limit cut off, keeping what came", async () => {
    const { f } = provider(new Response(sse(piece({ content: "par" }, "length"), "[DONE]")));
    const { events, error } = await collect(ask(OPENAI, f));
    expect(events).toEqual([{ kind: "text", text: "par" }]);
    expect(error).toMatchObject({ code: "cut-off" });
  });

  it("calls a stream that just ends dropped", async () => {
    const { f } = provider(new Response(sse(piece({ content: "par" }))));
    expect((await collect(ask(OPENAI, f))).error).toMatchObject({ code: "dropped" });
  });

  it("calls a stream that breaks dropped", async () => {
    const enc = new TextEncoder();
    const { f } = provider(() =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(enc.encode(sse(piece({ content: "par" }))));
            c.error(new TypeError("network error"));
          },
        }),
      ),
    );
    expect((await collect(ask(OPENAI, f))).error).toMatchObject({ code: "dropped" });
  });

  it("passes on an error sent in the stream", async () => {
    const { f } = provider(new Response(sse({ error: { message: "overloaded" } })));
    expect((await collect(ask(OPENAI, f))).error).toMatchObject({ code: "failed", message: expect.stringContaining("overloaded") });
  });

  it("skips keep-alive comments and anything it can't read", async () => {
    const { f } = provider(new Response(": OPENROUTER PROCESSING\n\ndata: {not json\n\n" + sse(piece({ content: "ok" }, "stop"), "[DONE]")));
    expect((await collect(ask(OPENAI, f))).events).toEqual([{ kind: "text", text: "ok" }]);
  });

  it("copes with a line split across two pieces of the network", async () => {
    const enc = new TextEncoder();
    const whole = enc.encode(sse(piece({ content: "ok" }, "stop"), "[DONE]"));
    const { f } = provider(() =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(whole.slice(0, 11));
            c.enqueue(whole.slice(11));
            c.close();
          },
        }),
      ),
    );
    expect((await collect(ask(OPENAI, f))).events).toEqual([{ kind: "text", text: "ok" }]);
  });
});

describe("thinking written into the reply between tags", () => {
  const run = (...pieces: string[]) => {
    const s = thinkSplitter();
    const events = [...pieces.flatMap((p) => s.push(p)), ...s.flush()];
    const of = (kind: string) => events.filter((e) => e.kind === kind).map((e) => (e as { text: string }).text).join("");
    return { thinking: of("thinking"), text: of("text") };
  };

  it("is taken back out, wherever the tags were split", () => {
    expect(run("<think>hm</think>hello")).toEqual({ thinking: "hm", text: "hello" });
    expect(run("<th", "ink>h", "m</thi", "nk>\n\nhel", "lo")).toEqual({ thinking: "hm", text: "hello" });
    expect(run("\n <think>hm</think>")).toEqual({ thinking: "hm", text: "" });
  });

  it("leaves a reply alone unless it starts with a tag", () => {
    expect(run("hello <think>not this</think>")).toEqual({ thinking: "", text: "hello <think>not this</think>" });
    expect(run("<b>bold</b>")).toEqual({ thinking: "", text: "<b>bold</b>" });
    expect(run("<th")).toEqual({ thinking: "", text: "<th" });
  });

  it("keeps thinking that never finished", () => {
    expect(run("<think>going on and on </thi")).toEqual({ thinking: "going on and on </thi", text: "" });
  });
});

describe("an Anthropic reply", () => {
  const events = (...evs: object[]) => evs.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const stop = (stop_reason: string) => [{ type: "message_delta", delta: { stop_reason } }, { type: "message_stop" }];

  it("asks in its own terms, with what lets a browser in, and shows the thinking", async () => {
    const { f, calls } = provider(new Response(events({ type: "message_start" }, { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } }, { type: "ping" }, { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } }, ...stop("end_turn"))));
    const got = await collect(ask(ANTHROPIC, f, { effort: "high" }));
    expect(calls[0]!.url).toBe("https://a.test/v1/messages");
    expect(calls[0]!.body).toMatchObject({ system: "S", max_tokens: 1000, stream: true, thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" }, messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]!.init.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
    expect(got.events).toEqual([{ kind: "thinking", text: "hm" }, { kind: "text", text: "ok" }]);
    expect(got.error).toBeUndefined();
  });

  it("takes off to mean as little as the model will do, since newer ones won't stop thinking", async () => {
    const { f, calls } = provider(new Response(events(...stop("end_turn"))));
    await collect(ask(ANTHROPIC, f, { effort: "off" }));
    expect(calls[0]!.body).not.toHaveProperty("thinking");
    expect(calls[0]!.body.output_config).toEqual({ effort: "low" });
  });

  it("goes again without thinking settings an older model turns down", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ type: "error", error: { message: "thinking.type: adaptive is not supported" } }), { status: 400 }), new Response(events(...stop("end_turn"))));
    await collect(ask(ANTHROPIC, f));
    expect(calls[1]!.body).not.toHaveProperty("thinking");
  });

  it("knows how a reply ended", async () => {
    for (const [reason, code] of [["max_tokens", "cut-off"], ["refusal", "refused"]] as const) {
      const { f } = provider(new Response(events(...stop(reason))));
      expect((await collect(ask(ANTHROPIC, f))).error).toMatchObject({ code });
    }
    const { f } = provider(new Response(events({ type: "error", error: { message: "Overloaded" } })));
    expect((await collect(ask(ANTHROPIC, f))).error).toMatchObject({ code: "failed", message: expect.stringContaining("Overloaded") });
  });
});

describe("when a request gets no answer at all", () => {
  it("finds out that it was a wrong key a provider hid from the browser", async () => {
    const { f, calls } = provider(new TypeError("Failed to fetch"), new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }));
    const { error } = await collect(ask(OPENAI, f));
    expect(calls[1]!.url).toBe("https://x.test/v1/models");
    expect(error).toMatchObject({ code: "key", message: expect.stringContaining("Incorrect API key") });
  });

  it("says a cloud provider can't be reached otherwise", async () => {
    const { f } = provider(new TypeError("Failed to fetch"));
    expect((await collect(ask(OPENAI, f))).error).toMatchObject({ code: "unreachable" });
  });

  const LOCAL: Connection = { name: "Ollama", url: "http://localhost:11434/v1", wire: "openai" };

  it("says nothing's running if a local server doesn't answer", async () => {
    const { f } = provider(new TypeError("Failed to fetch"));
    expect((await collect(ask(LOCAL, f))).error).toMatchObject({ code: "unreachable", message: expect.stringContaining("Check that Ollama is running") });
  });

  it("says how to let the site in if a local server is up but keeping it out", async () => {
    const { f, calls } = provider(new TypeError("Failed to fetch"), new Response(null, { status: 200 }));
    const { error } = await collect(ask(LOCAL, f, { setup: "Run this thing." }));
    expect(calls[1]!.init.mode).toBe("no-cors");
    expect(error).toMatchObject({ code: "blocked", message: expect.stringContaining("Run this thing.") });
  });

  it("doesn't diagnose a reply that was stopped", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { f, calls } = provider(new DOMException("Aborted", "AbortError"));
    const { error } = await collect(ask(OPENAI, f, { signal: ctrl.signal }));
    expect(calls).toHaveLength(1);
    expect(error).not.toBeInstanceOf(ModelError);
  });
});

describe("listing models", () => {
  it("gives what can chat, newest first", async () => {
    const { f } = provider(new Response(JSON.stringify({ data: [{ id: "old", created: 1 }, { id: "text-embedding-3", created: 9 }, { id: "new", created: 5 }, { id: "whisper-1", created: 9 }] })));
    expect((await listModels(OPENAI, { fetch: f })).map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("copes with a bare list, a provider's own prefix, and no dates", async () => {
    const { f } = provider(new Response(JSON.stringify([{ id: "models/a" }, { id: "b", type: "embedding" }, { id: "c", type: "chat" }])));
    expect((await listModels(OPENAI, { fetch: f })).map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("asks Anthropic in its own terms and uses its names", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ data: [{ id: "a", display_name: "A", created_at: "2026-01-01T00:00:00Z" }, { id: "b", display_name: "B", created_at: "2026-06-01T00:00:00Z" }] })));
    expect(await listModels(ANTHROPIC, { fetch: f })).toEqual([{ id: "b", name: "B" }, { id: "a", name: "A" }]);
    expect(calls[0]!.url).toContain("/models?limit=1000");
    expect(calls[0]!.init.headers).toMatchObject({ "x-api-key": "k" });
  });

  it("takes Ollama's way of saying it has nothing downloaded as an empty list", async () => {
    const { f } = provider(new Response(JSON.stringify({ object: "list", data: null })));
    expect(await listModels(OPENAI, { fetch: f })).toEqual([]);
  });

  it("says when the key is wrong", async () => {
    const { f } = provider(new Response(JSON.stringify({ error: { message: "nope" } }), { status: 401 }));
    await expect(listModels(OPENAI, { fetch: f })).rejects.toMatchObject({ code: "key" });
  });

  it("says when what came back isn't a list", async () => {
    const { f } = provider(new Response("{}"));
    await expect(listModels(OPENAI, { fetch: f })).rejects.toMatchObject({ code: "failed" });
  });
});
