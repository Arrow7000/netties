import { describe, expect, it } from "vitest";
import { agentOutline } from "./svg";
import { dashedOutline, fitDashes, pitchOf } from "./dashes";

/** The dashes of a path, each as its points. */
const dashes = (d: string) =>
  d
    .split("M")
    .filter(Boolean)
    .map((s) => s.split("L").map((p) => p.trim().split(" ").map(Number) as [number, number]));
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("dashed outlines", () => {
  for (const box of [false, true])
    for (const arity of [0, 1, 2, 3, 4, 5, 8, 12]) {
      if (!box && arity === 0) continue;
      for (const orient of ["up", "down"] as const)
        it(`wraps every corner alike (${box ? "box" : "triangle"}, ${arity} aux ports, ${orient})`, () => {
          const o = agentOutline({ x: 3, y: 5, orient }, arity, box);
          if (o.kind !== "poly") throw new Error();
          const ds = dashes(dashedOutline(o, { x: 3, y: 5 }, 2.6));
          const corners = ds.filter((q) => q.length === 3);
          expect(corners).toHaveLength(o.points.length);
          const arms = corners.flatMap(([a, b, c]) => [dist(a!, b!), dist(b!, c!)]);
          arms.forEach((l) => expect(l).toBeCloseTo(arms[0]!, 2));
          // Dashes and gaps hardly differ between sides.
          const sides = o.points.map((p, i) => Math.hypot(p.x - o.points[(i + 1) % o.points.length]!.x, p.y - o.points[(i + 1) % o.points.length]!.y));
          const { arm, counts } = fitDashes(sides);
          const pitches = sides.map((l, i) => pitchOf(l, arm, counts[i]!));
          expect(Math.max(...pitches) / Math.min(...pitches)).toBeLessThan(1.1);
          pitches.forEach((p) => expect(Math.abs(p - 5)).toBeLessThan(0.75));
        });
    }

  it("is the same on the left of a circle as on the right", () => {
    const d = dashedOutline({ kind: "circle", r: 8 }, { x: 0, y: 0 }, 2.6);
    const starts = [...d.matchAll(/M(\S+) (\S+)A/g)].map((m) => [+m[1]!, +m[2]!] as [number, number]);
    const ends = [...d.matchAll(/1 (-?[\d.]+) (-?[\d.]+)(?=M|$)/g)].map((m) => [+m[1]!, +m[2]!] as [number, number]);
    expect(ends).toHaveLength(starts.length);
    for (const [x, y] of starts) expect(ends.some((e) => dist(e, [-x, y]) < 0.01)).toBe(true);
  });
});
