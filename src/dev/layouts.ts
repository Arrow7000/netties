/**
 * A page of laid-out nets for looking over routing and placement by eye:
 * open /layouts.html on the dev server. Every drawing has a short label to
 * point at (E3.2 is example 3 after 2 steps; R, T and H are generated nets).
 * Drawings the checks in `routeCheck.ts` find fault with are outlined, and
 * the wires at fault are marked when a drawing is opened.
 */
import { examples } from "../core/examples";
import { type End, Net, type WireId, free, port } from "../core/net";
import { combinators } from "../core/presets";
import { parallelStep } from "../core/reduce";
import type { System } from "../core/system";
import { G, type Placement } from "../layout/geometry";
import { autoLayout } from "../layout/place";
import { type Routed, route } from "../layout/route";
import { wiresThroughAgents, wiresTooClose } from "../layout/routeCheck";
import { roundedPath } from "../render/path";
import { toSVG } from "../render/svg";

type Mode = "auto" | "manual";

interface Drawing {
  label: string;
  title: string;
  net: Net;
  sys: System;
  placement: Placement;
  /** Columns from automatic layout; manual mode routes without them, as the app does. */
  columns?: Map<string, number>;
}

interface Section {
  key: string;
  heading: string;
  about: string;
  /** Whether switching to manual changes these drawings. */
  modal: boolean;
  drawings: () => Drawing[];
}

/** A small seeded random number generator (mulberry32), so the generated nets are the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const sys = combinators();

/** Agents of the given types with every port wired to a random other port, plus a few loose ends. */
function tangle(count: number, seed: number): Net {
  const r = rng(seed);
  const net = new Net();
  const ends: End[] = [];
  for (let i = 0; i < count; i++) {
    const t = sys.type(["γ", "δ", "ε"][r(3)]!);
    const id = net.addAgent(t);
    for (let s = 0; s <= t.arity; s++) ends.push(port(id, s));
  }
  for (let i = 0; i < r(3) || ends.length % 2; i++) ends.push(free(`${"abcdefgh"[i]}`));
  for (let i = ends.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [ends[i], ends[j]] = [ends[j]!, ends[i]!];
  }
  for (let i = 0; i < ends.length; i += 2) net.connect(ends[i]!, ends[i + 1]!);
  return net;
}

/**
 * Trees of γ and δ meeting tip to tip in active pairs, as real nets mostly
 * are, with `links` of their loose ends wired to each other and the rest
 * left loose or capped with ε.
 */
function forest(count: number, links: number, seed: number): Net {
  const r = rng(seed);
  const net = new Net();
  const loose: End[] = [];
  const grow = (size: number): End => {
    if (size <= 0) {
      if (r(3) === 0) return port(net.addAgent(sys.type("ε")), 0);
      return { kind: "free", name: "" };
    }
    const id = net.addAgent(sys.type(r(2) ? "γ" : "δ"));
    const left = r(size);
    for (const [slot, n] of [
      [1, left],
      [2, size - 1 - left],
    ] as const) {
      const child = grow(n);
      if (child.kind === "free") loose.push(port(id, slot));
      else net.connect(port(id, slot), child);
    }
    return port(id, 0);
  };
  let made = 0;
  while (made < count) {
    const a = 1 + r(Math.max(1, Math.min(6, count - made)));
    const b = 1 + r(3);
    made += a + b;
    net.connect(grow(a), grow(b));
  }
  for (let i = loose.length - 1; i > 0; i--) {
    const j = r(i + 1);
    [loose[i], loose[j]] = [loose[j]!, loose[i]!];
  }
  let k = 0;
  for (; k < links * 2 && k + 1 < loose.length; k += 2) net.connect(loose[k]!, loose[k + 1]!);
  for (let n = 0; k < loose.length; k++, n++) net.connect(loose[k]!, free(`x${n}`));
  return net;
}

/** A net's agents put on a loose grid (cells 90 by 80, nudged a little), each pointing either way. */
function scatter(net: Net, seed: number): Placement {
  const r = rng(seed);
  const placement: Placement = new Map();
  const cols = Math.ceil(Math.sqrt(net.agents.size * 1.5));
  const used = new Set<number>();
  for (const id of net.agents.keys()) {
    let c = r(cols * cols);
    while (used.has(c)) c = (c + 1) % (cols * cols);
    used.add(c);
    placement.set(id, { x: (c % cols) * 90 + r(20), y: Math.floor(c / cols) * 80 + r(16), orient: r(2) ? "up" : "down" });
  }
  return placement;
}

const auto = (label: string, title: string, net: Net, s: System = sys): Drawing => {
  const l = autoLayout(net);
  return { label, title, net, sys: s, placement: l.placement, columns: l.columns };
};

const sections: Section[] = [
  {
    key: "E",
    heading: "Examples, step by step",
    about: "Each example and the steps after it (all ready pairs fire at once), laid out as the app does.",
    modal: true,
    drawings: () =>
      examples.flatMap((ex, i) => {
        const s = ex.system();
        const net = ex.net(s);
        const out: Drawing[] = [];
        let prev: Placement | undefined;
        for (let step = 0; step < 12; step++) {
          const l = autoLayout(net, { prev });
          prev = l.placement;
          out.push({ label: `E${i}.${step}`, title: ex.name, net: net.clone(), sys: s, placement: l.placement, columns: l.columns });
          if (!parallelStep(net, s).length) break;
        }
        return out;
      }),
  },
  {
    key: "T",
    heading: "Trees in pairs",
    about: "Generated: trees of γ and δ meeting in active pairs, more of them further down, with some loose ends wired across.",
    modal: true,
    drawings: () =>
      Array.from({ length: 48 }, (_, k) => {
        const count = 3 + Math.floor(k / 2) * 2;
        const net = forest(count, Math.floor(k / 4), 1000 + k);
        return auto(`T${k}`, `${net.agents.size} agents`, net);
      }),
  },
  {
    key: "R",
    heading: "Tangles",
    about: "Generated: every port wired to a random other one. Harder than real nets.",
    modal: true,
    drawings: () =>
      Array.from({ length: 40 }, (_, k) => {
        const net = tangle(2 + Math.floor(k / 2), 2000 + k);
        return auto(`R${k}`, `${net.agents.size} agents`, net);
      }),
  },
  {
    key: "H",
    heading: "Placed by hand",
    about: "Generated: tangles with their agents scattered on a loose grid, as if dragged there, routed as in manual mode.",
    modal: false,
    drawings: () =>
      Array.from({ length: 40 }, (_, k) => {
        const net = tangle(2 + Math.floor(k / 3), 3000 + k);
        return { label: `H${k}`, title: `${net.agents.size} agents`, net, sys, placement: scatter(net, 4000 + k) };
      }),
  },
];

// ---------------------------------------------------------------------------
// The page.

const css = `
:root { --paper: #fff; --ink: #000; --dim: #777; --line: #e3e3e3; --bad: #e0242b; --warn: #e08a00; --accent: #2d5bff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper: #000; --ink: #fff; --dim: #888; --line: #262626; --bad: #ff5a5f; --warn: #ffb02e; --accent: #7090ff; } }
:root[data-theme="dark"] { --paper: #000; --ink: #fff; --dim: #888; --line: #262626; --bad: #ff5a5f; --warn: #ffb02e; --accent: #7090ff; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 13px/1.4 Geist, system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  padding: 10px 16px; background: var(--paper); border-bottom: 1px solid var(--line); }
header h1 { font-size: 14px; font-weight: 600; margin: 0 8px 0 0; }
header .group { display: flex; gap: 2px; border: 1px solid var(--line); border-radius: 7px; padding: 2px; }
header button { font: inherit; color: var(--dim); background: none; border: 0; border-radius: 5px; padding: 3px 9px; cursor: pointer; }
header button[aria-pressed="true"] { color: var(--ink); background: var(--line); }
header label { display: flex; gap: 6px; align-items: center; color: var(--dim); cursor: pointer; }
header .count { color: var(--dim); margin-left: auto; }
section { padding: 14px 16px 4px; }
section h2 { font-size: 13px; font-weight: 600; margin: 0; }
section p { margin: 2px 0 10px; color: var(--dim); }
.grid { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
.tile { border: 1px solid var(--line); border-radius: 8px; padding: 6px 6px 4px; cursor: zoom-in; background: var(--paper); }
.tile.bad { border-color: var(--bad); box-shadow: 0 0 0 1px var(--bad); }
.tile.warn { border-color: var(--warn); }
.tile .head { display: flex; gap: 6px; align-items: baseline; font-size: 11px; }
.tile .label { font-weight: 600; }
.tile .title { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.tile .note { color: var(--bad); font-size: 11px; }
.tile.warn .note { color: var(--warn); }
.tile svg { display: block; }
.big { position: fixed; inset: 0; z-index: 3; display: none; flex-direction: column; background: var(--paper); padding: 12px 16px; }
.big.open { display: flex; }
.big .head { display: flex; gap: 10px; align-items: baseline; }
.big .head .label { font-weight: 600; font-size: 15px; }
.big .head .hint { margin-left: auto; color: var(--dim); }
.big .body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.big .body svg { max-width: 100%; max-height: 100%; width: auto; height: auto; }
.big .note { color: var(--bad); }
`;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`netties:layouts:${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`netties:layouts:${k}`, v);
    } catch {}
  },
};

let mode: Mode = store.get("mode") === "manual" ? "manual" : "auto";
let onlyFlagged = store.get("flagged") === "1";
let scale = Number(store.get("scale")) || 0.5;
let theme = store.get("theme") ?? "system";

document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
const header = document.createElement("header");
const main = document.createElement("main");
const big = document.createElement("div");
big.className = "big";
document.body.append(header, main, big);

const ink = { paper: "var(--paper)", ink: "var(--ink)" };

interface Shown {
  d: Drawing;
  routed: Routed;
  /** What the checks found, if anything; `bad` for wires through or by agents, or too close. */
  note: string;
  level: "" | "warn" | "bad";
  /** The wires the checks found fault with, and how badly. */
  marked: Map<WireId, "warn" | "bad">;
}

function show(d: Drawing, modal: boolean): Shown {
  const routed = d.columns && !(modal && mode === "manual") ? route(d.net, d.placement, { columns: d.columns }) : route(d.net, d.placement);
  const through = wiresThroughAgents(d.net, d.placement, routed, 3);
  const close = wiresTooClose(routed);
  const tight = close.filter((c) => c.gap < G.wireGap / 2 - 0.01);
  const notes: string[] = [];
  if (through.length) notes.push(`${through.length} by an agent`);
  if (tight.length) notes.push(`${tight.length} on top of each other`);
  if (close.length > tight.length) notes.push(`${close.length - tight.length} squeezed`);
  const level = through.length || tight.length ? "bad" : close.length ? "warn" : "";
  const marked = new Map<WireId, "warn" | "bad">();
  for (const c of close) for (const w of [c.a, c.b]) marked.set(w, c.gap < G.wireGap / 2 - 0.01 ? "bad" : (marked.get(w) ?? "warn"));
  for (const h of through) marked.set(h.wire, "bad");
  return { d, routed, note: notes.join(", "), level, marked };
}

function svgFor(s: Shown, width?: number): string {
  const svg = toSVG(s.d.net, s.d.sys, s.d.placement, s.routed, ink, 16);
  if (width === undefined) return svg;
  // Scale the drawing by rewriting its size; the view box keeps the contents.
  return svg.replace(/width="([\d.]+)" height="([\d.]+)"/, (_, w, h) => `width="${(w * width) / 2}" height="${(h * width) / 2}"`);
}

const cache = new Map<string, Drawing[]>();
let shown: Shown[] = [];

function render() {
  document.documentElement.toggleAttribute("data-theme", theme !== "system");
  if (theme !== "system") document.documentElement.dataset.theme = theme;
  const pressed = (on: boolean) => `aria-pressed="${on}"`;
  header.innerHTML = `
    <h1>Layouts</h1>
    <div class="group">
      <button data-mode="auto" ${pressed(mode === "auto")} title="Route with automatic layout's columns">Auto</button>
      <button data-mode="manual" ${pressed(mode === "manual")} title="Same positions, routed as in manual mode">Manual</button>
    </div>
    <div class="group">
      ${[0.35, 0.5, 0.75, 1].map((s) => `<button data-scale="${s}" ${pressed(scale === s)}>${s * 100}%</button>`).join("")}
    </div>
    <div class="group">
      ${["system", "light", "dark"].map((t) => `<button data-theme="${t}" ${pressed(theme === t)}>${t[0]!.toUpperCase() + t.slice(1)}</button>`).join("")}
    </div>
    <label><input type="checkbox" data-flagged ${onlyFlagged ? "checked" : ""}/> Only flagged</label>
    <span class="count"></span>`;
  main.innerHTML = "";
  shown = [];
  let flagged = 0;
  for (const sec of sections) {
    if (!cache.has(sec.key)) cache.set(sec.key, sec.drawings());
    const el = document.createElement("section");
    el.innerHTML = `<h2>${sec.key}: ${sec.heading}</h2><p>${sec.about}${sec.modal ? "" : " Auto and Manual draw these the same."}</p><div class="grid"></div>`;
    const grid = el.querySelector(".grid")!;
    for (const d of cache.get(sec.key)!) {
      const s = show(d, sec.modal);
      if (s.level === "bad") flagged++;
      if (onlyFlagged && !s.level) continue;
      const i = shown.push(s) - 1;
      const tile = document.createElement("div");
      tile.className = `tile ${s.level}`;
      tile.dataset.i = String(i);
      tile.innerHTML = `<div class="head"><span class="label">${d.label}</span><span class="title" title="${d.title}">${d.title}</span></div>${
        s.note ? `<div class="note">${s.note}</div>` : ""
      }${svgFor(s, scale)}`;
      grid.append(tile);
    }
    main.append(el);
  }
  header.querySelector(".count")!.textContent = `${shown.length} drawings, ${flagged} flagged`;
}

/** The flagged wires drawn over the drawing, in the colour of what's wrong with them. */
function marks(s: Shown): string {
  return [...s.marked]
    .map(([w, how]) => {
      const d = roundedPath(s.routed.wires.get(w)!, G.radius);
      return `<path d="${d}" fill="none" stroke="var(--${how})" stroke-width="2.6" stroke-linecap="round" opacity="0.85"/>`;
    })
    .join("");
}

let open = -1;
function openBig(i: number) {
  open = i;
  const s = shown[i]!;
  big.innerHTML = `<div class="head"><span class="label">${s.d.label}</span><span>${s.d.title}</span>${
    s.note ? `<span class="note">${s.note}</span>` : ""
  }<span class="hint">← → to move, Esc to close</span></div><div class="body">${svgFor(s).replace("</svg>", `${marks(s)}</svg>`)}</div>`;
  big.classList.add("open");
}
function closeBig() {
  open = -1;
  big.classList.remove("open");
}

header.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset.mode) store.set("mode", (mode = b.dataset.mode as Mode));
  if (b.dataset.scale) store.set("scale", String((scale = Number(b.dataset.scale))));
  if (b.dataset.theme) store.set("theme", (theme = b.dataset.theme));
  render();
});
header.addEventListener("change", (e) => {
  if (!(e.target as HTMLElement).hasAttribute("data-flagged")) return;
  onlyFlagged = (e.target as HTMLInputElement).checked;
  store.set("flagged", onlyFlagged ? "1" : "0");
  render();
});
main.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  if (t) openBig(Number(t.dataset.i));
});
big.addEventListener("click", closeBig);
addEventListener("keydown", (e) => {
  if (open < 0) return;
  if (e.key === "Escape") closeBig();
  if (e.key === "ArrowRight" && open < shown.length - 1) openBig(open + 1);
  if (e.key === "ArrowLeft" && open > 0) openBig(open - 1);
});

render();
