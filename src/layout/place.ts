import { type AgentId, type Net, endKey, port } from "../core/net";
import { G, type Orient, type Placement, shape } from "./geometry";
import { type Pins, type Routed, crossings, length, route } from "./route";

/**
 * Automatic placement.
 *
 * Every agent has exactly one principal port. Following "whatever my
 * principal port is plugged into" from each agent gives it at most one
 * parent, so a net falls apart into trees whose roots end at a free port,
 * at an active pair (two roots tip to tip), or nowhere yet. (A loop of
 * parents is a vicious circle; we cut it at one agent.)
 *
 * Each tree is drawn with its children stacked behind its root, every aux
 * port getting its own column so wires can run straight. A unit is a lone
 * tree (pointing up or down) or an active pair (one tree pointing down from
 * above, one pointing up from below).
 *
 * Units are then stacked in levels: when a unit's upward wire meets
 * another's downward wire, the second goes above the first so the two face
 * each other and join with a short S-curve, Lafont-style. Within a level,
 * units slide sideways to line up with what they connect to. Finally we
 * try flipping units and keep whatever routes with fewer crossings and
 * shorter wires.
 */

export interface AutoLayout {
  placement: Placement;
  columns: Map<string, number>;
  routed: Routed;
}

interface Tree {
  /** [agent, x offset, depth] relative to the root's tip. */
  nodes: [AgentId, number, number][];
  /** Columns of the loose aux wires: [endKey, x offset]. */
  cols: [string, number][];
  l: number;
  r: number;
}

interface Unit {
  roots: [AgentId] | [AgentId, AgentId];
  trees: Tree[];
  /** Lone tree: point up instead of down. Pair: put the second tree on top. */
  flip: boolean;
}

/** A unit drawn at the origin: the tip of a lone tree, or the middle of a pair. */
interface UnitGeom {
  nodes: [AgentId, number, number, Orient][];
  cols: [string, number, Orient][];
  l: number;
  r: number;
  top: number;
  bottom: number;
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

export interface AutoLayoutOptions {
  pins?: Pins;
  /**
   * The previous layout of this net, if any. Parts that are still there keep
   * their orientation and roughly their place, so a reduction step doesn't
   * reshuffle everything around it.
   */
  prev?: Placement;
}

export function autoLayout(net: Net, opts: AutoLayoutOptions = {}): AutoLayout {
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

  // Trees whose loose ends mostly go to free ports read better at the
  // bottom of a pair, where their wires drop straight out.
  const freeStubs = (t: Tree) =>
    t.cols.filter(([k]) => {
      const [a, s] = k.split(":").map(Number);
      return net.partner(port(a!, s!))?.kind === "free";
    }).length;
  for (const u of units) if (u.trees.length === 2) u.flip = freeStubs(u.trees[0]!) > freeStubs(u.trees[1]!);
  // Keep whatever way surviving units faced before. A pair counts as surviving
  // only if both its agents were already drawn, tip to tip; a pair a step has
  // just made is laid out afresh, whichever way its agents pointed before.
  for (const u of units) {
    const [a, b] = u.roots.map((id) => opts.prev?.get(id));
    if (!a || (u.roots.length === 2 && (!b || a.orient === b.orient))) continue;
    u.flip = a.orient === "up";
  }
  // A lone tree whose root is pinned to the top edge should point up at it.
  for (const u of units) {
    if (u.trees.length !== 1) continue;
    const p = net.partner(port(u.roots[0], 0));
    if (p?.kind === "free" && opts.pins?.top.includes(p.name)) u.flip = true;
  }

  const cost = (l: AutoLayout) => {
    const r = l.routed;
    let c = crossings(r.wires) * 300 + r.arounds * 400 + [...r.wires.values()].reduce((s, p) => s + length(p), 0);
    if (opts.prev)
      for (const [id, p] of l.placement) {
        const q = opts.prev.get(id);
        if (q) c += 0.04 * (Math.abs(p.x - q.x) + Math.abs(p.y - q.y)) + (p.orient !== q.orient ? 12 : 0);
      }
    return c;
  };

  let best = arrange(net, units, opts.pins, opts.prev);
  if (units.length <= 24 && net.wires.size <= 300) {
    let bestCost = cost(best);
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (const u of units) {
        // A lone tree rooted at a free port, or nothing, can point either way.
        u.flip = !u.flip;
        const l = arrange(net, units, opts.pins, opts.prev);
        const c = cost(l);
        if (c < bestCost - 0.5) [best, bestCost, improved] = [l, c, true];
        else u.flip = !u.flip;
      }
      if (!improved) break;
    }
  }
  return best;
}

function geom(net: Net, u: Unit): UnitGeom {
  const g: UnitGeom = { nodes: [], cols: [], l: Infinity, r: -Infinity, top: 0, bottom: 0 };
  const add = (t: Tree, tipY: number, pointing: Orient) => {
    const s = pointing === "down" ? 1 : -1;
    for (const [id, dx, d] of t.nodes) {
      const h = shape(net.agent(id).wires.length - 1).h;
      const y = tipY - s * (d * G.layerH + h / 2);
      g.nodes.push([id, s * dx, y, pointing]);
      g.top = Math.min(g.top, y - h / 2);
      g.bottom = Math.max(g.bottom, y + h / 2);
    }
    for (const [k, dx] of t.cols) g.cols.push([k, s * dx, pointing === "down" ? "up" : "down"]);
    g.l = Math.min(g.l, s > 0 ? t.l : -t.r);
    g.r = Math.max(g.r, s > 0 ? t.r : -t.l);
  };
  if (u.trees.length === 1) add(u.trees[0]!, 0, u.flip ? "up" : "down");
  else {
    const [top, bottom] = u.flip ? [u.trees[1]!, u.trees[0]!] : [u.trees[0]!, u.trees[1]!];
    add(top, -G.pairGap / 2, "down");
    add(bottom, G.pairGap / 2, "up");
  }
  return g;
}

function arrange(net: Net, units: Unit[], pins?: Pins, prev?: Placement): AutoLayout {
  const geoms = units.map((u) => geom(net, u));
  // Where each unit sat last time, judged by its agents that were there.
  const prevX = geoms.map((g) => {
    const xs = g.nodes.flatMap(([id, dx]) => {
      const q = prev?.get(id);
      return q ? [q.x - dx] : [];
    });
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : undefined;
  });

  // Which unit each loose wire end belongs to, and which way it leaves.
  const stub = new Map<string, { unit: number; dx: number; dir: Orient }>();
  geoms.forEach((g, i) => g.cols.forEach(([k, dx, dir]) => stub.set(k, { unit: i, dx, dir })));

  // above[a] holds units that should sit above a; links are all connections for alignment.
  const above = units.map(() => new Set<number>());
  const below = units.map(() => new Set<number>());
  const links: { a: number; b: number; da: number; db: number; facing: boolean }[] = [];
  for (const w of net.wires.values()) {
    const [e0, e1] = w.ends;
    if (e0.kind !== "port" || e1.kind !== "port") continue;
    const s0 = stub.get(endKey(e0));
    const s1 = stub.get(endKey(e1));
    if (!s0 || !s1 || s0.unit === s1.unit) continue;
    const facing = s0.dir !== s1.dir;
    if (facing) {
      const [lo, hi] = s0.dir === "up" ? [s0.unit, s1.unit] : [s1.unit, s0.unit];
      above[lo]!.add(hi);
      below[hi]!.add(lo);
    }
    links.push({ a: s0.unit, b: s1.unit, da: s0.dx, db: s1.dx, facing });
  }

  // Levels, counted downwards. Longest path from the top, ignoring edges
  // that would close a cycle.
  const level = units.map(() => 0);
  const done = units.map(() => 0);
  const visit = (u: number): number => {
    if (done[u] === 2) return level[u]!;
    if (done[u] === 1) return -1; // cycle: ignore this edge
    done[u] = 1;
    let l = 0;
    for (const a of above[u]!) {
      const la = visit(a);
      if (la >= 0) l = Math.max(l, la + 1);
    }
    done[u] = 2;
    return (level[u] = l);
  };
  units.forEach((_, u) => visit(u));
  // Pull units that only hang above others down to sit just above them.
  for (let pass = 0; pass < 2; pass++) {
    units.forEach((_, u) => {
      if (above[u]!.size || !below[u]!.size) return;
      level[u] = Math.min(...[...below[u]!].map((b) => level[b]!)) - 1;
    });
  }
  // Units with no vertical ties join the level of something they connect to.
  for (const { a, b, facing } of links) {
    if (facing) continue;
    if (!above[a]!.size && !below[a]!.size) level[a] = level[b]!;
    else if (!above[b]!.size && !below[b]!.size) level[b] = level[a]!;
  }
  const minLevel = Math.min(0, ...level);
  const levels: number[][] = [];
  level.forEach((l, u) => (levels[l - minLevel] ??= []).push(u));
  for (let i = 0; i < levels.length; i++) levels[i] ??= [];

  // Horizontal positions: start packed, then repeatedly slide units to line
  // up with what they connect to, keeping order and spacing within a level.
  const x = units.map(() => 0);
  const pack = (lv: number[], want: number[]) => {
    const order = [...lv].sort((a, b) => want[a]! - want[b]! || a - b);
    let prevRight = -Infinity;
    for (const u of order) {
      x[u] = Math.max(want[u]!, prevRight + G.unitGap - geoms[u]!.l);
      prevRight = x[u]! + geoms[u]!.r;
    }
    // Recentre the level on what it wanted, so pushing doesn't drift rightwards.
    const shift = order.reduce((s, u) => s + want[u]! - x[u]!, 0) / Math.max(1, order.length);
    for (const u of order) x[u] = x[u]! + shift;
  };
  {
    let cursor = 0;
    for (const lv of levels) {
      cursor = 0;
      for (const u of lv) {
        x[u] = prevX[u] ?? cursor - geoms[u]!.l;
        cursor = Math.max(cursor, x[u]! + geoms[u]!.r + G.unitGap);
      }
      pack(lv, [...x]);
    }
  }
  for (let it = 0; it < 8; it++) {
    const want = [...x];
    const sum = units.map(() => 0);
    const weight = units.map(() => 0);
    for (const { a, b, da, db, facing } of links) {
      const w = facing ? 1 : 0.25;
      sum[a]! += w * (x[b]! + db - da);
      weight[a]! += w;
      sum[b]! += w * (x[a]! + da - db);
      weight[b]! += w;
    }
    units.forEach((_, u) => {
      const px = prevX[u];
      if (px !== undefined) {
        sum[u]! += 0.25 * px;
        weight[u]! += 0.25;
      }
      if (weight[u]) want[u] = sum[u]! / weight[u]!;
    });
    for (const lv of levels) pack(lv, want);
  }

  // Vertical positions: stack the levels with room between them for the
  // wires that cross over.
  const y = units.map(() => 0);
  let base = 0;
  levels.forEach((lv, i) => {
    if (!lv.length) return;
    const top = Math.min(...lv.map((u) => geoms[u]!.top));
    if (i > 0) {
      const prev = levels[i - 1]!;
      const prevBottom = prev.length ? Math.max(...prev.map((u) => y[u]! + geoms[u]!.bottom)) : base;
      base = prevBottom + G.layerH * 1.1 - top;
    }
    for (const u of lv) y[u] = base;
  });

  // Line the whole thing up with where its surviving agents were.
  let sx = 0;
  let sy = 0;
  if (prev) {
    let n = 0;
    geoms.forEach((g, u) =>
      g.nodes.forEach(([id, dx, dy]) => {
        const q = prev.get(id);
        if (!q) return;
        sx += q.x - (x[u]! + dx);
        sy += q.y - (y[u]! + dy);
        n++;
      }),
    );
    if (n) [sx, sy] = [sx / n, sy / n];
  }

  const placement: Placement = new Map();
  const columns = new Map<string, number>();
  geoms.forEach((g, u) => {
    for (const [id, dx, dy, orient] of g.nodes) placement.set(id, { x: x[u]! + dx + sx, y: y[u]! + dy + sy, orient });
    for (const [k, dx] of g.cols) columns.set(k, x[u]! + dx + sx);
  });
  return { placement, columns, routed: route(net, placement, { columns, pins }) };
}
