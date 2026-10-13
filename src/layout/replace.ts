import { type AgentId, type End, type Net, NONE, type WireId, free, port, sameEnd } from "../core/net";
import { type StepRecord, interact, isActive } from "../core/reduce";
import { ifaceName, interfacePins, ruleToNet } from "../core/ruleNet";
import type { Rule, System } from "../core/system";
import { flattenPath } from "../render/path";
import { type Box, G, type Placed, type Placement, type Pt, type Terminal, boxOf, portPos } from "./geometry";
import { autoLayout } from "./place";
import { type Pins, type RouteOptions, type Routed, crossings, length as pathLength, route } from "./route";

/**
 * What firing active pairs will do, shown before it happens.
 *
 * A step is shown as what it is: the pair is replaced by the rule's
 * right-hand side, its agents placed exactly as the rule editor places them,
 * in a frame in free space next to the pair. To preview it we fire the step
 * on a copy of the net, keep every other agent where it is drawn (as if the
 * layout were manual), and route the wires as usual. Each new wire starts
 * from wherever its old wire came from; the stretch it shares with that old
 * wire is already on screen, so only the rest is drawn, dashed outside the
 * frame and solid inside it. Firing then starts from exactly that drawing,
 * and only afterwards does the net settle into its usual layout.
 */

/** A right-hand side as the rule editor draws it, centred on the origin. */
interface RuleDrawing {
  /** Index-aligned with `rule.agents`. */
  agents: Placed[];
  /** Interface pins by name (L1, R2, …), for judging where the frame fits best. */
  pins: Map<string, Terminal>;
  /** Around the agents and the wires between them. */
  frame: Box;
}

const FRAME_PAD = 14;

const drawings = new WeakMap<Rule, RuleDrawing>();

function drawRule(sys: System, rule: Rule): RuleDrawing {
  const cached = drawings.get(rule);
  if (cached) return cached;
  const net = ruleToNet(sys, rule);
  const pins = interfacePins(sys, rule.left, rule.right);
  const l = autoLayout(net, { pins });
  const ids = [...net.agents.keys()];
  const boxes = ids.map((id) => boxOf(l.placement.get(id)!, net.agent(id).wires.length - 1));
  for (const [id, pts] of l.routed.wires) {
    const [a, b] = net.wire(id).ends;
    if (a.kind === "port" && b.kind === "port") boxes.push(...pts.map(pointBox));
  }
  const b = grow(union(boxes), FRAME_PAD);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const at = <T extends Pt>(p: T): T => ({ ...p, x: p.x - cx, y: p.y - cy });
  const d: RuleDrawing = {
    agents: ids.map((id) => at(l.placement.get(id)!)),
    pins: new Map([...l.routed.free].map(([n, t]) => [n, at(t)])),
    frame: { x0: b.x0 - cx, x1: b.x1 - cx, y0: b.y0 - cy, y1: b.y1 - cy },
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
  frame: Box;
  /**
   * Turned a half turn from how the rule editor draws it, because that suits
   * the pair better. Only the whole drawing turns; nothing in it changes.
   */
  turned: boolean;
}

/** The net as drawn: what a preview starts from. */
export interface Drawn {
  placement: Placement;
  routed: Routed;
  /** Columns the layout asked wires to run in, so rerouting keeps them. */
  columns?: Map<string, number>;
  pins?: Pins;
}

/**
 * Plan the firing of some active pairs. Rules that create no agents get no
 * plan (they only reconnect wires). Each frame avoids the agents and wires
 * already drawn, and the frames planned before it.
 */
export function planSteps(net: Net, sys: System, drawn: Drawn, ws: WireId[]): Map<WireId, StepPlan> {
  const plans = new Map<WireId, StepPlan>();
  const taken: Box[] = [];
  for (const w of ws) {
    // Routing each candidate for real is worth it for a few pairs, not for many.
    const p = planOne(net, sys, drawn, w, taken, ws.length <= ROUTED_PAIRS ? ROUTED_CANDIDATES : 1);
    if (!p) continue;
    plans.set(w, p);
    taken.push(p.frame);
  }
  return plans;
}

/** Frames are tried at points on a grid this fine around the pair. */
const GRID = 16;
/** Room left between a pair and its frame. */
const CLEAR = 22;
/** How many of the best-looking places to route for real before choosing, and for up to how many pairs at once. */
const ROUTED_CANDIDATES = 8;
const ROUTED_PAIRS = 4;

function planOne(
  net: Net,
  sys: System,
  drawn: Drawn,
  w: WireId,
  taken: Box[],
  routed: number,
): StepPlan | undefined {
  if (!net.wires.has(w)) return undefined;
  const [a, b] = net.wire(w).ends;
  if (a.kind !== "port" || b.kind !== "port" || a.slot !== 0 || b.slot !== 0) return undefined;
  const found = sys.ruleFor(net.agent(a.agent).type, net.agent(b.agent).type);
  if (!found || !found.rule.agents.length) return undefined;
  const pair: [AgentId, AgentId] = found.swapped ? [b.agent, a.agent] : [a.agent, b.agent];
  const placed = pair.map((id) => drawn.placement.get(id));
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
  for (const [id, p] of drawn.placement) {
    if (id === pair[0] || id === pair[1] || !net.agents.has(id)) continue;
    const bx = grow(boxOf(p, arity(id)), 6);
    if (near(bx)) obstacles.push(bx);
  }
  // Loose ends stay where they are in a preview, with their labels beside them.
  for (const f of drawn.routed.free.values()) {
    const bx = grow(pointBox(f), 14);
    if (near(bx)) obstacles.push(bx);
  }
  obstacles.push(...taken.map((t) => grow(t, 8)));
  const segments: [Pt, Pt][] = [];
  for (const pts of drawn.routed.wires.values())
    for (let i = 1; i < pts.length; i++) {
      const s: [Pt, Pt] = [pts[i - 1]!, pts[i]!];
      if (near(union([pointBox(s[0]), pointBox(s[1])]))) segments.push(s);
    }
  // Each aux port of the pair, and the pin of the rule's interface it stands for.
  const ports: [Terminal, string][] = [];
  pair.forEach((id, side) => {
    for (let slot = 1; slot <= arity(id); slot++)
      ports.push([portPos(placed[side]!, arity(id), slot), ifaceName(side as 0 | 1, slot)]);
  });
  const keepClear = pairBoxes.map((bx) => grow(bx, CLEAR));

  const steps = Math.min(14, Math.ceil(reach / GRID));
  const candidates: { cost: number; at: Pt; turned: boolean }[] = [];
  for (const turned of [false, true]) {
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
        // Short, uncrossed runs from each aux port to where its pin would be.
        const links = ports.map(([t, pin]) => [t, pinAt(d, pin, at, turned)] as const);
        for (const [p, q] of links) if (q) cost += 0.5 * Math.hypot(p.x - q.x, p.y - q.y);
        for (let x = 0; x < links.length; x++)
          for (let y = x + 1; y < links.length; y++) {
            const [p1, q1] = links[x]!;
            const [p2, q2] = links[y]!;
            if (q1 && q2 && segmentsCross(p1, q1, p2, q2)) cost += 40;
          }
        candidates.push({ cost, at, turned });
      }
    }
  }
  if (!candidates.length) return undefined;
  const planAt = ({ at, turned }: { at: Pt; turned: boolean }): StepPlan => {
    const move = <T extends Pt>(p: T): T => (turned ? { ...p, x: at.x - p.x, y: at.y - p.y } : { ...p, x: at.x + p.x, y: at.y + p.y });
    return {
      wire: w,
      rule: found.rule,
      pair,
      agents: d.agents.map((p) => ({ ...move(p), orient: turned ? (p.orient === "down" ? "up" : "down") : p.orient })),
      frame: { x0: at.x - fw / 2, x1: at.x + fw / 2, y0: at.y - fh / 2, y1: at.y + fh / 2 },
      turned,
    };
  };
  candidates.sort((x, y) => x.cost - y.cost);
  // The best few places, not all bunched together, judged by how the wires would actually run.
  const shortlist: typeof candidates = [];
  for (const c of candidates) {
    if (shortlist.length >= routed) break;
    if (shortlist.some((o) => o.turned === c.turned && Math.hypot(o.at.x - c.at.x, o.at.y - c.at.y) < 2 * GRID)) continue;
    shortlist.push(c);
  }
  if (shortlist.length === 1) return planAt(shortlist[0]!);
  let best: { plan: StepPlan; cost: number } | undefined;
  for (const c of shortlist) {
    const plan = planAt(c);
    const cost = c.cost + routingCost(net, sys, drawn, plan);
    if (!best || cost < best.cost - 1e-6) best = { plan, cost };
  }
  return best!.plan;
}

/** How tangled the net would be drawn right after firing a planned step: crossings, wires over loose ends, and length. */
function routingCost(net: Net, sys: System, drawn: Drawn, plan: StepPlan): number {
  const tmp = net.clone();
  const rec = interact(tmp, sys, plan.wire);
  const placement = new Map(drawn.placement);
  rec.removed.forEach((id) => placement.delete(id));
  rec.created.forEach((id, i) => placement.set(id, plan.agents[i]!));
  const r = routeHoldingEnds(tmp, placement, { columns: drawn.columns, pins: drawn.pins }, drawn.routed.free);
  let cost = crossings(r.wires) * 300 + r.arounds * 400;
  for (const pts of r.wires.values()) cost += pathLength(pts);
  // A wire running over a loose end that isn't its own makes the end unreadable.
  for (const [name, at] of r.free) {
    const own = tmp.free.get(name);
    for (const [id, pts] of r.wires) {
      if (id === own) continue;
      for (let i = 1; i < pts.length; i++) if (segmentHitsBox(pts[i - 1]!, pts[i]!, grow(pointBox(at), 6))) cost += 500;
    }
  }
  return cost;
}

function pinAt(d: RuleDrawing, name: string, at: Pt, turned: boolean): Terminal | undefined {
  const p = d.pins.get(name);
  if (!p) return undefined;
  return turned
    ? { x: at.x - p.x, y: at.y - p.y, dir: p.dir === "up" ? "down" : "up" }
    : { x: at.x + p.x, y: at.y + p.y, dir: p.dir };
}

export interface StepPreview {
  plans: Map<WireId, StepPlan>;
  /** The pairs that fire. */
  wires: WireId[];
  /** The agents the steps take away. */
  agents: AgentId[];
  /** Wires drawn now that the steps take away or reroute, all or in part. */
  fading: WireId[];
  /** The stretches of those wires that stay as they are. */
  kept: Pt[][];
  /** The new stretches of wire: dashed outside a frame, solid inside one. */
  strokes: { pts: Pt[]; dashed: boolean }[];
  /**
   * Frames round pairs whose rule creates nothing, where they are now, so
   * each disappearance reads as a rule of its own rather than a side effect.
   */
  vanishing: Box[];
}

/** Preview firing some active pairs (at once, as in a parallel step). */
export function previewSteps(net: Net, sys: System, drawn: Drawn, ws: WireId[]): StepPreview {
  const plans = planSteps(net, sys, drawn, ws);
  const tmp = net.clone();
  const placement = new Map(drawn.placement);
  const fired: WireId[] = [];
  const vanishing: Box[] = [];
  const agents: AgentId[] = [];
  const recs: StepRecord[] = [];
  for (const w of ws) {
    if (!tmp.wires.has(w) || !isActive(tmp, w)) continue;
    const [a, b] = tmp.wire(w).ends as [Extract<End, { kind: "port" }>, Extract<End, { kind: "port" }>];
    const found = sys.ruleFor(tmp.agent(a.agent).type, tmp.agent(b.agent).type);
    if (!found || (found.rule.agents.length && !plans.has(w))) continue;
    const rec = interact(tmp, sys, w);
    recs.push(rec);
    fired.push(w);
    agents.push(...rec.removed);
    rec.removed.forEach((id) => placement.delete(id));
    const plan = plans.get(w);
    if (plan) rec.created.forEach((id, i) => placement.set(id, plan.agents[i]!));
    else {
      const boxes = rec.removed.flatMap((id) => {
        const p = drawn.placement.get(id);
        return p ? [boxOf(p, net.agent(id).wires.length - 1)] : [];
      });
      // Wide enough to take in the ports on the agents' edges.
      if (boxes.length) vanishing.push(grow(union(boxes), 8));
    }
  }
  const routed = routeHoldingEnds(tmp, placement, { columns: drawn.columns, pins: drawn.pins }, drawn.routed.free);

  // Which old wires each new wire continues, across every step.
  const origin = new Map<WireId, WireId[]>();
  const created = new Set<AgentId>();
  for (const rec of recs) {
    rec.created.forEach((id) => created.add(id));
    for (const c of rec.createdWires) origin.set(c.id, c.from.flatMap((f) => origin.get(f) ?? [f]));
  }
  const frames = [...plans.values()].map((p) => p.frame);
  const strokes: StepPreview["strokes"] = [];
  const kept: Pt[][] = [];
  const oldAt = (e: End): Pt | undefined => endAt(net, drawn.placement, drawn.routed, e);
  for (const [id, from] of origin) {
    if (!tmp.wires.has(id)) continue;
    const pts = routed.wires.get(id);
    if (!pts) continue;
    let path = flattenPath(pts, G.radius);
    if (path.length < 2) continue;
    const ends = tmp.wire(id).ends;
    // Run the path from its first end to its second.
    const p0 = endAt(tmp, placement, routed, ends[0]);
    if (p0 && dist(path[path.length - 1]!, p0) < dist(path[0]!, p0)) path = [...path].reverse();
    // At an end that was there before the step, skip what the old wire already shows.
    const shared = ends.map((e) => {
      if (e.kind === "port" && created.has(e.agent)) return 0;
      const at = oldAt(e);
      const old = from.find((o) => net.wires.has(o) && net.wire(o).ends.some((x) => sameEnd(x, e)));
      const oldPts = old === undefined ? undefined : drawn.routed.wires.get(old);
      if (!at || !oldPts) return 0;
      let o = flattenPath(oldPts, G.radius);
      if (dist(o[o.length - 1]!, at) < dist(o[0]!, at)) o = [...o].reverse();
      const n = commonLength(o, ends[0] === e ? path : [...path].reverse());
      if (n > 0) kept.push(slice(o, 0, n));
      return n;
    });
    const len = length(path);
    if (shared[0]! + shared[1]! >= len - 1) continue;
    const fresh = slice(path, shared[0]!, len - shared[1]!);
    strokes.push(...splitByFrames(fresh, frames));
  }
  const gone = new Set(agents);
  const fading = [...net.wires.values()]
    .filter((x) => x.ends.some((e) => e.kind === "port" && gone.has(e.agent)))
    .map((x) => x.id);
  return { plans, wires: fired, agents, fading, kept, strokes, vanishing };
}

/**
 * Route a net with its loose ends held where they're drawn now, rather than
 * on the lines above and below the net where routing would put them. Each
 * held end stands in as a tiny agent at its place, facing back into the net.
 */
export function routeHoldingEnds(net: Net, placement: Placement, opts: RouteOptions, ends: Map<string, Terminal>): Routed {
  const tmp = net.clone();
  const pl = new Map(placement);
  const held = new Map<string, Terminal>();
  for (const name of [...tmp.free.keys()]) {
    const w = tmp.free.get(name)!;
    const at = ends.get(name);
    if (w === NONE || !at || !tmp.wires.has(w)) continue;
    const other = tmp.partner(free(name))!;
    tmp.disconnect(w);
    tmp.free.delete(name);
    const stand = tmp.addAgent({ id: "·", name: "", symbol: "", arity: 0 });
    const orient = at.dir === "up" ? "down" : "up";
    pl.set(stand, { x: at.x, y: orient === "up" ? at.y + G.circleR : at.y - G.circleR, orient });
    tmp.connect(port(stand, 0), other, w);
    held.set(name, at);
  }
  const routed = route(tmp, pl, opts);
  for (const [name, at] of held) routed.free.set(name, at);
  return routed;
}

/** Where an end is drawn. */
function endAt(net: Net, placement: Placement, routed: Routed, e: End): Pt | undefined {
  if (e.kind === "free") return routed.free.get(e.name);
  const p = placement.get(e.agent);
  return p && net.agents.has(e.agent) ? portPos(p, net.agent(e.agent).wires.length - 1, e.slot) : undefined;
}

/** How far two paths starting at the same point run together. */
function commonLength(a: Pt[], b: Pt[]): number {
  if (!a.length || !b.length || dist(a[0]!, b[0]!) > 1) return 0;
  const la = length(a);
  const lb = length(b);
  const end = Math.min(la, lb);
  const STEP = 1.5;
  let s = 0;
  for (; s <= end; s += STEP) if (dist(pointAt(a, s), pointAt(b, s)) > 1) return Math.max(0, s - STEP);
  return end;
}

function length(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}

function pointAt(pts: Pt[], s: number): Pt {
  let left = s;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = dist(a, b);
    if (left <= l && l > 0) return { x: a.x + ((b.x - a.x) * left) / l, y: a.y + ((b.y - a.y) * left) / l };
    left -= l;
  }
  return pts[pts.length - 1]!;
}

/** The part of a path between two distances along it. */
function slice(pts: Pt[], from: number, to: number): Pt[] {
  const out: Pt[] = [pointAt(pts, from)];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += dist(pts[i - 1]!, pts[i]!);
    if (s > from && s < to) out.push(pts[i]!);
  }
  out.push(pointAt(pts, to));
  return out;
}

/** Cut a path where it crosses into or out of a frame. */
function splitByFrames(pts: Pt[], frames: Box[]): { pts: Pt[]; dashed: boolean }[] {
  const inside = (p: Pt) => frames.some((f) => p.x >= f.x0 && p.x <= f.x1 && p.y >= f.y0 && p.y <= f.y1);
  // Fine enough that the cut lands near the frame's edge.
  const dense: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(dist(a, b) / 2));
    for (let k = 1; k <= n; k++) dense.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const out: { pts: Pt[]; dashed: boolean }[] = [];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i]!;
    const dashed = !inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const last = out[out.length - 1];
    if (last && last.dashed === dashed) last.pts.push(b);
    else out.push({ pts: [a, b], dashed });
  }
  return out;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

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
