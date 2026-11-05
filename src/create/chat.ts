import { checkDocument, extractDocument } from "./check";
import { type Block, type Message, TRIES } from "./client";
import { examplesReply, namesAskedFor } from "./exampleDocs";
import { type Effort, ModelError, type PlainMessage, type ReplyEvent } from "./provider";

/**
 * One turn of the chat: send what the visitor said to the model, check any
 * document that comes back, and feed problems back to the model. Each visitor
 * message gets three tries of its own. The canvas isn't touched here: a turn
 * that ends "ready" hands its document over to go on it.
 */

/** A model to ask: which one is up to whoever passes this. */
export type Asker = (messages: PlainMessage[], signal?: AbortSignal) => AsyncIterable<ReplyEvent>;

/** Which model a reply came from, and how hard it was asked to think. */
export interface ModelTag {
  provider: string;
  model: string;
  effort: Effort;
}

/** The conversation so far, as the model sees it. */
export interface Conversation {
  messages: Message[];
  /** The document as the model last knew it; if it has changed since, the next message carries it. */
  seen?: string;
  /** What netties has yet to tell the model about its last document. */
  unsaid?: string;
}

export const newConversation = (): Conversation => ({ messages: [] });

/** One call to the model, as it unfolds. */
export interface Try {
  thinking: string;
  reply: string;
  /** When the thinking began, and how long it went on. */
  thoughtFrom?: number;
  thoughtMs?: number;
  /** What netties said about the document in it. */
  problem?: string;
  /** The problem doesn't rule the document out: the model was asked if it's meant to be like that. */
  soft?: boolean;
  code?: string;
  /** The examples it asked to see. A call that's only that isn't a try at anything. */
  looked?: string[];
  /** It picks up a reply that was cut short, and starts the count of tries again. */
  resumed?: boolean;
  /** Something the visitor should know about how the request was taken. */
  note?: string;
}

/** What ended a reply early. */
export type CutBy = "stop" | "message" | "reload";

export type TurnEnd =
  /** A document for the canvas. `note` is anything about it the visitor should know. */
  | { kind: "ready"; code: string; summary: string; note?: string }
  /** It has been on the canvas. `shown` is how it printed there, to tell if it still is. */
  | { kind: "applied"; code: string; summary: string; note?: string; shown?: string }
  /** Words alone: nothing to put on the canvas. */
  | { kind: "said" }
  /** Every try had something wrong with its document. */
  | { kind: "gave-up"; feedback: string; code?: string }
  /** It was cut short before it finished. */
  | { kind: "stopped"; by: CutBy }
  /** The provider or the network said no, or the reply didn't finish. */
  | { kind: "failed"; code: string; message: string };

export type Phase = { kind: "waiting" } | { kind: "thinking" } | { kind: "writing" } | { kind: "over"; end: TurnEnd };

export interface Turn {
  tries: Try[];
  phase: Phase;
  /** When it started, for the time shown beside it. */
  since: number;
  /** How long it took. */
  took?: number;
  /** The model it came from, in chats saved since there was a choice. */
  by?: ModelTag;
}

export type TurnMsg =
  | { kind: "try"; resumed?: boolean }
  | { kind: "note"; text: string }
  | { kind: "thinking"; text: string; at: number }
  | { kind: "writing"; text: string }
  | { kind: "checked"; code: string; problem?: string; soft?: boolean }
  | { kind: "looked"; names: string[] }
  | { kind: "over"; end: TurnEnd; at: number };

/** Where a message was sent from, to go back there if it's edited. */
export interface Rewind {
  messages: number;
  seen?: string;
  unsaid?: string;
  /** The document at the time. */
  doc: string;
}

/** What the chat shows: what was said, and what became of it. */
export type Entry = { kind: "user"; text: string; at?: Rewind } | { kind: "turn"; turn: Turn };

/** The conversation as it was just before that message. */
export const rewind = (c: Conversation, at: Rewind): Conversation => ({ messages: c.messages.slice(0, at.messages), seen: at.seen, unsaid: at.unsaid });

/** A document held back is just one that was never put on the canvas, once the chat moves on. */
export const unhold = (e: Entry): Entry => (e.kind === "turn" && e.turn.phase.kind === "over" && e.turn.phase.end.kind === "ready" ? { ...e, turn: { ...e.turn, phase: { kind: "over", end: { ...e.turn.phase.end, kind: "applied" } } } } : e);

/**
 * A chat as saved, made whole again. A reply that was going when the page went
 * away can't be picked up, but what was asked is kept, for the visitor and the model.
 */
export function settle(entries: Entry[], c: Conversation, by: CutBy = "reload"): { entries: Entry[]; conversation: Conversation } {
  const last = entries.at(-1);
  const asked = entries.at(-2);
  if (last?.kind !== "turn" || last.turn.phase.kind === "over" || asked?.kind !== "user") return { entries, conversation: c };
  const cut = last.turn.tries.at(-1);
  // A reply that was picking up an earlier one was asked for by that, not by what the visitor said: that's already in the history.
  const said = last.turn.tries.some((x) => x.resumed) ? RESUME : asked.text;
  return {
    entries: [...entries.slice(0, -1), { kind: "turn", turn: { ...last.turn, phase: { kind: "over", end: { kind: "stopped", by } } } }],
    conversation: {
      ...c,
      seen: undefined,
      messages: [...c.messages, { role: "user", content: said }, { role: "assistant", content: [{ type: "text", text: cutShort(WHY[by], cut?.thinking ?? "", cut?.reply ?? "") }] }],
    },
  };
}

const WHY: Record<CutBy, string> = {
  stop: "The visitor stopped this reply before it finished.",
  message: "The visitor sent another message before this reply finished.",
  reload: "The page was reloaded before this reply finished.",
};

/** A reply that never finished, for the history: the reasoning counts as much as the words, so the model can pick up where it left off. */
export function cutShort(why: string, thinking: string, text: string): string {
  const parts = [`(${why})`];
  if (thinking.trim()) parts.push(`My reasoning so far:\n${thinking.trim()}`);
  if (text.trim()) parts.push(`My reply so far:\n${text.trim()}`);
  return parts.join("\n\n");
}

/** What the model is told when a reply is resumed, which the visitor doesn't see. It has how far it got in the history. A document has to come whole, since that's what gets checked. */
export const RESUME = "Carry on from exactly where you left off, without going over what you've already said. If you were partway through a document, write the whole document.";

/** Whether a turn that ended can be picked up: it was cut short with something to go on, not just refused. */
export function canResume(turn: Turn): boolean {
  if (turn.phase.kind !== "over") return false;
  const end = turn.phase.end;
  if (end.kind === "stopped") return end.by !== "message";
  if (end.kind !== "failed" || !["cut-off", "dropped", "unreachable", "failed"].includes(end.code)) return false;
  // A resume that failed before saying anything still has what came before it to go on.
  for (let i = turn.tries.length - 1; i >= 0; i--) {
    const t = turn.tries[i]!;
    if (t.thinking.trim() || t.reply.trim()) return true;
    if (!t.resumed) return false;
  }
  return false;
}

/** Which try this is, not counting calls that only asked to see examples. A resumed reply starts the count again. */
export function triesSoFar(tries: Try[]): number {
  const from = tries.map((t) => !!t.resumed).lastIndexOf(true);
  return tries.slice(Math.max(from, 0)).filter((t) => !t.looked).length;
}

export const newTurn = (since: number, by?: ModelTag): Turn => ({ tries: [], phase: { kind: "waiting" }, since, ...(by ? { by } : {}) });

/** A turn going again from where it was cut short. */
export const resumedTurn = (t: Turn, since: number, by?: ModelTag): Turn => ({ ...t, phase: { kind: "waiting" }, since, took: undefined, ...(by ? { by } : {}) });

/** How a turn moves along. */
export function updateTurn(t: Turn, msg: TurnMsg): Turn {
  const last = (f: (x: Try) => Try) => ({ ...t, tries: t.tries.map((x, i) => (i === t.tries.length - 1 ? f(x) : x)) });
  switch (msg.kind) {
    case "try":
      return { ...t, phase: { kind: "waiting" }, tries: [...t.tries, { thinking: "", reply: "", ...(msg.resumed ? { resumed: true } : {}) }] };
    case "note":
      return last((x) => ({ ...x, note: msg.text }));
    case "thinking":
      return {
        ...last((x) => {
          const from = x.thoughtFrom ?? msg.at;
          return { ...x, thinking: x.thinking + msg.text, thoughtFrom: from, thoughtMs: msg.at - from };
        }),
        phase: { kind: "thinking" },
      };
    case "writing":
      return { ...last((x) => ({ ...x, reply: x.reply + msg.text })), phase: { kind: "writing" } };
    case "checked":
      return last((x) => ({ ...x, code: msg.code, problem: msg.problem, soft: msg.soft }));
    case "looked":
      return last((x) => ({ ...x, looked: msg.names }));
    case "over":
      return { ...t, phase: { kind: "over", end: msg.end }, took: msg.at - t.since };
  }
}

const inet = (doc: string) => "```inet\n" + doc.trimEnd() + "\n```";

/** What goes to the model for what the visitor typed: anything netties has yet to say, and the document if it has changed. */
export function userMessage(request: string, doc: string, c: Conversation): string {
  const before = c.unsaid ? `netties said about your last document: ${c.unsaid}\n\n` : "";
  if (doc === c.seen) return before + request;
  return `${before}${request}\n\n${doc.trim() ? `The document as it stands now:\n${inet(doc)}` : "The document is empty."}`;
}

export interface TurnOptions {
  ask: Asker;
  onMessage?: (m: TurnMsg) => void;
  signal?: AbortSignal;
  /** Why `signal` fired. */
  cutBy?: () => CutBy;
  /** This picks up a reply that was cut short. */
  resuming?: boolean;
}

/** However it ended, what had come in so far. */
type Asked = { thinking: string; text: string } & ({ kind: "reply"; content: Block[] } | { kind: "failed"; code: string; message: string } | { kind: "stopped" });

/** How many times a model can ask to see examples for each visitor message. */
const LOOKS = 3;

/** A title for a chat, from what was first said in it. If it doesn't come, nothing's lost: the chat goes by its first line. */
export async function askTitle(text: string, ask: Asker): Promise<string | undefined> {
  try {
    let title = "";
    for await (const ev of ask([{ role: "user", content: text.slice(0, 2000) }])) if (ev.kind === "text") title += ev.text;
    return cleanTitle(title);
  } catch {
    return undefined;
  }
}

export const cleanTitle = (raw: string) => raw.trim().split("\n")[0]!.replace(/^["'*#\s]+|["'*.\s]+$/g, "").slice(0, 80) || undefined;

/** A message as a provider wants it. Saved replies are lists of blocks, and some providers refuse an empty message. */
export function plain(m: Message): PlainMessage {
  if (m.role === "user") return m;
  const text = m.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
  return { role: "assistant", content: text || "(No reply.)" };
}

/** One call to the model. */
async function ask(messages: Message[], opts: TurnOptions): Promise<Asked> {
  let text = "";
  let thinking = "";
  try {
    for await (const ev of opts.ask(messages.map(plain), opts.signal)) {
      if (ev.kind === "thinking") {
        thinking += ev.text;
        opts.onMessage?.({ kind: "thinking", text: ev.text, at: Date.now() });
      } else if (ev.kind === "text") {
        text += ev.text;
        opts.onMessage?.({ kind: "writing", text: ev.text });
      } else opts.onMessage?.({ kind: "note", text: ev.text });
    }
    if (opts.signal?.aborted) return { kind: "stopped", thinking, text };
    return { kind: "reply", thinking, text, content: [{ type: "text", text }] };
  } catch (e) {
    if (opts.signal?.aborted) return { kind: "stopped", thinking, text };
    if (e instanceof ModelError) return { kind: "failed", thinking, text, code: e.code, message: e.message };
    console.error("chat failed", e);
    return { kind: "failed", thinking, text, code: "failed", message: "Something went wrong asking the model. Try again in a moment." };
  }
}

const summarise = (c: { types: number; rules: number; interactions?: number }) => {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const run = c.interactions === undefined ? "" : `; runs to the end in ${n(c.interactions, "interaction")}`;
  return `${`${c.types} ${c.types === 1 ? "kind" : "kinds"} of agent`}, ${n(c.rules, "rule")}${run}`;
};

/** The feedback that asks for a fix, and the one that leaves it up to the model. */
const fixIt = (feedback: string) => `netties says: ${feedback}\n\nReply with the whole corrected document.`;
const orSaySo = (feedback: string) => `netties says: ${feedback}\n\nIf that isn't what the visitor wants, reply with the whole corrected document. If it is, say so and send no document.`;

/**
 * A turn from what the visitor typed to its end. The conversation that comes
 * back is always ready for the next message, however this one ended: it has
 * the reply or a note saying what became of it, since a model's turns have to alternate.
 */
export async function runTurn(c: Conversation, request: string, doc: string, opts: TurnOptions): Promise<{ end: TurnEnd; conversation: Conversation }> {
  const messages: Message[] = [...c.messages, { role: "user", content: userMessage(request, doc, c) }];
  const close = (note: string): Message => ({ role: "assistant", content: [{ type: "text", text: note }] });
  /** Unless a document is accepted, the model and the canvas no longer agree. */
  const over = (end: TurnEnd, unsaid?: string) => ({ end, conversation: { messages, unsaid, seen: end.kind === "said" ? c.seen : undefined } });
  /** A document with something to say about it, kept in case nothing better comes. */
  let kept: { code: string; summary: string; note: string } | undefined;
  let lastProblem = "";
  let lastCode: string | undefined;
  let looks = 0;

  let resuming = opts.resuming;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    opts.onMessage?.(resuming ? { kind: "try", resumed: true } : { kind: "try" });
    resuming = false;
    const asked = await ask(messages, opts);
    if (asked.kind === "failed") {
      messages.push(close(cutShort(`That reply didn't arrive: ${asked.message}`, asked.thinking, asked.text)));
      return over({ kind: "failed", code: asked.code, message: asked.message });
    }
    if (asked.kind === "stopped") {
      const by = opts.cutBy?.() ?? "stop";
      messages.push(close(cutShort(WHY[by], asked.thinking, asked.text)));
      return over({ kind: "stopped", by });
    }
    messages.push({ role: "assistant", content: asked.content });

    const names = namesAskedFor(asked.text);
    if (names) {
      opts.onMessage?.({ kind: "looked", names });
      // Once it has had its looks, going on asking costs it a try, so this can't go on forever.
      if (looks++ < LOOKS) attempt--;
      else lastProblem = "It kept asking to see examples instead of replying.";
      messages.push({ role: "user", content: looks <= LOOKS ? examplesReply(names) : "netties says: that's enough examples for this message. Reply now." });
      continue;
    }

    const code = extractDocument(asked.text);
    if (code === undefined) {
      if (kept) return over({ kind: "ready", ...kept });
      return over({ kind: "said" });
    }
    const check = checkDocument(code);
    lastCode = code;
    if (check.kind === "fine") {
      opts.onMessage?.({ kind: "checked", code });
      return over({ kind: "ready", code, summary: summarise(check) });
    }
    opts.onMessage?.({ kind: "checked", code, problem: check.feedback, soft: check.kind === "concern" });
    lastProblem = check.feedback;
    if (check.kind === "concern") kept = { code, summary: summarise(check), note: check.feedback };
    if (attempt < TRIES) messages.push({ role: "user", content: check.kind === "concern" ? orSaySo(check.feedback) : fixIt(check.feedback) });
  }
  // The model never got to hear about its last try.
  if (messages.at(-1)?.role === "user" && messages.length > c.messages.length + 1) messages.pop();
  if (kept) return over({ kind: "ready", ...kept }, lastProblem);
  return over({ kind: "gave-up", feedback: lastProblem, code: lastCode }, lastProblem);
}
