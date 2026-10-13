import { type ComponentDef, type Defs, type GroupId, Groups, type GroupsJSON } from "./groups";
import { type AgentId, type End, NONE, Net, type NetJSON, type WireId, free, port } from "./net";
import { System, type SystemJSON, pairKey } from "./system";

/**
 * A piece of a net on the clipboard: some agents, the wires among them,
 * and the component instances wholly inside. A port wired to something
 * left behind becomes a loose end. It carries the agent types it uses (and
 * the rules among them) and the components it contains, so it can be
 * pasted into another system too.
 */
export interface Clip {
  v: 1;
  net: NetJSON;
  groups: GroupsJSON;
  /** Where each agent was drawn, relative to the middle of the piece. */
  positions: [AgentId, { x: number; y: number; orient: "up" | "down" }][];
  system: SystemJSON;
  components: ComponentDef[];
}

export const CLIP_TYPE = "application/x-netties+json";

/**
 * Copy agents, and any extra wires, out of a net. Ports wired to anything
 * not copied become loose ends; loose ends stay loose ends.
 */
export function cutOut(net: Net, groups: Groups, agents: Iterable<AgentId>, wires: Iterable<WireId> = []) {
  const inside = new Set(agents);
  const out = new Net();
  const ids = new Map<AgentId, AgentId>();
  for (const a of inside) {
    const ag = net.agent(a);
    ids.set(a, out.addAgent({ id: ag.type, name: "", symbol: "", arity: ag.wires.length - 1 }, a));
  }
  let n = 0;
  const loose = () => {
    const name = looseName(n++);
    out.free.set(name, NONE);
    return free(name);
  };
  const map = (e: End): End => (e.kind === "port" && inside.has(e.agent) ? port(e.agent, e.slot) : loose());
  const taken = new Set<WireId>();
  for (const a of inside) {
    for (const w of net.agent(a).wires) {
      if (w === NONE || taken.has(w)) continue;
      taken.add(w);
      const [x, y] = net.wire(w).ends;
      out.connect(map(x), map(y));
    }
  }
  for (const w of wires) {
    if (taken.has(w) || !net.wires.has(w)) continue;
    taken.add(w);
    const [x, y] = net.wire(w).ends;
    out.connect(map(x), map(y));
  }
  // Instances wholly inside come along, keeping their nesting.
  const sub = new Groups();
  const gmap = new Map<GroupId, GroupId>();
  const whole = [...groups.groups.values()].filter((g) => {
    const ms = groups.members(g.id);
    return ms.length > 0 && ms.every((a) => inside.has(a));
  });
  whole.sort((x, y) => groups.chain(x.id).length - groups.chain(y.id).length);
  for (const g of whole) {
    const parent = g.parent !== undefined ? gmap.get(g.parent) : undefined;
    gmap.set(g.id, sub.add({ def: g.def, parent, iface: g.iface.map(([name, e]) => [name, { ...e }]), collapsed: g.collapsed }));
  }
  for (const a of inside) {
    const g = groups.agentChain(a).find((h) => gmap.has(h));
    if (g !== undefined) sub.of.set(a, gmap.get(g)!);
  }
  return { net: out, groups: sub };
}

/** Loose ends are named a, b, … z, a1, b1, … */
export function looseName(i: number): string {
  const letter = String.fromCharCode(97 + (i % 26));
  return i < 26 ? letter : `${letter}${Math.floor(i / 26)}`;
}

/** The agent types a net uses, with every rule among them and whatever those rules create. */
export function systemFor(sys: System, net: Net): System {
  const used = new Set([...net.agents.values()].map((a) => a.type));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of sys.rules.values()) {
      if (!used.has(r.left) || !used.has(r.right)) continue;
      for (const t of r.agents) {
        if (used.has(t)) continue;
        used.add(t);
        grew = true;
      }
    }
  }
  const out = new System();
  out.typing = { ...sys.typing, names: [...sys.typing.names] };
  for (const t of sys.types.values()) if (used.has(t.id)) out.addType(t);
  for (const r of sys.rules.values()) if (used.has(r.left) && used.has(r.right)) out.rules.set(pairKey(r.left, r.right), r);
  return out;
}

/** The component definitions a piece's instances use, and the ones those use. */
export function componentsFor(defs: Defs, groups: Groups): ComponentDef[] {
  const out = new Map<string, ComponentDef>();
  const visit = (id: string) => {
    const d = defs.get(id);
    if (!d || out.has(id)) return;
    out.set(id, d);
    for (const g of d.groups.groups) visit(g.def);
  };
  for (const g of groups.groups.values()) visit(g.def);
  return [...out.values()];
}

/**
 * What pasting a piece's system into another needs: the agent types and
 * rules it lacks. A type that's there already is used as it is, as long as
 * it has the same number of ports. Rules come along only for types that are
 * new, so pasting never changes how existing agents behave.
 */
export function mergePlan(into: System, from: System): { error: string } | { types: System["types"]; rules: System["rules"] } {
  const types = new Map() as System["types"];
  for (const t of from.types.values()) {
    const have = into.types.get(t.id);
    if (!have) types.set(t.id, t);
    else if (have.arity !== t.arity) {
      const ports = (n: number) => (n === 1 ? "1 aux port" : `${n} aux ports`);
      return { error: `Can't paste: ${have.symbol} has ${ports(have.arity)} here but ${ports(t.arity)} in what was copied.` };
    }
  }
  const rules = new Map() as System["rules"];
  for (const [k, r] of from.rules) {
    if (!types.has(r.left) && !types.has(r.right)) continue;
    if (into.ruleFor(r.left, r.right)) continue;
    rules.set(k, r);
  }
  return { types, rules };
}

/**
 * Add a piece to a net under fresh ids and fresh loose-end names. Returns
 * the new agents (by the piece's ids), the new top-level instances and
 * the new wires.
 */
export function graft(net: Net, groups: Groups, sys: System, piece: Net, pieceGroups: Groups, freeName: () => string) {
  const ids = new Map<AgentId, AgentId>();
  for (const a of piece.agents.values()) ids.set(a.id, net.addAgent(sys.type(a.type)));
  const names = new Map<string, string>();
  const map = (e: End): End => {
    if (e.kind === "port") return port(ids.get(e.agent)!, e.slot);
    let name = names.get(e.name);
    if (name === undefined) {
      name = freeName();
      names.set(e.name, name);
      net.free.set(name, NONE);
    }
    return free(name);
  };
  const wires = [...piece.wires.values()].map((w) => net.connect(map(w.ends[0]), map(w.ends[1])));
  const gmap = new Map<GroupId, GroupId>();
  const order = [...pieceGroups.groups.values()].sort((x, y) => pieceGroups.chain(x.id).length - pieceGroups.chain(y.id).length);
  for (const g of order) {
    const parent = g.parent !== undefined ? gmap.get(g.parent) : undefined;
    gmap.set(g.id, groups.add({ def: g.def, parent, iface: g.iface.map(([n, e]) => [n, map(e)]), collapsed: g.collapsed }));
  }
  for (const [a, g] of pieceGroups.of) groups.of.set(ids.get(a)!, gmap.get(g)!);
  const top = order.filter((g) => g.parent === undefined).map((g) => gmap.get(g.id)!);
  return { ids, groups: top, wires };
}
