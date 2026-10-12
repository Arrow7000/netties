/**
 * The "create it for me" eval: each model gets each task, writes a whole
 * system, and netties checks it, feeding problems back for up to three tries.
 *
 *     npx vite-node eval/run.ts -- --models haiku,flash --tasks add,mul --repeats 3
 *
 * Model and task filters match by substring. Full transcripts go to
 * eval/results/ (not committed); the summary is printed.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { type Stage, grade } from "./check";
import { feedbackMessage } from "../src/create/client";
import { MODELS, type Model } from "./models";
import { TASKS, type Task } from "./tasks";

process.loadEnvFile(".env");

const TRIES = 3;
/** A visitor won't wait longer than this; an attempt that takes longer fails. */
const DEADLINE_MS = 5 * 60_000;

mkdirSync("eval/results", { recursive: true });
const file = `eval/results/run-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pick = <T extends { id: string }>(all: T[], filter?: string) => (filter ? all.filter((x) => filter.split(",").some((f) => x.id.includes(f))) : all);

const models = pick(MODELS, arg("models"));
const tasks = pick(TASKS, arg("tasks"));
const repeats = Number(arg("repeats") ?? 1);
/** Attempts in flight per model. */
const concurrency = Number(arg("concurrency") ?? 8);

interface Attempt {
  model: string;
  task: string;
  rep: number;
  ok: boolean;
  /** Tries used: the one that passed, or all of them. */
  tries: number;
  stages: Stage[];
  got?: string;
  inTokens: number;
  outTokens: number;
  cost: number;
  ms: number;
  error?: string;
  transcript: { role: "user" | "assistant"; text: string; stop?: string }[];
}

async function attempt(model: Model, task: Task, rep: number): Promise<Attempt> {
  const a: Attempt = { model: model.id, task: task.id, rep, ok: false, tries: 0, stages: [], inTokens: 0, outTokens: 0, cost: 0, ms: 0, transcript: [] };
  const chat = model.start();
  const started = performance.now();
  let message = task.prompt;
  try {
    for (let i = 1; i <= TRIES; i++) {
      a.transcript.push({ role: "user", text: message });
      const left = DEADLINE_MS - a.ms;
      const turn = await Promise.race([
        chat.send(message),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`over ${DEADLINE_MS / 60_000} minutes`)), left)),
      ]);
      a.tries = i;
      a.inTokens += turn.inTokens;
      a.outTokens += turn.outTokens;
      a.cost += turn.cost;
      a.ms += turn.ms;
      a.transcript.push({ role: "assistant", text: turn.text, stop: turn.stop });
      const g = grade(turn.text, task.answer);
      a.stages.push(g.stage);
      a.got = g.got;
      if (g.ok) {
        a.ok = true;
        break;
      }
      message = feedbackMessage(g.feedback!);
    }
  } catch (e) {
    a.error = (e as Error).message;
    a.ms = Math.max(a.ms, Math.min(DEADLINE_MS, performance.now() - started));
  }
  const mark = a.ok ? `ok on try ${a.tries}` : a.error ? `error: ${a.error}` : `failed (${a.stages.join(" → ")})`;
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
      out[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return out;
}

// Each model gets its own pool, so a slow one doesn't hold up the rest.
const jobsFor = (m: Model) => tasks.flatMap((t) => Array.from({ length: repeats }, (_, r) => () => attempt(m, t, r + 1)));
console.log(`${models.length} models × ${tasks.length} tasks × ${repeats} = ${models.length * tasks.length * repeats} attempts, up to ${TRIES} tries each\n`);
const results = (await Promise.all(models.map((m) => pool(jobsFor(m), concurrency)))).flat();


// Summary per model.
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
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
