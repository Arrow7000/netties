import type { Net } from "../core/net";
import type { System } from "../core/system";
import { G, type Placed, type Placement, type Pt, shape } from "../layout/geometry";
import type { Routed } from "../layout/route";
import { roundedPath } from "./path";

export interface Ink {
  paper: string;
  ink: string;
}

export const STROKE = 1.4;
/** Width of the paper-coloured band under each wire that makes crossings read as bridges. */
export const HALO = 6;

/** Outline of an agent: a triangle with its tip on the principal port, or a circle. */
export function agentOutline(p: Placed, arity: number): { kind: "circle"; r: number } | { kind: "poly"; points: Pt[] } {
  const s = shape(arity);
  if (s.circle) return { kind: "circle", r: s.w / 2 };
  const sign = p.orient === "down" ? 1 : -1;
  return {
    kind: "poly",
    points: [
      { x: p.x - s.w / 2, y: p.y - (sign * s.h) / 2 },
      { x: p.x + s.w / 2, y: p.y - (sign * s.h) / 2 },
      { x: p.x, y: p.y + (sign * s.h) / 2 },
    ],
  };
}

/** Where to put an agent's label: the triangle's centroid. */
export function labelPos(p: Placed, arity: number): Pt {
  const s = shape(arity);
  if (s.circle) return { x: p.x, y: p.y };
  return { x: p.x, y: p.y + ((p.orient === "down" ? -1 : 1) * s.h) / 6 };
}

/** A standalone SVG of a net, for export and for eyeballing layouts. */
export function toSVG(net: Net, sys: System, placement: Placement, routed: Routed, ink: Ink, pad = 24): string {
  const b = routed.bounds;
  for (const f of routed.free.values()) [b.y0, b.y1] = [Math.min(b.y0, f.y - 14), Math.max(b.y1, f.y + 14)];
  const vb = [b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad];
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" width="${vb[2]! * 2}" height="${vb[3]! * 2}">`,
    `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${ink.paper}"/>`,
    `<g fill="none" stroke-linecap="round">`,
  ];
  for (const pts of routed.wires.values()) {
    const d = roundedPath(pts, G.radius);
    out.push(`<path d="${d}" stroke="${ink.paper}" stroke-width="${HALO}" stroke-linecap="butt"/>`);
    out.push(`<path d="${d}" stroke="${ink.ink}" stroke-width="${STROKE}"/>`);
  }
  out.push(`</g>`);
  for (const [id, p] of placement) {
    const a = net.agents.get(id);
    if (!a) continue;
    const t = sys.types.get(a.type);
    const arity = a.wires.length - 1;
    const o = agentOutline(p, arity);
    const fill = t?.filled ? ink.ink : ink.paper;
    const attrs = `fill="${fill}" stroke="${ink.ink}" stroke-width="${STROKE}" stroke-linejoin="round"`;
    if (o.kind === "circle") out.push(`<circle cx="${p.x}" cy="${p.y}" r="${o.r}" ${attrs}/>`);
    else out.push(`<polygon points="${o.points.map((q) => `${q.x},${q.y}`).join(" ")}" ${attrs}/>`);
    if (t?.symbol) {
      const l = labelPos(p, arity);
      out.push(
        `<text x="${l.x}" y="${l.y}" font-family="STIX Two Text, Times New Roman, serif" font-style="italic" font-size="11" text-anchor="middle" dominant-baseline="central" fill="${t.filled ? ink.paper : ink.ink}">${t.symbol}</text>`,
      );
    }
  }
  for (const [name, f] of routed.free) {
    out.push(
      `<text x="${f.x}" y="${f.dir === "up" ? f.y - 4 : f.y + 9}" font-family="STIX Two Text, Times New Roman, serif" font-style="italic" font-size="9" text-anchor="middle" fill="${ink.ink}">${name}</text>`,
    );
  }
  out.push(`</svg>`);
  return out.join("\n");
}
