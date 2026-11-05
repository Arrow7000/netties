import type { Connect, Plugin } from "vite";
import { EXAMPLE, TITLE_SYSTEM } from "../src/create/prompt";

/**
 * A pretend provider under `npm run dev`, for trying the chat without paying. It
 * talks like any other (Chat Completions, as a stream, at /dev-model/v1), and
 * shows up in the chat's list of providers in development only.
 *
 * It reads the visitor's last message for a keyword: "bad" gets a document that
 * doesn't parse, then a good one; "hopeless" never gets there; "stuck" gets a net
 * with no rule for its pair; "question" gets words only; "slow" thinks for a long
 * time; "browse" asks to see an example first; "cutoff" hits the length limit
 * part way; "drop" loses the connection part way, once a message, which Resume
 * picks up. Anything else gets the doubling example. A model named "no-reasoning" turns down
 * reasoning levels and "no-off" turning it off, "few-levels" and "no-levels" list what they take,
 * and "denied" as a key is refused.
 */

const inet = (doc: string) => "```inet\n" + doc + "\n```";
const BAD = "agent D 1\nD(out) ~ ;";
const STUCK = "agent 0 0\nagent D 1\n\nD(out) ~ 0;";

interface Message {
  role: string;
  content: string;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

type Script = { thoughts: number; reply: string; ending: "stop" | "length" | "drop" };

function script(messages: Message[]): Script {
  const last = messages.at(-1)!.content;
  const fixing = last.startsWith("netties says");
  const resuming = last.startsWith("Carry on from exactly");
  const said = [...messages].reverse().find((m) => m.role === "user" && !m.content.startsWith("netties says") && !m.content.startsWith("Carry on from exactly"))!.content;
  const request = said.split("\n\nThe document as it stands now:")[0]!.toLowerCase();
  const whole = `This doubles 2 with an agent \`D\`, which rewrites each successor into two.\n\n${inet(EXAMPLE)}`;
  const reply = request.includes("browse") && !fixing && !resuming
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
            : whole;
  if (!resuming && (request.includes("cutoff") || request.includes("drop"))) return { thoughts: 4, reply: reply.slice(0, 60), ending: request.includes("cutoff") ? "length" : "drop" };
  return { thoughts: request.includes("slow") ? 200 : resuming ? 2 : 8, reply, ending: "stop" };
}

const serveModels: Connect.NextHandleFunction = (_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "fake-writer", created: 2 }, { id: "no-reasoning", created: 1 }, { id: "no-off", created: 1 }, { id: "few-levels", created: 1, reasoning: { supported_efforts: ["low", "high", "max"] } }, { id: "no-levels", created: 1, supported_parameters: ["max_tokens"] }, { id: "fake-embedding", created: 3 }] }));
};

const serveChat: Connect.NextHandleFunction = async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string; messages: Message[]; reasoning_effort?: string };
  const fail = (status: number, message: string) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message } }));
  };
  if (req.headers.authorization === "Bearer denied") return fail(401, "That's not a key.");
  if (body.model === "no-reasoning" && body.reasoning_effort) return fail(400, "Unrecognized request argument supplied: reasoning_effort");
  if (body.model === "no-off" && body.reasoning_effort === "none") return fail(400, "Unsupported value: reasoning_effort does not support none with this model.");

  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort());
  const signal = ctrl.signal;
  res.setHeader("content-type", "text/event-stream");
  const send = (delta: object, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`);

  const system = body.messages[0]!;
  const talk = body.messages.slice(1);
  if (system.content === TITLE_SYSTEM) {
    send({ content: talk[0]!.content.split(/\s+/).slice(0, 6).join(" ") }, "stop");
    res.end("data: [DONE]\n\n");
    return;
  }
  const { thoughts, reply, ending } = script(talk);
  for (let i = 0; i < thoughts && !signal.aborted; i++) {
    send({ reasoning: `Thinking it through, step ${i + 1}. ` });
    await sleep(250, signal);
  }
  for (const word of reply.split(/(?<=\s)/)) {
    if (signal.aborted) return;
    send({ content: word });
    await sleep(15, signal);
  }
  if (ending === "drop") return void res.destroy();
  send({}, ending);
  res.end("data: [DONE]\n\n");
};

export function fakeModel(): Plugin {
  return {
    name: "netties-fake-model",
    configureServer(server) {
      server.middlewares.use("/dev-model/v1/models", serveModels);
      server.middlewares.use("/dev-model/v1/chat/completions", serveChat);
    },
  };
}
