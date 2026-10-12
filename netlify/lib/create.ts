/**
 * The "create it for me" proxy: takes a conversation from the browser, adds
 * the system prompt, asks Haiku, and streams the reply back, within a
 * per-visitor limit and a daily budget shared by everyone.
 *
 * The browser keeps the conversation and sends it back whole on each retry,
 * with Haiku's earlier replies exactly as they came (thinking blocks must
 * come back unchanged). Everything here is plain web APIs, so it runs in
 * Netlify's edge runtime and under vitest alike.
 */
import type Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-haiku-5-5";
/** Dollars per million tokens, in and out. */
const PRICE = { in: 0.1, out: 0.5 };
export const MAX_TOKENS = 16_000;

export const LIMITS = {
  /** Model calls per visitor per hour: ten creates of up to three tries each. */
  callsPerHour: 30,
  /** Spend for everyone per UTC day, in millionths of a dollar. */
  dailyMicros: 1_000_000,
  /** User turns in one conversation: the request and two rounds of feedback. */
  turns: 3,
  /** Characters in the visitor's request, and in a round of feedback. */
  requestChars: 2_000,
  feedbackChars: 12_000,
  /** The whole conversation, as JSON. Thinking blocks come back signed, at 20 KB or more each. */
  bodyBytes: 1_000_000,
};

/** Counters that survive between requests. Not atomic; the caps are approximate. */
export interface Counters {
  get(key: string): Promise<number>;
  set(key: string, value: number): Promise<void>;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/** One reply from the model, streamed: text as it comes, then the whole message. */
export interface ModelCall {
  text: AsyncIterable<string>;
  final: Promise<{ content: Anthropic.ContentBlock[]; stop: string | null; usage: Usage }>;
}

export interface Deps {
  callModel(messages: Anthropic.MessageParam[]): ModelCall;
  counters: Counters;
  /** Who's asking, for the per-visitor limit. Hashed before it's stored. */
  visitor: string;
  now: Date;
}

/** Events in the streamed response, one JSON object per line. */
export type CreateEvent =
  | { type: "text"; text: string }
  | { type: "done"; content: Anthropic.ContentBlock[] }
  | { type: "error"; code: "refused" | "cut-off" | "failed"; message: string };

const json = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "content-type": "application/json" } });

export async function handleCreate(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, "method", "Use POST.");
  const raw = await req.text();
  if (raw.length > LIMITS.bodyBytes) return json(413, "too-big", "That conversation is too long.");
  let messages: Anthropic.MessageParam[];
  try {
    messages = (JSON.parse(raw) as { messages: Anthropic.MessageParam[] }).messages;
  } catch {
    return json(400, "bad-request", "The request isn't valid JSON.");
  }
  const problem = checkConversation(messages);
  if (problem) return json(400, "bad-request", problem);

  const day = deps.now.toISOString().slice(0, 10);
  const hour = deps.now.toISOString().slice(0, 13);
  const spendKey = `spend/${day}`;
  if ((await deps.counters.get(spendKey)) >= LIMITS.dailyMicros)
    return json(503, "budget", "netties has used up today's budget for creating. Try again tomorrow.");
  const visitorKey = `visitor/${await sha256(deps.visitor)}/${hour}`;
  const calls = await deps.counters.get(visitorKey);
  if (calls >= LIMITS.callsPerHour) return json(429, "rate", "That's as many as you can create for now. Try again in an hour.");
  // Counted before the call, so requests sent all at once still count.
  await deps.counters.set(visitorKey, calls + 1);

  const call = deps.callModel(messages);
  // If the text fails first, nothing else awaits this.
  call.final.catch(() => {});
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: CreateEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          // The visitor went away; finish the call anyway so its cost is counted.
          open = false;
        }
      };
      try {
        for await (const t of call.text) send({ type: "text", text: t });
        const { content, stop, usage } = await call.final;
        const micros = Math.ceil(usage.input_tokens * PRICE.in + usage.output_tokens * PRICE.out);
        await deps.counters.set(spendKey, (await deps.counters.get(spendKey)) + micros);
        if (stop === "refusal") send({ type: "error", code: "refused", message: "The model declined that request." });
        else if (stop === "max_tokens") send({ type: "error", code: "cut-off", message: "The reply was too long and got cut off." });
        else send({ type: "done", content });
      } catch (e) {
        console.error("create failed", e);
        send({ type: "error", code: "failed", message: "Something went wrong asking the model. Try again in a moment." });
      }
      if (open) controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

/** A conversation the proxy will pass on: user and assistant taking turns, user first and last, within the limits. */
export function checkConversation(messages: unknown): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return "There's no conversation.";
  if (messages.length % 2 === 0) return "The conversation has to end with your turn.";
  if (messages.length > 2 * LIMITS.turns - 1) return `A create gets at most ${LIMITS.turns} tries.`;
  for (const [i, m] of messages.entries()) {
    const role = i % 2 === 0 ? "user" : "assistant";
    if (!m || typeof m !== "object" || (m as { role?: unknown }).role !== role) return `Message ${i + 1} should be from the ${role}.`;
    const content = (m as { content?: unknown }).content;
    if (role === "user") {
      if (typeof content !== "string" || !content.trim()) return `Message ${i + 1} should be text.`;
      const max = i === 0 ? LIMITS.requestChars : LIMITS.feedbackChars;
      if (content.length > max) return i === 0 ? `Describe it in at most ${max} characters.` : "That feedback is too long.";
    } else if (!Array.isArray(content) || content.some((b) => !b || !["text", "thinking", "redacted_thinking"].includes((b as { type?: string }).type ?? ""))) {
      return `Message ${i + 1} should be a reply from the model, as it was sent.`;
    }
  }
  return undefined;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
