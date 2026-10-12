import { type Checked, checkReply, extractCode } from "./check";

/**
 * "Create it for me", in the browser: send what the visitor described to
 * /api/create, check the document that comes back with the engine, and
 * feed any problem back to the model, up to three tries in all.
 */

export const TRIES = 3;

/** What we tell the model when its document doesn't check out. */
export const feedbackMessage = (feedback: string) => `netties says: ${feedback}\n\nReply with the whole corrected document.`;

/** A content block of the model's reply, kept exactly as it came so it can be sent back. */
type Block = { type: string; text?: string };
type Message = { role: "user"; content: string } | { role: "assistant"; content: Block[] };

export type Progress =
  | { kind: "writing"; attempt: number; text: string }
  | { kind: "checking"; attempt: number }
  | { kind: "retrying"; attempt: number; feedback: string };

export type CreateResult =
  /** A document that parses, type-checks and runs to the end without getting stuck. */
  | { ok: true; code: string; attempts: number }
  /** Every try had a problem; `code` is the last document, if there was one. */
  | { ok: false; reason: "checks"; feedback: string; code?: string; attempts: number }
  /** The proxy said no (budget, rate limit, refusal, ...). */
  | { ok: false; reason: "proxy"; code: string; message: string; attempts: number };

export interface CreateOptions {
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  endpoint?: string;
  fetch?: typeof fetch;
}

export async function create(request: string, opts: CreateOptions = {}): Promise<CreateResult> {
  const doFetch = opts.fetch ?? fetch;
  const messages: Message[] = [{ role: "user", content: request }];
  let last: Checked | undefined;
  let lastCode: string | undefined;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const res = await doFetch(opts.endpoint ?? "/api/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const err = (await res.json().catch(() => undefined)) as { error?: { code: string; message: string } } | undefined;
      return { ok: false, reason: "proxy", code: err?.error?.code ?? `http-${res.status}`, message: err?.error?.message ?? "netties couldn't reach the model.", attempts: attempt };
    }

    let text = "";
    let content: Block[] | undefined;
    for await (const e of lines(res.body)) {
      const ev = JSON.parse(e) as { type: "text"; text: string } | { type: "done"; content: Block[] } | { type: "error"; code: string; message: string };
      if (ev.type === "text") {
        text += ev.text;
        opts.onProgress?.({ kind: "writing", attempt, text });
      } else if (ev.type === "done") content = ev.content;
      else return { ok: false, reason: "proxy", code: ev.code, message: ev.message, attempts: attempt };
    }
    if (!content) return { ok: false, reason: "proxy", code: "failed", message: "The reply stopped part way.", attempts: attempt };

    opts.onProgress?.({ kind: "checking", attempt });
    const reply = content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
    last = checkReply(reply);
    if (last.ok) return { ok: true, code: last.code, attempts: attempt };
    lastCode = extractCode(reply) ?? lastCode;
    if (attempt < TRIES) opts.onProgress?.({ kind: "retrying", attempt, feedback: last.feedback });
    messages.push({ role: "assistant", content }, { role: "user", content: feedbackMessage(last.feedback) });
  }
  return { ok: false, reason: "checks", feedback: last && !last.ok ? last.feedback : "", code: lastCode, attempts: TRIES };
}

/** The lines of a streamed body. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}
