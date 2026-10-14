import type { AgentId } from "../core/net";

export interface Pt {
  x: number;
  y: number;
  /** The segment arriving at this point is a smooth S-curve rather than a straight line. */
  s?: boolean;
}

/** Which way an agent's principal port points. Agents only ever point up or down. */
export type Orient = "up" | "down";

export interface Placed {
  x: number;
  y: number;
  orient: Orient;
}

export type Placement = Map<AgentId, Placed>;

/** Spacing constants, in drawing units. */
export const G = {
  /** Distance between neighbouring aux ports on an agent. */
  portGap: 16,
  /** Minimum distance between parallel wires. */
  wireGap: 10,
  /** Vertical distance between tree levels. */
  layerH: 60,
  /** Gap between the two tips of an active pair. */
  pairGap: 26,
  /** Horizontal gap between independent parts of the net. */
  unitGap: 28,
  /** Horizontal gap between nets that aren't connected at all. */
  netGap: 40,
  /** Corner radius for wire bends. */
  radius: 9,
  /** Height of every triangular agent. */
  agentH: 30,
  /** Radius of nullary agents (drawn as circles). */
  circleR: 8,
  /** How far below the net free ports sit. */
  freeMargin: 30,
};

export interface Shape {
  w: number;
  h: number;
  circle: boolean;
}

export function shape(arity: number): Shape {
  if (arity === 0) return { w: G.circleR * 2, h: G.circleR * 2, circle: true };
  const w = (arity + 1) * G.portGap;
  // Every triangle is the same height; more aux ports only make it wider.
  return { w, h: G.agentH, circle: false };
}

export interface Terminal extends Pt {
  /** Direction the wire leaves in. */
  dir: Orient;
}

/**
 * Where a port sits. Slot 0 is the tip; aux ports sit along the base,
 * clockwise from the tip, so for ▽ they run left to right and for △ right
 * to left.
 */
export function portPos(p: Placed, arity: number, slot: number): Terminal {
  const s = shape(arity);
  const sign = p.orient === "down" ? 1 : -1;
  if (slot === 0) return { x: p.x, y: p.y + (sign * s.h) / 2, dir: p.orient };
  const off = (slot - (arity + 1) / 2) * G.portGap;
  return { x: p.x + sign * off, y: p.y - (sign * s.h) / 2, dir: p.orient === "down" ? "up" : "down" };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxOf(p: Placed, arity: number): Box {
  const s = shape(arity);
  return { x0: p.x - s.w / 2, y0: p.y - s.h / 2, x1: p.x + s.w / 2, y1: p.y + s.h / 2 };
}

/** Whether the segment from `a` to `b` touches the box (clipped Liang–Barsky style). */
export function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    return t0 <= t1;
  };
  return clip(-dx, a.x - box.x0) && clip(dx, box.x1 - a.x) && clip(-dy, a.y - box.y0) && clip(dy, box.y1 - a.y);
}

/** The outline of an agent as drawn, shrunk by `inset` so grazing an edge doesn't count. */
export function agentOutline(p: Placed, arity: number, inset = 0): Pt[] {
  const s = shape(arity);
  if (s.circle) {
    const r = s.w / 2 - inset;
    const at = (i: number) => (i * Math.PI) / 6;
    return Array.from({ length: 12 }, (_, i) => ({ x: p.x + r * Math.cos(at(i)), y: p.y + r * Math.sin(at(i)) }));
  }
  const sign = p.orient === "down" ? 1 : -1;
  // The slanted sides are about twice as long as the triangle is tall, so move the corners in twice as far.
  const by = p.y - sign * (s.h / 2 - inset);
  return [
    { x: p.x, y: p.y + sign * (s.h / 2 - inset * 2) },
    { x: p.x - s.w / 2 + inset * 2, y: by },
    { x: p.x + s.w / 2 - inset * 2, y: by },
  ];
}

/**
 * Whether the segment from `a` to `b` passes through the inside of a convex
 * polygon (Cyrus–Beck clipping). Running along an edge or through a corner
 * doesn't count.
 */
export function segmentHitsPolygon(a: Pt, b: Pt, poly: Pt[]): boolean {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  const sign = area < 0 ? -1 : 1;
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j]!;
    const [ex, ey] = [poly[i]!.x - p.x, poly[i]!.y - p.y];
    // How far inside this edge the segment is at its start, and how fast that changes along it.
    const at = sign * (ex * (a.y - p.y) - ey * (a.x - p.x));
    const rate = sign * (ex * dy - ey * dx);
    if (Math.abs(rate) < 1e-9) {
      if (at <= 0) return false;
      continue;
    }
    if (rate > 0) t0 = Math.max(t0, -at / rate);
    else t1 = Math.min(t1, -at / rate);
    if (t0 >= t1 - 1e-9) return false;
  }
  return true;
}

/** How far a point is from the segment from `a` to `b`. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Whether the segment from `a` to `b` passes through a convex polygon or comes within `d` of it. */
export function segmentNearPolygon(a: Pt, b: Pt, poly: Pt[], d: number): boolean {
  if (segmentHitsPolygon(a, b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [p, q] = [poly[j]!, poly[i]!];
    if (Math.min(distanceToSegment(a, p, q), distanceToSegment(b, p, q), distanceToSegment(p, a, b), distanceToSegment(q, a, b)) < d)
      return true;
  }
  return false;
}

/** Whether a point lies inside a polygon (even-odd rule). */
export function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
