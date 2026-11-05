/**
 * Talking to a model straight from the browser, with the visitor's own key. Nearly
 * every provider speaks OpenAI's Chat Completions, so that's the one way in, along
 * with Anthropic's own Messages API: its OpenAI-style endpoint ignores reasoning
 * levels and never returns the thinking.
 *
 * Providers differ in the details, so a reply reads each of the places reasoning
 * turns up, and a request that's refused for a setting goes again without it.
 */

/** How a provider's API is shaped. */
export type Wire = "openai" | "anthropic";

/** How hard to think. "default" sends nothing, leaving it to the model. */
export type Effort = "default" | "off" | "low" | "medium" | "high";
export const EFFORTS: { id: Effort; name: string }[] = [
  { id: "default", name: "Default" },
  { id: "off", name: "Off" },
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
];

export interface Preset {
  id: string;
  name: string;
  /** Empty for a provider whose address the visitor gives. */
  url: string;
  wire: Wire;
  /** Runs on the visitor's own machine, so there's usually no key and the address can change. */
  local?: boolean;
  /** Whether it can't work without a key. */
  needsKey?: boolean;
  /** Where to get a key. */
  keysAt?: string;
  /** Provider-specific additions to a request. */
  extra?: Record<string, unknown>;
  /** A limit on a reply's length, for a provider whose own default is too short for a model's thinking. */
  maxTokens?: number;
}

export const CUSTOM = "custom";

/** The cloud ones take requests from a browser, as checked 2026-11-05; see TODO.md for how far. A local one has to be told to let the site in. */
export const PRESETS: Preset[] = [
  // By default OpenRouter favours cheap hosts, which can be 10× slower.
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1", wire: "openai", needsKey: true, keysAt: "https://openrouter.ai/keys", extra: { provider: { sort: "throughput" } } },
  { id: "anthropic", name: "Anthropic", url: "https://api.anthropic.com/v1", wire: "anthropic", needsKey: true, keysAt: "https://platform.claude.com/settings/keys", maxTokens: 64_000 },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1", wire: "openai", needsKey: true, keysAt: "https://platform.openai.com/api-keys" },
  { id: "google", name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", wire: "openai", needsKey: true, keysAt: "https://aistudio.google.com/apikey" },
  { id: "deepseek", name: "DeepSeek", url: "https://api.deepseek.com", wire: "openai", needsKey: true, keysAt: "https://platform.deepseek.com/api_keys", maxTokens: 64_000 },
  { id: "xai", name: "xAI", url: "https://api.x.ai/v1", wire: "openai", needsKey: true, keysAt: "https://console.x.ai" },
  { id: "groq", name: "Groq", url: "https://api.groq.com/openai/v1", wire: "openai", needsKey: true, keysAt: "https://console.groq.com/keys" },
  { id: "mistral", name: "Mistral", url: "https://api.mistral.ai/v1", wire: "openai", needsKey: true, keysAt: "https://console.mistral.ai/api-keys" },
  { id: "together", name: "Together", url: "https://api.together.xyz/v1", wire: "openai", needsKey: true, keysAt: "https://api.together.ai/settings/api-keys" },
  { id: "fireworks", name: "Fireworks", url: "https://api.fireworks.ai/inference/v1", wire: "openai", needsKey: true, keysAt: "https://fireworks.ai/account/api-keys" },
  { id: "cerebras", name: "Cerebras", url: "https://api.cerebras.ai/v1", wire: "openai", needsKey: true, keysAt: "https://cloud.cerebras.ai" },
  { id: "moonshot", name: "Moonshot (Kimi)", url: "https://api.moonshot.ai/v1", wire: "openai", needsKey: true, keysAt: "https://platform.moonshot.ai/console/api-keys" },
  { id: "zai", name: "Z.ai (GLM)", url: "https://api.z.ai/api/paas/v4", wire: "openai", needsKey: true, keysAt: "https://z.ai/manage-apikey/apikey-list" },
  { id: "qwen", name: "Alibaba (Qwen)", url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", wire: "openai", needsKey: true, keysAt: "https://modelstudio.console.alibabacloud.com" },
  { id: "ollama", name: "Ollama (on this computer)", url: "http://localhost:11434/v1", wire: "openai", local: true },
  { id: "lmstudio", name: "LM Studio (on this computer)", url: "http://localhost:1234/v1", wire: "openai", local: true },
];

export const presetOf = (id: string) => PRESETS.find((p) => p.id === id);

/** Everything a request needs to reach a provider. */
export interface Connection {
  name: string;
  url: string;
  wire: Wire;
  key?: string;
  extra?: Record<string, unknown>;
  maxTokens?: number;
}

/** The address of an API, from however it was pasted in: with or without its scheme, its version, or the endpoint itself. */
export function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `${isLocalAddress(`http://${s}`) ? "http" : "https"}://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  const path = u.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|messages|models)$/, "");
  return `${u.origin}${path || "/v1"}`;
}

/** Whether an address is on this computer or this network, where a browser asks permission and CORS is up to the visitor's own server. */
export function isLocalAddress(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return /^(localhost|\[::1\]|0\.0\.0\.0)$|\.localhost$|\.local$|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** How to let this site in, for the local servers that keep it out until told otherwise. */
export function localSetup(id: string, origin: string): string | undefined {
  if (id === "ollama") return `Ollama only lets in sites it's told about. Quit Ollama and run:\n\nOLLAMA_ORIGINS=${origin} ollama serve\n\nOr, to keep using the Ollama app on a Mac, run this and restart it:\n\nlaunchctl setenv OLLAMA_ORIGINS ${origin}`;
  if (id === "lmstudio") return "In LM Studio, turn on Developer → Server Settings → Enable CORS, or run:\n\nlms server start --cors";
  return undefined;
}

export type FailCode = "key" | "rate" | "model" | "refused" | "cut-off" | "dropped" | "unreachable" | "blocked" | "failed";

/** A request that didn't get a reply, or a reply that didn't finish. */
export class ModelError extends Error {
  constructor(
    readonly code: FailCode,
    message: string,
  ) {
    super(message);
  }
}

/** What a model sent, as it comes. A note is something the visitor should know about how the request was taken. */
export type ReplyEvent = { kind: "text"; text: string } | { kind: "thinking"; text: string } | { kind: "note"; text: string };

export interface Ask {
  connection: Connection;
  model: string;
  effort: Effort;
  system: string;
  messages: PlainMessage[];
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Who to tell how to let this site in, if it's a local server keeping it out. */
  setup?: string;
}

export interface PlainMessage {
  role: "user" | "assistant";
  content: string;
}

/** The settings that a model might refuse, one at a time, and what the visitor is told if it does. */
interface Optional {
  field: string;
  mentions: RegExp;
  note?: string;
}

const NO_LEVEL = "This model doesn't take a reasoning level, so it's using its own.";

function request(a: Ask): { url: string; headers: Record<string, string>; body: Record<string, unknown>; optional: Optional[] } {
  const c = a.connection;
  if (c.wire === "anthropic") {
    const body: Record<string, unknown> = { model: a.model, stream: true, max_tokens: c.maxTokens ?? 64_000, system: a.system, messages: a.messages, cache_control: { type: "ephemeral" }, thinking: { type: "adaptive", display: "summarized" }, ...c.extra };
    // Newer models always think, and refuse to be told not to, so "off" is as little as they'll do.
    if (a.effort === "off") delete body.thinking;
    if (a.effort !== "default") body.output_config = { effort: a.effort === "off" ? "low" : a.effort };
    return {
      url: `${c.url}/messages`,
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", ...(c.key ? { "x-api-key": c.key } : {}) },
      body,
      optional: [
        { field: "output_config", mentions: /output_config|effort/i, note: NO_LEVEL },
        { field: "thinking", mentions: /thinking/i },
        { field: "cache_control", mentions: /cache_control/i },
      ],
    };
  }
  const body: Record<string, unknown> = { model: a.model, stream: true, messages: [{ role: "system", content: a.system }, ...a.messages], ...c.extra };
  if (a.effort !== "default") body.reasoning_effort = a.effort === "off" ? "none" : a.effort;
  if (c.maxTokens) body.max_tokens = c.maxTokens;
  return {
    url: `${c.url}/chat/completions`,
    headers: { "content-type": "application/json", ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) },
    body,
    optional: [
      { field: "reasoning_effort", mentions: /reasoning|effort|thinking/i, note: NO_LEVEL },
      { field: "max_tokens", mentions: /max_tokens|max_completion_tokens/i },
    ],
  };
}

/** What a provider said went wrong, wherever it put it. */
function saidIn(raw: string): string {
  try {
    const j = JSON.parse(raw) as unknown;
    const o = (Array.isArray(j) ? j[0] : j) as { error?: string | { message?: string }; message?: string; detail?: string };
    const said = typeof o.error === "string" ? o.error : (o.error?.message ?? o.message ?? o.detail);
    if (typeof said === "string") return said.slice(0, 400);
  } catch {
    // Not JSON: it's said in plain text, if at all.
  }
  return raw.trim().slice(0, 200);
}

function refusedBy(c: Connection, model: string, status: number, raw: string): ModelError {
  const said = saidIn(raw);
  const also = said ? `: ${said}` : ".";
  if (status === 401 || status === 403) return new ModelError("key", `${c.name} didn't accept the API key${also}`);
  if (status === 402 || status === 429) return new ModelError("rate", `${c.name} is holding back: it may be out of credit or at its rate limit${also}`);
  if (status === 404) return new ModelError("model", `${c.name} couldn't find the model ${model}${also}`);
  return new ModelError("failed", `${c.name} said no (${status})${also}`);
}

/**
 * Why a request never got an answer. A browser only says "Failed to fetch"
 * whether it was refused permission, nothing's running or CORS kept it out, so
 * this asks around. Cloud providers can also hide a wrong key this way, by leaving CORS headers off their errors.
 */
async function whyUnreachable(a: Ask, doFetch: typeof fetch): Promise<ModelError> {
  const c = a.connection;
  if (!isLocalAddress(c.url)) {
    const list = await doFetch(`${c.url}/models`, { headers: listHeaders(c), signal: a.signal }).catch(() => undefined);
    if (list?.status === 401 || list?.status === 403) return refusedBy(c, a.model, list.status, await list.text().catch(() => ""));
    return new ModelError("unreachable", `Couldn't reach ${c.name}. Check your connection, and that the API key and address are right.`);
  }
  const permission = await navigator.permissions?.query({ name: "local-network-access" as PermissionName }).then((p) => p.state, () => undefined);
  if (permission === "denied") return new ModelError("blocked", `This browser isn't letting netties reach ${c.url}. Allow local network access for this site in its site settings, then try again.`);
  const up = await doFetch(`${c.url}/models`, { mode: "no-cors", signal: a.signal }).then(() => true, () => false);
  if (!up) return new ModelError("unreachable", `Nothing's answering at ${c.url}. Check that ${c.name} is running. A phone can't reach a server on your computer as localhost.`);
  return new ModelError("blocked", `${c.name} is running, but isn't letting this site in.${a.setup ? `\n\n${a.setup}` : " Allow this site's origin in its CORS settings."}`);
}

/** The lines of data in a stream of server-sent events. Keep-alive comments and event names are left out, since the data says what it is. */
async function* dataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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

/** How a reply stands after a piece of the stream. */
type Piece = { events: ReplyEvent[]; finished?: "done" | "cut-off" | "refused" };

/**
 * Local models often write their thinking into the reply between <think> tags.
 * This takes it back out, even with a tag split across two pieces.
 */
export function thinkSplitter() {
  type State = "start" | "thinking" | "writing";
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let state: State = "start";
  let held = "";
  /** How much of the end of this might be the start of the tag. */
  const partial = (s: string, tag: string) => {
    for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n;
    return 0;
  };
  return {
    push(text: string): ReplyEvent[] {
      const out: ReplyEvent[] = [];
      held += text;
      for (;;) {
        switch (state) {
          case "start": {
            const s = held.trimStart();
            if (!s) return out;
            if (s.startsWith(OPEN)) {
              held = s.slice(OPEN.length);
              state = "thinking";
              continue;
            }
            if (OPEN.startsWith(s)) return out;
            state = "writing";
            continue;
          }
          case "thinking": {
            const end = held.indexOf(CLOSE);
            if (end >= 0) {
              if (end > 0) out.push({ kind: "thinking", text: held.slice(0, end) });
              held = held.slice(end + CLOSE.length).trimStart();
              state = "writing";
              continue;
            }
            const keep = partial(held, CLOSE);
            if (held.length > keep) out.push({ kind: "thinking", text: held.slice(0, held.length - keep) });
            held = held.slice(held.length - keep);
            return out;
          }
          case "writing":
            if (held) out.push({ kind: "text", text: held });
            held = "";
            return out;
        }
      }
    },
    /** Whatever was held back in case it was a tag. */
    flush(): ReplyEvent[] {
      const rest = held;
      held = "";
      return rest ? [{ kind: state === "thinking" ? "thinking" : "text", text: rest }] : [];
    },
  };
}

function openAiReader(c: Connection) {
  const tags = thinkSplitter();
  return {
    read(data: string): Piece {
      if (data === "[DONE]") return { events: tags.flush(), finished: "done" };
      const chunk = JSON.parse(data) as {
        error?: { message?: string } | string;
        choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
      };
      if (chunk.error) throw new ModelError("failed", `${c.name}: ${typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? "the model reported an error")}`);
      const choice = chunk.choices?.[0];
      const events: ReplyEvent[] = [];
      const thinking = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
      if (thinking) events.push({ kind: "thinking", text: thinking });
      if (choice?.delta?.content) events.push(...tags.push(choice.delta.content));
      const stop = choice?.finish_reason;
      if (!stop) return { events };
      events.push(...tags.flush());
      if (stop === "error") throw new ModelError("failed", `${c.name}: the model reported an error.`);
      return { events, finished: stop === "length" ? "cut-off" : stop === "content_filter" ? "refused" : "done" };
    },
  };
}

function anthropicReader(c: Connection) {
  let stop: string | undefined;
  return {
    read(data: string): Piece {
      const ev = JSON.parse(data) as { type: string; delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }; error?: { message?: string } };
      switch (ev.type) {
        case "content_block_delta":
          if (ev.delta?.type === "text_delta" && ev.delta.text) return { events: [{ kind: "text", text: ev.delta.text }] };
          if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) return { events: [{ kind: "thinking", text: ev.delta.thinking }] };
          return { events: [] };
        case "message_delta":
          stop = ev.delta?.stop_reason ?? stop;
          return { events: [] };
        case "message_stop":
          return { events: [], finished: stop === "max_tokens" ? "cut-off" : stop === "refusal" ? "refused" : "done" };
        case "error":
          throw new ModelError("failed", `${c.name}: ${ev.error?.message ?? "the model reported an error"}`);
        default:
          return { events: [] };
      }
    },
  };
}

/** Send the request, going again without any setting the model turns down. */
async function send(a: Ask, doFetch: typeof fetch, onNote: (text: string) => void): Promise<Response> {
  const { url, headers, body, optional } = request(a);
  for (;;) {
    let res: Response;
    try {
      res = await doFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: a.signal });
    } catch (e) {
      if (a.signal?.aborted) throw e;
      throw await whyUnreachable(a, doFetch);
    }
    if (res.ok && res.body) return res;
    const raw = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 422) {
      const refused = optional.find((o) => o.field in body && o.mentions.test(raw));
      if (refused) {
        delete body[refused.field];
        if (refused.note) onNote(refused.note);
        continue;
      }
    }
    throw refusedBy(a.connection, a.model, res.status, raw);
  }
}

/** A reply as it comes. It ends normally only when the reply is whole; anything else throws a ModelError, or the abort if it was stopped. */
export async function* streamReply(a: Ask): AsyncGenerator<ReplyEvent, void> {
  const notes: string[] = [];
  const res = await send(a, a.fetch ?? fetch, (t) => notes.push(t));
  for (const text of notes) yield { kind: "note", text };
  const reader = a.connection.wire === "anthropic" ? anthropicReader(a.connection) : openAiReader(a.connection);
  let finished: Piece["finished"];
  try {
    for await (const data of dataLines(res.body!)) {
      let piece: Piece;
      try {
        piece = reader.read(data);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
      yield* piece.events;
      if (piece.finished) {
        // The [DONE] after a reply that was cut off doesn't make it whole.
        finished ??= piece.finished;
        if (data === "[DONE]" || a.connection.wire === "anthropic") break;
      }
    }
  } catch (e) {
    if (e instanceof ModelError || a.signal?.aborted) throw e;
    throw new ModelError("dropped", `The connection to ${a.connection.name} dropped part way through the reply.`);
  }
  if (a.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (finished === "cut-off") throw new ModelError("cut-off", "The reply hit its length limit and got cut off.");
  if (finished === "refused") throw new ModelError("refused", "The model declined that request.");
  if (!finished) throw new ModelError("dropped", `The connection to ${a.connection.name} dropped part way through the reply.`);
}

export interface ModelInfo {
  id: string;
  name?: string;
}

const listHeaders = (c: Connection): Record<string, string> =>
  c.wire === "anthropic"
    ? { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", ...(c.key ? { "x-api-key": c.key } : {}) }
    : c.key
      ? { authorization: `Bearer ${c.key}` }
      : {};

/** Models that can't chat. A provider's list has them all together, and only some say which are which. */
const NOT_CHAT = /embed|whisper|tts|dall-e|image|moderation|rerank|transcri|audio|realtime|speech|sora|guard|-ocr|video/i;

/**
 * What a provider says the key can use, newest first. Providers don't say which
 * are popular, but this list is always current, with nothing to keep up to date.
 */
export async function listModels(c: Connection, opts: { signal?: AbortSignal; fetch?: typeof fetch; setup?: string } = {}): Promise<ModelInfo[]> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${c.url}/models${c.wire === "anthropic" ? "?limit=1000" : ""}`, { headers: listHeaders(c), signal: opts.signal });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw await whyUnreachable({ connection: c, model: "", effort: "default", system: "", messages: [], signal: opts.signal, setup: opts.setup }, doFetch);
  }
  if (!res.ok) throw refusedBy(c, "", res.status, await res.text().catch(() => ""));
  const j = (await res.json().catch(() => undefined)) as unknown;
  const box = j as { data?: unknown; models?: unknown } | null | undefined;
  // Ollama says `"data": null` when nothing's been downloaded.
  const raw = (Array.isArray(j) ? j : box && "data" in box && box.data === null ? [] : (box?.data ?? box?.models)) as { id?: string; name?: string; display_name?: string; created?: number; created_at?: string; type?: string }[] | undefined;
  if (!Array.isArray(raw)) throw new ModelError("failed", `${c.name} didn't send a list of models.`);
  const when = (m: (typeof raw)[number]) => m.created ?? (m.created_at ? Date.parse(m.created_at) / 1000 : 0);
  return raw
    .filter((m) => typeof m.id === "string" && !NOT_CHAT.test(m.id) && !NOT_CHAT.test(m.type ?? ""))
    .sort((a, b) => when(b) - when(a))
    .map((m) => ({ id: m.id!.replace(/^models\//, ""), name: m.display_name ?? m.name }));
}
