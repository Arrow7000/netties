import { expect, it } from "vitest";
import { insidePolygon, segmentHitsBox } from "./geometry";

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
