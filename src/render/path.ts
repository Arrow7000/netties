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

type Seg = { kind: "L"; to: Pt } | { kind: "C"; c1: Pt; c2: Pt; to: Pt };

/**
 * The drawn shape of a route: a polyline with its corners rounded. Each
 * corner may use up to half of each neighbouring segment, so a short jog
 * between two vertical runs becomes a smooth S-bend. Segments marked `s` are
 * S-curves leaving and arriving vertically; corners next to them stay sharp,
 * since the curve already meets its neighbours smoothly.
 */
function segments(points: Pt[], radius: number): { start: Pt; segs: Seg[] } | undefined {
  const pts = simplify(points);
  if (pts.length === 0) return undefined;
  const segs: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const p = pts[i]!;
    if (p.s) {
      const my = (a.y + p.y) / 2;
      segs.push({ kind: "C", c1: { x: a.x, y: my }, c2: { x: p.x, y: my }, to: p });
      continue;
    }
    const b = pts[i + 1];
    if (!b || b.s) {
      segs.push({ kind: "L", to: p });
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
    segs.push({ kind: "L", to: s });
    segs.push({
      kind: "C",
      c1: { x: s.x + din.x * r * KAPPA, y: s.y + din.y * r * KAPPA },
      c2: { x: e.x - dout.x * r * KAPPA, y: e.y - dout.y * r * KAPPA },
      to: e,
    });
  }
  return { start: pts[0]!, segs };
}

/** SVG path data for a route. */
export function roundedPath(points: Pt[], radius: number): string {
  const g = segments(points, radius);
  if (!g) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(g.start.x)} ${f(g.start.y)}`;
  for (const s of g.segs) {
    if (s.kind === "L") d += ` L${f(s.to.x)} ${f(s.to.y)}`;
    else d += ` C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.to.x)} ${f(s.to.y)}`;
  }
  return d;
}

/** How far a flattened curve may stray from the curve itself: too little to see, even zoomed in. */
const FLAT = 0.02;

/** How many straight pieces a curve needs to pass for one (Wang's formula): more for a long, strong curve than for a small corner. */
function pieces(a: Pt, c1: Pt, c2: Pt, b: Pt): number {
  const bend = Math.max(Math.hypot(a.x - 2 * c1.x + c2.x, a.y - 2 * c1.y + c2.y), Math.hypot(c1.x - 2 * c2.x + b.x, c1.y - 2 * c2.y + b.y));
  return Math.max(1, Math.ceil(Math.sqrt((0.75 * bend) / FLAT)));
}

/** The drawn shape of a route as a dense polyline, for animation, previews and measuring. */
export function flattenPath(points: Pt[], radius: number): Pt[] {
  const g = segments(points, radius);
  if (!g) return [];
  const out: Pt[] = [g.start];
  let cur = g.start;
  for (const s of g.segs) {
    if (s.kind === "L") out.push(s.to);
    else {
      const n = pieces(cur, s.c1, s.c2, s.to);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        out.push({
          x: u * u * u * cur.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x,
          y: u * u * u * cur.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y,
        });
      }
    }
    cur = s.to;
  }
  return out;
}

/** How far along a polyline each of its points is. */
function distances(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return cum;
}

/** `n` points evenly spaced along a polyline. */
export function resample(pts: Pt[], n: number): Pt[] {
  return resampleAt(pts, Array.from({ length: n }, (_, i) => i / (n - 1)));
}

/** The points at some fractions, in order, of a polyline's length. */
export function resampleAt(pts: Pt[], fractions: number[]): Pt[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return fractions.map(() => ({ ...pts[0]! }));
  const cum = distances(pts);
  const total = cum[cum.length - 1]!;
  const out: Pt[] = [];
  let j = 1;
  for (const u of fractions) {
    const d = total * u;
    while (j < pts.length - 1 && cum[j]! < d) j++;
    const seg = cum[j]! - cum[j - 1]! || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j - 1]!) / seg));
    const a = pts[j - 1]!;
    const b = pts[j]!;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Fractions of their lengths at which to sample polylines so that each keeps
 * its shape: at every one of their points, and evenly between, at `n` places at least.
 */
export function sampling(shapes: Pt[][], n: number): number[] {
  const all = Array.from({ length: n }, (_, i) => i / (n - 1));
  for (const pts of shapes) {
    const cum = distances(pts);
    const total = cum[cum.length - 1];
    if (total) for (const c of cum) all.push(c / total);
  }
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const u of all) if (!out.length || u - out[out.length - 1]! > 1e-6) out.push(u);
  return out;
}

/** SVG path data for a plain polyline. */
export function polylinePath(pts: Pt[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  return pts.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join(" ");
}

/** The point halfway along a polyline, the direction it runs there, and its length. */
export function midway(pts: Pt[]): { at: Pt; dx: number; dy: number; len: number } | undefined {
  if (pts.length < 2) return undefined;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= left && len > 0) {
      const t = left / len;
      return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len, len: total };
    }
    left -= len;
  }
  return undefined;
}
