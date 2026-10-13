import { type AgentId, type Net, type WireId } from "../core/net";
import { ifaceName, interfacePins, ruleToNet } from "../core/ruleNet";
import type { Rule, System } from "../core/system";
import { type Box, type Placed, type Placement, type Pt, type Terminal, boxOf, portPos } from "./geometry";
import { autoLayout } from "./place";

/**
 * Where firing an active pair puts the agents its rule creates.
 *
 * A step is shown as what it is: the pair is replaced by the rule's
 * right-hand side, drawn exactly as the rule editor draws it, in a frame
 * placed in free space next to the pair. Pointing at the pair previews that
 * frame, with dashed links from each of the pair's aux ports to the
 * interface pin it joins; firing puts the new agents where the preview
 * showed them, and only then does the net settle into its usual layout.
 */

/** A right-hand side as the rule editor draws it, centred on the origin. */
interface RuleDrawing {
  /** Index-aligned with `rule.agents`. */
  agents: Placed[];
  wires: Pt[][];
  /** Interface pins by name (L1, R2, …). */
  pins: Map<string, Terminal>;
  /** The frame: top pins sit on its top edge, bottom pins on its bottom edge. */
  frame: Box;
}

const FRAME_PAD = 12;

const drawings = new WeakMap<Rule, RuleDrawing>();

function drawRule(sys: System, rule: Rule): RuleDrawing {
  const cached = drawings.get(rule);
  if (cached) return cached;
  const net = ruleToNet(sys, rule);
  const pins = interfacePins(sys, rule.left, rule.right);
  const l = autoLayout(net, { pins });
  const ids = [...net.agents.keys()];
  const b = l.routed.bounds;
  const pinYs = (names: string[]) => names.map((n) => l.routed.free.get(n)?.y).filter((y): y is number => y !== undefined);
  const top = pinYs(pins.top);
  const bottom = pinYs(pins.bottom);
  const frame = {
    x0: b.x0 - FRAME_PAD,
    x1: b.x1 + FRAME_PAD,
    y0: top.length ? Math.min(...top) : b.y0 - FRAME_PAD,
    y1: bottom.length ? Math.max(...bottom) : b.y1 + FRAME_PAD,
  };
  const cx = (frame.x0 + frame.x1) / 2;
  const cy = (frame.y0 + frame.y1) / 2;
  const at = <T extends Pt>(p: T): T => ({ ...p, x: p.x - cx, y: p.y - cy });
  const d: RuleDrawing = {
    agents: ids.map((id) => at(l.placement.get(id)!)),
    wires: [...l.routed.wires.values()].map((pts) => pts.map(at)),
    pins: new Map([...l.routed.free].map(([n, t]) => [n, at(t)])),
    frame: { x0: frame.x0 - cx, x1: frame.x1 - cx, y0: frame.y0 - cy, y1: frame.y1 - cy },
  };
  drawings.set(rule, d);
  return d;
}

export interface StepPlan {
  wire: WireId;
  rule: Rule;
  /** The interacting agents. */
  pair: [AgentId, AgentId];
  /** Where each agent the rule creates goes, index-aligned with `rule.agents`. */
  agents: Placed[];
  /** The right-hand side's own wires, inside the frame. */
  wires: Pt[][];
  frame: Box;
  /** From each aux port of the pair to the interface pin it will be joined to, routed round the frame. */
  links: Pt[][];
  /** Drawn upside down (a half turn) from how the rule editor shows it. */
  turned: boolean;
}

export interface PlanOptions {
  /** Allow a half turn when it fits the pair better. Otherwise the frame is exactly the rule editor's drawing. */
  turn?: boolean;
}

/**
 * Plan the firing of some active pairs. Rules that create no agents get no
 * plan (they only reconnect wires). Each frame avoids the agents and wires
 * already drawn, and the frames planned before it.
 */
export function planSteps(
  net: Net,
  sys: System,
  layout: { placement: Placement; wires: Map<WireId, Pt[]> },
  ws: WireId[],
  opts: PlanOptions = {},
): Map<WireId, StepPlan> {
  const plans = new Map<WireId, StepPlan>();
  const taken: Box[] = [];
  for (const w of ws) {
    const p = planOne(net, sys, layout, w, taken, opts);
    if (!p) continue;
    plans.set(w, p);
    taken.push(p.frame);
  }
  return plans;
}

/** Frames are tried at points on a grid this fine around the pair. */
const GRID = 16;

function planOne(
  net: Net,
  sys: System,
  layout: { placement: Placement; wires: Map<WireId, Pt[]> },
  w: WireId,
  taken: Box[],
  opts: PlanOptions,
): StepPlan | undefined {
  if (!net.wires.has(w)) return undefined;
  const [a, b] = net.wire(w).ends;
  if (a.kind !== "port" || b.kind !== "port" || a.slot !== 0 || b.slot !== 0) return undefined;
  const found = sys.ruleFor(net.agent(a.agent).type, net.agent(b.agent).type);
  if (!found || !found.rule.agents.length) return undefined;
  const pair: [AgentId, AgentId] = found.swapped ? [b.agent, a.agent] : [a.agent, b.agent];
  const placed = pair.map((id) => layout.placement.get(id));
  if (!placed[0] || !placed[1]) return undefined;
  const d = drawRule(sys, found.rule);

  const arity = (id: AgentId) => net.agent(id).wires.length - 1;
  const pairBoxes = pair.map((id, i) => boxOf(placed[i]!, arity(id)));
  const pairBox = union(pairBoxes);
  const centre = { x: (pairBox.x0 + pairBox.x1) / 2, y: (pairBox.y0 + pairBox.y1) / 2 };
  const fw = d.frame.x1 - d.frame.x0;
  const fh = d.frame.y1 - d.frame.y0;

  // Only what's near enough to be covered matters.
  const reach = Math.max(fw, fh) + Math.max(pairBox.x1 - pairBox.x0, pairBox.y1 - pairBox.y0) + 3 * GRID;
  const near = (bx: Box) =>
    bx.x1 > centre.x - reach && bx.x0 < centre.x + reach && bx.y1 > centre.y - reach && bx.y0 < centre.y + reach;
  const obstacles: Box[] = [];
  for (const [id, p] of layout.placement) {
    if (id === pair[0] || id === pair[1] || !net.agents.has(id)) continue;
    const bx = grow(boxOf(p, arity(id)), 6);
    if (near(bx)) obstacles.push(bx);
  }
  obstacles.push(...taken.map((t) => grow(t, 8)));
  const segments: [Pt, Pt][] = [];
  for (const pts of layout.wires.values())
    for (let i = 1; i < pts.length; i++) {
      const s: [Pt, Pt] = [pts[i - 1]!, pts[i]!];
      if (near(union([pointBox(s[0]), pointBox(s[1])]))) segments.push(s);
    }
  // Each aux port of the pair, and the pin it joins.
  const ports: [Terminal, string][] = [];
  pair.forEach((id, side) => {
    for (let slot = 1; slot <= arity(id); slot++)
      ports.push([portPos(placed[side]!, arity(id), slot), ifaceName(side as 0 | 1, slot)]);
  });
  // Leave room between the pair and its frame for links coming round the side.
  const keepClear = pairBoxes.map((bx) => grow(bx, 2 * STUB + LANE_GAP * ports.length));

  const steps = Math.min(14, Math.ceil(reach / GRID));
  let best: { cost: number; at: Pt; turned: boolean } | undefined;
  for (const turned of opts.turn ? [false, true] : [false]) {
    for (let i = -steps; i <= steps; i++) {
      for (let j = -steps; j <= steps; j++) {
        const at = { x: centre.x + i * GRID, y: centre.y + j * GRID };
        const frame = { x0: at.x - fw / 2, x1: at.x + fw / 2, y0: at.y - fh / 2, y1: at.y + fh / 2 };
        if (keepClear.some((k) => overlap(k, frame) > 0)) continue;
        let cost = Math.hypot(at.x - centre.x, at.y - centre.y);
        for (const o of obstacles) {
          const area = overlap(o, frame);
          if (area > 0) cost += 2000 + area;
        }
        for (const [p, q] of segments) if (segmentHitsBox(p, q, frame)) cost += 150;
        const links = ports.map(([t, pin]) => [t, pinAt(d, pin, at, turned)] as const);
        for (const [p, q] of links) if (q) cost += 0.5 * Math.hypot(p.x - q.x, p.y - q.y);
        for (let x = 0; x < links.length; x++)
          for (let y = x + 1; y < links.length; y++) {
            const [p1, q1] = links[x]!;
            const [p2, q2] = links[y]!;
            if (q1 && q2 && segmentsCross(p1, q1, p2, q2)) cost += 40;
          }
        if (!best || cost < best.cost - 1e-6) best = { cost, at, turned };
      }
    }
  }
  if (!best) return undefined;
  const { at, turned } = best;
  const move = <T extends Pt>(p: T): T => (turned ? { ...p, x: at.x - p.x, y: at.y - p.y } : { ...p, x: at.x + p.x, y: at.y + p.y });
  return {
    wire: w,
    rule: found.rule,
    pair,
    agents: d.agents.map((p) => ({ ...move(p), orient: turned ? (p.orient === "down" ? "up" : "down") : p.orient })),
    wires: d.wires.map((pts) => pts.map(move)),
    frame: { x0: at.x - fw / 2, x1: at.x + fw / 2, y0: at.y - fh / 2, y1: at.y + fh / 2 },
    links: routeLinks(
      ports.flatMap(([t, pin]) => {
        const q = pinAt(d, pin, at, turned);
        return q ? [[t, q] as [Terminal, Terminal]] : [];
      }),
      { x0: at.x - fw / 2, x1: at.x + fw / 2, y0: at.y - fh / 2, y1: at.y + fh / 2 },
    ),
    turned,
  };
}

function pinAt(d: RuleDrawing, name: string, at: Pt, turned: boolean): Terminal | undefined {
  const p = d.pins.get(name);
  if (!p) return undefined;
  return turned
    ? { x: at.x - p.x, y: at.y - p.y, dir: p.dir === "up" ? "down" : "up" }
    : { x: at.x + p.x, y: at.y + p.y, dir: p.dir };
}

/** How far a link runs straight out of a port or pin before it turns. */
const STUB = 12;
/** Between neighbouring links running down the side of a frame. */
const LANE_GAP = 6;

/**
 * Links run like wires, vertically and horizontally between rounded
 * corners. One that has to come round to the far side of its pin goes down
 * a lane beside the frame, on whichever side its port is.
 */
function routeLinks(links: [Terminal, Terminal][], frame: Box): Pt[][] {
  const cx = (frame.x0 + frame.x1) / 2;
  const lanes = { left: 0, right: 0 };
  // Outer ports take outer lanes, so the lanes don't cross each other.
  const order = links.map((_, i) => i).sort((a, b) => Math.abs(links[b]![0].x - cx) - Math.abs(links[a]![0].x - cx));
  const out: Pt[][] = [];
  order.forEach((i, k) => {
    const [p, q] = links[i]!;
    // Work as if the pin is on the top edge; a bottom pin is the same upside down.
    const flip = q.dir === "down";
    const fy = (y: number) => (flip ? -y : y);
    const P = { x: p.x, y: fy(p.y) };
    const up = (p.dir === "up") !== flip;
    const Q = { x: q.x, y: fy(q.y) };
    const top = flip ? -frame.y1 : frame.y0;
    // Horizontal runs are staggered so links sharing a level don't overlap.
    const stagger = k * 5;
    let pts: Pt[];
    if (up && !(P.x > frame.x0 && P.x < frame.x1 && P.y > top)) {
      // Rise to above the pin, cross over, drop in.
      const y = Math.min(P.y, Q.y) - STUB - stagger;
      pts = [P, { x: P.x, y }, { x: Q.x, y }, Q];
    } else if (!up && P.y + 2 * STUB < Q.y) {
      // Already above the frame: drop partway, cross over, drop in.
      const y = Q.y - STUB - stagger;
      pts = [P, { x: P.x, y }, { x: Q.x, y }, Q];
    } else {
      // Come round the side of the frame, on the port's side.
      const side = P.x < cx ? "left" : "right";
      const n = lanes[side]++;
      const x = side === "left" ? frame.x0 - STUB - n * LANE_GAP : frame.x1 + STUB + n * LANE_GAP;
      const y0 = up ? P.y - STUB : P.y + STUB;
      const y1 = Q.y - STUB - stagger;
      pts = [P, { x: P.x, y: y0 }, { x, y: y0 }, { x, y: y1 }, { x: Q.x, y: y1 }, Q];
    }
    out[i] = pts.map((pt) => ({ x: pt.x, y: fy(pt.y) }));
  });
  return out;
}

/**
 * Agents created by fired steps, placed where their plans put them.
 * `created` is index-aligned with each rule's agents, as in a step record.
 */
export function placeCreated(plans: Map<WireId, StepPlan>, steps: { wire: WireId; created: AgentId[] }[]): Placement {
  const out: Placement = new Map();
  for (const s of steps) {
    const p = plans.get(s.wire);
    if (p) s.created.forEach((id, i) => p.agents[i] && out.set(id, p.agents[i]!));
  }
  return out;
}

const union = (bs: Box[]): Box => ({
  x0: Math.min(...bs.map((b) => b.x0)),
  y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)),
  y1: Math.max(...bs.map((b) => b.y1)),
});
const pointBox = (p: Pt): Box => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Whether a segment passes through a box (Liang–Barsky clipping). */
function segmentHitsBox(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [num, den] of [
    [p.x - b.x0, -dx],
    [b.x1 - p.x, dx],
    [p.y - b.y0, -dy],
    [b.y1 - p.y, dy],
  ] as const) {
    if (den === 0) {
      if (num < 0) return false;
    } else {
      const t = num / den;
      if (den < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
