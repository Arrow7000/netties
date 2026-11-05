import { describe, expect, it } from "vitest";
import { type Deps, CHAT_LIMITS, handleCreate } from "../../netlify/lib/create";
import { type Conversation, type Entry, type TurnMsg, askTitle, cleanTitle, newConversation, newTurn, runTurn, settle, triesSoFar, updateTurn, userMessage } from "./chat";
import { EXAMPLE } from "./prompt";

const doc = (s: string) => "```inet\n" + s + "\n```";
const BAD = "agent D 1\nD(out) ~ ;";
const STUCK = "agent 0 0\nagent D 1\n\nD(out) ~ 0;";

/** The real proxy, in memory, with a model giving scripted replies in turn. */
function proxy(replies: string[]) {
  const seen: { role: string; content: unknown }[][] = [];
  const m = new Map<string, number>();
  let i = 0;
  const callModel: Deps["callModel"] = (messages) => {
    seen.push(structuredClone(messages) as never);
    const text = replies[Math.min(i++, replies.length - 1)]!;
    return {
      text: (async function* () {
        yield { thinking: "hmm" };
        yield text;
      })(),
      final: Promise.resolve({ content: [{ type: "text", text, citations: null }] as never, stop: "stop", usage: { input_tokens: 1, output_tokens: 1 } }),
    };
  };
  const f = (async (url: string, init: RequestInit) =>
    handleCreate(new Request(`https://x${url}`, init), { callModel, limits: CHAT_LIMITS, counters: { get: async (k: string) => m.get(k) ?? 0, set: async (k: string, v: number) => void m.set(k, v) }, visitor: "v", now: new Date() })) as unknown as typeof fetch;
  return { f, seen };
}

describe("naming a chat", () => {
  it("tidies what the model sends back", () => {
    expect(cleanTitle('"Adding two numbers."\nAnd more')).toBe("Adding two numbers");
    expect(cleanTitle("**Sorting**")).toBe("Sorting");
    expect(cleanTitle("  \n")).toBeUndefined();
    expect(cleanTitle("x".repeat(200))).toHaveLength(80);
  });

  it("comes to nothing, quietly, if it fails", async () => {
    expect(await askTitle("hi", { fetch: (async () => new Response("no", { status: 404 })) as never })).toBeUndefined();
    expect(await askTitle("hi", { fetch: (async () => { throw new Error("offline"); }) as never })).toBeUndefined();
    expect(await askTitle("hi", { fetch: (async () => new Response(JSON.stringify({ type: "error", code: "failed", message: "x" }) + "\n")) as never })).toBeUndefined();
  });
});

describe("a chat turn", () => {
  describe("looking at examples", () => {
    const ask = "```examples\nrange(5)\n```";

    it("gets the documents back and carries on, without using up a try", async () => {
      const { f, seen } = proxy([ask, doc(BAD), doc(BAD), `Doubles 2.\n\n${doc(EXAMPLE)}`]);
      const msgs: TurnMsg[] = [];
      const { end, conversation } = await runTurn(newConversation(), "Double 2.", "", { fetch: f, onMessage: (m) => msgs.push(m) });
      expect(end.kind).toBe("ready");
      expect(seen).toHaveLength(4);
      expect(seen[1]!.at(-1)!.content).toContain("# range(5)");
      expect(msgs).toContainEqual({ kind: "looked", names: ["range(5)"] });
      expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    });

    it("can't go on asking for ever: after three looks, asking costs tries, and the conversation stays fit to go on", async () => {
      const { f, seen } = proxy([ask]);
      const first = await runTurn(newConversation(), "Double 2.", "", { fetch: f });
      expect(first.end.kind).toBe("gave-up");
      expect(seen).toHaveLength(3 + 3);
      expect(seen.at(-1)!.at(-1)!.content).toContain("that's enough examples");
      expect(first.conversation.messages.at(-1)!.role).toBe("assistant");
      const next = proxy([`Fine.\n\n${doc(EXAMPLE)}`]);
      const second = await runTurn(first.conversation, "Well?", "", { fetch: next.f });
      expect(second.end.kind).toBe("ready");
    });

    it("looks don't count as tries when it says how far along it is", () => {
      const t = [{ thinking: "", reply: "", looked: ["range(5)"] }, { thinking: "", reply: "" }];
      expect(triesSoFar(t)).toBe(1);
    });
  });

  it("hands over a document that checks out, saying how it ran", async () => {
    const { f } = proxy([`Doubles 2.\n\n${doc(EXAMPLE)}`]);
    const { end } = await runTurn(newConversation(), "Double 2.", "", { fetch: f });
    expect(end).toMatchObject({ kind: "ready", summary: "3 kinds of agent, 2 rules; runs to the end in 3 interactions" });
  });

  it("gets three tries for each message, not three overall", async () => {
    const { f, seen } = proxy([doc(BAD)]);
    const first = await runTurn(newConversation(), "Double 2.", "", { fetch: f });
    expect(first.end).toMatchObject({ kind: "gave-up" });
    expect(seen).toHaveLength(3);
    const second = await runTurn(first.conversation, "Try again.", "", { fetch: f });
    expect(second.end).toMatchObject({ kind: "gave-up" });
    expect(seen).toHaveLength(6);
  });

  it("tells the model what was wrong with its last try, in the next message", async () => {
    const { f, seen } = proxy([doc(BAD), doc(BAD), doc(BAD), doc(EXAMPLE)]);
    const { conversation } = await runTurn(newConversation(), "Double 2.", "", { fetch: f });
    await runTurn(conversation, "Try again.", "", { fetch: f });
    expect(seen[3]!.at(-1)!.content).toMatch(/^netties said about your last document: The text didn't parse[\s\S]*\n\nTry again\./);
  });

  it("answers in words without touching anything", async () => {
    const { f } = proxy(["An active pair is two agents joined by their principal ports."]);
    const c: Conversation = { messages: [], seen: "agent Z 0\n" };
    const { end, conversation } = await runTurn(c, "What's an active pair?", "agent Z 0\n", { fetch: f });
    expect(end).toEqual({ kind: "said" });
    expect(conversation.seen).toBe("agent Z 0\n");
  });

  it("doesn't take a code block that isn't a document for one", async () => {
    const { f } = proxy(["Like this:\n```\nD(x) ~ y\n```"]);
    expect((await runTurn(newConversation(), "Show me a net.", "", { fetch: f })).end).toEqual({ kind: "said" });
  });

  it("asks about a net that gets stuck, and takes the model's word that it's meant to", async () => {
    const { f, seen } = proxy([doc(STUCK), "Yes, the rule isn't written yet."]);
    const { end } = await runTurn(newConversation(), "Start a system.", "", { fetch: f });
    expect(end).toMatchObject({ kind: "ready", code: STUCK + "\n", note: expect.stringMatching(/got stuck/) });
    expect(seen[1]!.at(-1)!.content).toMatch(/If it is, say so and send no document/);
  });

  it("falls back on a stuck document when the fixes never parse", async () => {
    const { f } = proxy([doc(STUCK), doc(BAD), doc(BAD)]);
    const { end, conversation } = await runTurn(newConversation(), "Start a system.", "", { fetch: f });
    expect(end).toMatchObject({ kind: "ready", code: STUCK + "\n" });
    expect(conversation.unsaid).toMatch(/didn't parse/);
  });

  it("doesn't count a document as wrong for having no types", async () => {
    const { f } = proxy([doc("agent 0 0\nagent D 1\n\nD(x) >< 0 => x ~ 0;\n\nD(out) ~ 0;")]);
    expect((await runTurn(newConversation(), "No types please.", "", { fetch: f })).end).toMatchObject({ kind: "ready" });
  });

  it("can be stopped, leaving a conversation that can go on", async () => {
    const ctrl = new AbortController();
    const enc = new TextEncoder();
    const f = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(JSON.stringify({ type: "text", text: "Here goes" }) + "\n"));
            ctrl.signal.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
          },
        }),
      )) as unknown as typeof fetch;
    const messages: TurnMsg[] = [];
    const going = runTurn(newConversation(), "Double 2.", "", {
      fetch: f,
      signal: ctrl.signal,
      onMessage: (m) => {
        messages.push(m);
        if (m.kind === "writing") ctrl.abort();
      },
    });
    const { end, conversation } = await going;
    expect(end).toEqual({ kind: "stopped", by: "stop" });
    expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(conversation.messages[1])).toContain("stopped this reply");
    expect(conversation.seen).toBeUndefined();
  });

  it("passes on what the proxy says when it says no, ready to go on", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { code: "budget", message: "Try again tomorrow." } }), { status: 503 })) as unknown as typeof fetch;
    const { end, conversation } = await runTurn(newConversation(), "Double 2.", "", { fetch: f });
    expect(end).toEqual({ kind: "failed", code: "budget", message: "Try again tomorrow." });
    expect(conversation.messages.at(-1)!.role).toBe("assistant");
  });

  it("alternates turns for the proxy over a whole conversation, whatever becomes of them", async () => {
    const { f } = proxy([doc(BAD), doc(BAD), doc(BAD), "Just words.", doc(EXAMPLE)]);
    let c = newConversation();
    for (const say of ["One.", "Two.", "Three."]) c = (await runTurn(c, say, "", { fetch: f })).conversation;
    expect(c.messages.map((m) => m.role).join(" ")).toMatch(/^(user assistant ?)+$/);
  });
});

describe("a reply that was cut short", () => {
  it("goes back to the model with its reasoning and its words", async () => {
    const ctrl = new AbortController();
    const enc = new TextEncoder();
    const f = (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(JSON.stringify({ type: "thinking", text: "First the zero case." }) + "\n"));
            c.enqueue(enc.encode(JSON.stringify({ type: "text", text: "Here goes" }) + "\n"));
            ctrl.signal.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")));
          },
        }),
      )) as unknown as typeof fetch;
    const { end, conversation } = await runTurn(newConversation(), "Double 2.", "", { fetch: f, signal: ctrl.signal, cutBy: () => "message", onMessage: (m) => m.kind === "writing" && ctrl.abort() });
    expect(end).toEqual({ kind: "stopped", by: "message" });
    const said = JSON.stringify(conversation.messages[1]);
    expect(said).toContain("First the zero case.");
    expect(said).toContain("Here goes");
    expect(said).toContain("sent another message");
  });

  it("keeps what had come in when the page was reloaded", () => {
    let turn = newTurn(1);
    for (const m of [{ kind: "try" }, { kind: "thinking", text: "Hmm.", at: 2 }] as TurnMsg[]) turn = updateTurn(turn, m);
    const { conversation } = settle([{ kind: "user", text: "Double 2." }, { kind: "turn", turn }], newConversation());
    expect(JSON.stringify(conversation.messages[1])).toContain("Hmm.");
  });
});

describe("what goes to the model", () => {
  it("carries the document only when it has changed", () => {
    const c: Conversation = { messages: [], seen: "agent Z 0\n" };
    expect(userMessage("Hi.", "agent Z 0\n", c)).toBe("Hi.");
    expect(userMessage("Hi.", "agent Y 0\n", c)).toBe("Hi.\n\nThe document as it stands now:\n```inet\nagent Y 0\n```");
    expect(userMessage("Hi.", "", newConversation())).toBe("Hi.\n\nThe document is empty.");
  });
});

describe("how a turn moves along", () => {
  it("collects what comes in and how it ended", () => {
    let t = newTurn(1000);
    for (const m of [{ kind: "try" }, { kind: "thinking", text: "a", at: 1100 }, { kind: "thinking", text: "b", at: 1500 }, { kind: "writing", text: "c" }, { kind: "checked", code: "x", problem: "p" }, { kind: "try" }, { kind: "over", end: { kind: "stopped", by: "stop" }, at: 3000 }] as TurnMsg[]) t = updateTurn(t, m);
    expect(t.tries).toEqual([{ thinking: "ab", thoughtFrom: 1100, thoughtMs: 400, reply: "c", code: "x", problem: "p", soft: undefined }, { thinking: "", reply: "" }]);
    expect(t.phase).toEqual({ kind: "over", end: { kind: "stopped", by: "stop" } });
    expect(t.took).toBe(2000);
  });
});

describe("a chat brought back after a reload", () => {
  it("keeps a message whose reply never finished, and can go on from it", () => {
    const c: Conversation = { messages: [], seen: "agent Z 0\n" };
    const { entries, conversation } = settle([{ kind: "user", text: "Double 2." }, { kind: "turn", turn: newTurn(1) }], c);
    expect(entries[0]).toEqual({ kind: "user", text: "Double 2." });
    expect(entries[1]).toMatchObject({ turn: { phase: { kind: "over", end: { kind: "stopped" } } } });
    expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conversation.seen).toBeUndefined();
  });

  it("leaves a finished chat as it was", () => {
    const entries: Entry[] = [{ kind: "user", text: "Hi." }, { kind: "turn", turn: updateTurn(newTurn(1), { kind: "over", end: { kind: "said" }, at: 2 }) }];
    const c = newConversation();
    expect(settle(entries, c)).toEqual({ entries, conversation: c });
  });
});
