import type { AgentId, Net, WireId } from "../core/net";
import { flattenPath } from "../render/path";
import { G, type Placement, type Pt, agentOutline, insidePolygon } from "./geometry";
import type { Routed } from "./route";

/**
 * Checks on a routed drawing, for tests: wires drawn through agents, and
 * wires drawn alongside each other closer than `G.wireGap` allows.
 */

export interface Hit {
  wire: WireId;
  agent: AgentId;
}

/** The outline of an agent as drawn, shrunk by `inset` so grazing an edge doesn't count. */
export function outline(net: Net, placement: Placement, id: AgentId, inset = 1.5): Pt[] {
  return agentOutline(placement.get(id)!, net.agent(id).wires.length - 1, inset);
}

/** Points along the drawn wire, no more than `step` apart. */
function samples(pts: Pt[], step = 2): Pt[] {
  const flat = flattenPath(pts, G.radius);
  const out: Pt[] = [];
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1]!;
    const b = flat[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (flat.length) out.push(flat[flat.length - 1]!);
  return out;
}

/** Wires drawn through an agent. A wire may touch the agents at its own ends only at their ports. */
export function wiresThroughAgents(net: Net, placement: Placement, routed: Routed): Hit[] {
  const hits: Hit[] = [];
  const shapes = [...placement.keys()]
    .filter((id) => net.agents.has(id))
    .map((id) => ({ id, poly: outline(net, placement, id) }));
  for (const [w, pts] of routed.wires) {
    const ends = new Set(net.wire(w).ends.flatMap((e) => (e.kind === "port" ? [e.agent] : [])));
    const ss = samples(pts);
    for (const { id, poly } of shapes) {
      // A wire's own agents: allow the stretch next to the port.
      const inside = ss.filter((q) => insidePolygon(q, poly));
      if (ends.has(id) ? inside.length > 4 : inside.length > 0) hits.push({ wire: w, agent: id });
    }
  }
  return hits;
}

export interface Close {
  a: WireId;
  b: WireId;
  /** How far apart they run, and for how long. */
  gap: number;
  length: number;
  /** Whether they run alongside vertically. */
  vertical: boolean;
}

/**
 * Pairs of wires with straight stretches running alongside each other less
 * than `minGap` apart for longer than `minLength`. Crossing is fine;
 * sharing a lane isn't.
 */
export function wiresTooClose(routed: Routed, minGap = G.wireGap * 0.7, minLength = 14): Close[] {
  type S = { w: WireId; v: boolean; at: number; lo: number; hi: number };
  const segs: S[] = [];
  for (const [w, pts] of routed.wires) {
    const flat = flattenPath(pts, G.radius);
    for (let i = 1; i < flat.length; i++) {
      const a = flat[i - 1]!;
      const b = flat[i]!;
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) > 1)
        segs.push({ w, v: true, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) > 1)
        segs.push({ w, v: false, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  }
  const worst = new Map<string, Close>();
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      if (s.w === t.w || s.v !== t.v) continue;
      const gap = Math.abs(s.at - t.at);
      const len = Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo);
      if (gap >= minGap || len <= minLength) continue;
      const [a, b] = s.w < t.w ? [s.w, t.w] : [t.w, s.w];
      const k = `${a}:${b}`;
      const prev = worst.get(k);
      if (!prev || len > prev.length) worst.set(k, { a, b, gap, length: len, vertical: s.v });
    }
  return [...worst.values()];
}
