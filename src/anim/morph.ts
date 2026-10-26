import { type AgentId, type End, NONE, type Net, type WireId } from "../core/net";
import type { StepRecord } from "../core/reduce";
import type { System } from "../core/system";
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
  /** What each agent type looks like, including instance boxes. */
  sys: System;
  placement: Placement;
  routed: Routed;
}

export interface AgentFrame {
  id: AgentId;
  type: string;
  arity: number;
  symbol: string;
  filled: boolean;
  box: boolean;
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
  look: { symbol: string; filled: boolean; box: boolean };
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

/**
 * For edits rather than steps: where an agent that's appearing was drawn
 * before (an instance box it's coming out of), and where one that's
 * disappearing goes (the box it's being folded into).
 */
export interface Hints {
  from?: (id: AgentId) => AgentId | undefined;
  to?: (id: AgentId) => AgentId | undefined;
  /** Where a new agent was dropped, so it slides from there to its place. */
  origin?: (id: AgentId) => Pt | undefined;
}

export function buildMorph(before: Snapshot, after: Snapshot, records: StepRecord[], hints: Hints = {}) {
  const look = (type: string) => {
    const t = after.sys.types.get(type) ?? before.sys.types.get(type);
    return { symbol: t?.symbol ?? "", filled: !!t?.filled, box: !!t?.box };
  };
  // Agent tracks.
  const tracks = new Map<AgentId, AgentTrack>();
  const absorbed = new Set<AgentId>();
  for (const [id, p] of after.placement) {
    const a = after.net.agents.get(id);
    if (!a) continue;
    const old = before.placement.get(id);
    const src = old ? undefined : hints.from?.(id);
    const was = src === undefined ? undefined : before.placement.get(src);
    const dropped = old ? undefined : hints.origin?.(id);
    const from = old
      ? pose(old)
      : was
        ? { ...pose(p, 0.1, 0), x: was.x, y: was.y }
        : dropped
          ? { ...pose(p), x: dropped.x, y: dropped.y }
          : pose(p, 0.1, 0);
    tracks.set(id, { id, type: a.type, arity: a.wires.length - 1, look: look(a.type), from, to: pose(p) });
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
      tracks.set(o.id, { id: o.id, type: o.type, arity, look: look(o.type), from: pose(o.p), to: { ...pose(o.p), x: mid.x, y: mid.y, scale: 0.1, opacity: 0 } });
    }
  }

  // Agents that went without a step taking them (deleted, or folded into a
  // box) fade where they are, or shrink into their box.
  const stepped = new Set(records.flatMap((r) => r.removed));
  for (const [id, p] of before.placement) {
    if (tracks.has(id) || stepped.has(id)) continue;
    const a = before.net.agents.get(id);
    if (!a) continue;
    const dst = hints.to?.(id);
    const goes = dst === undefined ? undefined : after.placement.get(dst);
    const to = goes ? { ...pose(p), x: goes.x, y: goes.y, scale: 0.1, opacity: 0 } : { ...pose(p), opacity: 0 };
    tracks.set(id, { id, type: a.type, arity: a.wires.length - 1, look: look(a.type), from: pose(p), to });
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

  /** Where an end was drawn before, if it was. */
  const startOf = (e: End): Pt | undefined => {
    if (e.kind === "free") return before.routed.free.get(e.name);
    const t = tracks.get(e.agent);
    return t ? portAt(t, t.from, e.slot) : undefined;
  };
  /**
   * A wire that's new, from an end that was there to a loose end that
   * wasn't, as when undoing a join: it peels off whichever old wire ran from
   * that end, as the stretch from the end to the point nearest where the
   * loose end goes.
   */
  const peel = (known: Pt | undefined, other: End, goes: Pt): Pt[] | undefined => {
    if (!known || other.kind !== "free" || before.routed.free.has(other.name)) return undefined;
    for (const r of before.routed.wires.values()) {
      const f = flattenPath(r, G.radius);
      if (f.length < 2) continue;
      const path = dist(f[0]!, known) < 1 ? f : dist(f[f.length - 1]!, known) < 1 ? [...f].reverse() : undefined;
      if (!path) continue;
      let cut = 1;
      path.forEach((q, i) => i > 0 && dist(q, goes) < dist(path[cut]!, goes) && (cut = i));
      return path.slice(0, cut + 1);
    }
    return undefined;
  };
  /** Loose ends that weren't there before start where their wire's end was (as when undoing a connection). */
  const freeStart = new Map<string, Pt>();

  /**
   * A wire between two ports that's now two wires, one from each port to a
   * loose end that wasn't there, as when undoing a join of two loose ends'
   * wires: it splits at its halfway point, and each half springs back from
   * there. Keyed by the new wire, each half runs from its port.
   */
  const halves = new Map<WireId, Pt[]>();
  for (const [id, r] of before.routed.wires) {
    const old = before.net.wires.get(id);
    if (!old || old.ends.some((e) => e.kind !== "port" || !after.net.agents.has(e.agent))) continue;
    const parts = old.ends.map((e) => {
      const w = after.net.wireAt(e);
      const other = w === NONE ? undefined : after.net.partner(e);
      return other?.kind === "free" && !before.routed.free.has(other.name) ? w : undefined;
    });
    if (parts[0] === undefined || parts[1] === undefined || parts[0] === parts[1]) continue;
    const path = flattenPath(r, G.radius);
    const s0 = startOf(old.ends[0]);
    if (path.length < 2 || !s0) continue;
    const fwd = dist(path[0]!, s0) <= dist(path[path.length - 1]!, s0) ? path : [...path].reverse();
    const [first, second] = splitHalfway(fwd);
    halves.set(parts[0], first);
    halves.set(parts[1], second.reverse());
    used.add(id);
  }

  const wires: WireTrack[] = [];
  for (const [id, w] of after.net.wires) {
    const r = after.routed.wires.get(id);
    if (!r) continue;
    const to = resample(flattenPath(r, G.radius), SAMPLES);
    const srcs = (origin.get(id) ?? [id]).filter((o) => before.routed.wires.has(o));
    srcs.forEach((s) => used.add(s));
    const s0 = startOf(w.ends[0]);
    const s1 = startOf(w.ends[1]);
    const pieces = srcs.map(oldShape).filter((p): p is Pt[] => !!p && p.length > 0);
    const half = halves.get(id);
    // Chain the old pieces from an end that was there, so the far end of the chain is where the other end was.
    const from = half
      ? w.ends[0].kind === "port"
        ? half
        : [...half].reverse()
      : !pieces.length
      ? (peel(s0, w.ends[1], to[to.length - 1]!) ?? peel(s1, w.ends[0], to[0]!)?.reverse() ?? [s0 ?? to[0]!, s1 ?? to[to.length - 1]!])
      : s0 || !s1
        ? chain(pieces, s0 ?? to[0]!)
        : chain(pieces, s1).reverse();
    w.ends.forEach((e, k) => {
      if (e.kind === "free" && !(k === 0 ? s0 : s1)) freeStart.set(e.name, k === 0 ? from[0]! : from[from.length - 1]!);
    });
    wires.push({ id: String(id), ends: w.ends, from: resample(from, SAMPLES), to, fade: false });
  }
  for (const [id, r] of before.routed.wires) {
    if (after.net.wires.has(id) || used.has(id)) continue;
    const pts = resample(flattenPath(r, G.radius), SAMPLES);
    wires.push({ id: `gone-${id}`, from: pts, to: pts, fade: true });
  }

  const free = [...after.routed.free].map(([name, f]) => ({ name, from: before.routed.free.get(name) ?? freeStart.get(name) ?? f, to: f }));

  return {
    at(raw: number): Frame {
      const t = ease(Math.min(1, Math.max(0, raw)));
      const agents: AgentFrame[] = [];
      const now = new Map<AgentId, Pose>();
      for (const tr of tracks.values()) {
        const p = lerpPose(tr.from, tr.to, t);
        now.set(tr.id, p);
        agents.push({ id: tr.id, type: tr.type, arity: tr.arity, ...tr.look, ...p });
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

/** A polyline cut in two at half its length, both halves running the same way as it. */
function splitHalfway(path: Pt[]): [Pt[], Pt[]] {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1]!, path[i]!);
  let left = total / 2;
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1]!, path[i]!);
    if (d >= left && d > 0) {
      const mid = lerpPt(path[i - 1]!, path[i]!, left / d);
      return [[...path.slice(0, i), mid], [mid, ...path.slice(i)]];
    }
    left -= d;
  }
  return [path, [path[path.length - 1]!]];
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
