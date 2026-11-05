/**
 * Can the chat's model write readings? For each example system, and for some
 * with every name stripped out so that only the rules say what things mean, ask
 * it for `show` lines and put them through the checks in `src/dev/reading.ts`,
 * giving it what they say back as it would get in the chat.
 *
 *   npx vite-node scripts/reading-eval.ts [runs-per-system]
 *
 * Costs real money on OpenRouter (about a cent a call on DeepSeek), and stops
 * once it has spent BUDGET.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "vite";
import { CHAT_MAX_TOKENS } from "../netlify/lib/chat";
import { callOpenRouter } from "../netlify/lib/openrouter";
import { examples } from "../src/core/examples";
import { Net, free } from "../src/core/net";
import { System } from "../src/core/system";
import { print } from "../src/core/text";
import { checkReading, formula, parseShows, printShows, readingFor, runAhead } from "../src/dev/reading";

const BUDGET = 0.75;
const TRIES = 3;
const RUNS = Number(process.argv[2]) || 2;
/** Names of examples to run again, separated by | since names can have commas; their new runs replace the old. */
const ONLY = process.argv[3]?.split("|");
const OUT = "design/research/readings/model-readings.json";

export const READING_PROMPT = `You help a visitor understand interaction nets in netties, an interaction nets playground. They see a net as agents and wires, which is hard to read: three S agents and a 0 mean the number 3, but nothing on the canvas says so. You write a reading: a few lines saying what the agents mean, so netties can show it on the canvas at every step of a run, without asking you again.

An agent has one principal port, port 0, and aux ports 1 to n. Each port gives or takes.

# The lines

show number S 0
    Chains of the agent S ending in the agent 0 are natural numbers. S has one aux port, 0 has none.

show list C N
    Chains of the agent C ending in the agent N are lists. C has two aux ports (the item and the rest), N has none.

show AGENT "text"
    What AGENT stands for, given on its principal port. {1} in the text reads whatever arrives at port 1, and so on. Use this for data that isn't a number or a list.

show AGENT "text" on 1
show AGENT "text" on 1, 2
    What AGENT gives on those other ports. Use this for an agent that works something out: it takes its inputs on some ports and gives its result on another. The text says what the result means in terms of the inputs.

# What makes a good reading

A reading says what things mean, not how they work. Say what a result is, as a person would write it down: for an agent that adds, "{0} + {2}"; for one that sorts, "sort {0}". Work out what each agent is for from its rules, and use the names and port labels if they help, but they may be missing.

Write in plain maths or plain words, briefly. Use the usual signs + and × for adding and multiplying. Only say what the agent truly means: netties runs the net and checks you. A rule can change how a net looks but never what it means, so a reading must say the same value before and after any rule fires.

An agent that only copies has the same meaning on both copies: if D takes on port 0 and gives on ports 1 and 2, write: show D "{0}" on 1, 2. An agent that only erases gives nothing and needs no line.

netties guesses a line for anything you leave out, in the form Name(inputs), so only leave out what that says well enough.

# Your reply

Reply with only one fenced code block marked \`reading\`, holding the lines. If netties reports a problem, reply with all the lines again, corrected.`;

interface Case {
  name: string;
  /** Names stripped out, so only the rules say what things mean. */
  anonymous: boolean;
  sys: System;
  net: Net;
}

/** The same system with every agent, port type and label renamed to say nothing. */
function anonymised(sys: System, net: Net): { sys: System; net: Net } {
  const names = "ABCDEFGHJKLMNPQRTUVWXYZ";
  const ids = new Map([...sys.types.keys()].map((id, i) => [id, names[i]!]));
  const typeNames = new Map(sys.typing.names.map((n, i) => [n, `t${i + 1}`]));
  const out = new System();
  out.typing = { ...sys.typing, names: sys.typing.names.map((n) => typeNames.get(n)!) };
  for (const t of sys.types.values()) {
    const id = ids.get(t.id)!;
    out.addType({
      id,
      name: id,
      symbol: id,
      arity: t.arity,
      ports: t.ports?.map((p) => ({ ...(p.pol && { pol: p.pol }), ...(p.type && { type: typeNames.get(p.type)! }) })),
    });
  }
  for (const r of sys.rules.values()) out.addRule({ left: ids.get(r.left)!, right: ids.get(r.right)!, agents: r.agents.map((a) => ids.get(a)!), wires: r.wires });
  const j = net.toJSON();
  return { sys: out, net: Net.fromJSON({ ...j, agents: j.agents.map((a) => ({ ...a, type: ids.get(a.type)! })) }) };
}

function cases(): Case[] {
  const of = (name: string) => examples.find((e) => e.name === name)!;
  const plain = ["3 × 2", "Length of a list", "Complete a typed if", "Inspect a computed tree", "Triage: inspect, then run a child", "Fibonacci: 6 → 8", "Sort a list", "range(5)", "Find the primes up to 7", "Map a function: x² + 1", "Differentiate a formula, then run it"];
  const hidden = ["3 × 2", "Fibonacci: 6 → 8", "Sort a list"];
  const out: Case[] = [];
  for (const name of plain) {
    const sys = of(name).system();
    out.push({ name, anonymous: false, sys, net: of(name).net(sys) });
  }
  for (const name of hidden) {
    const sys = of(name).system();
    out.push({ name, anonymous: true, ...anonymised(sys, of(name).net(sys)) });
  }
  return out;
}

const env = loadEnv("development", process.cwd(), "");
if (!env.OPENROUTER_API_KEY || !env.CHAT_MODEL || env.CHAT_MODEL === "fake") throw new Error("needs OPENROUTER_API_KEY and a real CHAT_MODEL in .env");
const model = env.CHAT_MODEL;

let spent = 0;
let lastStop: string | null = null;

async function ask(messages: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  const call = callOpenRouter({ apiKey: env.OPENROUTER_API_KEY!, model, system: READING_PROMPT, maxTokens: CHAT_MAX_TOKENS, messages });
  for await (const _ of call.text);
  const final = await call.final;
  spent += final.micros / 1e6;
  lastStop = final.stop;
  const first = final.content[0];
  return first?.type === "text" ? first.text : "";
}

const linesIn = (reply: string) => [...reply.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1]!).at(-1) ?? reply;

/** What netties says about a reading, if there's anything to fix. */
function verdict(c: Case, text: string): { feedback?: string; problems: string[]; faults: string[] } {
  const { shows, problems } = parseShows(text, c.sys);
  const said = problems.map((p) => p.message);
  // Saying nothing leaves only the guess, which proves nothing about the model.
  if (!shows.length && !problems.length) said.push("the reply has no show lines");
  const faults = checkReading(c.net, c.sys, readingFor(c.sys, shows)).map((f) => `At step ${f.step}, ${f.end} reads as ${f.said}, which comes to ${f.value}, but the net ends with ${f.ends} at ${f.end}, and a rule can't change what a net means.`);
  const all = [...said, ...faults];
  return { problems: said, faults, feedback: all.length ? `netties says:\n- ${all.join("\n- ")}` : undefined };
}

async function one(c: Case, run: number) {
  const started = Date.now();
  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: `Write a reading for this:\n\n\`\`\`inet\n${print(c.sys, c.net)}\n\`\`\`` }];
  const tries: { lines: string; problems: string[]; faults: string[]; stop: string | null }[] = [];
  for (let t = 0; t < TRIES; t++) {
    if (spent > BUDGET) break;
    const reply = await ask(messages);
    const lines = linesIn(reply).trim();
    const v = verdict(c, lines);
    tries.push({ lines, problems: v.problems, faults: v.faults, stop: lastStop });
    if (!v.feedback) break;
    messages.push({ role: "assistant", content: reply }, { role: "user", content: v.feedback });
  }
  const last = tries.at(-1);
  const shows = last ? parseShows(last.lines, c.sys).shows : [];
  const r = readingFor(c.sys, shows);
  const ends = [...c.net.free.keys()];
  const ahead = runAhead(c.net, c.sys, r);
  return {
    name: c.name,
    anonymous: c.anonymous,
    run,
    seconds: Math.round((Date.now() - started) / 1000),
    tries,
    passed: !!last && !last.problems.length && !last.faults.length,
    normalised: printShows(shows, c.sys),
    starts: Object.fromEntries(ends.map((n) => [n, formula(c.net, r, free(n))])),
    ends: ahead.kind === "running" ? {} : Object.fromEntries(ahead.ends),
  };
}

const jobs = cases()
  .filter((c) => !ONLY || ONLY.includes(c.name))
  .flatMap((c) => Array.from({ length: RUNS }, (_, run) => ({ c, run })));
type Result = Awaited<ReturnType<typeof one>>;
const before = ONLY && existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { spent: number; results: Result[] }) : undefined;
const kept = before?.results.filter((r) => !ONLY!.includes(r.name)) ?? [];
const results: Result[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length && spent <= BUDGET) {
    const { c, run } = jobs[next++]!;
    try {
      const res = await one(c, run);
      results.push(res);
      console.log(`${res.passed ? "ok  " : "FAIL"} ${c.name}${c.anonymous ? " (no names)" : ""} #${run}: ${res.tries.length} tries, ${res.seconds}s, $${spent.toFixed(3)} so far`);
    } catch (e) {
      console.log(`ERR  ${c.name} #${run}: ${(e as Error).message}`);
    }
    mkdirSync("design/research/readings", { recursive: true });
    writeFileSync(OUT, JSON.stringify({ model, spent: (before?.spent ?? 0) + spent, results: [...kept, ...results] }, null, 1));
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
const all = [...kept, ...results];
const passed = all.filter((r) => r.passed).length;
const first = all.filter((r) => r.passed && r.tries.length === 1).length;
console.log(`\n${passed} of ${all.length} passed (${first} on the first try), $${((before?.spent ?? 0) + spent).toFixed(3)} spent in all on ${model}`);
