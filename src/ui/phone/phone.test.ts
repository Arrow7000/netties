import { describe, expect, it } from "vitest";
import { type TileEffect, type TileMsg, type TilePress, updateTile } from "./tile";
import { type Transport, type TransportEffect, type TransportMsg, updateTransport } from "./transport";

/** Run messages from idle, collecting every effect but the waits for holds. */
function tile(msgs: TileMsg[]) {
  let s: TilePress | undefined;
  const fx: TileEffect[] = [];
  for (const m of msgs) {
    const [next, out] = updateTile(s, m);
    s = next;
    fx.push(...out.filter((f) => f.kind !== "await-hold"));
  }
  return { state: s, fx };
}
const down = (x = 100, y = 800, axis: "x" | "y" = "x"): TileMsg => ({ kind: "down", pointer: 1, at: { x, y }, axis, lift: 50 });
const move = (x: number, y: number): TileMsg => ({ kind: "move", pointer: 1, at: { x, y } });
const up = (x = 100, y = 800): TileMsg => ({ kind: "up", pointer: 1, at: { x, y } });
const hold: TileMsg = { kind: "hold", pointer: 1 };

describe("tiles", () => {
  it("waits for a hold, and takes a tap as a tap", () => {
    expect(updateTile(undefined, down())[1]).toEqual([{ kind: "await-hold", pointer: 1 }]);
    expect(tile([down(), move(103, 802), up(103, 802)]).fx).toEqual([{ kind: "tap" }]);
  });

  it("leaves a drag along the row to the browser, which scrolls it", () => {
    const { state, fx } = tile([down(), move(130, 802), hold, up(150, 802)]);
    expect(state).toBeUndefined();
    expect(fx).toEqual([]);
    // Sideways the row runs up and down.
    expect(tile([down(100, 300, "y"), move(102, 340)]).state).toBeUndefined();
  });

  it("lifts a tile dragged out across the row, drawing it above the finger, and drops it where it's drawn", () => {
    const { fx } = tile([down(), move(104, 760), move(200, 400), up(200, 400)]);
    expect(fx).toEqual([
      { kind: "lift", held: false },
      { kind: "carry", at: { x: 104, y: 710 } },
      { kind: "carry", at: { x: 200, y: 350 } },
      { kind: "drop", at: { x: 200, y: 350 } },
    ]);
  });

  it("lifts a held tile at once, which can then go any way, even along the row", () => {
    const { fx } = tile([down(), hold, move(300, 790), up(300, 790)]);
    expect(fx).toEqual([
      { kind: "lift", held: true },
      { kind: "carry", at: { x: 100, y: 750 } },
      { kind: "carry", at: { x: 300, y: 740 } },
      { kind: "drop", at: { x: 300, y: 740 } },
    ]);
  });

  it("puts a held tile back when it's let go without moving, or the press is called off", () => {
    expect(tile([down(), hold, up()]).fx.at(-1)).toEqual({ kind: "put-back" });
    expect(tile([down(), move(104, 760), { kind: "cancel" }]).fx.at(-1)).toEqual({ kind: "put-back" });
    expect(tile([down(), { kind: "cancel" }]).fx).toEqual([]);
  });

  it("pays no heed to a hold after the finger has gone, or to another pointer", () => {
    expect(tile([down(), up(), hold]).fx).toEqual([{ kind: "tap" }]);
    expect(tile([down(), { kind: "hold", pointer: 2 }, { kind: "up", pointer: 2, at: { x: 0, y: 0 } }]).state).toMatchObject({ kind: "press" });
  });
});

function transport(msgs: TransportMsg[], from: Transport = {}) {
  let s = from;
  const fx: TransportEffect[] = [];
  for (const m of msgs) {
    const [next, out] = updateTransport(s, m);
    s = next;
    fx.push(...out.filter((f) => f.kind !== "await-hold"));
  }
  return { state: s, fx };
}
const press = (button: "step" | "all" | "run", pointer = 1, holdable = true): TransportMsg => ({ kind: "down", button, pointer, holdable });
const lift = (pointer = 1): TransportMsg => ({ kind: "up", pointer });

describe("the run buttons", () => {
  it("fire on a quick tap", () => {
    expect(transport([press("step"), lift()])).toEqual({ state: {}, fx: [{ kind: "fire", button: "step" }] });
  });

  it("arm on a hold, without firing, and fire on the next quick tap", () => {
    const armed = transport([press("all"), { kind: "hold", pointer: 1 }, lift()]);
    expect(armed).toEqual({ state: { armed: "all" }, fx: [{ kind: "held" }] });
    expect(transport([press("all", 2), lift(2)], armed.state)).toEqual({ state: {}, fx: [{ kind: "fire", button: "all" }] });
  });

  it("stay armed through another hold, and let go on a tap elsewhere", () => {
    const armed = transport([press("step"), { kind: "hold", pointer: 1 }, lift()]).state;
    expect(transport([press("step", 2), { kind: "hold", pointer: 2 }, lift(2)], armed).state).toEqual({ armed: "step" });
    expect(transport([{ kind: "elsewhere" }], armed).state).toEqual({});
    // Elsewhere may be another button, which then fires as any quick tap does.
    expect(transport([{ kind: "elsewhere" }, press("run", 2), lift(2)], armed)).toEqual({ state: {}, fx: [{ kind: "fire", button: "run" }] });
  });

  it("do nothing when the pointer slides off before letting go, or is called off", () => {
    expect(transport([press("step"), { kind: "slide", pointer: 1, inside: false }, lift()])).toEqual({ state: {}, fx: [] });
    expect(transport([press("step"), { kind: "slide", pointer: 1, inside: false }, { kind: "hold", pointer: 1 }, lift()]).state).toEqual({});
    expect(transport([press("step"), { kind: "cancel", pointer: 1 }, lift()])).toEqual({ state: {}, fx: [] });
  });

  it("only arm a button that may be held", () => {
    expect(updateTransport({}, press("run", 1, false))[1]).toEqual([]);
    expect(updateTransport({}, press("run", 1, true))[1]).toEqual([{ kind: "await-hold", pointer: 1 }]);
  });
});
