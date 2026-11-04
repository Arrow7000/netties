/**
 * The "create it for me" eval: each model gets each task, writes a whole
 * system, and netties checks it, feeding problems back for up to three tries.
 *
 *     npx vite-node eval/run.ts -- --models haiku,flash --tasks add,mul --repeats 3 --budget 5
 *
 * Model and task filters match by substring. Full transcripts go to
 * eval/results/ (not committed); the summary is printed.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { type Stage, grade } from "./check";
import { MAX_TOKENS as LIVE_MAX_TOKENS } from "../netlify/lib/create";
import { checkReply } from "../src/create/check";
import { feedbackMessage } from "../src/create/client";
import { MODELS, type Model } from "./models";
import { TASKS, type Task } from "./tasks";

process.loadEnvFile(".env");

const TRIES = 3;
/** How long one reply can take on the site (see `send` below). */
const LIVE_TURN_MS = 60_000;
/** A visitor won't wait longer than this; an attempt that takes longer fails. */
const DEADLINE_MS = 5 * 60_000;

mkdirSync("eval/results", { recursive: true });
// With the process id, so that runs started together don't share a file.
const file = `eval/results/run-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.jsonl`;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
/** An exact id means just that one; otherwise anything containing it. */
const pick = <T extends { id: string }>(all: T[], filter?: string) => (filter ? all.filter((x) => filter.split(",").some((f) => x.id === f || (!all.some((y) => y.id === f) && x.id.includes(f)))) : all);

const models = pick(MODELS, arg("models"));
const tasks = pick(TASKS, arg("tasks"));
const repeats = Number(arg("repeats") ?? 1);
/** Attempts in flight per model. */
const concurrency = Number(arg("concurrency") ?? 8);
/** Do what the site does, which knows nothing about the answer, then grade what it would have shown. */
const live = process.argv.includes("--live");
/** Start no new attempts once this many dollars are spent. */
const budget = Number(arg("budget") ?? Infinity);
let spent = 0;
/** Models that can't go on, so their remaining attempts are skipped. */
const stopped = new Set<string>();

interface Attempt {
  model: string;
  task: string;
  rep: number;
  ok: boolean;
  /** Tries used: the one that passed, or all of them. */
  tries: number;
  stages: Stage[];
  got?: string;
  interactions?: number;
  /** Whether the same agents and rules also solved the task's held-out input. */
  general?: boolean;
  againStages?: string[];
  /** With --live: the site would have shown this visitor a finished net. */
  accepted?: boolean;
  inTokens: number;
  outTokens: number;
  cost: number;
  ms: number;
  error?: string;
  transcript: { role: "user" | "assistant"; text: string; stop?: string }[];
}

async function attempt(model: Model, task: Task, rep: number): Promise<Attempt> {
  const a: Attempt = { model: model.id, task: task.id, rep, ok: false, tries: 0, stages: [], inTokens: 0, outTokens: 0, cost: 0, ms: 0, transcript: [] };
  const chat = model.start(live ? LIVE_MAX_TOKENS : undefined);
  const started = performance.now();
  const send = async (message: string) => {
    a.transcript.push({ role: "user", text: message });
    const left = DEADLINE_MS - a.ms;
    const turn = await Promise.race([
      chat.send(message),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`over ${DEADLINE_MS / 60_000} minutes`)), left)),
      // Netlify ends an edge function's response after 60 seconds, however it's going.
      ...(live ? [new Promise<never>((_, reject) => setTimeout(() => reject(new Error("cut off at 60 s")), LIVE_TURN_MS))] : []),
    ]);
    a.inTokens += turn.inTokens;
    a.outTokens += turn.outTokens;
    a.cost += turn.cost;
    a.ms += turn.ms;
    a.transcript.push({ role: "assistant", text: turn.text, stop: turn.stop });
    return turn;
  };
  let message = task.prompt;
  try {
    let rules: string | undefined;
    for (let i = 1; i <= TRIES; i++) {
      const turn = await send(message);
      a.tries = i;
      if (live) {
        // What the site does: a cut-off reply ends it, and the only feedback is
        // from its own checks, since it doesn't know what the answer should be.
        // Anthropic says max_tokens, OpenRouter says length.
        if (turn.stop === "max_tokens" || turn.stop === "length") throw new Error("cut off");
        const c = checkReply(turn.text);
        if (!c.ok) {
          a.stages.push(c.stage);
          message = feedbackMessage(c.feedback);
          continue;
        }
        a.accepted = true;
      }
      const g = grade(turn.text, task.answer, task.demands);
      a.stages.push(g.stage);
      a.got = g.got;
      a.interactions = g.interactions;
      rules = g.rules;
      if (g.ok || live) {
        a.ok = g.ok;
        break;
      }
      message = feedbackMessage(g.feedback!);
    }
    if (a.ok && task.again && !live) {
      a.general = false;
      a.againStages = [];
      message = `Keep every agent and rule exactly as they are, and change only the starting net, so that it does this instead: ${task.again.prompt} Reply with the whole document.`;
      for (let i = 1; i <= TRIES && !a.general; i++) {
        const turn = await send(message);
        const g = grade(turn.text, task.again.answer, { needs: task.demands?.needs, minInteractions: Math.max(1, task.demands?.minInteractions ?? 1) });
        const changed = g.rules !== undefined && g.rules !== rules;
        a.againStages.push(changed ? "rules-changed" : g.stage);
        a.general = g.ok && !changed;
        message = changed ? "netties says: The agents or rules changed. Keep them exactly as they were, and change only the starting net." : feedbackMessage(g.feedback ?? "");
      }
    }
  } catch (e) {
    a.error = (e as Error).message;
    a.ms = Math.max(a.ms, Math.min(DEADLINE_MS, performance.now() - started));
    // Out of allowance or credits, or not logged in: the attempts left would only fail the same way.
    if (/limit|quota|credits|log ?in|refusing to run/i.test(a.error)) stopped.add(model.id);
  } finally {
    chat.close?.();
  }
  spent += a.cost;
  const mark = (a.ok ? `ok on try ${a.tries}` : a.error ? `error: ${a.error}` : `failed (${a.stages.join(" → ")})`) + (a.general === undefined ? "" : a.general ? ", general" : ` , not general (${a.againStages!.join(" → ")})`);
  console.log(`${model.id.padEnd(30)} ${task.id.padEnd(8)} #${rep}  ${mark}  ${(a.ms / 1000).toFixed(0)}s $${a.cost.toFixed(4)}`);
  // Saved as soon as it's done, so a stopped run keeps what it has.
  appendFileSync(file, JSON.stringify(a) + "\n");
  return a;
}

/** Run jobs with at most `n` in flight. */
async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      if (spent >= budget) continue;
      out[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return out;
}

// Each model gets its own pool, so a slow one doesn't hold up the rest.
// Shuffled, so a budget that runs out doesn't always cost the same tasks.
const jobsFor = (m: Model) => tasks.flatMap((t) => Array.from({ length: repeats }, (_, r) => () => (stopped.has(m.id) ? (undefined as unknown as Promise<Attempt>) : attempt(m, t, r + 1)))).sort(() => Math.random() - 0.5);
console.log(`${models.length} models × ${tasks.length} tasks × ${repeats} = ${models.length * tasks.length * repeats} attempts, up to ${TRIES} tries each\n`);
const results = (await Promise.all(models.map((m) => pool(jobsFor(m), concurrency)))).flat().filter(Boolean);
if (spent >= budget) console.log(`\nStopped at the $${budget} budget: spent $${spent.toFixed(2)}.`);


// Summary per model.
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const generalOf = (rs: Attempt[]) => {
  const asked = rs.filter((r) => r.general !== undefined);
  return asked.length ? `general: ${asked.filter((r) => r.general).length}/${rs.length} of all attempts` : "";
};
for (const m of models) {
  const rs = results.filter((r) => r.model === m.id);
  if (live) console.log(`${m.id}: site reported success on ${rs.filter((r) => r.accepted).length}/${rs.length}; actually right on ${rs.filter((r) => r.ok).length}/${rs.length}; cut off on ${rs.filter((r) => r.error?.startsWith("cut off")).length}/${rs.length}`);
  else if (generalOf(rs)) console.log(`${m.id}: ${generalOf(rs)}`);
}
console.log(`\n${"model".padEnd(30)} ${"pass@3".padStart(7)} ${"pass@1".padStart(7)} ${"errors".padStart(6)} ${"in tok".padStart(9)} ${"out tok".padStart(9)} ${"s/attempt".padStart(9)} ${"cost".padStart(8)} ${"$/success".padStart(9)}`);
for (const m of models) {
  const rs = results.filter((r) => r.model === m.id);
  const ok = rs.filter((r) => r.ok);
  const first = ok.filter((r) => r.tries === 1);
  const cost = rs.reduce((s, r) => s + r.cost, 0);
  const sum = (f: (r: Attempt) => number) => rs.reduce((s, r) => s + f(r), 0);
  console.log(
    `${m.id.padEnd(30)} ${pct(ok.length, rs.length).padStart(7)} ${pct(first.length, rs.length).padStart(7)} ${String(rs.filter((r) => r.error).length).padStart(6)} ${String(sum((r) => r.inTokens)).padStart(9)} ${String(sum((r) => r.outTokens)).padStart(9)} ${(sum((r) => r.ms) / 1000 / rs.length).toFixed(0).padStart(9)} ${("$" + cost.toFixed(3)).padStart(8)} ${(ok.length ? "$" + (cost / ok.length).toFixed(4) : "-").padStart(9)}`,
  );
}

// Passes per task, per model.
console.log(`\n${"task".padEnd(8)} ${models.map((m) => m.id.split("/").at(-1)!.slice(0, 16).padStart(17)).join("")}`);
for (const t of tasks) {
  const cells = models.map((m) => {
    const rs = results.filter((r) => r.model === m.id && r.task === t.id);
    return `${rs.filter((r) => r.ok).length}/${rs.length}`.padStart(17);
  });
  console.log(`${t.id.padEnd(8)} ${cells.join("")}`);
}
console.log(`\nTranscripts: ${file}`);
// Requests cut off by the deadline may still be open; don't wait for them.
process.exit(0);
