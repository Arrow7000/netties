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
 * carries a wire or agents, others move the view under it.
 *
 *   idle ──down──▶ press ──moves──▶ wire | move
 *        ──mouse down──▶ marquee | pan | click-wire
 *        ──finger down──▶ tap ──moves──▶ pan
 *   press | tap | pan ──another finger──▶ pan (pinching)
 *   wire | move ──another finger──▶ the same, with a grip on the view
 *   any ──up──▶ idle (finishing what it was doing), or pan (fingers left on the view)
 *   any ──cancel (Escape, lost pointer)──▶ idle (undoing what it was doing)
 */
export type Gesture =
  /** A button or finger is down on a port or an agent, but hasn't moved far enough to drag it. `tapped` is what a tap leaves hovered. */
  | { kind: "press"; on: "wire"; pointer: number; input: Input; g: WireGesture; start: Pt; tapped: Hover }
  | { kind: "press"; on: "move"; pointer: number; input: Input; start: Pt; at: Pt; tapped: Hover }
  /** A finger is down on a wire or on nothing: lifted where it is, it's a tap; moved, it pans. */
  | { kind: "tap"; pointer: number; start: Pt; on: TapOn }
  /** `screen` is where the pointer carrying the wire is; `grip`, other fingers moving the view meanwhile. */
  | { kind: "wire"; pointer: number; input: Input; g: WireGesture; cur: Pt; screen: Pt; target?: End; check?: DropCheck; grip?: Grip }
  | { kind: "move"; pointer: number; input: Input; last: Pt; screen: Pt; grip?: Grip }
  | { kind: "marquee"; pointer: number; start: Pt; cur: Pt; additive: boolean; moved: boolean }
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
    }
  /** `over` is the end really under the mouse (pointer capture hides it from the event). */
  | { kind: "move"; pointer: number; screen: Pt; at: Pt; over?: End }
  | { kind: "up"; pointer: number; alt: boolean }
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
  | { kind: "select-wire"; id: WireId };

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
}

/** How far a pointer moves, in screen pixels, before a press becomes a drag. A finger wobbles more than a mouse. */
export const SLOP: Record<Input, number> = { mouse: 3, touch: 8 };

/** How far from a finger, in screen pixels, a wire it carries looks for an end to plug into. */
export const SNAP = 30;

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
  const pressMove = (tapped: Hover): Gesture => ({ kind: "press", on: "move", pointer, input, start: screen, at: msg.at, tapped });
  switch (hit.kind) {
    case "end": {
      const tapped: Hover = hit.end.kind === "port" ? { kind: "port", end: hit.end } : { kind: "free", name: hit.end.name };
      return [{ kind: "press", on: "wire", pointer, input, g: ctx.gestureAt(hit.end), start: screen, tapped }, fx()];
    }
    case "agent":
      return [pressMove({ kind: "agent", id: hit.id }), !ctx.isSelected(hit.id) || msg.shift ? fx({ kind: "pick", id: hit.id, additive: msg.shift }) : fx()];
    case "collapse":
      return [undefined, fx({ kind: "collapse", group: hit.group })];
    case "group":
      return [pressMove({ kind: "group", id: hit.group }), fx({ kind: "pick-group", group: hit.group, additive: msg.shift })];
    case "wire": {
      if (input === "touch") {
        const h = ctx.hover();
        const armed = h?.kind === "wire" && h.id === hit.id;
        return [{ kind: "tap", pointer, start: screen, on: { kind: "wire", id: hit.id, armed, alt: msg.alt } }, []];
      }
      // Still pointing at it: keep its preview up while the button is down.
      return [{ kind: "click-wire", pointer, id: hit.id, alt: msg.alt }, [{ kind: "hover", hover: { kind: "wire", id: hit.id } }]];
    }
    case "none":
      if (input === "touch") return [{ kind: "tap", pointer, start: screen, on: { kind: "none" } }, []];
      return [{ kind: "marquee", pointer, start: msg.at, cur: msg.at, additive: msg.shift, moved: false }, [unhover]];
  }
}

/** Another pointer going down mid-gesture. Only a finger joining fingers does anything. */
function another(s: Gesture, msg: Extract<Msg, { kind: "down" }>, ctx: Ctx): Out {
  if (msg.input !== "touch") return [s, []];
  const finger: Finger = { id: msg.pointer, from: msg.screen, at: msg.screen };
  switch (s.kind) {
    case "press":
    case "tap": {
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
    case "marquee":
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
      // Catch up with the pointer, so what's grabbed stays under it.
      return [
        { kind: "move", pointer, input, last: msg.at, screen: msg.screen },
        [{ kind: "begin-move" }, { kind: "move-by", dx: msg.at.x - s.at.x, dy: msg.at.y - s.at.y }],
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
    case "marquee": {
      if (msg.pointer !== s.pointer) return [s, []];
      const moved = s.moved || Math.hypot(msg.at.x - s.start.x, msg.at.y - s.start.y) * ctx.view().k > SLOP.mouse;
      return [{ ...s, cur: msg.at, moved }, []];
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
    case "press":
      if (msg.pointer !== s.pointer) return [s, []];
      // Pressing a port and letting go leaves its wire alone. A tap leaves what it tapped hovered.
      return [undefined, s.input === "touch" ? [{ kind: "hover", hover: s.tapped }] : []];
    case "tap":
      if (msg.pointer !== s.pointer) return [s, []];
      return [undefined, tapped(s.on, ctx)];
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

function cancel(s: Gesture): Effect[] {
  switch (s.kind) {
    case "wire":
      return [{ kind: "return-wire", g: s.g }];
    case "move":
      return [{ kind: "cancel-move" }];
    case "pan":
      return [{ kind: "view", view: s.before }];
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
