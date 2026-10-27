import { describe, expect, it } from "vitest";
import { type Detent, type DetentMsg, type SheetAt, updateDetent } from "./detent";
import { arrange, firstRow } from "./order";
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

function sheet(msgs: DetentMsg[], from: SheetAt | Detent = "peek") {
  let s: SheetAt = typeof from === "string" ? { detent: from } : from;
  for (const m of msgs) s = updateDetent(s, m);
  return s;
}
const empty: DetentMsg = { kind: "tap-canvas", empty: true, focus: false };
const onThing: DetentMsg = { kind: "tap-canvas", empty: false, focus: true };

describe("the sheet's height", () => {
  it("goes all the way down on a tap on empty canvas, from anywhere", () => {
    for (const d of ["peek", "open", "closed"] as const) expect(sheet([empty], d).detent).toBe("closed");
  });

  it("goes down on a tap on the grabber while up, and comes back to its peek on another", () => {
    expect(sheet([{ kind: "tap-grabber" }], "open").detent).toBe("closed");
    expect(sheet([{ kind: "tap-grabber" }], "peek").detent).toBe("closed");
    expect(sheet([{ kind: "tap-grabber" }, { kind: "tap-grabber" }], "open").detent).toBe("peek");
  });

  it("settles where a drag lets it go", () => {
    for (const d of ["closed", "peek", "open"] as const) expect(sheet([{ kind: "settle", to: d }]).detent).toBe(d);
  });

  it("shows what's tapped at its peek, lowering it from all the way up or raising it from closed", () => {
    expect(sheet([onThing], "open").detent).toBe("peek");
    expect(sheet([onThing], "closed").detent).toBe("peek");
    // A tap on something that leaves nothing to show leaves it be.
    expect(sheet([{ kind: "tap-canvas", empty: false, focus: false }], "closed").detent).toBe("closed");
  });

  it("goes back down when what raised it is let go, but not once it's been moved since", () => {
    const raised = sheet([{ kind: "focus", on: true }], "closed");
    expect(raised).toEqual({ detent: "peek", raisedFrom: "closed" });
    expect(sheet([{ kind: "focus", on: false }], raised).detent).toBe("closed");
    expect(sheet([onThing, { kind: "focus", on: false }], "closed").detent).toBe("closed");
    expect(sheet([{ kind: "settle", to: "open" }, { kind: "focus", on: false }], raised).detent).toBe("open");
    expect(sheet([{ kind: "pick" }, { kind: "focus", on: false }], raised).detent).toBe("peek");
    // Something already selected doesn't raise it again.
    expect(sheet([{ kind: "focus", on: true }], "open")).toEqual({ detent: "open" });
  });

  it("gets out of a lifted tile's way, and comes back to where it was", () => {
    const lifted = sheet([{ kind: "lift", on: true }], "open");
    expect(lifted.detent).toBe("closed");
    expect(sheet([{ kind: "lift", on: false }], lifted).detent).toBe("open");
    expect(sheet([{ kind: "more" }], "peek").detent).toBe("open");
  });
});

/** Actions by id; `main` the primary one. */
const acts = (ids: string[], main?: string) => ids.map((id) => ({ id, primary: id === main }));
const ids = (as: { id: string }[]) => as.map((a) => a.id);
const more = { id: "more" };

describe("the order of actions", () => {
  it("puts the main action first and Delete last of the first row, just before More", () => {
    const agent = arrange(acts(["all", "connected", "change", "paste", "cut", "delete", "flip", "duplicate", "copy", "component"]), 5, true);
    expect(ids(agent)).toEqual(["copy", "duplicate", "flip", "delete", "cut", "paste", "change", "connected", "all", "component"]);
    expect(ids(firstRow(agent, 5, more))).toEqual(["copy", "duplicate", "flip", "delete", "more"]);
    const pair = arrange(acts(["fire", "rule", "delete", "ends", "connected", "all"], "fire"), 5, true);
    expect(ids(firstRow(pair, 5, more))).toEqual(["fire", "rule", "ends", "delete", "more"]);
    // Opened, the rest follow, and Delete stays where it was.
    expect(ids(pair)).toEqual(["fire", "rule", "ends", "delete", "connected", "all"]);
  });

  it("puts Delete last when everything fits in the row", () => {
    expect(ids(arrange(acts(["delete", "ends", "connected", "all"]), 5, true))).toEqual(["ends", "connected", "all", "delete"]);
    expect(ids(arrange(acts(["rule", "delete", "all", "ends", "connected"], "rule"), 5, true))).toEqual(["rule", "ends", "connected", "all", "delete"]);
    const wire = arrange(acts(["delete", "ends", "connected", "all"]), 5, true);
    expect(ids(firstRow(wire, 5, more))).toEqual(ids(wire));
  });

  it("puts Delete last of the first row where nothing folds away", () => {
    expect(ids(arrange(acts(["copy", "delete", "duplicate", "flip", "cut"]), 3, false))).toEqual(["copy", "duplicate", "delete", "flip", "cut"]);
  });

  it("keeps the main action first for a component, and does without Delete where there's none", () => {
    const component = arrange(acts(["copy", "delete", "open", "apart", "expand", "all", "connected", "paste", "cut", "duplicate"], "open"), 5, true);
    expect(ids(firstRow(component, 5, more))).toEqual(["open", "copy", "duplicate", "delete", "more"]);
    expect(ids(arrange(acts(["select-wire", "rule", "fire"], "fire"), 5, true))).toEqual(["fire", "rule", "select-wire"]);
    expect(ids(arrange(acts(["stop"], "stop"), 5, true))).toEqual(["stop"]);
  });
});
