import { type AgentId, type End, type Net, NONE, type WireId, endKey } from "../core/net";
import {
  type Box,
  G,
  type Placement,
  type Pt,
  type Terminal,
  agentOutline,
  boxOf,
  portPos,
  segmentHitsPolygon,
  segmentNearPolygon,
} from "./geometry";

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
 *
 * Automatic layout leaves room for all of these. Agents placed anywhere else
 * (by hand, or while being dragged) can sit in a wire's way, so a wire that
 * would run through an agent, or alongside another wire, takes a detour
 * instead: out from each port as a short cap or cup, then along a lane of its
 * own that's clear of agents and other wires over the height it covers.
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
  /**
   * Free ports held at fixed places along the top and bottom edges, left to
   * right, like the interface of a rule. Their wires bend in to meet them.
   */
  pins?: Pins;
}

export interface Pins {
  top: string[];
  bottom: string[];
  /** Room between neighbouring pins along each edge, if more than usual. */
  gaps?: { top?: number; bottom?: number };
  /**
   * Hold the pins still: evenly spaced around `mid`, in rows at `top` and
   * `bottom` (pushed further out only while the net reaches past them),
   * rather than each drawn towards where its wire arrives. Until those are
   * known, around the middle of the net and just beyond it.
   */
  held?: { mid?: number; top?: number; bottom?: number };
}

interface Leg {
  /** Points from the port up to (and including) where the wire starts its free run. */
  prefix: Pt[];
  t: Terminal;
}

type Job =
  | { kind: "direct"; id: WireId; a: Leg; b: Leg }
  | { kind: "cap" | "cup"; id: WireId; a: Leg; b: Leg }
  /** Out from each port to a lane of its own, round agents that were in the way. */
  | { kind: "detour"; id: WireId; a: Leg; b: Leg }
  | { kind: "around"; id: WireId; up: Leg; down: Leg; upFirst: boolean }
  | { kind: "drop"; id: WireId; leg: Leg; free: string; legFirst: boolean }
  | { kind: "rise"; id: WireId; leg: Leg; free: string; legFirst: boolean }
  /** To a pinned free port; `around` when the port faces away from its pin's edge. */
  | { kind: "pin"; id: WireId; leg: Leg; free: string; legFirst: boolean; side: "up" | "down"; around: boolean }
  | { kind: "bare"; id: WireId; free: [string, string] };

/** A horizontal run waiting for its height. */
interface Span {
  x0: number;
  x1: number;
  /** The run must be at least this far past these y values (above for caps, below for cups). */
  from: number;
  y: number;
  /** Where wires come up (or down) from their ports to the run; both ends if not given. */
  legs?: number[];
}

const JOG = 12;
/** How far wires keep from agents they don't connect to. Wires are drawn on a halo about this wide either side. */
const CLEARANCE = 4;

export function route(net: Net, placement: Placement, opts: RouteOptions = {}): Routed {
  const arity = (id: number) => net.agent(id).wires.length - 1;
  const boxes: Box[] = [];
  /** Each agent by its box, with its outline as drawn, and slightly shrunk for the wires at its own ports. */
  const shapes = new Map<Box, { id: AgentId; outline: Pt[]; inner: Pt[] }>();
  for (const [id, p] of placement) {
    if (!net.agents.has(id)) continue;
    const box = boxOf(p, arity(id));
    boxes.push(box);
    shapes.set(box, { id, outline: agentOutline(p, arity(id)), inner: agentOutline(p, arity(id), 0.5) });
  }

  const agentsByX = new ByX(boxes);
  /** Whether a wire runs through an agent, or too near one other than those at its ends. */
  const hitsAgent = (id: WireId, pts: Pt[]) => {
    const own = net.wire(id).ends.flatMap((e) => (e.kind === "port" ? [e.agent] : []));
    const m = CLEARANCE;
    for (let i = 1; i < pts.length; i++)
      for (const [a, b] of pieces(pts[i - 1]!, pts[i]!))
        for (const box of agentsByX.over(Math.min(a.x, b.x) - m, Math.max(a.x, b.x) + m)) {
          if (Math.max(a.y, b.y) < box.y0 - m || Math.min(a.y, b.y) > box.y1 + m) continue;
          const s = shapes.get(box)!;
          if (own.includes(s.id) ? segmentHitsPolygon(a, b, s.inner) : segmentNearPolygon(a, b, s.outline, CLEARANCE)) return true;
        }
    return false;
  };

  const leg = (e: Extract<End, { kind: "port" }>): Leg => {
    const p = placement.get(e.agent);
    if (!p) throw new Error(`agent ${e.agent} has no position`);
    const t = portPos(p, arity(e.agent), e.slot);
    const col = opts.columns?.get(endKey(e));
    if (col === undefined || Math.abs(col - t.x) < 0.5) return { prefix: [t], t };
    const s = t.dir === "up" ? -1 : 1;
    const to: Terminal = { x: col, y: t.y + s * 2 * JOG, dir: t.dir, s: true };
    // Automatic layout leaves a column clear of agents. One that isn't (an
    // agent has been moved into the way) is no longer worth keeping.
    if (hitsAgent(net.wireAt(e), [t, to, { x: col, y: to.y + s * G.layerH }])) return { prefix: [t], t };
    return { prefix: [t], t: to };
  };

  const pinSide = (name: string): "up" | "down" | undefined =>
    opts.pins?.top.includes(name) ? "up" : opts.pins?.bottom.includes(name) ? "down" : undefined;

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
      const side = pinSide(f.name);
      if (side) jobs.push({ kind: "pin", id: w.id, leg: l, free: f.name, legFirst, side, around: l.t.dir !== side });
      else jobs.push({ kind: l.t.dir === "down" ? "drop" : "rise", id: w.id, leg: l, free: f.name, legFirst });
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
    else if (job.kind === "pin" && job.around) xs = [job.leg.t.x];
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
  /** The lane each detour runs along (NaN while it needs choosing). */
  const detour = new Map<WireId, number>();
  // A gap too narrow for its lanes (agents placed by hand can leave one)
  // sends its wires round as detours, each finding a lane of its own.
  gaps.forEach((g, i) => {
    const users = laneUsers[i]!;
    if (!Number.isFinite(g.x1 - g.x0) || (g.x1 - g.x0) / (users.length + 1) >= G.wireGap) return;
    for (const { job } of users) {
      if (job.kind !== "around") continue;
      const [a, b] = job.upFirst ? [job.up, job.down] : [job.down, job.up];
      jobs[jobs.indexOf(job)] = { kind: "detour", id: job.id, a, b };
      detour.set(job.id, laneX.get(job.id)!);
    }
  });

  // Draw, then send wires that run through an agent or alongside another wire
  // round as detours, and lanes that turned out badly to be chosen again.
  /** How far up and down each detour's lane has had to reach. */
  const reach = new Map<WireId, [number, number]>();
  let drawn = draw();
  for (let pass = 0; pass < 4; pass++) {
    const runs = runsOf(drawn.wires);
    const close = closeRuns(runs);
    /** Wires sent to choose a lane again this pass: their runs no longer count. */
    const redo = new Set<WireId>();
    const beside = (id: WireId, fits: (c: Close) => boolean) => close.get(id)?.some((c) => !redo.has(c.other) && fits(c));
    jobs.forEach((job, i) => {
      if (detour.has(job.id)) {
        // Choose again if the lane now runs into an agent or alongside another wire, now that the runs at its ends have settled.
        const [lo, hi] = drawn.lanes.get(job.id)!;
        const x = detour.get(job.id)!;
        if (
          agentsByX
            .over(x - CLEARANCE, x + CLEARANCE)
            .some((b) => b.x0 - CLEARANCE < x && b.x1 + CLEARANCE > x && b.y0 < hi - 0.5 && b.y1 > lo + 0.5) ||
          beside(job.id, (c) => Math.abs(c.x - x) < 0.01 && c.gap < G.wireGap - 0.5 && c.overlap > 1)
        )
          redo.add(job.id);
        return;
      }
      if (!hitsAgent(job.id, drawn.wires.get(job.id)!) && !beside(job.id, (c) => c.gap < G.wireGap * 0.7 && c.overlap > 14)) return;
      if (job.kind === "direct" || job.kind === "cap" || job.kind === "cup") {
        jobs[i] = { kind: "detour", id: job.id, a: job.a, b: job.b };
        redo.add(job.id);
      } else if (job.kind === "drop" || job.kind === "rise") redo.add(job.id);
    });
    if (!redo.size) break;
    for (const id of redo) detour.set(id, NaN);
    chooseLanes(runs.filter((r) => !redo.has(r.id)));
    drawn = draw();
  }

  /** Lanes for detours still waiting for one, each clear of agents and of the other wires' vertical runs beside it. */
  function chooseLanes(runs: Run[]) {
    for (const job of jobs) {
      if (!Number.isNaN(detour.get(job.id) ?? 0)) continue;
      const near = (t: Terminal) => t.y + (t.dir === "up" ? -1 : 1) * G.wireGap;
      let xs: number[];
      let ys: number[];
      if (job.kind === "detour") [xs, ys] = [[job.a.t.x, job.b.t.x], [near(job.a.t), near(job.b.t)]];
      else if (job.kind === "drop" || job.kind === "rise")
        [xs, ys] = [[job.leg.t.x], [near(job.leg.t), job.kind === "drop" ? drawn.bottom : drawn.top]];
      else continue;
      // Every height the lane has had to cover so far, so it never goes back to a place that didn't work.
      const was = reach.get(job.id) ?? [];
      const lo = Math.min(...ys, ...was, ...(drawn.lanes.get(job.id) ?? []));
      const hi = Math.max(...ys, ...was, ...(drawn.lanes.get(job.id) ?? []));
      reach.set(job.id, [lo, hi]);
      const blocked: [number, number][] = [];
      for (const b of boxes) if (b.y1 > lo + 0.5 && b.y0 < hi - 0.5) blocked.push([b.x0 - G.wireGap, b.x1 + G.wireGap]);
      for (const r of runs)
        if (r.id !== job.id && r.hi > lo + 1 && r.lo < hi - 1) blocked.push([r.x - G.wireGap, r.x + G.wireGap]);
      const x = laneNear(xs, blocked);
      detour.set(job.id, x);
      runs.push({ id: job.id, x, lo, hi });
    }
  }

  function draw() {
    // Horizontal runs, narrowest first: caps, then cups.
    const caps = new Map<string, Span>();
    const cups = new Map<string, Span>();
    const span = (xa: number, xb: number, from: number, legs?: number[]): Span => ({
      x0: Math.min(xa, xb),
      x1: Math.max(xa, xb),
      from,
      y: from,
      legs,
    });
    /** A run from a port out to x, on the side the port faces, unless the wire gets there by a jog. */
    const out = (key: string, t: Terminal, x: number, towards: number) => {
      if (Math.abs(x - t.x) > 0.5 && !jogs(t, x, towards)) (t.dir === "up" ? caps : cups).set(key, span(t.x, x, t.y, [t.x]));
    };
    for (const job of jobs) {
      if (job.kind === "cap") caps.set(`${job.id}`, span(job.a.t.x, job.b.t.x, Math.min(job.a.t.y, job.b.t.y)));
      if (job.kind === "cup") cups.set(`${job.id}`, span(job.a.t.x, job.b.t.x, Math.max(job.a.t.y, job.b.t.y)));
      if (job.kind === "around") {
        const lx = laneX.get(job.id)!;
        caps.set(`${job.id}`, span(job.up.t.x, lx, job.up.t.y, [job.up.t.x]));
        cups.set(`${job.id}`, span(lx, job.down.t.x, job.down.t.y, [job.down.t.x]));
      }
      if (job.kind === "pin" && job.around) {
        const sp = span(job.leg.t.x, laneX.get(job.id)!, job.leg.t.y, [job.leg.t.x]);
        (job.leg.t.dir === "up" ? caps : cups).set(`${job.id}`, sp);
      }
      if (job.kind === "detour") {
        out(`${job.id}a`, job.a.t, detour.get(job.id)!, job.b.t.y);
        out(`${job.id}b`, job.b.t, detour.get(job.id)!, job.a.t.y);
      }
      if ((job.kind === "drop" || job.kind === "rise") && detour.has(job.id))
        out(`${job.id}a`, job.leg.t, detour.get(job.id)!, job.kind === "drop" ? Infinity : -Infinity);
    }
    // Cups keep clear of the caps too, so the two never run along each other.
    const capRuns = settle(caps, agentsByX, -1);
    settle(cups, agentsByX, +1, capRuns);
    /** Where the run out from a port settled, if it has one. */
    const outY = (key: string, t: Terminal) => (t.dir === "up" ? caps : cups).get(key)?.y;

    // Free ports sit on common lines above and below everything.
    let bottom = -Infinity;
    let top = Infinity;
    for (const b of boxes) [top, bottom] = [Math.min(top, b.y0), Math.max(bottom, b.y1)];
    for (const c of cups.values()) bottom = Math.max(bottom, c.y);
    for (const c of caps.values()) top = Math.min(top, c.y);
    for (const job of jobs) {
      if (job.kind === "drop") bottom = Math.max(bottom, job.leg.t.y);
      if (job.kind === "rise") top = Math.min(top, job.leg.t.y);
      if (job.kind === "pin") [top, bottom] = [Math.min(top, job.leg.t.y), Math.max(bottom, job.leg.t.y)];
    }
    bottom = (Number.isFinite(bottom) ? bottom : 0) + G.freeMargin;
    top = (Number.isFinite(top) ? top : 0) - G.freeMargin;

    // Pinned ports keep their order, but sit as close as they can to where
    // their wires naturally arrive.
    const pinX = new Map<string, number>();
    const held = opts.pins?.held;
    const pinTop = Math.min(top - PIN_RISE, held?.top ?? Infinity);
    const pinBottom = Math.max(bottom + PIN_RISE, held?.bottom ?? -Infinity);
    if (opts.pins) {
      const natural = new Map<string, number>();
      for (const job of held ? [] : jobs) {
        if (job.kind === "pin") natural.set(job.free, job.around ? laneX.get(job.id)! : job.leg.t.x);
      }
      const mid = held?.mid ?? (boxes.length ? boxes.reduce((s, b) => s + b.x0 + b.x1, 0) / (2 * boxes.length) : 0);
      const { top: tops, bottom: bottoms, gaps } = opts.pins;
      spread(tops, natural, mid, gaps?.top).forEach((x, n) => pinX.set(n, x));
      spread(bottoms, natural, mid, gaps?.bottom).forEach((x, n) => pinX.set(n, x));
    }

    const wires = new Map<WireId, Pt[]>();
    const free = new Map<string, Terminal>();
    /** Where each detour's lane starts and ends. */
    const lanes = new Map<WireId, [number, number]>();
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
          const y = (job.kind === "cap" ? caps : cups).get(`${job.id}`)!.y;
          wires.set(job.id, join(job.a, [{ x: job.a.t.x, y }, { x: job.b.t.x, y }], job.b));
          break;
        }
        case "detour": {
          const lx = detour.get(job.id)!;
          const ya = outY(`${job.id}a`, job.a.t);
          const yb = outY(`${job.id}b`, job.b.t);
          const [ja, jb] = [jogs(job.a.t, lx, job.b.t.y), jogs(job.b.t, lx, job.a.t.y)];
          const mid: Pt[] = [];
          if (ya !== undefined) mid.push({ x: job.a.t.x, y: ya }, { x: lx, y: ya });
          if (ja) mid.push({ x: lx, y: jogEnd(job.a.t), s: true });
          if (yb !== undefined) mid.push({ x: lx, y: yb }, { x: job.b.t.x, y: yb });
          if (jb) mid.push({ x: lx, y: jogEnd(job.b.t) });
          const ends = [ya ?? (ja ? jogEnd(job.a.t) : job.a.t.y), yb ?? (jb ? jogEnd(job.b.t) : job.b.t.y)];
          lanes.set(job.id, [Math.min(...ends), Math.max(...ends)]);
          wires.set(job.id, join(job.a, mid, job.b, jb));
          break;
        }
        case "around": {
          const lx = laneX.get(job.id)!;
          const cy = caps.get(`${job.id}`)!.y;
          const uy = cups.get(`${job.id}`)!.y;
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
          const edge = job.kind === "drop" ? bottom : top;
          const pts: Pt[] = [...job.leg.prefix, t];
          const lx = detour.get(job.id);
          if (lx === undefined) pts.push({ x: t.x, y: edge });
          else {
            const jog = jogs(t, lx, edge);
            const y = outY(`${job.id}a`, t) ?? (jog ? jogEnd(t) : undefined);
            if (jog) pts.push({ x: lx, y: y!, s: true });
            else if (y !== undefined) pts.push({ x: t.x, y }, { x: lx, y });
            pts.push({ x: lx, y: edge });
            lanes.set(job.id, [Math.min(y ?? t.y, edge), Math.max(y ?? t.y, edge)]);
          }
          free.set(job.free, { ...pts[pts.length - 1]!, dir: job.kind === "drop" ? "down" : "up" });
          wires.set(job.id, job.legFirst ? pts : reversePath(pts));
          break;
        }
        case "pin": {
          const t = job.leg.t;
          const up = job.side === "up";
          const edge = up ? top : bottom;
          const end = { x: pinX.get(job.free)!, y: up ? pinTop : pinBottom, s: true };
          let pts: Pt[];
          if (!job.around) pts = [...job.leg.prefix, t, { x: t.x, y: edge }, end];
          else {
            const lx = laneX.get(job.id)!;
            const y = (t.dir === "up" ? caps : cups).get(`${job.id}`)!.y;
            pts = [...job.leg.prefix, t, { x: t.x, y }, { x: lx, y }, { x: lx, y: edge }, end];
          }
          free.set(job.free, { x: end.x, y: end.y, dir: job.side });
          wires.set(job.id, job.legFirst ? pts : reversePath(pts));
          break;
        }
        case "bare": {
          const [sa, sb] = job.free.map(pinSide);
          if (sa && sb) {
            const a = { x: pinX.get(job.free[0])!, y: sa === "up" ? pinTop : pinBottom };
            const b = { x: pinX.get(job.free[1])!, y: sb === "up" ? pinTop : pinBottom };
            free.set(job.free[0], { ...a, dir: sa });
            free.set(job.free[1], { ...b, dir: sb });
            if (sa !== sb) {
              const ya = sa === "up" ? top : bottom;
              const yb = sb === "up" ? top : bottom;
              wires.set(job.id, [a, { x: a.x, y: ya }, { x: b.x, y: yb, s: true }, b]);
            } else {
              const y = a.y + (sa === "up" ? 1 : -1) * G.layerH * 0.4;
              wires.set(job.id, [a, { x: a.x, y }, { x: b.x, y }, b]);
            }
            break;
          }
          const capY = bottom - G.layerH / 2;
          const a = { x: bareX, y: bottom };
          const b = { x: bareX + G.portGap, y: bottom };
          bareX += G.portGap * 2;
          free.set(job.free[0], { ...a, dir: "down" });
          free.set(job.free[1], { ...b, dir: "down" });
          wires.set(job.id, [a, { x: a.x, y: capY }, { x: b.x, y: capY }, b]);
          break;
        }
      }
    }

    // Free ports with nothing attached still need a spot.
    for (const [name, w] of net.free) {
      if (free.has(name) || w !== NONE) continue;
      const side = pinSide(name);
      if (side) {
        free.set(name, { x: pinX.get(name)!, y: side === "up" ? pinTop : pinBottom, dir: side });
        continue;
      }
      free.set(name, { x: bareX, y: bottom, dir: "down" });
      bareX += G.portGap;
    }
    return { wires, free, lanes, top, bottom };
  }

  const { wires, free } = drawn;
  const arounds = jobs.filter((j) => j.kind === "around" || (j.kind === "pin" && j.around)).length;
  const bounds = boundsOf(boxes, wires);
  for (const f of free.values()) {
    bounds.y0 = Math.min(bounds.y0, f.y);
    bounds.y1 = Math.max(bounds.y1, f.y);
  }
  return { wires, free, bounds, laneCount: laneUsers.map((u) => u.length), gaps, arounds };
}

/**
 * The x nearest the given ones (counting each it misses as a bend) outside
 * every blocked interval.
 */
function laneNear(xs: number[], blocked: [number, number][]): number {
  // Merge the blocked intervals; their ends are then all free.
  const merged: [number, number][] = [];
  for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1];
    if (last && a < last[1] - 0.01) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const free = (x: number) => merged.every(([a, b]) => x <= a + 0.01 || x >= b - 0.01);
  let best = xs[0]!;
  let bestCost = Infinity;
  for (const x of [...xs.filter(free), ...merged.flat()]) {
    const cost = xs.reduce((s, v) => s + Math.abs(x - v) + (Math.abs(x - v) > 0.5 ? G.layerH / 2 : 0), 0);
    if (cost < bestCost) [best, bestCost] = [x, cost];
  }
  return best;
}

/** A vertical stretch of a wire. */
interface Run {
  id: WireId;
  x: number;
  lo: number;
  hi: number;
}

/** Where the wires run vertically, S-curves counting as vertical for half their height at each end. */
function runsOf(wires: Map<WireId, Pt[]>): Run[] {
  const runs: Run[] = [];
  for (const [id, pts] of wires)
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      const run = (x: number, y0: number, y1: number) => runs.push({ id, x, lo: Math.min(y0, y1), hi: Math.max(y0, y1) });
      if (b.s) [run(a.x, a.y, (a.y + b.y) / 2), run(b.x, (a.y + b.y) / 2, b.y)];
      else if (Math.abs(a.x - b.x) < 0.01) run(a.x, a.y, b.y);
    }
  return runs;
}

/** Another wire's run beside one of a wire's runs: how far apart they are, and for how long they run together. */
interface Close {
  other: WireId;
  /** Where this wire's run is. */
  x: number;
  gap: number;
  overlap: number;
}

/** For each wire, the other wires running less than a wire gap beside it. */
function closeRuns(runs: Run[]): Map<WireId, Close[]> {
  const out = new Map<WireId, Close[]>();
  const add = (r: Run, o: Run, overlap: number) => {
    const c = { other: o.id, x: r.x, gap: Math.abs(r.x - o.x), overlap };
    const list = out.get(r.id);
    if (list) list.push(c);
    else out.set(r.id, [c]);
  };
  const byX = [...runs].sort((a, b) => a.x - b.x);
  for (let i = 0; i < byX.length; i++)
    for (let j = i + 1; j < byX.length && byX[j]!.x - byX[i]!.x < G.wireGap; j++) {
      const [r, o] = [byX[i]!, byX[j]!];
      const overlap = Math.min(r.hi, o.hi) - Math.max(r.lo, o.lo);
      if (r.id === o.id || overlap <= 1) continue;
      add(r, o, overlap);
      add(o, r, overlap);
    }
  return out;
}

/** A path segment as straight pieces: itself, or an S-curve cut into short lines. */
function pieces(a: Pt, b: Pt): [Pt, Pt][] {
  if (!b.s) return [[a, b]];
  const my = (a.y + b.y) / 2;
  const at = (t: number): Pt => {
    const u = 1 - t;
    return {
      x: (u * u * u + 3 * u * u * t) * a.x + (3 * u * t * t + t * t * t) * b.x,
      y: u * u * u * a.y + 3 * u * t * (u + t) * my + t * t * t * b.y,
    };
  };
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < 10; i++) out.push([at(i / 10), at((i + 1) / 10)]);
  return out;
}

/**
 * Whether a wire leaving a port for a lane at x gets there by a short
 * S-curve, as wires reach their columns in automatic layout: when the lane
 * is near and carries on the way the port faces, past `towards`.
 */
function jogs(t: Terminal, x: number, towards: number): boolean {
  const d = Math.abs(x - t.x);
  return d > 0.5 && d < 2 * JOG && (t.dir === "up" ? -1 : 1) * (towards - t.y) > 3 * JOG;
}

/** Where such an S-curve ends. */
const jogEnd = (t: Terminal) => t.y + (t.dir === "up" ? -1 : 1) * 2 * JOG;

/** How far pinned ports sit beyond the net, leaving room for wires to bend in. */
const PIN_RISE = 30;

/**
 * Positions for pins in the given order, each as near its natural x as the
 * order and spacing allow. Pins with no natural position fill in between.
 */
function spread(names: string[], natural: Map<string, number>, mid: number, wide = 0): Map<string, number> {
  const gap = Math.max(G.portGap * 1.5, wide);
  const out = new Map<string, number>();
  if (!names.length) return out;
  const known = names.filter((n) => natural.has(n));
  if (!known.length) {
    names.forEach((n, i) => out.set(n, mid + (i - (names.length - 1) / 2) * gap));
    return out;
  }
  const xs: number[] = [];
  names.forEach((n, i) => {
    const want = natural.get(n);
    const prev = xs[i - 1];
    if (prev === undefined) xs.push(want ?? natural.get(known[0]!)! - gap * names.indexOf(known[0]!));
    else xs.push(Math.max(want ?? -Infinity, prev + gap));
  });
  // Pushing apart drifts rightwards; shift back so the pins sit centred on where they wanted to be.
  const drift = known.reduce((s, n) => s + xs[names.indexOf(n)]! - natural.get(n)!, 0) / known.length;
  names.forEach((n, i) => out.set(n, xs[i]! - drift));
  return out;
}

/** The same path walked the other way, keeping each S-curve on its segment. */
export function reversePath(pts: Pt[]): Pt[] {
  const r = [...pts].reverse();
  return r.map((p, k) => ({ x: p.x, y: p.y, s: k > 0 && !!r[k - 1]!.s }));
}

/**
 * Give each span a height clear of the agents and earlier spans beneath it.
 * `dir` is -1 for caps (moving up) and +1 for cups (moving down). `runs`
 * are horizontal runs already placed. Returns the runs as placed.
 */
function settle(spans: Map<string, Span>, agents: ByX, dir: -1 | 1, runs: Box[] = []): Box[] {
  const placed: Box[] = [];
  const taken = new ByX(runs);
  const order = [...spans.values()].sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0) || dir * (b.from - a.from));
  const pad = G.wireGap * 0.6;
  for (const s of order) {
    const near = agents.over(s.x0 - pad, s.x1 + pad);
    const others = taken.over(s.x0 - pad, s.x1 + pad);
    /** The first height clear of agents by `gap` and of other runs by `runGap`. */
    const push = (gap: number, runGap: number) => {
      // Heights measured in the direction the run moves.
      let at = dir * s.from + Math.max(gap, Math.min(G.radius, (s.x1 - s.x0) / 2));
      // Each obstacle ahead as the band the run must stay out of, in the order the run meets them.
      const bands: [number, number][] = [];
      for (const [list, g] of [[near, gap], [others, runGap]] as const)
        for (const b of list) {
          const band: [number, number] = dir < 0 ? [-(b.y1 + g), -(b.y0 - g)] : [b.y0 - g, b.y1 + g];
          if (band[1] > at) bands.push(band);
        }
      bands.sort((p, q) => p[0] - q[0]);
      for (const [lo, hi] of bands) if (at > lo + 0.01 && at < hi - 0.01) at = hi;
      return dir * at;
    };
    // The nearest agent in front of a leg: going past it would run the leg through it, or too close by.
    let wall = dir * Infinity;
    for (const b of near) {
      const edge = dir < 0 ? b.y1 : b.y0;
      const ahead = dir * (edge - s.from) > 0.5 && dir * (edge - wall) < 0;
      if (ahead && (s.legs ?? [s.x0, s.x1]).some((x) => b.x0 - CLEARANCE < x && b.x1 + CLEARANCE > x)) wall = edge;
    }
    let y = push(G.wireGap, G.wireGap);
    // Short of room before it: squeeze in closer to the other runs, or
    // failing that, take the middle of the widest space left.
    if (dir * (y - wall) > 0) y = push(G.wireGap / 2, G.wireGap / 2);
    if (dir * (y - wall) > 0) {
      // Heights in the direction the run moves: the stretch up to the wall, less the agents in it, cut by the other runs.
      const [from, to] = [dir * s.from, dir * wall];
      const inside = near.map((b) => (dir < 0 ? [-b.y1, -b.y0] : [b.y0, b.y1]) as [number, number]);
      const stops = [from, to, ...inside.flat(), ...others.map((b) => dir * b.y0)]
        .filter((v) => v >= from && v <= to)
        .sort((p, q) => p - q);
      let widest = -1;
      for (let i = 1; i < stops.length; i++) {
        const mid = (stops[i]! + stops[i - 1]!) / 2;
        const room = stops[i]! - stops[i - 1]!;
        if (room > widest && !inside.some(([lo, hi]) => mid > lo && mid < hi)) [widest, y] = [room, dir * mid];
      }
    }
    s.y = y;
    const run = { x0: s.x0, x1: s.x1, y0: y, y1: y };
    placed.push(run);
    taken.add(run);
  }
  return placed;
}

/** Boxes filed by x, to find the ones over a stretch quickly. */
class ByX {
  private cells = new Map<number, Box[]>();
  constructor(boxes: Box[] = []) {
    for (const b of boxes) this.add(b);
  }
  add(b: Box) {
    for (let c = Math.floor(b.x0 / BY_X); c <= Math.floor(b.x1 / BY_X); c++) {
      const list = this.cells.get(c);
      if (list) list.push(b);
      else this.cells.set(c, [b]);
    }
  }
  /** Boxes reaching strictly into the stretch from x0 to x1. */
  over(x0: number, x1: number): Box[] {
    const out = new Set<Box>();
    for (let c = Math.floor(x0 / BY_X); c <= Math.floor(x1 / BY_X); c++)
      for (const b of this.cells.get(c) ?? []) if (b.x1 > x0 && b.x0 < x1) out.add(b);
    return [...out];
  }
}
const BY_X = 64;

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
