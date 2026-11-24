import { describe, expect, it } from "vitest";
import { portArrow } from "./svg";

describe("the arrow of a port being pointed at", () => {
  const wire = (len: number) => [{ x: 0, y: 0 }, { x: 0, y: len }];

  it("sits right outside the port, pointing the port's own way", () => {
    expect(portArrow(wire(100), true, true)).toEqual({ at: { x: 0, y: 3.4 }, dx: 0, dy: 1, instead: false });
    expect(portArrow(wire(100), false, true)).toMatchObject({ at: { x: 0, y: 3.4 }, dy: -1, instead: false });
  });

  it("follows the wire round a bend", () => {
    const a = portArrow([{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 50, y: 2 }], true, true)!;
    expect(a.at.x).toBeCloseTo(1.4);
    expect(a).toMatchObject({ at: { y: 2 }, dx: 1, dy: 0 });
  });

  it("takes the place of the wire's own arrow when they'd be crammed together", () => {
    expect(portArrow(wire(26), true, true)!.instead).toBe(true);
    expect(portArrow(wire(40), true, true)!.instead).toBe(false);
  });

  it("stays on a short wire", () => {
    expect(portArrow(wire(15), true, true)).toMatchObject({ at: { x: 0, y: 3.4 }, instead: true });
    expect(portArrow(wire(6), false, false)).toMatchObject({ at: { x: 0, y: 3 }, dy: -1, instead: false });
    expect(portArrow(wire(4), true, false)).toBeUndefined();
  });
});
