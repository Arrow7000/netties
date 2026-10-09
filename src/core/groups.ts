import { type AgentId, type AgentType, type End, Net, NONE, type NetJSON, endKey, port } from "./net";
import { System } from "./system";

/**
 * Components. A component definition is a small net whose free ports are
 * its interface. Placing one in a net copies its agents in and records them
 * as a group (an instance), remembering which inner port stands for each
 * interface port. The net itself stays flat, so reduction never needs to
 * know about groups; groups just say which agents belong together, and can
 * nest. When anything inside an instance interacts, it is no longer the
 * component it was, so the instance dissolves and its agents stay behind.
 */

export type GroupId = number;

export interface Group {
  id: GroupId;
  def: string;
  parent?: GroupId;
  /** Interface port name to the inner end it stands for. */
  iface: [string, End][];
  collapsed: boolean;
}

export interface GroupsJSON {
  groups: Group[];
  of: [AgentId, GroupId][];
  next: number;
}

export interface ComponentDef {
  id: string;
  name: string;
  symbol: string;
  net: NetJSON;
  groups: GroupsJSON;
  /** Interface port names (the definition's free ports), in display order. */
  iface: string[];
}

export class Groups {
  readonly groups = new Map<GroupId, Group>();
  /** The innermost group each grouped agent belongs to. */
  readonly of = new Map<AgentId, GroupId>();
  next = 1;

  add(g: Omit<Group, "id">): GroupId {
    const id = this.next++;
    this.groups.set(id, { ...g, id });
    return id;
  }

  /** A group and every group containing it, innermost first. */
  chain(g: GroupId | undefined): GroupId[] {
    const out: GroupId[] = [];
    for (let c = g; c !== undefined; c = this.groups.get(c)?.parent) out.push(c);
    return out;
  }

  agentChain(a: AgentId): GroupId[] {
    return this.chain(this.of.get(a));
  }

  outermost(a: AgentId): GroupId | undefined {
    const c = this.agentChain(a);
    return c[c.length - 1];
  }

  /** Every agent inside a group, however deeply nested. */
  members(g: GroupId): AgentId[] {
    return [...this.of.keys()].filter((a) => this.agentChain(a).includes(g));
  }

  /** Groups nested anywhere inside `g`. */
  descendants(g: GroupId): GroupId[] {
    return [...this.groups.keys()].filter((h) => h !== g && this.chain(h).includes(g));
  }

  /**
   * Forget a group and every group containing it. Their agents and any other
   * groups nested inside stay, now ungrouped at that level.
   */
  dissolve(g: GroupId) {
    const gone = new Set(this.chain(g));
    for (const h of gone) this.groups.delete(h);
    for (const h of this.groups.values()) {
      while (h.parent !== undefined && gone.has(h.parent)) h.parent = this.groups.get(h.parent)?.parent;
    }
    for (const [a, h] of this.of) if (gone.has(h)) this.of.delete(a);
  }

  /** Dissolve every group that contains any of these agents. */
  dissolveAround(agents: Iterable<AgentId>) {
    for (const a of agents) {
      const g = this.of.get(a);
      if (g !== undefined) this.dissolve(g);
    }
  }

  /** Remove a group, the groups inside it, and their records of agents (the agents themselves are the caller's). */
  removeTree(g: GroupId) {
    const all = new Set([g, ...this.descendants(g)]);
    for (const [a, h] of this.of) if (all.has(h)) this.of.delete(a);
    for (const h of all) this.groups.delete(h);
  }

  toJSON(): GroupsJSON {
    return { groups: [...this.groups.values()].map((g) => ({ ...g, iface: [...g.iface] })), of: [...this.of], next: this.next };
  }

  static fromJSON(j: GroupsJSON | undefined): Groups {
    const gs = new Groups();
    if (!j) return gs;
    for (const g of j.groups) gs.groups.set(g.id, { ...g, iface: g.iface.map(([n, e]) => [n, { ...e }]) });
    for (const [a, g] of j.of) gs.of.set(a, g);
    gs.next = j.next;
    return gs;
  }

  clone(): Groups {
    return Groups.fromJSON(this.toJSON());
  }
}

export type Defs = ReadonlyMap<string, ComponentDef>;

/** Does definition `outer` use `inner`, directly or through other components? */
export function uses(defs: Defs, outer: string, inner: string, seen = new Set<string>()): boolean {
  if (outer === inner) return true;
  if (seen.has(outer)) return false;
  seen.add(outer);
  const d = defs.get(outer);
  return !!d?.groups.groups.some((g) => uses(defs, g.def, inner, seen));
}

/**
 * Copy a component into a net as a new instance. Its interface ports are
 * left unconnected for the caller to wire up.
 */
export function instantiate(net: Net, groups: Groups, def: ComponentDef, sys: System, parent?: GroupId) {
  const src = Net.fromJSON(def.net);
  const srcGroups = Groups.fromJSON(def.groups);
  const ids = new Map<AgentId, AgentId>();
  for (const a of src.agents.values()) ids.set(a.id, net.addAgent(sys.type(a.type)));
  const map = (e: End): End => (e.kind === "port" ? port(ids.get(e.agent)!, e.slot) : e);
  const iface: [string, End][] = [];
  for (const w of src.wires.values()) {
    const [a, b] = w.ends;
    if (a.kind === "free" && b.kind === "free") throw new Error(`${def.name} wires two interface ports straight together`);
    if (a.kind === "free") iface.push([a.name, map(b)]);
    else if (b.kind === "free") iface.push([b.name, map(a)]);
    else net.connect(map(a), map(b));
  }
  iface.sort((x, y) => def.iface.indexOf(x[0]) - def.iface.indexOf(y[0]));
  const g = groups.add({ def: def.id, parent, iface, collapsed: true });
  // Nested instances come along, inside the new one.
  const gmap = new Map<GroupId, GroupId>();
  const order = [...srcGroups.groups.values()].sort((x, y) => srcGroups.chain(x.id).length - srcGroups.chain(y.id).length);
  for (const h of order) {
    gmap.set(
      h.id,
      groups.add({
        def: h.def,
        parent: h.parent !== undefined ? gmap.get(h.parent) : g,
        iface: h.iface.map(([n, e]) => [n, map(e)]),
        collapsed: h.collapsed,
      }),
    );
  }
  for (const [old, nu] of ids) groups.of.set(nu, srcGroups.of.has(old) ? gmap.get(srcGroups.of.get(old)!)! : g);
  return { group: g, agents: [...ids.values()] };
}

/**
 * Make a component from some agents of a net. Every port of theirs that isn't
 * wired to another of them becomes an interface port, ordered principal
 * ports first, then by `order` (e.g. left to right on screen).
 */
export function extract(
  net: Net,
  groups: Groups,
  agents: AgentId[],
  meta: { id: string; name: string; symbol: string },
  order: (e: End) => number = () => 0,
): { def: ComponentDef; boundary: [string, End][] } {
  const inside = new Set(agents);
  const out = new Net();
  const ids = new Map<AgentId, AgentId>();
  for (const a of agents) {
    const ag = net.agent(a);
    ids.set(a, out.addAgent({ id: ag.type, name: "", symbol: "", arity: ag.wires.length - 1 }));
  }
  const map = (e: End): End => (e.kind === "port" ? port(ids.get(e.agent)!, e.slot) : e);
  const boundary: End[] = [];
  const done = new Set<string>();
  for (const a of agents) {
    net.agent(a).wires.forEach((w, slot) => {
      const here = port(a, slot);
      if (done.has(endKey(here))) return;
      done.add(endKey(here));
      const there = w === NONE ? undefined : net.partner(here);
      if (there?.kind === "port" && inside.has(there.agent)) {
        done.add(endKey(there));
        out.connect(map(here), map(there));
      } else boundary.push(here);
    });
  }
  boundary.sort((x, y) => Number(slotOf(y) === 0) - Number(slotOf(x) === 0) || order(x) - order(y));
  const iface: string[] = [];
  const pairs: [string, End][] = [];
  boundary.forEach((e, i) => {
    const name = `p${i + 1}`;
    iface.push(name);
    out.free.set(name, NONE);
    out.connect(map(e), { kind: "free", name });
    pairs.push([name, e]);
  });
  // Groups wholly inside the selection come along.
  const sub = new Groups();
  const gmap = new Map<GroupId, GroupId>();
  const whole = [...groups.groups.values()].filter((g) => groups.members(g.id).every((a) => inside.has(a)));
  whole.sort((x, y) => groups.chain(x.id).length - groups.chain(y.id).length);
  for (const g of whole) {
    const parent = g.parent !== undefined ? gmap.get(g.parent) : undefined;
    gmap.set(g.id, sub.add({ def: g.def, parent, iface: g.iface.map(([n, e]) => [n, map(e)]), collapsed: g.collapsed }));
  }
  for (const a of agents) {
    const g = groups.agentChain(a).find((h) => gmap.has(h));
    if (g !== undefined) sub.of.set(ids.get(a)!, gmap.get(g)!);
  }
  return { def: { ...meta, net: out.toJSON(), groups: sub.toJSON(), iface }, boundary: pairs };
}

const slotOf = (e: End) => (e.kind === "port" ? e.slot : -1);

/**
 * Replace an instance's insides with the current definition, keeping its
 * place in the net: whatever its interface ports were wired to outside is
 * wired to the new ones.
 */
export function refresh(net: Net, groups: Groups, g: GroupId, def: ComponentDef, sys: System) {
  const old = groups.groups.get(g)!;
  const members = new Set(groups.members(g));
  const outside = new Map<string, End>();
  for (const [name, e] of old.iface) {
    const p = net.agents.has(e.kind === "port" ? e.agent : -1) ? net.partner(e) : undefined;
    if (p && !(p.kind === "port" && members.has(p.agent))) outside.set(name, p);
  }
  for (const a of members) net.removeAgent(a);
  groups.removeTree(g);
  const fresh = instantiate(net, groups, def, sys, old.parent);
  // Keep the instance's identity.
  const ng = groups.groups.get(fresh.group)!;
  groups.groups.delete(fresh.group);
  groups.groups.set(g, { ...ng, id: g, collapsed: old.collapsed });
  for (const h of groups.groups.values()) if (h.parent === fresh.group) h.parent = g;
  for (const [a, h] of groups.of) if (h === fresh.group) groups.of.set(a, g);
  for (const [name, e] of ng.iface) {
    const o = outside.get(name);
    if (o && net.wireAt(o) === NONE) net.connect(e, o);
  }
  return fresh.agents;
}

/**
 * The net as drawn, with collapsed instances replaced by a single box each.
 * A box's ports are the instance's interface ports; boundary wires keep
 * their ids, so they still match the real net's wires.
 */
export function collapse(net: Net, groups: Groups, sys: System, defs: Defs) {
  const shown = [...groups.groups.values()].filter(
    (g) => g.collapsed && groups.chain(g.parent).every((h) => !groups.groups.get(h)?.collapsed),
  );
  if (!shown.length) return { net, sys, box: new Map<AgentId, GroupId>(), toReal: (e: End) => e };

  const view = net.clone();
  const vsys = new System();
  for (const t of sys.types.values()) vsys.types.set(t.id, t);
  for (const [k, r] of sys.rules) vsys.rules.set(k, r);

  const box = new Map<AgentId, GroupId>();
  const hiddenIn = new Map<AgentId, GroupId>();
  const slotFor = new Map<string, End>();
  const real = new Map<string, End>();
  for (const g of shown) {
    for (const a of groups.members(g.id)) hiddenIn.set(a, g.id);
    // Principal ports first, so the box points the way its main port faces.
    const ports = [...g.iface].sort((x, y) => Number(slotOf(y[1]) === 0) - Number(slotOf(x[1]) === 0));
    const def = defs.get(g.def);
    const t: AgentType = {
      id: `@g${g.id}`,
      name: def?.name ?? "component",
      symbol: def?.symbol ?? "?",
      arity: Math.max(0, ports.length - 1),
      box: true,
    };
    vsys.types.set(t.id, t);
    const id = -g.id;
    view.addAgent(t, id);
    box.set(id, g.id);
    ports.forEach(([, e], i) => {
      slotFor.set(endKey(e), port(id, i));
      real.set(endKey(port(id, i)), e);
    });
  }
  // Rewire: drop hidden agents, then join their boundary wires to the boxes.
  const boundary: { id: number; a: End; b: End }[] = [];
  for (const w of net.wires.values()) {
    const [a, b] = w.ends;
    const ha = a.kind === "port" ? hiddenIn.get(a.agent) : undefined;
    const hb = b.kind === "port" ? hiddenIn.get(b.agent) : undefined;
    if (ha === undefined && hb === undefined) continue;
    if (ha !== undefined && ha === hb) continue;
    const ma = ha !== undefined ? slotFor.get(endKey(a)) : a;
    const mb = hb !== undefined ? slotFor.get(endKey(b)) : b;
    if (ma && mb) boundary.push({ id: w.id, a: ma, b: mb });
  }
  for (const a of hiddenIn.keys()) view.removeAgent(a);
  for (const { id, a, b } of boundary) view.connect(a, b, id);
  return { net: view, sys: vsys, box, toReal: (e: End) => real.get(endKey(e)) ?? e };
}

export type View = ReturnType<typeof collapse>;
