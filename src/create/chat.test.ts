import { describe, expect, it } from "vitest";
import { type Asker, type Conversation, type Entry, RESUME, type Turn, type TurnMsg, askTitle, canResume, cleanTitle, joinResumed, newConversation, newTurn, plain, resumedTurn, runTurn, seamIndex, settle, triesSoFar, updateTurn, userMessage } from "./chat";
import { EXAMPLE } from "./prompt";
import { ModelError, type ReplyEvent } from "./provider";

const doc = (s: string) => "```inet\n" + s + "\n```";
const BAD = "agent D 1\nD(out) ~ ;";
const STUCK = "agent 0 0\nagent D 1\n\nD(out) ~ 0;";

/** A model giving scripted replies in turn, keeping what it was sent. */
function proxy(replies: string[]) {
  const seen: { role: string; content: unknown }[][] = [];
  let i = 0;
  const f: Asker = async function* (messages) {
    seen.push(structuredClone(messages));
    yield { kind: "thinking", text: "hmm" };
    yield { kind: "text", text: replies[Math.min(i++, replies.length - 1)]! };
  };
  return { f, seen };
}

/** A model that says these things, then goes on until it's stopped. */
const goingOn = (ctrl: AbortController, ...events: ReplyEvent[]): Asker =>
  async function* () {
    yield* events;
    await new Promise((_, reject) => {
      const stop = () => reject(new DOMException("Aborted", "AbortError"));
      if (ctrl.signal.aborted) stop();
      else ctrl.signal.addEventListener("abort", stop);
    });
  };

describe("a resumed reply as it's shown", () => {
  const A = { provider: "p", model: "a", effort: "default" as const };
  const B = { provider: "p", model: "b", effort: "high" as const };
  const marks = (s: string) => s.replace(/[\uE000-\uF8FF]/g, (m) => `[${seamIndex(m)}]`);

  it("leaves tries that weren't resumed apart", () => {
    const shown = joinResumed([{ thinking: "", reply: "one", problem: "p" }, { thinking: "", reply: "two" }]);
    expect(shown.map((t) => [t.words, t.upTo])).toEqual([["one", 0], ["two", 1]]);
  });

  it("carries the words on from the fragment, with a seam where it picks up", () => {
    const [one, ...rest] = joinResumed([{ thinking: "", reply: "each succes", by: A }, { thinking: "", reply: "sor into two", resumed: true, by: A }]);
    expect(rest).toEqual([]);
    expect(marks(one!.words)).toBe("each succes[0]sor into two");
    expect(one!.seams).toEqual([{}]);
    expect(one!.upTo).toBe(1);
  });

  it("names the model at the seam if it changed, and not for a change of level alone", () => {
    expect(joinResumed([{ thinking: "", reply: "x", by: A }, { thinking: "", reply: "y", resumed: true, by: B }])[0]!.seams).toEqual([{ to: B }]);
    expect(joinResumed([{ thinking: "", reply: "x", by: B }, { thinking: "", reply: "y", resumed: true, by: { ...B, effort: "low" } }])[0]!.seams).toEqual([{}]);
    // Chats saved before each try knew its model just say it was resumed.
    expect(joinResumed([{ thinking: "", reply: "x" }, { thinking: "", reply: "y", resumed: true, by: B }])[0]!.seams).toEqual([{}]);
  });

  it("makes one row of the thinking, adding up the time", () => {
    const shown = joinResumed([
      { thinking: "a", reply: "", thoughtFrom: 100, thoughtMs: 1000 },
      { thinking: "b", reply: "", thoughtFrom: 5000, thoughtMs: 2000, resumed: true },
      { thinking: "c", reply: "w", thoughtFrom: 9000, thoughtMs: 500, resumed: true },
    ]);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.thinking).toBe("a\n\nb\n\nc");
    expect(shown[0]!.thoughtMs).toBe(3500);
    // So the time counts on from what it had, while it's still thinking.
    expect(shown[0]!.thoughtFrom).toBe(9000 - 3000);
  });

  it("shows a seam on its own when no words came before it", () => {
    const [one] = joinResumed([{ thinking: "a", reply: "", by: A }, { thinking: "b", reply: "words", resumed: true, by: B }]);
    expect(one!.words).toBe("words");
    expect(one!.seams).toEqual([]);
    expect(one!.pickedUp).toEqual({ to: B });
  });

  it("takes a document out of each part on its own, so one cut short doesn't swallow the words after it", () => {
    const [one] = joinResumed([{ thinking: "", reply: "Here:\n\n```inet\nagent D", by: A }, { thinking: "", reply: "Again.\n\n```inet\nagent D 1\n```\nDone.", resumed: true, by: A }]);
    expect(marks(one!.words)).toBe("Here:[0]\n\nAgain.\n\n\nDone.");
    expect(one!.reply).toContain("agent D 1");
  });

  it("puts the seam ahead of line breaks, so what follows still starts a line", () => {
    const [one] = joinResumed([{ thinking: "", reply: "First.\n\n" }, { thinking: "", reply: "- item", resumed: true }]);
    expect(marks(one!.words)).toBe("First.[0]\n\n- item");
  });

  it("changes nothing that's kept", () => {
    const tries = [{ thinking: "a", reply: "x" }, { thinking: "b", reply: "y", resumed: true }];
    const copy = structuredClone(tries);
    joinResumed(tries);
    expect(tries).toEqual(copy);
  });
});

describe("naming a chat", () => {
  it("tidies what the model sends back", () => {
    expect(cleanTitle('"Adding two numbers."\nAnd more')).toBe("Adding two numbers");
    expect(cleanTitle("**Sorting**")).toBe("Sorting");
    expect(cleanTitle("  \n")).toBeUndefined();
    expect(cleanTitle("x".repeat(200))).toHaveLength(80);
  });

  it("comes to nothing, quietly, if it fails", async () => {
    const failing: Asker = async function* () {
      throw new ModelError("key", "no");
    };
    expect(await askTitle("hi", failing)).toBeUndefined();
    const said: Asker = async function* () {
      yield { kind: "thinking", text: "ignored" };
      yield { kind: "text", text: "Saying hello." };
    };
    expect(await askTitle("hi", said)).toBe("Saying hello");
  });
});

describe("a chat turn", () => {
  describe("looking at examples", () => {
    const ask = "```examples\nrange(5)\n```";

    it("gets the documents back and carries on, without using up a try", async () => {
      const { f, seen } = proxy([ask, doc(BAD), doc(BAD), `Doubles 2.\n\n${doc(EXAMPLE)}`]);
      const msgs: TurnMsg[] = [];
      const { end, conversation } = await runTurn(newConversation(), "Double 2.", "", { ask: f, onMessage: (m) => msgs.push(m) });
      expect(end.kind).toBe("ready");
      expect(seen).toHaveLength(4);
      expect(seen[1]!.at(-1)!.content).toContain("# range(5)");
      expect(msgs).toContainEqual({ kind: "looked", names: ["range(5)"] });
      expect(conversation.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    });

    it("can't go on asking for ever: after three looks, asking costs tries, and the conversation stays fit to go on", async () => {
      const { f, seen } = proxy([ask]);
      const first = await runTurn(newConversation(), "Double 2.", "", { ask: f });
      expect(first.end.kind).toBe("gave-up");
      expect(seen).toHaveLength(3 + 3);
      expect(seen.at(-1)!.at(-1)!.content).toContain("that's enough examples");
      expect(first.conversation.messages.at(-1)!.role).toBe("assistant");
      const next = proxy([`Fine.\n\n${doc(EXAMPLE)}`]);
      const second = await runTurn(first.conversation, "Well?", "", { ask: next.f });
      expect(second.end.kind).toBe("ready");
    });

    it("looks don't count as tries when it says how far along it is", () => {
      const t = [{ thinking: "", reply: "", looked: ["range(5)"] }, { thinking: "", reply: "" }];
      expect(triesSoFar(t)).toBe(1);
    });
  });

  it("hands over a document that checks out, saying how it ran", async () => {
    const { f } = proxy([`Doubles 2.\n\n${doc(EXAMPLE)}`]);
    const { end } = await runTurn(newConversation(), "Double 2.", "", { ask: f });
    expect(end).toMatchObject({ kind: "ready", summary: "3 kinds of agent, 2 rules; runs to the end in 3 interactions" });
  });

  it("gets three tries for each message, not three overall", async () => {
    const { f, seen } = proxy([doc(BAD)]);
    const first = await runTurn(newConversation(), "Double 2.", "", { ask: f });
    expect(first.end).toMatchObject({ kind: "gave-up" });
    expect(seen).toHaveLength(3);
    const second = await runTurn(first.conversation, "Try again.", "", { ask: f });
    expect(second.end).toMatchObject({ kind: "gave-up" });
    expect(seen).toHaveLength(6);
  });

  it("tells the model what was wrong with its last try, in the next message", async () => {
    const { f, seen } = proxy([doc(BAD), doc(BAD), doc(BAD), doc(EXAMPLE)]);
    const { conversation } = await runTurn(newConversation(), "Double 2.", "", { ask: f });
    await runTurn(conversation, "Try again.", "", { ask: f });
    expect(seen[3]!.at(-1)!.content).toMatch(/^netties said about your last document: The text didn't parse[\s\S]*\n\nTry again\./);
  });

  it("answers in words without touching anything", async () => {
    const { f } = proxy(["An active pair is two agents joined by their principal ports."]);
    const c: Conversation = { messages: [], seen: "agent Z 0\n" };
    const { end, conversation } = await runTurn(c, "What's an active pair?", "agent Z 0\n", { ask: f });
    expect(end).toEqual({ kind: "said" });
    expect(conversation.seen).toBe("agent Z 0\n");
  });

  it("doesn't take a code block that isn't a document for one", async () => {
    const { f } = proxy(["Like this:\n```\nD(x) ~ y\n```"]);
    expect((await runTurn(newConversation(), "Show me a net.", "", { ask: f })).end).toEqual({ kind: "said" });
  });

  it("asks about a net that gets stuck, and takes the model's word that it's meant to", async () => {
    const { f, seen } = proxy([doc(STUCK), "Yes, the rule isn't written yet."]);
    const { end } = await runTurn(newConversation(), "Start a system.", "", { ask: f });
    expect(end).toMatchObject({ kind: "ready", code: STUCK + "\n", note: expect.stringMatching(/got stuck/) });
    expect(seen[1]!.at(-1)!.content).toMatch(/If it is, say so and send no document/);
  });

  it("falls back on a stuck document when the fixes never parse", async () => {
    const { f } = proxy([doc(STUCK), doc(BAD), doc(BAD)]);
    const { end, conversation } = await runTurn(newConversation(), "Start a system.", "", { ask: f });
    expect(end).toMatchObject({ kind: "ready", code: STUCK + "\n" });
    expect(conversation.unsaid).toMatch(/didn't parse/);
  });

  it("doesn't count a document as wrong for having no types", async () => {
    const { f } = proxy([doc("agent 0 0\nagent D 1\n\nD(x) >< 0 => x ~ 0;\n\nD(out) ~ 0;")]);
    expect((await runTurn(newConversation(), "No types please.", "", { ask: f })).end).toMatchObject({ kind: "ready" });
  });

  it("can be stopped, leaving a conversation that can go on", async () => {
    const ctrl = new AbortController();
    const f = goingOn(ctrl, { kind: "text", text: "Here goes" });
    const messages: TurnMsg[] = [];
    const going = runTurn(newConversation(), "Double 2.", "", {
      ask: f,
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

  it("passes on what the provider says when it says no, ready to go on", async () => {
    const f: Asker = async function* () {
      throw new ModelError("rate", "Try again tomorrow.");
    };
    const { end, conversation } = await runTurn(newConversation(), "Double 2.", "", { ask: f });
    expect(end).toEqual({ kind: "failed", code: "rate", message: "Try again tomorrow." });
    expect(conversation.messages.at(-1)!.role).toBe("assistant");
  });

  it("alternates turns over a whole conversation, whatever becomes of them", async () => {
    const { f } = proxy([doc(BAD), doc(BAD), doc(BAD), "Just words.", doc(EXAMPLE)]);
    let c = newConversation();
    for (const say of ["One.", "Two.", "Three."]) c = (await runTurn(c, say, "", { ask: f })).conversation;
    expect(c.messages.map((m) => m.role).join(" ")).toMatch(/^(user assistant ?)+$/);
  });
});

describe("a reply that was cut short", () => {
  it("goes back to the model with its reasoning and its words", async () => {
    const ctrl = new AbortController();
    const f = goingOn(ctrl, { kind: "thinking", text: "First the zero case." }, { kind: "text", text: "Here goes" });
    const { end, conversation } = await runTurn(newConversation(), "Double 2.", "", { ask: f, signal: ctrl.signal, cutBy: () => "message", onMessage: (m) => m.kind === "writing" && ctrl.abort() });
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

describe("resuming a reply", () => {
  const over = (t: Turn, end: Extract<TurnMsg, { kind: "over" }>["end"]) => updateTurn(t, { kind: "over", end, at: 2 });
  const withWords = () => updateTurn(updateTurn(newTurn(1), { kind: "try" }), { kind: "writing", text: "Par" });

  it("is offered for a reply cut short, not one that was refused or that never began", () => {
    expect(canResume(over(withWords(), { kind: "stopped", by: "stop" }))).toBe(true);
    expect(canResume(over(withWords(), { kind: "stopped", by: "reload" }))).toBe(true);
    expect(canResume(over(withWords(), { kind: "stopped", by: "message" }))).toBe(false);
    expect(canResume(over(withWords(), { kind: "failed", code: "cut-off", message: "" }))).toBe(true);
    expect(canResume(over(withWords(), { kind: "failed", code: "dropped", message: "" }))).toBe(true);
    expect(canResume(over(withWords(), { kind: "failed", code: "refused", message: "" }))).toBe(false);
    expect(canResume(over(withWords(), { kind: "failed", code: "key", message: "" }))).toBe(false);
    expect(canResume(over(updateTurn(newTurn(1), { kind: "try" }), { kind: "failed", code: "dropped", message: "" }))).toBe(false);
    expect(canResume(over(withWords(), { kind: "said" }))).toBe(false);
    // A resume that failed before it said anything still has what came before it.
    expect(canResume(over(updateTurn(withWords(), { kind: "try", resumed: true }), { kind: "failed", code: "unreachable", message: "" }))).toBe(true);
    expect(canResume(withWords())).toBe(false);
  });

  it("gives the model how far it got and asks it to carry on, without the visitor saying anything", async () => {
    const dropped: Asker = async function* () {
      yield { kind: "thinking", text: "First the zero case." };
      yield { kind: "text", text: "Here go" };
      throw new ModelError("dropped", "It dropped.");
    };
    const first = await runTurn(newConversation(), "Double 2.", "", { ask: dropped });
    expect(first.end).toMatchObject({ kind: "failed", code: "dropped" });
    const { f, seen } = proxy([`es.\n\n${doc(EXAMPLE)}`]);
    const msgs: TurnMsg[] = [];
    const { end, conversation } = await runTurn(first.conversation, RESUME, "", { ask: f, resuming: true, onMessage: (m) => msgs.push(m) });
    expect(end).toMatchObject({ kind: "ready" });
    expect(JSON.stringify(seen[0]![1])).toContain("First the zero case.");
    expect(JSON.stringify(seen[0]![1])).toContain("Here go");
    expect(seen[0]!.at(-1)!.content).toContain(RESUME);
    expect(msgs[0]).toEqual({ kind: "try", resumed: true });
    expect(conversation.messages.map((m) => m.role).join(" ")).toMatch(/^(user assistant ?)+$/);
  });

  it("starts the count of tries again", () => {
    const t = [{ thinking: "", reply: "" }, { thinking: "", reply: "" }, { thinking: "", reply: "" }, { thinking: "", reply: "", resumed: true }, { thinking: "", reply: "" }];
    expect(triesSoFar(t)).toBe(2);
    expect(triesSoFar(t.slice(0, 3))).toBe(3);
  });

  it("carries on in the same turn, with the words so far still there", () => {
    let t = resumedTurn(over(withWords(), { kind: "stopped", by: "stop" }), 50, { provider: "p", model: "m2", effort: "default" });
    expect(t).toMatchObject({ phase: { kind: "waiting" }, since: 50, took: undefined, by: { model: "m2" } });
    t = updateTurn(t, { kind: "try", resumed: true });
    expect(t.tries).toEqual([{ thinking: "", reply: "Par" }, { thinking: "", reply: "", resumed: true, by: { provider: "p", model: "m2", effort: "default" } }]);
  });

  it("is cut short again by a reload without saying the visitor asked twice", () => {
    let t = over(withWords(), { kind: "stopped", by: "stop" });
    t = updateTurn(resumedTurn(t, 3), { kind: "try", resumed: true });
    t = updateTurn(t, { kind: "writing", text: "tial" });
    const before: Conversation = { messages: [{ role: "user", content: "Double 2." }, { role: "assistant", content: [{ type: "text", text: "cut" }] }] };
    const { conversation } = settle([{ kind: "user", text: "Double 2." }, { kind: "turn", turn: t }], before);
    expect(conversation.messages.map((m) => (m.role === "user" ? m.content : "")).filter(Boolean)).toEqual(["Double 2.", RESUME]);
    expect(JSON.stringify(conversation.messages.at(-1))).toContain("tial");
  });
});

describe("a message as a provider wants it", () => {
  it("is plain text, never empty", () => {
    expect(plain({ role: "user", content: "Hi." })).toEqual({ role: "user", content: "Hi." });
    expect(plain({ role: "assistant", content: [{ type: "text", text: "a" }, { type: "thinking" }, { type: "text", text: "b" }] })).toEqual({ role: "assistant", content: "ab" });
    expect(plain({ role: "assistant", content: [{ type: "text", text: "" }] })).toEqual({ role: "assistant", content: "(No reply.)" });
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
