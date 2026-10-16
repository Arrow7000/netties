import { describe, expect, it } from "vitest";
import { free, port } from "../core/net";
import type { DropCheck, WireGesture } from "../state/model";
import { type Ctx, type Gesture, type Msg, update } from "./gesture";

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  readonly: false,
  gestureAt: (e) => ({ kind: "new", from: e }),
  checkDrop: () => ({ kind: "ok", join: false }),
  isSelected: () => false,
  clickable: () => undefined,
  zoom: () => 1,
  view: () => ({ x: 0, y: 0 }),
  ...over,
});

const down = (hit: Extract<Msg, { kind: "down" }>["hit"], extra: Partial<Extract<Msg, { kind: "down" }>> = {}): Msg => ({
  kind: "down",
  hit,
  button: 0,
  client: { x: 100, y: 100 },
  at: { x: 10, y: 10 },
  shift: false,
  alt: false,
  space: false,
  ...extra,
});
const move = (dx: number, dy: number, over?: Extract<Msg, { kind: "move" }>["over"]): Msg => ({
  kind: "move",
  client: { x: 100 + dx, y: 100 + dy },
  at: { x: 10 + dx, y: 10 + dy },
  over,
});

/** Run messages from idle, collecting every effect. */
function run(msgs: Msg[], c = ctx()) {
  let s: Gesture | undefined;
  const fx = [];
  for (const m of msgs) {
    const [next, out] = update(s, m, c);
    s = next;
    fx.push(...out.filter((f) => f.kind !== "hover"));
  }
  return { state: s, fx };
}

describe("pointer gestures", () => {
  const p = port(1, 1);

  it("leaves a wire alone when a port is pressed and let go", () => {
    const { state, fx } = run([down({ kind: "end", end: p }), move(2, 1), { kind: "up", alt: false }]);
    expect(state).toBeUndefined();
    expect(fx).toEqual([]);
  });

  it("drags a wire once the pointer moves, and leaves a loose end over nothing", () => {
    const { fx } = run([down({ kind: "end", end: p }), move(20, 0), { kind: "up", alt: false }]);
    expect(fx).toEqual([{ kind: "finish-wire", g: { kind: "new", from: p } }]);
  });

  it("plugs a wire into an end that takes it, and does nothing over one that refuses", () => {
    const target = port(2, 0);
    const ok = run([down({ kind: "end", end: p }), move(20, 0, target), { kind: "up", alt: false }]);
    expect(ok.fx).toEqual([{ kind: "finish-wire", g: { kind: "new", from: p }, to: target }]);
    const refuse: DropCheck = { kind: "refuse", why: "no" };
    const no = run([down({ kind: "end", end: p }), move(20, 0, target), { kind: "up", alt: false }], ctx({ checkDrop: () => refuse }));
    expect(no.fx).toEqual([]);
  });

  it("doesn't count the end a new wire starts from as a target", () => {
    const { state } = run([down({ kind: "end", end: p }), move(20, 0, p)]);
    expect(state).toMatchObject({ kind: "wire", target: undefined });
  });

  it("cancels a wire drag with nothing done", () => {
    const g: WireGesture = { kind: "carry", wire: 3, moving: p, anchor: free("a") };
    const { state, fx } = run([down({ kind: "end", end: p }), move(20, 0), { kind: "cancel" }], ctx({ gestureAt: () => g }));
    expect(state).toBeUndefined();
    expect(fx).toEqual([]);
  });

  it("selects an agent at once but only moves it after the pointer moves, catching up with it", () => {
    const { fx } = run([down({ kind: "agent", id: 7 }), move(2, 0), move(10, 5), move(12, 5), { kind: "up", alt: false }]);
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
    const { fx } = run([down({ kind: "none" }, { button: 1 }), move(30, 40), { kind: "cancel" }], ctx({ view: () => ({ x: 5, y: 6 }) }));
    expect(fx).toEqual([
      { kind: "view", x: 35, y: 46 },
      { kind: "view", x: 5, y: 6 },
    ]);
  });

  it("clears the selection on a click on nothing, and selects what a dragged box takes in", () => {
    expect(run([down({ kind: "none" }), { kind: "up", alt: false }]).fx).toEqual([{ kind: "clear-selection" }]);
    const { fx } = run([down({ kind: "none" }), move(20, 20), { kind: "up", alt: false }]);
    expect(fx).toMatchObject([{ kind: "select-in", marquee: { start: { x: 10, y: 10 }, cur: { x: 30, y: 30 } } }]);
  });

  it("fires an active pair on a click, and selects it with Alt", () => {
    const c = ctx({ clickable: () => "fire" });
    expect(run([down({ kind: "wire", id: 4 }), { kind: "up", alt: false }], c).fx).toEqual([{ kind: "fire", id: 4 }]);
    expect(run([down({ kind: "wire", id: 4 }), { kind: "up", alt: true }], c).fx).toEqual([{ kind: "select-wire", id: 4 }]);
  });

  it("only pans a read-only canvas", () => {
    const { state } = run([down({ kind: "agent", id: 1 }), move(20, 0)], ctx({ readonly: true }));
    expect(state).toMatchObject({ kind: "pan", moved: true });
  });
});
