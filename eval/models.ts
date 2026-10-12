import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM } from "./prompt";

/** One reply, with what it cost. */
export interface Turn {
  text: string;
  inTokens: number;
  outTokens: number;
  /** In dollars. */
  cost: number;
  ms: number;
  /** Why the model stopped, as the provider says it. */
  stop: string;
}

/** A conversation that keeps its own history. */
export interface Chat {
  send(user: string): Promise<Turn>;
}

export interface Model {
  id: string;
  start(): Chat;
}

const MAX_TOKENS = 32_000;

/** Claude, through the Anthropic API. Prices are per million tokens. */
function claude(model: string, price: { in: number; out: number }): Model {
  return {
    id: model,
    start() {
      const client = new Anthropic();
      const messages: Anthropic.MessageParam[] = [];
      return {
        async send(user) {
          messages.push({ role: "user", content: user });
          const t0 = performance.now();
          const res = await client.messages
            .stream({
              model,
              max_tokens: MAX_TOKENS,
              system: SYSTEM,
              thinking: { type: "adaptive" },
              output_config: { effort: "medium" },
              messages,
            })
            .finalMessage();
          const ms = performance.now() - t0;
          // Thinking blocks go back unchanged, so the history stays append-only.
          messages.push({ role: "assistant", content: res.content });
          const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
          const u = res.usage;
          const inTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          return { text, inTokens, outTokens: u.output_tokens, cost: (inTokens * price.in + u.output_tokens * price.out) / 1e6, ms, stop: res.stop_reason ?? "?" };
        },
      };
    },
  };
}

interface OpenRouterResponse {
  choices?: { message: { content: string | null }; finish_reason: string | null }[];
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
  error?: { message: string; code?: number };
}

/** Any model on OpenRouter. OpenRouter reports the real cost of each call. */
function openRouter(model: string): Model {
  return {
    id: model,
    start() {
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: SYSTEM }];
      return {
        async send(user) {
          messages.push({ role: "user", content: user });
          const t0 = performance.now();
          const res = await withRetries(async () => {
            const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS, reasoning: { effort: "medium" }, usage: { include: true } }),
              signal: AbortSignal.timeout(15 * 60_000),
            });
            const body = (await r.json()) as OpenRouterResponse;
            if (!r.ok || body.error || !body.choices?.length) {
              const err = new Error(`OpenRouter ${r.status}: ${body.error?.message ?? "no choices"}`);
              (err as Error & { retry: boolean }).retry = r.status === 429 || r.status >= 500 || !body.choices?.length;
              throw err;
            }
            return body;
          });
          const ms = performance.now() - t0;
          const choice = res.choices![0]!;
          const text = choice.message.content ?? "";
          messages.push({ role: "assistant", content: text });
          const u = res.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
          return { text, inTokens: u.prompt_tokens, outTokens: u.completion_tokens, cost: u.cost ?? 0, ms, stop: choice.finish_reason ?? "?" };
        },
      };
    },
  };
}

async function withRetries<T>(f: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      const retry = (e as { retry?: boolean }).retry ?? (e instanceof TypeError || (e as Error).name === "TimeoutError");
      if (!retry || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

export const MODELS: Model[] = [
  claude("claude-haiku-5-5", { in: 0.1, out: 0.5 }),
  openRouter("xiaomi/mimo-v2.6-flash"),
  openRouter("deepseek/deepseek-v4.1-flash"),
  openRouter("xiaomi/mimo-v2.6-pro"),
];
