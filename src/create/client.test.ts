import { describe, expect, it } from "vitest";
import { type Deps, handleCreate } from "../../netlify/lib/create";
import { create } from "./client";
import { EXAMPLE } from "./prompt";

/** The real proxy handler, in memory, with a model that gives scripted replies in turn. */
function proxy(replies: string[]) {
  const seen: unknown[][] = [];
  const m = new Map<string, number>();
  let i = 0;
  const callModel: Deps["callModel"] = (messages) => {
    seen.push(structuredClone(messages) as unknown[]);
    const text = replies[Math.min(i++, replies.length - 1)]!;
    const content = [{ type: "thinking", thinking: "", signature: `sig${i}` }, { type: "text", text, citations: null }] as never;
    return {
      text: (async function* () {
        yield text;
      })(),
      final: Promise.resolve({ content, stop: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
    };
  };
  const deps = () => ({ callModel, counters: { get: async (k: string) => m.get(k) ?? 0, set: async (k: string, v: number) => void m.set(k, v) }, visitor: "v", now: new Date() });
  const f = (async (url: string, init: RequestInit) => handleCreate(new Request(`https://x${url}`, init), deps())) as unknown as typeof fetch;
  return { f, seen };
}

const doc = (s: string) => "```inet\n" + s + "\n```";

describe("create", () => {
  it("returns a document that checks out", async () => {
    const { f } = proxy([doc(EXAMPLE)]);
    const progress: string[] = [];
    const r = await create("Double 2.", { fetch: f, onProgress: (p) => progress.push(p.kind) });
    expect(r).toMatchObject({ ok: true, attempts: 1 });
    expect(progress).toEqual(["writing", "checking"]);
  });

  it("sends problems back with the model's reply unchanged, and tries again", async () => {
    const { f, seen } = proxy([doc("agent D 1\nD(out) ~ ;"), doc(EXAMPLE)]);
    const r = await create("Double 2.", { fetch: f });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    const second = seen[1] as { role: string; content: unknown }[];
    expect(second).toHaveLength(3);
    expect(second[1]!.content).toEqual([{ type: "thinking", thinking: "", signature: "sig1" }, { type: "text", text: doc("agent D 1\nD(out) ~ ;"), citations: null }]);
    expect(second[2]!.content).toMatch(/^netties says: The text didn't parse/);
  });

  it("gives up after three tries, keeping the last document", async () => {
    const { f, seen } = proxy([doc("agent D 1\nD(out) ~ ;")]);
    const r = await create("Double 2.", { fetch: f });
    expect(r).toMatchObject({ ok: false, reason: "checks", attempts: 3, code: "agent D 1\nD(out) ~ ;\n" });
    expect(seen).toHaveLength(3);
  });

  it("passes on what the proxy says when it says no", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { code: "budget", message: "Try again tomorrow." } }), { status: 503 })) as unknown as typeof fetch;
    expect(await create("Double 2.", { fetch: f })).toMatchObject({ ok: false, reason: "proxy", code: "budget", message: "Try again tomorrow." });
  });
});
