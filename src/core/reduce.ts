import { type AgentId, type End, type Net, type WireId, port } from "./net";
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
  const nodeKey = (s: number, slot: number) => `${s}:${slot}`;
  const isPairPort = (e: End) => e.kind === "port" && (e.agent === side[0] || e.agent === side[1]);
  const nodeOf = (e: Extract<End, { kind: "port" }>) => nodeKey(e.agent === side[0] ? 0 : 1, e.slot);

  type Hop = { node: string } | { end: End };
  const outer = new Map<string, Hop>();
  const oldWire = new Map<string, WireId>();
  for (const s of [0, 1] as const) {
    const a = net.agent(side[s]);
    for (let slot = 1; slot < a.wires.length; slot++) {
      const k = nodeKey(s, slot);
      const p = net.partner(port(a.id, slot));
      if (!p) throw new Error(`port ${a.id}:${slot} is unconnected`);
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

  // Follow each chain of interface nodes from one real end to the other and
  // join those ends with a single wire. Leftover nodes form closed loops,
  // which simply vanish.
  const visited = new Set<string>();
  const walk = (start: End, first: string, via: "inner" | "outer") => {
    const from: WireId[] = [];
    let node = first;
    let dir = via;
    for (;;) {
      visited.add(node);
      if (dir === "outer") from.push(oldWire.get(node)!);
      const nextDir = dir === "inner" ? "outer" : "inner";
      const hop = (nextDir === "inner" ? inner : outer).get(node)!;
      if (nextDir === "outer") from.push(oldWire.get(node)!);
      if ("end" in hop) {
        const ids = [...new Set(from)];
        const reuse = ids[0];
        if (reuse !== undefined) removedWires.delete(reuse);
        createdWires.push({ id: net.connect(start, hop.end, reuse), from: ids });
        return;
      }
      node = hop.node;
      dir = nextDir;
    }
  };
  for (const [k, hop] of outer) if ("end" in hop && !visited.has(k)) walk(hop.end, k, "outer");
  for (const [k, hop] of inner) if ("end" in hop && !visited.has(k)) walk(hop.end, k, "inner");

  return { wire: w, rule, removed: side, created, removedWires: [...removedWires], createdWires };
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
  return net.activePairs().filter((w) => {
    const [a, b] = net.wire(w).ends;
    if (a.kind !== "port" || b.kind !== "port") return false;
    return sys.ruleFor(net.agent(a.agent).type, net.agent(b.agent).type) !== undefined;
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
