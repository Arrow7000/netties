import { type AgentId, type Net, endKey, port } from "../core/net";
import { G, type Placement, shape } from "./geometry";
import { type Gap, type Routed, crossings, length, route } from "./route";

/**
 * Automatic placement.
 *
 * Every agent has exactly one principal port. Following "whatever my
 * principal port is plugged into" from each agent gives it at most one
 * parent, so a net falls apart into trees whose roots end at a free port,
 * at an active pair (two roots tip to tip), or nowhere yet. (A loop of
 * parents is a vicious circle; we cut it at one agent.)
 *
 * Each tree is drawn with its root at the bottom pointing down and its
 * children stacked above, every aux port getting its own column so wires
 * can run straight up. An active pair is two trees facing each other: one
 * pointing down from above, one rotated to point up from below. These
 * units sit side by side, and the router joins the remaining wires with
 * caps, cups and lanes in the gaps between units.
 */

export interface AutoLayout {
  placement: Placement;
  columns: Map<string, number>;
  routed: Routed;
}

interface Tree {
  /** [agent, x offset, depth] relative to the root's tip. */
  nodes: [AgentId, number, number][];
  cols: [string, number][];
  l: number;
  r: number;
}

interface Unit {
  roots: [AgentId] | [AgentId, AgentId];
  trees: Tree[];
  /** For pairs: put the second root's tree on top instead of the first's. */
  flip: boolean;
}

export function structure(net: Net) {
  const parent = new Map<AgentId, AgentId>();
  for (const a of net.agents.values()) {
    const p = net.partner(port(a.id, 0));
    if (p?.kind === "port" && p.slot > 0) parent.set(a.id, p.agent);
  }
  // Cut vicious circles.
  const state = new Map<AgentId, 1 | 2>();
  for (const start of net.agents.keys()) {
    const path: AgentId[] = [];
    let a: AgentId | undefined = start;
    while (a !== undefined && !state.has(a)) {
      state.set(a, 1);
      path.push(a);
      a = parent.get(a);
    }
    if (a !== undefined && state.get(a) === 1) {
      const cycle = path.slice(path.indexOf(a));
      parent.delete(Math.min(...cycle));
    }
    path.forEach((p) => state.set(p, 2));
  }
  const children = new Map<AgentId, (AgentId | undefined)[]>();
  for (const [c, p] of parent) {
    const slot = (net.partner(port(c, 0)) as { slot: number }).slot;
    const list = children.get(p) ?? [];
    list[slot] = c;
    children.set(p, list);
  }
  const roots = [...net.agents.keys()].filter((a) => !parent.has(a));
  return { parent, children, roots };
}

export function autoLayout(net: Net): AutoLayout {
  const { children, roots } = structure(net);
  const arity = (id: AgentId) => net.agent(id).wires.length - 1;

  const lay = (a: AgentId): Tree => {
    const n = arity(a);
    const sh = shape(n);
    if (n === 0) return { nodes: [[a, 0, 0]], cols: [], l: -sh.w / 2, r: sh.w / 2 };
    const kids = children.get(a) ?? [];
    type Part = { l: number; r: number; anchor: number; sub?: Tree };
    const parts: Part[] = [];
    let cursor = 0;
    for (let s = 1; s <= n; s++) {
      const c = kids[s];
      const prev = parts[parts.length - 1];
      if (c !== undefined) {
        const sub = lay(c);
        if (prev) cursor += G.wireGap;
        parts.push({ l: cursor, r: cursor + sub.r - sub.l, anchor: cursor - sub.l, sub });
      } else {
        if (prev?.sub) cursor += G.wireGap / 2;
        parts.push({ l: cursor, r: cursor + G.portGap, anchor: cursor + G.portGap / 2 });
      }
      cursor = parts[parts.length - 1]!.r;
    }
    const center = (parts[0]!.anchor + parts[parts.length - 1]!.anchor) / 2;
    const tree: Tree = { nodes: [[a, 0, 0]], cols: [], l: -sh.w / 2, r: sh.w / 2 };
    parts.forEach((p, i) => {
      const slot = i + 1;
      tree.l = Math.min(tree.l, p.l - center);
      tree.r = Math.max(tree.r, p.r - center);
      if (p.sub) {
        const dx = p.anchor - center;
        for (const [id, x, d] of p.sub.nodes) tree.nodes.push([id, x + dx, d + 1]);
        for (const [k, x] of p.sub.cols) tree.cols.push([k, x + dx]);
      } else {
        const px = (slot - (n + 1) / 2) * G.portGap;
        const lo = p.l - center + G.wireGap / 2;
        const hi = p.r - center - G.wireGap / 2;
        tree.cols.push([endKey(port(a, slot)), Math.min(hi, Math.max(lo, px))]);
      }
    });
    return tree;
  };

  // Group roots into units: active pairs, and lone trees.
  const units: Unit[] = [];
  const seen = new Set<AgentId>();
  for (const r of roots) {
    if (seen.has(r)) continue;
    seen.add(r);
    const p = net.partner(port(r, 0));
    if (p?.kind === "port" && p.slot === 0 && p.agent !== r) {
      seen.add(p.agent);
      units.push({ roots: [r, p.agent], trees: [lay(r), lay(p.agent)], flip: false });
    } else units.push({ roots: [r], trees: [lay(r)], flip: false });
  }

  // Trees whose loose ends mostly go to free ports read better at the bottom,
  // where their wires can drop straight down.
  const freeStubs = (t: Tree) =>
    t.cols.filter(([k]) => {
      const [a, s] = k.split(":").map(Number);
      return net.partner(port(a!, s!))?.kind === "free";
    }).length;
  for (const u of units) if (u.trees.length === 2) u.flip = freeStubs(u.trees[0]!) > freeStubs(u.trees[1]!);

  let order = initialOrder(net, units);
  let best = arrange(net, order, units);

  // Local search over unit order and pair orientation, while it's cheap.
  if (units.length > 1 && units.length <= 14 && net.wires.size <= 200) {
    let bestCost = cost(best.routed);
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      const tryCandidate = (cand: number[]) => {
        const l = arrange(net, cand, units);
        const c = cost(l.routed);
        if (c < bestCost - 0.5) [best, bestCost, order, improved] = [l, c, cand, true];
        return c;
      };
      for (let i = 0; i + 1 < order.length; i++) {
        const cand = [...order];
        [cand[i], cand[i + 1]] = [cand[i + 1]!, cand[i]!];
        tryCandidate(cand);
      }
      for (const u of units) {
        if (u.trees.length !== 2) continue;
        u.flip = !u.flip;
        const before = bestCost;
        tryCandidate(order);
        if (bestCost === before) u.flip = !u.flip;
      }
      if (!improved) break;
    }
  }
  return best;
}

const cost = (r: Routed) => crossings(r.wires) * 400 + [...r.wires.values()].reduce((s, p) => s + length(p), 0);

/** Order units so that connected ones sit next to each other. */
function initialOrder(net: Net, units: Unit[]): number[] {
  const unitOf = new Map<AgentId, number>();
  const { parent } = structure(net);
  const rootOf = (a: AgentId): AgentId => {
    let r = a;
    for (let p = parent.get(r); p !== undefined; p = parent.get(r)) r = p;
    return r;
  };
  units.forEach((u, i) => u.roots.forEach((r) => unitOf.set(r, i)));
  const adj = units.map(() => new Map<number, number>());
  for (const w of net.wires.values()) {
    const [a, b] = w.ends;
    if (a.kind !== "port" || b.kind !== "port") continue;
    const ua = unitOf.get(rootOf(a.agent))!;
    const ub = unitOf.get(rootOf(b.agent))!;
    if (ua === ub) continue;
    adj[ua]!.set(ub, (adj[ua]!.get(ub) ?? 0) + 1);
    adj[ub]!.set(ua, (adj[ub]!.get(ua) ?? 0) + 1);
  }
  const order: number[] = [];
  const placed = new Set<number>();
  for (let s = 0; s < units.length; s++) {
    if (placed.has(s)) continue;
    // Depth-first, following the strongest connections first.
    const stack = [s];
    while (stack.length) {
      const u = stack.pop()!;
      if (placed.has(u)) continue;
      placed.add(u);
      order.push(u);
      const next = [...adj[u]!].filter(([v]) => !placed.has(v)).sort((x, y) => x[1] - y[1]);
      stack.push(...next.map(([v]) => v));
    }
  }
  return order;
}

/** Place units left to right, route, then widen any gap that needs room for more lanes. */
function arrange(net: Net, order: number[], units: Unit[]): AutoLayout {
  const widths = order.map(() => G.unitGap);
  let result: AutoLayout | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const placement: Placement = new Map();
    const columns = new Map<string, number>();
    const extents: [number, number][] = [];
    let cursor = 0;
    order.forEach((ui, i) => {
      const u = units[ui]!;
      const [top, bottom] = u.flip ? [u.trees[1], u.trees[0]] : [u.trees[0], u.trees[1]];
      const l = Math.min(top!.l, bottom ? -bottom.r : Infinity);
      const r = Math.max(top!.r, bottom ? -bottom.l : -Infinity);
      const x0 = cursor - l;
      const tipY = bottom ? -G.pairGap / 2 : 0;
      for (const [id, dx, d] of top!.nodes) {
        const h = shape(net.agent(id).wires.length - 1).h;
        placement.set(id, { x: x0 + dx, y: tipY - d * G.layerH - h / 2, orient: "down" });
      }
      for (const [k, dx] of top!.cols) columns.set(k, x0 + dx);
      if (bottom) {
        for (const [id, dx, d] of bottom.nodes) {
          const h = shape(net.agent(id).wires.length - 1).h;
          placement.set(id, { x: x0 - dx, y: G.pairGap / 2 + d * G.layerH + h / 2, orient: "up" });
        }
        for (const [k, dx] of bottom.cols) columns.set(k, x0 - dx);
      }
      extents.push([cursor, cursor + r - l]);
      cursor += r - l + (widths[i] ?? G.unitGap);
    });
    const gaps: Gap[] = [];
    if (extents.length) {
      gaps.push({ x0: -Infinity, x1: extents[0]![0] - G.wireGap / 2 });
      for (let i = 1; i < extents.length; i++) gaps.push({ x0: extents[i - 1]![1], x1: extents[i]![0] });
      gaps.push({ x0: extents[extents.length - 1]![1] + G.wireGap / 2, x1: Infinity });
    }
    const routed = route(net, placement, { columns, gaps: gaps.length ? gaps : undefined });
    result = { placement, columns, routed };
    let widened = false;
    for (let i = 0; i < order.length - 1; i++) {
      const need = (routed.laneCount[i + 1]! + 1) * G.wireGap * 1.4;
      if (need > widths[i]!) {
        widths[i] = need;
        widened = true;
      }
    }
    if (!widened) break;
  }
  return result!;
}
