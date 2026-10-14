/* edkit-app.js: the main window for the round 3 (editors) prototypes.
   The real app's look: canvas, File and Examples top left, undo and theme
   top right, palette with agents, components and the rule grid on the
   right, run controls at the bottom, hover and selection panels bottom left.
   The three directions only differ in their editors (edkit-panel.js,
   edkit-comb.js and each index.html). Throwaway prototype code. */
(function () {
  "use strict";
  const NK = NetKit, esc = NK.esc, clone = NK.clone;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  const sub = (n) => String(n).replace(/\d/g, (d) => SUB[+d]);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const art = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
  const fmt = (n) => Number(n).toLocaleString("en-GB");

  /* ------------------------------------------------------------ the page skeleton (same in every direction) */
  const ICON = {
    undo: `<svg viewBox="0 0 16 16"><path d="M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    redo: `<svg viewBox="0 0 16 16"><path d="M10 4l3 3-3 3M12.5 7H6a3 3 0 000 6h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    theme: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/></svg>`,
    car: `<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
    plus: `<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5"/></svg>`,
    x: `<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"/></svg>`,
    edit: `<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    del: `<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    left: `<svg viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    right: `<svg viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    expand: `<svg viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
    comb: `<svg viewBox="0 0 16 16"><path d="M2.5 3h5L5 7.5z" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M8.5 3h5L11 7.5z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><circle cx="8" cy="11.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`,
  };
  function skeleton() {
    document.body.insertAdjacentHTML("afterbegin", `
<div id="canvas"></div>
<div class="island" id="top-left" data-chrome>
  <div class="brand"><svg viewBox="-12 -14 24 28" aria-hidden="true"><polygon points="-9,-13 9,-13 0,-2" class="brand-filled"/><polygon points="-9,13 9,13 0,2" class="brand-hollow"/></svg>netties</div>
  <div class="sep"></div>
  <button class="btn" id="fileBtn" aria-haspopup="menu">File ${ICON.car}</button>
  <button class="btn" id="exBtn" aria-haspopup="menu">Examples ${ICON.car}</button>
</div>
<div class="island" id="top-right" data-chrome>
  <button class="btn icon" id="undo" data-tip="Undo">${ICON.undo}</button>
  <button class="btn icon" id="redo" data-tip="Redo">${ICON.redo}</button>
  <div class="sep"></div>
  <button class="btn icon" id="theme" data-tip="Switch theme">${ICON.theme}</button>
</div>
<aside class="island" id="panel" data-chrome data-palette aria-label="Palette">
  <section>
    <div class="sec-h"><h2>Agents</h2><button class="btn ghost" id="newType">${ICON.plus}New agent</button></div>
    <div id="sysLine"></div>
    <div class="tiles" id="typeTiles"></div>
    <div class="sec-h" style="margin-top:12px"><h2>Components</h2><button class="btn ghost" id="newComp" data-tip="Select some agents first">From selection</button></div>
    <div id="compHint">Select some agents and make them a component to reuse them.</div>
    <div class="tiles" id="compTiles"></div>
    <div class="hintline" id="palHint">Drag onto the canvas to add. Click to edit.</div>
  </section>
  <section id="rulesSec">
    <div class="sec-h"><h2>Rules</h2><button class="btn ghost" id="gridExpand" data-tip="Open a bigger rule grid" style="display:none">${ICON.expand}Expand</button></div>
    <div id="gridHost"></div>
  </section>
</aside>
<div class="island panel" id="hovp" aria-live="polite"></div>
<div class="island panel" id="selp" data-chrome></div>
<div class="island" id="stats" data-chrome>
  <div class="chip"><b id="stSteps">0</b><span>steps</span></div>
  <div class="chip"><b id="stInter">0</b><span>interactions</span></div>
  <div class="chip"><b id="stAgents">0</b><span>agents</span></div>
</div>
<div class="island" id="run" data-chrome aria-label="Run">
  <button class="btn ghost" id="step"><svg viewBox="0 0 16 16"><path d="M4 3.5l6 4.5-6 4.5z" fill="currentColor"/><path d="M12 3.5v9" stroke="currentColor" stroke-width="1.6"/></svg>Step</button>
  <button class="btn ghost" id="stepAll"><svg viewBox="0 0 16 16"><path d="M2 3.5l5 4.5-5 4.5zM8 3.5l5 4.5-5 4.5z" fill="currentColor"/></svg>Step all</button>
  <button class="btn run" id="runBtn"><svg viewBox="0 0 16 16"><path d="M4.5 3l8 5-8 5z" fill="currentColor"/></svg><span>Run</span></button>
  <div class="sep"></div>
  <div class="speed"><button class="btn icon" id="slowmo" data-tip="Slow motion"><svg viewBox="0 0 16 16"><circle cx="8" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.5v3l2 1.5M6.5 1.8h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
  <input type="range" id="speed" min="0" max="100" value="50" aria-label="Speed"><output id="speedOut">1×</output></div>
</div>
<div class="island" id="viewctl" data-chrome>
  <div class="seg" aria-label="Layout mode"><button aria-pressed="true" data-layout="auto">Auto</button><button aria-pressed="false" data-layout="manual">Manual</button></div>
  <button class="btn" id="tidy">Tidy</button>
  <div class="sep"></div>
  <button class="btn icon" id="zoomOut" data-tip="Zoom out"><svg viewBox="0 0 16 16"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.5"/></svg></button>
  <button class="btn zoomval" id="zoomVal" data-tip="Reset to 100%">100%</button>
  <button class="btn icon" id="zoomIn" data-tip="Zoom in"><svg viewBox="0 0 16 16"><path d="M3.5 8h9M8 3.5v9" stroke="currentColor" stroke-width="1.5"/></svg></button>
  <button class="btn" id="fit" data-tip="Fit net to view (F)"><svg viewBox="0 0 16 16"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>Fit</button>
</div>
<div class="menu" id="exMenu" role="menu" data-chrome></div>
<div class="menu" id="fileMenu" role="menu" data-chrome></div>
<div class="pop" id="agentEd" data-chrome role="dialog" aria-label="Agent"></div>
<div class="pop" id="gridPop" data-chrome role="dialog" aria-label="Rule grid"></div>
<button id="rulePill" data-chrome>Open rule</button>
<div id="toast" role="status"><span id="toastText"></span><button id="toastUndo">Undo</button></div>
<div class="tooltip" id="tooltip"></div>`);
  }

  /* ------------------------------------------------------------ data */
  async function loadData() {
    const raw = await NK.load3("../../assets/editors.json");
    const typesOf = (key) => clone(raw.systems[key].types).map((t) => ({ ...t, circle: t.arity === 0, roles: (t.ports || []).map((p) => p.label || "") }));
    const examples = raw.examples.map((e) => {
      const types = typesOf(e.sysKey), T = Object.fromEntries(types.map((t) => [t.id, t]));
      return { name: e.name, group: e.group, about: e.about, family: e.sysKey, types, rules: clone(raw.systems[e.sysKey].rules), states: e.states.map((s) => NK.hydrate(s, T)), sizes: e.sizes, sys: clone(raw.systems[e.sysKey].typing), components: [], extra: { ruleNets: {}, compDefs: {} } };
    });
    // A synthetic example with two instances of a component, "two" (S(S(0))), for the component editor.
    {
      const types = typesOf("arith"), T = Object.fromEntries(types.map((t) => [t.id, t]));
      const comp = { id: "c:two", name: "two", symbol: "2", arity: 0, component: true };
      const A = (id, t, x, y, o) => NK.makeAgent(t, id, x, y, o);
      const i1 = A(1, comp, 0, -62, "down"), plus = A(2, T["+"], 0, 0, "up"), i2 = A(3, comp, -40, 78, "up");
      const free = [{ name: "out", x: 8, y: 116, dir: "down" }];
      const st = { agents: [i1, plus, i2], wires: [], free };
      const W = (id, e0, p0, d0, e1, p1, d1) => st.wires.push({ id, ends: [e0, e1], path: NK.curve(p0, d0, p1, d1, 16) });
      W(1, { agent: 1, slot: 0 }, i1.ports[0], [0, 1], { agent: 2, slot: 0 }, plus.ports[0], [0, -1]);
      W(2, { agent: 2, slot: 2 }, plus.ports[2], [0, 1], { agent: 3, slot: 0 }, i2.ports[0], [0, -1]);
      W(3, { agent: 2, slot: 1 }, plus.ports[1], [0, 1], { free: "out" }, [8, 116], [0, -1]);
      // the definition: 0 → S → S → loose end n
      const z = A(1, T["0"], 0, -98, "down"), s1 = A(2, T.S, 0, -52, "down"), s2 = A(3, T.S, 0, 2, "down");
      const def = { agents: [z, s1, s2], wires: [
        { id: 1, ends: [{ agent: 2, slot: 1 }, { agent: 1, slot: 0 }], path: [s1.ports[1], z.ports[0]] },
        { id: 2, ends: [{ agent: 3, slot: 1 }, { agent: 2, slot: 0 }], path: [s2.ports[1], s1.ports[0]] },
        { id: 3, ends: [{ agent: 3, slot: 0 }, { free: "n" }], path: [s2.ports[0], [0, 50]] },
      ], free: [{ name: "n", x: 0, y: 50, dir: "down" }] };
      examples.splice(3, 0, { name: "Two plus two, with a component", group: "Arithmetic", about: "Two instances of the component \"two\".", family: "arith", types, rules: clone(raw.systems.arith.rules), states: [st], sizes: null, sys: clone(raw.systems.arith.typing), components: [comp], extra: { ruleNets: {}, compDefs: { "c:two": def } }, noSteps: true });
    }
    return { raw, examples };
  }

  /* ------------------------------------------------------------ typing: ports give or take, and carry a type */
  function Typing(getS) {
    const on = () => { const S = getS(); return !!(S && S.sys && (S.sys.dirs !== "off" || S.sys.types !== "off")); };
    const dirsOn = () => { const S = getS(); return !!(S && S.sys && S.sys.dirs !== "off"); };
    const typesOn = () => { const S = getS(); return !!(S && S.sys && S.sys.types !== "off"); };
    const opp = (p) => (p === "give" ? "take" : p === "take" ? "give" : null);
    function portOf(typeId, slot) {
      const S = getS(), t = S && S.typeById(typeId); if (!t || !t.ports) return null;
      const p = t.ports[slot]; if (!p) return null;
      const r = { pol: dirsOn() ? p.pol : null, name: typesOn() ? p.type : null };
      return r.pol || r.name ? r : null;
    }
    function endType(v, end) {
      if (end.free != null) {
        const f = v.state.free.find((x) => x.name === end.free);
        if (f && f.pin) return f.ptype || null;
        const w = v.wireOfFree(end.free); if (!w) return null;
        const o = w.ends.find((e) => e.free !== end.free); if (!o) return null;
        const p = endType(v, o); return p ? { pol: opp(p.pol), name: p.name } : null;
      }
      const a = v.agent(end.agent); return a ? portOf(a.type, end.slot) : null;
    }
    const verb = (p) => (p.pol === "give" ? "gives" : "takes");
    const carries = (p) => (p.pol ? verb(p) : "carries") + " " + art(p.name);
    function compare(a, b) {
      if (!a || !b) return null;
      if (a.pol && b.pol && a.pol === b.pol) return { note: a.pol === "give" ? "Both give" : "Both take", why: `Both ${a.pol}${a.name && a.name === b.name ? " " + art(a.name) : ""}. A wire runs from a port that gives to one that takes.` };
      if (a.name && b.name && a.name !== b.name) return { note: "Wrong type", why: `This port ${carries(b)}, but the wire carries ${art(a.name)}.` };
      return null;
    }
    function clash(v, D, end) {
      if (!on() || !D.originEnd) return null;
      const a = endType(v, D.originEnd);
      if (end.free != null && !(v.pinOf && v.pinOf(end.free))) {
        const w = v.wireOfFree(end.free), g = w && w.ends.find((e) => e.free !== end.free);
        if (!g || g.free != null) return null;
        return compare(a, endType(v, g));
      }
      return compare(a, endType(v, end));
    }
    function flow(v, w) {
      const t0 = endType(v, w.ends[0]), t1 = endType(v, w.ends[1]);
      if (t0 && t0.pol) return t0.pol === "give" ? 1 : -1;
      if (t1 && t1.pol) return t1.pol === "take" ? 1 : -1;
      return 0;
    }
    function meet(a, b) {
      const pa = portOf(a, 0) || {}, pb = portOf(b, 0) || {};
      if (pa.pol && pb.pol && pa.pol === pb.pol) return { can: false, why: `Both principal ports ${pa.pol}${pa.name && pa.name === pb.name ? " " + art(pa.name) : ""}, so they can never be wired together.` };
      if (pa.name && pb.name && pa.name !== pb.name) return { can: false, why: `One carries ${art(pa.name)}, the other ${art(pb.name)}.` };
      return { can: true };
    }
    function sentence(p) {
      if (!p) return "";
      if (p.pol && p.name) return `${cap(verb(p))} ${art(p.name)}.`;
      if (p.pol) return cap(verb(p)) + ".";
      return `Carries ${art(p.name)}.`;
    }
    return { on, dirsOn, typesOn, portOf, endType, compare, clash, flow, meet, opp, sentence };
  }

  /* ------------------------------------------------------------ drawing hooks: arrows on wires (A2), problem marks */
  function midOf(path) {
    let L = 0; const seg = [];
    for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(l); L += l; }
    let h = L / 2;
    for (let i = 0; i < seg.length; i++) { if (h <= seg[i] || i === seg.length - 1) { const a = path[i], b = path[i + 1], k = seg[i] ? h / seg[i] : 0; const d = [(b[0] - a[0]) / (seg[i] || 1), (b[1] - a[1]) / (seg[i] || 1)]; return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], d, L }; } h -= seg[i]; }
    return { p: path[0], d: [0, 1], L: 0 };
  }
  function arrowAt(p, d, cls = "", s = 1) {
    const l = 3.1 * s, w = 2.5 * s, n = [-d[1], d[0]];
    const tip = [p[0] + d[0] * l, p[1] + d[1] * l], b = [p[0] - d[0] * l, p[1] - d[1] * l];
    const f = (q) => q[0].toFixed(2) + "," + q[1].toFixed(2);
    return `<polygon class="ta-arrow ${cls}" points="${f(tip)} ${f([b[0] + n[0] * w, b[1] + n[1] * w])} ${f([b[0] + d[0] * 1.1, b[1] + d[1] * 1.1])} ${f([b[0] - n[0] * w, b[1] - n[1] * w])}"/>`;
  }
  function makeHooks(TY, extra = {}) {
    return {
      wire(w, p, v) {
        if (!TY.on()) return "";
        const f = TY.flow(v, w); if (!f) return "";
        const m = midOf(p); if (m.L < 8) return "";
        return arrowAt(m.p, f > 0 ? m.d : [-m.d[0], -m.d[1]]);
      },
      port(c) {
        if (!TY.on() || c.dragging) return null;
        const pt = TY.portOf(c.a.type, c.i); if (!pt || !pt.pol || !c.empty) return null;
        const d = NK.portDir(c.a, c.i), q = [c.p[0] + d[0] * 7.2, c.p[1] + d[1] * 7.2];
        return c.def + arrowAt(q, pt.pol === "give" ? d : [-d[0], -d[1]], "ta-pmark", 0.82);
      },
      drag(D, path) {
        if (!TY.on() || !D.originEnd) return "";
        return "";
      },
      overlay(v) { return extra.overlay ? extra.overlay(v) : ""; },
    };
  }

  /* ------------------------------------------------------------ start */
  async function start(opts = {}) {
    skeleton();
    const { raw, examples } = await loadData();
    const data = { examples };
    let S = null;
    const TY = Typing(() => S);
    const app = { raw, data, TY, ICON, esc, fmt, cap, sub, art, opts, midOf, arrowAt, makeHooks, views: [], clip: null, pointer: [0, 0] };
    const view = new NK.View($("#canvas"), {
      selectWireKey: "alt", altMode: true, hoverRing: true, tips: false, previewOnHover: true,
      fitPad: { t: 80, r: 290, b: 90, l: 60 },
      emptyHTML: "<b>The net is empty</b>Drag an agent in from the palette on the right.",
      typing: { endType: (v, e) => TY.endType(v, e), clash: (v, D, e) => TY.clash(v, D, e) },
      plugFits: (v, typeId, t) => !TY.compare(TY.portOf(typeId, 0), TY.endType(v, t.free != null ? { free: t.free } : { agent: t.agent, slot: t.slot })),
      hooks: makeHooks(TY, { overlay: (v) => (app.previewOverlay ? app.previewOverlay(v) : "") }),
    });
    S = new NK.Session(data, view);
    S.layout = "auto";
    app.view = view; app.S = S; app.views.push(view);
    addEventListener("pointermove", (e) => { app.pointer = [e.clientX, e.clientY]; }, true);

    /* ---------- theme */
    const root = document.documentElement;
    try { const t = localStorage.getItem("nt-theme-" + opts.key); if (t) root.dataset.theme = t; } catch (_) {}
    const q = new URLSearchParams(location.search); if (q.get("theme")) root.dataset.theme = q.get("theme");
    $("#theme").onclick = () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("nt-theme-" + opts.key, root.dataset.theme); } catch (_) {}
      app.emit("theme");
    };

    /* ---------- tiny event bus */
    const L = {}; app.on = (ev, f) => ((L[ev] ||= []).push(f), app); app.emit = (ev, ...a) => (L[ev] || []).forEach((f) => f(...a));

    /* ---------- tooltips: white on black, near-instant, like the real app */
    const tipEl = $("#tooltip"); let tipFor = null, tipT = 0;
    function showTip(el) {
      const text = el.getAttribute("data-tip"); if (!text) return hideTip();
      tipEl.textContent = text; tipEl.classList.add("placed");
      const r = el.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 6;
      if (y + th > innerHeight - 6) y = r.top - th - 6;
      x = Math.max(6, Math.min(innerWidth - tw - 6, x));
      tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
    }
    function hideTip() { tipEl.classList.remove("placed"); tipFor = null; }
    document.addEventListener("pointerover", (e) => {
      let el = e.target.closest && e.target.closest("[data-tip],[title]");
      if (el && el.hasAttribute("title")) { el.setAttribute("data-tip", el.getAttribute("title")); el.removeAttribute("title"); }
      if (el === tipFor) return;
      clearTimeout(tipT);
      if (!el) return hideTip();
      tipFor = el; tipT = setTimeout(() => tipFor === el && showTip(el), tipEl.classList.contains("placed") ? 0 : 120);
    });
    document.addEventListener("pointerdown", hideTip, true);
    app.refreshTip = () => { if (tipFor && document.contains(tipFor)) showTip(tipFor); else hideTip(); };

    /* ---------- toast */
    let toastT;
    function toast(text, undo) {
      $("#toastText").textContent = text; $("#toastUndo").style.display = undo ? "" : "none";
      $("#toast").classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove("on"), undo ? 6500 : 4200);
    }
    $("#toastUndo").onclick = () => { (app.undoTarget ? app.undoTarget() : S).undo(); $("#toast").classList.remove("on"); };
    app.toast = toast;

    /* ---------- camera grid */
    view.on("camera", (c) => {
      const g = 20 * c.z; $("#canvas").style.backgroundSize = `${g}px ${g}px`; $("#canvas").style.backgroundPosition = `${c.x}px ${c.y}px`;
      $("#zoomVal").textContent = Math.round(c.z * 100) + "%";
      app.emit("camera");
    });

    /* ---------- menus */
    function placeMenu(m, anchor) {
      closeMenus();
      const r = anchor.getBoundingClientRect(); m.classList.add("on");
      let left = r.left, top = r.bottom + 6;
      if (left + m.offsetWidth > innerWidth - 8) left = innerWidth - 8 - m.offsetWidth;
      if (top + m.offsetHeight > innerHeight - 8) top = r.top - m.offsetHeight - 6;
      m.style.left = left + "px"; m.style.top = Math.max(8, top) + "px";
    }
    function closeMenus() { $$(".menu").forEach((m) => m.classList.remove("on")); }
    app.placeMenu = placeMenu; app.closeMenus = closeMenus;
    function buildExMenu() {
      let h = `<div class="mh">Loading an example replaces the whole net. You can undo it.</div>`, grp = null;
      data.examples.forEach((e, i) => {
        if (e.group !== grp) { grp = e.group; h += `<div class="mh grp">${esc(grp)}</div>`; }
        h += `<button class="mi${i === S.exIndex ? " cur" : ""}" data-i="${i}"><span class="th">${NK.miniSVG(e.states[0], [...e.types, ...e.components], 40, 30, { pad: 14 })}</span><span class="mt">${esc(e.name)}<span class="ms">${esc(e.about)}</span></span></button>`;
      });
      $("#exMenu").innerHTML = h;
      $$("#exMenu .mi").forEach((b) => (b.onclick = () => { closeMenus(); app.loadExample(+b.dataset.i); }));
    }
    app.loadExample = (i) => {
      if (app.beforeLoad && app.beforeLoad() === false) return;
      S.load(i); toast(`Loaded "${S.ex.name}". It replaced the net you had.`, true);
    };
    function buildFileMenu() {
      const items = (opts.fileItems ? opts.fileItems() : []).map((it) => `<button class="mi" data-act="${it.id}"><div class="mt">${esc(it.label)}<span class="ms">${esc(it.sub || "")}</span></div></button>`).join("");
      $("#fileMenu").innerHTML = `<button class="mi" data-act="text"><div class="mt">Text view<span class="ms">Edit the net as text</span></div></button>
        <button class="mi" data-act="open"><div class="mt">Open file…</div></button><button class="mi" data-act="save"><div class="mt">Save file</div></button><hr>
        ${items}${items ? "<hr>" : ""}<button class="mi" data-act="share"><div class="mt">Copy share link</div></button><button class="mi" data-act="svg"><div class="mt">Export SVG</div></button><hr>
        <button class="mi danger" data-act="clear"><div class="mt">Clear net<span class="ms">Removes everything. You can undo it.</span></div></button>`;
    }
    $("#exBtn").onclick = (e) => { e.stopPropagation(); const open = $("#exMenu").classList.contains("on"); closeMenus(); if (!open) { buildExMenu(); placeMenu($("#exMenu"), $("#exBtn")); } };
    $("#fileBtn").onclick = (e) => { e.stopPropagation(); const open = $("#fileMenu").classList.contains("on"); closeMenus(); if (!open) { buildFileMenu(); placeMenu($("#fileMenu"), $("#fileBtn")); } };
    $("#fileMenu").onclick = (e) => {
      const b = e.target.closest(".mi"); if (!b) return; closeMenus();
      const a = b.dataset.act, it = (opts.fileItems ? opts.fileItems() : []).find((x) => x.id === a);
      if (it) return it.run();
      if (a === "clear") { S.clear(); toast("Cleared the net.", true); return; }
      toast("That isn't part of this prototype.");
    };
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".menu") && !e.target.closest("#exBtn,#fileBtn,[data-menu]")) closeMenus(); });

    /* ---------- palette */
    app.tileHTML = (t, o = {}) => t.component
      ? `<button class="tile comp" data-id="${esc(t.id)}">${NK.glyph(t, { size: 34, w: 56 })}<span class="tag">component</span></button>`
      : `<button class="tile" data-id="${esc(t.id)}">${NK.glyph(t, { size: o.size || 34 })}<span class="nm">${esc(t.name || "unnamed")}</span><span class="edit">${ICON.edit}</span></button>`;
    function buildPalette() {
      $("#typeTiles").innerHTML = S.types.map((t) => app.tileHTML(t)).join("");
      $("#compHint").style.display = S.components.length ? "none" : "";
      $("#compTiles").innerHTML = S.components.map((c) => app.tileHTML(c)).join("");
      $("#sysLine").innerHTML = TY.on() ? `<div class="sumline">Directions${S.sys.types !== "off" ? " and types" : ""} <b>${S.sys.dirs}</b></div>${S.sys.types !== "off" && (S.sys.names || []).length ? `<div class="typechips">${S.sys.names.map((n) => `<span class="tchip">${esc(typeof n === "string" ? n : n.label)}</span>`).join("")}</div>` : ""}` : "";
      bindTiles($("#panel"));
      buildRules();
      app.emit("palette");
    }
    app.buildPalette = buildPalette;
    // Drag a tile onto whichever canvas is under the pointer: the main one or an editor's.
    function bindTiles(rootEl, o = {}) {
      $$(".tile", rootEl).forEach((el) => {
        const id = el.dataset.id;
        el.onpointerenter = () => setHover({ tile: id, inPanel: !!o.inPanel }); el.onpointerleave = () => clearHover();
        el.onpointerdown = (e) => {
          if (e.button !== 0) return; e.preventDefault();
          const t = S.typeById(id), sx = e.clientX, sy = e.clientY; let g = null, over = null;
          const targetAt = (ev) => {
            const hit = document.elementFromPoint(ev.clientX, ev.clientY), host = hit && hit.closest(".nk-host");
            if (!host) return null;
            const v = app.views.find((x) => x.host === host && !x.readonly && !x.dead);
            if (!v) return null;
            if (v === view && (hit.closest("[data-chrome]") || (app.mainBlocked && app.mainBlocked()))) return null;
            return v;
          };
          const move = (ev) => {
            if (!g && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) { g = document.createElement("div"); g.className = "nk-paghost"; document.body.appendChild(g); el.classList.add("dragging"); }
            if (!g) return;
            const v = targetAt(ev);
            if (over && over !== v) { over.host.classList.remove("dropping"); over.setPlugHint(null); }
            over = v;
            const z = v ? v.cam.z : 1;
            g.innerHTML = t.component ? NK.glyph(t, { size: Math.max(34, 34 * z), w: 56 * z }) : NK.glyph(t, { size: Math.max(34, 40 * z) });
            g.style.left = ev.clientX + "px"; g.style.top = ev.clientY + "px"; g.classList.toggle("off", !v);
            if (v) { v.host.classList.add("dropping"); const p = v.plugTarget(id, ev.clientX, ev.clientY); v.setPlugHint(p); setHover({ tile: id, plug: p, view: v }); }
          };
          const up = (ev) => {
            removeEventListener("pointermove", move); removeEventListener("pointerup", up);
            el.classList.remove("dragging");
            if (over) { over.host.classList.remove("dropping"); over.setPlugHint(null); }
            if (!g) { (o.onClick || app.onTileClick)(id, el); return; }
            g.remove();
            const v = targetAt(ev); if (v) { v.addAgent(id, ev.clientX, ev.clientY); app.focusView && app.focusView(v); }
            clearHover();
          };
          addEventListener("pointermove", move); addEventListener("pointerup", up);
        };
      });
    }
    app.bindTiles = bindTiles;
    app.onTileClick = (id, el) => { const t = S.typeById(id); if (t.component) app.openComponent(id, { origin: el }); else app.openAgent(id, el); };

    /* ---------- rule grid */
    const pairKey = (a, b) => S.rules.find((r) => r === a + "|" + b || r === b + "|" + a) || null;
    app.pairKey = pairKey;
    const pairsOnCanvas = (a, b) => view.pairs().filter((w) => { const i = view.pairInfo(w); return (i.a.type === a && i.b.type === b) || (i.a.type === b && i.b.type === a); });
    function cellState(a, b) {
      const k = pairKey(a, b), on = pairsOnCanvas(a, b);
      if (!k && on.length) return { s: "stuck", k: a + "|" + b, n: on.length };
      if (k) return { s: "has", k, live: on.length > 0, n: on.length };
      const m = TY.on() ? TY.meet(a, b) : { can: true };
      if (!m.can) return { s: "never", k: a + "|" + b, n: 0, why: m.why };
      return { s: "none", k: a + "|" + b, n: 0 };
    }
    app.cellState = cellState;
    // Every pair of agent types in grid order: for moving to the next or previous rule.
    app.pairOrder = () => { const out = []; S.types.forEach((ta, i) => S.types.forEach((tb, j) => { if (j >= i) out.push(cellState(ta.id, tb.id).k); })); return out; };
    function gridHTML(types, cell, big) {
      const n = types.length;
      let h = `<div class="rg${big ? " big" : ""}" style="grid-template-columns:${big ? "auto" : cell + "px"} repeat(${n},${cell}px);grid-auto-rows:${cell}px">`;
      h += `<div></div>` + types.map((t, j) => `<div class="hd col" data-col="${j}">${esc(t.symbol)}${big ? `<small>${esc(t.name || "")}</small>` : ""}</div>`).join("");
      types.forEach((ta, i) => {
        h += `<div class="hd row" data-row="${i}">${big ? `<small>${esc(ta.name || "")}</small>` : ""}${esc(ta.symbol)}</div>`;
        types.forEach((tb, j) => {
          if (j < i) { h += "<div></div>"; return; }
          const c = cellState(ta.id, tb.id);
          h += `<div class="c ${c.s}${c.live ? " live" : ""}${app.openKey && app.openKey() === c.k ? " open" : ""}" data-i="${i}" data-j="${j}" data-a="${esc(ta.id)}" data-b="${esc(tb.id)}" data-k="${esc(c.k)}" role="button" aria-label="${esc(ta.symbol)} with ${esc(tb.symbol)}">${big && c.s !== "never" ? esc(ta.symbol) + esc(tb.symbol) : ""}</div>`;
        });
      });
      return h + "</div>";
    }
    const legendHTML = () => `<div class="legend"><span><i class="has"></i>Rule</span><span><i class="live"></i>Rule, pair on canvas</span><span><i class="none"></i>No rule yet</span><span><i class="stuck"></i>Stuck here</span>${TY.on() ? `<span><i class="never"></i>Can never meet</span>` : ""}</div>`;
    // With directions, agents whose principal ports give come first, then those that take, as in the real app.
    const gridTypes = () => {
      if (!opts.gridExpand || !TY.dirsOn()) return S.types;
      const rank = (t) => { const p = TY.portOf(t.id, 0); return p && p.pol === "give" ? 0 : p && p.pol === "take" ? 1 : 2; };
      return S.types.map((t, i) => ({ t, i })).sort((x, y) => rank(x.t) - rank(y.t) || x.i - y.i).map((x) => x.t);
    };
    const GRID_FITS = 8;
    function buildRules() {
      const host = $("#gridHost"), types = gridTypes(), n = types.length;
      $("#gridExpand").style.display = opts.gridExpand ? "" : "none";
      if (opts.gridExpand && n > GRID_FITS) {
        host.innerHTML = `<div class="hintline" style="margin-top:0">${n} agents make ${(n * (n + 1)) / 2} pairs, too many to edit here.</div><button class="thumb" id="gridThumb" aria-label="Open the rule grid" data-tip="Open the rule grid">${gridHTML(types, 7)}</button>`;
        $("#gridThumb").onclick = (e) => { e.stopPropagation(); openGridPop(); };
        if ($("#gridPop").classList.contains("on")) renderGridPop();
        return;
      }
      const cell = Math.max(17, Math.min(22, Math.floor(204 / (n + 1)) - 2));
      host.innerHTML = gridHTML(types, cell) + legendHTML() + `<div class="hintline">Each cell is a pair of agents. Click one to see its rule, or to write one.</div>`;
      wireCells(host);
      if ($("#gridPop").classList.contains("on")) renderGridPop();
    }
    function wireCells(host) {
      $$(".rg .c", host).forEach((c) => {
        const a = c.dataset.a, b = c.dataset.b, rg = c.closest(".rg");
        c.onpointerenter = () => {
          rg.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl"));
          rg.querySelectorAll(`[data-row="${c.dataset.i}"],[data-col="${c.dataset.j}"]`).forEach((x) => x.classList.add("hl"));
          view.setHighlight({ wires: pairsOnCanvas(a, b).map((w) => w.id) });
          setHover({ grid: { a, b } });
        };
        c.onpointerleave = () => { rg.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl")); clearHover(); };
        c.onclick = (e) => { e.stopPropagation(); const st = cellState(a, b); const fromPop = !!c.closest("#gridPop"); if (fromPop && st.s !== "never") closeGridPop(); app.openRule(st.k, { origin: c, never: st.s === "never" ? st.why : null }); };
      });
    }
    app.buildRules = buildRules;
    // The bigger grid, floating beside the palette, as in the real app. Opening a rule from it closes it.
    function renderGridPop() {
      const types = gridTypes(), n = types.length;
      $("#gridPop").innerHTML = `<div class="ed-head"><h3>Rules for ${n} agents</h3><button class="btn icon" id="gpClose" data-tip="Close">${ICON.x}</button></div>
        <div class="sub">Each cell is one pair of agents; γ with δ is the same rule as δ with γ, so only half the grid is used.</div>${gridHTML(types, 36, true)}${legendHTML()}`;
      $("#gpClose").onclick = closeGridPop;
      wireCells($("#gridPop"));
    }
    function openGridPop() { if (app.beforeGridPop && app.beforeGridPop() === false) return; renderGridPop(); $("#gridPop").classList.add("on"); }
    function closeGridPop() { $("#gridPop").classList.remove("on"); }
    app.closeGridPop = closeGridPop;
    $("#gridExpand").onclick = (e) => { e.stopPropagation(); $("#gridPop").classList.contains("on") ? closeGridPop() : openGridPop(); };
    document.addEventListener("pointerdown", (e) => { if ($("#gridPop").classList.contains("on") && !e.target.closest("#gridPop,#gridExpand,#gridThumb,.menu")) closeGridPop(); });
    $("#newType").onclick = (e) => { e.stopPropagation(); toast("New agents aren't part of this prototype. Click an agent to see its editor."); };
    $("#newComp").onclick = () => { const n = view.selection().agents.length; toast(n ? `Would bundle ${n} agents into a component. Not part of this prototype.` : "Select some agents first, then make them a component."); };

    /* ---------- hover panel (what you point at) and selection panel (what you can do) */
    let hov = null;
    const symOf = (t) => esc((S.typeById(t) || { symbol: t }).symbol);
    const Tt = (title, n = "") => `<div class="t"><span>${title}</span>${n ? `<span class="n">${n}</span>` : ""}</div>`;
    const Ln = (text, cls = "") => `<div class="l ${cls}">${text}</div>`;
    const typeTitle = (t) => (t.component ? `${esc(t.name)} <span style="font-weight:400;color:var(--muted)">component</span>` : `<span class="sym">${esc(t.symbol)}</span> ${esc(t.name || "")}`);
    app.typeTitle = typeTitle; app.Tt = Tt; app.Ln = Ln;
    app.pinLabel = (name) => { const m = /^([LR])(\d+)$/.exec(name); return m ? `${m[1] === "L" ? "x" : "y"}${sub(+m[2])}` : name; };
    function hoverHTML(h) {
      if (!h) return "";
      const v = h.view || view;
      if (h.custom) return h.custom;
      if (h.drag) {
        const t = h.target;
        return Tt("Wiring") + (t && !t.ok ? Ln(esc(t.why || t.note), "bad") : t ? Ln("Let go to " + esc(t.note.toLowerCase()) + ".", "sel") : Ln(esc(h.hint || "")));
      }
      if (h.marquee) return Tt("Selecting") + Ln(esc(h.hint || ""));
      if (h.grid) {
        const { a, b } = h.grid, ta = S.typeById(a), tb = S.typeById(b); if (!ta || !tb) return "";
        const c = cellState(a, b);
        const say = c.s === "has" ? app.ruleSay(a, b) : null;
        const line = c.s === "has" ? (say ? esc(say) : "") : c.s === "stuck" ? "No rule, and a pair is stuck here." : c.s === "never" ? c.why : "No rule yet. Click to write one.";
        return Tt(`<span class="sym">${esc(ta.symbol)}</span> with <span class="sym">${esc(tb.symbol)}</span>`, c.s === "never" ? "can never meet" : c.n ? `${c.n} on canvas` : "") + (line ? Ln(line, c.s === "stuck" ? "bad" : "") : "");
      }
      if (h.tile) {
        const t = S.typeById(h.tile); if (!t) return "";
        if (h.plug && !h.plug.bad) { const pv = h.view; const what = h.plug.free != null ? `interface end ${app.pinLabel(h.plug.free)}` : `${h.plug.slot === 0 ? "the principal port" : "aux port " + h.plug.slot} of <span class="sym">${symOf(pv.agent(h.plug.agent).type)}</span>`; return Tt(typeTitle(t)) + Ln(`Let go to plug its principal port into ${what}.`, "sel"); }
        if (h.plug && h.plug.bad) return Tt(typeTitle(t)) + Ln("Its principal port doesn't fit the port nearby. Let go to drop it unwired.");
        return Tt(typeTitle(t)) + Ln(app.tileHint ? app.tileHint(t, h) : t.component ? "Drag to add. Click to edit." : "Drag to add. Click to edit.", "k");
      }
      const t = h.target; if (!t) return "";
      if (t.kind === "wire") {
        const w = v.state.wires.find((x) => x.id === t.id); if (!w) return "";
        const st = v.status(w);
        if (st === "active") { const i = v.pairInfo(w); return Tt(`<span class="sym">${esc(i.ta.symbol)}</span> meets <span class="sym">${esc(i.tb.symbol)}</span>`, "active pair") + (app.ruleSay(i.a.type, i.b.type) ? Ln(esc(app.ruleSay(i.a.type, i.b.type))) : "") + Ln(v === view ? (v.alt ? "Click selects the wire." : "Click fires. Alt-click selects. Open its rule from the tag beside it.") : "Click fires.", "k"); }
        if (st === "stuck") { const i = v.pairInfo(w); return Tt(`<span class="sym">${esc(i.ta.symbol)}</span> meets <span class="sym">${esc(i.tb.symbol)}</span>`, "stuck") + Ln("No rule for this pair. Click to write one.", "bad"); }
        return Tt("Wire") + Ln("Click to select. Drag an end to rewire.", "k");
      }
      if (t.kind === "agent") {
        const a = v.agent(t.id); if (!a) return "";
        const ty = v.types[a.type] || { symbol: a.type };
        return Tt(typeTitle(ty), ty.component ? "" : `${ty.arity} aux port${ty.arity === 1 ? "" : "s"}`) + (ty.component ? Ln("A component. Click it to select, then edit it from the panel below.") : Ln("Drag to move. Click to select.", "k"));
      }
      if (t.kind === "port") {
        const a = v.agent(t.agent), ty = v.types[a.type] || {}, w = v.wireAt(t.agent, t.slot);
        const role = ty.roles && ty.roles[t.slot];
        const pt = TY.on() ? TY.portOf(a.type, t.slot) : null;
        return Tt(`<span class="ptag">${t.slot === 0 ? "principal" : "aux " + t.slot}</span> <span class="sym">${esc(ty.symbol)}</span>${role ? ` <span class="plab">${esc(role)}</span>` : ""}`) + (pt ? Ln(TY.sentence(pt)) : "") + Ln(w ? "Drag to unplug." : "Drag from here to draw a wire.", "k");
      }
      if (t.kind === "free") {
        const f = v.state.free.find((x) => x.name === t.name);
        if (f && f.pin) {
          const [ty, slot] = f.of || [];
          const T = ty && S.typeById(ty);
          const role = T && T.roles && T.roles[slot];
          return Tt(`Interface end <span class="sym">${app.pinLabel(f.name)}</span>`, T ? `was aux ${slot} of <span class="sym">${esc(T.symbol)}</span>` : "") +
            Ln(`Where the wire on ${T ? `<span class="sym">${esc(T.symbol)}</span>'s aux port ${slot}${role ? ` (${esc(role)})` : ""}` : "that port"} is left dangling once the pair is gone.${f.ptype ? " " + TY.sentence(f.ptype) : ""}`) +
            Ln(v.wireOfFree(f.name) ? "Drag to unplug." : "Needs a wire: drag from here to a port.", v.wireOfFree(f.name) ? "k" : "bad");
        }
        return Tt(`Loose end <span class="sym">${esc(t.name)}</span>`) + Ln("The net's connection to the outside.");
      }
      return "";
    }
    app.ruleSay = app.ruleSay || ((a, b) => NK.effectFor(a, b).say);
    function setHover(h) { hov = h; drawHover(); }
    function clearHover() { hov = null; view.setHighlight(null); drawHover(); }
    app.setHover = setHover; app.clearHover = clearHover;
    function drawHover() { const el = $("#hovp"), html = hoverHTML(hov); el.innerHTML = html; el.classList.toggle("on", !!html); placeHover(); }
    function placeHover() { const sp = $("#selp"); $("#hovp").style.bottom = (sp.classList.contains("on") ? 72 + sp.offsetHeight + 8 : 72) + "px"; }
    new ResizeObserver(placeHover).observe($("#selp"));
    app.attachHover = (v) => v.on("hover", (h) => { if (h && (h.target || h.drag || h.marquee)) setHover({ ...h, view: v }); else clearHover(); });
    app.attachHover(view);

    // Selection panel: shows what's selected in whichever canvas you last touched.
    let selView = view;
    app.focusView = (v) => { if (selView !== v) { selView = v; renderSel(); } };
    app.selView = () => selView;
    const acts = new Map(); let actN = 0;
    const DEL = (v) => ({ label: "Delete", icon: ICON.del, tip: "Delete (Backspace)", cls: "danger icon", run: () => v.deleteSelection() });
    function actBtn(a) {
      const i = ++actN; acts.set(i, a); if (acts.size > 400) acts.delete(acts.keys().next().value);
      if (a.icon) return `<button class="btn ${a.cls || ""}" data-act="${i}" data-tip="${esc(a.tip || a.label)}" aria-label="${esc(a.label)}">${a.icon}</button>`;
      return `<button class="btn ${a.cls || ""}" data-act="${i}"${a.why ? ` aria-disabled="true" data-tip="${esc(a.why)}"` : ""}>${esc(a.label)}</button>`;
    }
    function selActions(v, sel) {
      const out = { title: "", n: "", acts: [] };
      if (sel.wires.length === 1 && !sel.agents.length) {
        const w = v.state.wires.find((x) => x.id === sel.wires[0]), st = w && v.status(w);
        if (st && v === view) { const i = v.pairInfo(w); const k = pairKey(i.a.type, i.b.type) || i.a.type + "|" + i.b.type;
          return { title: `<span class="sym">${esc(i.ta.symbol)}</span> meets <span class="sym">${esc(i.tb.symbol)}</span>`, n: st === "active" ? "active pair" : "stuck pair", acts: [...(st === "active" ? [{ label: "Fire", run: () => S.step() }] : []), { label: st === "active" ? "Open rule" : "Write rule", run: () => app.openRule(k, { pairWire: w.id }) }, ...(app.pairActions ? app.pairActions(k, w) : []), DEL(v)] }; }
        return { title: "Wire", n: "1 selected", acts: [DEL(v)] };
      }
      const ags = sel.agents.map((id) => v.agent(id)).filter(Boolean);
      const n = sel.agents.length + sel.wires.length;
      out.title = n === 1 && ags.length === 1 ? typeTitle(v.types[ags[0].type] || {}) : `${n} selected`; out.n = n === 1 ? "1 selected" : "";
      const t0 = ags.length === 1 ? v.types[ags[0].type] : null;
      if (t0 && t0.component && v === view) out.acts.push({ label: "Edit component", run: () => app.openComponent(t0.id, { instance: ags[0].id }) });
      else if (t0 && v === view) out.acts.push({ label: "Edit agent", run: () => app.openAgent(t0.id) });
      if (t0 && !t0.component && app.agentActions && v === view) out.acts.push(...app.agentActions(t0.id, ags[0]));
      out.acts.push({ label: "Flip", why: ags.length ? null : "Only agents can flip.", run: () => v.flip(ags.map((a) => a.id)) });
      if (v === view) out.acts.push({ label: "Make component", why: ags.length >= 2 ? null : "Needs at least two agents.", run: () => toast(`Would bundle ${ags.length} agents into a component. Not part of this prototype.`) });
      out.acts.push(DEL(v));
      return out;
    }
    function renderSel() {
      const el = $("#selp"), v = selView, sel = v.selection();
      if (!sel.agents.length && !sel.wires.length) { el.classList.remove("on"); el.innerHTML = ""; placeHover(); return; }
      const m = selActions(v, sel);
      el.innerHTML = Tt(m.title, m.n + (v !== view ? (m.n ? " · " : "") + (app.panelWord ? app.panelWord() : "in the editor") : "")) + `<div class="row">${m.acts.map(actBtn).join("")}</div><div class="why">Shift-click adds to the selection. ⌘C copies it. Esc clears it.</div>`;
      el.querySelectorAll("[data-act]").forEach((b) => { const a = acts.get(+b.dataset.act); if (a) b.onclick = (e) => { e.stopPropagation(); if (a.why) return; a.run(b); }; });
      el.classList.add("on"); placeHover();
    }
    app.renderSel = renderSel;
    app.attachSel = (v) => { v.on("select", () => { if (v.selection().agents.length || v.selection().wires.length) selView = v; renderSel(); }); v.on("change", () => setTimeout(renderSel)); };
    app.attachSel(view);

    /* ---------- the "Open rule" tag beside a hovered active pair */
    const pill = $("#rulePill"); let pillWire = null, pillT = 0;
    function showPill(w) {
      clearTimeout(pillT);
      if (app.mainBlocked && app.mainBlocked()) return;
      const p0 = view.endPos(w.ends[0]), p1 = view.endPos(w.ends[1]);
      const [sx, sy] = view.toScreen(Math.max(p0[0], p1[0]), (p0[1] + p1[1]) / 2), r = $("#canvas").getBoundingClientRect();
      const label = "Click to fire".length * 5.6 + 16;
      pill.style.left = r.left + sx + 18 + label + 6 + "px"; pill.style.top = r.top + sy - 10 + "px";
      pill.classList.add("on"); pillWire = w.id;
    }
    function hidePill(now) { clearTimeout(pillT); pillT = setTimeout(() => { if (!pill.matches(":hover")) { pill.classList.remove("on"); pillWire = null; } }, now ? 0 : 450); }
    view.on("hover", (h) => { const t = h && h.target; if (t && t.kind === "wire") { const w = view.state.wires.find((x) => x.id === t.id); if (w && view.status(w) === "active") return showPill(w); } if (!h || !h.target || h.target.kind !== "wire") hidePill(); });
    pill.onpointerleave = () => hidePill();
    pill.onclick = () => { const w = view.state.wires.find((x) => x.id === pillWire); if (!w) return; const i = view.pairInfo(w); hidePill(true); app.openRule(pairKey(i.a.type, i.b.type), { pairWire: w.id, origin: pill }); };
    app.on("camera", () => hidePill(true));

    /* ---------- canvas events */
    view.on("fire", () => S.step());
    view.on("stuck", (w, info) => app.openRule(info.a.type + "|" + info.b.type, { pairWire: w.id }));
    view.on("hint", (h) => toast(h.kind === "refuse" ? "Not connected. " + h.text : h.text));
    view.on("previewpair", (w) => { if (!w) return view.setPreview(null); const i = view.pairInfo(w); view.setPreview({ wires: [], pw: w.id, fromHover: true, fade: [i.a.id, i.b.id] }); });
    // The step preview, as in the real app: the rule's result in a frame beside the pair,
    // drawn in the active colour, with dashed links from each dangling wire to where it goes.
    app.previewOverlay = (v) => {
      const pv = v.preview; if (!pv || pv.pw == null) return "";
      const w = v.state.wires.find((x) => x.id === pv.pw); if (!w || v.status(w) !== "active") return "";
      const i = v.pairInfo(w), pairs = raw.systems[S.ex.family].pairs, key = pairKey(i.a.type, i.b.type);
      const e = key && pairs[key]; if (!e) return "";
      const saved = S.extra.ruleNets && S.extra.ruleNets[key];
      const T = Object.fromEntries(S.types.map((t) => [t.id, t]));
      let rhs = saved ? NK.clone(saved) : NK.hydrate(e.rhs, T);
      const A = i.a.type === e.left ? i.a : i.b, B = A === i.a ? i.b : i.a;
      // turned a half turn (never mirrored) when the pair stands the other way up on the net
      if (A.orient === "up") rhs = { agents: rhs.agents.map((a) => NK.makeAgent(T[a.type], a.id, -a.x, -a.y, a.orient === "up" ? "down" : "up")), wires: rhs.wires.map((x) => ({ ...x, path: x.path.map((q) => [-q[0], -q[1]]) })), free: rhs.free.map((f) => ({ ...f, x: -f.x, y: -f.y, dir: f.dir === "up" ? "down" : "up" })) };
      const ba = NK.agentBox(A), bb = NK.agentBox(B), px1 = Math.max(ba.x1, bb.x1), pcy = (Math.min(ba.y0, bb.y0) + Math.max(ba.y1, bb.y1)) / 2;
      const rb = NK.stateBounds(rhs), dx = px1 + 46 - rb.x0, dy = pcy - (rb.y0 + rb.y1) / 2;
      const mv = (p) => [p[0] + dx, p[1] + dy], P = (pts) => pts.map((q) => mv(q).map((n) => n.toFixed(1)).join(",")).join(" ");
      const fx0 = rb.x0 + dx - 12, fy0 = rb.y0 + dy - 12, fw = rb.x1 - rb.x0 + 24, fh = rb.y1 - rb.y0 + 24;
      let s = `<g class="ek-pv"><rect class="ek-pv-halo" x="${fx0}" y="${fy0}" width="${fw}" height="${fh}" rx="10"/><rect class="ek-pv-frame" x="${fx0}" y="${fy0}" width="${fw}" height="${fh}" rx="10"/>`;
      for (const ww of rhs.wires) s += `<polyline class="ek-pv-wire" points="${P(ww.path)}"/>`;
      for (const a of rhs.agents) { const b = NK.makeAgent(T[a.type], a.id, a.x + dx, a.y + dy, a.orient); s += `<g class="ek-pv-ag">${NK.agentShapeSVG(b, T[a.type])}</g>`; }
      // dashed links: from each aux port of the pair to the interface end that takes its wire over
      for (const f of rhs.free) {
        const m = /^([LR])(\d+)$/.exec(f.name); if (!m) continue;
        const ag = m[1] === "L" ? A : B, slot = +m[2], from = ag.ports[slot]; if (!from) continue;
        const to = mv([f.x, f.y]);
        s += `<polyline class="ek-pv-link" points="${NK.curve(from, NK.portDir(ag, slot), to, f.dir === "up" ? [0, -1] : [0, 1], 16).map((q) => q.map((n) => n.toFixed(1)).join(",")).join(" ")}"/><circle cx="${to[0]}" cy="${to[1]}" r="1.8" class="ek-pv-pin"/>`;
      }
      return s + "</g>";
    };
    view.on("hover", () => app.focusPointer = view);

    /* ---------- run controls: every greyed-out button says why */
    const SPEEDS = (v) => Math.pow(10, (v - 50) / 50 * 0.75);
    function setSpeed() { const v = SPEEDS(+$("#speed").value); S.setSpeed(v); $("#speedOut").textContent = (v < 1 ? v.toFixed(2).replace(/0$/, "") : v.toFixed(1).replace(/\.0$/, "")) + "×"; $("#slowmo").classList.toggle("on", v < 0.3); }
    $("#speed").oninput = setSpeed;
    $("#slowmo").onclick = () => { $("#speed").value = SPEEDS(+$("#speed").value) < 0.3 ? 50 : 4; setSpeed(); };
    $("#step").onclick = () => S.step(); $("#stepAll").onclick = () => S.step();
    $("#runBtn").onclick = () => (S.running ? S.stop() : S.run());
    $$("[data-layout]").forEach((b) => (b.onclick = () => S.setLayout(b.dataset.layout)));
    $("#tidy").onclick = () => { if (S.layout === "manual") S.tidy(); };
    $("#fit").onclick = () => view.fit(); $("#zoomIn").onclick = () => view.zoomAt(1.25); $("#zoomOut").onclick = () => view.zoomAt(0.8); $("#zoomVal").onclick = () => view.zoomAt(1 / view.cam.z);
    app.globalUndo = () => S.undo(); app.globalRedo = () => S.redo();
    $("#undo").onclick = () => app.globalUndo(); $("#redo").onclick = () => app.globalRedo();
    S.on("message", (m) => toast(m));
    S.on("undo", (l) => l && toast("Undid: " + l.toLowerCase()));
    app.stepWhy = () => {
      if (S.busy && !S.running) return "Wait for this step to finish.";
      if (view.activePairs().length) return S.ex.noSteps ? null : null;
      if (view.stuckPairs().length) return "Nothing can fire: the pairs left are stuck, with no rule.";
      return "Nothing can fire: no two agents meet principal port to principal port. The net is finished.";
    };
    function syncUI() {
      if (!S.stats) return;
      const why = app.stepWhy();
      for (const id of ["step", "stepAll"]) { const b = $("#" + id); b.disabled = !!why; b.setAttribute("data-tip", why || (id === "step" ? "Fire one active pair (Space)" : "Fire every active pair at once")); }
      $("#runBtn").className = "btn " + (S.running ? "stop" : "run");
      $("#runBtn").innerHTML = S.running ? `<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg><span>Stop</span>` : `<svg viewBox="0 0 16 16"><path d="M4.5 3l8 5-8 5z" fill="currentColor"/></svg><span>Run</span>`;
      $("#runBtn").disabled = !S.running && !!why; $("#runBtn").setAttribute("data-tip", S.running ? "Stop" : why || "Run until nothing can fire");
      if (app.syncUndo) app.syncUndo(); else {
        $("#undo").disabled = !S.canUndo(); $("#redo").disabled = !S.canRedo();
        $("#undo").setAttribute("data-tip", S.canUndo() ? "Undo " + (S.undoLabel() || "").toLowerCase() + " (⌘Z)" : "Nothing to undo");
        $("#redo").setAttribute("data-tip", S.canRedo() ? "Redo " + (S.redoLabel() || "").toLowerCase() + " (⇧⌘Z)" : "Nothing to redo");
      }
      $$("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layout === (S.layout || "auto")));
      $("#newComp").disabled = view.selection().agents.length < 2; $("#newComp").setAttribute("data-tip", view.selection().agents.length < 2 ? "Select two or more agents first" : "Bundle the selected agents into a component");
      $("#tidy").disabled = (S.layout || "auto") !== "manual"; $("#tidy").setAttribute("data-tip", $("#tidy").disabled ? "Tidy only works in manual layout: auto layout is always tidy." : "Tidy up positions");
      $("#stSteps").textContent = S.stats.steps; $("#stInter").textContent = S.stats.interactions; $("#stAgents").textContent = view.state.agents.length;
      if (!$("#gridHost").querySelector(".c:hover")) buildRules();
      renderSel();
      app.emit("sync");
    }
    app.syncUI = syncUI;
    S.on("update", syncUI); view.on("select", syncUI); S.on("stepped", syncUI);
    S.on("load", () => { clearHover(); buildPalette(); renderSel(); app.emit("load"); });
    const reb = () => { buildPalette(); app.emit("history"); };
    S.on("undo", reb); S.on("redo", reb);
    app.commit = (label) => { S._ctx(); view.render(); S._push(label); buildPalette(); };

    /* ---------- keys: an open editor gets first go */
    addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input,textarea,select,[contenteditable]")) { if (app.keyInField) app.keyInField(e); return; }
      if (app.keyFirst && app.keyFirst(e)) return;
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); }
      else if (mod && k === "c") { const c = view.copySelection(); if (c) { app.clip = c; c.fromMain = true; toast(`Copied ${c.agents.length} agent${c.agents.length === 1 ? "" : "s"}.`); } }
      else if (mod && k === "x") { const c = view.copySelection(); if (c) { app.clip = c; view.deleteSelection(); } }
      else if (mod && k === "v") { if (app.clip) { const [x, y] = app.pointer; view.paste(app.clip, x, y); } }
      else if (e.key === "Backspace" || e.key === "Delete") view.deleteSelection();
      else if (e.key === " ") { e.preventDefault(); S.step(); }
      else if (k === "f" && !mod) view.fit();
      else if (e.key === "Escape") { view.select([]); closeMenus(); }
      else if (mod && k === "a") { e.preventDefault(); view.selectAll(); }
    });
    const cur = (svg, fb) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 2, ${fb}`;
    const ARROW = '<path d="M3 2v15l4-4 3 7 2.5-1-3-7H15z" fill="#000" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>';
    const cs = document.createElement("style");
    cs.textContent = `.nk-host .nk-whit.st-active{cursor:${cur(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">${ARROW}<path d="M19 9l-4 7h3l-2 6 6-8h-3l2-5z" fill="#f2a20c" stroke="#000" stroke-width=".9" stroke-linejoin="round"/></svg>`, "pointer")}}`;
    document.head.appendChild(cs);

    /* ---------- the agent editor (not this round's subject; kept small, as an entry point) */
    let agentEd = null;
    app.openAgent = (id, anchor) => {
      if (app.beforeOpen && app.beforeOpen("agent") === false) return;
      const t = S.typeById(id); if (!t) return;
      agentEd = { id, draft: clone(t), lens: false };
      renderAgentEd();
      const el = $("#agentEd"); el.classList.add("on");
      const r = (anchor || $(`#panel .tile[data-id="${CSS.escape(id)}"]`) || $("#panel")).getBoundingClientRect();
      el.style.top = Math.max(64, Math.min(r.top - 40, innerHeight - el.offsetHeight - 16)) + "px";
    };
    app.closeAgent = () => { $("#agentEd").classList.remove("on"); agentEd = null; app.emit("agentclose"); };
    app.agentOpen = () => !!agentEd;
    app.agentDraft = () => agentEd;
    function renderAgentEd() {
      const t = agentEd.draft, rules = S.rules.filter((r) => r.split("|").includes(t.id));
      const extra = app.agentEdExtra ? app.agentEdExtra(t, agentEd) : null;
      $("#agentEd").innerHTML = `<div class="ed-grid${extra && extra.wide ? " wide" : ""}">
        <div class="ed-prev">${extra && extra.preview ? extra.preview : `<div class="stage">${NK.glyph(t, { size: 150, labels: true })}</div><div class="legend"><span><i class="d"></i>principal port</span><span><i class="o"></i>aux ports, numbered clockwise</span></div>`}</div>
        <div class="ed-form">
          <div class="ed-head"><h3>Agent</h3><span style="display:flex;gap:4px;align-items:center">${extra && extra.headBtn ? extra.headBtn : ""}<button class="btn icon" id="aeClose" data-tip="Close">${ICON.x}</button></span></div>
          <div class="two"><div class="row"><label>Symbol</label><input class="inp symbol" id="aeSym" maxlength="3" value="${esc(t.symbol)}"></div><div class="row"><label>Name</label><input class="inp" id="aeName" value="${esc(t.name)}"></div></div>
          <div class="row"><span class="lab">Aux ports</span><div style="font-weight:600">${t.arity}</div></div>
          <div class="ed-note">Symbol and fill only tell agents apart. What <span class="sym">${esc(t.symbol)}</span> does comes from its rules:<div class="rl">${rules.map((k) => `<button data-k="${esc(k)}">${k.split("|").map((x) => `<i class="sym" style="font-size:13px">${symOf(x)}</i>`).join(" with ")}</button>`).join("")}</div></div>
          ${extra && extra.below ? extra.below : ""}
          <div class="ed-foot"><button class="btn danger" id="aeDel">Delete agent</button><span><button class="btn" id="aeCancel">Cancel</button> <button class="btn primary" id="aeSave">Save</button></span></div>
        </div></div>`;
      $("#aeClose").onclick = $("#aeCancel").onclick = app.closeAgent;
      $("#aeSave").onclick = () => { const real = S.typeById(agentEd.id); real.symbol = t.symbol; real.name = t.name; S.updateType(real.id, {}, false); app.closeAgent(); app.commit("Edit " + real.symbol); };
      $("#aeDel").onclick = () => toast("Deleting agents isn't part of this prototype.");
      $("#aeSym").oninput = (e) => { t.symbol = e.target.value || "?"; };
      $("#aeName").oninput = (e) => { t.name = e.target.value; };
      $$("#agentEd .rl button").forEach((b) => (b.onclick = () => { app.closeAgent(); app.openRule(b.dataset.k, {}); }));
      if (extra && extra.bind) extra.bind($("#agentEd"));
    }
    app.renderAgentEd = renderAgentEd;
    document.addEventListener("pointerdown", (e) => { if (agentEd && !e.target.closest("#agentEd,.tile,.menu,#toast,#selp,[data-keep]")) app.closeAgent(); });

    app.init = () => {
      const want = q.get("ex"); let i = data.examples.findIndex((e) => e.name === "3 + 2");
      if (want) { const k = data.examples.findIndex((e) => e.name === want); if (k >= 0) i = k; }
      S.load(i); setSpeed();
      window.__app = app;
    };
    return app;
  }
  window.EdApp = { start, ICON };
})();
