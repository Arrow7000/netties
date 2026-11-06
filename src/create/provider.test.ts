import { afterEach, describe, expect, it, vi } from "vitest";
import { type Ask, type Connection, type Effort, type ReplyEvent, ModelError, isLocalAddress, levelRefused, offered, listModels, localSetup, normalizeUrl, streamReply, thinkSplitter, troubleParts } from "./provider";

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
    for (const effort of ["minimal", "xhigh", "max"] as const) {
      const top = provider(new Response(sse(piece({ content: "ok" }, "stop"))));
      await collect(ask(OPENAI, top.f, { effort }));
      expect(top.calls[0]!.body.reasoning_effort).toBe(effort);
    }
  });

  it("says it's only the level asked for that was turned down", () => {
    expect(levelRefused("xhigh")).toBe("This model doesn't take the reasoning level Extra high, so it's using its own.");
    expect(levelRefused("off")).toBe("This model can't turn reasoning off, so it's using its own level.");
  });

  it("goes again without a reasoning level the model turns down, and says so", async () => {
    const { f, calls } = provider(new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } }), { status: 400 }), new Response(sse(piece({ content: "ok" }, "stop"))));
    const { events, error } = await collect(ask(OPENAI, f, { effort: "high" }));
    expect(error).toBeUndefined();
    expect(calls[1]!.body).not.toHaveProperty("reasoning_effort");
    expect(events[0]).toEqual({ kind: "note", text: levelRefused("high") });
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
    expect(calls).toHaveLength(0);
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

  it("takes a 400 about the key as a wrong key, as Google and xAI answer one", async () => {
    for (const body of [{ error: { message: "Please pass a valid API key" } }, { code: "invalid-argument", error: "Incorrect API key provided." }]) {
      const { f } = provider(new Response(JSON.stringify(body), { status: 400 }));
      await expect(listModels(OPENAI, { fetch: f })).rejects.toMatchObject({ code: "key" });
    }
  });

  it("doesn't take any other 400 for a wrong key", async () => {
    const { f } = provider(new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }));
    await expect(listModels(OPENAI, { fetch: f })).rejects.toMatchObject({ code: "failed" });
  });

  it("leaves out what a provider says can't chat or write text", async () => {
    const { f } = provider(
      new Response(
        JSON.stringify({
          data: [
            { id: "vendor/chat", endpoints: ["/api/v1/chat/completions"], architecture: { output_modalities: ["text"] } },
            { id: "vendor/both", endpoints: ["/api/v1/chat/completions"], architecture: { output_modalities: ["text", "video"] } },
            { id: "vendor/chat:batch", endpoints: ["/api/v1/batches"], architecture: { output_modalities: ["text"] } },
            { id: "vendor/picture", endpoints: ["/api/v1/chat/completions"], architecture: { output_modalities: ["other"] } },
            { id: "vendor/says-nothing" },
          ],
        }),
      ),
    );
    expect((await listModels(OPENAI, { fetch: f })).map((m) => m.id)).toEqual(["vendor/chat", "vendor/both", "vendor/says-nothing"]);
  });

  it("reads which reasoning levels a model takes, from OpenRouter", async () => {
    const { f } = provider(
      new Response(
        JSON.stringify({
          data: [
            { id: "some", reasoning: { supported_efforts: ["max", "none", "low"] } },
            { id: "all", reasoning: { supported_efforts: null }, supported_parameters: ["reasoning"] },
            { id: "none", supported_parameters: ["max_tokens"] },
            { id: "unsaid" },
          ],
        }),
      ),
    );
    expect(await listModels(OPENAI, { fetch: f })).toEqual([{ id: "some", levels: ["off", "low", "max"] }, { id: "all" }, { id: "none", levels: [] }, { id: "unsaid" }]);
  });

  it("reads which reasoning levels a model takes, from Anthropic, where Off is always there", async () => {
    const yes = { supported: true };
    const no = { supported: false };
    const { f } = provider(
      new Response(
        JSON.stringify({
          data: [
            { id: "top", capabilities: { effort: { supported: true, low: yes, medium: yes, high: yes, xhigh: yes, max: no } } },
            { id: "old", capabilities: { effort: { supported: false, low: no, medium: no, high: no, xhigh: null, max: no } } },
            { id: "unknown", capabilities: null },
          ],
        }),
      ),
    );
    expect((await listModels(ANTHROPIC, { fetch: f })).map((m) => m.levels)).toEqual([["off", "low", "medium", "high", "xhigh"], ["off"], undefined]);
  });

  it("offers what a model takes, or else the usual levels", () => {
    const ids = (levels?: Effort[]) => offered(levels).map((e) => e.id);
    expect(ids()).toEqual(["default", "off", "low", "medium", "high", "xhigh", "max"]);
    expect(ids(["minimal", "high"])).toEqual(["default", "minimal", "high"]);
    expect(ids([])).toEqual(["default"]);
  });

  it("says when what came back isn't a list", async () => {
    const { f } = provider(new Response("{}"));
    await expect(listModels(OPENAI, { fetch: f })).rejects.toMatchObject({ code: "failed" });
  });
});

describe("images and provider-run search", () => {
  it("encodes image blobs for Chat Completions without leaking attachment fields", async () => {
    const { f, calls } = provider(new Response(sse(piece({ content: "seen" }, "stop"), "[DONE]")));
    await collect(ask(OPENAI, f, { messages: [{ role: "user", content: "look", images: [new Blob(["image"], { type: "image/png" })] }] }));
    expect(calls[0]!.body.messages).toEqual([{ role: "system", content: "S" }, { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }, { type: "text", text: "look" }] }]);
    expect(calls[0]!.body).not.toHaveProperty("tools");
  });

  it("uses Anthropic image blocks, limits searches, and surfaces streamed citations", async () => {
    const source = { url: "https://example.org/reference", title: "Reference" };
    const { f, calls } = provider(new Response(sse(
      { type: "content_block_start", content_block: { type: "server_tool_use", name: "web_search" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Answer" } },
      { type: "content_block_delta", delta: { type: "citations_delta", citation: { type: "web_search_result_location", ...source } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    )));
    const result = await collect(ask(ANTHROPIC, f, { webSearch: "anthropic", messages: [{ role: "user", content: "look", images: [new Blob(["image"], { type: "image/png" })] }] }));
    expect(result.error).toBeUndefined();
    expect(result.events).toContainEqual({ kind: "note", text: "Searching the web" });
    expect(result.events).toContainEqual({ kind: "source", source: { type: "web_search_result_location", ...source } });
    expect(calls[0]!.body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
    expect(calls[0]!.body.messages).toEqual([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } }, { type: "text", text: "look" }] }]);
  });

  it("opts into OpenRouter's server tool and reads source annotations", async () => {
    const source = { url: "https://example.org/", title: "Source" };
    const { f, calls } = provider(new Response(sse(piece({ content: "Answer", annotations: [{ type: "url_citation", url_citation: source }] }, "stop"), "[DONE]")));
    const result = await collect(ask(OPENAI, f, { webSearch: "openrouter" }));
    expect(result.events).toContainEqual({ kind: "source", source });
    expect(calls[0]!.body.tools).toEqual([{ type: "openrouter:web_search", parameters: { max_uses: 3 } }]);
  });

  it("doesn't silently retry without requested search when the provider refuses it", async () => {
    const { f, calls } = provider(new Response('{"error":{"message":"tools not supported"}}', { status: 400 }));
    expect((await collect(ask(OPENAI, f, { webSearch: "openrouter" }))).error).toBeInstanceOf(ModelError);
    expect(calls).toHaveLength(1);
  });
});

it("continues an Anthropic search pause with the original tool blocks", async () => {
  const block = { type: "server_tool_use", id: "search_1", name: "web_search", input: {} };
  const { f, calls } = provider(
    new Response(sse(
      { type: "content_block_start", index: 0, content_block: block },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"nets"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "pause_turn" } }, { type: "message_stop" },
    )),
    new Response(sse(
      { type: "content_block_delta", delta: { type: "text_delta", text: "Found it." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    )),
  );
  const result = await collect(ask(ANTHROPIC, f, { webSearch: "anthropic" }));
  expect(result.error).toBeUndefined();
  expect(calls).toHaveLength(2);
  expect((calls[1]!.body.messages as unknown[]).at(-1)).toEqual({ role: "assistant", content: [{ ...block, input: { query: "nets" } }] });
  expect(result.events).toContainEqual({ kind: "text", text: "Found it." });
});

describe("browser-run tools", () => {
  const tool = (execute = vi.fn().mockResolvedValue({ content: "Found a reference.", sources: [{ url: "https://example.org/", title: "Reference" }] })) => ({ name: "web_search", description: "Search", parameters: { type: "object" }, execute });
  const call = (index: number, id: string, name = "web_search", args = '{"query":"nets"}') => ({ index, id, type: "function", function: { name, arguments: args } });
  const reply = () => new Response(sse(piece({ content: "Answer." }, "stop"), "[DONE]"));

  it("assembles fragmented calls and preserves reasoning, IDs, text and provider metadata in the follow-up", async () => {
    const t = tool();
    const { f, calls } = provider(new Response(sse(
      piece({ reasoning_content: "Need a reference.", content: "I'll look. ", tool_calls: [{ ...call(0, "c1", "web_", '{"query":'), extra_content: { google: { thought_signature: "sig" } } }] }),
      piece({ tool_calls: [{ index: 0, function: { name: "search", arguments: '"nets"}' } }] }, "tool_calls"), "[DONE]",
    )), reply());
    const result = await collect(ask(OPENAI, f, { tools: [t] }));
    expect(result.error).toBeUndefined();
    expect(t.execute).toHaveBeenCalledWith({ query: "nets" }, undefined);
    expect(calls[0]!.body.tools).toEqual([{ type: "function", function: { name: "web_search", description: "Search", parameters: { type: "object" } } }]);
    expect((calls[1]!.body.messages as unknown[]).slice(-2)).toEqual([
      { role: "assistant", content: "I'll look. ", reasoning_content: "Need a reference.", tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"nets"}' }, extra_content: { google: { thought_signature: "sig" } } }] },
      { role: "tool", tool_call_id: "c1", content: "Found a reference." },
    ]);
    expect(result.events).toContainEqual({ kind: "source", source: { url: "https://example.org/", title: "Reference" } });
    expect(result.events.filter((e) => e.kind === "text").map((e) => e.text).join("")).toBe("I'll look. Answer.");
  });

  it("bounds a batch of parallel requests, returns every result ID and disables further calls", async () => {
    const t = tool();
    const { f, calls } = provider(new Response(sse(piece({ tool_calls: Array.from({ length: 4 }, (_, i) => call(i, `c${i}`)) }, "tool_calls"), "[DONE]")), reply());
    const result = await collect(ask(OPENAI, f, { tools: [t] }));
    expect(result.error).toBeUndefined();
    expect(t.execute).toHaveBeenCalledTimes(3);
    const messages = calls[1]!.body.messages as { role: string; tool_call_id?: string; content: string }[];
    expect(messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(messages.at(-1)!.content).toContain("limit reached");
    expect(calls[1]!.body.tool_choice).toBe("none");
  });

  it("returns invalid arguments and unknown names as tool errors without executing them", async () => {
    const t = tool();
    const { f, calls } = provider(new Response(sse(piece({ tool_calls: [call(0, "c1", "web_search", "{"), call(1, "c2", "run_shell")] }, "tool_calls"), "[DONE]")), reply());
    expect((await collect(ask(OPENAI, f, { tools: [t] }))).error).toBeUndefined();
    expect(t.execute).not.toHaveBeenCalled();
    const messages = calls[1]!.body.messages as { content: string }[];
    expect(messages.at(-2)!.content).toContain("valid JSON");
    expect(messages.at(-1)!.content).toContain("not available");
  });

  it("lets the model explain a failed search instead of silently dropping its tool turn", async () => {
    const t = tool(vi.fn().mockRejectedValue(new Error("Search unavailable")));
    const { f, calls } = provider(new Response(sse(piece({ tool_calls: [call(0, "c1")] }, "tool_calls"), "[DONE]")), reply());
    expect((await collect(ask(OPENAI, f, { tools: [t] }))).error).toBeUndefined();
    expect((calls[1]!.body.messages as { content: string }[]).at(-1)!.content).toContain("Search unavailable");
  });

  it("propagates cancellation through search and doesn't make another model request", async () => {
    const ctrl = new AbortController();
    const t = tool(vi.fn(async (_input, signal) => { expect(signal).toBe(ctrl.signal); ctrl.abort(); throw new DOMException("Aborted", "AbortError"); }));
    const { f, calls } = provider(new Response(sse(piece({ tool_calls: [call(0, "c1")] }, "tool_calls"), "[DONE]")), reply());
    const result = await collect(ask(OPENAI, f, { tools: [t], signal: ctrl.signal }));
    expect(result.error?.name).toBe("AbortError");
    expect(calls).toHaveLength(1);
  });

  it("supports a custom Anthropic-style endpoint, retaining signed thinking and tool blocks", async () => {
    const t = tool();
    const { f, calls } = provider(new Response(sse(
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Need a source." } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "c1", name: "web_search", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":"nets"}' } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" },
    )), new Response(sse({ type: "content_block_delta", delta: { type: "text_delta", text: "Answer." } }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" })));
    expect((await collect(ask(ANTHROPIC, f, { tools: [t] }))).error).toBeUndefined();
    expect(calls[0]!.body.tools).toEqual([{ name: "web_search", description: "Search", input_schema: { type: "object" } }]);
    expect((calls[1]!.body.messages as unknown[]).slice(-2)).toEqual([
      { role: "assistant", content: [{ type: "thinking", thinking: "Need a source.", signature: "signed" }, { type: "tool_use", id: "c1", name: "web_search", input: { query: "nets" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "Found a reference." }] },
    ]);
  });
});

it("reads image input support without guessing when a provider omits it", async () => {
  const { f } = provider(new Response(JSON.stringify({ data: [
    { id: "vision", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
    { id: "text-only", architecture: { input_modalities: ["text"] } },
    { id: "claude", capabilities: { image_input: { supported: true } } },
    { id: "blocked", capabilities: { image_input: { supported: false } } },
    { id: "unknown" },
  ] })));
  expect(await listModels(OPENAI, { fetch: f })).toEqual([
    { id: "vision", images: true }, { id: "text-only", images: false },
    { id: "claude", images: true }, { id: "blocked", images: false }, { id: "unknown" },
  ]);
});
