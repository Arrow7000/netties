/* netkit.js — shared drawing + gesture kit for the three netties prototypes.
   Throwaway prototype code. It renders the real engine layouts from nets.json
   and mocks every edit locally (no reduction engine). Each direction builds its
   own chrome on top of this. */
(function () {
  "use strict";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const G = { portGap: 16, radius: 9, circleR: 8, agentH: 30, stroke: 1.4, halo: 6, freeMargin: 30 };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pts = (p) => p.map((q) => q[0].toFixed(2) + "," + q[1].toFixed(2)).join(" ");

  /* ------------------------------------------------------------ data */
  const POLARITY = { "0": ["out"], S: ["out", "in"], "+": ["in", "out", "in"], "×": ["in", "out", "in"], δ: ["in", "out", "out"], ε: ["in"] };

  // What a rule does, for the step preview. A/B are the two agents in key order.
  // rewire: list of [[side,slot],[side,slot]] whose neighbours get joined.
  const EFFECTS = {
    "δ|δ": { rewire: [[["A", 1], ["B", 1]], [["A", 2], ["B", 2]]], say: "The two duplicators cancel out. Their wires join straight across." },
    "γ|γ": { rewire: [[["A", 1], ["B", 2]], [["A", 2], ["B", 1]]], say: "The two constructors cancel out. Their wires join crosswise." },
    "ε|ε": { rewire: [], say: "Two erasers meet and both disappear." },
    "+|0": { rewire: [[["A", 1], ["A", 2]]], say: "0 + y = y. The add disappears and y goes straight to the result." },
    "ε|γ": { create: true, say: "The eraser deletes γ and leaves an eraser on each of its wires." },
    "ε|δ": { create: true, say: "The eraser deletes δ and leaves an eraser on each of its wires." },
    "δ|γ": { create: true, say: "They pass through each other: each gets copied, making two γ and two δ." },
    "+|S": { create: true, say: "(1 + x) + y = 1 + (x + y). The S moves out to the result." },
    "×|0": { create: true, say: "0 × y = 0. y gets erased and the result is 0." },
    "×|S": { create: true, say: "(1 + x) × y = y + x × y. y gets duplicated." },
    "δ|0": { create: true, say: "Copying 0 makes two 0s." },
    "δ|S": { create: true, say: "Copying S makes two S and copies what's behind it." },
    "ε|0": { create: true, say: "The eraser deletes 0." },
    "ε|S": { create: true, say: "The eraser deletes S and moves on to what's behind it." },
  };
  function effectFor(ta, tb) {
    if (EFFECTS[ta + "|" + tb]) return { ...EFFECTS[ta + "|" + tb], swap: false };
    if (EFFECTS[tb + "|" + ta]) return { ...EFFECTS[tb + "|" + ta], swap: true };
    return { create: true, say: "Replaced by the rule's right-hand side." };
  }

  function endPosRaw(s, end) {
    if (end.free != null) { const f = s.free.find((f) => f.name === end.free); return f ? [f.x, f.y] : [0, 0]; }
    const a = s.agents.find((a) => a.id === end.agent); return a ? a.ports[end.slot] : [0, 0];
  }
  function normaliseState(s) {
    for (const w of s.wires) {
      const p0 = endPosRaw(s, w.ends[0]), a = w.path[0], b = w.path[w.path.length - 1];
      if (Math.hypot(a[0] - p0[0], a[1] - p0[1]) > Math.hypot(b[0] - p0[0], b[1] - p0[1])) w.path.reverse();
    }
  }

  async function load(url = "../../assets/nets.json") {
    const d = await (await fetch(url)).json();
    Object.assign(G, d.geometry);
    const ex = d.examples;
    for (const e of ex) for (const t of e.types) { t.circle = !!(t.shape && t.shape.circle); }
    const arith = ex.find((e) => e.name === "3 + 2");
    const comm = ex.find((e) => e.name === "Commutation");
    // Synthetic: a stuck pair (+ facing ×), reusing a real layout.
    const st = clone(comm.states[0]);
    st.agents.forEach((a) => (a.type = a.type === "γ" ? "+" : "×"));
    ex.push({ name: "A pair with no rule", types: clone(arith.types), rules: clone(arith.rules), states: [st], synthetic: true });
    const typed = clone(arith); typed.name = "3 + 2 with typed ports"; typed.typed = true; typed.preview = true;
    { const tS = typed.types.find((t) => t.id === "S"), t0 = typed.types.find((t) => t.id === "0"), tP = typed.types.find((t) => t.id === "+");
      typed.states[0].agents.push(makeAgent(tS, 1901, 120, -40, "down"), makeAgent(t0, 1902, 160, -40, "down"), makeAgent(tP, 1903, 140, 40, "up")); }
    ex.push(typed);
    // A bigger rule system (10 agent types) on a real layout, to try the rule grid overflow.
    { const two = ex.find((e) => e.name === "2 × 2");
      const big = clone(two); big.name = "2 × 2 with 10 agent types"; big.big = true;
      big.types.push(
        { id: "−", name: "subtract", symbol: "−", arity: 2, filled: false, circle: false },
        { id: "P", name: "predecessor", symbol: "P", arity: 1, filled: false, circle: false },
        { id: "T", name: "true", symbol: "T", arity: 0, filled: false, circle: true },
        { id: "F", name: "false", symbol: "F", arity: 0, filled: true, circle: true });
      big.rules.push("−|0", "−|S", "P|0", "P|S", "δ|T", "δ|F", "ε|T", "ε|F", "δ|δ", "ε|ε");
      ex.push(big); }
    for (const e of ex) for (const s of e.states) normaliseState(s);
    for (const e of ex) e.family = e.types.some((t) => t.id === "γ") ? "comb" : "arith";
    return d;
  }

  /* ------------------------------------------------------- geometry */
  function makeAgent(type, id, cx, cy, orient = "down") {
    const n = type.arity, s = orient === "down" ? 1 : -1;
    if (type.component) {
      const w = Math.max(56, (n + 1) * G.portGap + 16), h = 30;
      const ports = [[cx, cy + s * h / 2]];
      for (let i = 1; i <= n; i++) ports.push([cx + s * (i - (n + 1) / 2) * G.portGap, cy - s * h / 2]);
      return { id, type: type.id, x: cx, y: cy, orient, outline: { rect: { x: cx - w / 2, y: cy - h / 2, w, h } }, ports };
    }
    if (type.circle) {
      const r = n === 0 ? G.circleR : Math.max(G.circleR + 2, n * 5 + 6);
      const ports = [[cx, cy + s * r]];
      for (let i = 1; i <= n; i++) {
        const a = n === 1 ? 0 : lerp(-0.85, 0.85, (i - 1) / (n - 1));
        ports.push([cx + s * r * Math.sin(a), cy - s * r * Math.cos(a)]);
      }
      return { id, type: type.id, x: cx, y: cy, orient, outline: { circle: { cx, cy, r } }, ports };
    }
    const w = (n + 1) * G.portGap, h = G.agentH || 30;
    const wide = cy - s * h / 2, apex = cy + s * h / 2;
    const ports = [[cx, apex]];
    for (let i = 1; i <= n; i++) ports.push([cx + s * (i - (n + 1) / 2) * G.portGap, wide]);
    return { id, type: type.id, x: cx, y: cy, orient, outline: { polygon: [[cx - w / 2, wide], [cx + w / 2, wide], [cx, apex]] }, ports };
  }
  function translateAgent(a, dx, dy) {
    const b = clone(a);
    b.x += dx; b.y += dy;
    b.ports = b.ports.map((p) => [p[0] + dx, p[1] + dy]);
    if (b.outline.polygon) b.outline.polygon = b.outline.polygon.map((p) => [p[0] + dx, p[1] + dy]);
    if (b.outline.circle) { b.outline.circle.cx += dx; b.outline.circle.cy += dy; }
    if (b.outline.rect) { b.outline.rect.x += dx; b.outline.rect.y += dy; }
    return b;
  }
  function agentBox(a) {
    const o = a.outline;
    if (o.circle) return { x0: o.circle.cx - o.circle.r, y0: o.circle.cy - o.circle.r, x1: o.circle.cx + o.circle.r, y1: o.circle.cy + o.circle.r };
    if (o.rect) return { x0: o.rect.x, y0: o.rect.y, x1: o.rect.x + o.rect.w, y1: o.rect.y + o.rect.h };
    const xs = o.polygon.map((p) => p[0]), ys = o.polygon.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  function portDir(a, slot) {
    const s = a.orient === "down" ? 1 : -1;
    if (slot === 0) return [0, s];
    if (a.outline.circle) { const c = a.outline.circle, p = a.ports[slot], l = Math.hypot(p[0] - c.cx, p[1] - c.cy) || 1; return [(p[0] - c.cx) / l, (p[1] - c.cy) / l]; }
    return [0, -s];
  }
  function curve(p0, d0, p1, d1, n = 22) {
    const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const k = clamp(dist * 0.45, 14, 120);
    const c0 = [p0[0] + d0[0] * k, p0[1] + d0[1] * k], c1 = [p1[0] + d1[0] * k, p1[1] + d1[1] * k];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0],
                u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1]]);
    }
    return out;
  }
  function stateBounds(s) {
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = (x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
    for (const a of s.agents) { const q = agentBox(a); add(q.x0, q.y0); add(q.x1, q.y1); }
    for (const w of s.wires) for (const p of w.path) add(p[0], p[1]);
    for (const f of s.free) add(f.x, f.y);
    if (!isFinite(b.x0)) b = { x0: -100, y0: -80, x1: 100, y1: 80 };
    return b;
  }

  /* ------------------------------------------------------- glyphs */
  // Standalone SVG of one agent type (palette, editors, rule pictograms).
  function glyph(type, opts = {}) {
    const size = opts.size || 40, orient = opts.orient || "down", stubs = opts.stubs !== false;
    const a = makeAgent(type, 0, 0, 0, orient);
    const box = agentBox(a);
    const pad = opts.labels ? 13 : stubs ? 9 : 3;
    const vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad];
    let s = `<svg class="nk-glyph" viewBox="${vb.join(" ")}" width="${opts.w || size}" height="${opts.h || size}" aria-hidden="true">`;
    if (stubs) a.ports.forEach((p, i) => { const d = portDir(a, i); s += `<line x1="${p[0]}" y1="${p[1]}" x2="${p[0] + d[0] * 8}" y2="${p[1] + d[1] * 8}" class="nk-gstub"/>`; });
    s += agentShapeSVG(a, type, { extraCls: "" });
    if (opts.labels) a.ports.forEach((p, i) => { const d = portDir(a, i); s += `<circle cx="${p[0]}" cy="${p[1]}" r="1.8" class="${i === 0 ? "nk-gprin" : "nk-gaux"}"/>`; if (i) s += `<text x="${p[0] + d[0] * 12.5}" y="${p[1] + d[1] * 12.5}" class="nk-gnum">${i}</text>`; });
    return s + "</svg>";
  }
  function agentShapeSVG(a, type, o = {}) {
    type = type || { symbol: a.type, filled: false };
    const filled = type.filled && !type.component;
    const cls = "nk-shape" + (filled ? " filled" : "") + (o.extraCls ? " " + o.extraCls : "");
    let s = "", tx, ty, fs;
    if (a.outline.circle) {
      const c = a.outline.circle;
      s += `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" class="${cls}"/>`;
      tx = c.cx; ty = c.cy; fs = c.r * 1.25;
    } else if (a.outline.rect) {
      const r = a.outline.rect;
      s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" class="${cls} comp"/>`;
      s += `<rect x="${r.x + 2.5}" y="${r.y + 2.5}" width="${r.w - 5}" height="${r.h - 5}" rx="2.5" class="nk-compinner"/>`;
      return s + `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" class="nk-complabel">${esc(type.name)}</text>`;
    } else {
      const p = a.outline.polygon;
      s += `<polygon points="${pts(p)}" class="${cls}" stroke-linejoin="round"/>`;
      const h = Math.abs(p[2][1] - p[0][1]);
      tx = p[2][0]; ty = (2 * p[0][1] + p[2][1]) / 3; fs = clamp(h * 0.46, 7, 15);
    }
    const sym = type.symbol || "?";
    if (sym.length > 2) fs *= 0.62; else if (sym.length > 1) fs *= 0.8;
    s += `<text x="${tx}" y="${ty}" class="nk-sym${filled ? " filled" : ""}" font-size="${fs.toFixed(2)}">${esc(sym)}</text>`;
    return s;
  }
  function ringSVG(a, cls) {
    const o = a.outline;
    if (o.circle) return `<circle cx="${o.circle.cx}" cy="${o.circle.cy}" r="${o.circle.r}" class="${cls}"/>`;
    if (o.rect) return `<rect x="${o.rect.x}" y="${o.rect.y}" width="${o.rect.w}" height="${o.rect.h}" rx="4" class="${cls}"/>`;
    return `<polygon points="${pts(o.polygon)}" class="${cls}" stroke-linejoin="round"/>`;
  }

  function miniSVG(state, typesArr, w = 80, h = 60, opts = {}) {
    const types = {}; for (const t of typesArr) types[t.id] = t;
    const b = stateBounds(state); const pad = opts.pad || 10;
    const vb = [b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad];
    let s = `<svg class="nk-mini" viewBox="${vb.join(" ")}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
    for (const wi of state.wires) s += `<polyline class="nk-halo" points="${pts(wi.path)}"/>` + (opts.active === wi.id ? `<polyline class="nk-activeb" points="${pts(wi.path)}"/>` : "") + `<polyline class="nk-wire" points="${pts(wi.path)}"/>`;
    for (const a of state.agents) s += agentShapeSVG(a, types[a.type]);
    return s + "</svg>";
  }
  // Two agents facing principal to principal, as a rule's left-hand side.
  function pairGlyph(ta, tb, opts = {}) {
    const a = makeAgent(ta, 1, 0, 0, "down"), bb0 = agentBox(a);
    const gap = 12;
    const a2 = translateAgent(a, 0, -(bb0.y1) - gap / 2);
    const b = makeAgent(tb, 2, 0, 0, "up"), bb1 = agentBox(b);
    const b2 = translateAgent(b, 0, -(bb1.y0) + gap / 2);
    const st = { agents: [a2, b2], wires: [{ id: 1, ends: [{ agent: 1, slot: 0 }, { agent: 2, slot: 0 }], path: [a2.ports[0], b2.ports[0]] }], free: [] };
    for (const ag of [a2, b2]) ag.ports.forEach((p, i) => { if (i) { const d = portDir(ag, i); st.wires.push({ id: 10 + st.wires.length, ends: [], path: [p, [p[0] + d[0] * 7, p[1] + d[1] * 7]] }); } });
    return miniSVG(st, [ta, tb], opts.w || 28, opts.h || 40, { pad: 3, active: opts.active ? 1 : null });
  }

  /* ------------------------------------------------------- styles */
  const CSS = `
  .nk-host{position:relative;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
  .nk-svg{position:absolute;inset:0;width:100%;height:100%;display:block}
  .nk-halo{fill:none;stroke:var(--paper);stroke-width:${G.halo};stroke-linecap:butt;stroke-linejoin:round}
  .nk-wire{fill:none;stroke:var(--ink);stroke-width:${G.stroke};stroke-linejoin:round;stroke-linecap:round}
  .nk-wire.carried{stroke:var(--ink)}
  .nk-wire.newwire{stroke:var(--accent);stroke-dasharray:4 3}
  .nk-activeb{fill:none;stroke:var(--active);stroke-width:5;stroke-linecap:round;opacity:var(--active-op,.55);transition:stroke-width .12s}
  .nk-activeb.hot{stroke-width:9;opacity:.9}
  .nk-stuckb{fill:none;stroke:var(--stuck);stroke-width:5;stroke-dasharray:2.5 2.5;opacity:.6}
  .nk-stuckb.hot{opacity:.95;stroke-width:7}
  .nk-wsel{fill:none;stroke:var(--accent);stroke-width:5.5;stroke-linecap:round;opacity:.9}
  .nk-wsel.pre{opacity:.4}
  .nk-whit{fill:none;stroke:transparent;stroke-width:11;stroke-linecap:round;cursor:pointer}
  .nk-whit.act{stroke-width:18}
  .nk-shape{fill:var(--paper);stroke:var(--ink);stroke-width:${G.stroke}}
  .nk-shape.filled{fill:var(--ink)}
  .nk-shape.comp{stroke-width:1.2}
  .nk-compinner{fill:none;stroke:var(--ink);stroke-width:.6;stroke-dasharray:2 1.6;opacity:.7}
  .nk-complabel{font:500 8.5px var(--ui-font,system-ui);fill:var(--ink);text-anchor:middle;dominant-baseline:central}
  .nk-sym{font-family:'STIX Two Text','Cambria Math',Georgia,serif;font-style:italic;fill:var(--ink);text-anchor:middle;dominant-baseline:central;pointer-events:none}
  .nk-sym.filled{fill:var(--paper)}
  .nk-agent{cursor:grab}
  .nk-ring-o{fill:none;stroke:var(--accent);stroke-width:6.6;stroke-linejoin:round}
  .nk-ring-i{fill:none;stroke:var(--paper);stroke-width:3.8;stroke-linejoin:round}
  .nk-ring-o.pre{stroke-dasharray:3 2;opacity:.75}
  .nk-pair-o{fill:none;stroke:var(--active);stroke-width:4.4;stroke-linejoin:round;opacity:.55}
  .nk-pair-o.stuck{stroke:var(--stuck);opacity:.4}
  .nk-pair-o.alt,.nk-pair-o.plain{stroke:var(--accent);opacity:.4}
  .nk-activeb.alt{stroke:var(--accent);stroke-dasharray:2.2 1.8;opacity:.75}
  .nk-activeb.alt.hot{stroke-dasharray:none;opacity:.85}
  .nk-port-hit{fill:transparent;cursor:crosshair}
  .nk-port-empty{fill:var(--paper);stroke:var(--ink);stroke-width:1.1}
  .nk-port-hover{fill:none;stroke:var(--accent);stroke-width:1.4}
  .nk-port-origin{fill:var(--accent);stroke:var(--paper);stroke-width:1}
  .nk-port-cand{fill:none;stroke:var(--accent);stroke-width:1;opacity:.55}
  .nk-port-target{fill:color-mix(in srgb,var(--accent) 22%,transparent);stroke:var(--accent);stroke-width:2}
  .nk-port-refuse{fill:none;stroke:var(--stuck);stroke-width:1.6}
  .nk-port-bad{fill:var(--paper);stroke:var(--muted);stroke-width:1.1;stroke-dasharray:1.6 1.1}
  .nk-port-badx{stroke:var(--muted);stroke-width:1.1}
  .nk-pol{font:600 5.2px var(--ui-font,system-ui);fill:var(--muted);text-anchor:middle;dominant-baseline:central;pointer-events:none}
  .nk-free{fill:var(--paper);stroke:var(--ink);stroke-width:1.1}
  .nk-free-label{font:italic 9px 'STIX Two Text',Georgia,serif;fill:var(--muted);text-anchor:middle;dominant-baseline:central;pointer-events:none}
  .nk-free-hit{fill:transparent;cursor:grab}
  .nk-dragnote{font:500 9px var(--ui-font,system-ui);fill:var(--accent);pointer-events:none}
  .nk-dragnote.bad{fill:var(--stuck)}
  .nk-marquee{fill:color-mix(in srgb,var(--accent) 8%,transparent);stroke:var(--accent);stroke-width:1;stroke-dasharray:4 3;pointer-events:none}
  .nk-pv-wire{fill:none;stroke:var(--active);stroke-width:1.6;stroke-dasharray:3 2.4;opacity:.95}
  .nk-pv-x{stroke:var(--stuck);stroke-width:1.6;stroke-linecap:round}
  .nk-pv-fade{opacity:.28}
  .nk-ghost .nk-shape{fill:none;stroke:var(--active);stroke-dasharray:2.4 1.8}
  .nk-ghost .nk-sym{fill:var(--active)}
  .nk-ghost .nk-wire{stroke:var(--active);stroke-dasharray:2.4 2}
  .nk-ghost .nk-halo{opacity:0}
  .nk-firepill{font:600 9px var(--ui-font,system-ui);pointer-events:none}
  .nk-tip{position:absolute;z-index:30;pointer-events:none;max-width:260px;opacity:0;transform:translateY(2px);transition:opacity .12s,transform .12s}
  .nk-tip.on{opacity:1;transform:none}
  .nk-empty{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none}
  .nk-host.is-empty .nk-empty{display:flex}
  .nk-host.pan{cursor:grabbing}
  .nk-host.dropping{outline:2px dashed var(--accent);outline-offset:-6px}
  .nk-gnum{font:500 4.6px var(--ui-font,system-ui);fill:var(--muted);text-anchor:middle;dominant-baseline:central}
  .nk-gstub{stroke:var(--ink);stroke-width:${G.stroke}}
  .nk-gprin{fill:var(--active);stroke:none}.nk-gaux{fill:var(--paper);stroke:var(--ink);stroke-width:.8}
  .nk-paghost{position:fixed;z-index:100;pointer-events:none;transform:translate(-50%,-50%);opacity:.9;color:var(--ink)}
  `;
  function injectCSS() { if (document.getElementById("nk-css")) return; const st = document.createElement("style"); st.id = "nk-css"; st.textContent = CSS; document.head.prepend(st); }

  /* ------------------------------------------------------- view */
  class View {
    constructor(host, opts = {}) {
      injectCSS();
      this.host = host;
      this.o = Object.assign({ selectWireKey: "alt", emptyHTML: "Drag an agent here from the palette", tipHTML: null, firePill: true, previewOnHover: false }, opts);
      host.classList.add("nk-host");
      host.innerHTML = `<svg class="nk-svg" xmlns="http://www.w3.org/2000/svg"><g class="nk-world"></g><rect class="nk-marquee" style="display:none"/></svg><div class="nk-tip"></div><div class="nk-empty"><div class="nk-emptyin">${this.o.emptyHTML}</div></div>`;
      this.svg = host.querySelector("svg");
      this.world = host.querySelector(".nk-world");
      this.marq = host.querySelector(".nk-marquee");
      this.tip = host.querySelector(".nk-tip");
      this.cam = { x: 0, y: 0, z: 1 };
      this.state = { agents: [], wires: [], free: [] };
      this.types = {}; this.rules = new Set(); this.typed = false;
      this.layout = "auto";
      this.sel = new Set(); this.pre = new Set();
      this.hover = null; this.drag = null; this.preview = null; this.anim = null;
      this.nid = 1000; this.listeners = {};
      this.alt = false; this.ext = null;
      this._bind();
      if (this.o.altMode) {
        const setAlt = (v) => { if (this.alt === v) return; this.alt = v; this.host.classList.toggle("alt", v); this.render(); this.emit("altchange", v); if (this.hover) { const d = this.describe(this.hover); this.emit("hover", { target: this.hover, hint: d && d.hint }); } };
        this._setAlt = setAlt;
        addEventListener("keydown", (e) => { if (e.key === "Alt") { e.preventDefault(); setAlt(true); } });
        addEventListener("keyup", (e) => { if (e.key === "Alt") { e.preventDefault(); setAlt(false); } });
        addEventListener("blur", () => setAlt(false));
        this.host.addEventListener("pointermove", (e) => setAlt(e.altKey));
      }
      new ResizeObserver(() => this.render()).observe(host);
    }
    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
    emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

    setContext({ types, rules, typed }) {
      if (types) { this.types = {}; for (const t of types) this.types[t.id] = t; }
      if (rules) this.rules = new Set(rules);
      if (typed != null) this.typed = typed;
      this.render();
    }
    setState(s, o = {}) {
      this.anim = null; this.state = clone(s); this.sel.clear(); this.preview = null; this.hover = null;
      this._hideTip();
      if (o.fit) this.fit(false); else this.render();
      this.emit("select", this.selection());
    }
    getState() { return clone(this.state); }
    setLayout(m) { this.layout = m; }

    /* ---------- lookups */
    agent(id) { return this.state.agents.find((a) => a.id === id); }
    wireAt(agentId, slot) { return this.state.wires.find((w) => w.ends.some((e) => e.agent === agentId && e.slot === slot)); }
    wireOfFree(name) { return this.state.wires.find((w) => w.ends.some((e) => e.free === name)); }
    endPos(end) { return endPosRaw(this.state, end); }
    endDir(end) {
      if (end.free != null) { const f = this.state.free.find((f) => f.name === end.free); return f && f.dir === "up" ? [0, 1] : [0, -1]; }
      const a = this.agent(end.agent); return a ? portDir(a, end.slot) : [0, 1];
    }
    hasRule(a, b) { return this.rules.has(a + "|" + b) || this.rules.has(b + "|" + a); }
    status(w) {
      const [e0, e1] = w.ends;
      if (e0.slot !== 0 || e1.slot !== 0 || e0.agent == null || e1.agent == null || e0.agent === e1.agent) return null;
      const a = this.agent(e0.agent), b = this.agent(e1.agent);
      if (!a || !b) return null;
      const ta = this.types[a.type], tb = this.types[b.type];
      if (ta && ta.component || tb && tb.component) return null;
      return this.hasRule(a.type, b.type) ? "active" : "stuck";
    }
    pairs() { return this.state.wires.filter((w) => this.status(w)); }
    activePairs() { return this.state.wires.filter((w) => this.status(w) === "active"); }
    stuckPairs() { return this.state.wires.filter((w) => this.status(w) === "stuck"); }
    pairInfo(w) {
      const a = this.agent(w.ends[0].agent), b = this.agent(w.ends[1].agent);
      const ta = this.types[a.type] || { symbol: a.type, name: a.type }, tb = this.types[b.type] || { symbol: b.type, name: b.type };
      return { a, b, ta, tb, status: this.status(w), effect: effectFor(a.type, b.type), key: a.type + "|" + b.type };
    }
    polarity(end) {
      if (this.o.typing) { const t = this.o.typing.endType(this, end); return t ? (t.pol === "give" ? "out" : "in") : null; }
      if (!this.typed) return null;
      if (end.free != null) { const w = this.wireOfFree(end.free); if (!w) return null; const o = w.ends.find((e) => e.free !== end.free); const p = o && this.polarity(o); return p ? (p === "in" ? "out" : "in") : null; }
      const a = this.agent(end.agent); const t = a && POLARITY[a.type]; return t ? t[end.slot] : null;
    }
    selection() { return { agents: [...this.sel].filter((k) => k[0] === "a").map((k) => +k.slice(2)), wires: [...this.sel].filter((k) => k[0] === "w").map((k) => +k.slice(2)) }; }

    /* ---------- camera */
    toWorld(cx, cy) { const r = this.host.getBoundingClientRect(); return [(cx - r.left - this.cam.x) / this.cam.z, (cy - r.top - this.cam.y) / this.cam.z]; }
    toScreen(x, y) { return [x * this.cam.z + this.cam.x, y * this.cam.z + this.cam.y]; }
    fit(animate = true, pad = null) {
      const r = this.host.getBoundingClientRect(); if (!r.width) return;
      const b = stateBounds(this.state);
      const P = pad || this.o.fitPad || { t: 70, r: 70, b: 70, l: 70 };
      const W = r.width - P.l - P.r, H = r.height - P.t - P.b;
      const z = clamp(Math.min(W / (b.x1 - b.x0 + 1), H / (b.y1 - b.y0 + 1)), 0.3, this.o.maxFit || 2.4);
      const target = { z, x: P.l + W / 2 - ((b.x0 + b.x1) / 2) * z, y: P.t + H / 2 - ((b.y0 + b.y1) / 2) * z };
      if (!animate) { this.cam = target; this.render(); this.emit("camera", this.cam); return; }
      const from = { ...this.cam }, t0 = performance.now();
      const tick = (now) => { const t = ease(clamp((now - t0) / 320, 0, 1)); this.cam = { x: lerp(from.x, target.x, t), y: lerp(from.y, target.y, t), z: lerp(from.z, target.z, t) }; this.render(); this.emit("camera", this.cam); if (t < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    outOfView(margin = 20) {
      const r = this.host.getBoundingClientRect(), b = stateBounds(this.state);
      const [x0, y0] = this.toScreen(b.x0, b.y0), [x1, y1] = this.toScreen(b.x1, b.y1);
      return x0 < margin || y0 < margin || x1 > r.width - margin || y1 > r.height - margin;
    }
    zoomAt(f, sx, sy) {
      const r = this.host.getBoundingClientRect();
      if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
      const z = clamp(this.cam.z * f, 0.2, 6); const k = z / this.cam.z;
      this.cam = { z, x: sx - (sx - this.cam.x) * k, y: sy - (sy - this.cam.y) * k };
      this.render(); this.emit("camera", this.cam);
    }

    /* ---------- editing */
    newFreeName() { const used = new Set(this.state.free.map((f) => f.name)); for (const c of "abcdefghijklmnopqrstuvwxyz") if (!used.has(c)) return c; return "x" + this.nid++; }
    addAgent(typeId, clientX, clientY) {
      const t = this.types[typeId]; if (!t) return;
      const [x, y] = this.toWorld(clientX, clientY);
      const a = makeAgent(t, this.nid++, Math.round(x), Math.round(y), "down");
      this.state.agents.push(a); this.sel = new Set(["a:" + a.id]);
      this.render(); this.emit("select", this.selection()); this.emit("change", "Add " + (t.component ? t.name : t.symbol));
      this.flash(a.id);
      return a;
    }
    deleteSelection() {
      const { agents, wires } = this.selection();
      if (!agents.length && !wires.length) return false;
      const dead = new Set(agents);
      const s = this.state;
      const goneW = s.wires.filter((w) => wires.includes(w.id) || w.ends.some((e) => dead.has(e.agent)));
      const goneFree = new Set(goneW.flatMap((w) => w.ends.filter((e) => e.free != null).map((e) => e.free)));
      s.wires = s.wires.filter((w) => !goneW.includes(w));
      s.free = s.free.filter((f) => !goneFree.has(f.name));
      s.agents = s.agents.filter((a) => !dead.has(a.id));
      this.sel.clear(); this.render(); this.emit("select", this.selection());
      this.emit("change", "Delete " + (agents.length ? agents.length + " agent" + (agents.length > 1 ? "s" : "") : "wire"));
      return true;
    }
    select(keys) { this.sel = new Set(keys); this.render(); this.emit("select", this.selection()); }
    selectAll() { this.select(this.state.agents.map((a) => "a:" + a.id)); }
    flip(ids) {
      for (const id of ids) {
        const a = this.agent(id); const t = this.types[a.type]; if (!t) continue;
        const b = makeAgent(t, a.id, a.x, a.y, a.orient === "down" ? "up" : "down");
        Object.assign(a, b);
      }
      this._recurveAround(new Set(ids)); this.render(); this.emit("change", "Flip");
    }
    regenType(typeId) {
      const t = this.types[typeId]; if (!t) return;
      const ids = new Set();
      for (const a of this.state.agents) if (a.type === typeId) {
        const b = makeAgent(t, a.id, a.x, a.y, a.orient); Object.assign(a, b); ids.add(a.id);
        this.state.wires = this.state.wires.filter((w) => !w.ends.some((e) => e.agent === a.id && e.slot > t.arity));
      }
      this._recurveAround(ids); this.render();
    }
    _recurveAround(ids) {
      for (const w of this.state.wires) if (w.ends.some((e) => ids.has(e.agent))) this._curveWire(w);
    }
    _curveWire(w) { w.path = curve(this.endPos(w.ends[0]), this.endDir(w.ends[0]), this.endPos(w.ends[1]), this.endDir(w.ends[1])); w.routed = false; }

    /* ---------- step animation */
    _statusIn(st, w) {
      const [e0, e1] = w.ends;
      if (e0.slot !== 0 || e1.slot !== 0 || e0.agent == null || e1.agent == null || e0.agent === e1.agent) return null;
      const a = st.agents.find((x) => x.id === e0.agent), b = st.agents.find((x) => x.id === e1.agent);
      if (!a || !b) return null;
      return this.hasRule(a.type, b.type) ? "active" : "stuck";
    }
    _plan(prev, next) {
      next = clone(next); normaliseState(next);
      const prevA = new Map(prev.agents.map((a) => [a.id, a]));
      const nextIds = new Set(next.agents.map((a) => a.id));
      const centers = [];
      for (const w of prev.wires) { if (this._statusIn(prev, w) !== "active") continue; const p = endPosRaw(prev, w.ends[0]), q = endPosRaw(prev, w.ends[1]); centers.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); }
      const off = new Map();
      for (const a of next.agents) {
        const o = prevA.get(a.id);
        if (o) off.set(a.id, [o.x - a.x, o.y - a.y]);
        else if (centers.length) { let best = centers[0], bd = Infinity; for (const c of centers) { const d = Math.hypot(c[0] - a.x, c[1] - a.y); if (d < bd) { bd = d; best = c; } } off.set(a.id, [best[0] - a.x, best[1] - a.y]); }
      }
      const prevF = new Map(prev.free.map((f) => [f.name, f]));
      const foff = new Map(next.free.map((f) => { const o = prevF.get(f.name); return [f.name, o ? [o.x - f.x, o.y - f.y] : [0, 0]]; }));
      const dying = prev.agents.filter((a) => !nextIds.has(a.id));
      const newIds = new Set(next.agents.filter((a) => !prevA.has(a.id)).map((a) => a.id));
      return { prev, next, off, foff, dying, newIds, t: 0 };
    }
    transitionTo(next, ms = 700) {
      return new Promise((done) => {
        const plan = this._plan(this.state, next);
        this.sel.clear(); this.preview = null; this.hover = null; this._hideTip();
        this.anim = Object.assign(plan, { ms, t0: performance.now(), done });
        this.state = plan.next;
        const tick = (now) => {
          if (!this.anim || this.anim.scrub) return done();
          this.anim.t = clamp((now - this.anim.t0) / this.anim.ms, 0, 1);
          this.render();
          if (this.anim.t < 1) requestAnimationFrame(tick); else { this.anim = null; this.render(); done(); }
        };
        requestAnimationFrame(tick);
      });
    }
    // Show a frozen frame part-way through a step (0 = before, 1 = after).
    scrub(prev, next, t) {
      if (!this.anim || !this.anim.scrub || this.anim._p !== prev || this.anim._n !== next) {
        this.anim = Object.assign(this._plan(prev, next), { scrub: true, _p: prev, _n: next });
        this.state = this.anim.next; this.sel.clear(); this.preview = null; this._hideTip();
      }
      this.anim.t = clamp(t, 0, 1);
      if (t >= 1) { this.anim = null; }
      this.render();
    }
    finishAnim() { if (this.anim) { const d = this.anim.done; this.anim = null; this.render(); d && d(); } }
    flash(agentId) { this._flash = { id: agentId, t0: performance.now() }; const tick = () => { this.render(); if (this._flash && performance.now() - this._flash.t0 < 500) requestAnimationFrame(tick); else { this._flash = null; this.render(); } }; requestAnimationFrame(tick); }

    setPreview(p) { this.preview = p; this.render(); }

    /* ---------- render */
    render() {
      const s = this.state, an = this.anim, z = this.cam.z;
      this.world.setAttribute("transform", `translate(${this.cam.x},${this.cam.y}) scale(${z})`);
      this.host.classList.toggle("is-empty", !s.agents.length && !s.wires.length && !an);
      const T = an ? an.t : 1;
      const mt = an ? ease(smooth(0.12, 1, T)) : 1;
      const offA = (id) => { if (!an) return [0, 0]; const o = an.off.get(id); return o ? [o[0] * (1 - mt), o[1] * (1 - mt)] : [0, 0]; };
      const offEnd = (e) => { if (!an) return [0, 0]; if (e.free != null) { const o = an.foff.get(e.free) || [0, 0]; return [o[0] * (1 - mt), o[1] * (1 - mt)]; } return offA(e.agent); };
      const H = this.hover, D = this.drag;
      const hotW = H && H.kind === "wire" ? H.id : null;
      const hotPair = hotW != null ? this.state.wires.find((w) => w.id === hotW) : null;
      const hotSt = hotPair ? this.status(hotPair) : null;
      const pairAgents = new Set(hotSt ? [hotPair.ends[0].agent, hotPair.ends[1].agent] : []);
      const altOn = !!(this.o.altMode && this.alt);
      const extW = new Set(this.ext && this.ext.wires || []);
      for (const id of extW) { const w = s.wires.find((x) => x.id === id); if (w) w.ends.forEach((e) => e.agent != null && pairAgents.add(e.agent)); }
      for (const id of this.ext && this.ext.agents || []) pairAgents.add(id);
      if (this.o.hoverRing && H && H.kind === "agent" && !D) pairAgents.add(H.id);
      const HK = this.o.hooks || {};
      const shapeOf = (a) => (HK.agent ? HK.agent(a, this.types[a.type], this) : agentShapeSVG(a, this.types[a.type]));
      const extSt = (() => { for (const id of extW) { const w = s.wires.find((x) => x.id === id); const st = w && this.status(w); if (st) return st; } return null; })();
      let out = "";

      // old wires and dying agents fade out during a step
      if (an) {
        const a1 = 1 - smooth(0, 0.35, T);
        if (a1 > 0.01) {
          out += `<g opacity="${a1.toFixed(3)}">`;
          for (const w of an.prev.wires) out += `<polyline class="nk-halo" points="${pts(w.path)}"/><polyline class="nk-wire" points="${pts(w.path)}"/>`;
          out += "</g>";
        }
        const a2 = 1 - smooth(0.05, 0.5, T);
        if (a2 > 0.01) { out += `<g opacity="${a2.toFixed(3)}">`; for (const a of an.dying) out += shapeOf(a); out += "</g>"; }
      }
      // wires
      const wa = an ? smooth(0.08, 0.4, T) : 1;
      out += `<g opacity="${wa.toFixed(3)}">`;
      for (const w of s.wires) {
        if (D && D.kind === "carry" && D.wire === w.id) continue;
        let p = w.path;
        if (an) { const o0 = offEnd(w.ends[0]), o1 = offEnd(w.ends[1]); const n = p.length - 1; if (o0[0] || o0[1] || o1[0] || o1[1]) p = p.map((q, i) => [q[0] + lerp(o0[0], o1[0], i / n), q[1] + lerp(o0[1], o1[1], i / n)]); }
        const st = an ? null : this.status(w);
        const P = pts(p);
        out += `<polyline class="nk-halo" points="${P}"/>`;
        const isHot = hotW === w.id || extW.has(w.id);
        if (st === "active") out += `<polyline class="nk-activeb${isHot ? " hot" : ""}${altOn ? " alt" : ""}" points="${P}"/>`;
        if (st === "stuck") out += `<polyline class="nk-stuckb${isHot ? " hot" : ""}" points="${P}"/>`;
        if (!st && extW.has(w.id)) out += `<polyline class="nk-wsel pre" points="${P}"/>`;
        if (this.sel.has("w:" + w.id)) out += `<polyline class="nk-wsel" points="${P}"/>`;
        else if (this.pre.has("w:" + w.id)) out += `<polyline class="nk-wsel pre" points="${P}"/>`;
        out += `<polyline class="nk-wire" points="${P}"/>`;
        if (HK.wire && !an) out += HK.wire(w, p, this, { active: st === "active", hot: isHot }) || "";
        if (!an) out += `<polyline class="nk-whit${st ? " act st-" + st : ""}" data-k="wire" data-id="${w.id}" points="${P}"/>`;
      }
      out += "</g>";

      // agents
      const pv = this.preview;
      const fadeIds = new Set(pv && pv.fade ? pv.fade : []);
      for (const a of s.agents) {
        const o = offA(a.id);
        let op = 1;
        if (an && an.newIds.has(a.id)) op = smooth(0.15, 0.55, T);
        if (fadeIds.has(a.id)) op = 0.3;
        out += `<g class="nk-agent" data-k="agent" data-id="${a.id}" transform="translate(${o[0].toFixed(2)},${o[1].toFixed(2)})" opacity="${op}">`;
        if (pairAgents.has(a.id)) { const stt = hotSt || extSt; out += ringSVG(a, "nk-pair-o" + (stt === "stuck" ? " stuck" : stt === "active" && altOn ? " alt" : !stt ? " plain" : "")); }
        const isSel = this.sel.has("a:" + a.id), isPre = this.pre.has("a:" + a.id);
        if (isSel || isPre) out += ringSVG(a, "nk-ring-o" + (isSel ? "" : " pre")) + ringSVG(a, "nk-ring-i");
        if (this._flash && this._flash.id === a.id) { const k = (performance.now() - this._flash.t0) / 500; out += `<g opacity="${(1 - k).toFixed(2)}">${ringSVG(a, "nk-ring-o")}</g>` + ringSVG(a, "nk-ring-i"); }
        out += shapeOf(a);
        out += "</g>";
      }

      // ports
      if (!an) {
        const used = new Set(); for (const w of s.wires) for (const e of w.ends) if (e.agent != null) used.add(e.agent + ":" + e.slot);
        for (const a of s.agents) a.ports.forEach((p, i) => {
          const key = a.id + ":" + i, wired = used.has(key);
          const carryingThis = D && D.kind === "carry" && D.from && D.from.agent === a.id && D.from.slot === i;
          const empty = !wired || carryingThis;
          let mark = "";
          if (D && (D.kind === "carry" || D.kind === "new")) {
            const isOrigin = D.from && D.from.agent === a.id && D.from.slot === i;
            const tg = D.target && D.target.kind === "port" && D.target.agent === a.id && D.target.slot === i ? D.target : null;
            const bad = !isOrigin && this._typeClash(D, { agent: a.id, slot: i });
            if (isOrigin) mark = `<circle cx="${p[0]}" cy="${p[1]}" r="4.2" class="nk-port-origin"/>`;
            else if (tg) mark = tg.ok ? `<circle cx="${p[0]}" cy="${p[1]}" r="6.5" class="nk-port-target"/>` : `<circle cx="${p[0]}" cy="${p[1]}" r="6" class="nk-port-refuse"/><line x1="${p[0] - 3.4}" y1="${p[1] + 3.4}" x2="${p[0] + 3.4}" y2="${p[1] - 3.4}" class="nk-port-refuse"/>`;
            else if (bad) mark = `<circle cx="${p[0]}" cy="${p[1]}" r="4.6" class="nk-port-bad"/><line x1="${p[0] - 2.4}" y1="${p[1] + 2.4}" x2="${p[0] + 2.4}" y2="${p[1] - 2.4}" class="nk-port-badx"/>`;
            else if (empty) mark = `<circle cx="${p[0]}" cy="${p[1]}" r="5" class="nk-port-cand"/>`;
          }
          const isBad = D && (D.kind === "carry" || D.kind === "new") && this._typeClash(D, { agent: a.id, slot: i });
          if (empty && !isBad && !(D && D.from && D.from.agent === a.id && D.from.slot === i)) mark = `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" class="nk-port-empty"/>` + mark;
          if (!D && H && H.kind === "port" && H.agent === a.id && H.slot === i) mark += `<circle cx="${p[0]}" cy="${p[1]}" r="5.2" class="nk-port-hover"/>`;
          if (HK.port) {
            const dragging = !!(D && (D.kind === "carry" || D.kind === "new"));
            const isOrigin = !!(dragging && D.from && D.from.agent === a.id && D.from.slot === i);
            const tg = dragging && D.target && D.target.kind === "port" && D.target.agent === a.id && D.target.slot === i ? D.target : null;
            const r = HK.port({ a, i, p, wired, empty, dragging, isOrigin, target: tg, bad: dragging && !isOrigin ? this._typeClash(D, { agent: a.id, slot: i }) : null, hover: !D && H && H.kind === "port" && H.agent === a.id && H.slot === i, carryingThis, view: this, def: mark });
            if (r != null) mark = r;
          }
          out += mark + `<circle cx="${p[0]}" cy="${p[1]}" r="6.5" class="nk-port-hit" data-k="port" data-agent="${a.id}" data-slot="${i}"/>`;
        });
      }
      // free ports (loose ends)
      for (const f of s.free) {
        const o = an ? offEnd({ free: f.name }) : [0, 0];
        const x = f.x + o[0], y = f.y + o[1], ly = f.dir === "up" ? y - 9 : y + 10;
        const isT = D && D.target && D.target.kind === "free" && D.target.name === f.name;
        const fh = HK.free ? HK.free(f, x, y, this, { target: isT ? D.target : null, dragging: !!(D && (D.kind === "carry" || D.kind === "new")), hover: !D && H && H.kind === "free" && H.name === f.name }) : null;
        out += fh != null ? fh : `<circle cx="${x}" cy="${y}" r="2.4" class="nk-free"/><text x="${x}" y="${ly}" class="nk-free-label">${esc(f.name)}</text>`;
        if (D && (D.kind === "carry" || D.kind === "new") && !(D.carryFree === f.name) && !(fh != null && HK.freeOwnsDrag && !isT)) out += `<circle cx="${x}" cy="${y}" r="${isT ? 6.5 : 5}" class="${isT ? (D.target.ok ? "nk-port-target" : "nk-port-refuse") : "nk-port-cand"}"/>`;
        if (!D && H && H.kind === "free" && H.name === f.name) out += `<circle cx="${x}" cy="${y}" r="5.2" class="nk-port-hover"/>`;
        if (!an) out += `<circle cx="${x}" cy="${y}" r="7" class="nk-free-hit" data-k="free" data-name="${esc(f.name)}"/>`;
      }

      // overlays
      if (D && (D.kind === "carry" || D.kind === "new")) {
        const tp = D.target && D.target.ok ? D.target.pos : D.cur;
        const td = D.target && D.target.ok ? D.target.dir : [0, 0];
        const path = curve(D.anchor, D.anchorDir, tp, td);
        const P = pts(path);
        out += `<polyline class="nk-wire ${D.kind === "new" ? "newwire" : "carried"}" points="${P}" style="pointer-events:none"/>`;
        if (HK.drag) out += HK.drag(D, path, this) || "";
        if (D.kind === "carry" && D.carryFree == null) out += `<circle cx="${D.cur[0]}" cy="${D.cur[1]}" r="2.2" class="nk-free" style="pointer-events:none"/>`;
        if (D.target) {
          const tx = D.target.pos[0] + 10 / z, ty = D.target.pos[1] - 10 / z;
          out += `<text x="${tx}" y="${ty}" class="nk-dragnote${D.target.ok ? "" : " bad"}" font-size="${(11 / z).toFixed(2)}" style="font-size:${(11 / z).toFixed(2)}px">${esc(D.target.note)}</text>`;
        } else if (D.moved) {
          out += `<text x="${D.cur[0] + 10 / z}" y="${D.cur[1] - 10 / z}" class="nk-dragnote" style="font-size:${(11 / z).toFixed(2)}px;fill:var(--muted)">${D.kind === "new" ? "Let go here for a loose end" : "Let go here to leave it loose"}</text>`;
        }
      }
      if (pv && !an) out += this._previewSVG(pv);
      if (HK.overlay && !an) out += HK.overlay(this) || "";
      if (hotSt && this.o.firePill && !D && !an) {
        const p0 = this.endPos(hotPair.ends[0]), p1 = this.endPos(hotPair.ends[1]);
        const bx = Math.max(p0[0], p1[0]) + 18 / z, by = (p0[1] + p1[1]) / 2;
        const sel = hotSt === "active" && altOn;
        const label = hotSt === "active" ? (sel ? (this.o.selectLabel || "Click to select the wire") : (this.o.fireLabel || "Click to fire")) : (this.o.stuckLabel || "Stuck: no rule");
        const w = (label.length * 5.6 + 16) / z, h = 18 / z;
        const fill = sel ? "var(--accent)" : hotSt === "active" ? "var(--active)" : "var(--stuck)";
        out += `<g class="nk-firepill"><rect x="${bx}" y="${by - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/><text x="${bx + w / 2}" y="${by}" text-anchor="middle" dominant-baseline="central" fill="var(--on-active,#000)" style="font-size:${(10 / z).toFixed(2)}px;${hotSt === "stuck" || sel ? "fill:#fff" : ""}">${label}</text></g>`;
      }
      this.world.innerHTML = out;
    }

    _previewSVG(pv) {
      let s = "";
      for (const id of pv.wires || []) {
        const w = this.state.wires.find((w) => w.id === id); if (!w || this.status(w) !== "active") continue;
        const info = this.pairInfo(w);
        const A = info.effect.swap ? info.b : info.a, B = info.effect.swap ? info.a : info.b;
        const ag = { A, B };
        if (info.effect.create && !pv.ghost && !pv.marks) continue;
        for (const x of [info.a, info.b]) { const c = agentBox(x); const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, r = 4; s += `<line x1="${cx - r}" y1="${cy - r}" x2="${cx + r}" y2="${cy + r}" class="nk-pv-x"/><line x1="${cx - r}" y1="${cy + r}" x2="${cx + r}" y2="${cy - r}" class="nk-pv-x"/>`; }
        if (info.effect.rewire) {
          const pa = this.endPos(w.ends[0]), pb = this.endPos(w.ends[1]); const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
          for (const [[sa, ia], [sb, ib]] of info.effect.rewire) {
            const p = ag[sa].ports[ia], q = ag[sb].ports[ib];
            const path = curve(p, [ (mid[0] - p[0]) * 0.02, (mid[1] - p[1]) * 0.02 ], q, [ (mid[0] - q[0]) * 0.02, (mid[1] - q[1]) * 0.02 ]);
            s += `<polyline class="nk-pv-wire" points="${pts(path)}"/>`;
          }
        }
        if (pv.ghost && !pv.all && info.effect.create) {
          const near = new Set(pv.ghostIds || []);
          s += `<g class="nk-ghost" opacity=".8">`;
          for (const gw of pv.ghost.wires) if (gw.ends.some((e) => near.has(e.agent))) s += `<polyline class="nk-wire" points="${pts(gw.path)}"/>`;
          for (const a of pv.ghost.agents) if (near.has(a.id)) s += agentShapeSVG(a, this.types[a.type]);
          s += "</g>";
        }
      }
      if (pv.ghost && pv.all) {
        let g = `<g class="nk-ghost" opacity="${pv.opacity || 0.55}">`;
        for (const gw of pv.ghost.wires) g += `<polyline class="nk-wire" points="${pts(gw.path)}"/>`;
        for (const a of pv.ghost.agents) g += agentShapeSVG(a, this.types[a.type]);
        s = g + "</g>" + s;
      }
      return s;
    }

    /* ---------- tooltip */
    setHighlight(h) { this.ext = h; this.render(); }
    changeType(ids, typeId) {
      const t = this.types[typeId]; if (!t) return;
      const moved = new Set();
      for (const id of ids) {
        const a = this.agent(id); if (!a) continue;
        const b = makeAgent(t, a.id, a.x, a.y, a.orient);
        if (JSON.stringify(b.ports) !== JSON.stringify(a.ports)) moved.add(a.id);
        Object.assign(a, b);
      }
      this._recurveAround(moved); this.render(); this.emit("change", "Change type to " + t.symbol);
    }
    _showTip(html, cx, cy, cls = "") {
      if (this.o.tips === false) return;
      const r = this.host.getBoundingClientRect();
      this.tip.className = "nk-tip on " + cls; this.tip.innerHTML = html;
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let x = cx - r.left + 16, y = cy - r.top + 18;
      if (x + tw > r.width - 8) x = cx - r.left - tw - 12;
      if (y + th > r.height - 8) y = cy - r.top - th - 12;
      this.tip.style.left = x + "px"; this.tip.style.top = y + "px";
    }
    _hideTip() { this.tip.className = "nk-tip"; clearTimeout(this._tipT); }
    _tipLater(html, e, cls) { clearTimeout(this._tipT); const { clientX, clientY } = e; this._tipT = setTimeout(() => this._showTip(html, clientX, clientY, cls), 380); }

    describe(t) {
      const tip = (h, b) => `<div class="tip-h">${h}</div>${b ? `<div class="tip-b">${b}</div>` : ""}`;
      if (!t) return null;
      if (t.kind === "port") {
        const a = this.agent(t.agent), ty = this.types[a.type] || {};
        const w = this.wireAt(t.agent, t.slot);
        const which = t.slot === 0 ? `Principal port of ${esc(ty.symbol || a.type)}` : `Aux port ${t.slot} of ${esc(ty.symbol || a.type)}`;
        const pol = this.polarity(t); const polS = pol ? ` (${pol === "in" ? "input" : "output"}, Nat)` : "";
        const why = t.slot === 0 ? "Agents interact only through their principal port." : "";
        return { html: tip(which + polS, (w ? "Drag to unplug this end and move it." : "Empty. Drag from here to draw a wire.") + (why ? " " + why : "")), hint: w ? "Drag: unplug this wire end and carry it" : "Drag: draw a new wire from this port" };
      }
      if (t.kind === "free") return { html: tip(`Free port ${esc(t.name)}`, "A loose end: the net's connection to the outside. Drag it to plug it into an empty port."), hint: "Drag: move this loose end or plug it in" };
      if (t.kind === "agent") { const a = this.agent(t.id), ty = this.types[a.type] || {}; return { html: tip(`${esc(ty.symbol || a.type)} <span class="tip-dim">${esc(ty.name || "")}</span>`, ty.component ? "A component instance. It dissolves as soon as anything inside it interacts." : `Its principal port is the ${ty.circle ? "port on the edge" : "tip of the triangle"}.`), hint: "Click: select. Drag: move. Shift-click: add to selection" }; }
      if (t.kind === "wire") {
        const w = this.state.wires.find((w) => w.id === t.id); if (!w) return null;
        const st = this.status(w); const key = this.o.selectWireKey === "alt" ? "Alt" : "Shift";
        if (st === "active") { const i = this.pairInfo(w); return { html: tip(`${esc(i.ta.symbol)} meets ${esc(i.tb.symbol)}: an active pair`, `Their principal ports touch, so their rule can fire. ${key}-click to select the wire instead.`), cls: "fire", hint: `Click: fire ${i.ta.symbol} with ${i.tb.symbol}.  ${key}-click: select this wire` , cls: "fire" }; }
        if (st === "stuck") { const i = this.pairInfo(w); return { html: tip(`Stuck: no rule for ${esc(i.ta.symbol)} and ${esc(i.tb.symbol)}`, `Their principal ports touch, but no rule says what happens. Click to write one.`), hint: `Click: write a rule for ${i.ta.symbol} with ${i.tb.symbol}`, cls: "stuck" }; }
        return { html: tip("Wire", "Click to select it. Press Delete to remove it."), hint: "Click: select this wire. Drag a wire end to rewire it" };
      }
      return null;
    }

    /* ---------- gestures */
    _typeClash(D, end) {
      if (this.o.typing) return this.o.typing.clash(this, D, end);
      // The anchor end (where the wire stays attached) decides what fits:
      // a wire joins an output to an input. Joining a loose end means meeting
      // whatever sits at that wire's far end.
      if (!this.typed || !D.originEnd) return false;
      const a = this.polarity(D.originEnd);
      let b;
      if (end.free != null) { const v = this.wireOfFree(end.free); const g = v && v.ends.find((e) => e.free !== end.free); b = g ? (g.free != null ? null : this.polarity(g)) : null; return !!(a && b && a === b); }
      b = this.polarity(end);
      return !!(a && b && a === b);
    }
    _nearestTarget(wx, wy) {
      const R = 13 / this.cam.z; let best = null, bd = R;
      for (const a of this.state.agents) a.ports.forEach((p, i) => { const d = Math.hypot(p[0] - wx, p[1] - wy); if (d < bd) { bd = d; best = { kind: "port", agent: a.id, slot: i, pos: p, dir: portDir(a, i) }; } });
      for (const f of this.state.free) { const d = Math.hypot(f.x - wx, f.y - wy); if (d < bd) { bd = d; best = { kind: "free", name: f.name, pos: [f.x, f.y], dir: f.dir === "up" ? [0, 1] : [0, -1] }; } }
      return best;
    }
    _judge(D, t) {
      if (!t) return null;
            if (t.kind === "port") {
        if (D.from && D.from.agent === t.agent && D.from.slot === t.slot) return D.kind === "carry" ? { ...t, ok: true, note: "Put it back", back: true } : null;
        const w = this.wireAt(t.agent, t.slot);
        { const c = this._typeClash(D, t); if (c && !(w && D.kind === "carry" && w.id === D.wire)) { const pol = this.polarity(D.originEnd); return { ...t, ok: false, note: c.note || "Doesn't fit", why: c.why || `This wire comes from a Nat ${pol === "out" ? "output" : "input"}, and this port is ${pol === "out" ? "an output" : "an input"} too. A wire has to join an output to an input of the same type.`, typed: true }; } }
        if (w && !(D.kind === "carry" && w.id === D.wire)) return { ...t, ok: false, note: "Already has a wire", why: "Each port takes exactly one wire. Unplug the wire that's there first, or pick an empty port." };
        if (w && D.kind === "carry" && w.id === D.wire) return { ...t, ok: false, note: "Same wire", why: "That's the other end of this same wire." };
        if (this._typeClash(D, t)) { const pol = this.polarity(D.originEnd); return { ...t, ok: false, note: "Doesn't fit", why: `This wire starts at a Nat ${pol === "out" ? "output" : "input"}, and this port is ${pol === "out" ? "an output" : "an input"} too. A wire has to join an output to an input of the same type.`, typed: true }; }
        return { ...t, ok: true, note: "Connect" };
      }
      if (t.kind === "free") {
        if (D.carryFree === t.name) return null;
        const v = this.wireOfFree(t.name);
        if (D.kind === "carry" && v && v.id === D.wire) return { ...t, ok: false, note: "Same wire", why: "That's the other end of this same wire. Joining them would leave a loop with no ports." };
        { const c = this._typeClash(D, { free: t.name }); if (c) return { ...t, ok: false, note: c.note || "Doesn't fit", why: c.why || "Both ends would be the same direction. A wire has to join an output to an input.", typed: true }; }
        return { ...t, ok: true, note: "Join to this loose end" };
      }
      return null;
    }
    _bind() {
      const h = this.host;
      h.addEventListener("contextmenu", (e) => e.preventDefault());
      h.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = h.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
        if (e.ctrlKey || e.metaKey) { this.zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy); return; }
        const mouse = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
        if (mouse) this.zoomAt(Math.exp(-e.deltaY * 0.0018), sx, sy);
        else { this.cam.x -= e.deltaX; this.cam.y -= e.deltaY; this.render(); this.emit("camera", this.cam); }
      }, { passive: false });
      h.addEventListener("pointerdown", (e) => this._down(e));
      h.addEventListener("pointermove", (e) => this._move(e));
      h.addEventListener("pointerup", (e) => this._up(e));
      h.addEventListener("pointercancel", (e) => this._up(e));
      h.addEventListener("pointerleave", () => { if (!this.drag) { this.hover = null; this._hideTip(); this.emit("hover", null); this._setPreviewHover(null); this.render(); } });
    }
    _targetOf(e) {
      const el = e.target.closest && e.target.closest("[data-k]"); if (!el) return null;
      const k = el.dataset.k;
      if (k === "port") return { kind: "port", agent: +el.dataset.agent, slot: +el.dataset.slot };
      if (k === "agent") return { kind: "agent", id: +el.dataset.id };
      if (k === "wire") return { kind: "wire", id: +el.dataset.id };
      if (k === "free") return { kind: "free", name: el.dataset.name };
      return null;
    }
    _down(e) {
      if (this.anim) this.finishAnim();
      this._hideTip();
      const [wx, wy] = this.toWorld(e.clientX, e.clientY);
      h_capture(this.host, e);
      if (e.button === 1 || e.button === 2) { this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y }; this.host.classList.add("pan"); return; }
      if (e.button !== 0) return;
      const t = this._targetOf(e);
      const base = { sx: e.clientX, sy: e.clientY, moved: false, cur: [wx, wy], shift: e.shiftKey, alt: e.altKey };
      if (t && t.kind === "port") {
        const w = this.wireAt(t.agent, t.slot);
        const a = this.agent(t.agent);
        if (w) {
          const k = w.ends.findIndex((x) => x.agent === t.agent && x.slot === t.slot);
          const fixed = w.ends[1 - k];
          this.drag = { ...base, kind: "carry", wire: w.id, k, from: t, originEnd: fixed, anchor: this.endPos(fixed), anchorDir: this.endDir(fixed) };
        } else {
          this.drag = { ...base, kind: "new", from: t, originEnd: t, anchor: a.ports[t.slot], anchorDir: portDir(a, t.slot) };
        }
        return;
      }
      if (t && t.kind === "free") {
        const w = this.wireOfFree(t.name);
        if (w) { const k = w.ends.findIndex((x) => x.free === t.name); const fixed = w.ends[1 - k]; this.drag = { ...base, kind: "carry", wire: w.id, k, carryFree: t.name, originEnd: fixed, anchor: this.endPos(fixed), anchorDir: this.endDir(fixed) }; }
        return;
      }
      if (t && t.kind === "agent") {
        const key = "a:" + t.id;
        if (e.shiftKey) { this.sel.has(key) ? this.sel.delete(key) : this.sel.add(key); this.emit("select", this.selection()); }
        else if (!this.sel.has(key)) { this.sel = new Set([key]); this.emit("select", this.selection()); }
        const ids = new Set(this.selection().agents);
        this.drag = { ...base, kind: "move", ids, orig: clone(this.state.agents.filter((a) => ids.has(a.id))), origW: clone(this.state.wires), w0: [wx, wy] };
        this.render(); return;
      }
      if (t && t.kind === "wire") { this.drag = { ...base, kind: "wireclick", id: t.id }; return; }
      this.drag = { ...base, kind: "marquee", w0: [wx, wy], keep: e.shiftKey ? new Set(this.sel) : new Set() };
    }
    _move(e) {
      const [wx, wy] = this.toWorld(e.clientX, e.clientY);
      const D = this.drag;
      if (!D) return this._hover(e);
      const dist = Math.hypot(e.clientX - D.sx, e.clientY - D.sy);
      if (D.kind === "pan") { this.cam.x = D.cx + e.clientX - D.sx; this.cam.y = D.cy + e.clientY - D.sy; this.render(); this.emit("camera", this.cam); return; }
      if (!D.moved && dist < 4) return;
      if (!D.moved) this.emit("dragstate", D.kind);
      D.moved = true; D.cur = [wx, wy];
      if (D.kind === "wireclick") { this.drag = { ...D, kind: "marquee", w0: this.toWorld(D.sx, D.sy), keep: D.shift ? new Set(this.sel) : new Set() }; return this._move(e); }
      if (D.kind === "carry" || D.kind === "new") {
        const raw = this._nearestTarget(wx, wy);
        D.target = this._judge(D, raw);
        if (D.target && !D.target.ok && D.target.why) this._showTip(`<div class="tip-h">${D.target.typed ? "These ports don't fit" : "Can't connect here"}</div><div class="tip-b">${D.target.why}</div>`, e.clientX, e.clientY, D.target.typed ? "typed" : "refuse");
        else this._hideTip();
        this.emit("hover", { drag: D.kind, target: D.target, hint: D.target ? (D.target.ok ? "Let go: " + D.target.note.toLowerCase() : D.target.why) : (D.kind === "new" ? "Drawing a wire. Let go on an empty port to connect, or on the canvas for a loose end" : "Carrying a wire end. Let go on an empty port to plug it in, or on the canvas to leave it loose") });
        this.render(); return;
      }
      if (D.kind === "move") {
        const dx = wx - D.w0[0], dy = wy - D.w0[1];
        this._applyMove(D, dx, dy); this.render(); return;
      }
      if (D.kind === "marquee") {
        const x0 = Math.min(D.w0[0], wx), y0 = Math.min(D.w0[1], wy), x1 = Math.max(D.w0[0], wx), y1 = Math.max(D.w0[1], wy);
        const [sx0, sy0] = this.toScreen(x0, y0), [sx1, sy1] = this.toScreen(x1, y1);
        Object.assign(this.marq.style, { display: "" });
        this.marq.setAttribute("x", sx0); this.marq.setAttribute("y", sy0); this.marq.setAttribute("width", sx1 - sx0); this.marq.setAttribute("height", sy1 - sy0);
        this.pre = new Set();
        for (const a of this.state.agents) { const b = agentBox(a); if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && !D.keep.has("a:" + a.id)) this.pre.add("a:" + a.id); }
        for (const w of this.state.wires) if (w.path.every((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) && !D.keep.has("w:" + w.id)) this.pre.add("w:" + w.id);
        this.sel = new Set(D.keep);
        const na = [...this.pre].filter((k) => k[0] === "a").length, nw = this.pre.size - na;
        this.emit("hover", { marquee: true, hint: `Let go to select ${na} agent${na === 1 ? "" : "s"}${nw ? ` and ${nw} wire${nw === 1 ? "" : "s"}` : ""}` });
        this.render();
      }
    }
    _applyMove(D, dx, dy) {
      const ids = D.ids;
      this.state.agents = this.state.agents.map((a) => { if (!ids.has(a.id)) return a; const o = D.orig.find((x) => x.id === a.id); return translateAgent(o, dx, dy); });
      for (const w of this.state.wires) {
        const ow = D.origW.find((x) => x.id === w.id); if (!ow) continue;
        const m0 = ids.has(w.ends[0].agent), m1 = ids.has(w.ends[1].agent);
        if (m0 && m1) w.path = ow.path.map((p) => [p[0] + dx, p[1] + dy]);
        else if (m0 || m1) this._curveWire(w);
        else w.path = ow.path;
      }
    }
    _up(e) {
      const D = this.drag; this.drag = null; this.host.classList.remove("pan");
      if (!D) return;
      if (D.moved) setTimeout(() => this.emit("dragstate", null), 0);
      if (D.kind === "pan") return;
      if (D.kind === "wireclick") {
        const w = this.state.wires.find((w) => w.id === D.id); if (!w) return;
        const st = this.status(w);
        const selKey = this.o.selectWireKey === "alt" ? D.alt : D.shift;
        if (st && !selKey) { this._hideTip(); if (st === "active") this.emit("fire", w); else this.emit("stuck", w, this.pairInfo(w)); return; }
        const key = "w:" + w.id;
        if (D.shift && !(st && this.o.selectWireKey === "shift")) { this.sel.has(key) ? this.sel.delete(key) : this.sel.add(key); } else this.sel = new Set([key]);
        this.render(); this.emit("select", this.selection()); return;
      }
      if (D.kind === "marquee") {
        this.marq.style.display = "none";
        if (!D.moved) { if (this.sel.size) { this.sel.clear(); this.emit("select", this.selection()); } this.render(); return; }
        this.sel = new Set([...D.keep, ...this.pre]); this.pre = new Set();
        this.render(); this.emit("select", this.selection()); this.emit("hover", null); return;
      }
      if (D.kind === "move") {
        if (!D.moved) { if (!D.shift) { this.sel = new Set(["a:" + [...D.ids].find(() => true)]); const t = this._targetOf(e); if (t && t.kind === "agent") this.sel = new Set(["a:" + t.id]); this.render(); this.emit("select", this.selection()); } return; }
        if (this.layout === "auto") {
          const dx = D.cur[0] - D.w0[0], dy = D.cur[1] - D.w0[1], t0 = performance.now();
          this.emit("hint", { text: "Auto layout puts agents back where it wants them. Switch to manual layout to place them yourself.", kind: "layout" });
          const tick = (now) => { const t = ease(clamp((now - t0) / 380, 0, 1)); this._applyMove(D, dx * (1 - t), dy * (1 - t)); if (t >= 1) { this.state.wires.forEach((w) => { const ow = D.origW.find((x) => x.id === w.id); if (ow) w.path = ow.path; }); } this.render(); if (t < 1) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        } else this.emit("change", "Move");
        return;
      }
      if (D.kind === "carry" || D.kind === "new") {
        this._hideTip(); this.emit("hover", null);
        if (!D.moved) { this.render(); return; }
        const t = D.target;
        if (t && !t.ok) { this.render(); this.emit("hint", { text: t.why, kind: "refuse" }); return; }
        if (t && t.back) { this.render(); return; }
        this._commitWire(D, t);
        return;
      }
    }
    _commitWire(D, t) {
      const s = this.state;
      const endFor = (t) => (t.kind === "port" ? { agent: t.agent, slot: t.slot } : { free: t.name });
      let label = "Rewire";
      if (D.kind === "new") {
        const a = { agent: D.from.agent, slot: D.from.slot };
        if (!t) { const name = this.newFreeName(); s.free.push({ name, x: D.cur[0], y: D.cur[1], dir: D.cur[1] < D.anchor[1] ? "up" : "down" }); s.wires.push({ id: this.nid++, ends: [a, { free: name }], path: [] }); this._curveWire(s.wires[s.wires.length - 1]); label = "Add loose end"; this._afterLoose(name); }
        else if (t.kind === "port") { const w = { id: this.nid++, ends: [a, endFor(t)], path: [] }; s.wires.push(w); this._curveWire(w); label = "Connect"; }
        else { const v = this.wireOfFree(t.name); const k = v.ends.findIndex((e) => e.free === t.name); v.ends[k] = a; s.free = s.free.filter((f) => f.name !== t.name); this._curveWire(v); label = "Join loose end"; }
      } else {
        const w = s.wires.find((w) => w.id === D.wire); const k = D.k;
        const oldFree = D.carryFree;
        if (!t) {
          if (oldFree) { const f = s.free.find((f) => f.name === oldFree); f.x = D.cur[0]; f.y = D.cur[1]; this._curveWire(w); this._afterLoose(oldFree); label = "Move loose end"; }
          else { const name = this.newFreeName(); s.free.push({ name, x: D.cur[0], y: D.cur[1], dir: D.cur[1] < D.anchor[1] ? "up" : "down" }); w.ends[k] = { free: name }; this._curveWire(w); this._afterLoose(name); label = "Unplug"; }
        } else if (t.kind === "port") { w.ends[k] = endFor(t); if (oldFree) s.free = s.free.filter((f) => f.name !== oldFree); this._curveWire(w); label = "Plug in"; }
        else {
          const v = this.wireOfFree(t.name); const kv = v.ends.findIndex((e) => e.free === t.name);
          w.ends[k] = v.ends[1 - kv];
          s.wires = s.wires.filter((x) => x !== v);
          s.free = s.free.filter((f) => f.name !== t.name && f.name !== oldFree);
          this._curveWire(w); label = "Join wires";
        }
      }
      this.render(); this.emit("change", label);
    }
    _afterLoose(name) {
      const f = this.state.free.find((f) => f.name === name);
      if (this.layout !== "auto") { this.emit("hint", { text: "That end is now loose: a free port, the net's connection to the outside.", kind: "free" }); return; }
      const b = stateBounds({ ...this.state, free: this.state.free.filter((x) => x !== f), wires: [] });
      const top = Math.abs(f.y - b.y0) < Math.abs(f.y - b.y1);
      const ty = top ? b.y0 - G.freeMargin : b.y1 + G.freeMargin;
      const fy = f.y, fx = f.x, t0 = performance.now();
      f.dir = top ? "up" : "down";
      const w = this.wireOfFree(name);
      const tick = (now) => { const t = ease(clamp((now - t0) / 450, 0, 1)); f.y = lerp(fy, ty, t); f.x = fx; if (w) this._curveWire(w); this.render(); if (t < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      this.emit("hint", { text: "That end is now loose: a free port, the net's connection to the outside. Auto layout moves free ports to the top or bottom edge.", kind: "free" });
    }
    _hover(e) {
      if (this.anim) return;
      const t = this._targetOf(e);
      const same = JSON.stringify(t) === JSON.stringify(this.hover);
      if (same) return;
      this.hover = t; this._hideTip();
      const d = this.describe(t);
      if (d) { if (!this.o.firePill && t.kind === "wire" && this.status(this.state.wires.find((w) => w.id === t.id))) this._showTip(d.html, e.clientX, e.clientY, d.cls || "fire"); else this._tipLater(d.html, e, d.cls); }
      this.emit("hover", t ? { target: t, hint: d && d.hint } : null);
      this._setPreviewHover(t);
      this.render();
    }
    _setPreviewHover(t) {
      if (!this.o.previewOnHover) return;
      if (t && t.kind === "wire") { const w = this.state.wires.find((w) => w.id === t.id); if (w && this.status(w) === "active") { this.emit("previewpair", w); return; } }
      if (this.preview && this.preview.fromHover) { this.preview = null; this.emit("previewpair", null); }
    }
  }
  function h_capture(host, e) { try { host.setPointerCapture(e.pointerId); } catch (_) {} }


  /* ------------------------------------------------------- session (mock engine) */
  const COMPONENTS = {
    comb: [{ id: "c:copies", name: "two copies", arity: 2, component: true, def: ["Commutation", 1] }],
    arith: [{ id: "c:two", name: "two", arity: 0, component: true, def: ["3 + 2", 4] }],
  };
  class Session {
    constructor(data, view) {
      this.data = data; this.view = view; this.listeners = {};
      this.undoStack = []; this.redoStack = []; this.running = false; this.speed = 1;
      view.on("change", (label) => { this.dirty = true; if (this.stats) this.stats.maxAgents = Math.max(this.stats.maxAgents, view.state.agents.length); this._push(label); });
    }
    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
    emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }
    get ex() { return this.data.examples[this.exIndex]; }
    load(i, o = {}) {
      this.stop();
      const first = this.exIndex == null;
      const prevName = first ? null : this.ex.name;
      this.exIndex = i; this.stepIndex = 0; this.dirty = false;
      const ex = this.ex;
      this.types = clone(ex.types); this.rules = clone(ex.rules); this.sys = clone(ex.sys || null);
      this.components = clone(COMPONENTS[ex.family]);
      this.stats = { steps: 0, interactions: 0, perRule: {}, maxAgents: ex.states[0].agents.length, history: [] };
      this._ctx();
      this.view.setLayout(this.layout || "auto");
      this.view.setState(ex.states[0], { fit: true });
      this._push(first ? null : "Load " + ex.name, true);
      this.emit("load", { ex, replaced: prevName });
      this.emit("update");
    }
    _ctx() { this.view.setContext({ types: [...this.types, ...this.components], rules: this.rules, typed: !!this.ex.typed }); }
    snapshot() { return clone({ exIndex: this.exIndex, stepIndex: this.stepIndex, state: this.view.state, types: this.types, rules: this.rules, components: this.components, stats: this.stats, dirty: this.dirty, sys: this.sys || null }); }
    restore(sn) {
      this.stop();
      Object.assign(this, clone({ exIndex: sn.exIndex, stepIndex: sn.stepIndex, types: sn.types, rules: sn.rules, components: sn.components, stats: sn.stats, dirty: sn.dirty, sys: sn.sys || null }));
      this._ctx(); this.view.setState(sn.state); this.emit("update");
    }
    _push(label, reset) {
      const sn = this.snapshot(); sn.label = label;
      if (reset && !label) this.undoStack = [];
      this.undoStack.push(sn); this.redoStack = [];
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.emit("update");
    }
    canUndo() { return this.undoStack.length > 1; }
    canRedo() { return this.redoStack.length > 0; }
    undoLabel() { return this.canUndo() ? this.undoStack[this.undoStack.length - 1].label : null; }
    redoLabel() { return this.canRedo() ? this.redoStack[this.redoStack.length - 1].label : null; }
    undo() { if (!this.canUndo()) return; const cur = this.undoStack.pop(); this.redoStack.push(cur); this.restore(this.undoStack[this.undoStack.length - 1]); this.emit("undo", cur.label); }
    redo() { if (!this.canRedo()) return; const sn = this.redoStack.pop(); this.undoStack.push(sn); this.restore(sn); this.emit("redo", sn.label); }

    hasNext() { return this.stepIndex < this.ex.states.length - 1; }
    canStep() { return this.view.activePairs().length > 0; }
    stepMs() { return 650 / this.speed; }
    // Fire: the mock only knows each example's recorded parallel steps, so one
    // step and step-all both advance to the next recorded state.
    nextState() {
      if (!this.hasNext()) return null;
      const user = this._userPart();
      const next = clone(this.ex.states[this.stepIndex + 1]);
      next.agents.push(...user.agents); next.wires.push(...user.wires); next.free.push(...user.free);
      return next;
    }
    firedKeys() { return this.view.activePairs().filter((w) => w.ends.every((e) => e.agent < 1000)).map((w) => this.view.pairInfo(w).key); }
    canFire() {
      const pairs = this.view.activePairs();
      if (!pairs.length) { this.emit("message", this.view.stuckPairs().length ? "Nothing can fire. The pairs left are stuck: they have no rule." : "Nothing left to fire. The net is in normal form."); return false; }
      if (!this.hasNext()) { this.emit("message", "This prototype only replays the examples' recorded steps, so it can't compute this one."); return false; }
      return true;
    }
    // Fire: the mock only knows each example's recorded parallel steps, so one
    // step and step-all both advance to the next recorded state.
    async step(o = {}) {
      if (this.busy || !this.canFire()) return false;
      const fired = this.firedKeys(), next = this.nextState();
      this.busy = true; this.emit("stepstart", { fired, from: this.stepIndex });
      await this.view.transitionTo(next, o.ms || this.stepMs());
      this.busy = false;
      if (this.autoFit !== false && this.view.outOfView()) this.view.fit(true);
      this._afterStep(fired, next);
      return true;
    }
    // used by a scrubber that already showed the transition
    commitStep(fired, next) { this.view.setState(next); this._afterStep(fired, next); if (this.autoFit !== false && this.view.outOfView()) this.view.fit(true); }
    _afterStep(fired, next) {
      this.stepIndex++;
      this.stats.steps++; this.stats.interactions += fired.length;
      for (const k of fired) this.stats.perRule[k] = (this.stats.perRule[k] || 0) + 1;
      this.stats.maxAgents = Math.max(this.stats.maxAgents, next.agents.length);
      this.stats.history.push({ step: this.stepIndex, fired, agents: next.agents.length });
      this._push("Step " + this.stepIndex);
      this.emit("stepped", { fired }); this.emit("update");
    }
    _userPart() {
      const st = this.view.state;
      const agents = st.agents.filter((a) => a.id >= 1000);
      const ids = new Set(agents.map((a) => a.id));
      const wires = st.wires.filter((w) => w.ends.every((e) => (e.agent != null ? ids.has(e.agent) : true)) && w.ends.some((e) => ids.has(e.agent)));
      const fn = new Set(wires.flatMap((w) => w.ends.filter((e) => e.free != null).map((e) => e.free)));
      const free = st.free.filter((f) => fn.has(f.name));
      return clone({ agents, wires, free });
    }
    async run() {
      if (this.running) return; this.running = true; this.emit("update");
      while (this.running) {
        const ok = await this.step();
        if (!ok) break;
        await new Promise((r) => setTimeout(r, 120 / this.speed));
      }
      this.running = false; this.emit("update");
    }
    stop() { this.running = false; this.emit("update"); }
    setSpeed(v) { this.speed = v; if (this.view.anim && !this.view.anim.scrub) { const a = this.view.anim; const now = performance.now(); const t = a.t; a.ms = 650 / v; a.t0 = now - t * a.ms; } this.emit("update"); }
    setLayout(m) { this.layout = m; this.view.setLayout(m); this.emit("update"); }
    tidy() {
      // mock: restore recorded positions for agents the layout knows about
      const rec = this.ex.states[this.stepIndex]; const st = this.view.state;
      const recA = new Map(rec.agents.map((a) => [a.id, a]));
      st.agents = st.agents.map((a) => (recA.has(a.id) ? clone(recA.get(a.id)) : a));
      const recW = new Map(rec.wires.map((w) => [w.id, w]));
      for (const w of st.wires) { const r = recW.get(w.id); if (r && JSON.stringify(r.ends) === JSON.stringify(w.ends)) w.path = clone(r.path); else this.view._curveWire(w); }
      this.view.render(); this.view.emit("change", "Tidy");
    }
    clear() { this.stop(); this.view.setState({ agents: [], wires: [], free: [] }); this.view.emit("change", "Clear net"); }
    // types
    typeById(id) { return this.types.find((t) => t.id === id) || this.components.find((c) => c.id === id); }
    updateType(id, patch, commit) {
      const t = this.typeById(id); Object.assign(t, patch);
      this._ctx(); this.view.regenType(id);
      if (commit) this._push("Edit " + (t.symbol || t.name));
      this.emit("types");
    }
    newType() {
      const pool = "αβζηκλμνξπρστφχψω"; const used = new Set(this.types.map((t) => t.symbol));
      const sym = [...pool].find((c) => !used.has(c)) || "x";
      const t = { id: "t:" + Date.now().toString(36), name: "", symbol: sym, arity: 2, filled: false, circle: false, isNew: true };
      this.types.push(t); this._ctx(); this._push("New agent type"); this.emit("types"); return t;
    }
    deleteType(id) { this.types = this.types.filter((t) => t.id !== id); this._ctx(); this._push("Delete type"); this.emit("types"); }
    rulesFor(id) { return this.rules.filter((r) => r.split("|").includes(id)); }
    missingRules() {
      const ids = this.types.map((t) => t.id), out = [];
      for (let i = 0; i < ids.length; i++) for (let j = i; j < ids.length; j++) { const a = ids[i], b = ids[j]; if (!this.rules.includes(a + "|" + b) && !this.rules.includes(b + "|" + a)) out.push(a + "|" + b); }
      return out;
    }
    addRule(key) { if (!this.rules.includes(key)) this.rules.push(key); this._ctx(); this._push("Add rule"); this.emit("types"); }
    removeRule(key) { this.rules = this.rules.filter((r) => r !== key); this._ctx(); this._push("Delete rule"); this.emit("types"); }
    componentDef(c) { const ex = this.data.examples.find((e) => e.name === c.def[0]); return { state: ex.states[c.def[1]], types: ex.types }; }
  }

  /* ------------------------------------------------------- palette drag */
  function paletteDrag(el, { typeId, view, onClick, ghost }) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY; let g = null;
      const move = (ev) => {
        if (!g && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
          g = document.createElement("div"); g.className = "nk-paghost"; g.innerHTML = ghost(); document.body.appendChild(g); el.classList.add("dragging");
        }
        if (g) {
          g.style.left = ev.clientX + "px"; g.style.top = ev.clientY + "px";
          const r = view.host.getBoundingClientRect();
          const over = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom && !overChrome(ev);
          view.host.classList.toggle("dropping", over); g.classList.toggle("off", !over);
        }
      };
      const up = (ev) => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        view.host.classList.remove("dropping"); el.classList.remove("dragging");
        if (!g) { onClick && onClick(ev); return; }
        g.remove();
        const r = view.host.getBoundingClientRect();
        if (ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom && !overChrome(ev)) view.addAgent(typeId, ev.clientX, ev.clientY);
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
  }
  function overChrome(ev) { const el = document.elementFromPoint(ev.clientX, ev.clientY); return !!(el && el.closest("[data-chrome]")); }

  function addEffects(map) { Object.assign(EFFECTS, map); }
  window.NetKit = { addEffects, normaliseState, Session, load, miniSVG, pairGlyph, translateAgent, View, glyph, makeAgent, agentShapeSVG, ringSVG, agentBox, stateBounds, effectFor, paletteDrag, clone, G, POLARITY, curve, portDir, esc };
})();
