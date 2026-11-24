import { describe, expect, it } from "vitest";
import { portArrow } from "./svg";

describe("the arrow of a port being pointed at", () => {
  const wire = (len: number) => [{ x: 0, y: 0 }, { x: 0, y: len }];

  it("sits where an empty port's would, pointing the port's own way", () => {
    expect(portArrow(wire(100), true, 1)).toEqual({ at: { x: 0, y: 7.2 }, dx: 0, dy: 1, instead: false });
    expect(portArrow(wire(100), false, -1)).toMatchObject({ at: { x: 0, y: 7.2 }, dy: -1, instead: false });
  });

  it("follows the wire round a bend", () => {
    const a = portArrow([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 50, y: 4 }], true, 1)!;
    expect(a.at.x).toBeCloseTo(3.2);
    expect(a).toMatchObject({ at: { y: 4 }, dx: 1, dy: 0 });
  });

  it("takes the place of the wire's own arrow when they'd be crammed together", () => {
    expect(portArrow(wire(26), true, 1)!.instead).toBe(true);
    expect(portArrow(wire(40), true, 1)!.instead).toBe(false);
  });

  it("leaves it to the wire's own arrow right at that spot, unless that says otherwise", () => {
    expect(portArrow(wire(15), true, 1)).toBeUndefined();
    expect(portArrow(wire(15), true, -1)).toMatchObject({ dy: 1, instead: true });
    expect(portArrow(wire(10), false, 0)).toMatchObject({ at: { x: 0, y: 5 }, instead: false });
  });
});
