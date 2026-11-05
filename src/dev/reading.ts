/**
 * Readings: what a net means, worked out by the engine rather than the eye.
 * An experiment for the prototype at /meanings.html, not part of the app yet.
 *
 * A reading is a few `show` lines belonging to a system, so it's written once
 * (by hand, by a model, or guessed from the port types) and then holds for
 * every net of that system at every step, for free:
 *
 *     show number S 0                 chains of S ending in 0 are numbers
 *     show list ∷ []                  chains of ∷ ending in [] are lists
 *     show Add "{1} + {2}"            what an agent gives on its principal port
 *     show + "{0} + {2}" on 1         ...or on another port; {k} reads port k
 *
 * Nothing here runs code from the text, so a reading in a share link is safe.
 */
import { type AgentId, type AgentType, type End, Net, NONE, type WireId, free, port } from "../core/net";
import { normalize, parallelStep, redexes } from "../core/reduce";
import { System } from "../core/system";
import { specOf } from "../core/types";

export type Show =
  | { kind: "number"; succ: string; zero: string }
  | { kind: "list"; cons: string; nil: string; head: number; tail: number }
  | { kind: "text"; agent: string; text: string; ports: number[] };

export interface Reading {
  /** Keyed by agent type and the port it's read at. */
  text: Map<string, string>;
  succ: Map<string, string>;
  zero: Set<string>;
  cons: Map<string, { head: number; tail: number; nil: string }>;
  nil: Set<string>;
}

const key = (agent: string, slot: number) => `${agent}:${slot}`;

export function compile(shows: Show[]): Reading {
  const r: Reading = { text: new Map(), succ: new Map(), zero: new Set(), cons: new Map(), nil: new Set() };
  for (const s of shows) {
    const claimed = [s.kind === "number" ? s.succ : s.kind === "list" ? s.cons : s.agent, ...(s.kind === "number" ? [s.zero] : s.kind === "list" ? [s.nil] : [])];
    // A later line about an agent replaces whatever an earlier one said about it.
    for (const a of claimed) {
      if (s.kind !== "text") {
        r.succ.delete(a);
        r.zero.delete(a);
        r.cons.delete(a);
        r.nil.delete(a);
        for (const k of [...r.text.keys()]) if (k === key(a, 0)) r.text.delete(k);
      }
    }
    if (s.kind === "number") {
      r.succ.set(s.succ, s.zero);
      r.zero.add(s.zero);
    } else if (s.kind === "list") {
      r.cons.set(s.cons, { head: s.head, tail: s.tail, nil: s.nil });
      r.nil.add(s.nil);
    } else {
      for (const p of s.ports) {
        r.text.set(key(s.agent, p), s.text);
        if (p === 0) {
          r.succ.delete(s.agent);
          r.zero.delete(s.agent);
          r.cons.delete(s.agent);
          r.nil.delete(s.agent);
        }
      }
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Writing and checking `show` lines.

export interface ShowProblem {
  line: number;
  message: string;
}

/** The `show` lines in a text, with what's wrong with any of them, in words a model or a person can act on. */
export function parseShows(text: string, sys: System): { shows: Show[]; problems: ShowProblem[] } {
  const shows: Show[] = [];
  const problems: ShowProblem[] = [];
  const bySymbol = new Map<string, AgentType>();
  for (const t of sys.types.values()) {
    bySymbol.set(t.symbol, t);
    bySymbol.set(t.id, t);
  }
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+--.*$/, "").trim();
    if (!line || line.startsWith("--")) return;
    const problem = (message: string) => problems.push({ line: i + 1, message: `${message} (in: ${line})` });
    const need = (sym: string): AgentType | undefined => {
      const t = bySymbol.get(sym);
      if (!t) problem(`there's no agent ${sym}`);
      return t;
    };
    let m: RegExpExecArray | null;
    if ((m = /^show\s+number\s+(\S+)\s+(\S+)$/.exec(line))) {
      const [s, z] = [need(m[1]!), need(m[2]!)];
      if (!s || !z) return;
      if (s.arity !== 1) return void problem(`${s.symbol} is the step of a number so it needs one aux port, and it has ${s.arity}`);
      if (z.arity !== 0) return void problem(`${z.symbol} is where a number ends so it needs no aux ports, and it has ${z.arity}`);
      shows.push({ kind: "number", succ: s.id, zero: z.id });
    } else if ((m = /^show\s+list\s+(\S+)\s+(\S+)$/.exec(line))) {
      const [c, n] = [need(m[1]!), need(m[2]!)];
      if (!c || !n) return;
      if (c.arity !== 2) return void problem(`${c.symbol} is the step of a list so it needs two aux ports, and it has ${c.arity}`);
      if (n.arity !== 0) return void problem(`${n.symbol} is where a list ends so it needs no aux ports, and it has ${n.arity}`);
      // Which aux port holds the rest of the list follows from the types, if there are any.
      const self = specOf(sys, c.id, 0).type;
      const first = self !== undefined && specOf(sys, c.id, 1).type === self && specOf(sys, c.id, 2).type !== self;
      shows.push({ kind: "list", cons: c.id, nil: n.id, head: first ? 2 : 1, tail: first ? 1 : 2 });
    } else if ((m = /^show\s+(\S+)\s+"([^"]*)"(?:\s+on\s+([\d,\s]+))?$/.exec(line))) {
      const t = need(m[1]!);
      if (!t) return;
      const ports = m[3] ? m[3].split(",").map((p) => Number(p.trim())) : [0];
      const bad = ports.find((p) => !(p >= 0 && p <= t.arity));
      if (bad !== undefined) return void problem(`${t.symbol} has no port ${bad}: its ports are 0 to ${t.arity}`);
      const used = [...m[2]!.matchAll(/\{(\d+)\}/g)].map((x) => Number(x[1]));
      const beyond = used.find((p) => p > t.arity);
      if (beyond !== undefined) return void problem(`{${beyond}} reads a port ${t.symbol} doesn't have: its ports are 0 to ${t.arity}`);
      const own = used.find((p) => ports.includes(p));
      if (own !== undefined) return void problem(`this says what ${t.symbol} gives on port ${own} in terms of port ${own} itself`);
      const giving = used.find((p) => specOf(sys, t.id, p).pol === "give");
      if (giving !== undefined) return void problem(`{${giving}} reads port ${giving} of ${t.symbol}, but that port gives rather than takes, so nothing arrives there to read`);
      const taking = ports.find((p) => specOf(sys, t.id, p).pol === "take");
      if (taking !== undefined) return void problem(`port ${taking} of ${t.symbol} takes rather than gives, so there's nothing there to show`);
      shows.push({ kind: "text", agent: t.id, text: m[2]!, ports });
    } else if (line.startsWith("show")) {
      problem('a line must look like show number S 0, or show list C N, or show AGENT "text with {1}" with an optional on PORT');
    } else {
      problem("a reading is only show lines");
    }
  });
  return { shows, problems };
}

export function printShows(shows: Show[], sys: System): string {
  const sym = (id: string) => sys.type(id).symbol;
  return shows
    .map((s) =>
      s.kind === "number"
        ? `show number ${sym(s.succ)} ${sym(s.zero)}`
        : s.kind === "list"
          ? `show list ${sym(s.cons)} ${sym(s.nil)}`
          : `show ${sym(s.agent)} "${s.text}"${s.ports.length === 1 && s.ports[0] === 0 ? "" : ` on ${s.ports.join(", ")}`}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Guessing a reading from the port types alone.

const TRUE = ["true", "t", "tt", "⊤", "yes"];
const FALSE = ["false", "f", "ff", "⊥", "no"];
const INFIX = new Set(["+", "×", "*", "−", "-", "/", "÷", "∧", "∨", "&", "|"]);

/**
 * What can be told from a system with nothing written for it. A type's
 * constructors are the agents that give it on their principal port and take on
 * every other. Exactly a step and an end make a number; a step holding one
 * thing more makes a list. Anything else that gives something reads as a call.
 * Without named types, only agents plainly called S and 0 are numbers.
 */
export function guess(sys: System): Show[] {
  const shows: Show[] = [];
  const types = [...sys.types.values()];
  const named = sys.typing.types !== "off" && sys.typing.dirs !== "off";
  if (!named) {
    const succ = types.find((t) => t.arity === 1 && /^(s|succ|successor)$/i.test(t.symbol));
    const zero = types.find((t) => t.arity === 0 && /^(0|z|zero)$/i.test(t.symbol));
    if (succ && zero) shows.push({ kind: "number", succ: succ.id, zero: zero.id });
    return shows;
  }
  const spec = (t: AgentType, slot: number) => specOf(sys, t.id, slot);
  const slots = (t: AgentType) => Array.from({ length: t.arity + 1 }, (_, i) => i);
  const isConstructor = (t: AgentType) => spec(t, 0).pol === "give" && spec(t, 0).type !== undefined && slots(t).slice(1).every((s) => spec(t, s).pol === "take");

  const done = new Set<string>();
  const byType = new Map<string, AgentType[]>();
  for (const t of types.filter(isConstructor)) {
    const name = spec(t, 0).type!;
    byType.set(name, [...(byType.get(name) ?? []), t]);
  }
  for (const [name, cs] of byType) {
    if (cs.length !== 2) continue;
    const end = cs.find((c) => c.arity === 0);
    const step = cs.find((c) => c.arity > 0);
    if (!end || !step) continue;
    const own = slots(step).slice(1).filter((s) => spec(step, s).type === name);
    if (step.arity === 1 && own.length === 1) {
      shows.push({ kind: "number", succ: step.id, zero: end.id });
      done.add(step.id).add(end.id);
    } else if (step.arity === 2 && own.length === 1) {
      shows.push({ kind: "list", cons: step.id, nil: end.id, head: own[0] === 1 ? 2 : 1, tail: own[0]! });
      done.add(step.id).add(end.id);
    }
  }
  for (const t of types) {
    if (done.has(t.id)) continue;
    const gives = slots(t).filter((s) => spec(t, s).pol === "give");
    const takes = slots(t).filter((s) => spec(t, s).pol === "take");
    if (!gives.length) continue;
    const words = [t.symbol, t.name].map((w) => w.toLowerCase());
    if (t.arity === 0) {
      const text = words.some((w) => TRUE.includes(w)) ? "true" : words.some((w) => FALSE.includes(w)) ? "false" : t.symbol;
      shows.push({ kind: "text", agent: t.id, text, ports: [0] });
    } else if (takes.length === 1 && gives.length === 2 && (t.symbol === "δ" || /duplicat/i.test(t.name) || /^dup$/i.test(t.symbol))) {
      shows.push({ kind: "text", agent: t.id, text: `{${takes[0]}}`, ports: gives });
    } else if (takes.length === 2 && gives.length === 1 && INFIX.has(t.symbol)) {
      shows.push({ kind: "text", agent: t.id, text: `{${takes[0]}} ${t.symbol} {${takes[1]}}`, ports: gives });
    } else {
      const args = takes.map((s) => `{${s}}`).join(", ");
      gives.forEach((g, i) => shows.push({ kind: "text", agent: t.id, text: `${t.symbol}(${args})${gives.length > 1 ? `.${i + 1}` : ""}`, ports: [g] }));
    }
  }
  return shows;
}

/** A system's guessed reading with anything written for it laid over the top. */
export const readingFor = (sys: System, written: Show[] = []): Reading => compile([...guess(sys), ...written]);

// ---------------------------------------------------------------------------
// Reading what's in a net.

interface Term {
  text: string;
  /** Needs brackets when it sits inside something else. */
  compound: boolean;
  /** A number, or a number still being added to: `n + rest`. */
  n?: number;
  rest?: Term;
  /** A list, or the start of one followed by `rest`. */
  items?: string[];
}

const bracket = (t: Term) => (t.compound ? `(${t.text})` : t.text);

/**
 * A number with `rest` still to come. Numbers join up across whatever passes
 * them along, so a number halfway through being copied still reads as that
 * number, and copying doesn't change what a net says.
 */
function numberTerm(n: number, rest?: Term): Term {
  if (rest?.n !== undefined) return numberTerm(n + rest.n, rest.rest);
  if (!rest) return { text: String(n), compound: false, n };
  return { text: `${n} + ${bracket(rest)}`, compound: true, n, rest };
}

/** The same for a list. */
function listTerm(items: string[], rest?: Term): Term {
  if (rest?.items) return listTerm([...items, ...rest.items], rest.rest);
  if (!rest) return { text: `[${items.join(", ")}]`, compound: false, items };
  if (rest.text === HOLE) return { text: `[${items.join(", ")}, …]`, compound: false, items, rest };
  return { text: `[${items.join(", ")}] ++ ${bracket(rest)}`, compound: true, items, rest };
}

/** Where a piece of text was left open because what goes there isn't data yet. */
const HOLE = "·";
/** What a formula says for something the reading has nothing to say about. */
export const UNREAD = "?";
/** Formulas are cut off at about this length: copies can make them grow fast. */
const MAX_TEXT = 240;

/** Whether a template's text has a space outside any brackets, so that it needs brackets inside something else. */
function compoundTemplate(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === " " && depth === 0) return true;
  }
  return false;
}

function fill(template: string, read: (slot: number) => Term): Term {
  const whole = /^\{(\d+)\}$/.exec(template);
  if (whole) return read(Number(whole[1]));
  const text = template.replace(/\{(\d+)\}/g, (match, k: string, at: number) => {
    const t = read(Number(k));
    const before = template[at - 1];
    const after = template[at + match.length];
    const enclosed = (before === "(" || before === "," || before === "[" || (before === " " && template[at - 2] === ",")) && (after === ")" || after === "," || after === "]");
    return t.compound && !enclosed ? `(${t.text})` : t.text;
  });
  return { text, compound: compoundTemplate(template) };
}

type Port = Extract<End, { kind: "port" }>;

/** Whether an agent is data: it says what it is on its principal port. */
export function isData(r: Reading, type: string): boolean {
  return r.succ.has(type) || r.zero.has(type) || r.cons.has(type) || r.nil.has(type) || r.text.has(key(type, 0));
}

/**
 * Text for what's given at a port. `open` decides what happens at an inner aux
 * port whose wire doesn't lead to more of the same structure: what it returns
 * goes in the text there.
 */
function readPort(net: Net, r: Reading, at: Port, open: (aux: Port, inside: () => Term | undefined) => Term, onAgent?: (id: AgentId) => void): Term | undefined {
  const type = net.agent(at.agent).type;
  const principal = (e: Port): Port | undefined => {
    const p = net.partner(e);
    return p?.kind === "port" && p.slot === 0 ? p : undefined;
  };
  const dataBelow = (aux: Port): Term => {
    const below = principal(aux);
    return open(aux, () => (below && isData(r, net.agent(below.agent).type) ? readPort(net, r, below, open, onAgent) : undefined));
  };

  if (at.slot === 0 && (r.succ.has(type) || r.zero.has(type))) {
    let n = 0;
    let id = at.agent;
    for (;;) {
      onAgent?.(id);
      const t = net.agent(id).type;
      if (r.zero.has(t)) return numberTerm(n);
      n++;
      const aux = port(id, 1) as Port;
      const below = principal(aux);
      if (below && (r.succ.has(net.agent(below.agent).type) || r.zero.has(net.agent(below.agent).type))) {
        id = below.agent;
        continue;
      }
      return numberTerm(n, dataBelow(aux));
    }
  }
  if (at.slot === 0 && (r.cons.has(type) || r.nil.has(type))) {
    const items: string[] = [];
    let id = at.agent;
    for (;;) {
      onAgent?.(id);
      const t = net.agent(id).type;
      if (r.nil.has(t)) return listTerm(items);
      const { head, tail } = r.cons.get(t)!;
      items.push(dataBelow(port(id, head) as Port).text);
      const aux = port(id, tail) as Port;
      const below = principal(aux);
      if (below && (r.cons.has(net.agent(below.agent).type) || r.nil.has(net.agent(below.agent).type))) {
        id = below.agent;
        continue;
      }
      return listTerm(items, dataBelow(aux));
    }
  }
  const template = r.text.get(key(type, at.slot));
  if (template === undefined) return undefined;
  onAgent?.(at.agent);
  return fill(template, (slot) => dataBelow(port(at.agent, slot) as Port));
}

/** A piece of data in a net: a tree of agents that together mean one thing. */
export interface Region {
  root: AgentId;
  agents: AgentId[];
  /** What it means, with `·` wherever it isn't data yet. */
  label: string;
  /** The aux ports inside it that lead outside, one for each `·`, in order. */
  holes: Port[];
}

/**
 * Every region of data in a net, largest first in the sense that a region
 * takes in all it can. With `peel`, an agent in an active pair stays out of
 * its region, since it's about to be used as itself.
 */
export function regions(net: Net, r: Reading, opts: { peel?: boolean } = {}): Region[] {
  const data = (id: AgentId) => isData(r, net.agent(id).type);
  const inPair = (id: AgentId) => {
    const p = net.partner(port(id, 0));
    return p?.kind === "port" && p.slot === 0;
  };
  /** Whether the agent plugged into this aux port counts as part of the agent holding it. */
  const absorbs = (holder: AgentId, slot: number, child: AgentId): boolean => {
    if (!data(holder) || (opts.peel && inPair(holder))) return false;
    const h = net.agent(holder).type;
    const c = net.agent(child).type;
    if (r.succ.has(h)) return r.succ.has(c) || r.zero.has(c);
    const cons = r.cons.get(h);
    if (cons) return slot === cons.tail ? r.cons.has(c) || r.nil.has(c) : true;
    const template = r.text.get(key(h, 0));
    return template !== undefined && template.includes(`{${slot}}`);
  };
  const parent = (id: AgentId): AgentId | undefined => {
    if (opts.peel && inPair(id)) return undefined;
    const p = net.partner(port(id, 0));
    return p?.kind === "port" && p.slot > 0 && absorbs(p.agent, p.slot, id) ? p.agent : undefined;
  };

  const out: Region[] = [];
  for (const a of net.agents.values()) {
    if (!data(a.id) || parent(a.id) !== undefined || (opts.peel && inPair(a.id))) continue;
    const agents: AgentId[] = [];
    const holes: Port[] = [];
    const term = readPort(
      net,
      r,
      port(a.id, 0) as Port,
      (aux, inside) => {
        const p = net.partner(aux);
        if (p?.kind === "port" && p.slot === 0 && absorbs(aux.agent, aux.slot, p.agent)) {
          const t = inside();
          if (t) return t;
        }
        holes.push(aux);
        return { text: HOLE, compound: false };
      },
      (id) => agents.push(id),
    );
    if (term) out.push({ root: a.id, agents, label: term.text, holes });
  }
  return out;
}

/**
 * What arrives at a loose end or a port that takes, as a formula: data as
 * data, and everything still being worked out by what's working it out.
 */
export function formula(net: Net, r: Reading, at: End): string {
  let budget = 400;
  const seen: Set<AgentId> = new Set();
  const arriving = (e: End): Term => {
    const p = net.partner(e);
    if (!p) return { text: "_", compound: false };
    if (p.kind === "free") return { text: p.name, compound: false };
    return giving(p);
  };
  const giving = (p: Port): Term => {
    if (budget-- <= 0) return { text: "…", compound: false };
    if (seen.has(p.agent) && !isData(r, net.agent(p.agent).type)) return { text: "↺", compound: false };
    const isOperator = !isData(r, net.agent(p.agent).type);
    if (isOperator) seen.add(p.agent);
    const t = readPort(net, r, p, (aux, inside) => inside() ?? arriving(aux));
    if (isOperator) seen.delete(p.agent);
    return t ?? { text: UNREAD, compound: false };
  };
  const text = arriving(at).text;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

// ---------------------------------------------------------------------------
// Running ahead on a copy.

export type Ahead =
  | { kind: "done"; interactions: number; ends: Map<string, string> }
  | { kind: "stuck"; interactions: number; ends: Map<string, string> }
  | { kind: "running"; after: number };

/** What a data read of a loose end says once the net has stopped. */
function restingAt(net: Net, r: Reading, name: string): string {
  const p = net.partner(free(name));
  if (!p) return "nothing";
  if (p.kind === "free") return `wired to ${p.name}`;
  if (p.slot !== 0 || !isData(r, net.agent(p.agent).type)) return "?";
  const reg = regions(net, r).find((g) => g.agents.includes(p.agent));
  return reg?.label ?? "?";
}

/**
 * Run a copy of the net to the end and say what each loose end comes to.
 * Nets are confluent, so this is what any order of firing reaches, in the same
 * number of interactions.
 */
export function runAhead(net: Net, sys: System, r: Reading, limit = 20_000): Ahead {
  const copy = net.clone();
  const { stats } = normalize(copy, sys, { limit });
  if (redexes(copy, sys).length) return { kind: "running", after: stats.interactions };
  const ends = new Map([...copy.free.keys()].map((name) => [name, restingAt(copy, r, name)] as const));
  return { kind: copy.activePairs().length ? "stuck" : "done", interactions: stats.interactions, ends };
}

/** Which end of a wire gives and which takes, if the wire has a side that gives data. */
export function wireSides(net: Net, sys: System, r: Reading, wire: WireId): { giver: End; taker: End } | undefined {
  const [a, b] = net.wire(wire).ends;
  const gives = (e: End) => e.kind === "port" && specOf(sys, net.agent(e.agent).type, e.slot).pol === "give";
  const holdsData = (e: End) => e.kind === "port" && e.slot === 0 && isData(r, net.agent(e.agent).type);
  const giver = gives(a) ? a : gives(b) ? b : holdsData(a) ? a : holdsData(b) ? b : undefined;
  return giver && { giver, taker: giver === a ? b : a };
}

/**
 * What a wire will carry. Cut it, keep only what's connected to the side that
 * gives, and run that on its own, so what happens beyond the wire doesn't come
 * into it. Gives undefined if the wire has no side that gives data.
 */
export function carries(net: Net, sys: System, r: Reading, wire: WireId, limit = 20_000): string | undefined {
  const sides = wireSides(net, sys, r, wire);
  if (!sides) return undefined;
  const { giver, taker } = sides;
  const copy = net.clone();
  copy.disconnect(wire);
  copy.connect(giver, free("·probe"));
  if (taker.kind === "port") copy.connect(taker, free("·rest"));
  // Only the side that gives matters.
  const keep = new Set<AgentId>();
  const walk: End[] = [giver];
  while (walk.length) {
    const e = walk.pop()!;
    if (e.kind !== "port" || keep.has(e.agent)) continue;
    keep.add(e.agent);
    copy.agent(e.agent).wires.forEach((w) => {
      if (w === NONE) return;
      for (const end of copy.wire(w).ends) walk.push(end);
    });
  }
  for (const id of [...copy.agents.keys()]) if (!keep.has(id)) copy.removeAgent(id);
  normalize(copy, sys, { limit });
  if (redexes(copy, sys).length) return undefined;
  const text = restingAt(copy, r, "·probe");
  return text === "?" ? undefined : text;
}

// ---------------------------------------------------------------------------
// Folding: a drawing with each piece of data as a single thing.

export interface Fold {
  net: Net;
  sys: System;
  /** The regions that became one agent, by that agent's id (the root's). */
  folded: Map<AgentId, Region>;
}

/**
 * The same net with each region of two or more agents standing in as one agent:
 * no aux ports if it's a finished value, one for each place it's still waiting
 * on. Agents in active pairs stay out, so a step still shows what it uses.
 * Wires keep their ids, so a wire outside a region is the same wire here.
 */
export function fold(net: Net, sys: System, r: Reading): Fold {
  const out = new Net();
  const foldedSys = new System();
  foldedSys.typing = sys.typing;
  for (const t of sys.types.values()) foldedSys.addType(t);

  const folded = new Map<AgentId, Region>();
  const under = new Map<AgentId, Region>();
  for (const g of regions(net, r, { peel: true })) {
    if (g.agents.length < 2) continue;
    folded.set(g.root, g);
    for (const a of g.agents) under.set(a, g);
  }
  for (const a of net.agents.values()) {
    const g = under.get(a.id);
    if (!g) {
      out.addAgent(sys.type(a.type), a.id);
    } else if (g.root === a.id) {
      const rootSpec = sys.type(a.type).ports?.[0];
      const type: AgentType = {
        id: `fold:${a.id}`,
        name: g.label,
        symbol: g.label,
        arity: g.holes.length,
        box: g.holes.length > 0,
        ports: [rootSpec ?? {}, ...g.holes.map((h) => sys.type(net.agent(h.agent).type).ports?.[h.slot] ?? {})],
      };
      foldedSys.addType(type);
      out.addAgent(type, a.id);
    }
  }
  const mapEnd = (e: End): End | undefined => {
    if (e.kind === "free") return e;
    const g = under.get(e.agent);
    if (!g) return e;
    if (e.agent === g.root && e.slot === 0) return e;
    const i = g.holes.findIndex((h) => h.agent === e.agent && h.slot === e.slot);
    return i >= 0 ? port(g.root, i + 1) : undefined;
  };
  for (const name of net.free.keys()) out.free.set(name, NONE);
  for (const w of net.wires.values()) {
    const [a, b] = [mapEnd(w.ends[0]), mapEnd(w.ends[1])];
    if (a && b) out.connect(a, b, w.id);
  }
  return { net: out, sys: foldedSys, folded };
}

// ---------------------------------------------------------------------------
// Catching a reading that's wrong.

/** The value of a formula that's only numbers and arithmetic, or undefined for anything else. */
export function arithmeticValue(text: string): number | undefined {
  const tokens = text.match(/\d+|[-+×*−()]|\S/g) ?? [];
  let i = 0;
  const atom = (): number | undefined => {
    const t = tokens[i++];
    if (t === undefined) return undefined;
    if (/^\d+$/.test(t)) return Number(t);
    if (t !== "(") return undefined;
    const v = sum();
    return tokens[i++] === ")" ? v : undefined;
  };
  const product = (): number | undefined => {
    let v = atom();
    while (v !== undefined && (tokens[i] === "×" || tokens[i] === "*")) {
      i++;
      const w = atom();
      v = w === undefined ? undefined : v * w;
    }
    return v;
  };
  function sum(): number | undefined {
    let v = product();
    while (v !== undefined && (tokens[i] === "+" || tokens[i] === "-" || tokens[i] === "−")) {
      const minus = tokens[i++] !== "+";
      const w = product();
      v = w === undefined ? undefined : minus ? v - w : v + w;
    }
    return v;
  }
  const v = sum();
  return i === tokens.length ? v : undefined;
}

export interface ReadingFault {
  step: number;
  end: string;
  said: string;
  value: number;
  ends: string;
}

/**
 * A rule can change how a net looks but not what it means, so a formula's value
 * can't change as the net runs. This runs a copy to the end and looks for one
 * that does, which can only be the reading's fault. It can only speak for
 * formulas that are plain arithmetic.
 */
export function checkReading(net: Net, sys: System, r: Reading, maxSteps = 300): ReadingFault[] {
  const ahead = runAhead(net, sys, r);
  if (ahead.kind !== "done") return [];
  const faults: ReadingFault[] = [];
  const copy = net.clone();
  const reported = new Set<string>();
  for (let step = 0; step < maxSteps; step++) {
    for (const [name, ends] of ahead.ends) {
      const target = Number(ends);
      if (!Number.isInteger(target) || reported.has(name)) continue;
      const said = formula(copy, r, free(name));
      const value = arithmeticValue(said);
      if (value !== undefined && value !== target) {
        reported.add(name);
        faults.push({ step, end: name, said, value, ends });
      }
    }
    if (!parallelStep(copy, sys).length) break;
  }
  return faults;
}
