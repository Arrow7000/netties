import type Anthropic from "@anthropic-ai/sdk";
import type { ModelCall } from "../netlify/lib/create";

const URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * What a stopped reply is charged, per character streamed, in millionths of a
 * dollar: about four characters to a token at $1 per million tokens. OpenRouter
 * only reports the real cost at the end of a reply, and this errs on the high
 * side for the small models we use, so the daily budget stays honest.
 */
const STOPPED_MICROS_PER_CHAR = 0.25;

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  system: string;
  maxTokens: number;
  messages: Anthropic.MessageParam[];
  /** For a small job, where thinking would only cost time and money. */
  noThinking?: boolean;
  fetch?: typeof fetch;
}

interface Chunk {
  choices?: { delta?: { content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
  error?: { message: string };
}

/** A reply from any model on OpenRouter, with what it cost, for the scripts that have to watch what they spend. The app doesn't use this. */
export function callOpenRouter(o: OpenRouterOptions): ModelCall {
  const ctrl = new AbortController();
  let resolve!: (v: Awaited<ModelCall["final"]>) => void;
  let reject!: (e: unknown) => void;
  const final = new Promise<Awaited<ModelCall["final"]>>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  async function* text(): AsyncGenerator<string | { thinking: string }> {
    let reply = "";
    let chars = 0;
    let stop: string | null = null;
    let usage: Chunk["usage"];
    const finish = (stopReason: string | null, micros: number) =>
      resolve({
        content: [{ type: "text", text: reply, citations: null }] as Anthropic.ContentBlock[],
        stop: stopReason,
        usage: { input_tokens: usage?.prompt_tokens ?? 0, output_tokens: usage?.completion_tokens ?? 0 },
        micros,
      });
    try {
      const res = await (o.fetch ?? fetch)(URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
        // By default OpenRouter favours cheap providers, which can be 10× slower.
        body: JSON.stringify({
          model: o.model,
          stream: true,
          messages: [{ role: "system", content: o.system }, ...o.messages.map(plain)],
          max_tokens: o.maxTokens,
          reasoning: o.noThinking ? { enabled: false } : { effort: "medium" },
          provider: { sort: "throughput" },
          usage: { include: true },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
      for await (const data of events(res.body)) {
        if (data === "[DONE]") break;
        const c = JSON.parse(data) as Chunk;
        if (c.error) throw new Error(`OpenRouter: ${c.error.message}`);
        const choice = c.choices?.[0];
        const thinking = choice?.delta?.reasoning;
        if (thinking) {
          chars += thinking.length;
          yield { thinking };
        }
        const content = choice?.delta?.content;
        if (content) {
          chars += content.length;
          reply += content;
          yield content;
        }
        if (choice?.finish_reason) stop = choice.finish_reason;
        if (c.usage) usage = c.usage;
      }
      if (stop === null) throw new Error("OpenRouter: the reply stopped part way");
      if (stop === "error") throw new Error("OpenRouter: the model reported an error");
      finish(stop === "length" ? "max_tokens" : stop === "content_filter" ? "refusal" : stop, usage?.cost !== undefined ? Math.ceil(usage.cost * 1e6) : Math.ceil(chars * STOPPED_MICROS_PER_CHAR));
    } catch (e) {
      if (ctrl.signal.aborted) return finish("aborted", Math.ceil(chars * STOPPED_MICROS_PER_CHAR));
      reject(e);
      throw e;
    }
  }

  return { text: text(), final, abort: () => ctrl.abort() };
}

/** A message as OpenRouter wants it: the proxy's replies are lists of blocks. */
function plain(m: Anthropic.MessageParam): { role: string; content: string } {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  return { role: m.role, content: m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("") };
}

/** The data lines of a server-sent event stream. OpenRouter's keep-alive comments start with a colon, and are dropped. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
