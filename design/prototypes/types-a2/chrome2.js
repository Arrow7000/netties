/* types-chrome.js: the app chrome shared by the three "types" prototypes.
   It's round 1's direction A (now the real app), refactored so each types
   direction only supplies what differs: how types are drawn (hooks, glyphs),
   where strictness lives, the type editor, and the rule grid's shape.
   Throwaway prototype code. */
(function () {
  "use strict";
  async function start(opts) {
    const NK = NetKit, TK = TypeKit, esc = NK.esc;
    const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
    const data = await NK.load("../../assets/nets.json");
    TK.prepare(data);
    let S = null;
    const view = new NK.View($("#canvas"), {
      selectWireKey: "alt", altMode: true, hoverRing: true, tips: false,
      stuckLabel: "No rule: click to write one", previewOnHover: true,
      fitPad: { t: 80, r: 290, b: 90, l: 60 },
      emptyHTML: "<b>The net is empty</b>Drag an agent in from the palette on the right.",
      typing: { endType: (v, e) => TK.endType(S, v, e), clash: (v, D, e) => TK.clash(S, v, D, e) },
      hooks: opts.hooks,
    });
    S = new NK.Session(data, view);
    S.layout = "auto";
    opts.onSession && opts.onSession(S);
    const typed = () => TK.level(S) !== "untyped";
    const app = { view, S, data, ui: {}, words: {}, grid: {} };
    const ui = app.ui;

    /* ---------- theme */
    const root = document.documentElement;
    try { const t = localStorage.getItem("nt-theme-" + opts.key); if (t) root.dataset.theme = t; } catch (_) {}
    const q = new URLSearchParams(location.search); if (q.get("theme")) root.dataset.theme = q.get("theme");
    $("#theme").onclick = () => {
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("nt-theme-" + opts.key, root.dataset.theme); } catch (_) {}
    };

    /* ---------- toast + banner */
    let toastT;
    function toast(text, undo) {
      $("#toastText").textContent = text; $("#toastUndo").style.display = undo ? "" : "none";
      $("#toast").classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove("on"), undo ? 6500 : 4200);
    }
    $("#toastUndo").onclick = () => { S.undo(); $("#toast").classList.remove("on"); };
    app.toast = toast;
    ui.banner = (html, handlers = {}) => {
      const b = $("#banner");
      if (!html) { b.classList.remove("on"); return; }
      b.innerHTML = `<span style="flex:1">${html.split("<button")[0]}</span>` + html.slice(html.split("<button")[0].length) + `<button class="btn icon x" data-b="close" title="Dismiss"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button>`;
      b.classList.add("on");
      b.querySelectorAll("[data-b]").forEach((x) => (x.onclick = () => { const f = handlers[x.dataset.b]; b.classList.remove("on"); f && f(); }));
    };

    /* ---------- camera grid + zoom readout */
    view.on("camera", (c) => {
      const g = 20 * c.z; $("#canvas").style.backgroundSize = `${g}px ${g}px`; $("#canvas").style.backgroundPosition = `${c.x}px ${c.y}px`;
      $("#zoomVal").textContent = Math.round(c.z * 100) + "%";
    });

    /* ---------- menus */
    function buildExMenu() {
      const m = $("#exMenu");
      let h = `<div class="mh">Loading an example replaces the whole net. You can undo it.</div>`, grp = null;
      data.examples.forEach((e, i) => {
        if (e.hidden) return;
        if (e.group !== grp) { grp = e.group; h += `<div class="mh grp">${esc(grp)}</div>`; }
        h += `<button class="mi${i === S.exIndex ? " cur" : ""}" data-i="${i}"><span class="th">${NK.miniSVG(e.states[0], e.types, 40, 30, { pad: 14 })}</span><span class="mt">${esc(e.name)}<span class="ms">${esc(e.sub || ((e.states.length - 1) + (e.states.length === 2 ? " step" : " steps") + " to the end"))}</span></span></button>`;
      });
      m.innerHTML = h;
      m.querySelectorAll(".mi").forEach((b) => (b.onclick = () => { closeMenus(); S.load(+b.dataset.i); toast(`Loaded "${S.ex.name}". It replaced the net you had.`, true); }));
    }
    function placeMenu(m, anchor) {
      closeMenus(true);
      const r = anchor.getBoundingClientRect(); m.classList.add("on");
      let left = r.left, top = r.bottom + 6;
      if (left + m.offsetWidth > innerWidth - 8) left = innerWidth - 8 - m.offsetWidth;
      if (top + m.offsetHeight > innerHeight - 8) top = r.top - m.offsetHeight - 6;
      m.style.left = left + "px"; m.style.top = Math.max(8, top) + "px";
    }
    function openMenu(m, anchor) { const open = m.classList.contains("on"); closeMenus(); if (open) return; placeMenu(m, anchor); }
    function closeMenus() { $$(".menu").forEach((m) => m.classList.remove("on")); }
    ui.placeMenu = placeMenu; ui.closeMenus = closeMenus;
    $("#exBtn").onclick = (e) => { e.stopPropagation(); buildExMenu(); openMenu($("#exMenu"), $("#exBtn")); };
    $("#fileBtn").onclick = (e) => { e.stopPropagation(); if (opts.fileMenu) opts.fileMenu($("#fileMenu"), S); openMenu($("#fileMenu"), $("#fileBtn")); };
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".menu") && !e.target.closest("#exBtn,#fileBtn,[data-menu]")) closeMenus();
      if ($("#gridPop").classList.contains("on") && !e.target.closest("#gridPop,#gridExpand,#thumb,#openGrid,#selp,.scrim,.menu")) closeGridPop();
      if (ui.isEditing && ui.isEditing() && !e.target.closest("#typeEd,.tile,.menu,#newType,.scrim,#banner,#sysStrip,.chipbtn,[data-keep]")) ui.closeEditor();
    });
    $("#fileMenu").onclick = (e) => {
      const b = e.target.closest(".mi"); if (!b) return; closeMenus();
      const a = b.dataset.act;
      if (a === "clear") { S.clear(); toast("Cleared the net.", true); }
      else if (a === "open") app.openBadFile && app.openBadFile();
      else if (opts.fileAction && opts.fileAction(a)) {}
      else toast({ text: "The text view isn't part of this prototype.", save: "Saving isn't part of this prototype.", share: "Link copied (not really, this is a prototype).", svg: "SVG export isn't part of this prototype." }[a] || "");
    };
    app.loadBad = () => {
      let i = data.examples.indexOf(data.badFile);
      if (i < 0) { data.badFile.hidden = true; data.examples.push(data.badFile); i = data.examples.length - 1; }
      S.load(i);
    };

    /* ---------- screen switch */
    $$("[data-screen]").forEach((b) => (b.onclick = () => {
      $$("[data-screen]").forEach((x) => x.setAttribute("aria-pressed", x === b)); $("#comb").classList.toggle("on", b.dataset.screen === "comb");
    }));
    $("#combBack").onclick = () => $("[data-screen=net]").click();

    /* ---------- palette */
    const ICON_EDIT = `<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    function missingIn(t) { if (!S.sys) return 0; return new Set(TK.missing(S).filter((m) => m.type === t.id).map((m) => m.slot)).size; }
    function buildPalette() {
      $("#typeTiles").innerHTML = S.types.map((t) => { const m = missingIn(t); return `<button class="tile" data-id="${esc(t.id)}" title="Drag to add ${esc(t.symbol)}. Click to edit the agent.">${opts.glyph(t, { size: 34 })}<span class="nm">${esc(t.name || "unnamed")}</span><span class="edit">${ICON_EDIT}</span>${m ? `<span class="miss" title="${m} port${m === 1 ? "" : "s"} still to set">${m}</span>` : ""}</button>`; }).join("");
      $("#compHint").style.display = S.components.length ? "none" : "";
      $("#compTiles").innerHTML = S.components.map((c) => `<button class="tile comp" data-id="${esc(c.id)}" title="Component. Drag to add, click to edit its definition.">${NK.glyph(c, { size: 34, w: 56 })}<span class="tag">component</span></button>`).join("");
      $$(".tile").forEach((el) => {
        const id = el.dataset.id, t = S.typeById(id);
        el.onpointerenter = () => setHover({ tile: id }); el.onpointerleave = () => clearHover();
        NK.paletteDrag(el, { typeId: id, view, ghost: () => (t.component ? NK.glyph(t, { size: Math.max(34, 34 * view.cam.z), w: 56 * view.cam.z }) : opts.glyph(S.typeById(id), { size: Math.max(34, 40 * view.cam.z) })), onClick: () => (t.component ? openComponent(t) : ui.openEditor(id)) });
      });
      if (ui.renderSysStrip) ui.renderSysStrip();
      if (opts.afterPalette) opts.afterPalette();
      buildRules();
    }
    // Pan so these wires aren't hidden under a popover.
    ui.reveal = (ids, el) => {
      const r = (el || $("#typeEd")).getBoundingClientRect(); if (!r.width) return;
      const xs = [];
      for (const id of ids) { const w = view.state.wires.find((x) => x.id === id); if (!w) continue; for (const p of w.path) xs.push(view.toScreen(p[0], p[1])); }
      if (!xs.length) return;
      const hidden = xs.some(([x, y]) => x > r.left - 30 && x < r.right + 10 && y > r.top - 10 && y < r.bottom + 10);
      if (!hidden) return;
      const maxX = Math.max(...xs.map((p) => p[0])), dx = r.left - 70 - maxX;
      const from = view.cam.x, t0 = performance.now();
      const tick = (now) => { const t = Math.min(1, (now - t0) / 380), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; view.cam.x = from + dx * e; view.render(); view.emit("camera", view.cam); if (t < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    app.refresh = () => { buildPalette(); renderSel(); drawHover(); };
    app.commit = (label) => { S._ctx(); view.render(); S._push(label); buildPalette(); };
    const ruleLabel = (k) => { const [a, b] = k.split("|").map((id) => S.typeById(id) || { symbol: id }); return `<i>${esc(a.symbol)}</i> with <i>${esc(b.symbol)}</i>`; };
    ui.ruleLabel = ruleLabel;

    /* ---------- rule grid */
    const pairKey = (a, b) => S.rules.find((r) => r === a + "|" + b || r === b + "|" + a) || null;
    const pairsOnCanvas = (a, b) => view.pairs().filter((w) => { const i = view.pairInfo(w); return (i.a.type === a && i.b.type === b) || (i.a.type === b && i.b.type === a); });
    function cellState(a, b) {
      const k = pairKey(a, b), on = pairsOnCanvas(a, b);
      if (!k && on.length) return { s: "stuck", k: a + "|" + b, n: on.length };
      if (k) return { s: "has", k, live: on.length > 0, n: on.length };
      const m = TK.meet(S, a, b);
      if (!m.can) return { s: "never", k: a + "|" + b, n: 0, why: m.why, short: m.short, kind: m.kind };
      return { s: "none", k: a + "|" + b, n: 0, untyped: m.untyped };
    }
    ui.cellState = cellState; ui.pairsOnCanvas = pairsOnCanvas;
    function coverage() {
      let can = 0, has = 0, never = 0; const ts = S.types;
      ts.forEach((ta, i) => ts.forEach((tb, j) => { if (j < i) return; const c = cellState(ta.id, tb.id); if (c.s === "never") never++; else { can++; if (c.s === "has") has++; } }));
      return { can, has, never };
    }
    ui.coverage = coverage;
    function gridHTML(types, cell, big) {
      const n = types.length;
      let h = `<div class="rg${big ? " big" : ""}" style="grid-template-columns:${big ? 92 : cell}px repeat(${n},${cell}px);grid-template-rows:${big ? 46 : cell}px;grid-auto-rows:${cell}px">`;
      h += `<div></div>` + types.map((t, j) => `<div class="hd col" data-col="${j}">${big ? NK.glyph(t, { size: 22, stubs: false }) : ""}${esc(t.symbol)}</div>`).join("");
      types.forEach((ta, i) => {
        h += `<div class="hd row" data-row="${i}">${big ? `<small>${esc(ta.name || "")}</small>` : ""}${esc(ta.symbol)}</div>`;
        types.forEach((tb, j) => {
          if (j < i) { h += "<div></div>"; return; }
          const c = cellState(ta.id, tb.id);
          const label = big && (c.s === "has" || c.s === "stuck") ? `${esc(ta.symbol)}${esc(tb.symbol)}` : "";
          h += `<div class="c ${c.s}${c.live ? " live" : ""}" data-i="${i}" data-j="${j}" data-a="${esc(ta.id)}" data-b="${esc(tb.id)}" role="button" aria-label="${esc(ta.symbol)} with ${esc(tb.symbol)}">${label}</div>`;
        });
      });
      return h + "</div>";
    }
    ui.gridHTML = (...a) => gridHTML(...a);
    const legendHTML = () => `<div class="legend"><span><i class="has"></i>Rule</span><span><i class="live"></i>Rule, pair on canvas</span><span><i class="none"></i>No rule yet</span><span><i class="stuck"></i>Stuck here</span>${typed() ? `<span><i class="never"></i>Can never meet</span>` : ""}</div>`;
    ui.legendHTML = legendHTML;
    function wireGrid(root) {
      root.querySelectorAll(".rg .c, [data-cell]").forEach((c) => {
        const a = c.dataset.a, b = c.dataset.b, rg = c.closest(".rg");
        c.onpointerenter = () => {
          if (rg) { rg.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl")); rg.querySelectorAll(`[data-row="${c.dataset.i}"],[data-col="${c.dataset.j}"]`).forEach((x) => x.classList.add("hl")); }
          view.setHighlight({ wires: pairsOnCanvas(a, b).map((w) => w.id) });
          setHover({ grid: { a, b } });
        };
        c.onpointerleave = () => { if (rg) rg.querySelectorAll(".hl").forEach((x) => x.classList.remove("hl")); clearHover(); };
        c.onclick = () => openRule(cellState(a, b).k);
      });
    }
    ui.wireGrid = wireGrid;
    function sumHTML() {
      if (!typed()) return "";
      const c = coverage();
      if (c.has === c.can) return `<div class="gridsum ok"><span class="ck">✓</span><span>Every pair that can meet has a rule.<small>The other ${c.never} can never meet. Nothing can get stuck.</small></span></div>`;
      return `<div class="gridsum"><b>${c.has} of ${c.can}</b> pairs that can meet have a rule.<small>The types rule out the other ${c.never}.</small></div>`;
    }
    ui.sumHTML = sumHTML;
    function buildRules() {
      const host = $("#gridHost");
      if (app.grid.render) { app.grid.render(host, false); wireGrid(host); }
      else {
        const types = S.types, n = types.length;
        const cell = Math.max(17, Math.min(24, Math.floor(204 / (n + 1)) - 2));
        host.innerHTML = sumHTML() + gridHTML(types, cell, false) + legendHTML() + `<div class="hintline">Each cell is a pair of types. Click one to see its rule, or to write one.</div>`;
        wireGrid(host);
      }
      if ($("#gridPop").classList.contains("on")) renderGridPop();
    }
    app.buildRules = buildRules;
    function openGridPop() { ui.closeEditor && ui.isEditing() && ui.closeEditor(); renderGridPop(); $("#gridPop").classList.add("on"); }
    function closeGridPop() { $("#gridPop").classList.remove("on"); }
    function renderGridPop() {
      const n = S.types.length, cell = n > 12 ? 30 : 36;
      $("#gridPop").innerHTML = `<div class="ed-head"><h3>Rules for ${n} agent types</h3><button class="btn icon" id="gpClose" title="Close"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
        <div class="sub">Each cell is one pair of types. Click a cell to see, edit or add its rule.</div>
        <div id="gpBody"></div>${opts.gridPopFoot ? opts.gridPopFoot() : ""}`;
      if (app.grid.render) app.grid.render($("#gpBody"), true); else $("#gpBody").innerHTML = sumHTML() + gridHTML(S.types, cell, true) + legendHTML();
      $("#gpClose").onclick = closeGridPop;
      wireGrid($("#gridPop"));
      if (opts.afterGridPop) opts.afterGridPop($("#gridPop"));
    }
    ui.closeGridPop = closeGridPop;
    $("#gridExpand").onclick = (e) => { e.stopPropagation(); $("#gridPop").classList.contains("on") ? closeGridPop() : openGridPop(); };
    $("#newType").onclick = (e) => {
      e.stopPropagation();
      const t = S.newType(); TK.ensurePorts(t);
      buildPalette(); ui.openEditor(t.id);
    };
    $("#newComp").onclick = () => { const n = view.selection().agents.length; toast(n ? `Would bundle ${n} agents into a component. Not part of this prototype.` : "Select some agents first, then make them a component."); };

    /* ---------- rule sheet: shows the interface ports' types and refuses ill-typed right-hand sides */
    const IFACE = { "+|S": { "+": [null, "r", "y"], S: [null, "x"] }, "+|0": { "+": [null, "r", "y"] }, "×|S": { "×": [null, "r", "y"], S: [null, "x"] }, "×|0": { "×": [null, "r", "y"] } };
    function lhsState(ta, tb, key) {
      const a = NK.translateAgent(NK.makeAgent(ta, 1, 0, 0, "down"), 0, -28), b = NK.translateAgent(NK.makeAgent(tb, 2, 0, 0, "up"), 0, 28);
      const st = { agents: [a, b], wires: [{ id: 1, ends: [{ agent: 1, slot: 0 }, { agent: 2, slot: 0 }], path: [a.ports[0], b.ports[0]], active: true }], iface: [] };
      let letter = 0; const L = "abcdefgh";
      for (const ag of [a, b]) {
        const ty = ag === a ? ta : tb;
        ag.ports.forEach((p, i) => {
          if (!i) return;
          const d = NK.portDir(ag, i), q = [p[0] + d[0] * 26, p[1] + d[1] * 26];
          const nm = (IFACE[key] && IFACE[key][ty.id] && IFACE[key][ty.id][i]) || L[letter++];
          const pt = ty.ports ? ty.ports[i] : null;
          const pt2 = TK.portOf(S, ty.id, i);
          st.iface.push({ name: nm, x: q[0], y: q[1], dir: d[1] < 0 ? "up" : "down", type: pt2 ? { pol: TK.opp(pt2.pol), name: pt2.name } : null, of: [ty, i] });
          st.wires.push({ id: 10 + st.wires.length, ends: [{ agent: ag.id, slot: i }, { free: nm }], path: [p, q] });
        });
      }
      return st;
    }
    function openRule(k) {
      const [ia, ib] = k.split("|");
      const a = S.typeById(ia) || { id: ia, symbol: ia, arity: 0 }, b = S.typeById(ib) || { id: ib, symbol: ib, arity: 0 };
      const c = cellState(ia, ib), eff = NK.effectFor(ia, ib), types = [a, b];
      const lhs = lhsState(a, b, k);
      const T = [...S.types];
      if (c.s === "never") {
        $("#ruleSheet").innerHTML = `<h3>${ruleLabel(k)}: can never meet</h3>
          <div class="never-note">${opts.miniTyped({ agents: lhs.agents, wires: [], iface: [] }, T, { w: 80, h: 120, pad: 8 })}
          <div class="tx">${c.why}<div class="m">A wire always joins a port that gives to one that takes, so these two principal ports can never be wired together. There's no rule to write, and a net that fits its types can never get stuck here.</div></div></div>
          <div class="ed-foot" style="margin-top:14px"><span></span><button class="btn primary" id="rsCancel">Close</button></div>`;
        $("#ruleScrim").classList.add("on"); $("#rsCancel").onclick = () => $("#ruleScrim").classList.remove("on"); return;
      }
      const missing = c.s !== "has";
      const rhs0 = TK.ruleRHS(k);
      let mistake = false;
      const draw = () => {
        let rhsHTML = `<div class="placeholder">The rule editor goes here. You'd draw the replacement net, then wire it to the interface ports.</div>`, cap2 = "";
        if (rhs0 && !missing) {
          const r = NK.clone(rhs0);
          for (const f of r.iface) { const src = lhs.iface.find((x) => x.name === f.name); f.type = src ? src.type : null; }
          if (mistake) {
            // join x straight to y: both bring a number in
            const x = r.iface.find((f) => f.name === "x") || r.iface[0], y = r.iface.find((f) => f.name === "y") || r.iface[1];
            r.wires = r.wires.filter((w) => !w.ends.some((e) => e.free === x.name || e.free === y.name));
            r.wires.push({ id: 99, ends: [{ free: x.name }, { free: y.name }], path: NK.curve([x.x, x.y], [x.dir === "up" ? 0 : 0, x.dir === "up" ? 1 : -1], [y.x, y.y], [0, y.dir === "up" ? 1 : -1], 20), bad: true });
          }
          rhsHTML = opts.miniTyped(r, T, { w: 230, h: 210, pad: 14 });
          if (typed()) cap2 = mistake ? `<div class="cap2 bad">Can't join x and y: both bring a number in. A wire has to join something that gives to something that takes.</div>` : `<div class="cap2 ok">✓ Fits its types.</div>`;
        }
        const ifaceRows = lhs.iface.map((f) => `<i>${esc(f.name)}</i><span>${esc(f.of[0].roles && f.of[0].roles[f.of[1]] ? TK.cap(f.of[0].roles[f.of[1]]) + ". " : "")}${typed() && f.type ? esc(f.type.pol === "give" ? `Brings ${f.type.name ? TK.art(TK.nameOf(S, f.type.name)) : "something"} in.` : f.type.pol === "take" ? `Must be given ${f.type.name ? TK.art(TK.nameOf(S, f.type.name)) : "something"}.` : f.type.name ? `Carries ${TK.art(TK.nameOf(S, f.type.name))}.` : "") : ""}</span>`).join("");
        $("#ruleSheet").innerHTML = `<h3>${missing ? "New rule: " : "Rule: "}${ruleLabel(k)}</h3>
          <p>${missing ? (c.untyped ? `<span class="sym">${esc(a.symbol)}</span> or <span class="sym">${esc(b.symbol)}</span> has an untyped principal port, so they could meet. There's no rule yet, so they'd get stuck.` : `There's no rule yet, so when <span class="sym">${esc(a.symbol)}</span> meets <span class="sym">${esc(b.symbol)}</span> they get stuck.`) : esc(eff.say)}</p>
          <div class="rule-io"><div class="side"><span class="cap">When these meet</span>${opts.miniTyped(lhs, T, { w: 230, h: 210, pad: 14 })}</div><div class="arrow">→</div>
          <div class="side"><span class="cap">They become</span>${rhsHTML}</div></div>
          <div class="rule-io" style="margin-top:6px"><div></div><div></div><div>${cap2}</div></div>
          ${lhs.iface.length ? `<div class="iface">${ifaceRows}</div>` : ""}
          <div class="ed-foot" style="margin-top:14px">${missing ? `<span></span><span><button class="btn" id="rsCancel">Cancel</button> <button class="btn primary" id="rsAdd">Add empty rule</button></span>` : `<span style="display:flex;gap:8px"><button class="btn danger" id="rsDel">Delete rule</button>${rhs0 && typed() ? `<button class="btn ghost" id="rsMis">${mistake ? "Undo the mistake" : "Try joining x to y"}</button>` : ""}</span><span><button class="btn" id="rsCancel">Close</button> <button class="btn primary" id="rsSave"${mistake ? ` aria-disabled="true" title="The right-hand side doesn't fit its types"` : ""}>Save</button></span>`}</div>`;
        $("#ruleScrim").classList.add("on");
        $("#rsCancel").onclick = () => $("#ruleScrim").classList.remove("on");
        if ($("#rsSave")) $("#rsSave").onclick = () => { if (mistake) { toast("Not saved. x and y both bring a number in, so they can't be joined."); return; } $("#ruleScrim").classList.remove("on"); };
        if ($("#rsMis")) $("#rsMis").onclick = () => { mistake = !mistake; draw(); };
        if ($("#rsAdd")) $("#rsAdd").onclick = () => { S.addRule(k); $("#ruleScrim").classList.remove("on"); buildRules(); toast("Added the rule. Pairs of these agents can fire now.", true); };
        if ($("#rsDel")) $("#rsDel").onclick = () => { S.removeRule(k); $("#ruleScrim").classList.remove("on"); buildRules(); toast("Deleted the rule. Pairs that used it are stuck now.", true); };
      };
      draw();
    }
    ui.openRule = openRule;
    $("#ruleScrim").onclick = (e) => { if (e.target.id === "ruleScrim") $("#ruleScrim").classList.remove("on"); };
    function openComponent(c) {
      const d = S.componentDef(c);
      $("#ruleSheet").innerHTML = `<h3>Component: ${esc(c.name)}</h3><p>A component bundles a piece of net into one box. Editing it here updates every copy on the canvas.</p>
        <div class="rule-io" style="grid-template-columns:1fr"><div class="side" style="height:260px"><span class="cap">Definition</span>${NK.miniSVG(d.state, d.types, 300, 220, { pad: 16 })}</div></div>
        <div class="ed-foot" style="margin-top:14px"><span class="hintline">The component editor isn't part of this prototype.</span><button class="btn primary" id="rsCancel">Close</button></div>`;
      $("#ruleScrim").classList.add("on"); $("#rsCancel").onclick = () => $("#ruleScrim").classList.remove("on");
    }
    ui.openComponent = openComponent;

    /* ---------- selection batch actions */
    function batch(sel) {
      const ags = sel.agents.map((id) => view.agent(id)).filter(Boolean);
      const tOf = (a) => S.typeById(a.type) || {};
      const comps = ags.filter((a) => tOf(a).component), plain = ags.filter((a) => !tOf(a).component);
      const out = [];
      if (ags.length === 1 && plain.length === 1) out.push({ label: "Edit agent", run: () => ui.openEditor(plain[0].type) });
      out.push({ label: "Flip", why: ags.length ? null : "only agents can flip.", run: () => view.flip(ags.map((a) => a.id)) });
      out.push({ label: "Make component", why: plain.length >= 2 ? null : "needs at least two agents.", run: () => toast(`Would bundle ${plain.length} agents into a component. Not part of this prototype.`) });
      out.push(DEL);
      return out;
    }
    const DEL = { label: "Delete", icon: `<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`, tip: "Delete (Backspace)", cls: "danger icon", run: () => view.deleteSelection() };
    const acts = new Map(); let actN = 0;
    function actBtn(a) {
      const i = ++actN; acts.set(i, a); if (acts.size > 400) acts.delete(acts.keys().next().value);
      if (a.icon) return `<button class="btn ${a.cls || ""}" data-act="${i}" title="${esc(a.tip || a.label)}" aria-label="${esc(a.label)}">${a.icon}</button>`;
      return `<button class="btn ${a.cls || ""}" data-act="${i}"${a.why ? ` aria-disabled="true"` : ""}>${esc(a.label)}</button>`;
    }
    function bindActs(r) {
      r.querySelectorAll("[data-act]").forEach((b) => {
        const a = acts.get(+b.dataset.act); if (!a) return;
        b.onclick = (e) => { e.stopPropagation(); if (a.why) return; a.run(b); };
        if (a.why) { b.onpointerenter = () => setWhy(a.label + ": " + a.why, true); b.onpointerleave = () => setWhy(); }
      });
    }

    /* ---------- canvas events */
    view.on("fire", () => S.step());
    view.on("stuck", (w, info) => openRule(info.a.type + "|" + info.b.type));
    view.on("hint", (h) => toast(h.kind === "refuse" ? "Not connected. " + h.text : h.text));
    view.on("previewpair", (w) => { if (!w) return view.setPreview(null); view.setPreview({ wires: [w.id], fromHover: true }); });

    /* ---------- hover panel (info) and selection panel (actions) */
    let hov = null;
    const symOf = (a) => esc((S.typeById(a.type) || { symbol: a.type }).symbol);
    const portName = (agentId, slot) => { const a = view.agent(agentId); return a ? (slot === 0 ? `principal port of <span class="sym">${symOf(a)}</span>` : `aux port ${slot} of <span class="sym">${symOf(a)}</span>`) : "?"; };
    const endName = (e) => (e.free != null ? `loose end <span class="sym">${esc(e.free)}</span>` : portName(e.agent, e.slot));
    const cap = (h) => h.replace(/^([a-z])/, (c) => c.toUpperCase());
    const L = (text, cls = "") => `<div class="l ${cls}">${text}</div>`;
    const Tt = (title, n = "") => `<div class="t"><span>${title}</span>${n ? `<span class="n">${n}</span>` : ""}</div>`;
    const pairTitle = (i) => `<span class="sym">${esc(i.ta.symbol)}</span> meets <span class="sym">${esc(i.tb.symbol)}</span>`;
    const typeTitle = (t) => (t.component ? `${esc(t.name)} <span style="font-weight:400;color:var(--muted)">component</span>` : `<span class="sym">${esc(t.symbol)}</span> ${esc(t.name || "")}`);
    const ptOf = (end) => TK.endType(S, view, end);
    /* visual bits shared by every hover panel: a direction glyph (the canvas arrow) and a type chip */
    function dirSVG(pol) {
      if (!TK.dirsOn(S)) return "";
      const head = pol === "give" ? `<path d="M15.5 1.6 L21 5 L15.5 8.4 Z"/>` : pol === "take" ? `<path d="M11 1.6 L5.5 5 L11 8.4 Z"/>` : "";
      return `<svg class="dg${pol ? "" : " either"}" width="23" height="10" viewBox="0 0 23 10" aria-label="${pol === "give" ? "gives" : pol === "take" ? "takes" : "either way"}"><circle cx="2.8" cy="5" r="2.2"/><line x1="5" y1="5" x2="${pol === "give" ? 17 : 21.5}" y2="5"/>${head}</svg><span class="dw">${pol === "give" ? "gives" : pol === "take" ? "takes" : "either"}</span>`;
    }
    const typeChip = (name) => (TK.typesOn(S) ? `<span class="tchip${name ? "" : " any"}">${name ? esc(TK.nameOf(S, name)) : "any type"}</span>` : "");
    const bits = (pt) => (typed() ? `<span class="bits">${dirSVG(pt && pt.pol)}${typeChip(pt && pt.name)}</span>` : "");
    const ptag = (slot) => `<span class="ptag">${slot === 0 ? "principal" : "aux " + slot}</span>`;
    ui.dirSVG = dirSVG; ui.typeChip = typeChip; ui.bits = bits;
    const short = (e) => (e.free != null ? `<span class="sym">${esc(e.free)}</span>` : `<span class="sym">${symOf(view.agent(e.agent))}</span>`);
    function portsRow(t) {
      if (!typed() || !t.ports) return "";
      return `<div class="prow-mini">${t.ports.map((p, i) => `<span class="pm"><span class="ptag">${i === 0 ? "P" : i}</span>${dirSVG(TK.portOf(S, t.id, i) && TK.portOf(S, t.id, i).pol)}${typeChip(TK.portOf(S, t.id, i) && TK.portOf(S, t.id, i).name)}</span>`).join("")}</div>`;
    }
    ui.portsRow = portsRow;
    const roleOf = (typeId, slot) => { const t = S.typeById(typeId); return t && t.roles && t.roles[slot] ? t.roles[slot] : ""; };
    function hoverHTML(h) {
      if (!h) return "";
      if (h.drag) {
        const t = h.target, D = view.drag;
        const o = D && D.originEnd;
        const ot = o && o.free == null ? ptOf(o) : null;
        const head = o ? `Wiring from ${o.free == null ? ptag(o.slot) + " " : ""}${short(o)}` : "Wiring";
        return Tt(head, bits(ot)) + (t && !t.ok ? L(esc(t.why || t.note), "bad") : t ? L("Let go to " + esc(t.note.toLowerCase()) + ".", "sel") : typed() && ot ? L("Blue ports fit. Grey ones don't.") : "");
      }
      if (h.marquee) return Tt("Selecting") + L(esc(h.hint || ""));
      if (h.xray) { const n = h.xray.n; return Tt(`<span class="tchip">${esc(TK.nameOf(S, h.xray.id))}</span>`, `${n} port${n === 1 ? "" : "s"}`) + L(h.xray.on ? "Lit up on the canvas." : "None on the canvas right now."); }
      if (h.grid) {
        const { a, b } = h.grid, ta = S.typeById(a), tb = S.typeById(b); if (!ta || !tb) return "";
        const c = cellState(a, b);
        const line = c.s === "has" ? esc(NK.effectFor(a, b).say) : c.s === "stuck" ? "No rule, and a pair is stuck here." : c.s === "never" ? c.why : c.untyped ? "No rule yet. One of them could go either way, so they could meet." : "No rule yet.";
        return Tt(`<span class="sym">${esc(ta.symbol)}</span> with <span class="sym">${esc(tb.symbol)}</span>`, c.s === "never" ? "can never meet" : c.n ? `${c.n} on canvas` : "") + L(line, c.s === "stuck" ? "bad" : "");
      }
      if (h.tile) {
        const t = S.typeById(h.tile); if (!t) return "";
        return Tt(typeTitle(t)) + (t.component ? "" : portsRow(t)) + L(t.component ? "Drag to add. Click to open." : "Drag to add. Click to edit.", "k");
      }
      const t = h.target; if (!t) return "";
      const alt = view.alt;
      if (t.kind === "wire") {
        const w = view.state.wires.find((x) => x.id === t.id); if (!w) return "";
        const st = view.status(w);
        if (st === "active") { const i = view.pairInfo(w); return Tt(pairTitle(i), "active pair") + L(esc(i.effect.say)) + L(alt ? "Click selects the wire." : "Click fires. Alt-click selects.", alt ? "sel" : "k"); }
        if (st === "stuck") { const i = view.pairInfo(w); return Tt(pairTitle(i), "stuck") + L("No rule for this pair. Click to write one.", "bad"); }
        const f = typed() ? TK.flow(S, view, w) : 0, nm = typed() ? TK.wireName(S, view, w) : null;
        const [g, k] = f < 0 ? [w.ends[1], w.ends[0]] : [w.ends[0], w.ends[1]];
        return Tt(`Wire ${short(g)} ${f ? "→" : "–"} ${short(k)}`, nm ? typeChip(nm) : "");
      }
      if (t.kind === "agent") {
        const a = view.agent(t.id); if (!a) return "";
        const ty = S.typeById(a.type) || { symbol: a.type, arity: a.ports.length - 1 };
        const pw = view.wireAt(a.id, 0), pst = pw && view.status(pw);
        return Tt(typeTitle(ty), pst === "active" ? "active pair" : pst === "stuck" ? "stuck" : "") + (ty.component ? L("Dissolves when anything inside interacts.") : portsRow(ty));
      }
      if (t.kind === "port") {
        const w = view.wireAt(t.agent, t.slot), a = view.agent(t.agent);
        const pt = typed() ? TK.portOf(S, a.type, t.slot) : null, role = roleOf(a.type, t.slot);
        const miss = S.sys && TK.missing(S).filter((m) => m.type === a.type && m.slot === t.slot);
        return Tt(`${ptag(t.slot)} <span class="sym">${symOf(a)}</span>${role ? ` <span class="plab">${esc(role)}</span>` : ""}`, bits(pt)) +
          (miss && miss.length ? L(`Still needs ${miss.map((m) => (m.what === "dir" ? "a direction" : "a type")).join(" and ")}.`, "bad") : w ? L("Drag to unplug.", "k") : "");
      }
      if (t.kind === "free") {
        const w = view.wireOfFree(t.name), o = w && w.ends.find((e) => e.free !== t.name), op = o && o.free == null ? ptOf(o) : null;
        const fr = view.state.free.find((f) => f.name === t.name);
        return Tt(`Loose end <span class="sym">${esc(t.name)}</span>`, typed() && op ? `<span class="nt">net</span>${bits(op)}` : "") +
          (fr && fr.cut ? L(`Cut: ${esc((fr.why || "the wire didn't fit").replace(/\.$/, ""))}.`, "bad") : "");
      }
      return "";
    }
    function setHover(h) { hov = h; drawHover(); }
    function clearHover() { hov = null; view.setHighlight(null); drawHover(); }
    ui.setHover = setHover; ui.clearHover = clearHover;
    function drawHover() { const el = $("#hovp"), html = hoverHTML(hov); el.innerHTML = html; el.classList.toggle("on", !!html); placeHover(); }
    function placeHover() { const sp = $("#selp"); $("#hovp").style.bottom = (sp.classList.contains("on") ? 72 + sp.offsetHeight + 8 : 72) + "px"; }
    new ResizeObserver(placeHover).observe($("#selp"));
    view.on("hover", (h) => { if (h && (h.target || h.drag || h.marquee)) setHover(h); else clearHover(); });
    view.on("altchange", (on) => { $("#altBadge").classList.toggle("on", on && !!view.activePairs().length); drawHover(); });
    const DEFAULT_WHY = "Shift-click adds to the selection. Esc clears it.";
    function setWhy(text, on) { const w = $("#selp .why"); if (w) { w.textContent = text || DEFAULT_WHY; w.classList.toggle("on", !!on); } }
    function selActions(sel) {
      if (sel.wires.length === 1 && !sel.agents.length) {
        const w = view.state.wires.find((x) => x.id === sel.wires[0]); const st = w && view.status(w);
        if (st === "active") { const i = view.pairInfo(w); return { title: pairTitle(i), n: "active pair", acts: [{ label: "Fire", run: () => S.step() }, { label: "Open rule", run: () => openRule(pairKey(i.a.type, i.b.type)) }, DEL] }; }
        if (st === "stuck") { const i = view.pairInfo(w); return { title: pairTitle(i), n: "stuck pair", acts: [{ label: "Write rule", run: () => openRule(i.a.type + "|" + i.b.type) }, DEL] }; }
        return { title: "Wire", n: "1 selected", acts: [DEL] };
      }
      const n = sel.agents.length + sel.wires.length;
      if (n === 1) { const a = view.agent(sel.agents[0]); const t = S.typeById(a.type) || {}; return { title: typeTitle(t), n: "1 selected", acts: batch(sel) }; }
      return { title: `${n} selected`, n: "", acts: batch(sel) };
    }
    function renderSel() {
      const el = $("#selp"), sel = view.selection();
      if (!sel.agents.length && !sel.wires.length) { el.classList.remove("on"); el.innerHTML = ""; placeHover(); return; }
      const m = selActions(sel);
      el.innerHTML = Tt(m.title, m.n) + `<div class="row">${m.acts.map((a) => actBtn(a)).join("")}</div><div class="why">${DEFAULT_WHY}</div>`;
      bindActs(el); el.classList.add("on"); placeHover();
    }
    view.on("select", renderSel);
    view.on("change", () => setTimeout(renderSel));

    /* ---------- run controls */
    const SPEEDS = (v) => Math.pow(10, (v - 50) / 50 * 0.75);
    function setSpeedFromSlider() { const v = SPEEDS(+$("#speed").value); S.setSpeed(v); $("#speedOut").textContent = (v < 1 ? v.toFixed(2).replace(/0$/, "") : v.toFixed(1).replace(/\.0$/, "")) + "×"; $("#slowmo").setAttribute("aria-pressed", v < 0.3); $("#slowmo").style.background = v < 0.3 ? "var(--accent-soft)" : ""; $("#slowmo").style.color = v < 0.3 ? "var(--accent)" : ""; }
    $("#speed").oninput = setSpeedFromSlider;
    $("#slowmo").onclick = () => { $("#speed").value = SPEEDS(+$("#speed").value) < 0.3 ? 50 : 4; setSpeedFromSlider(); };
    $("#step").onclick = () => S.step();
    $("#stepAll").onclick = () => S.step();
    $("#runBtn").onclick = () => (S.running ? S.stop() : S.run());
    $$("[data-layout]").forEach((b) => (b.onclick = () => S.setLayout(b.dataset.layout)));
    $("#tidy").onclick = () => { if (S.layout !== "manual") return; S.tidy(); };
    $("#fit").onclick = () => view.fit();
    $("#zoomIn").onclick = () => view.zoomAt(1.25);
    $("#zoomOut").onclick = () => view.zoomAt(0.8);
    $("#zoomVal").onclick = () => view.zoomAt(1 / view.cam.z);
    $("#undo").onclick = () => S.undo();
    $("#redo").onclick = () => S.redo();
    S.on("message", (m) => toast(m));
    S.on("undo", (l) => l && toast("Undid: " + l.toLowerCase()));
    function syncUI() {
      if (!S.stats) return;
      const pairs = view.activePairs().length;
      $("#step").disabled = $("#stepAll").disabled = !pairs || (S.busy && !S.running);
      $("#runBtn").className = "btn " + (S.running ? "stop" : "run");
      $("#runBtn").innerHTML = S.running ? `<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg><span>Stop</span>` : `<svg viewBox="0 0 16 16"><path d="M4.5 3l8 5-8 5z" fill="currentColor"/></svg><span>Run</span>`;
      $("#runBtn").disabled = !S.running && !pairs;
      $("#undo").disabled = !S.canUndo(); $("#redo").disabled = !S.canRedo();
      $("#undo").title = S.canUndo() ? "Undo " + (S.undoLabel() || "").toLowerCase() + " (⌘Z)" : "Nothing to undo";
      $("#redo").title = S.canRedo() ? "Redo " + (S.redoLabel() || "").toLowerCase() + " (⇧⌘Z)" : "Nothing to redo";
      $$("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layout === (S.layout || "auto")));
      $("#tidy").disabled = (S.layout || "auto") !== "manual";
      $("#stSteps").textContent = S.stats.steps; $("#stInter").textContent = S.stats.interactions; $("#stAgents").textContent = view.state.agents.length;
      if (!$("#gridHost").querySelector(".c:hover,[data-cell]:hover")) buildRules();
      renderSel();
      $("#newComp").disabled = view.selection().agents.length < 1;
    }
    S.on("update", syncUI); view.on("select", syncUI);
    S.on("load", () => { S.components = []; S.undoStack.forEach((u) => (u.components = [])); clearHover(); closeGridPop(); ui.closeEditor && ui.isEditing && ui.isEditing() && ui.closeEditor(); ui.banner(null); buildPalette(); renderSel(); app.afterLoad && app.afterLoad(); });
    S.on("types", () => buildRules());
    const reb = () => { buildPalette(); app.afterLoad && app.afterLoad(); };
    S.on("undo", reb); S.on("redo", reb);
    S.on("stepped", syncUI);

    /* ---------- keys */
    addEventListener("keydown", (e) => {
      if (e.target.closest("input,textarea")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); }
      else if (e.key === "Backspace" || e.key === "Delete") view.deleteSelection();
      else if (e.key === " ") { e.preventDefault(); S.step(); }
      else if (e.key === "f") view.fit();
      else if (e.key === "Escape") { view.select([]); ui.closeEditor && ui.isEditing() && ui.closeEditor(); closeMenus(); $("#ruleScrim").classList.remove("on"); }
      else if (mod && e.key === "a") { e.preventDefault(); view.selectAll(); }
    });
    const cur = (svg, fb) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 2, ${fb}`;
    const ARROW = '<path d="M3 2v15l4-4 3 7 2.5-1-3-7H15z" fill="#000" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>';
    const fireCur = cur(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">${ARROW}<path d="M19 9l-4 7h3l-2 6 6-8h-3l2-5z" fill="#f2a20c" stroke="#000" stroke-width=".9" stroke-linejoin="round"/></svg>`, "pointer");
    const selCur = cur(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">${ARROW}<rect x="14.5" y="13.5" width="9" height="9" rx="1.5" fill="#fff" stroke="#2d5bff" stroke-width="1.6" stroke-dasharray="2.4 1.6"/></svg>`, "copy");
    const cs = document.createElement("style");
    cs.textContent = `#canvas .nk-whit.st-active{cursor:${fireCur}} #canvas.alt .nk-whit.st-active{cursor:${selCur}}`;
    document.head.appendChild(cs);

    app.init = () => {
      const want = q.get("ex"); let i = 0;
      if (want) { const k = data.examples.findIndex((e) => e.name === want); if (k >= 0) i = k; }
      S.load(i); setSpeedFromSlider();
      window.__app = app;
    };
    return app;
  }
  window.TypesChrome = { start };
})();
