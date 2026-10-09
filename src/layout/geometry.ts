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
  /** Drawn as a circle rather than a triangle. Unset means circles only for agents with no aux ports. */
  round?: boolean;
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

export function shape(arity: number, round = arity === 0): Shape {
  if (round) {
    // Aux ports sit where they would on a triangle, on the circle's far side.
    const r = arity === 0 ? G.circleR : Math.max(G.agentH / 2, ((arity - 1) * G.portGap) / 2 + 7);
    return { w: r * 2, h: r * 2, circle: true };
  }
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
  const s = shape(arity, p.round);
  const sign = p.orient === "down" ? 1 : -1;
  if (slot === 0) return { x: p.x, y: p.y + (sign * s.h) / 2, dir: p.orient };
  const off = (slot - (arity + 1) / 2) * G.portGap;
  const back = s.circle ? Math.sqrt(Math.max(0, (s.h / 2) ** 2 - off * off)) : s.h / 2;
  return { x: p.x + sign * off, y: p.y - sign * back, dir: p.orient === "down" ? "up" : "down" };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxOf(p: Placed, arity: number): Box {
  const s = shape(arity, p.round);
  return { x0: p.x - s.w / 2, y0: p.y - s.h / 2, x1: p.x + s.w / 2, y1: p.y + s.h / 2 };
}
