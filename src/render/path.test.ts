import { describe, expect, it } from "vitest";
import { flattenPath, resampleAt, sampling } from "./path";

/** The sharpest turn along a polyline, in degrees. */
function sharpest(pts: { x: number; y: number }[]): number {
  let most = 0;
  for (let i = 2; i < pts.length; i++) {
    const [a, b, c] = [pts[i - 2]!, pts[i - 1]!, pts[i]!];
    const t = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    most = Math.max(most, Math.abs(Math.atan2(Math.sin(t), Math.cos(t))));
  }
  return (most * 180) / Math.PI;
}

const curves = [
  [{ x: 0, y: 0 }, { x: 140, y: 60, s: true }],
  [{ x: 0, y: 0 }, { x: 600, y: 80, s: true }],
  [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 90 }],
];

describe("flattened wires", () => {
  it("turn too little at each point to look angular, however long", () => {
    for (const c of curves) expect(sharpest(flattenPath(c, 9))).toBeLessThan(12);
  });

  it("keep their shape when sampled together, as for an animation", () => {
    const flat = curves.map((c) => flattenPath(c, 9));
    const u = sampling([flat[0]!, flat[2]!], 24);
    for (const f of [flat[0]!, flat[2]!]) {
      const got = resampleAt(f, u);
      expect(got[0]).toMatchObject({ x: 0, y: 0 });
      for (const p of f) expect(Math.min(...got.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))).toBeLessThan(0.01);
    }
  });
});
