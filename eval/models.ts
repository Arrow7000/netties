import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM } from "../src/create/prompt";

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
  /** Let go of whatever the conversation is holding on to. */
  close?(): void;
}

export interface Model {
  id: string;
  /** `maxTokens` caps each reply. */
  start(maxTokens?: number): Chat;
}

const MAX_TOKENS = 32_000;
/** To try out a change to the system prompt, without touching what visitors get. */
const SYSTEM_PROMPT = SYSTEM + (process.env.EVAL_SYSTEM_EXTRA ? `\n\n${process.env.EVAL_SYSTEM_EXTRA}` : "");

/** Claude, through the Anthropic API. Prices are per million tokens. */
function claude(model: string, price: { in: number; out: number }): Model {
  return {
    id: model,
    start(maxTokens = MAX_TOKENS) {
      const client = new Anthropic();
      const messages: Anthropic.MessageParam[] = [];
      return {
        async send(user) {
          messages.push({ role: "user", content: user });
          const t0 = performance.now();
          const res = await client.messages
            .stream({
              model,
              max_tokens: maxTokens,
              system: SYSTEM_PROMPT,
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

/**
 * Claude through `claude -p`, on the Claude subscription it's logged in to
 * rather than API credits. Safe mode in an empty folder, so no skills, plugins,
 * MCP servers or CLAUDE.md get in; Claude Code still adds a short note about
 * the environment, so this is close to the API path but not the same. Costs
 * nothing per call, so `cost` stays 0 and only tokens are counted.
 */
function claudeCli(model: string): Model {
  return {
    id: `cli/${model}`,
    start(maxTokens = MAX_TOKENS) {
      // Without this, the key run.ts loaded from .env would bill API credits, and a parent Claude Code's settings would leak in.
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("ANTHROPIC_") || k.startsWith("CLAUDE")) delete env[k];
      env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxTokens);
      const child = spawn(
        "claude",
        ["-p", "--safe-mode", "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "", "--tools", "", "--no-session-persistence", "--model", model, "--effort", process.env.EVAL_EFFORT ?? "medium", "--system-prompt", SYSTEM_PROMPT, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
        { cwd: mkdtempSync(join(tmpdir(), "inet-eval-")), env, stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.stdin.on("error", () => {});
      let waiting: { resolve: (t: Turn) => void; reject: (e: Error) => void; t0: number } | undefined;
      let broken: Error | undefined;
      const fail = (e: Error) => {
        broken ??= e;
        waiting?.reject(broken);
        waiting = undefined;
      };
      child.on("error", fail);
      child.on("close", (code) => fail(new Error(`claude exited with ${code}: ${stderr.slice(0, 300)}`)));
      createInterface({ input: child.stdout }).on("line", (line) => {
        const e = JSON.parse(line) as {
          type: string;
          subtype?: string;
          apiKeySource?: string;
          model?: string;
          is_error?: boolean;
          result?: string;
          stop_reason?: string;
          usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
        };
        if (e.type === "system" && e.subtype === "init") {
          if (e.apiKeySource !== "none") {
            fail(new Error(`refusing to run: this would use ${e.apiKeySource}, not the subscription`));
            child.kill();
          } else if (e.model !== model) {
            fail(new Error(`refusing to run: asked for ${model}, got ${e.model}`));
            child.kill();
          }
        } else if (e.type === "result" && waiting) {
          const w = waiting;
          waiting = undefined;
          if (e.is_error) return w.reject(new Error(e.result || e.subtype || "claude reported an error"));
          const u = e.usage!;
          w.resolve({
            text: e.result ?? "",
            inTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
            outTokens: u.output_tokens,
            cost: 0,
            ms: performance.now() - w.t0,
            stop: e.stop_reason ?? "?",
          });
        }
      });
      return {
        send: (user) =>
          new Promise<Turn>((resolve, reject) => {
            if (broken) return reject(broken);
            waiting = { resolve, reject, t0: performance.now() };
            child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: user } }) + "\n");
          }),
        close() {
          child.stdin.end();
          child.kill();
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
    start(maxTokens = MAX_TOKENS) {
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: SYSTEM_PROMPT }];
      return {
        async send(user) {
          messages.push({ role: "user", content: user });
          const t0 = performance.now();
          const res = await withRetries(async () => {
            const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
              // By default OpenRouter favours cheap providers, which can be 10× slower: what looks like a slow model often isn't.
              body: JSON.stringify({ model, messages, max_tokens: maxTokens, reasoning: { effort: process.env.EVAL_EFFORT ?? "medium" }, provider: { sort: "throughput" }, usage: { include: true } }),
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
  claude("claude-sonnet-5-5", { in: 2, out: 10 }),
  claude("claude-opus-5-5", { in: 4, out: 20 }),
  claudeCli("claude-haiku-5-5"),
  claudeCli("claude-sonnet-5-5"),
  claudeCli("claude-opus-5-5"),
  claudeCli("claude-fable-5-1"),
  openRouter("xiaomi/mimo-v2.6-flash"),
  openRouter("deepseek/deepseek-v4.1-flash"),
  openRouter("xiaomi/mimo-v2.6-pro"),
  openRouter("z-ai/glm-5.3-flash"),
  openRouter("qwen/qwen3.8-flash"),
  openRouter("moonshotai/kimi-k2.6"),
  // Small and cheap models refreshed 2026-11-04, none over about $2 per million output tokens.
  openRouter("inclusionai/ling-3.1-flash"),
  openRouter("deepseek/deepseek-v4.1-flash-1017"),
  openRouter("minimax/minimax-m3.1-flash"),
  openRouter("particle-ai/particle-1"),
  openRouter("reflection/beam-1.0-501b-a23b"),
  openRouter("nvidia/nemotron-3.5-super-vl"),
  openRouter("qwen/qwen3.8-27b"),
  openRouter("inception/mercury-3"),
  openRouter("qwen/qwen3.7-flash"),
  openRouter("nex-agi/nex-n2.5-pro"),
];
