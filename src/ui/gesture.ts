import type { GroupId } from "../core/groups";
import { type AgentId, type End, type WireId, sameEnd } from "../core/net";
import type { Pt } from "../layout/geometry";
import type { DropCheck, Hover, WireGesture } from "../state/model";

/**
 * What the pointers are doing on a canvas, as a state machine: each pointer
 * event (or Escape) is a message, and `update` says what state follows and
 * what should happen to the net. The canvas turns DOM events into messages
 * and carries the effects out; everything that decides what a gesture does
 * is here.
 *
 * A mouse does one thing at a time. Fingers can do two: while one finger
 * carries a wire or agents, others move the view under it. In the phone
 * layout a finger held still does what the missing keys did (see `hold`).
 *
 *   idle ──down──▶ press ──moves──▶ wire | move
 *        ──mouse down──▶ marquee | pan | click-wire
 *        ──finger down──▶ tap ──moves──▶ pan
 *        ──finger down again just after a tap on nothing──▶ zoom ──up, not moved──▶ idle (zoomed in)
 *   tap ──held on nothing──▶ marquee ──up, not moved──▶ idle (a menu where it was held)
 *   tap ──held on a wire──▶ pan (its wire selected)
 *   press ──held on an agent──▶ press (the agent added or taken out)
 *   press | tap | zoom | pan | a finger's marquee ──another finger──▶ pan (pinching)
 *   wire | move ──another finger──▶ the same, with a grip on the view
 *   any ──up──▶ idle (finishing what it was doing), or pan (fingers left on the view)
 *   any ──cancel (Escape, lost pointer)──▶ idle (undoing what it was doing)
 */
export type Gesture =
  /**
   * A button or finger is down on a port or an agent, but hasn't moved far
   * enough to drag it. `tapped` is what a tap leaves hovered; `end`, the end
   * pressed, which a tap in the phone layout can start a wire from.
   */
  | { kind: "press"; on: "wire"; pointer: number; input: Input; g: WireGesture; start: Pt; tapped: Hover; end: End }
  /**
   * `waiting`: a finger in the phone layout on an agent, whose selecting
   * waits to see what the finger does. Lifted, it selects the agent; held,
   * it adds the agent to the selection or takes it out, and stops waiting;
   * dragged, it selects the agent and moves it.
   */
  | { kind: "press"; on: "move"; pointer: number; input: Input; start: Pt; at: Pt; tapped: Hover; waiting?: AgentId }
  /** A finger is down on a wire or on nothing (at `at` in the net): lifted where it is, it's a tap; moved, it pans. */
  | { kind: "tap"; pointer: number; start: Pt; at: Pt; on: TapOn }
  /** `screen` is where the pointer carrying the wire is; `grip`, other fingers moving the view meanwhile. */
  | { kind: "wire"; pointer: number; input: Input; g: WireGesture; cur: Pt; screen: Pt; target?: End; check?: DropCheck; grip?: Grip }
  | { kind: "move"; pointer: number; input: Input; last: Pt; screen: Pt; grip?: Grip }
  /** `finger`: drawn by a finger held on the canvas, which is there on screen now. */
  | { kind: "marquee"; pointer: number; start: Pt; cur: Pt; additive: boolean; moved: boolean; finger?: Pt }
  /**
   * A finger down again on nothing just after tapping there: lifted, it zooms
   * in about where it tapped; dragged up or down, it zooms out or in from
   * `origin`, about `start`, as maps do.
   */
  | { kind: "zoom"; pointer: number; start: Pt; origin: View; moved: boolean }
  /** `before` is the view to go back to if the pan is cancelled. */
  | { kind: "pan"; input: Input; grip: Grip; before: View; moved: boolean }
  | { kind: "click-wire"; pointer: number; id: WireId; alt: boolean };

/**
 * What a finger is tapping. `armed`: the wire had been tapped already, so
 * its preview is showing, and this tap does what it showed.
 */
export type TapOn = { kind: "wire"; id: WireId; armed: boolean; alt: boolean } | { kind: "none" };

/** The mouse, or a finger or pen on the screen. A pen goes by the rules for fingers. */
export type Input = "mouse" | "touch";

/** Where the canvas's view is: the net shifted by (x, y) screen pixels, at zoom k. */
export interface View {
  x: number;
  y: number;
  k: number;
}

/** A pointer holding the view: where it took hold and where it is now, in screen pixels. */
export interface Finger {
  id: number;
  from: Pt;
  at: Pt;
}

/**
 * Fingers (or the mouse) moving the view. One pans it; two pinch, zooming
 * as they spread or close and panning with their midpoint. Each finger's
 * `from` is where it was while the view was `origin`. When a finger joins
 * or leaves, the grip takes hold afresh where things are, so the view
 * doesn't jump.
 */
export interface Grip {
  origin: View;
  fingers: Finger[];
}

/** What's under the pointer when a button goes down. */
export type Hit =
  | { kind: "end"; end: End }
  | { kind: "agent"; id: AgentId }
  | { kind: "collapse"; group: GroupId }
  | { kind: "group"; group: GroupId }
  | { kind: "wire"; id: WireId }
  | { kind: "none" };

/**
 * Pointer positions come in screen pixels from the canvas's top left
 * (`screen`) and in the net's coordinates (`at`). `pointer` tells fingers
 * apart.
 */
export type Msg =
  | {
      kind: "down";
      pointer: number;
      input: Input;
      hit: Hit;
      button: number;
      screen: Pt;
      at: Pt;
      shift: boolean;
      alt: boolean;
      space: boolean;
      /** When, in milliseconds, to tell a double tap from two taps. */
      time: number;
    }
  /** `over` is the end really under the mouse (pointer capture hides it from the event). */
  | { kind: "move"; pointer: number; screen: Pt; at: Pt; over?: End }
  | { kind: "up"; pointer: number; alt: boolean; time: number }
  /** A finger has stayed put since the canvas was asked to wait for it (`await-hold`). */
  | { kind: "hold"; pointer: number }
  | { kind: "cancel" };

export type Effect =
  | { kind: "hover"; hover: Hover | undefined }
  | { kind: "pick"; id: AgentId; additive: boolean }
  | { kind: "pick-group"; group: GroupId; additive: boolean }
  | { kind: "collapse"; group: GroupId }
  | { kind: "begin-move" }
  | { kind: "move-by"; dx: number; dy: number }
  | { kind: "end-move" }
  | { kind: "cancel-move" }
  | { kind: "view"; view: View }
  | { kind: "select-in"; marquee: Extract<Gesture, { kind: "marquee" }> }
  | { kind: "clear-selection" }
  | { kind: "finish-wire"; g: WireGesture; to?: End }
  /** A wire drag called off: a carried wire goes back. */
  | { kind: "return-wire"; g: WireGesture }
  | { kind: "fire"; id: WireId }
  | { kind: "stuck"; id: WireId }
  | { kind: "select-wire"; id: WireId }
  /** Send a `hold` for this finger once it has been down for `HOLD`, unless it has lifted. */
  | { kind: "await-hold"; pointer: number }
  /** A hold has counted: a buzz, and a ring where the finger is. */
  | { kind: "held"; screen: Pt }
  /** A finger held on empty canvas and lifted: a menu there, at `screen`, for pasting at `at`. */
  | { kind: "hold-menu"; screen: Pt; at: Pt }
  /** A wire started by a tap on an end, to be finished by a tap on another; or, `disarm`, let go. */
  | { kind: "arm"; g: WireGesture }
  | { kind: "disarm" }
  /**
   * A finger's tap on the canvas, at `screen` and `time`; `empty`, on nothing.
   * The canvas remembers the last, for `Ctx.lastTap`.
   */
  | { kind: "tapped"; screen: Pt; time: number; empty: boolean }
  /** Zoom in or out by `by`, about a point on screen, gliding there. */
  | { kind: "zoom"; by: number; about: Pt };

/** What `update` needs to know about the canvas and its net. Reading only. */
export interface Ctx {
  readonly: boolean;
  gestureAt(e: End): WireGesture;
  checkDrop(g: WireGesture, to: End): DropCheck;
  isSelected(id: AgentId): boolean;
  /** Whether the wire is an active pair that clicking fires, or one with no rule that clicking opens. */
  clickable(id: WireId): "fire" | "stuck" | undefined;
  /** What's hovered: a tapped pair's preview shows while it is. */
  hover(): Hover | undefined;
  /** The ends within `reach` (in the net's units) of a point, nearest first. */
  near(at: Pt, reach: number): End[];
  view(): View;
  /** The last finger's tap on nothing, as the `tapped` effect told it, to tell a double tap. */
  lastTap(): { screen: Pt; time: number } | undefined;
  /**
   * Fingers in the phone layout (src/ui/phone). Holds count, a tap on an
   * agent waits to see whether it was a tap, and a tap on an empty port or
   * a loose end starts a wire, `armed` until a tap on another end finishes
   * it. Without it, fingers do as they always have.
   */
  phone?: { armed(): WireGesture | undefined };
}

/** How long a finger stays put, in milliseconds, before a press is a hold. */
export const HOLD = 420;

/** How soon, in milliseconds, and how near, in screen pixels, a second tap makes a double tap. */
export const DOUBLE = { time: 300, reach: 24 };

/** How much a double tap zooms in; and dragging after one, how far up or down, in screen pixels, zooms by e. */
export const DOUBLE_ZOOM = 2;
const ZOOM_DRAG = 150;

/** How far a pointer moves, in screen pixels, before a press becomes a drag. A finger wobbles more than a mouse. */
export const SLOP: Record<Input, number> = { mouse: 3, touch: 8 };

/** How far from a finger, in screen pixels, a wire it carries looks for an end to plug into. */
export const SNAP = 30;

/**
 * How far a finger reaches, in screen pixels: furthest to ends, which are
 * small, and least beyond an agent's outline, so pressing beside agents
 * still pans.
 */
export const REACH = { end: 22, wire: 16, agent: 8 };

/**
 * How big an end is, in the net's units: the ring it gets when lit up, and
 * the circle the mouse hits. A finger further from it than that, and
 * `END_GRACE` screen pixels more, is taken to mean a wire within its reach
 * rather than the end.
 */
export const END_SIZE = 6.5;
export const END_GRACE = 6;

/**
 * How much nearer a finger counts ends than agents and wires, since ends sit
 * on agents' edges and wires run into them: 8 screen pixels, or less zoomed
 * out, where it's 5 of the net's units, so short wires and small agents
 * still have room to be pressed.
 */
const endPull = (k: number) => Math.min(8, 5 * k);

/** What's within a finger's reach, each with how far it is in screen pixels; inside an agent, minus how deep. */
export interface Near {
  ends: { end: End; d: number }[];
  agents: { id: AgentId; d: number }[];
  wires: { id: WireId; d: number }[];
}

/**
 * What a finger pressed, of what's near it, with the view at zoom `k`: the
 * nearest, counting ends a little nearer. Zoomed out everything is close
 * together, so ends further than their own size (and a little) only count
 * when there's no wire within reach: a finger on a wire takes the wire, not
 * a port at its end. Undefined when nothing is in reach.
 */
export function reach(near: Near, k: number): Hit | undefined {
  const wire = near.wires.some((w) => w.d <= REACH.wire);
  let best: Hit | undefined;
  let score = Infinity;
  const consider = (h: Hit, d: number) => {
    if (d < score) [best, score] = [h, d];
  };
  for (const e of near.ends) {
    if (e.d > REACH.end || (wire && e.d > END_SIZE * k + END_GRACE)) continue;
    consider({ kind: "end", end: e.end }, e.d - endPull(k));
  }
  for (const a of near.agents) if (a.d <= REACH.agent) consider({ kind: "agent", id: a.id }, a.d);
  for (const w of near.wires) if (w.d <= REACH.wire) consider({ kind: "wire", id: w.id }, w.d);
  return best;
}

/** How far the view zooms out and in. */
export const ZOOM = { min: 0.15, max: 8 };

/** The view zoomed to `k` (kept within bounds) about a point on screen, which stays where it is. */
export function zoomAbout(v: View, k: number, c: Pt): View {
  const nk = Math.min(ZOOM.max, Math.max(ZOOM.min, k));
  return { k: nk, x: c.x - ((c.x - v.x) * nk) / v.k, y: c.y - ((c.y - v.y) * nk) / v.k };
}

type Out = [Gesture | undefined, Effect[]];

export function update(s: Gesture | undefined, msg: Msg, ctx: Ctx): Out {
  switch (msg.kind) {
    case "down":
      return s ? another(s, msg, ctx) : down(msg, ctx);
    case "move":
      return s ? move(s, msg, ctx) : [s, []];
    case "up":
      return s ? up(s, msg, ctx) : [s, []];
    case "hold":
      return s ? hold(s, msg, ctx) : [s, []];
    case "cancel":
      return s ? [undefined, cancel(s)] : [s, []];
  }
}

function down(msg: Extract<Msg, { kind: "down" }>, ctx: Ctx): Out {
  const { pointer, input, screen } = msg;
  const unhover: Effect = { kind: "hover", hover: undefined };
  // The mouse points at what it presses rather than hovering it. A finger
  // leaves the hover alone: lifting it says what it tapped.
  const fx = (...more: Effect[]): Effect[] => (input === "mouse" ? [unhover, ...more] : more);
  const pan = (): Out => {
    const v = ctx.view();
    return [{ kind: "pan", input, grip: { origin: v, fingers: [{ id: pointer, from: screen, at: screen }] }, before: v, moved: false }, fx()];
  };
  if (input === "mouse") {
    if (msg.button === 1 || msg.button === 2 || (msg.button === 0 && msg.space)) return pan();
    if (msg.button !== 0) return [undefined, fx()];
  }
  if (ctx.readonly) return pan();
  const hit = msg.hit;
  const pressMove = (tapped: Hover): Extract<Gesture, { kind: "press"; on: "move" }> => ({ kind: "press", on: "move", pointer, input, start: screen, at: msg.at, tapped });
  /** In the phone layout, a finger that might be held. */
  const holdable = input === "touch" && ctx.phone ? [{ kind: "await-hold", pointer } as const] : [];
  switch (hit.kind) {
    case "end": {
      const tapped: Hover = hit.end.kind === "port" ? { kind: "port", end: hit.end } : { kind: "free", name: hit.end.name };
      return [{ kind: "press", on: "wire", pointer, input, g: ctx.gestureAt(hit.end), start: screen, tapped, end: hit.end }, fx()];
    }
    case "agent":
      if (holdable.length) return [{ ...pressMove({ kind: "agent", id: hit.id }), waiting: hit.id }, holdable];
      return [pressMove({ kind: "agent", id: hit.id }), !ctx.isSelected(hit.id) || msg.shift ? fx({ kind: "pick", id: hit.id, additive: msg.shift }) : fx()];
    case "collapse":
      return [undefined, fx({ kind: "collapse", group: hit.group })];
    case "group":
      return [pressMove({ kind: "group", id: hit.group }), fx({ kind: "pick-group", group: hit.group, additive: msg.shift })];
    case "wire": {
      if (input === "touch") {
        const h = ctx.hover();
        const armed = h?.kind === "wire" && h.id === hit.id;
        return [{ kind: "tap", pointer, start: screen, at: msg.at, on: { kind: "wire", id: hit.id, armed, alt: msg.alt } }, holdable];
      }
      // Still pointing at it: keep its preview up while the button is down.
      return [{ kind: "click-wire", pointer, id: hit.id, alt: msg.alt }, [{ kind: "hover", hover: { kind: "wire", id: hit.id } }]];
    }
    case "none": {
      if (input !== "touch") return [{ kind: "marquee", pointer, start: msg.at, cur: msg.at, additive: msg.shift, moved: false }, [unhover]];
      const last = ctx.lastTap();
      if (last && msg.time - last.time <= DOUBLE.time && !beyond(last.screen, screen, DOUBLE.reach)) {
        return [{ kind: "zoom", pointer, start: screen, origin: ctx.view(), moved: false }, []];
      }
      return [{ kind: "tap", pointer, start: screen, at: msg.at, on: { kind: "none" } }, holdable];
    }
  }
}

/** Another pointer going down mid-gesture. Only a finger joining fingers does anything. */
function another(s: Gesture, msg: Extract<Msg, { kind: "down" }>, ctx: Ctx): Out {
  if (msg.input !== "touch") return [s, []];
  const finger: Finger = { id: msg.pointer, from: msg.screen, at: msg.screen };
  switch (s.kind) {
    case "press":
    case "tap":
    case "zoom": {
      if (s.kind === "press" && s.input !== "touch") return [s, []];
      // Two fingers pinch the view; the first lets go of what it pressed.
      const v = ctx.view();
      const first: Finger = { id: s.pointer, from: s.start, at: s.start };
      return [{ kind: "pan", input: "touch", grip: { origin: v, fingers: [first, finger] }, before: v, moved: true }, []];
    }
    case "pan":
      if (s.input !== "touch" || s.grip.fingers.length >= 2) return [s, []];
      return [{ ...s, moved: true, grip: regrip(ctx, [...s.grip.fingers, finger]) }, []];
    case "wire":
    case "move": {
      // What's carried stays with its finger; the others take hold of the view.
      const fingers = s.grip?.fingers ?? [];
      if (s.input !== "touch" || fingers.length >= 2) return [s, []];
      return [{ ...s, grip: regrip(ctx, [...fingers, finger]) }, []];
    }
    case "marquee": {
      // A second finger on a finger's marquee: it was a pinch after all.
      if (!s.finger) return [s, []];
      const v = ctx.view();
      const first: Finger = { id: s.pointer, from: s.finger, at: s.finger };
      return [{ kind: "pan", input: "touch", grip: { origin: v, fingers: [first, finger] }, before: v, moved: true }, []];
    }
    case "click-wire":
      return [s, []];
  }
}

function move(s: Gesture, msg: Extract<Msg, { kind: "move" }>, ctx: Ctx): Out {
  switch (s.kind) {
    case "press": {
      if (msg.pointer !== s.pointer || !beyond(s.start, msg.screen, SLOP[s.input])) return [s, []];
      const { pointer, input } = s;
      if (s.on === "wire") return carry({ kind: "wire", pointer, input, g: s.g, cur: msg.at, screen: msg.screen }, msg.screen, msg.at, ctx.view().k, msg.over, ctx);
      // A finger that was waiting drags the agent it's on: selected, unless it's among those selected already.
      const picked: Effect[] = s.waiting !== undefined && !ctx.isSelected(s.waiting) ? [{ kind: "pick", id: s.waiting, additive: false }] : [];
      // Catch up with the pointer, so what's grabbed stays under it.
      return [
        { kind: "move", pointer, input, last: msg.at, screen: msg.screen },
        [...picked, { kind: "begin-move" }, { kind: "move-by", dx: msg.at.x - s.at.x, dy: msg.at.y - s.at.y }],
      ];
    }
    case "tap": {
      if (msg.pointer !== s.pointer || !beyond(s.start, msg.screen, SLOP.touch)) return [s, []];
      // Slid off what it pressed: a pan, from where the finger went down.
      const v = ctx.view();
      const pan: Gesture = { kind: "pan", input: "touch", grip: { origin: v, fingers: [{ id: s.pointer, from: s.start, at: s.start }] }, before: v, moved: true };
      return move(pan, msg, ctx);
    }
    case "wire":
    case "move": {
      if (msg.pointer === s.pointer) return carry(s, msg.screen, msg.at, ctx.view().k, msg.over, ctx);
      if (!s.grip || !holds(s.grip, msg.pointer)) return [s, []];
      // The view moves under what's carried, which keeps to the finger carrying it.
      const grip = slide(s.grip, msg.pointer, msg.screen);
      const v = gripped(grip);
      const at = { x: (s.screen.x - v.x) / v.k, y: (s.screen.y - v.y) / v.k };
      const [next, fx] = carry({ ...s, grip }, s.screen, at, v.k, undefined, ctx);
      return [next, [{ kind: "view", view: v }, ...fx]];
    }
    case "zoom": {
      if (msg.pointer !== s.pointer) return [s, []];
      const moved = s.moved || beyond(s.start, msg.screen, SLOP.touch);
      if (!moved) return [s, []];
      // Down zooms in, up zooms out, about where the finger went down.
      const k = s.origin.k * Math.exp((msg.screen.y - s.start.y) / ZOOM_DRAG);
      return [{ ...s, moved }, [{ kind: "view", view: zoomAbout(s.origin, k, s.start) }]];
    }
    case "marquee": {
      if (msg.pointer !== s.pointer) return [s, []];
      const slop = s.finger ? SLOP.touch : SLOP.mouse;
      const moved = s.moved || Math.hypot(msg.at.x - s.start.x, msg.at.y - s.start.y) * ctx.view().k > slop;
      return [{ ...s, cur: msg.at, moved, finger: s.finger && msg.screen }, []];
    }
    case "pan": {
      if (!holds(s.grip, msg.pointer)) return [s, []];
      const grip = slide(s.grip, msg.pointer, msg.screen);
      const f = grip.fingers.find((f) => f.id === msg.pointer)!;
      return [{ ...s, grip, moved: s.moved || beyond(f.from, f.at, SLOP[s.input]) }, [{ kind: "view", view: gripped(grip) }]];
    }
    case "click-wire":
      return [s, []];
  }
}

/** The pointer carrying a wire or agents is at `screen`, and so at `at` in the net, with the view at zoom `k`. */
function carry(s: Extract<Gesture, { kind: "wire" | "move" }>, screen: Pt, at: Pt, k: number, over: End | undefined, ctx: Ctx): Out {
  if (s.kind === "move") return [{ ...s, last: at, screen }, [{ kind: "move-by", dx: at.x - s.last.x, dy: at.y - s.last.y }]];
  const [target, check] = s.input === "touch" ? snap(s.g, at, k, ctx) : aim(s.g, over, ctx);
  return [
    { ...s, cur: at, screen, target, check },
    [{ kind: "hover", hover: { kind: "drag", gesture: s.g, target, check } }],
  ];
}

/** What a wire held by the mouse would go to: the end right under it, unless that's where a new wire starts. */
function aim(g: WireGesture, over: End | undefined, ctx: Ctx): [End?, DropCheck?] {
  if (!over || (g.kind === "new" && sameEnd(over, g.from))) return [];
  return [over, ctx.checkDrop(g, over)];
}

/**
 * What a wire held by a finger would go to: the finger covers the ends, so
 * the nearest within reach that the wire may go to (or go back to), and
 * failing that the nearest one, to show why it can't.
 */
function snap(g: WireGesture, at: Pt, k: number, ctx: Ctx): [End?, DropCheck?] {
  const ends = ctx.near(at, SNAP / k).filter((e) => !(g.kind === "new" && sameEnd(e, g.from)));
  const checked = ends.map((e): [End, DropCheck] => [e, ctx.checkDrop(g, e)]);
  return checked.find(([, c]) => c.kind !== "refuse") ?? checked[0] ?? [];
}

function up(s: Gesture, msg: Extract<Msg, { kind: "up" }>, ctx: Ctx): Out {
  switch (s.kind) {
    case "press": {
      if (msg.pointer !== s.pointer) return [s, []];
      // Pressing a port and letting go leaves its wire alone. A tap leaves what it tapped hovered.
      if (s.input !== "touch") return [undefined, []];
      const hover: Effect = { kind: "hover", hover: s.tapped };
      const tap: Effect = { kind: "tapped", screen: s.start, time: msg.time, empty: false };
      if (!ctx.phone) return [undefined, [hover, tap]];
      if (s.on === "wire") return [undefined, [...tappedEnd(s.end, s.g, s.tapped, ctx), tap]];
      // A tap on an agent selects it, unless it's among those selected already; and lets go of a wire waiting for its other end.
      const pick: Effect[] = s.waiting !== undefined && !ctx.isSelected(s.waiting) ? [{ kind: "pick", id: s.waiting, additive: false }] : [];
      return [undefined, [...disarm(ctx), ...pick, hover, tap]];
    }
    case "tap": {
      if (msg.pointer !== s.pointer) return [s, []];
      const tap: Effect = { kind: "tapped", screen: s.start, time: msg.time, empty: s.on.kind === "none" };
      return [undefined, [...disarm(ctx), ...tapped(s.on, ctx), tap]];
    }
    case "zoom":
      if (msg.pointer !== s.pointer) return [s, []];
      // Told as a tap on something, so a third tap doesn't make a second double tap.
      return [undefined, [...(s.moved ? [] : [{ kind: "zoom", by: DOUBLE_ZOOM, about: s.start } as const]), { kind: "tapped", screen: s.start, time: msg.time, empty: false }]];
    case "wire":
    case "move": {
      if (msg.pointer !== s.pointer) {
        if (!s.grip || !holds(s.grip, msg.pointer)) return [s, []];
        const rest = s.grip.fingers.filter((f) => f.id !== msg.pointer);
        return [{ ...s, grip: rest.length ? regrip(ctx, rest) : undefined }, []];
      }
      const done = s.kind === "wire" ? drop(s) : [{ kind: "end-move" } as const];
      const fx: Effect[] = s.input === "touch" ? [...done, { kind: "hover", hover: undefined }] : done;
      // Fingers still on the view carry on moving it.
      if (s.grip) return [{ kind: "pan", input: "touch", grip: regrip(ctx, s.grip.fingers), before: ctx.view(), moved: true }, fx];
      return [undefined, fx];
    }
    case "marquee":
      if (msg.pointer !== s.pointer) return [s, []];
      if (s.moved) return [undefined, [{ kind: "select-in", marquee: s }]];
      // A finger held on the canvas and lifted without drawing anything.
      if (s.finger) return [undefined, [{ kind: "hold-menu", screen: s.finger, at: s.start }]];
      return [undefined, s.additive ? [] : [{ kind: "clear-selection" }]];
    case "pan": {
      if (!holds(s.grip, msg.pointer)) return [s, []];
      const rest = s.grip.fingers.filter((f) => f.id !== msg.pointer);
      return [rest.length ? { ...s, grip: regrip(ctx, rest) } : undefined, []];
    }
    case "click-wire": {
      if (msg.pointer !== s.pointer) return [s, []];
      const does = s.alt || msg.alt ? undefined : ctx.clickable(s.id);
      return [undefined, [does ? { kind: does, id: s.id } : { kind: "select-wire", id: s.id }]];
    }
  }
}

/** Letting go of a wire: into its target if it takes it, or over nothing. */
function drop(s: Extract<Gesture, { kind: "wire" }>): Effect[] {
  if (!s.target) return [{ kind: "finish-wire", g: s.g }];
  return s.check?.kind === "ok" ? [{ kind: "finish-wire", g: s.g, to: s.target }] : [];
}

/**
 * A tap. On nothing, it clears the selection and the hover. On an active
 * pair (or one with no rule), the first tap shows what firing it would do
 * and the second does it; any other wire is selected straight away.
 */
function tapped(on: TapOn, ctx: Ctx): Effect[] {
  if (on.kind === "none") return [{ kind: "clear-selection" }, { kind: "hover", hover: undefined }];
  const hover: Effect = { kind: "hover", hover: { kind: "wire", id: on.id } };
  const does = on.alt ? undefined : ctx.clickable(on.id);
  if (!does) return [{ kind: "select-wire", id: on.id }, hover];
  return on.armed ? [{ kind: does, id: on.id }, { kind: "hover", hover: undefined }] : [hover];
}

/**
 * A finger in the phone layout held still, before it moved. Held on nothing,
 * it starts a marquee that adds to the selection (Shift-drag's job); held on
 * a wire, it selects the wire, so an active pair's is selected rather than
 * fired (Alt-click's), and the finger then only moves the view; held on an
 * agent, it adds the agent to the selection or takes it out (Shift-click's).
 */
function hold(s: Gesture, msg: Extract<Msg, { kind: "hold" }>, ctx: Ctx): Out {
  if (!ctx.phone || !("pointer" in s) || s.pointer !== msg.pointer) return [s, []];
  switch (s.kind) {
    case "tap": {
      const held: Effect = { kind: "held", screen: s.start };
      if (s.on.kind === "none") {
        return [{ kind: "marquee", pointer: s.pointer, start: s.at, cur: s.at, additive: true, moved: false, finger: s.start }, [held, ...disarm(ctx)]];
      }
      const v = ctx.view();
      const pan: Gesture = { kind: "pan", input: "touch", grip: { origin: v, fingers: [{ id: s.pointer, from: s.start, at: s.start }] }, before: v, moved: false };
      // A pair's preview goes: it's a selected wire now, which a tap doesn't fire.
      const hover: Hover | undefined = ctx.clickable(s.on.id) ? undefined : { kind: "wire", id: s.on.id };
      return [pan, [held, { kind: "select-wire", id: s.on.id }, { kind: "hover", hover }]];
    }
    case "press":
      if (s.on !== "move" || s.waiting === undefined) return [s, []];
      return [{ ...s, waiting: undefined }, [{ kind: "held", screen: s.start }, { kind: "pick", id: s.waiting, additive: true }, { kind: "hover", hover: s.tapped }]];
    default:
      return [s, []];
  }
}

/** Letting go of a wire started by a tap, if one is waiting. */
const disarm = (ctx: Ctx): Effect[] => (ctx.phone?.armed() ? [{ kind: "disarm" }] : []);

/** The end a wire started by a tap comes from: tapping it again lets go. */
const armedFrom = (g: WireGesture): End => (g.kind === "new" ? g.from : g.moving);

/**
 * A finger's tap on an end, in the phone layout. With a wire waiting, the
 * tap finishes it there if it can go there, or says why not; tapping the
 * end it started from lets go. Otherwise an empty port, or a loose end,
 * starts one.
 */
function tappedEnd(end: End, g: WireGesture, shown: Hover, ctx: Ctx): Effect[] {
  const a = ctx.phone?.armed();
  if (a) {
    if (sameEnd(end, armedFrom(a))) return [{ kind: "disarm" }, { kind: "hover", hover: shown }];
    const check = ctx.checkDrop(a, end);
    if (check.kind === "ok") return [{ kind: "finish-wire", g: a, to: end }, { kind: "disarm" }, { kind: "hover", hover: undefined }];
    if (check.kind === "back") return [{ kind: "disarm" }, { kind: "hover", hover: undefined }];
    return [{ kind: "hover", hover: { kind: "drag", gesture: a, target: end, check } }];
  }
  if (g.kind === "new" || end.kind === "free") return [{ kind: "arm", g }, { kind: "hover", hover: shown }];
  return [{ kind: "hover", hover: shown }];
}

function cancel(s: Gesture): Effect[] {
  switch (s.kind) {
    case "wire":
      return [{ kind: "return-wire", g: s.g }];
    case "move":
      return [{ kind: "cancel-move" }];
    case "pan":
      return [{ kind: "view", view: s.before }];
    case "zoom":
      return [{ kind: "view", view: s.origin }];
    default:
      return [];
  }
}

const beyond = (a: Pt, b: Pt, d: number) => Math.hypot(b.x - a.x, b.y - a.y) > d;

const holds = (grip: Grip, pointer: number) => grip.fingers.some((f) => f.id === pointer);

/** The grip with one finger moved to `at`. */
const slide = (grip: Grip, pointer: number, at: Pt): Grip => ({
  ...grip,
  fingers: grip.fingers.map((f) => (f.id === pointer ? { ...f, at } : f)),
});

/** The grip taken afresh by these fingers, where they are and where the view is now. */
const regrip = (ctx: Ctx, fingers: Finger[]): Grip => ({
  origin: ctx.view(),
  fingers: fingers.map((f) => ({ id: f.id, from: f.at, at: f.at })),
});

/**
 * Where a grip holds the view: the point of the net that was midway between
 * the fingers stays midway between them, scaled by how far they've spread.
 */
export function gripped(grip: Grip): View {
  const o = grip.origin;
  const mid = (pt: (f: Finger) => Pt) => {
    const n = grip.fingers.length;
    return { x: grip.fingers.reduce((s, f) => s + pt(f).x, 0) / n, y: grip.fingers.reduce((s, f) => s + pt(f).y, 0) / n };
  };
  const [a, b] = grip.fingers;
  const spread = a && b ? Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) / Math.max(Math.hypot(a.from.x - b.from.x, a.from.y - b.from.y), 1) : 1;
  // Pinching stops at the zoom limits, but doesn't snap a view already past them back.
  const k = spread === 1 ? o.k : Math.min(Math.max(ZOOM.max, o.k), Math.max(Math.min(ZOOM.min, o.k), o.k * spread));
  const m0 = mid((f) => f.from);
  const m = mid((f) => f.at);
  return { k, x: m.x - ((m0.x - o.x) / o.k) * k, y: m.y - ((m0.y - o.y) / o.k) * k };
}
