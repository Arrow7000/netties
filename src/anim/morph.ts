import type { AgentId, End, Net, WireId } from "../core/net";
import type { StepRecord } from "../core/reduce";
import { G, type Orient, type Placed, type Placement, type Pt, portPos } from "../layout/geometry";
import type { Routed } from "../layout/route";
import { flattenPath, resample } from "../render/path";

/**
 * Animating a reduction step as a rewiring rather than a cross-fade.
 *
 * The engine tells us which old wires each new wire continues, so every
 * wire can morph from its old shape (the old wires it continues, chained
 * end to end) to its new one, while staying glued to the ports at its ends.
 * Agents that survive slide (and turn round if their orientation flips).
 * New agents start where an interacting agent of the same type was, so a
 * copy appears to split off from its original; ones with no such ancestor
 * grow out of the point where the pair met, and interacting agents with no
 * successor shrink into it.
 */

export interface Snapshot {
  net: Net;
  placement: Placement;
  routed: Routed;
}

export interface AgentFrame {
  id: AgentId;
  type: string;
  arity: number;
  x: number;
  y: number;
  /** 0 points down, π points up. */
  angle: number;
  scale: number;
  opacity: number;
}

export interface WireFrame {
  id: string;
  pts: Pt[];
  opacity: number;
}

export interface FreeFrame {
  name: string;
  x: number;
  y: number;
  dir: Orient;
}

export interface Frame {
  agents: AgentFrame[];
  wires: WireFrame[];
  free: FreeFrame[];
}

interface Pose {
  x: number;
  y: number;
  angle: number;
  scale: number;
  opacity: number;
}

interface AgentTrack {
  id: AgentId;
  type: string;
  arity: number;
  from: Pose;
  to: Pose;
}

interface WireTrack {
  id: string;
  ends?: [End, End];
  from: Pt[];
  to: Pt[];
  fade: boolean;
}

const SAMPLES = 40;
const angleOf = (o: Orient) => (o === "down" ? 0 : Math.PI);
const pose = (p: Placed, scale = 1, opacity = 1): Pose => ({ x: p.x, y: p.y, angle: angleOf(p.orient), scale, opacity });

export function buildMorph(before: Snapshot, after: Snapshot, records: StepRecord[]) {
  // Agent tracks.
  const tracks = new Map<AgentId, AgentTrack>();
  const absorbed = new Set<AgentId>();
  for (const [id, p] of after.placement) {
    const a = after.net.agents.get(id);
    if (!a) continue;
    const old = before.placement.get(id);
    tracks.set(id, { id, type: a.type, arity: a.wires.length - 1, from: old ? pose(old) : pose(p, 0.1, 0), to: pose(p) });
  }
  for (const rec of records) {
    const olds = rec.removed.map((id) => ({ id, p: before.placement.get(id), type: before.net.agents.get(id)?.type }));
    const known = olds.filter((o): o is { id: AgentId; p: Placed; type: string } => !!o.p && !!o.type);
    const mid = known.length
      ? { x: known.reduce((s, o) => s + o.p.x, 0) / known.length, y: known.reduce((s, o) => s + o.p.y, 0) / known.length }
      : { x: 0, y: 0 };
    for (const id of rec.created) {
      const t = tracks.get(id);
      if (!t) continue;
      const ancestor = known.find((o) => o.type === t.type);
      if (ancestor) {
        t.from = pose(ancestor.p);
        absorbed.add(ancestor.id);
      } else t.from = { ...t.to, x: mid.x, y: mid.y, scale: 0.1, opacity: 0 };
    }
    for (const o of known) {
      if (absorbed.has(o.id)) continue;
      const arity = before.net.agent(o.id).wires.length - 1;
      tracks.set(o.id, { id: o.id, type: o.type, arity, from: pose(o.p), to: { ...pose(o.p), x: mid.x, y: mid.y, scale: 0.1, opacity: 0 } });
    }
  }

  // Which old wires each wire in the result continues, composed across
  // every interaction in the step.
  const origin = new Map<WireId, WireId[]>();
  for (const rec of records) {
    for (const c of rec.createdWires) origin.set(c.id, c.from.flatMap((f) => origin.get(f) ?? [f]));
  }
  const used = new Set<WireId>();
  const oldShape = (id: WireId) => {
    const r = before.routed.wires.get(id);
    return r ? flattenPath(r, G.radius) : undefined;
  };

  const startOf = (e: End): Pt | undefined => {
    if (e.kind === "free") return before.routed.free.get(e.name) ?? after.routed.free.get(e.name);
    const t = tracks.get(e.agent);
    return t ? portAt(t, t.from, e.slot) : undefined;
  };

  const wires: WireTrack[] = [];
  for (const [id, w] of after.net.wires) {
    const r = after.routed.wires.get(id);
    if (!r) continue;
    const to = resample(flattenPath(r, G.radius), SAMPLES);
    const srcs = (origin.get(id) ?? [id]).filter((o) => before.routed.wires.has(o));
    srcs.forEach((s) => used.add(s));
    const s0 = startOf(w.ends[0]) ?? to[0]!;
    const s1 = startOf(w.ends[1]) ?? to[to.length - 1]!;
    const pieces = srcs.map(oldShape).filter((p): p is Pt[] => !!p && p.length > 0);
    const from = pieces.length ? chain(pieces, s0) : [s0, s1];
    wires.push({ id: String(id), ends: w.ends, from: resample(from, SAMPLES), to, fade: false });
  }
  for (const [id, r] of before.routed.wires) {
    if (after.net.wires.has(id) || used.has(id)) continue;
    const pts = resample(flattenPath(r, G.radius), SAMPLES);
    wires.push({ id: `gone-${id}`, from: pts, to: pts, fade: true });
  }

  const free = [...after.routed.free].map(([name, f]) => ({ name, from: before.routed.free.get(name) ?? f, to: f }));

  return {
    at(raw: number): Frame {
      const t = ease(Math.min(1, Math.max(0, raw)));
      const agents: AgentFrame[] = [];
      const now = new Map<AgentId, Pose>();
      for (const tr of tracks.values()) {
        const p = lerpPose(tr.from, tr.to, t);
        now.set(tr.id, p);
        agents.push({ id: tr.id, type: tr.type, arity: tr.arity, ...p });
      }
      const endNow = (e: End): Pt | undefined => {
        if (e.kind === "free") {
          const f = free.find((x) => x.name === e.name);
          return f ? lerpPt(f.from, f.to, t) : undefined;
        }
        const tr = tracks.get(e.agent);
        const p = now.get(e.agent);
        return tr && p ? portAt(tr, p, e.slot) : undefined;
      };
      const wf: WireFrame[] = wires.map((w) => {
        const pts = w.from.map((p, i) => lerpPt(p, w.to[i]!, t));
        if (w.ends) {
          // Keep the wire's ends on the (moving) ports, bending the rest to suit.
          const a = endNow(w.ends[0]);
          const b = endNow(w.ends[1]);
          const n = pts.length - 1;
          const da = a ? { x: a.x - pts[0]!.x, y: a.y - pts[0]!.y } : { x: 0, y: 0 };
          const db = b ? { x: b.x - pts[n]!.x, y: b.y - pts[n]!.y } : { x: 0, y: 0 };
          pts.forEach((p, i) => {
            const u = i / n;
            const ka = (1 - u) * (1 - u);
            const kb = u * u;
            p.x += da.x * ka + db.x * kb;
            p.y += da.y * ka + db.y * kb;
          });
        }
        return { id: w.id, pts, opacity: w.fade ? 1 - t : 1 };
      });
      return {
        agents,
        wires: wf,
        free: free.map((f) => ({ name: f.name, ...lerpPt(f.from, f.to, t), dir: f.to.dir })),
      };
    },
  };
}

export type Morph = ReturnType<typeof buildMorph>;

/** Where a port is on an agent at some pose. */
function portAt(tr: { arity: number }, p: Pose, slot: number): Pt {
  const off = portPos({ x: 0, y: 0, orient: "down" }, tr.arity, slot);
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { x: p.x + (off.x * c - off.y * s) * p.scale, y: p.y + (off.x * s + off.y * c) * p.scale };
}

/** Join polylines into one, starting from the end nearest `start` and always continuing with the nearest piece. */
function chain(pieces: Pt[][], start: Pt): Pt[] {
  const left = [...pieces];
  const out: Pt[] = [];
  let cur = start;
  while (left.length) {
    let best = 0;
    let rev = false;
    let bestD = Infinity;
    left.forEach((p, i) => {
      const d0 = dist(cur, p[0]!);
      const d1 = dist(cur, p[p.length - 1]!);
      if (d0 < bestD) [best, rev, bestD] = [i, false, d0];
      if (d1 < bestD) [best, rev, bestD] = [i, true, d1];
    });
    const [piece] = left.splice(best, 1);
    const pts = rev ? [...piece!].reverse() : piece!;
    out.push(...pts);
    cur = pts[pts.length - 1]!;
  }
  return out;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  // Always turn the same way, by at most half a turn.
  let da = b.angle - a.angle;
  if (da < 0) da += 2 * Math.PI;
  if (da > Math.PI + 1e-6) da -= 2 * Math.PI;
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    angle: a.angle + da * t,
    scale: lerp(a.scale, b.scale, t),
    opacity: lerp(a.opacity, b.opacity, t),
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
