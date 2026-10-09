import { type AgentId, Net, NONE, free, port } from "./net";
import { canonical } from "./canon";
import type { Rule, RuleEnd, System } from "./system";

/**
 * A rule's right-hand side as an ordinary net, so it can be drawn and edited
 * like any other. The interface ports become free ports named L1..Ln (the
 * left agent's aux ports) and R1..Rm (the right agent's).
 */

export const ifaceName = (side: 0 | 1, slot: number) => `${side === 0 ? "L" : "R"}${slot}`;

export function parseIface(name: string): { side: 0 | 1; slot: number } | undefined {
  const m = /^([LR])(\d+)$/.exec(name);
  return m ? { side: m[1] === "L" ? 0 : 1, slot: Number(m[2]) } : undefined;
}

/**
 * Where the interface sits when the pair is drawn left agent on top
 * (pointing down) and right agent below (pointing up). Ports are listed left
 * to right; aux ports run clockwise, so the bottom agent's are reversed.
 */
export function interfacePins(sys: System, left: string, right: string) {
  const n = sys.type(left).arity;
  const m = sys.type(right).arity;
  return {
    top: Array.from({ length: n }, (_, i) => ifaceName(0, i + 1)),
    bottom: Array.from({ length: m }, (_, i) => ifaceName(1, m - i)),
  };
}

/** A net holding nothing but the interface of a rule for this pair. */
export function interfaceNet(sys: System, left: string, right: string): Net {
  const net = new Net();
  const pins = interfacePins(sys, left, right);
  for (const name of [...pins.top, ...pins.bottom]) net.free.set(name, NONE);
  return net;
}

/** The left-hand side: the two agents tip to tip, their aux ports out to the interface. */
export function pairNet(sys: System, left: string, right: string): { net: Net; top: AgentId; bottom: AgentId } {
  const net = interfaceNet(sys, left, right);
  const top = net.addAgent(sys.type(left));
  const bottom = net.addAgent(sys.type(right));
  net.connect(port(top, 0), port(bottom, 0));
  for (let s = 1; s <= sys.type(left).arity; s++) net.connect(port(top, s), free(ifaceName(0, s)));
  for (let s = 1; s <= sys.type(right).arity; s++) net.connect(port(bottom, s), free(ifaceName(1, s)));
  return { net, top, bottom };
}

export function ruleToNet(sys: System, rule: Rule): Net {
  const net = interfaceNet(sys, rule.left, rule.right);
  const ids = rule.agents.map((t) => net.addAgent(sys.type(t)));
  const end = (e: RuleEnd) => (e.kind === "agent" ? port(ids[e.index]!, e.slot) : free(ifaceName(e.side, e.slot)));
  for (const [a, b] of rule.wires) net.connect(end(a), end(b));
  return net;
}

/** Read a right-hand side back into a rule. Unconnected ports are reported, not fixed. */
export function netToRule(left: string, right: string, net: Net): { rule: Rule; open: number } {
  const ids = [...net.agents.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  const wires: [RuleEnd, RuleEnd][] = [];
  for (const w of net.wires.values()) {
    const conv = (e: (typeof w.ends)[number]): RuleEnd => {
      if (e.kind === "port") return { kind: "agent", index: index.get(e.agent)!, slot: e.slot };
      const i = parseIface(e.name);
      if (!i) throw new Error(`unexpected free port ${e.name} in a rule`);
      return { kind: "iface", side: i.side, slot: i.slot };
    };
    wires.push([conv(w.ends[0]), conv(w.ends[1])]);
  }
  const rule: Rule = { left, right, agents: ids.map((id) => net.agent(id).type), wires };
  return { rule, open: net.unconnected().length };
}

/**
 * Whether a right-hand side looks the same with the two sides swapped.
 * Lafont asks this of every rule between two agents of the same type, since
 * otherwise the result depends on which one we call left.
 */
export function isSymmetric(net: Net): boolean {
  const swap = (name: string) => {
    const i = parseIface(name);
    return i ? ifaceName(i.side === 0 ? 1 : 0, i.slot) : name;
  };
  const j = net.toJSON();
  const swapped = Net.fromJSON({
    agents: j.agents,
    free: j.free.map(swap),
    wires: j.wires.map((w) => ({
      id: w.id,
      ends: w.ends.map((e) => (e.kind === "free" ? { kind: "free", name: swap(e.name) } : e)) as typeof w.ends,
    })),
  });
  return canonical(swapped) === canonical(net);
}
