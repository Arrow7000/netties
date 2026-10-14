/**
 * How well wires are routed: counts wires drawn through agents and wires
 * running alongside each other, over every step of the examples (laid out
 * automatically) and over random nets with agents placed as if by hand.
 *
 *   npx vite-node scripts/route-check.ts [--svg DIR] [--all]
 *
 * --svg writes each drawing with a problem to DIR, problems marked (red:
 * through an agent, orange: too close to another wire); --all writes every
 * example step.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import fc from "fast-check";
import { examples } from "../src/core/examples";
import { type End, Net, free, port } from "../src/core/net";
import { combinators } from "../src/core/presets";
import { parallelStep } from "../src/core/reduce";
import { roundedPath } from "../src/render/path";
import { G, type Placement } from "../src/layout/geometry";
import { autoLayout } from "../src/layout/place";
import { type Routed, route } from "../src/layout/route";
import { outline, wiresThroughAgents, wiresTooClose } from "../src/layout/routeCheck";

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const dir = process.argv.includes("--svg") ? arg("--svg") : undefined;
const all = process.argv.includes("--all");
if (dir) mkdirSync(dir, { recursive: true });

function svgOf(net: Net, placement: Placement, routed: Routed, title: string): string {
  const b = routed.bounds;
  const [x0, y0, w, h] = [b.x0 - 30, b.y0 - 44, b.x1 - b.x0 + 60, b.y1 - b.y0 + 74];
  const through = new Set(wiresThroughAgents(net, placement, routed).map((h) => h.wire));
  const close = new Set(wiresTooClose(routed).flatMap((c) => [c.a, c.b]));
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w * 2}" height="${h * 2}">`];
  out.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="white"/>`);
  out.push(`<text x="${x0 + 4}" y="${y0 + 11}" font-size="9" font-family="sans-serif">${title}</text>`);
  for (const [id, pts] of routed.wires) {
    const colour = through.has(id) ? "#d00" : close.has(id) ? "#e80" : "#222";
    out.push(`<path d="${roundedPath(pts, G.radius)}" fill="none" stroke="${colour}" stroke-width="1.3"/>`);
    const m = pts[Math.floor(pts.length / 2)]!;
    out.push(`<text x="${m.x + 2}" y="${m.y - 2}" font-size="6" fill="${colour}" font-family="sans-serif">${id}</text>`);
  }
  for (const [id, p] of placement) {
    if (!net.agents.has(id)) continue;
    const poly = outline(net, placement, id, 0).map((q) => `${q.x},${q.y}`);
    out.push(`<polygon points="${poly.join(" ")}" fill="rgba(255,255,255,0.75)" stroke="#06c"/>`);
    out.push(`<text x="${p.x}" y="${p.y + 3}" font-size="8" text-anchor="middle" font-family="sans-serif">${net.agent(id).type}${id}</text>`);
  }
  for (const [name, f] of routed.free)
    out.push(`<text x="${f.x}" y="${f.y + (f.dir === "down" ? 9 : -3)}" font-size="7" text-anchor="middle" fill="#080">${name}</text>`);
  out.push("</svg>");
  return out.join("\n");
}

/** Tallies problems in one drawing, and writes it out if asked to. */
function tally(totals: Record<string, number>, net: Net, placement: Placement, routed: Routed, name: string, file: string) {
  const through = wiresThroughAgents(net, placement, routed);
  const close = wiresTooClose(routed);
  totals.drawings!++;
  totals.through! += through.length;
  totals.close! += close.length;
  totals.squeezed! += close.filter((c) => c.gap >= G.wireGap / 2 - 0.01).length;
  if (through.length || close.length) totals.bad!++;
  if (dir && (all || through.length || close.length))
    writeFileSync(`${dir}/${file}.svg`, svgOf(net, placement, routed, `${name}: ${through.length} through, ${close.length} close`));
}

const report = (what: string, t: Record<string, number>) =>
  console.log(
    `${what}: ${t.bad} of ${t.drawings} drawings with problems; ${t.through} wires through agents, ` +
      `${t.close} pairs too close (${t.squeezed} of them squeezed to half a wire gap where there was no room); ` +
      `slowest route ${t.slowest!.toFixed(1)} ms`,
  );

// Every step of every example, laid out the way the app does it.
{
  const totals = { drawings: 0, bad: 0, through: 0, close: 0, squeezed: 0, slowest: 0 };
  examples.forEach((ex, i) => {
    const sys = ex.system();
    const net = ex.net(sys);
    let prev: Placement | undefined;
    for (let step = 0; step < 60; step++) {
      const l = autoLayout(net, { prev });
      prev = l.placement;
      const t0 = performance.now();
      route(net, l.placement, { columns: l.columns });
      totals.slowest = Math.max(totals.slowest, performance.now() - t0);
      tally(totals, net, l.placement, l.routed, `${ex.name}, step ${step}`, `example-${String(i).padStart(2, "0")}-${step}`);
      if (!parallelStep(net, sys).length) break;
    }
  });
  report("examples", totals);
}

// Random nets of up to 12 combinators on a loose grid (cells 90 by 80,
// nudged by up to 20 by 16), each agent pointing either way.
{
  const sys = combinators();
  const totals = { drawings: 0, bad: 0, through: 0, close: 0, squeezed: 0, slowest: 0 };
  const seeds = fc.sample(fc.array(fc.nat(1e9), { minLength: 200, maxLength: 200 }), { numRuns: 300, seed: 7 });
  seeds.forEach((r, n) => {
    let k = 0;
    const next = (m: number) => r[k++ % r.length]! % m;
    const net = new Net();
    const ends: End[] = [];
    const count = 2 + next(10);
    for (let i = 0; i < count; i++) {
      const t = sys.type(["γ", "δ", "ε"][next(3)]!);
      const id = net.addAgent(t);
      for (let s = 0; s <= t.arity; s++) ends.push(port(id, s));
    }
    for (let i = 0; i < next(3) || ends.length % 2; i++) ends.push(free(`f${i}`));
    for (let i = ends.length - 1; i > 0; i--) {
      const j = next(i + 1);
      [ends[i], ends[j]] = [ends[j]!, ends[i]!];
    }
    for (let i = 0; i < ends.length; i += 2) net.connect(ends[i]!, ends[i + 1]!);
    const placement: Placement = new Map();
    const cells = new Set<number>();
    for (const id of net.agents.keys()) {
      let c = next(16);
      while (cells.has(c)) c = (c + 1) % 16;
      cells.add(c);
      placement.set(id, { x: (c % 4) * 90 + next(20), y: Math.floor(c / 4) * 80 + next(16), orient: next(2) ? "up" : "down" });
    }
    const t0 = performance.now();
    const routed = route(net, placement);
    totals.slowest = Math.max(totals.slowest, performance.now() - t0);
    tally(totals, net, placement, routed, `hand-placed #${n}`, `hand-${n}`);
  });
  report("placed by hand", totals);
}
