import type { Connect, Plugin } from "vite";
import { EXAMPLE } from "../../src/create/prompt.ts";
import { handleChat } from "./chat.ts";
import type { Deps, ModelCall } from "./create.ts";

/**
 * /api/chat under plain `npm run dev`, so the chat works without `netlify dev`.
 * Only the dev server uses this. CHAT_MODEL=fake answers from a script, for free.
 * Note that Netlify's 60 s limit on a response doesn't apply here.
 */
export function chatDev(env: Record<string, string | undefined>): Plugin {
  const counts = new Map<string, number>();
  const counters = {
    get: async (k: string) => counts.get(k) ?? 0,
    set: async (k: string, v: number) => void counts.set(k, v),
  };
  const serve: Connect.NextHandleFunction = async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(`http://localhost/api/chat${req.url === "/" ? "" : (req.url ?? "")}`, { method: req.method, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
    const reply = await handleChat(request, {
      model: env.CHAT_MODEL,
      apiKey: env.OPENROUTER_API_KEY,
      counters,
      visitor: "local",
      callModel: env.CHAT_MODEL === "fake" ? fakeModel : undefined,
      callTitle: env.CHAT_MODEL === "fake" ? fakeTitle : undefined,
    });
    res.statusCode = reply.status;
    reply.headers.forEach((v, k) => res.setHeader(k, v));
    if (!reply.body) return void res.end();
    const reader = reply.body.getReader();
    // The browser going away (Stop) cancels the stream, which stops the model.
    res.on("close", () => void reader.cancel().catch(() => {}));
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  };
  return {
    name: "netties-chat-dev",
    configureServer: (server) => void server.middlewares.use("/api/chat", serve),
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

const inet = (doc: string) => "```inet\n" + doc + "\n```";

/** A pretend title: the first few words of what was said. */
const fakeTitle: Deps["callModel"] = (messages): ModelCall => {
  const title = (messages[0]!.content as string).split(/\s+/).slice(0, 4).join(" ");
  async function* text() {
    yield title;
  }
  return { text: text(), final: Promise.resolve({ content: [{ type: "text", text: title, citations: null }] as never, stop: "stop", usage: { input_tokens: 0, output_tokens: 0 }, micros: 0 }), abort: () => {} };
};

/**
 * A pretend model. It reads the visitor's last message for a keyword: "bad"
 * gets a document that doesn't parse, then a good one; "hopeless" never gets
 * there; "stuck" gets a net with no rule for its pair; "question" gets words
 * only; "slow" thinks for a long time; "browse" asks to see an example first. Anything else gets the doubling example.
 */
const fakeModel: Deps["callModel"] = (messages): ModelCall => {
  const ctrl = new AbortController();
  const last = messages.at(-1)!.content as string;
  const said = [...messages].reverse().find((m) => m.role === "user" && !(m.content as string).startsWith("netties says"))!.content as string;
  const request = said.split("\n\nThe document as it stands now:")[0]!.toLowerCase();
  const fixing = last.startsWith("netties says");
  const BAD = "agent D 1\nD(out) ~ ;";
  const STUCK = "agent 0 0\nagent D 1\n\nD(out) ~ 0;";
  const reply = request.includes("browse") && !fixing
    ? "```examples\nrange(5)\nSort a list\n```"
    : request.includes("hopeless")
    ? `Here it is.\n\n${inet(BAD)}`
    : request.includes("bad") && !fixing
      ? `Here it is, **doubling** with \`D\`.\n\n${inet(BAD)}`
      : request.includes("stuck")
        ? fixing
          ? "That's what the visitor wants: the rule isn't written yet."
          : `A start, without its rule yet.\n\n${inet(STUCK)}`
        : request.includes("question")
          ? "An **active pair** is two agents joined by their principal ports.\n\n- It's where a rule fires.\n- Everything else waits."
          : `This doubles 2 with an agent \`D\`, which rewrites each successor into two.\n\n${inet(EXAMPLE)}`;
  const thoughts = request.includes("slow") ? 200 : 8;
  let content = "";
  async function* text() {
    for (let i = 0; i < thoughts && !ctrl.signal.aborted; i++) {
      yield { thinking: `Thinking it through, step ${i + 1}. ` };
      await sleep(250, ctrl.signal);
    }
    for (const word of reply.split(/(?<=\s)/)) {
      if (ctrl.signal.aborted) return;
      content += word;
      yield word;
      await sleep(15, ctrl.signal);
    }
  }
  const gen = text();
  let done!: () => void;
  const ended = new Promise<void>((r) => (done = r));
  async function* driven() {
    yield* gen;
    done();
  }
  return {
    text: driven(),
    final: ended.then(() => ({ content: [{ type: "text", text: content, citations: null }] as never, stop: ctrl.signal.aborted ? "aborted" : "stop", usage: { input_tokens: 0, output_tokens: 0 }, micros: 0 })),
    abort: () => ctrl.abort(),
  };
};
