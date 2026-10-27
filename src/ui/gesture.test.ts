import { describe, expect, it } from "vitest";
import { type End, free, port } from "../core/net";
import type { DropCheck, Hover, WireGesture } from "../state/model";
import { DOUBLE, END_GRACE, END_SIZE, type Ctx, type Effect, type Gesture, type Input, type Msg, type View, reach, update } from "./gesture";

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  readonly: false,
  gestureAt: (e) => ({ kind: "new", from: e }),
  checkDrop: () => ({ kind: "ok", join: false }),
  isSelected: () => false,
  clickable: () => undefined,
  hover: () => undefined,
  near: () => [],
  view: () => ({ x: 0, y: 0, k: 1 }),
  lastTap: () => undefined,
  ...over,
});

const MOUSE = 1;
const down = (hit: Extract<Msg, { kind: "down" }>["hit"], extra: Partial<Extract<Msg, { kind: "down" }>> = {}): Msg => ({
  kind: "down",
  pointer: MOUSE,
  input: "mouse",
  hit,
  button: 0,
  screen: { x: 100, y: 100 },
  at: { x: 10, y: 10 },
  shift: false,
  alt: false,
  space: false,
  time: 0,
  ...extra,
});
const move = (dx: number, dy: number, over?: End, pointer = MOUSE): Msg => ({
  kind: "move",
  pointer,
  screen: { x: 100 + dx, y: 100 + dy },
  at: { x: 10 + dx, y: 10 + dy },
  over,
});
const up = (alt = false, pointer = MOUSE, time = 0): Msg => ({ kind: "up", pointer, alt, time });

/** Fingers: `touch(id)` puts finger `id` down at a screen point, `slide` moves it there, `lift` takes it off. */
const touch = (pointer: number, hit: Extract<Msg, { kind: "down" }>["hit"], x = 100, y = 100, time = 0): Msg =>
  down(hit, { pointer, input: "touch" as Input, screen: { x, y }, at: { x, y }, time });
const slide = (pointer: number, x: number, y: number): Msg => ({ kind: "move", pointer, screen: { x, y }, at: { x, y } });
const lift = (pointer: number, time = 0): Msg => up(false, pointer, time);
const hold = (pointer: number): Msg => ({ kind: "hold", pointer });

/**
 * Run messages from idle, collecting every effect but the hover, the taps
 * and the waits for holds. The view starts at `view` and follows the view
 * effects, and the last tap on nothing is remembered, as the canvas does; a
 * pointer's `at` is worked out from its screen position under the view.
 */
function run(msgs: Msg[], c = ctx(), keepHover = false, keepTaps = false) {
  let s: Gesture | undefined;
  let v: View = c.view();
  let last: { screen: { x: number; y: number }; time: number } | undefined;
  const live: Ctx = { ...c, view: () => v, lastTap: () => last };
  const fx: Effect[] = [];
  for (const m of msgs) {
    const msg = m.kind === "down" || m.kind === "move" ? (input(m) === "touch" ? { ...m, at: { x: (m.screen.x - v.x) / v.k, y: (m.screen.y - v.y) / v.k } } : m) : m;
    const [next, out] = update(s, msg, live);
    s = next;
    for (const f of out) {
      if (f.kind === "view") v = f.view;
      if (f.kind === "tapped") last = f.empty ? { screen: f.screen, time: f.time } : undefined;
    }
    fx.push(...out.filter((f) => (keepHover || f.kind !== "hover") && (keepTaps || (f.kind !== "tapped" && f.kind !== "await-hold"))));
  }
  return { state: s, fx, view: v };
}
/** Which kind of pointer sent a message: fingers here are numbered from 10. */
const input = (m: Msg): Input => ("pointer" in m && m.pointer >= 10 ? "touch" : "mouse");

describe("pointer gestures", () => {
  const p = port(1, 1);

  it("leaves a wire alone when a port is pressed and let go", () => {
    const { state, fx } = run([down({ kind: "end", end: p }), move(2, 1), up()]);
    expect(state).toBeUndefined();
    expect(fx).toEqual([]);
  });

  it("drags a wire once the pointer moves, and leaves a loose end over nothing", () => {
    const { fx } = run([down({ kind: "end", end: p }), move(20, 0), up()]);
    expect(fx).toEqual([{ kind: "finish-wire", g: { kind: "new", from: p } }]);
  });

  it("plugs a wire into an end that takes it, and does nothing over one that refuses", () => {
    const target = port(2, 0);
    const ok = run([down({ kind: "end", end: p }), move(20, 0, target), up()]);
    expect(ok.fx).toEqual([{ kind: "finish-wire", g: { kind: "new", from: p }, to: target }]);
    const refuse: DropCheck = { kind: "refuse", why: "no" };
    const no = run([down({ kind: "end", end: p }), move(20, 0, target), up()], ctx({ checkDrop: () => refuse }));
    expect(no.fx).toEqual([]);
  });

  it("doesn't count the end a new wire starts from as a target", () => {
    const { state } = run([down({ kind: "end", end: p }), move(20, 0, p)]);
    expect(state).toMatchObject({ kind: "wire", target: undefined });
  });

  it("cancels a wire drag, sending a carried wire back", () => {
    const g: WireGesture = { kind: "carry", wire: 3, moving: p, anchor: free("a") };
    const { state, fx } = run([down({ kind: "end", end: p }), move(20, 0), { kind: "cancel" }], ctx({ gestureAt: () => g }));
    expect(state).toBeUndefined();
    expect(fx).toEqual([{ kind: "return-wire", g }]);
  });

  it("selects an agent at once but only moves it after the pointer moves, catching up with it", () => {
    const { fx } = run([down({ kind: "agent", id: 7 }), move(2, 0), move(10, 5), move(12, 5), up()]);
    expect(fx).toEqual([
      { kind: "pick", id: 7, additive: false },
      { kind: "begin-move" },
      { kind: "move-by", dx: 10, dy: 5 },
      { kind: "move-by", dx: 2, dy: 0 },
      { kind: "end-move" },
    ]);
  });

  it("puts moved agents back when cancelled", () => {
    const { fx } = run([down({ kind: "agent", id: 7 }), move(10, 5), { kind: "cancel" }], ctx({ isSelected: () => true }));
    expect(fx).toEqual([{ kind: "begin-move" }, { kind: "move-by", dx: 10, dy: 5 }, { kind: "cancel-move" }]);
  });

  it("puts the view back when a pan is cancelled", () => {
    const { fx } = run([down({ kind: "none" }, { button: 1 }), move(30, 40), { kind: "cancel" }], ctx({ view: () => ({ x: 5, y: 6, k: 2 }) }));
    expect(fx).toEqual([
      { kind: "view", view: { x: 35, y: 46, k: 2 } },
      { kind: "view", view: { x: 5, y: 6, k: 2 } },
    ]);
  });

  it("clears the selection on a click on nothing, and selects what a dragged box takes in", () => {
    expect(run([down({ kind: "none" }), up()]).fx).toEqual([{ kind: "clear-selection" }]);
    const { fx } = run([down({ kind: "none" }), move(20, 20), up()]);
    expect(fx).toMatchObject([{ kind: "select-in", marquee: { start: { x: 10, y: 10 }, cur: { x: 30, y: 30 } } }]);
  });

  it("fires an active pair on a click, and selects it with Alt", () => {
    const c = ctx({ clickable: () => "fire" });
    expect(run([down({ kind: "wire", id: 4 }), up()], c).fx).toEqual([{ kind: "fire", id: 4 }]);
    expect(run([down({ kind: "wire", id: 4 }), up(true)], c).fx).toEqual([{ kind: "select-wire", id: 4 }]);
  });

  it("only pans a read-only canvas", () => {
    const { state } = run([down({ kind: "agent", id: 1 }), move(20, 0)], ctx({ readonly: true }));
    expect(state).toMatchObject({ kind: "pan", moved: true });
  });

  it("pays no heed to a finger while the mouse is busy", () => {
    const { state } = run([down({ kind: "none" }), move(20, 20), touch(10, { kind: "none" }), slide(10, 50, 50), lift(10)]);
    expect(state).toMatchObject({ kind: "marquee", moved: true });
  });
});

describe("touch gestures", () => {
  const p = port(1, 1);

  it("pans with one finger on nothing, and a tap there clears the selection and the hover", () => {
    const pan = run([touch(10, { kind: "none" }), slide(10, 104, 100), slide(10, 130, 110), lift(10)]);
    expect(pan.fx).toEqual([{ kind: "view", view: { x: 30, y: 10, k: 1 } }]);
    expect(pan.state).toBeUndefined();
    const tap = run([touch(10, { kind: "none" }), slide(10, 104, 100), lift(10)], ctx(), true);
    expect(tap.fx).toEqual([{ kind: "clear-selection" }, { kind: "hover", hover: undefined }]);
  });

  it("pinches with two fingers, zooming about their midpoint", () => {
    const { view, state } = run([touch(10, { kind: "none" }), touch(11, { kind: "none" }, 200, 100), slide(11, 300, 100)]);
    expect(state).toMatchObject({ kind: "pan" });
    expect(view.k).toBeCloseTo(2);
    // What was midway between the fingers, at x = 150, is midway between them still, at x = 200.
    expect((200 - view.x) / view.k).toBeCloseTo(150);
    expect((100 - view.y) / view.k).toBeCloseTo(100);
  });

  it("carries on panning with the finger left when one of two lifts, without a jump", () => {
    const pinch = [touch(10, { kind: "none" }), touch(11, { kind: "none" }, 200, 100), slide(11, 300, 100)];
    const before = run(pinch).view;
    const { view, state } = run([...pinch, lift(11), slide(10, 100, 100), slide(10, 120, 90)]);
    expect(state).toMatchObject({ kind: "pan" });
    expect(view).toEqual({ ...before, x: before.x + 20, y: before.y - 10 });
  });

  it("turns a press into a pinch when a second finger comes down", () => {
    const { fx, state } = run([touch(10, { kind: "end", end: p }), touch(11, { kind: "none" }, 200, 100), slide(10, 90, 100), lift(10), lift(11)]);
    expect(state).toBeUndefined();
    expect(fx.every((f) => f.kind === "view")).toBe(true);
  });

  it("keeps a wire in hand while another finger pans, its tip staying under the finger carrying it", () => {
    const { fx, state, view } = run([
      touch(10, { kind: "end", end: p }),
      slide(10, 150, 100),
      touch(11, { kind: "none" }, 300, 300),
      slide(11, 260, 300),
    ]);
    expect(view).toEqual({ x: -40, y: 0, k: 1 });
    // Under the finger at 150 on screen is 190 in the net now.
    expect(state).toMatchObject({ kind: "wire", cur: { x: 190, y: 100 } });
    expect(fx).toEqual([{ kind: "view", view: { x: -40, y: 0, k: 1 } }]);
    // Letting go of the wire finishes it; the finger left on the view pans it.
    const after = run([
      touch(10, { kind: "end", end: p }),
      slide(10, 150, 100),
      touch(11, { kind: "none" }, 300, 300),
      slide(11, 260, 300),
      lift(10),
      slide(11, 250, 300),
    ]);
    expect(after.fx).toContainEqual({ kind: "finish-wire", g: { kind: "new", from: p } });
    expect(after.state).toMatchObject({ kind: "pan" });
    expect(after.view.x).toBe(-50);
  });

  it("keeps a wire in hand while two other fingers pinch", () => {
    const { state, view } = run([
      touch(10, { kind: "end", end: p }, 50, 50),
      slide(10, 60, 50),
      touch(11, { kind: "none" }, 200, 200),
      touch(12, { kind: "none" }, 300, 200),
      slide(12, 400, 200),
    ]);
    expect(view.k).toBeCloseTo(2);
    expect(state).toMatchObject({ kind: "wire", screen: { x: 60, y: 50 } });
    const cur = (state as Extract<Gesture, { kind: "wire" }>).cur;
    expect(cur.x * view.k + view.x).toBeCloseTo(60);
    expect(cur.y * view.k + view.y).toBeCloseTo(50);
  });

  it("moves agents with the view while another finger pans", () => {
    const { fx } = run([touch(10, { kind: "agent", id: 7 }), slide(10, 120, 100), touch(11, { kind: "none" }, 300, 300), slide(11, 290, 300), lift(11), lift(10)]);
    expect(fx).toEqual([
      { kind: "pick", id: 7, additive: false },
      { kind: "begin-move" },
      { kind: "move-by", dx: 20, dy: 0 },
      { kind: "view", view: { x: -10, y: 0, k: 1 } },
      { kind: "move-by", dx: 10, dy: 0 },
      { kind: "end-move" },
    ]);
  });

  it("snaps a carried wire to the nearest end it may go to, over nearer ones that refuse it", () => {
    const [near, nearer] = [port(2, 0), port(3, 0)];
    const c = ctx({
      near: (_at, reach) => (reach === 30 ? [p, nearer, near] : []),
      checkDrop: (_g, to) => (to === nearer ? { kind: "refuse", why: "no" } : { kind: "ok", join: false }),
    });
    const { state, fx } = run([touch(10, { kind: "end", end: p }), slide(10, 150, 100), lift(10)], c);
    expect(state).toBeUndefined();
    expect(fx).toEqual([{ kind: "finish-wire", g: { kind: "new", from: p }, to: near }]);
    // Only ends that refuse: shown as the target, so it says why, and letting go does nothing.
    const refused = run([touch(10, { kind: "end", end: p }), slide(10, 150, 100)], ctx({ near: () => [nearer], checkDrop: () => ({ kind: "refuse", why: "no" }) }));
    expect(refused.state).toMatchObject({ kind: "wire", target: nearer, check: { kind: "refuse" } });
  });

  it("looks for ends within the same reach on screen whatever the zoom", () => {
    const reaches: number[] = [];
    const c = ctx({ view: () => ({ x: 0, y: 0, k: 3 }), near: (_at, r) => (reaches.push(r), []) });
    run([touch(10, { kind: "end", end: p }), slide(10, 150, 100)], c);
    expect(reaches).toEqual([10]);
  });

  it("previews an active pair on the first tap and fires it on the second", () => {
    let hover: Hover | undefined;
    const c = ctx({ clickable: () => "fire", hover: () => hover });
    const first = run([touch(10, { kind: "wire", id: 4 }), lift(10)], c, true);
    expect(first.fx).toEqual([{ kind: "hover", hover: { kind: "wire", id: 4 } }]);
    hover = { kind: "wire", id: 4 };
    const second = run([touch(10, { kind: "wire", id: 4 }), lift(10)], c, true);
    expect(second.fx).toEqual([
      { kind: "fire", id: 4 },
      { kind: "hover", hover: undefined },
    ]);
    // Another pair's preview showing: this tap previews this one.
    hover = { kind: "wire", id: 5 };
    expect(run([touch(10, { kind: "wire", id: 4 }), lift(10)], c).fx).toEqual([]);
  });

  it("opens a pair with no rule on the second tap, and selects any other wire on the first", () => {
    const hover: Hover = { kind: "wire", id: 4 };
    expect(run([touch(10, { kind: "wire", id: 4 }), lift(10)], ctx({ clickable: () => "stuck", hover: () => hover })).fx).toEqual([{ kind: "stuck", id: 4 }]);
    expect(run([touch(10, { kind: "wire", id: 4 }), lift(10)]).fx).toEqual([{ kind: "select-wire", id: 4 }]);
  });

  it("pans instead of firing when a finger slides off a pair", () => {
    const hover: Hover = { kind: "wire", id: 4 };
    const { fx } = run([touch(10, { kind: "wire", id: 4 }), slide(10, 140, 100), lift(10)], ctx({ clickable: () => "fire", hover: () => hover }), true);
    expect(fx).toEqual([{ kind: "view", view: { x: 40, y: 0, k: 1 } }]);
  });

  it("leaves a tapped port or agent hovered, and clears the hover after a drag", () => {
    expect(run([touch(10, { kind: "end", end: p }), lift(10)], ctx(), true).fx).toEqual([{ kind: "hover", hover: { kind: "port", end: p } }]);
    expect(run([touch(10, { kind: "agent", id: 7 }), lift(10)], ctx({ isSelected: () => true }), true).fx).toEqual([{ kind: "hover", hover: { kind: "agent", id: 7 } }]);
    const drag = run([touch(10, { kind: "agent", id: 7 }), slide(10, 130, 100), lift(10)], ctx({ isSelected: () => true }), true);
    expect(drag.fx.at(-1)).toEqual({ kind: "hover", hover: undefined });
  });

  it("puts the view back when a pinch is cancelled, and a wire when it's cancelled mid-pan", () => {
    const pinch = run([touch(10, { kind: "none" }), touch(11, { kind: "none" }, 200, 100), slide(11, 300, 100), { kind: "cancel" }], ctx({ view: () => ({ x: 1, y: 2, k: 1 }) }));
    expect(pinch.state).toBeUndefined();
    expect(pinch.view).toEqual({ x: 1, y: 2, k: 1 });
    const wire = run([touch(10, { kind: "end", end: p }), slide(10, 150, 100), touch(11, { kind: "none" }, 300, 300), slide(11, 260, 300), { kind: "cancel" }]);
    expect(wire.fx.at(-1)).toEqual({ kind: "return-wire", g: { kind: "new", from: p } });
  });

  it("ignores a third finger", () => {
    const { state } = run([touch(10, { kind: "none" }), touch(11, { kind: "none" }, 200, 100), touch(12, { kind: "none" }, 300, 300), slide(12, 0, 0), lift(12)]);
    expect(state).toMatchObject({ kind: "pan", grip: { fingers: [{ id: 10 }, { id: 11 }] } });
  });
});

describe("double taps", () => {
  it("zooms in about a second tap on nothing soon after the first, which still clears", () => {
    const { fx } = run([touch(10, { kind: "none" }, 100, 100, 0), lift(10, 80), touch(11, { kind: "none" }, 110, 96, 250), lift(11, 320)], ctx(), true);
    expect(fx).toEqual([{ kind: "clear-selection" }, { kind: "hover", hover: undefined }, { kind: "zoom", by: 2, about: { x: 110, y: 96 } }]);
  });

  it("takes two taps too far apart, in time or on screen, as two taps", () => {
    const late = run([touch(10, { kind: "none" }, 100, 100, 0), lift(10, 80), touch(11, { kind: "none" }, 100, 100, 80 + DOUBLE.time + 1), lift(11, 500)]);
    expect(late.fx).toEqual([{ kind: "clear-selection" }, { kind: "clear-selection" }]);
    const far = run([touch(10, { kind: "none" }, 100, 100, 0), lift(10, 80), touch(11, { kind: "none" }, 100 + DOUBLE.reach + 1, 100, 200), lift(11, 260)]);
    expect(far.fx).toEqual([{ kind: "clear-selection" }, { kind: "clear-selection" }]);
  });

  it("doesn't count a tap on something as the first of a double tap, nor a double tap's second as another's first", () => {
    const onAgent = run([touch(10, { kind: "agent", id: 7 }, 100, 100, 0), lift(10, 80), touch(11, { kind: "none" }, 100, 100, 200), lift(11, 260)]);
    expect(onAgent.fx.filter((f) => f.kind !== "pick")).toEqual([{ kind: "clear-selection" }]);
    const third = run([
      touch(10, { kind: "none" }, 100, 100, 0),
      lift(10, 60),
      touch(11, { kind: "none" }, 100, 100, 120),
      lift(11, 180),
      touch(12, { kind: "none" }, 100, 100, 240),
      lift(12, 300),
    ]);
    expect(third.fx.filter((f) => f.kind === "zoom")).toHaveLength(1);
  });

  it("zooms with the finger after a double tap, in dragging down and out dragging up, about where it went down", () => {
    const twice = [touch(10, { kind: "none" }, 100, 100, 0), lift(10, 60), touch(11, { kind: "none" }, 100, 100, 120)];
    const down = run([...twice, slide(11, 100, 250), lift(11, 400)]);
    expect(down.view.k).toBeGreaterThan(2);
    // What was under the finger at (100, 100) still is.
    expect((100 - down.view.x) / down.view.k).toBeCloseTo(100);
    expect(down.fx.some((f) => f.kind === "zoom")).toBe(false);
    expect(run([...twice, slide(11, 100, 0)]).view.k).toBeLessThan(1);
    // Cancelled, the view goes back.
    expect(run([...twice, slide(11, 100, 250), { kind: "cancel" }]).view).toEqual({ x: 0, y: 0, k: 1 });
  });
});

describe("phone fingers", () => {
  const p = port(1, 1);
  let armed: WireGesture | undefined;
  const phone = (over: Partial<Ctx> = {}) => ctx({ phone: { armed: () => armed }, ...over });

  it("waits for a hold on nothing, an agent or a wire, but not on an end", () => {
    armed = undefined;
    const waits = (hit: Extract<Msg, { kind: "down" }>["hit"]) => run([touch(10, hit)], phone(), false, true).fx;
    expect(waits({ kind: "none" })).toEqual([{ kind: "await-hold", pointer: 10 }]);
    expect(waits({ kind: "agent", id: 7 })).toEqual([{ kind: "await-hold", pointer: 10 }]);
    expect(waits({ kind: "wire", id: 4 })).toEqual([{ kind: "await-hold", pointer: 10 }]);
    expect(waits({ kind: "end", end: p })).toEqual([]);
    // Without the phone layout, nothing waits, and a hold does nothing.
    expect(run([touch(10, { kind: "none" }), hold(10)], ctx(), false, true).fx).toEqual([]);
  });

  it("selects an agent on a tap, not before; and leaves it be when it's among several selected", () => {
    armed = undefined;
    expect(run([touch(10, { kind: "agent", id: 7 })], phone()).fx).toEqual([]);
    expect(run([touch(10, { kind: "agent", id: 7 }), lift(10)], phone()).fx).toEqual([{ kind: "pick", id: 7, additive: false }]);
    expect(run([touch(10, { kind: "agent", id: 7 }), lift(10)], phone({ isSelected: () => true })).fx).toEqual([]);
  });

  it("adds a held agent to the selection, or takes it out, and then only moves what's selected", () => {
    armed = undefined;
    const held = run([touch(10, { kind: "agent", id: 7 }), hold(10), lift(10)], phone());
    expect(held.fx).toEqual([
      { kind: "held", screen: { x: 100, y: 100 } },
      { kind: "pick", id: 7, additive: true },
    ]);
    const dragged = run([touch(10, { kind: "agent", id: 7 }), hold(10), slide(10, 130, 100), lift(10)], phone());
    expect(dragged.fx).toEqual([
      { kind: "held", screen: { x: 100, y: 100 } },
      { kind: "pick", id: 7, additive: true },
      { kind: "begin-move" },
      { kind: "move-by", dx: 30, dy: 0 },
      { kind: "end-move" },
    ]);
  });

  it("selects an agent dragged without a hold, then moves it", () => {
    armed = undefined;
    const { fx } = run([touch(10, { kind: "agent", id: 7 }), slide(10, 130, 100), lift(10)], phone());
    expect(fx.slice(0, 2)).toEqual([{ kind: "pick", id: 7, additive: false }, { kind: "begin-move" }]);
  });

  it("ignores a hold once the finger has moved, or one meant for another finger", () => {
    armed = undefined;
    const moved = run([touch(10, { kind: "none" }), slide(10, 130, 100), hold(10)], phone());
    expect(moved.state).toMatchObject({ kind: "pan" });
    const other = run([touch(10, { kind: "none" }), hold(11)], phone());
    expect(other.state).toMatchObject({ kind: "tap" });
  });

  it("draws a marquee from a hold on nothing, adding to the selection", () => {
    armed = undefined;
    const { fx, state } = run([touch(10, { kind: "none" }), hold(10), slide(10, 160, 140)], phone());
    expect(fx).toEqual([{ kind: "held", screen: { x: 100, y: 100 } }]);
    expect(state).toMatchObject({ kind: "marquee", additive: true, moved: true, start: { x: 100, y: 100 }, cur: { x: 160, y: 140 } });
    const done = run([touch(10, { kind: "none" }), hold(10), slide(10, 160, 140), lift(10)], phone());
    expect(done.fx.at(-1)).toMatchObject({ kind: "select-in", marquee: { additive: true } });
  });

  it("opens the hold menu when a finger held on nothing lifts without moving", () => {
    armed = undefined;
    const { fx } = run([touch(10, { kind: "none" }, 120, 80), hold(10), lift(10)], phone());
    expect(fx).toEqual([
      { kind: "held", screen: { x: 120, y: 80 } },
      { kind: "hold-menu", screen: { x: 120, y: 80 }, at: { x: 120, y: 80 } },
    ]);
  });

  it("pinches when a second finger joins a held finger's marquee", () => {
    armed = undefined;
    const { state } = run([touch(10, { kind: "none" }), hold(10), touch(11, { kind: "none" }, 200, 100)], phone());
    expect(state).toMatchObject({ kind: "pan", grip: { fingers: [{ id: 10 }, { id: 11 }] } });
  });

  it("selects a held active pair's wire, ending its preview, so the next tap previews it again rather than firing", () => {
    armed = undefined;
    let hover: Hover | undefined = { kind: "wire", id: 4 };
    const c = phone({ clickable: () => "fire", hover: () => hover });
    const held = run([touch(10, { kind: "wire", id: 4 }), hold(10), lift(10)], c, true);
    expect(held.fx).toEqual([
      { kind: "held", screen: { x: 100, y: 100 } },
      { kind: "select-wire", id: 4 },
      { kind: "hover", hover: undefined },
    ]);
    hover = undefined;
    expect(run([touch(10, { kind: "wire", id: 4 }), lift(10)], c, true).fx).toEqual([{ kind: "hover", hover: { kind: "wire", id: 4 } }]);
    // A held plain wire is selected and stays pointed at; the finger then moves the view.
    const plain = run([touch(10, { kind: "wire", id: 5 }), hold(10), slide(10, 140, 100)], phone(), true);
    expect(plain.fx).toEqual([
      { kind: "held", screen: { x: 100, y: 100 } },
      { kind: "select-wire", id: 5 },
      { kind: "hover", hover: { kind: "wire", id: 5 } },
      { kind: "view", view: { x: 40, y: 0, k: 1 } },
    ]);
  });

  it("starts a wire from a tapped empty port or loose end, but not from a wired port", () => {
    armed = undefined;
    expect(run([touch(10, { kind: "end", end: p }), lift(10)], phone()).fx).toEqual([{ kind: "arm", g: { kind: "new", from: p } }]);
    const loose: WireGesture = { kind: "carry", wire: 3, moving: free("a"), anchor: port(2, 0) };
    expect(run([touch(10, { kind: "end", end: free("a") }), lift(10)], phone({ gestureAt: () => loose })).fx).toEqual([{ kind: "arm", g: loose }]);
    const wired: WireGesture = { kind: "carry", wire: 3, moving: p, anchor: port(2, 0) };
    expect(run([touch(10, { kind: "end", end: p }), lift(10)], phone({ gestureAt: () => wired })).fx).toEqual([]);
  });

  it("starts a wire from a rule's empty interface end, but leaves one with a wire be", () => {
    armed = undefined;
    const end = free("L1");
    expect(run([touch(10, { kind: "end", end }), lift(10)], phone({ fixedEnds: true })).fx).toEqual([{ kind: "arm", g: { kind: "new", from: end } }]);
    const wired: WireGesture = { kind: "carry", wire: 3, moving: end, anchor: port(2, 1) };
    expect(run([touch(10, { kind: "end", end }), lift(10)], phone({ fixedEnds: true, gestureAt: () => wired })).fx).toEqual([]);
  });

  it("finishes a waiting wire on a rule's interface end it may go to, and says why not on one it may not", () => {
    armed = { kind: "new", from: p };
    const end = free("R2");
    expect(run([touch(10, { kind: "end", end }), lift(10)], phone({ fixedEnds: true })).fx).toEqual([{ kind: "finish-wire", g: armed, to: end }, { kind: "disarm" }]);
    const taken: DropCheck = { kind: "refuse", why: "This interface port already has a wire." };
    expect(run([touch(10, { kind: "end", end }), lift(10)], phone({ fixedEnds: true, checkDrop: () => taken }), true).fx).toEqual([
      { kind: "hover", hover: { kind: "drag", gesture: armed, target: end, check: taken } },
    ]);
  });

  it("finishes a waiting wire on a tap on an end it may go to, says why not on one it may not, and lets go on its own end", () => {
    armed = { kind: "new", from: p };
    const q = port(2, 0);
    expect(run([touch(10, { kind: "end", end: q }), lift(10)], phone()).fx).toEqual([{ kind: "finish-wire", g: armed, to: q }, { kind: "disarm" }]);
    const refuse: DropCheck = { kind: "refuse", why: "no" };
    expect(run([touch(10, { kind: "end", end: q }), lift(10)], phone({ checkDrop: () => refuse }), true).fx).toEqual([
      { kind: "hover", hover: { kind: "drag", gesture: armed, target: q, check: refuse } },
    ]);
    expect(run([touch(10, { kind: "end", end: p }), lift(10)], phone()).fx).toEqual([{ kind: "disarm" }]);
  });

  it("lets go of a waiting wire on a tap elsewhere, or a hold on nothing", () => {
    armed = { kind: "new", from: p };
    expect(run([touch(10, { kind: "none" }), lift(10)], phone()).fx).toEqual([{ kind: "disarm" }, { kind: "clear-selection" }]);
    expect(run([touch(10, { kind: "agent", id: 7 }), lift(10)], phone()).fx).toEqual([{ kind: "disarm" }, { kind: "pick", id: 7, additive: false }]);
    expect(run([touch(10, { kind: "none" }), hold(10)], phone()).fx).toEqual([{ kind: "held", screen: { x: 100, y: 100 } }, { kind: "disarm" }]);
  });

  it("tells the chrome of every tap, but not of a hold or a drag", () => {
    armed = undefined;
    const taps = (msgs: Msg[]) => run(msgs, phone(), false, true).fx.filter((f) => f.kind === "tapped");
    expect(taps([touch(10, { kind: "agent", id: 7 }), lift(10, 50)])).toEqual([{ kind: "tapped", screen: { x: 100, y: 100 }, time: 50, empty: false }]);
    expect(taps([touch(10, { kind: "none" }), lift(10, 50)])).toEqual([{ kind: "tapped", screen: { x: 100, y: 100 }, time: 50, empty: true }]);
    expect(taps([touch(10, { kind: "none" }), hold(10), lift(10)])).toEqual([]);
    expect(taps([touch(10, { kind: "agent", id: 7 }), slide(10, 140, 100), lift(10)])).toEqual([]);
  });
});

describe("what a finger reaches", () => {
  const p = port(1, 0);
  it("takes the nearest, counting ends a little nearer", () => {
    expect(reach({ ends: [{ end: p, d: 12 }], agents: [{ id: 1, d: 6 }], wires: [] }, 1.5)).toEqual({ kind: "end", end: p });
    expect(reach({ ends: [], agents: [{ id: 1, d: 6 }], wires: [{ id: 2, d: 4 }] }, 1)).toEqual({ kind: "wire", id: 2 });
    expect(reach({ ends: [], agents: [], wires: [] }, 1)).toBeUndefined();
  });

  it("gives a press to a wire rather than an end further than the end's own size", () => {
    // Zoomed out, the end is 9px away: further than its size and a little, so the wire under the finger wins.
    const k = 0.3;
    expect(END_SIZE * k + END_GRACE).toBeLessThan(9);
    expect(reach({ ends: [{ end: p, d: 9 }], agents: [], wires: [{ id: 2, d: 7 }] }, k)).toEqual({ kind: "wire", id: 2 });
    // With no wire near, the end keeps its long reach.
    expect(reach({ ends: [{ end: p, d: 20 }], agents: [], wires: [] }, k)).toEqual({ kind: "end", end: p });
  });

  it("keeps a port pressed at normal zoom for dragging its wire out, even with the finger on the wire", () => {
    expect(reach({ ends: [{ end: p, d: 3 }], agents: [{ id: 1, d: 2 }], wires: [{ id: 2, d: 1 }] }, 1.5)).toEqual({ kind: "end", end: p });
    expect(reach({ ends: [{ end: p, d: 12 }], agents: [], wires: [{ id: 2, d: 6 }] }, 1.5)).toEqual({ kind: "end", end: p });
  });
});
