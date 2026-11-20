import { type AgentId, type End, type Net, NONE, type WireId, free, port } from "./net";
import { type Rule, type RuleEnd, type System, pairKey } from "./system";

/** What a single interaction did to the net, in enough detail to animate it. */
export interface StepRecord {
  wire: WireId;
  rule: Rule;
  /** The two interacting agents, as [rule's left side, rule's right side]. */
  removed: [AgentId, AgentId];
  /** Created agents, index-aligned with `rule.agents`. */
  created: AgentId[];
  /** Wires that no longer exist. */
  removedWires: WireId[];
  /**
   * Wires created by the step. `from` lists the old wires each one
   * continues; a wire that reuses an old id keeps that id here and does not
   * appear in `removedWires`.
   */
  createdWires: { id: WireId; from: WireId[] }[];
  /** Closed loops made by the step, with the old wires each one continues, like `createdWires`. */
  createdLoops: { id: WireId; from: WireId[] }[];
}

export class NoRuleError extends Error {
  constructor(readonly left: string, readonly right: string) {
    super(`no rule for ${pairKey(left, right)}`);
  }
}

export function isActive(net: Net, w: WireId): boolean {
  const [a, b] = net.wire(w).ends;
  return a.kind === "port" && b.kind === "port" && a.slot === 0 && b.slot === 0;
}

/** Fire the active pair joined by wire `w`. */
export function interact(net: Net, sys: System, w: WireId): StepRecord {
  if (!isActive(net, w)) throw new Error(`wire ${w} is not an active pair`);
  const [e0, e1] = net.wire(w).ends as [Extract<End, { kind: "port" }>, Extract<End, { kind: "port" }>];
  const t0 = net.agent(e0.agent).type;
  const t1 = net.agent(e1.agent).type;
  const found = sys.ruleFor(t0, t1);
  if (!found) throw new NoRuleError(t0, t1);
  const { rule, swapped } = found;
  const side: [AgentId, AgentId] = swapped ? [e1.agent, e0.agent] : [e0.agent, e1.agent];

  // Each interface port (an aux port of the pair) is a node with an outer
  // neighbour (across its old wire) and an inner neighbour (across the rule).
  // An empty port is taken to have a wire that leads nowhere, rewritten like
  // any other: whatever the rule joins to it is left empty in turn.
  const nodeKey = (s: number, slot: number) => `${s}:${slot}`;
  const isPairPort = (e: End) => e.kind === "port" && (e.agent === side[0] || e.agent === side[1]);
  const nodeOf = (e: Extract<End, { kind: "port" }>) => nodeKey(e.agent === side[0] ? 0 : 1, e.slot);

  type Hop = { node: string } | { end: End } | { open: true };
  const outer = new Map<string, Hop>();
  const oldWire = new Map<string, WireId>();
  for (const s of [0, 1] as const) {
    const a = net.agent(side[s]);
    for (let slot = 1; slot < a.wires.length; slot++) {
      const k = nodeKey(s, slot);
      const p = net.partner(port(a.id, slot));
      if (!p) {
        outer.set(k, { open: true });
        continue;
      }
      outer.set(k, p.kind === "port" && isPairPort(p) ? { node: nodeOf(p) } : { end: p });
      oldWire.set(k, a.wires[slot]!);
    }
  }

  const removedWires = new Set<WireId>([w, ...oldWire.values()]);
  net.removeAgent(side[0]);
  net.removeAgent(side[1]);

  const created = rule.agents.map((t) => net.addAgent(sys.type(t)));
  const resolve = (e: RuleEnd): Hop =>
    e.kind === "agent" ? { end: port(created[e.index]!, e.slot) } : { node: nodeKey(e.side, e.slot) };

  const createdWires: StepRecord["createdWires"] = [];
  const inner = new Map<string, Hop>();
  for (const [x, y] of rule.wires) {
    const hx = resolve(x);
    const hy = resolve(y);
    if ("end" in hx && "end" in hy) createdWires.push({ id: net.connect(hx.end, hy.end), from: [] });
    else {
      if ("node" in hx) inner.set(hx.node, hy);
      if ("node" in hy) inner.set(hy.node, hx);
    }
  }

  // Follow each chain of interface nodes from one end to the other. An
  // empty port counts as a loose end that isn't drawn: a chain from a real
  // end to one leaves an agent's port empty (a loose end's wire gets a new
  // loose end), and a chain between two of them becomes a wire with two
  // new loose ends. A chain with no ends at all is a closed loop.
  const visited = new Set<string>();
  type Stop = { end: End } | { open: true } | { loop: true };
  const follow = (first: string, via: "inner" | "outer"): { from: WireId[]; stop: Stop } => {
    const from: WireId[] = [];
    let node = first;
    let dir = via;
    for (;;) {
      visited.add(node);
      const old = oldWire.get(node);
      if (old !== undefined) from.push(old);
      dir = dir === "inner" ? "outer" : "inner";
      const hop = (dir === "inner" ? inner : outer).get(node)!;
      if (!("node" in hop)) return { from: [...new Set(from)], stop: hop };
      if (visited.has(hop.node)) return { from: [...new Set(from)], stop: { loop: true } };
      node = hop.node;
    }
  };
  const reuse = (from: WireId[]) => {
    const id = from[0];
    if (id !== undefined) removedWires.delete(id);
    return id;
  };
  const join = (a: End, b: End, from: WireId[]) => createdWires.push({ id: net.connect(a, b, reuse(from)), from });
  const loose = (): End => {
    const name = net.freshFree();
    net.free.set(name, NONE);
    return free(name);
  };
  const createdLoops: StepRecord["createdLoops"] = [];
  const fromEnd = (start: End, k: string, via: "inner" | "outer") => {
    if (visited.has(k)) return;
    const { from, stop } = follow(k, via);
    if ("end" in stop) join(start, stop.end, from);
    else if (start.kind === "free") join(start, loose(), from);
  };
  for (const [k, hop] of outer) if ("end" in hop) fromEnd(hop.end, k, "outer");
  for (const [k, hop] of inner) if ("end" in hop) fromEnd(hop.end, k, "inner");
  for (const [k, hop] of outer) {
    if (!("open" in hop) || visited.has(k)) continue;
    join(loose(), loose(), follow(k, "outer").from);
  }
  for (const k of outer.keys()) {
    if (visited.has(k)) continue;
    const { from } = follow(k, "outer");
    createdLoops.push({ id: net.addLoop(reuse(from)), from });
  }

  return { wire: w, rule, removed: side, created, removedWires: [...removedWires], createdWires, createdLoops };
}

export interface Stats {
  interactions: number;
  /** Number of parallel rounds, when reducing in parallel. */
  rounds: number;
  byRule: Map<string, number>;
}

export const emptyStats = (): Stats => ({ interactions: 0, rounds: 0, byRule: new Map() });

function count(stats: Stats, rec: StepRecord) {
  stats.interactions++;
  const k = pairKey(rec.rule.left, rec.rule.right);
  stats.byRule.set(k, (stats.byRule.get(k) ?? 0) + 1);
}

/** Active pairs that have a rule. Pairs without one are stuck. */
export function redexes(net: Net, sys: System): WireId[] {
  // A rule that breaks the types can't fire: the pair is stuck until the rule is fixed.
  const ok = new Map<string, boolean>();
  return net.activePairs().filter((w) => {
    const [a, b] = net.wire(w).ends;
    if (a.kind !== "port" || b.kind !== "port") return false;
    const ta = net.agent(a.agent).type;
    const tb = net.agent(b.agent).type;
    const key = pairKey(ta, tb);
    if (!ok.has(key)) {
      const found = sys.ruleFor(ta, tb);
      ok.set(key, !!found && !sys.broken(found.rule));
    }
    return ok.get(key)!;
  });
}

/** Fire every active pair at once. Active pairs never share an agent, so this is always well defined. */
export function parallelStep(net: Net, sys: System, stats?: Stats): StepRecord[] {
  const recs = redexes(net, sys).map((w) => interact(net, sys, w));
  if (stats) {
    if (recs.length) stats.rounds++;
    recs.forEach((r) => count(stats, r));
  }
  return recs;
}

export type Strategy = "parallel" | "sequential";

export interface NormalizeOptions {
  strategy?: Strategy;
  /** Give up after this many interactions. */
  limit?: number;
  /** Picks the next redex for sequential reduction. Defaults to the first. */
  choose?: (redexes: WireId[]) => WireId;
}

/** Reduce until no redex is left. Returns whether a normal form was reached within the limit. */
export function normalize(net: Net, sys: System, opts: NormalizeOptions = {}): { normal: boolean; stats: Stats } {
  const { strategy = "parallel", limit = 100_000, choose = (rs) => rs[0]! } = opts;
  const stats = emptyStats();
  for (;;) {
    if (stats.interactions >= limit) return { normal: redexes(net, sys).length === 0, stats };
    if (strategy === "parallel") {
      if (parallelStep(net, sys, stats).length === 0) return { normal: true, stats };
    } else {
      const rs = redexes(net, sys);
      if (rs.length === 0) return { normal: true, stats };
      count(stats, interact(net, sys, choose(rs)));
    }
  }
}
