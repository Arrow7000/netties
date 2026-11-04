import { describe, expect, it } from "vitest";
import { callOpenRouter } from "./openrouter";

const sse = (...chunks: unknown[]) => chunks.map((c) => (typeof c === "string" ? c : `data: ${JSON.stringify(c)}\n\n`)).join("");

function server(body: string, status = 200) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { f, sent };
}

const options = (f: typeof fetch) => ({ apiKey: "k", model: "m", system: "S", maxTokens: 5, fetch: f, messages: [{ role: "user" as const, content: "hi" }, { role: "assistant" as const, content: [{ type: "text" as const, text: "yes", citations: null }] }, { role: "user" as const, content: "and?" }] });

async function collect(text: AsyncIterable<string | { thinking: string }>) {
  const out: (string | { thinking: string })[] = [];
  for await (const t of text) out.push(t);
  return out;
}

describe("callOpenRouter", () => {
  it("streams thinking and text, and reports what it really cost", async () => {
    const { f, sent } = server(
      sse(": OPENROUTER PROCESSING\n\n", { choices: [{ delta: { reasoning: "hmm" } }] }, { choices: [{ delta: { content: "He" } }] }, { choices: [{ delta: { content: "llo" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.0012 } }) + "data: [DONE]\n\n",
    );
    const call = callOpenRouter(options(f));
    expect(await collect(call.text)).toEqual([{ thinking: "hmm" }, "He", "llo"]);
    expect(await call.final).toMatchObject({ stop: "stop", micros: 1200, usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: "text", text: "Hello" }] });
    // Replies go back as plain text, after the system prompt, on the fastest provider.
    expect(sent[0]!.body).toMatchObject({ model: "m", stream: true, max_tokens: 5, provider: { sort: "throughput" }, messages: [{ role: "system", content: "S" }, { role: "user", content: "hi" }, { role: "assistant", content: "yes" }, { role: "user", content: "and?" }] });
  });

  it("names a reply that ran out of tokens the way the proxy expects", async () => {
    const { f } = server(sse({ choices: [{ delta: { content: "x" }, finish_reason: "length" }] }));
    const call = callOpenRouter(options(f));
    await collect(call.text);
    expect((await call.final).stop).toBe("max_tokens");
  });

  it("fails when the provider says no, or the stream just ends", async () => {
    for (const [body, status] of [["no credit", 402], [sse({ error: { message: "boom" } }), 200], [sse({ choices: [{ delta: { content: "x" } }] }), 200]] as const) {
      const call = callOpenRouter(options(server(body, status).f));
      call.final.catch(() => {});
      await expect(collect(call.text)).rejects.toThrow(/OpenRouter/);
      await expect(call.final).rejects.toThrow(/OpenRouter/);
    }
  });

  it("charges an estimate for what streamed before a stop, and stops the request", async () => {
    let signal: AbortSignal | undefined;
    const enc = new TextEncoder();
    const f = (async (_: string, init: RequestInit) => {
      signal = init.signal!;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(sse({ choices: [{ delta: { content: "x".repeat(400) } }] })));
            signal!.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
          },
        }),
      );
    }) as unknown as typeof fetch;
    const call = callOpenRouter(options(f));
    for await (const _ of call.text) call.abort!();
    expect(signal!.aborted).toBe(true);
    expect(await call.final).toMatchObject({ stop: "aborted", micros: 100 });
  });
});
