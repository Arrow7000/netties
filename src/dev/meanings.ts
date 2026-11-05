/**
 * A prototype for showing what a net means: open /meanings.html on the dev
 * server. Everything on it is real: the examples, reduction, layout and routing
 * are the app's, and the readings come from `reading.ts`. Only the look of it is
 * up for discussion. The state is in the address, so a view can be pointed at:
 * #e=Sort a list&v=folded&s=3&r=hand
 */
import { examples } from "../core/examples";
import { type AgentId, type End, type Net, type WireId, free } from "../core/net";
import { parallelStep } from "../core/reduce";
import type { System } from "../core/system";
import { endSpec } from "../core/types";
import { G, type Placement, type Pt, portPos, shape } from "../layout/geometry";
import { autoLayout, columnOffsets, columnsAt } from "../layout/place";
import { type Routed, route } from "../layout/route";
import { flattenPath, midway, roundedPath } from "../render/path";
import { HALO, STROKE, agentOutline, arrowPoints, labelPos } from "../render/svg";
import { type Reading, type Region, type Show, UNREAD, carries, checkReading, fold, formula, guess, parseShows, printShows, readingFor, regions, runAhead, wireSides } from "./reading";

type View = "plain" | "labels" | "folded";
type Source = "guess" | "hand" | "model";

/** Readings written by hand for the examples where a guess only gets so far. */
const BY_HAND: Record<string, string> = {
  "Length of a list": `show # "length of {0}" on 1`,
  "Two lengths, one list": `show # "length of {0}" on 1`,
  "Add two list lengths": `show # "length of {0}" on 1`,
  "Complete a typed if": `show # "length of {0}" on 1
show Z? "{0} is zero" on 1
show if "if {0} then {2} else {3}" on 1`,
  "Fibonacci: 6 → 8": `show Fib "F({0})" on 1
show Fib "F({0} + 1)" on 2`,
  "Sort a list": `show Sort "sort {0}" on 1
show Ins "insert {2} into {0}" on 1
show ↕ "min({0}, {3})" on 1
show ↕ "max({0}, {3})" on 2
show ↕S "min({3} + 1, {0})" on 1
show ↕S "max({3} + 1, {0})" on 2`,
  "range(5)": `show From "the numbers from {1}"
show Take "first {0} of {2}" on 1
show Pull "first {2} + 1 of {0}" on 1`,
  "Find the primes up to 7": `show T "yes"
show F "no"
show Sieve "primes in {0}" on 1
show Filter "{0} without multiples of {2}" on 1
show Keep "keep {2} unless {0}, then {3} without multiples of {4}" on 1
show Mod "{2} divides {0} (counting {3})" on 1
show Count "{2} divides {3} (counting {0})" on 1
show Z? "{0} is 0" on 1`,
  "Map a function: x² + 1": `show Sq "square"
show Plus "add {1}"
show Then "{1}, then {2}"
show Apply "{0} of {2}" on 1
show Map "{2} to each of {0}" on 1`,
  "Differentiate a formula, then run it": `show X "x"
show K "{1}"
show Add "{1} + {2}"
show Mul "{1} × {2}"
show D "d/dx ({0})" on 1
show Eval "{0} at x = {2}" on 1`,
};

/** What the chat's model wrote in `scripts/reading-eval.ts`: the first run of each example that passed. */
const modelFile = import.meta.glob("/design/research/readings/model-readings.json", { eager: true, import: "default" }) as Record<string, { model: string; results: { name: string; anonymous: boolean; passed: boolean; tries: { lines: string }[] }[] }>;
const modelData = Object.values(modelFile)[0];
const BY_MODEL = new Map<string, string>();
for (const res of modelData?.results ?? []) {
  if (!res.anonymous && res.passed && !BY_MODEL.has(res.name)) BY_MODEL.set(res.name, res.tries.at(-1)!.lines);
}

// ---------------------------------------------------------------------------
// One example, run to the end once.

interface Frame {
  net: Net;
  /** How many interactions have fired before this frame. */
  done: number;
}

interface Run {
  sys: System;
  frames: Frame[];
  finished: boolean;
}

const MAX_FRAMES = 300;

function runOf(name: string): Run {
  const ex = examples.find((e) => e.name === name) ?? examples[0]!;
  const sys = ex.system();
  const net = ex.net(sys);
  const frames: Frame[] = [{ net: net.clone(), done: 0 }];
  let done = 0;
  let finished = false;
  while (frames.length < MAX_FRAMES) {
    const fired = parallelStep(net, sys);
    if (!fired.length) {
      finished = true;
      break;
    }
    done += fired.length;
    frames.push({ net: net.clone(), done });
  }
  return { sys, frames, finished };
}

// ---------------------------------------------------------------------------
// Laying out a frame, in plain or folded form.

const measure = (() => {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return (text: string, font = "500 11px Geist, system-ui, sans-serif") => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
})();

const VALUE_FONT = "500 11px Geist, system-ui, sans-serif";
const CUT = 34;
const clip = (s: string) => (s.length > CUT ? `${s.slice(0, CUT - 1)}…` : s);

/** How wide a folded piece of data needs to be for its text. */
function foldedWidth(g: Region): number {
  const text = clip(g.label);
  return g.holes.length ? Math.max(shape(g.holes.length).w, measure(text, VALUE_FONT) + 16) : Math.max(G.circleR * 2, measure(text, VALUE_FONT) + 12);
}

interface Laid {
  net: Net;
  sys: System;
  placement: Placement;
  routed: Routed;
  /** The folded regions, by the id of the agent that stands for them. */
  folded: Map<AgentId, Region>;
}

/**
 * Layout knows every agent's width from its number of aux ports, so wide folded
 * data is made room for afterwards by pushing things apart along their row. The
 * real thing would teach `shape` about widths, which is the main cost of folding.
 */
function makeRoom(net: Net, placement: Placement, folded: Map<AgentId, Region>): Placement {
  const widths = new Map<AgentId, number>();
  for (const id of placement.keys()) {
    const g = folded.get(id);
    widths.set(id, g ? foldedWidth(g) : shape(net.agent(id).wires.length - 1).w);
  }
  const height = (id: AgentId) => (folded.get(id)?.holes.length === 0 ? G.circleR * 2 : shape(net.agent(id).wires.length - 1).h);
  const out: Placement = new Map(placement);
  // Left to right, each agent clears whatever it would touch among those already placed.
  const ids = [...placement.keys()].sort((a, b) => placement.get(a)!.x - placement.get(b)!.x);
  ids.forEach((id, i) => {
    const p = out.get(id)!;
    const w = widths.get(id)!;
    let x = p.x;
    for (const other of ids.slice(0, i)) {
      if (!folded.has(id) && !folded.has(other)) continue;
      const q = out.get(other)!;
      const apart = Math.abs(p.y - q.y) - (height(id) + height(other)) / 2;
      if (apart < 6) x = Math.max(x, q.x + widths.get(other)! / 2 + 8 + w / 2);
    }
    out.set(id, { ...p, x });
  });
  return out;
}

function layFrames(run: Run, r: Reading, foldIt: boolean): Laid[] {
  let prev: Placement | undefined;
  return run.frames.map((frame) => {
    const f = foldIt ? fold(frame.net, run.sys, r) : undefined;
    const net = f?.net ?? frame.net;
    const sys = f?.sys ?? run.sys;
    const folded = f?.folded ?? new Map<AgentId, Region>();
    const l = autoLayout(net, { prev });
    prev = l.placement;
    const placement = foldIt ? makeRoom(net, l.placement, folded) : l.placement;
    return { net, sys, placement, folded, routed: route(net, placement, { columns: columnsAt(columnOffsets(net), placement) }) };
  });
}

// ---------------------------------------------------------------------------
// Drawing.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function convexHull(pts: Pt[]): Pt[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length < 3) return s;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(s), ...half(s.reverse())];
}

interface Drawing {
  svg: string;
}

function draw(laid: Laid, source: Net, r: Reading, view: View, ahead: Map<string, string>, active: Set<WireId>): Drawing {
  const { net, sys, placement, routed, folded } = laid;
  let [x0, y0, x1, y1] = [routed.bounds.x0, routed.bounds.y0, routed.bounds.x1, routed.bounds.y1];
  const grow = (a: number, b: number, c: number, d: number) => {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  };
  const under: string[] = [];
  const wires: string[] = [];
  const hits: string[] = [];
  const agents: string[] = [];
  const heads: string[] = [];
  const over: string[] = [];

  const head = (at: Pt, dx: number, dy: number, scale = 1) =>
    heads.push(`<polygon points="${arrowPoints(at, dx, dy, scale)}" fill="var(--ink)" stroke="var(--paper)" stroke-width="1.1" stroke-linejoin="round" paint-order="stroke"/>`);
  const endAt = (e: End): Pt | undefined => {
    if (e.kind === "free") return routed.free.get(e.name);
    const p = placement.get(e.agent);
    return p ? portPos(p, net.agent(e.agent).wires.length - 1, e.slot) : undefined;
  };

  for (const [id, pts] of routed.wires) {
    const d = roundedPath(pts, G.radius);
    const glow = active.has(id) ? `<path d="${d}" stroke="var(--active)" stroke-opacity="var(--active-op)" stroke-width="7" stroke-linecap="round" fill="none"/>` : "";
    wires.push(`<path d="${d}" stroke="var(--paper)" stroke-width="${HALO}" stroke-linecap="butt" fill="none"/>${glow}<path d="${d}" class="ink-wire" data-w="${id}" stroke="var(--ink)" stroke-width="${STROKE}" stroke-linecap="round" fill="none"/>`);
    hits.push(`<path d="${d}" class="hit" data-wire="${id}" stroke="transparent" stroke-width="14" fill="none"/>`);
    const w = net.wires.get(id);
    if (!w) continue;
    const [sa, sb] = w.ends.map((e) => endSpec(net, sys, e));
    const flow = sa!.pol ? (sa!.pol === "give" ? 1 : -1) : sb!.pol ? (sb!.pol === "take" ? 1 : -1) : 0;
    const flat = flattenPath(pts, G.radius);
    const m = midway(flat);
    if (!flow || !m || m.len < 8) continue;
    const start = endAt(w.ends[0]);
    const [p0, q0] = [flat[0]!, flat[flat.length - 1]!];
    const forward = !start || Math.hypot(p0.x - start.x, p0.y - start.y) <= Math.hypot(q0.x - start.x, q0.y - start.y);
    const sgn = forward ? flow : -flow;
    head(m.at, m.dx * sgn, m.dy * sgn);
  }

  for (const [id, p] of placement) {
    const a = net.agents.get(id);
    if (!a) continue;
    const t = sys.types.get(a.type);
    const arity = a.wires.length - 1;
    const g = folded.get(id);
    if (g) {
      const text = clip(g.label);
      const w = foldedWidth(g);
      const h = arity ? G.agentH : G.circleR * 2;
      grow(p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2);
      agents.push(
        `<g class="fold" data-title="${esc(`${g.label}: ${g.agents.length} agents`)}"><rect x="${p.x - w / 2}" y="${p.y - h / 2}" width="${w}" height="${h}" rx="${arity ? 5 : h / 2}" fill="var(--value-fill)" stroke="var(--value)" stroke-width="${STROKE}"/>` +
          `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" class="value-text">${esc(text)}</text></g>`,
      );
    } else {
      const o = agentOutline(p, arity, t?.box);
      const fill = t?.filled ? "var(--ink)" : "var(--paper)";
      const attrs = `fill="${fill}" stroke="var(--ink)" stroke-width="${STROKE}" stroke-linejoin="round"`;
      agents.push(o.kind === "circle" ? `<circle cx="${p.x}" cy="${p.y}" r="${o.r}" ${attrs}/>` : `<polygon points="${o.points.map((q) => `${q.x},${q.y}`).join(" ")}" ${attrs}/>`);
      if (t?.symbol) {
        const l = labelPos(p, arity, t.box);
        agents.push(`<text x="${l.x}" y="${l.y}" font-family="STIX Two Text, Times New Roman, serif" font-style="italic" font-size="11" text-anchor="middle" dominant-baseline="central" fill="${t.filled ? "var(--paper)" : "var(--ink)"}">${esc(t.symbol)}</text>`);
      }
    }
    for (let slot = 0; slot <= arity; slot++) {
      const pol = endSpec(net, sys, { kind: "port", agent: id, slot }).pol;
      if (!pol || a.wires[slot] !== -1) continue;
      const at = portPos(p, arity, slot);
      const dir = at.dir === "down" ? 1 : -1;
      head({ x: at.x, y: at.y + dir * 7.2 }, 0, pol === "give" ? dir : -dir, 0.82);
    }
  }

  // Labels: a soft shape over each piece of data, and what it means beside it.
  if (view === "labels") {
    const boxes = [...placement].map(([id, p]) => {
      const w = shape(net.agent(id).wires.length - 1).w;
      return { x0: p.x - w / 2 - 4, x1: p.x + w / 2 + 4, y0: p.y - 18, y1: p.y + 18, id };
    });
    for (const g of regions(source, r)) {
      const informative = g.agents.length >= 2 || !sys.types.get(net.agent(g.root).type)?.symbol || g.label !== sys.types.get(net.agent(g.root).type)!.symbol;
      if (!informative) continue;
      if (g.agents.length === 1 && g.holes.length) continue;
      const outline: Pt[] = [];
      for (const id of g.agents) {
        const p = placement.get(id);
        if (!p) continue;
        const arity = net.agent(id).wires.length - 1;
        const o = agentOutline(p, arity);
        if (o.kind === "circle") for (let k = 0; k < 10; k++) outline.push({ x: p.x + o.r * Math.cos((k * Math.PI) / 5), y: p.y + o.r * Math.sin((k * Math.PI) / 5) });
        else outline.push(...o.points);
      }
      if (!outline.length) continue;
      const hull = convexHull(outline);
      over.push(`<path d="M${hull.map((q) => `${q.x} ${q.y}`).join("L")}Z" class="hull" data-title="${esc(g.label)}"/>`);
      const text = clip(g.label);
      const w = measure(text, VALUE_FONT) + 12;
      const root = placement.get(g.root)!;
      const midY = root.y;
      const rootW = shape(net.agent(g.root).wires.length - 1).w;
      // Beside the root if there's room, since that's where the data is used; or else beside the whole shape.
      const clear = (a: number, b: number) => !boxes.some((o) => o.id !== g.root && o.x1 > a && o.x0 < b && o.y1 > midY - 9 && o.y0 < midY + 9);
      const [hx0, hx1] = [Math.min(...hull.map((q) => q.x)), Math.max(...hull.map((q) => q.x))];
      const near = root.x + rootW / 2 + 13;
      const nearLeft = root.x - rootW / 2 - 13 - w;
      const lx = clear(near, near + w) ? near : clear(nearLeft, nearLeft + w) ? nearLeft : clear(hx1 + 9, hx1 + 9 + w) ? hx1 + 9 : hx0 - 9 - w;
      grow(lx, midY - 9, lx + w, midY + 9);
      over.push(`<g class="pill"><rect x="${lx}" y="${midY - 8.5}" width="${w}" height="17" rx="8.5"/><text x="${lx + w / 2}" y="${midY}" text-anchor="middle" dominant-baseline="central">${esc(text)}</text></g>`);
    }
  }

  for (const [name, f] of routed.free) {
    const ty = f.dir === "up" ? f.y - 4 : f.y + 9;
    const coming = view !== "plain" ? ahead.get(name) : undefined;
    grow(f.x - 40, ty - 12, f.x + 40, ty + 12);
    over.push(`<text x="${f.x}" y="${ty}" font-family="STIX Two Text, Times New Roman, serif" font-style="italic" font-size="9" text-anchor="middle" fill="var(--ink)">${esc(name)}</text>`);
    if (coming && coming !== UNREAD && !coming.startsWith("wired") && coming !== "nothing") {
      const text = `→ ${clip(coming)}`;
      const w = measure(text, VALUE_FONT);
      grow(f.x + 8, ty - 8, f.x + 12 + w, ty + 8);
      over.push(`<text x="${f.x + 8}" y="${ty - 1}" class="coming" dominant-baseline="central">${esc(text)}</text>`);
    }
  }

  const pad = 26;
  const vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" data-w="${vb[2]}" data-h="${vb[3]}">${under.join("")}<g>${wires.join("")}</g>${agents.join("")}${heads.join("")}<g class="hits">${hits.join("")}</g>${over.join("")}</svg>`,
  };
}

// ---------------------------------------------------------------------------
// The page.

const css = `
:root { color-scheme: light dark; --paper:#fff; --ink:#000; --chrome:#fff; --line:#e2e4e8; --text:#1c1f24; --muted:#697080; --faint:#9aa0ab; --accent:#2d5bff; --accent-soft:#e8eeff; --active:#f2a20c; --active-op:.55; --stuck:#d9472b; --dot:rgba(0,0,0,.1); --shadow:0 1px 2px rgba(16,20,28,.06),0 8px 24px rgba(16,20,28,.08);
  --value:#2d5bff; --value-fill:#eef2ff; --hull-op:.11; --pill:#2d5bff; --on-pill:#fff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#000; --ink:#fff; --chrome:#17181b; --line:#2c2f35; --text:#eceef1; --muted:#9aa1ad; --faint:#6b717c; --accent:#7090ff; --accent-soft:#1d2645; --active:#ffb321; --active-op:.85; --stuck:#ff6a4d; --dot:rgba(255,255,255,.13); --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 30px rgba(0,0,0,.45);
  --value:#7090ff; --value-fill:#141c38; --hull-op:.22; --pill:#7090ff; --on-pill:#000; } }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--paper); color: var(--text); font: 13px/1.4 Geist, system-ui, sans-serif; }
#app { display: grid; grid-template-columns: minmax(0, 1fr) 360px; height: 100dvh; }
.stage { position: relative; min-width: 0; overflow: hidden; background-image: radial-gradient(var(--dot) 1px, transparent 1px); background-size: 20px 20px; }
.canvas { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 64px 16px 72px; }
.canvas svg { display: block; max-width: 100%; max-height: 100%; overflow: visible; }
.island { position: absolute; display: flex; align-items: center; gap: 6px; background: var(--chrome); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 5px; z-index: 2; }
.top { top: 12px; left: 12px; right: 12px; background: none; border: 0; box-shadow: none; padding: 0; justify-content: space-between; flex-wrap: wrap; pointer-events: none; }
.top > * { pointer-events: auto; }
.bottom { bottom: 12px; left: 50%; transform: translateX(-50%); }
.seg { display: flex; gap: 2px; background: var(--chrome); border: 1px solid var(--line); border-radius: 10px; padding: 3px; box-shadow: var(--shadow); }
.seg.flat { box-shadow: none; }
.seg button, .btn { font: inherit; color: var(--muted); background: none; border: 0; border-radius: 7px; padding: 5px 11px; cursor: pointer; min-height: 30px; white-space: nowrap; }
.seg button[aria-pressed="true"] { color: var(--text); background: var(--line); font-weight: 500; }
.seg button:disabled { color: var(--faint); opacity: .55; cursor: default; }
.btn:hover:not(:disabled) { background: var(--line); color: var(--text); }
.btn:disabled { opacity: .35; cursor: default; }
.btn.icon { min-width: 34px; padding: 5px 8px; font-size: 14px; color: var(--text); }
.count { color: var(--muted); padding: 0 8px; min-width: 96px; text-align: center; font-variant-numeric: tabular-nums; }
select { font: inherit; color: var(--text); background: var(--chrome); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; box-shadow: var(--shadow); max-width: 260px; min-height: 38px; }
aside { border-left: 1px solid var(--line); background: var(--chrome); overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 18px; }
.end { display: flex; flex-direction: column; gap: 5px; }
.end .name { font: italic 13px "STIX Two Text", serif; color: var(--muted); }
.now { font: 18px/1.3 "STIX Two Text", Georgia, serif; overflow-wrap: anywhere; }
.now.long { font-size: 14.5px; }
.ends-as { color: var(--muted); }
.ends-as b { color: var(--value); font-weight: 600; font-variant-numeric: tabular-nums; }
.bar { height: 3px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: 3px; }
.bar i { display: block; height: 100%; background: var(--value); }
h3 { margin: 0 0 6px; font-size: 11px; font-weight: 500; letter-spacing: .02em; color: var(--muted); }
ol.trail { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; max-height: 34dvh; overflow-y: auto; }
ol.trail button { display: block; width: 100%; text-align: left; font: 13px/1.35 "STIX Two Text", Georgia, serif; color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 3px 7px; cursor: pointer; overflow-wrap: anywhere; }
ol.trail button:hover { background: var(--line); color: var(--text); }
ol.trail button.here { background: var(--accent-soft); color: var(--text); }
.none { color: var(--muted); }
.mini { border: 1px solid var(--line); border-radius: 8px; padding: 6px; display: flex; justify-content: center; background: var(--paper); }
.mini svg { max-width: 100%; max-height: 160px; }
textarea { width: 100%; font: 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; color: var(--text); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 8px; resize: vertical; min-height: 110px; white-space: pre; overflow-x: auto; }
.verdict { font-size: 12px; color: var(--muted); margin-top: 6px; }
.verdict.bad { color: var(--stuck); }
.src { margin-bottom: 8px; display: inline-flex; }
.tip { position: fixed; z-index: 5; pointer-events: none; background: var(--text); color: var(--paper); border-radius: 8px; padding: 5px 9px; font-size: 12px; max-width: 320px; display: none; }
.tip .f { font-family: "STIX Two Text", Georgia, serif; font-size: 13px; opacity: .8; }
.tip b { font-weight: 600; }
.value-text { font: 500 11px Geist, system-ui, sans-serif; fill: var(--text); font-variant-numeric: tabular-nums; }
.hull { fill: var(--value); stroke: var(--value); stroke-width: 15; stroke-linejoin: round; opacity: var(--hull-op); pointer-events: none; }
.pill rect { fill: var(--pill); }
.pill text { font: 500 11px Geist, system-ui, sans-serif; fill: var(--on-pill); font-variant-numeric: tabular-nums; }
.coming { font: 500 11px Geist, system-ui, sans-serif; fill: var(--value); font-variant-numeric: tabular-nums; }
.hits .hit { cursor: help; }
.ink-wire.lit { stroke: var(--value); stroke-width: 2.2; }
@media (max-width: 760px) {
  #app { grid-template-columns: 1fr; grid-template-rows: minmax(0, 58dvh) minmax(0, 1fr); }
  aside { border-left: 0; border-top: 1px solid var(--line); }
  .canvas { padding: 92px 8px 62px; }
  select { max-width: 100%; }
  .seg button, .btn { min-height: 40px; }
  .btn.icon { min-width: 44px; }
  .count { min-width: 74px; padding: 0 2px; font-size: 12px; }
  ol.trail { max-height: none; }
}
`;

document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
const app = document.createElement("div");
app.id = "app";
document.body.append(app);
app.innerHTML = `
  <div class="stage">
    <div class="canvas"></div>
    <div class="island top">
      <select aria-label="Example"></select>
      <div class="seg" data-group="view">
        <button data-view="plain">Plain</button>
        <button data-view="labels">Labels</button>
        <button data-view="folded">Folded</button>
      </div>
    </div>
    <div class="island bottom">
      <button class="btn icon" data-go="start" aria-label="Back to the start">⏮</button>
      <button class="btn icon" data-go="back" aria-label="Step back">‹</button>
      <span class="count"></span>
      <button class="btn icon" data-go="next" aria-label="Step">›</button>
      <button class="btn icon" data-go="end" aria-label="To the end">⏭</button>
    </div>
  </div>
  <aside></aside>
  <div class="tip"></div>`;

const $ = <T extends Element>(sel: string) => app.querySelector<T>(sel)!;
const canvas = $<HTMLElement>(".canvas");
const aside = $<HTMLElement>("aside");
const tip = $<HTMLElement>(".tip");
const select = $<HTMLSelectElement>("select");
select.innerHTML = examples.map((e) => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join("");

// ---------------------------------------------------------------------------
// State, which lives in the address.

const params = new URLSearchParams(location.hash.slice(1));
const state = {
  example: examples.some((e) => e.name === params.get("e")) ? params.get("e")! : "3 × 2",
  view: (["plain", "labels", "folded"].includes(params.get("v") ?? "") ? params.get("v") : "labels") as View,
  step: Number(params.get("s")) || 0,
  source: (["guess", "hand", "model"].includes(params.get("r") ?? "") ? params.get("r") : "hand") as Source,
  /** Lines being edited in the panel, if any. */
  edited: undefined as string | undefined,
};

function saveState() {
  const p = new URLSearchParams({ e: state.example, v: state.view, s: String(state.step), r: state.source });
  history.replaceState(null, "", `#${p}`);
}

let run = runOf(state.example);
let cache: { key: string; reading: Reading; shows: Show[]; problems: string[]; linesText: string; plain: Laid[]; folded?: Laid[]; ahead: ReturnType<typeof runAhead>; faults: string[] } | undefined;

function sourceLines(): string {
  if (state.edited !== undefined) return state.edited;
  if (state.source === "hand" && BY_HAND[state.example]) return BY_HAND[state.example]!;
  if (state.source === "model" && BY_MODEL.has(state.example)) return BY_MODEL.get(state.example)!;
  return "";
}

function current() {
  const lines = sourceLines();
  const key = `${state.example}\n${lines}`;
  if (cache?.key === key) return cache;
  const { shows, problems } = parseShows(lines, run.sys);
  const reading = readingFor(run.sys, shows);
  const ahead = runAhead(run.frames[0]!.net, run.sys, reading);
  cache = {
    key,
    reading,
    shows,
    linesText: lines,
    problems: problems.map((p) => p.message),
    plain: layFrames(run, reading, false),
    ahead,
    faults: checkReading(run.frames[0]!.net, run.sys, reading).map((f) => `At step ${f.step}, ${f.end} reads as ${f.said}, which comes to ${f.value}, but the net ends with ${f.ends}.`),
  };
  return cache;
}

function laidFor(c: NonNullable<typeof cache>): Laid {
  if (state.view !== "folded") return c.plain[state.step]!;
  c.folded ??= layFrames(run, c.reading, true);
  return c.folded[state.step]!;
}

// ---------------------------------------------------------------------------
// Rendering.

const SCALE = 1.7;

function endsFromAhead(a: ReturnType<typeof runAhead>): Map<string, string> {
  return a.kind === "running" ? new Map() : a.ends;
}

function render() {
  state.step = Math.max(0, Math.min(run.frames.length - 1, state.step));
  saveState();
  const c = current();
  const frame = run.frames[state.step]!;
  const laid = laidFor(c);
  const active = new Set(frame.net.activePairs());
  const d = draw(laid, frame.net, c.reading, state.view, endsFromAhead(c.ahead), active);
  canvas.innerHTML = d.svg;
  const svg = canvas.querySelector("svg")!;
  svg.setAttribute("width", String(Number(svg.dataset.w) * SCALE));
  svg.setAttribute("height", String(Number(svg.dataset.h) * SCALE));

  select.value = state.example;
  app.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  const last = run.frames.length - 1;
  $<HTMLElement>(".count").textContent = `Step ${state.step} of ${run.finished ? last : `${last}+`}`;
  $<HTMLButtonElement>('[data-go="start"]').disabled = $<HTMLButtonElement>('[data-go="back"]').disabled = state.step === 0;
  $<HTMLButtonElement>('[data-go="end"]').disabled = $<HTMLButtonElement>('[data-go="next"]').disabled = state.step === last;
  renderPanel(c);
}

function trailFor(c: NonNullable<typeof cache>, name: string): { text: string; step: number }[] {
  const out: { text: string; step: number }[] = [];
  run.frames.forEach((f, step) => {
    const text = formula(f.net, c.reading, free(name));
    if (out.at(-1)?.text !== text) out.push({ text, step });
  });
  return out;
}

/** Whichever line of a trail the current step is on. */
function trailIndex(trail: { step: number }[]): number {
  let i = 0;
  while (i + 1 < trail.length && trail[i + 1]!.step <= state.step) i++;
  return i;
}

function miniDrawing(): string {
  const final = run.frames.at(-1)!;
  if (!final.net.agents.size) return "";
  const c = current();
  const laid = c.plain.at(-1)!;
  return draw(laid, final.net, c.reading, "plain", new Map(), new Set()).svg;
}

function renderPanel(c: NonNullable<typeof cache>) {
  const frame = run.frames[state.step]!;
  const names = [...frame.net.free.keys()];
  const ahead = c.ahead;
  const total = ahead.kind === "running" ? undefined : ahead.interactions;
  const blocks: string[] = [];
  const readable = names.filter((n) => run.frames.some((f) => !/^\??$/.test(formula(f.net, c.reading, free(n))) && formula(f.net, c.reading, free(n)) !== UNREAD));

  for (const name of names) {
    const now = formula(frame.net, c.reading, free(name));
    const end = ahead.kind === "running" ? undefined : ahead.ends.get(name);
    const unread = now === UNREAD;
    const word = end === undefined ? "" : end === UNREAD ? "" : end.startsWith("wired to") ? `Ends ${esc(end)}.` : `Comes to <b>${esc(end)}</b>`;
    if (unread && !word) continue;
    blocks.push(`<div class="end"><span class="name">${esc(name)}</span>
      ${unread ? "" : `<div class="now ${now.length > 40 ? "long" : ""}">${esc(now)}</div>`}
      ${word ? `<div class="ends-as">${word}</div>` : ""}</div>`);
  }
  if (!names.length) blocks.push(`<p class="none">This net has no loose ends, so nothing comes out of it.</p>`);

  // How far along.
  if (ahead.kind === "running") blocks.push(`<div class="ends-as">This net doesn't finish: a copy was still going after ${ahead.after.toLocaleString()} interactions.</div>`);
  else if (total) {
    const done = frame.done;
    blocks.push(`<div><div class="ends-as">${done} of ${total} interactions${ahead.kind === "stuck" ? ", then it gets stuck" : ""}</div><div class="bar"><i style="width:${(100 * done) / total}%"></i></div></div>`);
  } else if (ahead.kind === "stuck") blocks.push(`<div class="ends-as">Stuck: there's no rule for a pair that has met.</div>`);

  // When there's nothing to read, the net's own final form is what there is to say.
  if (!readable.length && run.finished && ahead.kind !== "running") {
    const mini = miniDrawing();
    blocks.push(`<div><h3>${c.shows.length || guess(run.sys).length ? "Nothing here has a reading yet. It ends as" : "These agents don't stand for anything, so there's no reading. It ends as"}</h3>${mini ? `<div class="mini">${mini}</div>` : `<p class="none">Nothing at all: every agent is used up.</p>`}</div>`);
  }

  // The working, line by line.
  for (const name of readable) {
    const trail = trailFor(c, name);
    if (trail.length < 2) continue;
    const here = trailIndex(trail);
    blocks.push(`<div><h3>${names.length > 1 ? `${esc(name)}, line by line` : "Line by line"}</h3><ol class="trail" data-end="${esc(name)}">${trail
      .map((l, i) => `<li><button data-step="${l.step}" class="${i === here ? "here" : ""}">${esc(l.text)}</button></li>`)
      .join("")}</ol></div>`);
  }

  // The reading itself.
  const hasHand = !!BY_HAND[state.example];
  const hasModel = BY_MODEL.has(state.example);
  const edited = state.edited !== undefined;
  const allLines = c.linesText.trim() ? c.linesText : printShows(guess(run.sys), run.sys);
  const verdict = c.problems.length
    ? `<div class="verdict bad">${c.problems.map(esc).join("<br>")}</div>`
    : c.faults.length
      ? `<div class="verdict bad">${c.faults.map(esc).join("<br>")}</div>`
      : `<div class="verdict">${c.linesText.trim() ? "These lines are on top of what's guessed from the ports." : allLines ? "Guessed from the ports' directions and types. Change anything to try it." : "No lines, and nothing to guess from. Type some to try it."}</div>`;
  blocks.push(`<div><h3>The reading</h3>
    <div class="seg flat src">
      <button data-source="guess" aria-pressed="${!edited && (state.source === "guess" || (!hasHand && state.source === "hand") || (!hasModel && state.source === "model"))}">Guessed</button>
      <button data-source="hand" ${hasHand ? "" : "disabled"} aria-pressed="${!edited && state.source === "hand" && hasHand}">By hand</button>
      <button data-source="model" ${hasModel ? "" : "disabled"} aria-pressed="${!edited && state.source === "model" && hasModel}">By the model</button>
    </div>
    <textarea spellcheck="false" aria-label="The reading's lines">${esc(allLines)}</textarea>${verdict}</div>`);

  const scroll = aside.querySelector("ol.trail")?.scrollTop;
  const focused = document.activeElement?.tagName === "TEXTAREA";
  if (focused) {
    // Leave the text being typed alone; only what it says changes.
    aside.querySelector(".verdict")!.outerHTML = verdict;
    return;
  }
  aside.innerHTML = blocks.join("");
  if (scroll !== undefined) aside.querySelector("ol.trail")!.scrollTop = scroll;
  aside.querySelectorAll<HTMLElement>("ol.trail .here").forEach((el) => {
    const list = el.closest("ol")!;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - 30) list.scrollTop = top - 40;
  });
}

// ---------------------------------------------------------------------------
// What the page does.

function goExample(name: string) {
  state.example = name;
  state.step = 0;
  state.edited = undefined;
  run = runOf(name);
  cache = undefined;
  render();
}

select.addEventListener("change", () => goExample(select.value));
app.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
  if (b.dataset.view) state.view = b.dataset.view as View;
  else if (b.dataset.go === "start") state.step = 0;
  else if (b.dataset.go === "back") state.step--;
  else if (b.dataset.go === "next") state.step++;
  else if (b.dataset.go === "end") state.step = run.frames.length - 1;
  else if (b.dataset.step) state.step = Number(b.dataset.step);
  else if (b.dataset.source) {
    state.source = b.dataset.source as Source;
    state.edited = undefined;
  } else return;
  render();
});
aside.addEventListener("input", (e) => {
  const t = e.target as HTMLTextAreaElement;
  if (t.tagName !== "TEXTAREA") return;
  state.edited = t.value;
  render();
});
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "SELECT") return;
  if (e.key === "ArrowRight") state.step++;
  else if (e.key === "ArrowLeft") state.step--;
  else if (e.key === "1") state.view = "plain";
  else if (e.key === "2") state.view = "labels";
  else if (e.key === "3") state.view = "folded";
  else return;
  render();
});

// Pointing at a wire says what it carries: what it is now, and what it comes to.
const wireCache = new Map<string, string>();
function wireTip(wire: WireId): string | undefined {
  const c = current();
  const k = `${c.key}\n${state.step}:${wire}`;
  if (wireCache.has(k)) return wireCache.get(k);
  const net = run.frames[state.step]!.net;
  if (!net.wires.has(wire)) return undefined;
  const sides = wireSides(net, run.sys, c.reading, wire);
  const carried = carries(net, run.sys, c.reading, wire);
  let html = "";
  if (sides && carried) {
    const now = formula(net, c.reading, sides.taker.kind === "port" || sides.taker.kind === "free" ? sides.taker : free(""));
    html = `Carries <b>${esc(carried)}</b>${now !== carried && now !== UNREAD ? `<div class="f">${esc(now)}</div>` : ""}`;
  }
  wireCache.set(k, html);
  return html;
}
function showTip(html: string, x: number, y: number) {
  tip.innerHTML = html;
  tip.style.display = "block";
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x + 12))}px`;
  tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
}
function hideTip() {
  tip.style.display = "none";
  canvas.querySelectorAll(".lit").forEach((el) => el.classList.remove("lit"));
}
canvas.addEventListener("pointermove", (e) => {
  const t = e.target as Element;
  const wire = t.getAttribute?.("data-wire");
  canvas.querySelectorAll(".lit").forEach((el) => el.classList.remove("lit"));
  if (wire && state.view !== "plain") {
    const html = wireTip(Number(wire));
    if (html) {
      canvas.querySelector(`.ink-wire[data-w="${wire}"]`)?.classList.add("lit");
      return showTip(html, e.clientX, e.clientY);
    }
  }
  const g = t.closest?.(".fold");
  if (g) return showTip(esc(g.getAttribute("data-title") ?? ""), e.clientX, e.clientY);
  hideTip();
});
canvas.addEventListener("pointerleave", hideTip);

// Fonts change how wide text measures, so draw again once they've arrived.
document.fonts?.ready.then(() => {
  cache = undefined;
  render();
});
render();
