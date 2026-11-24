import type { Pt } from "../layout/geometry";
import type { agentOutline } from "./svg";

/** A dash and the gap after it, and how much of that is dash. */
const PITCH = 5;
const DASH = 0.6;
/** How far the dash round each corner runs along the sides it joins. */
const ARM = 2.4;

/**
 * Dashes round a polygon: one wrapping each corner, with arms the same length
 * everywhere, and between them a whole number of equal dashes along each side.
 * The arms give a little, so dashes come out as alike as they can on
 * sides of different lengths.
 */
export function fitDashes(sides: number[]): { arm: number; counts: number[] } {
  let best: { arm: number; counts: number[] } | undefined;
  let least = Infinity;
  for (let k = -16; k <= 16; k++) {
    const arm = ARM + k * 0.05;
    const counts = sides.map((l) => Math.max(0, Math.round((l - 2 * arm) / PITCH - (1 - DASH))));
    const pitches = sides.map((l, i) => pitchOf(l, arm, counts[i]!));
    const spread = Math.max(...pitches) - Math.min(...pitches);
    const off = Math.max(...pitches.map((p) => Math.abs(p - PITCH)));
    const cost = spread + 0.3 * off + 0.1 * Math.abs(arm - ARM);
    if (cost < least) [best, least] = [{ arm, counts }, cost];
  }
  return best!;
}

/** A side between its corners' arms is a gap, then `n` dashes each with a gap after it. */
export const pitchOf = (side: number, arm: number, n: number) => (side - 2 * arm) / (n + 1 - DASH);

/** SVG path data for an agent's outline in dashes, with a circle's round `at`. `grow` is how far outside the outline the dashes show. */
export function dashedOutline(o: ReturnType<typeof agentOutline>, at: Pt, grow: number): string {
  const f = (n: number) => Math.round(n * 1000) / 1000;
  const xy = (p: Pt) => `${f(p.x)} ${f(p.y)}`;
  if (o.kind === "circle") {
    // An even number, with one centred at the top: the same on the left as on the right, and above as below.
    const n = 2 * Math.round((Math.PI * (o.r + grow)) / PITCH);
    const turn = (2 * Math.PI) / n;
    const on = (a: number) => xy({ x: at.x + o.r * Math.sin(a), y: at.y - o.r * Math.cos(a) });
    return Array.from({ length: n }, (_, i) => `M${on((i - DASH / 2) * turn)}A${o.r} ${o.r} 0 0 1 ${on((i + DASH / 2) * turn)}`).join("");
  }
  const pts = o.points;
  const n = pts.length;
  const sides = pts.map((a, i) => ({ a, b: pts[(i + 1) % n]!, len: Math.hypot(pts[(i + 1) % n]!.x - a.x, pts[(i + 1) % n]!.y - a.y) }));
  const along = (i: number, s: number): Pt => {
    const { a, b, len } = sides[i]!;
    return { x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len };
  };
  const { arm, counts } = fitDashes(sides.map((s) => s.len));
  let d = "";
  sides.forEach(({ a, len }, i) => {
    const before = (i + n - 1) % n;
    d += `M${xy(along(before, sides[before]!.len - arm))}L${xy(a)}L${xy(along(i, arm))}`;
    const pitch = pitchOf(len, arm, counts[i]!);
    for (let k = 0; k < counts[i]!; k++) {
      const s = arm + pitch * (k + 1 - DASH);
      d += `M${xy(along(i, s))}L${xy(along(i, s + pitch * DASH))}`;
    }
  });
  return d;
}

/** The length to count a dashed circle as, so that a whole number of dashes (each `pitch` with its gap) goes round it. */
export const dashRound = (r: number, pitch: number) => pitch * Math.round((2 * Math.PI * r) / pitch);
