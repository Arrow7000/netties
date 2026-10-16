import type { GroupId } from "../core/groups";
import { type AgentId, type End, type WireId, sameEnd } from "../core/net";
import type { Pt } from "../layout/geometry";
import type { DropCheck, Hover, WireGesture } from "../state/model";

/**
 * What the pointer is doing on a canvas, as a state machine: each pointer
 * event (or Escape) is a message, and `update` says what state follows and
 * what should happen to the net. The canvas turns DOM events into messages
 * and carries the effects out; everything that decides what a gesture does
 * is here.
 *
 *   idle ──down──▶ press ──moves 3 px──▶ wire | move
 *        ──down──▶ marquee | pan | click-wire
 *   any ──up──▶ idle (finishing what it was doing)
 *   any ──cancel (Escape, lost pointer)──▶ idle (undoing what it was doing)
 */
export type Gesture =
  /** The button is down on a port or an agent, but hasn't moved far enough to drag it. */
  | { kind: "press"; on: "wire"; g: WireGesture; start: Pt }
  | { kind: "press"; on: "move"; start: Pt; at: Pt }
  | { kind: "wire"; g: WireGesture; cur: Pt; target?: End; check?: DropCheck }
  | { kind: "move"; last: Pt }
  | { kind: "marquee"; start: Pt; cur: Pt; additive: boolean; moved: boolean }
  | { kind: "pan"; start: Pt; origin: Pt; moved: boolean }
  | { kind: "click-wire"; id: WireId; alt: boolean };

/** What's under the pointer when a button goes down. */
export type Hit =
  | { kind: "end"; end: End }
  | { kind: "agent"; id: AgentId }
  | { kind: "collapse"; group: GroupId }
  | { kind: "group"; group: GroupId }
  | { kind: "wire"; id: WireId }
  | { kind: "none" };

/** Pointer positions come in screen pixels (`client`) and in the net's coordinates (`at`). */
export type Msg =
  | { kind: "down"; hit: Hit; button: number; client: Pt; at: Pt; shift: boolean; alt: boolean; space: boolean }
  /** `over` is the end really under the pointer (pointer capture hides it from the event). */
  | { kind: "move"; client: Pt; at: Pt; over?: End }
  | { kind: "up"; alt: boolean }
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
  | { kind: "view"; x: number; y: number }
  | { kind: "select-in"; marquee: Extract<Gesture, { kind: "marquee" }> }
  | { kind: "clear-selection" }
  | { kind: "finish-wire"; g: WireGesture; to?: End }
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
  zoom(): number;
  view(): Pt;
}

/** How far the pointer moves, in screen pixels, before a press becomes a drag. */
export const SLOP = 3;

type Out = [Gesture | undefined, Effect[]];

export function update(s: Gesture | undefined, msg: Msg, ctx: Ctx): Out {
  switch (msg.kind) {
    case "down":
      // A second button going down mid-gesture changes nothing.
      return s ? [s, []] : down(msg, ctx);
    case "move":
      return s ? move(s, msg, ctx) : [s, []];
    case "up":
      return s ? [undefined, up(s, msg, ctx)] : [s, []];
    case "cancel":
      return s ? [undefined, cancel(s)] : [s, []];
  }
}

function down(msg: Extract<Msg, { kind: "down" }>, ctx: Ctx): Out {
  const hover: Effect = { kind: "hover", hover: undefined };
  const pan = (): Out => {
    const v = ctx.view();
    return [{ kind: "pan", start: msg.client, origin: { x: v.x, y: v.y }, moved: false }, [hover]];
  };
  if (msg.button === 1 || msg.button === 2 || (msg.button === 0 && msg.space)) return pan();
  if (msg.button !== 0) return [undefined, [hover]];
  if (ctx.readonly) return pan();
  const pressMove: Gesture = { kind: "press", on: "move", start: msg.client, at: msg.at };
  const hit = msg.hit;
  switch (hit.kind) {
    case "end":
      return [{ kind: "press", on: "wire", g: ctx.gestureAt(hit.end), start: msg.client }, [hover]];
    case "agent":
      return [pressMove, !ctx.isSelected(hit.id) || msg.shift ? [hover, { kind: "pick", id: hit.id, additive: msg.shift }] : [hover]];
    case "collapse":
      return [undefined, [hover, { kind: "collapse", group: hit.group }]];
    case "group":
      return [pressMove, [hover, { kind: "pick-group", group: hit.group, additive: msg.shift }]];
    case "wire":
      // Still pointing at it: keep its preview up while the button is down.
      return [{ kind: "click-wire", id: hit.id, alt: msg.alt }, [{ kind: "hover", hover: { kind: "wire", id: hit.id } }]];
    case "none":
      return [{ kind: "marquee", start: msg.at, cur: msg.at, additive: msg.shift, moved: false }, [hover]];
  }
}

function move(s: Gesture, msg: Extract<Msg, { kind: "move" }>, ctx: Ctx): Out {
  switch (s.kind) {
    case "press": {
      if (Math.hypot(msg.client.x - s.start.x, msg.client.y - s.start.y) <= SLOP) return [s, []];
      if (s.on === "wire") return move({ kind: "wire", g: s.g, cur: msg.at }, msg, ctx);
      // Catch up with the pointer, so what's grabbed stays under it.
      return [{ kind: "move", last: msg.at }, [{ kind: "begin-move" }, { kind: "move-by", dx: msg.at.x - s.at.x, dy: msg.at.y - s.at.y }]];
    }
    case "wire": {
      const over = msg.over && !(s.g.kind === "new" && sameEnd(msg.over, s.g.from)) ? msg.over : undefined;
      const check = over ? ctx.checkDrop(s.g, over) : undefined;
      return [
        { ...s, cur: msg.at, target: over, check },
        [{ kind: "hover", hover: { kind: "drag", gesture: s.g, target: over, check } }],
      ];
    }
    case "move":
      return [{ kind: "move", last: msg.at }, [{ kind: "move-by", dx: msg.at.x - s.last.x, dy: msg.at.y - s.last.y }]];
    case "marquee": {
      const moved = s.moved || Math.hypot(msg.at.x - s.start.x, msg.at.y - s.start.y) * ctx.zoom() > SLOP;
      return [{ ...s, cur: msg.at, moved }, []];
    }
    case "pan": {
      const dx = msg.client.x - s.start.x;
      const dy = msg.client.y - s.start.y;
      return [{ ...s, moved: s.moved || Math.hypot(dx, dy) > SLOP }, [{ kind: "view", x: s.origin.x + dx, y: s.origin.y + dy }]];
    }
    case "click-wire":
      return [s, []];
  }
}

function up(s: Gesture, msg: Extract<Msg, { kind: "up" }>, ctx: Ctx): Effect[] {
  switch (s.kind) {
    case "press":
    case "pan":
      // Pressing a port and letting go leaves its wire alone.
      return [];
    case "wire":
      if (!s.target) return [{ kind: "finish-wire", g: s.g }];
      return s.check?.kind === "ok" ? [{ kind: "finish-wire", g: s.g, to: s.target }] : [];
    case "move":
      return [{ kind: "end-move" }];
    case "marquee":
      if (s.moved) return [{ kind: "select-in", marquee: s }];
      return s.additive ? [] : [{ kind: "clear-selection" }];
    case "click-wire": {
      const does = s.alt || msg.alt ? undefined : ctx.clickable(s.id);
      return [does ? { kind: does, id: s.id } : { kind: "select-wire", id: s.id }];
    }
  }
}

function cancel(s: Gesture): Effect[] {
  switch (s.kind) {
    case "move":
      return [{ kind: "cancel-move" }];
    case "pan":
      return [{ kind: "view", x: s.origin.x, y: s.origin.y }];
    default:
      return [];
  }
}
