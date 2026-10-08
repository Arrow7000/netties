import { type End, type Net, NONE, type WireId, endKey } from "../core/net";
import { type Box, G, type Placement, type Pt, type Terminal, boxOf, portPos } from "./geometry";

/**
 * Wire routing in the style of Lafont's figures. Wires leave ports
 * vertically and only ever run vertically or horizontally between rounded
 * corners (the renderer turns short jogs into S-bends). Each wire falls into
 * one of a few shapes:
 *
 * - facing ports (one pointing up at one pointing down above it) are joined
 *   by a smooth S-curve, so two of them crossing make Lafont's X;
 * - two ports pointing up are joined by a cap ∩ that clears everything beneath it;
 * - two ports pointing down are joined by a cup ∪;
 * - ports pointing away from each other are joined by going round the side,
 *   down a vertical lane between parts of the net;
 * - free ports sit along the top or bottom edge, whichever way the port faces.
 *
 * Caps (and cups) are placed narrowest first, so wider ones nest outside them.
 */

export interface Routed {
  wires: Map<WireId, Pt[]>;
  /** Where each free port sits, and which way its wire leaves the net. */
  free: Map<string, Terminal>;
  bounds: Box;
  /** How many lanes each gap ended up holding, index-aligned with the gaps used. */
  laneCount: number[];
  gaps: Gap[];
  /** How many wires had to go round the side. */
  arounds: number;
}

/** A vertical strip with no agents in it, usable for lanes. Outer gaps are unbounded on one side. */
export interface Gap {
  x0: number;
  x1: number;
}

export interface RouteOptions {
  /** Preferred columns for wires leaving particular ports, keyed by endKey. */
  columns?: Map<string, number>;
  /** Gaps to run lanes through. Computed from agent positions if not given. */
  gaps?: Gap[];
}

interface Leg {
  /** Points from the port up to (and including) where the wire starts its free run. */
  prefix: Pt[];
  t: Terminal;
}

type Job =
  | { kind: "direct"; id: WireId; a: Leg; b: Leg }
  | { kind: "cap" | "cup"; id: WireId; a: Leg; b: Leg }
  | { kind: "around"; id: WireId; up: Leg; down: Leg; upFirst: boolean }
  | { kind: "drop"; id: WireId; leg: Leg; free: string; legFirst: boolean }
  | { kind: "rise"; id: WireId; leg: Leg; free: string; legFirst: boolean }
  | { kind: "bare"; id: WireId; free: [string, string] };

/** A horizontal run waiting for its height. */
interface Span {
  x0: number;
  x1: number;
  /** The run must be at least this far past these y values (above for caps, below for cups). */
  from: number;
  y: number;
}

const JOG = 12;

export function route(net: Net, placement: Placement, opts: RouteOptions = {}): Routed {
  const arity = (id: number) => net.agent(id).wires.length - 1;
  const boxes: Box[] = [];
  for (const [id, p] of placement) if (net.agents.has(id)) boxes.push(boxOf(p, arity(id)));

  const leg = (e: Extract<End, { kind: "port" }>): Leg => {
    const p = placement.get(e.agent);
    if (!p) throw new Error(`agent ${e.agent} has no position`);
    const t = portPos(p, arity(e.agent), e.slot);
    const col = opts.columns?.get(endKey(e));
    if (col === undefined || Math.abs(col - t.x) < 0.5) return { prefix: [t], t };
    const s = t.dir === "up" ? -1 : 1;
    return { prefix: [t], t: { x: col, y: t.y + s * 2 * JOG, dir: t.dir, s: true } };
  };

  // Classify every wire.
  const jobs: Job[] = [];
  for (const w of net.wires.values()) {
    const [e0, e1] = w.ends;
    if (e0.kind === "free" && e1.kind === "free") {
      jobs.push({ kind: "bare", id: w.id, free: [e0.name, e1.name] });
      continue;
    }
    if (e0.kind === "free" || e1.kind === "free") {
      const legFirst = e0.kind === "port";
      const p = (legFirst ? e0 : e1) as Extract<End, { kind: "port" }>;
      const f = (legFirst ? e1 : e0) as Extract<End, { kind: "free" }>;
      const l = leg(p);
      jobs.push({ kind: l.t.dir === "down" ? "drop" : "rise", id: w.id, leg: l, free: f.name, legFirst });
      continue;
    }
    const a = leg(e0);
    const b = leg(e1);
    if (a.t.dir !== b.t.dir) {
      const [up, down] = a.t.dir === "up" ? [a, b] : [b, a];
      if (down.t.y < up.t.y - 1) jobs.push({ kind: "direct", id: w.id, a, b });
      else jobs.push({ kind: "around", id: w.id, up, down, upFirst: a === up });
    } else jobs.push({ kind: a.t.dir === "up" ? "cap" : "cup", id: w.id, a, b });
  }

  // Lanes for wires that have to go round the side.
  const gaps = opts.gaps ?? gapsBetween(boxes);
  const laneUsers: { job: Job; x: number }[][] = gaps.map(() => []);
  const gapX = (g: Gap) =>
    Number.isFinite(g.x0) && Number.isFinite(g.x1) ? (g.x0 + g.x1) / 2 : Number.isFinite(g.x1) ? g.x1 : g.x0;
  for (const job of jobs) {
    let xs: number[];
    if (job.kind === "around") xs = [job.up.t.x, job.down.t.x];
    else continue;
    let best = 0;
    let bestCost = Infinity;
    gaps.forEach((g, i) => {
      const gx = gapX(g);
      const cost = xs.reduce((s, x) => s + Math.abs(x - gx), 0) + laneUsers[i]!.length * G.wireGap * 0.5;
      if (cost < bestCost) [best, bestCost] = [i, cost];
    });
    laneUsers[best]!.push({ job, x: xs.reduce((s, x) => s + x, 0) / xs.length });
  }
  const laneX = new Map<WireId, number>();
  gaps.forEach((g, i) => {
    const users = laneUsers[i]!;
    const leftOuter = !Number.isFinite(g.x0);
    // Wires whose ports are further from the gap take the outer lanes, so
    // their caps nest outside the nearer ones.
    users.sort((u, v) => (leftOuter ? u.x - v.x : Number.isFinite(g.x1) ? u.x - v.x : v.x - u.x));
    users.forEach((u, k) => {
      let x: number;
      if (leftOuter) x = g.x1 - G.wireGap * (k + 1);
      else if (!Number.isFinite(g.x1)) x = g.x0 + G.wireGap * (k + 1);
      else x = g.x0 + ((g.x1 - g.x0) * (k + 1)) / (users.length + 1);
      laneX.set(u.job.id, x);
    });
  });

  // Horizontal runs. Caps and cups are placed separately, narrowest first.
  const caps = new Map<WireId, Span>();
  const cups = new Map<WireId, Span>();
  const span = (xa: number, xb: number, from: number): Span => ({
    x0: Math.min(xa, xb),
    x1: Math.max(xa, xb),
    from,
    y: from,
  });
  for (const job of jobs) {
    if (job.kind === "cap") caps.set(job.id, span(job.a.t.x, job.b.t.x, Math.min(job.a.t.y, job.b.t.y)));
    if (job.kind === "cup") cups.set(job.id, span(job.a.t.x, job.b.t.x, Math.max(job.a.t.y, job.b.t.y)));
    if (job.kind === "around") {
      const lx = laneX.get(job.id)!;
      caps.set(job.id, span(job.up.t.x, lx, job.up.t.y));
      cups.set(job.id, span(lx, job.down.t.x, job.down.t.y));
    }
  }
  settle(caps, boxes, -1);
  settle(cups, boxes, +1);

  // Free ports sit on common lines above and below everything.
  let bottom = -Infinity;
  let top = Infinity;
  for (const b of boxes) [top, bottom] = [Math.min(top, b.y0), Math.max(bottom, b.y1)];
  for (const c of cups.values()) bottom = Math.max(bottom, c.y);
  for (const c of caps.values()) top = Math.min(top, c.y);
  for (const job of jobs) {
    if (job.kind === "drop") bottom = Math.max(bottom, job.leg.t.y);
    if (job.kind === "rise") top = Math.min(top, job.leg.t.y);
  }
  bottom = (Number.isFinite(bottom) ? bottom : 0) + G.freeMargin;
  top = (Number.isFinite(top) ? top : 0) - G.freeMargin;

  const wires = new Map<WireId, Pt[]>();
  const free = new Map<string, Terminal>();
  /** a's port, out along a, through `mid`, then in along b to its port. */
  const join = (a: Leg, mid: Pt[], b: Leg, smooth = false): Pt[] => [
    ...a.prefix,
    a.t,
    ...mid,
    { ...b.t, s: smooth },
    ...b.prefix.map((p, i) => ({ ...p, s: i === 0 && !!b.t.s })).reverse(),
  ];
  let bareX = Math.max(0, ...boxes.map((b) => b.x1)) + G.unitGap;
  for (const job of jobs) {
    switch (job.kind) {
      case "direct": {
        wires.set(job.id, join(job.a, [], job.b, true));
        break;
      }
      case "cap":
      case "cup": {
        const y = (job.kind === "cap" ? caps : cups).get(job.id)!.y;
        wires.set(job.id, join(job.a, [{ x: job.a.t.x, y }, { x: job.b.t.x, y }], job.b));
        break;
      }
      case "around": {
        const lx = laneX.get(job.id)!;
        const cy = caps.get(job.id)!.y;
        const uy = cups.get(job.id)!.y;
        const pts = join(
          job.up,
          [
            { x: job.up.t.x, y: cy },
            { x: lx, y: cy },
            { x: lx, y: uy },
            { x: job.down.t.x, y: uy },
          ],
          job.down,
        );
        wires.set(job.id, job.upFirst ? pts : reversePath(pts));
        break;
      }
      case "drop":
      case "rise": {
        const t = job.leg.t;
        const pts: Pt[] = [...job.leg.prefix, t, { x: t.x, y: job.kind === "drop" ? bottom : top }];
        free.set(job.free, { ...pts[pts.length - 1]!, dir: job.kind === "drop" ? "down" : "up" });
        wires.set(job.id, job.legFirst ? pts : reversePath(pts));
        break;
      }
      case "bare": {
        const top = bottom - G.layerH / 2;
        const a = { x: bareX, y: bottom };
        const b = { x: bareX + G.portGap, y: bottom };
        bareX += G.portGap * 2;
        free.set(job.free[0], { ...a, dir: "down" });
        free.set(job.free[1], { ...b, dir: "down" });
        wires.set(job.id, [a, { x: a.x, y: top }, { x: b.x, y: top }, b]);
        break;
      }
    }
  }

  // Free ports with nothing attached still need a spot.
  for (const [name, w] of net.free) {
    if (free.has(name) || w !== NONE) continue;
    free.set(name, { x: bareX, y: bottom, dir: "down" });
    bareX += G.portGap;
  }

  return { wires, free, bounds: boundsOf(boxes, wires), laneCount: laneUsers.map((u) => u.length), gaps, arounds: jobs.filter((j) => j.kind === "around").length };
}

/** The same path walked the other way, keeping each S-curve on its segment. */
export function reversePath(pts: Pt[]): Pt[] {
  const r = [...pts].reverse();
  return r.map((p, k) => ({ x: p.x, y: p.y, s: k > 0 && !!r[k - 1]!.s }));
}

/**
 * Give each span a height clear of the agents and earlier spans beneath it.
 * `dir` is -1 for caps (moving up) and +1 for cups (moving down).
 */
function settle(spans: Map<WireId, Span>, boxes: Box[], dir: -1 | 1) {
  const placed: Box[] = [];
  const order = [...spans.values()].sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0) || dir * (b.from - a.from));
  const pad = G.wireGap * 0.6;
  for (const s of order) {
    let y = s.from + dir * Math.max(G.wireGap, Math.min(G.radius, (s.x1 - s.x0) / 2));
    const obstacles = [...boxes, ...placed].filter((b) => b.x1 > s.x0 - pad && b.x0 < s.x1 + pad);
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of obstacles) {
        if (y > b.y0 - G.wireGap + 0.01 && y < b.y1 + G.wireGap - 0.01) {
          y = dir < 0 ? b.y0 - G.wireGap : b.y1 + G.wireGap;
          moved = true;
        }
      }
    }
    s.y = y;
    placed.push({ x0: s.x0, x1: s.x1, y0: y, y1: y });
  }
}

/** Vertical strips free of agents, including the unbounded strips either side. */
export function gapsBetween(boxes: Box[]): Gap[] {
  if (!boxes.length) return [{ x0: -Infinity, x1: 0 }];
  const iv = boxes.map((b) => [b.x0 - G.wireGap, b.x1 + G.wireGap] as const).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const gaps: Gap[] = [{ x0: -Infinity, x1: merged[0]![0] }];
  for (let i = 1; i < merged.length; i++) gaps.push({ x0: merged[i - 1]![1], x1: merged[i]![0] });
  gaps.push({ x0: merged[merged.length - 1]![1], x1: Infinity });
  return gaps;
}

function boundsOf(boxes: Box[], wires: Map<WireId, Pt[]>): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const x of boxes) {
    b.x0 = Math.min(b.x0, x.x0);
    b.y0 = Math.min(b.y0, x.y0);
    b.x1 = Math.max(b.x1, x.x1);
    b.y1 = Math.max(b.y1, x.y1);
  }
  for (const pts of wires.values())
    for (const p of pts) {
      b.x0 = Math.min(b.x0, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x);
      b.y1 = Math.max(b.y1, p.y);
    }
  if (!Number.isFinite(b.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return b;
}

/** Number of places where two different wires cross. */
export function crossings(wires: Map<WireId, Pt[]>): number {
  const segs: [WireId, Pt, Pt][] = [];
  for (const [id, pts] of wires) for (let i = 1; i < pts.length; i++) segs.push([id, pts[i - 1]!, pts[i]!]);
  let n = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const [ia, a0, a1] = segs[i]!;
      const [ib, b0, b1] = segs[j]!;
      if (ia !== ib && intersects(a0, a1, b0, b1)) n++;
    }
  return n;
}

function intersects(p: Pt, p2: Pt, q: Pt, q2: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(q, q2, p);
  const d2 = d(q, q2, p2);
  const d3 = d(p, p2, q);
  const d4 = d(p, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function length(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return n;
}
