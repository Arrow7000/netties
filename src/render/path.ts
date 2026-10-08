import type { Pt } from "../layout/geometry";

const KAPPA = 0.5523;

/** Drop repeated points and points in the middle of a straight run. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out[out.length - 2];
    if (prev && last && !last.s && !p.s) {
      const cross = (last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x);
      const dot = (last.x - prev.x) * (p.x - last.x) + (last.y - prev.y) * (p.y - last.y);
      if (Math.abs(cross) < 0.01 && dot > 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

/**
 * SVG path data for a polyline with its corners rounded. Each corner may use
 * up to half of each neighbouring segment, so a short jog between two
 * vertical runs becomes a smooth S-bend. Segments marked `s` are drawn as
 * S-curves leaving and arriving vertically; corners next to them stay sharp,
 * since the curve already meets its neighbours smoothly.
 */
export function roundedPath(points: Pt[], radius: number): string {
  const pts = simplify(points);
  if (pts.length === 0) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const p = pts[i]!;
    if (p.s) {
      const my = (a.y + p.y) / 2;
      d += ` C${f(a.x)} ${f(my)} ${f(p.x)} ${f(my)} ${f(p.x)} ${f(p.y)}`;
      continue;
    }
    const b = pts[i + 1];
    if (!b || b.s) {
      d += ` L${f(p.x)} ${f(p.y)}`;
      continue;
    }
    const lin = Math.hypot(p.x - a.x, p.y - a.y);
    const lout = Math.hypot(b.x - p.x, b.y - p.y);
    const din = { x: (p.x - a.x) / lin, y: (p.y - a.y) / lin };
    const dout = { x: (b.x - p.x) / lout, y: (b.y - p.y) / lout };
    // A corner straight after an S-curve may use the whole straight run.
    const r = Math.min(radius, a.s ? lin : lin / 2, lout / 2);
    const s = { x: p.x - din.x * r, y: p.y - din.y * r };
    const e = { x: p.x + dout.x * r, y: p.y + dout.y * r };
    d += ` L${f(s.x)} ${f(s.y)}`;
    d += ` C${f(s.x + din.x * r * KAPPA)} ${f(s.y + din.y * r * KAPPA)} ${f(e.x - dout.x * r * KAPPA)} ${f(e.y - dout.y * r * KAPPA)} ${f(e.x)} ${f(e.y)}`;
  }
  return d;
}
