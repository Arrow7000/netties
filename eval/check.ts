import { type AgentId, type End, type Net, port } from "../src/core/net";
import type { System } from "../src/core/system";
import { portName } from "../src/core/types";
import { type Stage as CheckStage, checkReply, netText } from "../src/create/check";
import type { Answer } from "./tasks";

/** How far a reply got: the site's own checks, then reading the answer. */
export type Stage = CheckStage | "readback" | "wrong" | "ok";

export interface Grade {
  stage: Stage;
  ok: boolean;
  /** What to tell the model when it isn't ok. */
  feedback?: string;
  /** What `out` read back as, when it could be read. */
  got?: string;
}

/** The answer goes on a loose end named out, and there are no others. */
function oneOut(_sys: System, net: Net): string | undefined {
  const loose = [...net.free.keys()];
  if (!loose.includes("out")) return "The net has no loose end named out for the answer.";
  const extra = loose.filter((n) => n !== "out");
  if (extra.length) return `The net has loose ends besides out: ${extra.join(", ")}. Each name in the net must be used twice, except out.`;
  return undefined;
}

/** Grade a reply against the expected answer. */
export function grade(reply: string, answer: Answer): Grade {
  const c = checkReply(reply, oneOut);
  if (!c.ok) return { stage: c.stage, ok: false, feedback: c.feedback };
  const { sys, net, stats } = c;
  const read = readBack(sys, net, answer.kind);
  if ("error" in read) return { stage: "readback", ok: false, feedback: `The net finished after ${stats.interactions} interactions, but the result can't be read: ${read.error}\nIt finished as:\n${netText(sys, net)}` };
  if (read.text === show(answer)) return { stage: "ok", ok: true, got: read.text };
  return {
    stage: "wrong",
    ok: false,
    got: read.text,
    feedback: `The net finished after ${stats.interactions} interactions, and out reads as ${read.text}. That isn't the answer to the task.\nIt finished as:\n${netText(sys, net)}`,
  };
}

const show = (a: Answer): string =>
  a.kind === "number" ? String(a.value) : a.kind === "list" ? `[${a.value.join(", ")}]` : String(a.value);

const TRUE = ["true", "t", "tt", "⊤", "yes"];
const FALSE = ["false", "f", "ff", "⊥", "no"];

/**
 * Read the value on `out`, by shape rather than by agent name: numbers are
 * chains of one-port agents ending in a no-port agent, lists chains of
 * two-port agents. Everything left in the net must be part of the answer.
 */
function readBack(sys: System, net: Net, kind: Answer["kind"]): { text: string } | { error: string } {
  const seen = new Set<AgentId>();
  const kinds = new Map<string, string>();
  class Bad extends Error {}
  const sym = (id: AgentId) => sys.type(net.agent(id).type).symbol;
  /** The agent whose principal port `e` is plugged into. */
  const below = (e: End, what: string): AgentId => {
    const p = net.partner(e);
    if (!p) throw new Bad(`${what} isn't connected to anything.`);
    if (p.kind === "free") throw new Bad(`${what} is wired to loose end ${p.name}.`);
    if (p.slot !== 0) throw new Bad(`${what} is wired to ${sym(p.agent)}'s ${portName(p.slot)}, not to a principal port.`);
    if (seen.has(p.agent)) throw new Bad(`${what} loops back on itself.`);
    seen.add(p.agent);
    return p.agent;
  };
  /** Each role (successor, zero, cons, nil) must be played by one agent type throughout. */
  const role = (id: AgentId, r: string) => {
    const t = net.agent(id).type;
    const had = kinds.get(r);
    if (had && had !== t) throw new Bad(`both ${sys.type(had).symbol} and ${sym(id)} appear as the ${r}.`);
    kinds.set(r, t);
  };
  const number = (e: End, what: string): number => {
    const id = below(e, what);
    const n = net.agent(id).wires.length - 1;
    if (n === 0) return role(id, "zero"), 0;
    if (n === 1) return role(id, "successor"), 1 + number(port(id, 1), `${sym(id)}'s aux port`);
    throw new Bad(`${what} leads to ${sym(id)}, which has ${n} aux ports; a number is made of agents with one (successor) or none (zero).`);
  };
  const list = (e: End, what: string): number[] => {
    const id = below(e, what);
    const n = net.agent(id).wires.length - 1;
    if (n === 0) return role(id, "nil"), [];
    if (n === 2) return role(id, "cons"), [number(port(id, 1), `${sym(id)}'s aux port 1`), ...list(port(id, 2), `${sym(id)}'s aux port 2`)];
    throw new Bad(`${what} leads to ${sym(id)}, which has ${n} aux ports; a list is made of agents with two (cons) or none (nil).`);
  };
  const boolean = (e: End): boolean => {
    const id = below(e, "out");
    const t = sys.type(net.agent(id).type);
    if (t.arity !== 0) throw new Bad(`out leads to ${t.symbol}, which has aux ports; a boolean has none.`);
    const names = [t.symbol, t.name].map((s) => s.toLowerCase());
    if (names.some((s) => TRUE.includes(s))) return true;
    if (names.some((s) => FALSE.includes(s))) return false;
    throw new Bad(`out leads to ${t.symbol}, which isn't named true or false.`);
  };
  try {
    const out = { kind: "free", name: "out" } as const;
    const text = kind === "number" ? String(number(out, "out")) : kind === "list" ? `[${list(out, "out").join(", ")}]` : String(boolean(out));
    const left = net.agents.size - seen.size;
    if (left) return { error: `besides the answer, ${left} agent${left === 1 ? " is" : "s are"} left over.` };
    return { text };
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
}
