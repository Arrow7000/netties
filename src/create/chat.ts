import { checkDocument, extractDocument } from "./check";
import { type Block, type Message, TRIES, lines } from "./client";

/**
 * One turn of the chat: send what the visitor said to /api/chat, check any
 * document that comes back, and feed problems back to the model. Each visitor
 * message gets three tries of its own. The canvas isn't touched here: a turn
 * that ends "ready" hands its document over to go on it.
 */

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
  /** What netties said about the document in it. */
  problem?: string;
  code?: string;
}

export type TurnEnd =
  /** A document for the canvas. `note` is anything about it the visitor should know. */
  | { kind: "ready"; code: string; summary: string; note?: string }
  /** It's on the canvas. */
  | { kind: "applied"; code: string; summary: string; note?: string; undone?: boolean }
  /** Words alone: nothing to put on the canvas. */
  | { kind: "said" }
  /** Every try had something wrong with its document. */
  | { kind: "gave-up"; feedback: string; code?: string }
  /** The visitor pressed Stop. */
  | { kind: "stopped" }
  /** The proxy or the network said no. */
  | { kind: "failed"; code: string; message: string };

export type Phase = { kind: "waiting" } | { kind: "thinking" } | { kind: "writing" } | { kind: "over"; end: TurnEnd };

export interface Turn {
  tries: Try[];
  phase: Phase;
  /** When it started, for the time shown beside it. */
  since: number;
  /** How long it took. */
  took?: number;
}

export type TurnMsg =
  | { kind: "try" }
  | { kind: "thinking"; text: string }
  | { kind: "writing"; text: string }
  | { kind: "checked"; code: string; problem?: string }
  | { kind: "over"; end: TurnEnd; at: number };

export const newTurn = (since: number): Turn => ({ tries: [], phase: { kind: "waiting" }, since });

/** How a turn moves along. */
export function updateTurn(t: Turn, msg: TurnMsg): Turn {
  const last = (f: (x: Try) => Try) => ({ ...t, tries: t.tries.map((x, i) => (i === t.tries.length - 1 ? f(x) : x)) });
  switch (msg.kind) {
    case "try":
      return { ...t, phase: { kind: "waiting" }, tries: [...t.tries, { thinking: "", reply: "" }] };
    case "thinking":
      return { ...last((x) => ({ ...x, thinking: x.thinking + msg.text })), phase: { kind: "thinking" } };
    case "writing":
      return { ...last((x) => ({ ...x, reply: x.reply + msg.text })), phase: { kind: "writing" } };
    case "checked":
      return last((x) => ({ ...x, code: msg.code, problem: msg.problem }));
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
  onMessage?: (m: TurnMsg) => void;
  signal?: AbortSignal;
  endpoint?: string;
  fetch?: typeof fetch;
}

type Asked = { kind: "reply"; text: string; content: Block[] } | { kind: "failed"; code: string; message: string } | { kind: "stopped"; text: string };

/** One call to the model. */
async function ask(messages: Message[], opts: TurnOptions): Promise<Asked> {
  let text = "";
  try {
    const res = await (opts.fetch ?? fetch)(opts.endpoint ?? "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => undefined)) as { error?: { code: string; message: string } } | undefined;
      return { kind: "failed", code: err?.error?.code ?? `http-${res.status}`, message: err?.error?.message ?? "netties couldn't reach the model." };
    }
    let content: Block[] | undefined;
    for await (const line of lines(res.body)) {
      const ev = JSON.parse(line) as { type: "text"; text: string } | { type: "thinking"; text: string } | { type: "done"; content: Block[] } | { type: "error"; code: string; message: string };
      if (ev.type === "thinking") opts.onMessage?.({ kind: "thinking", text: ev.text });
      else if (ev.type === "text") {
        text += ev.text;
        opts.onMessage?.({ kind: "writing", text: ev.text });
      } else if (ev.type === "done") content = ev.content;
      else return { kind: "failed", code: ev.code, message: ev.message };
    }
    if (opts.signal?.aborted) return { kind: "stopped", text };
    return content ? { kind: "reply", text, content } : { kind: "failed", code: "failed", message: "The reply stopped part way." };
  } catch (e) {
    if (opts.signal?.aborted) return { kind: "stopped", text };
    console.error("chat failed", e);
    return { kind: "failed", code: "failed", message: "netties couldn't reach the model. Check your connection and try again." };
  }
}

const summarise = (c: { types: number; rules: number; interactions?: number }) => {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const run = c.interactions === undefined ? "" : `; runs to the end in ${n(c.interactions, "interaction")}`;
  return `${n(c.types, "agent type")}, ${n(c.rules, "rule")}${run}`;
};

/** The feedback that asks for a fix, and the one that leaves it up to the model. */
const fixIt = (feedback: string) => `netties says: ${feedback}\n\nReply with the whole corrected document.`;
const orSaySo = (feedback: string) => `netties says: ${feedback}\n\nIf that isn't what the visitor wants, reply with the whole corrected document. If it is, say so and send no document.`;

/**
 * A turn from what the visitor typed to its end. The conversation that comes
 * back is always ready for the next message, however this one ended: it has
 * the reply or a note saying what became of it, since a model's turns have to alternate.
 */
export async function runTurn(c: Conversation, request: string, doc: string, opts: TurnOptions = {}): Promise<{ end: TurnEnd; conversation: Conversation }> {
  const messages: Message[] = [...c.messages, { role: "user", content: userMessage(request, doc, c) }];
  const close = (note: string): Message => ({ role: "assistant", content: [{ type: "text", text: note }] });
  /** Unless a document is accepted, the model and the canvas no longer agree. */
  const over = (end: TurnEnd, unsaid?: string) => ({ end, conversation: { messages, unsaid, seen: end.kind === "said" ? c.seen : undefined } });
  /** A document with something to say about it, kept in case nothing better comes. */
  let kept: { code: string; summary: string; note: string } | undefined;
  let lastProblem = "";
  let lastCode: string | undefined;

  for (let attempt = 1; attempt <= TRIES; attempt++) {
    opts.onMessage?.({ kind: "try" });
    const asked = await ask(messages, opts);
    if (asked.kind === "failed") {
      messages.push(close(`(That reply didn't arrive: ${asked.message})`));
      return over({ kind: "failed", code: asked.code, message: asked.message });
    }
    if (asked.kind === "stopped") {
      messages.push(close(asked.text.trim() ? `${asked.text}\n\n(The visitor stopped this reply before it finished.)` : "(The visitor stopped this reply before it finished.)"));
      return over({ kind: "stopped" });
    }
    messages.push({ role: "assistant", content: asked.content });

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
    opts.onMessage?.({ kind: "checked", code, problem: check.feedback });
    lastProblem = check.feedback;
    if (check.kind === "concern") kept = { code, summary: summarise(check), note: check.feedback };
    if (attempt < TRIES) messages.push({ role: "user", content: check.kind === "concern" ? orSaySo(check.feedback) : fixIt(check.feedback) });
  }
  // The model never got to hear about its last try.
  if (kept) return over({ kind: "ready", ...kept }, lastProblem);
  return over({ kind: "gave-up", feedback: lastProblem, code: lastCode }, lastProblem);
}
