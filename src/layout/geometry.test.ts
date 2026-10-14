import { expect, it } from "vitest";
import { agentOutline, insidePolygon, segmentHitsBox, segmentHitsPolygon } from "./geometry";

const box = { x0: 0, y0: 0, x1: 10, y1: 10 };

it("finds segments that touch a box", () => {
  expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true); // straight through
  expect(segmentHitsBox({ x: 2, y: 2 }, { x: 3, y: 3 }, box)).toBe(true); // wholly inside
  expect(segmentHitsBox({ x: -5, y: -5 }, { x: 15, y: -5 }, box)).toBe(false); // passes above
  expect(segmentHitsBox({ x: -5, y: 6 }, { x: 6, y: -5 }, box)).toBe(true); // clips a corner
  expect(segmentHitsBox({ x: -5, y: 3 }, { x: 3, y: -5 }, box)).toBe(false); // misses the corner
  expect(segmentHitsBox({ x: 5, y: 12 }, { x: 5, y: 20 }, box)).toBe(false); // vertical, below
});

it("finds points inside a polygon", () => {
  const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  expect(insidePolygon({ x: 5, y: 3 }, tri)).toBe(true);
  expect(insidePolygon({ x: 1, y: 8 }, tri)).toBe(false);
});

it("finds segments through a polygon, not along its edges or through its corners", () => {
  const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
  expect(segmentHitsPolygon({ x: 5, y: -5 }, { x: 5, y: 20 }, tri)).toBe(true); // straight through
  expect(segmentHitsPolygon({ x: 4, y: 2 }, { x: 6, y: 2 }, tri)).toBe(true); // wholly inside
  expect(segmentHitsPolygon({ x: -5, y: 0 }, { x: 15, y: 0 }, tri)).toBe(false); // along an edge
  expect(segmentHitsPolygon({ x: 5, y: 10 }, { x: 5, y: 20 }, tri)).toBe(false); // from the tip outwards
  expect(segmentHitsPolygon({ x: 0, y: 10 }, { x: 10, y: 10 }, tri)).toBe(false); // touches the tip
  // A circle's outline has corners right where a vertical wire through its middle would meet it.
  const circle = agentOutline({ x: 0, y: 0, orient: "up" }, 0);
  expect(segmentHitsPolygon({ x: 0, y: -50 }, { x: 0, y: 50 }, circle)).toBe(true);
});
