import { describe, expect, it } from "vitest";
import { type CreateEvent, type Deps, LIMITS, handleCreate } from "./create";

/** Counters in memory. */
function memory() {
  const m = new Map<string, number>();
  return { m, counters: { get: async (k: string) => m.get(k) ?? 0, set: async (k: string, v: number) => void m.set(k, v) } };
}

/** A model that streams some text and then finishes. */
function fakeModel(opts: { text?: string[]; stop?: string; fail?: boolean } = {}) {
  const seen: unknown[] = [];
  const callModel: Deps["callModel"] = (messages) => {
    seen.push(messages);
    const parts = opts.text ?? ["```inet\n", "agent Z 0\n", "```"];
    return {
      text: (async function* () {
        if (opts.fail) throw new Error("boom");
        yield* parts;
      })(),
      final: opts.fail
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ content: [{ type: "text", text: parts.join(""), citations: null }], stop: opts.stop ?? "end_turn", usage: { input_tokens: 4000, output_tokens: 2000 } }),
    };
  };
  return { callModel, seen };
}

const post = (body: unknown) => new Request("https://x/api/create", { method: "POST", body: JSON.stringify(body) });
const ask = (text = "Add 3 and 2.") => post({ messages: [{ role: "user", content: text }] });

async function events(res: Response): Promise<CreateEvent[]> {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as CreateEvent);
}

function deps(over: Partial<Deps> = {}) {
  const mem = memory();
  const model = fakeModel();
  return { mem, model, deps: { callModel: model.callModel, counters: mem.counters, visitor: "1.2.3.4", now: new Date("2026-10-12T21:30:00Z"), ...over } };
}

describe("handleCreate", () => {
  it("streams the text, then the whole reply", async () => {
    const { deps: d } = deps();
    const res = await handleCreate(ask(), d);
    expect(res.status).toBe(200);
    const es = await events(res);
    expect(es.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toContain("agent Z 0");
    expect(es.at(-1)).toMatchObject({ type: "done", content: [{ type: "text" }] });
  });

  it("counts what each call costs against the day", async () => {
    const { deps: d, mem } = deps();
    await events(await handleCreate(ask(), d));
    // 4000 × $0.10 + 2000 × $0.50 per million tokens = $0.0014.
    expect(mem.m.get("spend/2026-10-12")).toBe(1400);
  });

  it("stops everyone once the day's budget is spent", async () => {
    const { deps: d, mem, model } = deps();
    mem.m.set("spend/2026-10-12", LIMITS.dailyMicros);
    const res = await handleCreate(ask(), d);
    expect(res.status).toBe(503);
    expect(model.seen).toHaveLength(0);
  });

  it("limits each visitor per hour, without storing their address", async () => {
    const { deps: d, mem } = deps();
    for (let i = 0; i < LIMITS.callsPerHour; i++) await events(await handleCreate(ask(), d));
    expect((await handleCreate(ask(), d)).status).toBe(429);
    expect([...mem.m.keys()].some((k) => k.includes("1.2.3.4"))).toBe(false);
    // Someone else, or the next hour, is fine.
    expect((await handleCreate(ask(), { ...d, visitor: "5.6.7.8" })).status).toBe(200);
    expect((await handleCreate(ask(), { ...d, now: new Date("2026-10-12T22:00:00Z") })).status).toBe(200);
  });

  it("passes the conversation on as it came", async () => {
    const { deps: d, model } = deps();
    const reply = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "```inet\n```" }];
    const messages = [{ role: "user", content: "Add 3 and 2." }, { role: "assistant", content: reply }, { role: "user", content: "netties says: oops" }];
    await events(await handleCreate(post({ messages }), d));
    expect(model.seen[0]).toEqual(messages);
  });

  it("turns away conversations it shouldn't pass on", async () => {
    const { deps: d, model } = deps();
    const bad = [
      { messages: [] },
      { messages: [{ role: "assistant", content: [] }] },
      { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "x" }] }] },
      { messages: [{ role: "user", content: "x".repeat(LIMITS.requestChars + 1) }] },
      { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_use" }] }, { role: "user", content: "go" }] },
      { messages: Array.from({ length: 7 }, (_, i) => (i % 2 ? { role: "assistant", content: [{ type: "text", text: "x" }] } : { role: "user", content: "x" })) },
    ];
    for (const b of bad) expect((await handleCreate(post(b), d)).status).toBe(400);
    expect((await handleCreate(new Request("https://x", { method: "POST", body: "{" }), d)).status).toBe(400);
    expect(model.seen).toHaveLength(0);
  });

  it("reports refusals, cut-off replies and failures in the stream", async () => {
    for (const [opts, code] of [[{ stop: "refusal" }, "refused"], [{ stop: "max_tokens" }, "cut-off"], [{ fail: true }, "failed"]] as const) {
      const { deps: d } = deps({ callModel: fakeModel(opts).callModel });
      expect((await events(await handleCreate(ask(), d))).at(-1)).toMatchObject({ type: "error", code });
    }
  });
});
