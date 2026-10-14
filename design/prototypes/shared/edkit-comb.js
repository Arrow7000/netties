/* edkit-comb.js: teaching Lafont's translation into γ, δ, ε, one agent's
   cell and one rule at a time. Shared by the round 3 directions; each one
   decides where this lives. Throwaway prototype code.

   Every number here comes from the engine (design/scripts/export-editors.ts
   runs src/core/translate.ts): cell sizes, how big each part of a cell is,
   and how many combinator interactions each rule takes, by kind. The cell
   drawings are schematic, but every γ, δ and ε drawn as a triangle or circle
   is one the real cell has; the parts drawn as boxes (menu, code, …) say how
   many combinators they hold. For the two smallest systems the real
   combinator net is also there, laid out by the engine. */
(function () {
  "use strict";
  const NK = NetKit, esc = NK.esc, clone = NK.clone;
  const fmt = (n) => Number(n).toLocaleString("en-GB");
  const CT = { γ: { id: "γ", symbol: "γ", arity: 2, filled: true }, δ: { id: "δ", symbol: "δ", arity: 2 }, ε: { id: "ε", symbol: "ε", arity: 0, circle: true } };
  const COMB_RULES = ["γ|γ", "δ|δ", "ε|ε", "ε|γ", "ε|δ", "δ|γ"];

  /* ------------------------------------------------------------ words */
  function sysInfo(app, sysKey) {
    const sys = app.raw.systems[sysKey], tr = sys.translation, T = Object.fromEntries(sys.types.map((t) => [t.id, t]));
    const sym = (id) => `<i class="sym">${esc((T[id] || { symbol: id }).symbol)}</i>`;
    return { sys, tr, T, sym, identity: !!tr.identity, restrictedOk: tr.restricted && tr.restricted.ok };
  }
  const INTRO = `Lafont showed in 1997 that three agents are enough to rebuild any interaction system: <b>γ</b> (constructor), <b>δ</b> (duplicator) and <b>ε</b> (eraser). Each of your agents becomes a small net of them, called its <b>cell</b>. When two cells meet, the γ, δ and ε inside play out your rule, many small steps for one of yours, and leave behind the cells of the rule's result.`;
  const MODES = {
    restricted: { name: "Restricted", one: "Each cell carries the cells its rules will create, ready-made. Small, but a cell can never contain a cell of its own kind." },
    general: { name: "General", one: "Each cell carries a copy of the whole rule table, called the code, and builds what a rule creates from it. Always works, but every cell is big." },
  };
  // Which translation applies to this system, and why, naming the cause.
  function verdict(app, sysKey) {
    const { tr, sym } = sysInfo(app, sysKey);
    if (tr.identity) return { short: "Nothing to translate", html: `<b>Nothing to translate.</b> These agents already are γ, δ and ε, so each one is its own cell and every step here is one combinator step.` };
    const makes = (r) => r.makes.map(sym).join(" and a new ");
    if (!tr.restricted.ok) {
      const b = tr.blockers[0], more = tr.blockers.slice(1);
      return { short: "General only", html: `<b>Only general works here.</b> ${sym(b.left)} meeting ${sym(b.right)} makes a new ${makes(b)}. Whichever of the two cells carries that result would have to contain a cell of its own kind, which would contain another, forever.${more.length ? ` ${more.map((r) => `${sym(r.left)} meeting ${sym(r.right)}`).join(" and ")} ${more.length === 1 ? "has" : "have"} the same problem.` : ""}` };
    }
    const sm = tr.selfMaking;
    if (sm.length) { const r = sm[0], other = r.makes.includes(r.left) ? r.right : r.left; return { short: "Both work", html: `<b>Both work here.</b> ${sym(r.left)} meeting ${sym(r.right)} makes a new ${makes(r)}, but ${r.makes.length > 1 ? "they" : "it"} can sit ready-made in ${sym(other)}'s cell, and nothing ends up containing its own kind.` }; }
    return { short: "Both work", html: `<b>Both work here.</b> No rule makes an agent of the kind that's meeting, so no cell has to contain itself.` };
  }
  const KIND = {
    annihilate: { w: "rewire", tip: "Two of the same kind meet (γ with γ, δ with δ) and cancel out, joining their wires: this is where the result gets wired up." },
    erase: { w: "erase", tip: "An ε meets something and erases it: menu entries that weren't picked, and spare copies of the code." },
    copy: { w: "copy", tip: "γ meets δ and they pass through each other, copying: this is the code being copied for each new cell." },
  };
  function costHTML(c) {
    if (!c) return "";
    const seg = (k) => (c[k] ? `<span class="kseg k-${k}" style="flex:${c[k]}" data-tip="${esc(KIND[k].tip)}"></span>` : "");
    return `<div class="kbar">${seg("annihilate")}${seg("erase")}${seg("copy")}</div><div class="klegend">${["annihilate", "erase", "copy"].map((k) => `<span data-tip="${esc(KIND[k].tip)}"><i class="k-${k}"></i>${fmt(c[k])} ${KIND[k].w}</span>`).join("")}</div>`;
  }

  /* ------------------------------------------------------------ drawing primitives */
  const P = (x, y) => [x, y];
  function Scene() {
    const it = { wires: [], agents: [], boxes: [], labels: [], frees: [], extra: [] };
    return {
      it,
      agent(type, x, y, orient, cls = "") { const a = NK.makeAgent(CT[type], 0, x, y, orient); it.agents.push({ a, type, cls }); return a; },
      wire(p0, d0, p1, d1, cls = "") { it.wires.push({ path: NK.curve(p0, d0, p1, d1, 18), cls }); },
      line(pts, cls = "") { it.wires.push({ path: pts, cls }); },
      box(o) { it.boxes.push(o); return o; },
      label(x, y, text, cls = "", anchor = "middle") { it.labels.push({ x, y, text, cls, anchor }); },
      free(x, y, text, dir = "down") { it.frees.push({ x, y, text, dir }); },
      raw(s) { it.extra.push(s); },
    };
  }
  const pts = (p) => p.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
  function bounds(sc) {
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const add = (x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
    for (const w of sc.it.wires) for (const p of w.path) add(p[0], p[1]);
    for (const g of sc.it.agents) { const q = NK.agentBox(g.a); add(q.x0, q.y0); add(q.x1, q.y1); }
    for (const x of sc.it.boxes) { add(x.x, x.y - (x.titleAbove ? 12 : 0)); add(x.x + x.w, x.y + x.h); }
    for (const l of sc.it.labels) { const w = (l.text.replace(/<[^>]+>/g, "").length * 4.6); add(l.anchor === "start" ? l.x + w : l.anchor === "end" ? l.x - w : l.x + w / 2, l.y + 4); add(l.anchor === "start" ? l.x : l.anchor === "end" ? l.x : l.x - w / 2, l.y - 6); }
    for (const f of sc.it.frees) { add(f.x - 10, f.y - 14); add(f.x + 10, f.y + 14); }
    return b;
  }
  function render(sc, o = {}) {
    const b = bounds(sc), pad = o.pad ?? 18;
    const vb = [b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad];
    let s = `<svg class="cb-svg" viewBox="${vb.map((v) => v.toFixed(1)).join(" ")}" ${o.size ? `width="${o.size[0]}" height="${o.size[1]}"` : `width="${vb[2] * (o.scale || 1.5)}" height="${vb[3] * (o.scale || 1.5)}"`} preserveAspectRatio="xMidYMid meet">`;
    for (const x of sc.it.boxes) {
      if (x.open) s += `<g class="cb-hull${x.cls ? " " + x.cls : ""}" data-box="${esc(x.id || "")}"><rect class="cb-hull-hit" x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="8"/><rect class="cb-hull-line" x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="8"/>${x.id ? `<g class="cb-collapse" data-box="${esc(x.id)}" data-tip="Close it back into one box" transform="translate(${x.x + x.w - 10} ${x.y})"><rect x="-6" y="-6" width="12" height="12" rx="3"/><path d="M -3 0 H 3"/></g>` : ""}</g>`;
    }
    for (const w of sc.it.wires) s += `<polyline class="nk-halo" points="${pts(w.path)}"/><polyline class="nk-wire ${w.cls}" points="${pts(w.path)}"/>`;
    for (const x of sc.it.boxes) {
      if (x.open) continue;
      s += `<g class="cb-box${x.cls ? " " + x.cls : ""}${x.id ? " can" : ""}" ${x.id ? `data-box="${esc(x.id)}" data-tip="${esc(x.tip || "Open it")}"` : ""}><rect class="cb-box-o" x="${x.x}" y="${x.y}" width="${x.w}" height="${x.h}" rx="5"/><rect class="cb-box-i" x="${x.x + 2.5}" y="${x.y + 2.5}" width="${x.w - 5}" height="${x.h - 5}" rx="3"/>
        <text class="cb-box-t" x="${x.x + x.w / 2}" y="${x.y + (x.sub ? x.h / 2 - 5 : x.h / 2)}">${x.title}</text>${x.sub ? `<text class="cb-box-s" x="${x.x + x.w / 2}" y="${x.y + x.h / 2 + 7}">${x.sub}</text>` : ""}
        ${x.id ? `<g class="cb-expand" transform="translate(${x.x + x.w - 10} ${x.y})"><rect x="-6" y="-6" width="12" height="12" rx="3"/><path d="M -3 0 H 3 M 0 -3 V 3"/></g>` : ""}</g>`;
    }
    for (const g of sc.it.agents) s += `<g class="cb-ag ${g.cls}">${NK.agentShapeSVG(g.a, CT[g.type])}</g>`;
    for (const x of sc.it.boxes) if (x.open) s += `<text class="cb-hull-t" x="${x.x + 8}" y="${x.y - 5}">${x.title}</text>`;
    for (const f of sc.it.frees) s += `<circle cx="${f.x}" cy="${f.y}" r="2.4" class="nk-free"/><text x="${f.x}" y="${f.dir === "up" ? f.y - 9 : f.y + 11}" class="nk-free-label">${f.text}</text>`;
    for (const l of sc.it.labels) s += `<text class="cb-lab ${l.cls}" x="${l.x}" y="${l.y}" text-anchor="${l.anchor}">${l.text}</text>`;
    s += sc.it.extra.join("");
    return s + "</svg>";
  }

  /* ------------------------------------------------------------ one agent's cell (schematic) */
  // Parts, top to bottom, as Lafont builds [α] (translate.ts): the tip δ and the fork γ (T₁,₁),
  // the menu (one entry per kind of partner), the name tag (a selector that picks this agent's
  // entry from the partner's menu), the plug (a multiplexor holding the aux ports, the loop back
  // to the tip, and in the general case the code).
  function cellScene(app, sysKey, typeId, mode, open) {
    const { sys, tr, T } = sysInfo(app, sysKey);
    const ty = T[typeId], m = sys.types.length, n = ty.arity, i = sys.types.findIndex((t) => t.id === typeId);
    const parts = tr.parts[typeId][mode], general = mode === "general";
    const sc = Scene();
    const down = [0, 1], up = [0, -1], left = [-1, 0], right = [1, 0];
    // a chain of γ (a multiplexor) at a fixed x: γ k's aux port `restSlot` leads on to γ k+1
    function chain(x, y0, count, restSlot, step = 46) {
      const gs = [];
      for (let k = 0; k < count; k++) {
        const g = sc.agent("γ", x, y0 + k * step, "up");
        if (k) { const prev = gs[k - 1]; sc.wire(prev.ports[restSlot], down, g.ports[0], up); }
        gs.push(g);
      }
      return gs;
    }
    // principal port, tip and fork
    sc.free(0, -4, `<tspan class="pinl">principal</tspan>`, "up");
    const tip = sc.agent("δ", 0, 40, "up");
    sc.line([[0, -4], tip.ports[0]]);
    const fork = sc.agent("γ", 64, 100, "up");
    sc.wire(tip.ports[1], down, fork.ports[0], up);
    sc.label(-30, 44, "tip", "part", "end");
    sc.label(94, 104, "fork", "part", "start");
    // name tag (a selector): picks this agent's entry out of the partner's menu
    const tagX = -30, tagY = 156, tagW = 100;
    let tagOut;
    if (open.tag && m > 1) {
      const gx = tagX + 62, gs = chain(gx, tagY + 34, m - 1, 1);
      const h = 34 + (m - 1) * 46 + 34;
      sc.box({ id: "tag", open: true, x: tagX - 20, y: tagY, w: tagW + 40, h, title: `name tag · ${fmt(parts.selector)} · picks from the partner's menu` });
      sc.wire(fork.ports[2], down, gs[0].ports[0], up);
      gs.forEach((g, k) => {
        const lp = g.ports[2];
        if (k === i) { tagOut = lp; return; }
        sc.wire(lp, down, [lp[0] - 14, lp[1] + 16], [1, 0]); sc.agent("ε", lp[0] - 22, lp[1] + 16, "up");
        sc.label(lp[0] - 34, lp[1] + 16, symT(T, sys.types[k].id), "tiny", "end");
      });
      const last = gs[gs.length - 1].ports[1];
      if (i === m - 1) tagOut = last; else { sc.wire(last, down, [last[0] + 14, last[1] + 14], left); sc.agent("ε", last[0] + 22, last[1] + 14, "up"); sc.label(last[0] + 34, last[1] + 14, symT(T, sys.types[m - 1].id), "tiny", "start"); }
      var tagBottom = tagY + h;
      // the kept entry leaves along the left edge, clear of the chain
      const kx = tagX - 10;
      sc.line([tagOut, [tagOut[0], tagOut[1] + 6], [kx, tagOut[1] + 6], [kx, tagBottom]]);
      sc.label(kx + 6, tagBottom - 9, `keeps entry ${i + 1} of ${m}: ${symT(T, typeId)}`, "tiny", "start");
      tagOut = [kx, tagBottom];
    } else {
      sc.box({ id: m > 1 ? "tag" : null, x: tagX, y: tagY, w: tagW, h: 40, title: "name tag", sub: m > 1 ? `says "${esc(ty.symbol)}" · ${parts.selector}` : "one kind: just a wire", tip: "Open the name tag: the γ and ε that pick this agent's entry out of the partner's menu" });
      sc.wire(fork.ports[2], down, [tagX + tagW / 2, tagY], up);
      var tagBottom = tagY + 40; tagOut = [tagX + tagW / 2, tagBottom];
    }
    if (!(open.tag && m > 1)) { sc.label(tagX - 12, tagY + 14, "picks from the", "note", "end"); sc.label(tagX - 12, tagY + 24, "partner's menu", "note", "end"); }
    // plug (a multiplexor): the code, the aux ports and the loop back to the tip
    const plugY = tagBottom + 44, plugX = tagX, plugW = tagW;
    const leafNames = [...(general ? ["code"] : []), ...Array.from({ length: n }, (_, k) => "aux" + (k + 1)), "loop"];
    const outs = {};
    let plugBottom;
    if (open.plug && leafNames.length > 1) {
      const gx = plugX + plugW / 2, gs = chain(gx, plugY + 34, leafNames.length - 1, 2);
      const h = 34 + (leafNames.length - 1) * 46 + 24;
      sc.box({ id: "plug", open: true, x: plugX - 20, y: plugY, w: plugW + 40, h, title: `plug · ${leafNames.length - 1} γ` });
      sc.wire(tagOut, down, gs[0].ports[0], up);
      leafNames.forEach((nm, k) => { outs[nm] = k < gs.length ? gs[k].ports[1] : gs[gs.length - 1].ports[2]; });
      plugBottom = plugY + h;
      const L = outs.loop; sc.line([L, [L[0], L[1] + 8], [plugX - 20, L[1] + 8]]); outs.loop = [plugX - 20, L[1] + 8];
      if (general) { const c = outs.code; sc.line([c, [c[0], c[1] + 6], [plugX + plugW + 20, c[1] + 6]]); outs.code = [plugX + plugW + 20, c[1] + 6]; }
      for (let k = 1; k <= n; k++) { const q = outs["aux" + k]; sc.line([q, [q[0], plugBottom]]); outs["aux" + k] = [q[0], plugBottom]; }
    } else {
      sc.box({ id: leafNames.length > 1 ? "plug" : null, x: plugX, y: plugY, w: plugW, h: 40, title: "plug", sub: leafNames.length > 1 ? `${general ? "code, " : ""}${n ? "ports, " : ""}loop · ${leafNames.length - 1}` : "only the loop: a wire", tip: "Open the plug: the γ that hold the agent's aux ports, the loop back to the tip" + (general ? " and the code" : "") });
      sc.wire(tagOut, down, [plugX + plugW / 2, plugY], up);
      plugBottom = plugY + 40;
      outs.loop = [plugX, plugY + 20];
      if (general) outs.code = [plugX + plugW, plugY + 20];
      for (let k = 1; k <= n; k++) outs["aux" + k] = [plugX + (k / (n + 1)) * plugW, plugBottom];
    }
    // the agent's own aux ports come out at the bottom
    for (let k = 1; k <= n; k++) { const q = outs["aux" + k], fx = plugX + 16 + (n - k) * 34; sc.wire(q, down, [fx, plugBottom + 46], up); sc.free(fx, plugBottom + 46, `<tspan class="pinl">aux ${k}</tspan>`, "down"); }
    // the loop: from the tip's other port, down the left, into the plug
    const railX = Math.min(plugX, tagX) - 70;
    const lp = outs.loop, t2 = tip.ports[2];
    sc.it.wires.push({ path: [t2, ...NK.curve(t2, down, [railX, t2[1] + 46], up, 12).slice(1), [railX, lp[1] - 16], ...NK.curve([railX, lp[1] - 16], down, lp, left, 8).slice(1)], cls: "" });
    sc.label(railX - 6, (t2[1] + lp[1]) / 2, "loop", "part", "end");
    // the menu, on the right: one entry for each kind of partner
    const mx = 150, my = 156;
    const pairs = app.raw.systems[sysKey].pairs, ruleOf = (b) => { const e = pairs[typeId + "|" + b] || pairs[b + "|" + typeId]; return !!(e && e.has); };
    const pkgs = sys.types.map((t) => ({ t, size: parts.packages[t.id] || 1, made: madeBy(app, sysKey, typeId, t.id), rule: ruleOf(t.id) }));
    let menuBottom;
    if (open.menu) {
      const gx = mx + 26, gs = chain(gx, my + 34, m - 1, 2);
      const h = 34 + (m - 1) * 46 + 46;
      sc.box({ id: "menu", open: true, x: mx, y: my, w: 300, h, title: `menu · ${fmt(parts.menu)} · what to build, for each partner` });
      sc.wire(fork.ports[1], down, gs[0].ports[0], up);
      pkgs.forEach((p, k) => {
        let q, ry;
        if (k < m - 1) { q = gs[k].ports[1]; ry = q[1] + 7; sc.line([q, [q[0], ry], [gx + 44, ry]]); }
        else { q = gs[m - 2].ports[2]; ry = q[1] + 37; sc.line([q, [q[0], ry], [gx + 44, ry]]); }
        const px = gx + 44;
        if (p.size <= 1) { sc.agent("ε", px + 8, ry, "up"); sc.label(px + 22, ry, `meets ${symT(T, p.t.id)}: <tspan class="faint">${p.rule ? "the rule creates nothing, so just an ε" : "no rule, so an ε"}</tspan>`, "pk", "start"); }
        else { sc.box({ x: px, y: ry - 11, w: 150, h: 22, title: `meets ${symT(T, p.t.id)}: builds ${p.made.length ? p.made.map((x) => symT(T, x)).join(" ") : "only wires"}`, cls: "pkg" }); sc.label(px + 156, ry, fmt(p.size), "num", "start"); }
      });
      menuBottom = my + h;
    } else {
      sc.box({ id: "menu", x: mx, y: my, w: 150, h: 40, title: "menu", sub: `${m} entr${m === 1 ? "y" : "ies"} · ${fmt(parts.menu)}`, tip: "Open the menu: one entry for each kind of agent it might meet" });
      sc.wire(fork.ports[1], down, [mx + 30, my], up);
      sc.label(mx, my + 52, "what to build, for each partner", "note", "start");
      menuBottom = my + 56;
    }
    // the code (general case), below the menu
    if (general) {
      const cy = Math.max(outs.code[1] - 20, menuBottom + 40), cx = mx;
      if (open.code) {
        const cw = Math.max(40 + m * 24 + 20, 220), ch = 44 + m * 22 + 30;
        sc.box({ id: "code", open: true, x: cx, y: cy, w: cw, h: ch, title: `code · ${fmt(parts.code)}` });
        sc.wire(outs.code, right, [cx, cy + 20], left);
        const gx = cx + 40, gy = cy + 30;
        sys.types.forEach((ta, r) => {
          sc.label(gx - 8, gy + r * 22 + 9, symT(T, ta.id), "tiny", "end");
          sys.types.forEach((tb, c) => {
            const has = (tr.parts[ta.id][mode].packages[tb.id] || 1) > 1;
            sc.raw(`<rect class="cb-code-cell${has ? " has" : ""}" x="${gx + c * 24}" y="${gy + r * 22}" width="20" height="18" rx="3"><title>${esc(ta.symbol)} meeting ${esc(tb.symbol)}${has ? "" : ": no rule"}</title></rect>`);
          });
        });
        sys.types.forEach((tb, c) => sc.label(gx + c * 24 + 10, gy - 7, symT(T, tb.id), "tiny"));
        sc.label(cx + 10, cy + ch - 18, "Every agent's menu, rows by agent, with the δ", "note", "start");
        sc.label(cx + 10, cy + ch - 8, "taken out so that a δ can copy it.", "note", "start");
      } else {
        sc.box({ id: "code", x: cx, y: cy, w: 150, h: 40, title: "code", sub: `${fmt(parts.code)} combinators`, cls: "code", tip: "Open the code: the whole rule table, folded into γ and ε" });
        sc.wire(outs.code, right, [cx, cy + 20], left);
        sc.label(cx, cy + 52, "a copy of the whole rule table", "note", "start");
      }
    }
    return sc;
  }
  const symT = (T, id) => `<tspan class="sym">${esc((T[id] || { symbol: id }).symbol)}</tspan>`;
  function madeBy(app, sysKey, a, b) {
    const pairs = app.raw.systems[sysKey].pairs, e = pairs[a + "|" + b] || pairs[b + "|" + a];
    return e && e.has ? e.created : [];
  }

  /* ------------------------------------------------------------ a whole cell view (schematic, or the real net for small systems) */
  function CellView(app, host, o) {
    const st = { sysKey: o.sysKey, typeId: o.typeId, mode: o.mode, open: {}, real: false, realView: null };
    function realState() { const r = app.raw.realNets && app.raw.realNets[st.sysKey]; return r && r.cells[st.typeId] && r.cells[st.typeId][st.mode]; }
    function draw() {
      const { tr, T } = sysInfo(app, st.sysKey);
      const ty = T[st.typeId];
      if (tr.identity) {
        host.innerHTML = `<div class="cb-id">${NK.glyph(ty, { size: 110, labels: true })}<p><span class="sym">${esc(ty.symbol)}</span> already is a combinator, so its cell is just itself.</p></div>`;
        o.onDraw && o.onDraw(st); return;
      }
      const parts = tr.parts[st.typeId][st.mode];
      const real = realState();
      const head = `<div class="cb-cellhead"><div><b>The cell of <span class="sym">${esc(ty.symbol)}</span></b> <span class="muted">${fmt(parts.total)} combinators${st.mode === "general" ? `, ${fmt(parts.code)} of them the code` : ""}</span></div>
        <div class="seg sm" role="group" aria-label="Drawing"><button aria-pressed="${!st.real}" data-draw="schem">Parts</button><button aria-pressed="${st.real}" data-draw="real" ${real ? "" : `aria-disabled="true"`}>Every combinator</button></div></div>
        ${real ? "" : `<div class="cb-why" data-why="real">Every combinator: ${fmt(parts.total)} is too many to draw readably, so this shows the cell's parts. Open a part to see inside. The smallest examples ("Two annihilating tokens", "Erasing without commutation") draw every one.</div>`}`;
      if (st.real && real) {
        host.innerHTML = head + `<div class="cb-real" data-real></div><div class="cb-foot muted">Laid out by the engine. Its ports are the loose ends: <i>p0</i> is the principal port.</div>`;
        const rv = new NK.View(host.querySelector("[data-real]"), { tips: false, firePill: false, maxFit: 2.4, fitPad: { t: 30, r: 30, b: 30, l: 30 } });
        rv.setContext({ types: Object.values(CT), rules: COMB_RULES }); rv.setLayout("manual");
        rv.setState(NK.hydrate(real, CT), { fit: true });
        host.querySelector("[data-real]").addEventListener("pointerdown", (e) => { if (e.button === 0) e.stopPropagation(); }, true);
      } else {
        const sc = cellScene(app, st.sysKey, st.typeId, st.mode, st.open);
        host.innerHTML = head + `<div class="cb-draw">${render(sc, { scale: o.scale || 1.35 })}</div>`;
        host.querySelectorAll("[data-box]").forEach((b) => {
          const id = b.dataset.box; if (!id) return;
          const toggle = (e) => { e.stopPropagation(); st.open[id] = !st.open[id]; draw(); o.onChange && o.onChange(st); };
          if (b.classList.contains("cb-collapse") || b.classList.contains("cb-box")) b.addEventListener("click", toggle);
          if (b.classList.contains("cb-hull")) b.addEventListener("dblclick", toggle);
        });
      }
      host.querySelectorAll("[data-draw]").forEach((b) => (b.onclick = () => { if (b.getAttribute("aria-disabled") === "true") { const w = host.querySelector('[data-why="real"]'); if (w) { w.classList.remove("pulse"); void w.offsetWidth; w.classList.add("pulse"); } return; } st.real = b.dataset.draw === "real"; draw(); }));
      o.onDraw && o.onDraw(st);
    }
    draw();
    return { st, draw, set(p) { Object.assign(st, p); if (p.typeId || p.mode || p.sysKey) st.open = p.open || {}; draw(); }, closeAll() { st.open = {}; draw(); } };
  }

  /* ------------------------------------------------------------ one rule, played out in combinators */
  // Stages of Lafont's construction when two cells meet. Each names the kind of interaction it is.
  function stagesFor(app, sysKey, key, mode) {
    const { T, sym, tr } = sysInfo(app, sysKey);
    const [L, R] = key.split("|"), general = mode === "general";
    const made = madeBy(app, sysKey, L, R);
    const cost = tr.rules && tr.rules[key] && tr.rules[key][mode];
    const s = [
      { id: "meet", title: "Two cells meet", say: `The cell of ${sym(L)} and the cell of ${sym(R)} touch tip to tip. Their tips are both δ, so they react first.`, fires: "δ meets δ", kind: "annihilate", n: 1 },
      { id: "tips", title: "The tips cancel", say: `δ meets δ: they disappear and join their wires straight across. Now the two forks face each other, and each cell's loop is joined to the other's.`, fires: "γ meets γ", kind: "annihilate", n: 1 },
      { id: "forks", title: "The forks cancel, crosswise", say: `γ meets γ: they disappear and join their wires crosswise. So each cell's menu now faces the other cell's name tag.`, fires: "name tag meets menu", kind: "erase" },
      { id: "pick", title: "Each name tag picks an entry", say: `The name tag of ${sym(R)} picks the entry "meets ${sym(R)}" out of ${sym(L)}'s menu, and the other way round. Every other entry is erased by an ε: most of the erasing happens here.`, fires: "entry meets plug", kind: "annihilate" },
      { id: "plug", title: "The entries plug in", say: `Each picked entry meets the other cell's plug and takes over its aux wires. The two entries also join up across the loop, so the pieces they hold are wired to each other the way the rule says.`, fires: general ? "code meets δ" : null, kind: "annihilate" },
    ];
    if (general) s.push({ id: "code", title: "The code is copied and read", say: `What the entries hold aren't cells yet, only cells waiting for their code. The other cell's code arrives through the plug; δ copies it once for each new agent, and each copy is read back into a menu.`, fires: null, kind: "copy" });
    s.push({ id: "done", title: made.length ? "The cells of the result" : "Done: nothing is left but wires", say: made.length ? `What's left is ${made.length === 1 ? "the cell" : "the cells"} of ${made.map(sym).join(" and ")}, wired like the rule's result. The combinators took ${cost ? fmt(cost.total) : "many"} interactions to do what one step does in your net.` : `The rule creates nothing, so what's left is just wires between the interface ends. That took ${cost ? fmt(cost.total) : "many"} combinator interactions.`, fires: null });
    return { stages: s, cost, made };
  }
  // A compact cell for the rule stages, drawn in local coordinates with its principal port
  // facing up (the bottom cell); the top cell is the same picture turned half a turn.
  function compactCell(sc, cy, rot) {
    const P = (x, y) => (rot ? [x, cy + y] : [-x, cy - y]);
    const D = (dx, dy) => (rot ? [dx, dy] : [-dx, -dy]);
    const or = rot ? "up" : "down";
    const box = (x0, y0, x1, y1) => { const [ax, ay] = P(x0, y0), [bx, by] = P(x1, y1); return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }; };
    const L = {
      tag: [-26, 108, 34, 138], menu: [62, 108, 132, 138], plug: [-26, 166, 34, 196], code: [62, 166, 132, 196],
      tagTop: [4, 108], tagBottom: [4, 138], menuTop: [97, 108], plugTop: [4, 166], plugLeft: [-26, 181], plugRight: [34, 181], codeLeft: [62, 181], rail: -54,
    };
    const c = { rot, P, D, L, parts: {} };
    c.tip = (cls) => (c.parts.tip = sc.agent("δ", ...P(0, 20), or, cls));
    c.fork = (cls) => (c.parts.fork = sc.agent("γ", ...P(44, 72), or, cls));
    c.box = (name, title, cls = "", sub = "") => { const r = { ...box(...L[name]), title, sub, cls }; sc.box(r); return r; };
    c.w = (a, da, b, db, cls = "") => sc.wire(P(...a), D(...da), P(...b), D(...db), cls);
    c.inner = (o) => {
      if (o.tip && o.fork) c.w([8, 35], [0, 1], [44, 57], [0, -1]);
      if (o.fork) { c.w([52, 87], [0, 1], L.menuTop, [0, -1]); c.w([36, 87], [0, 1], L.tagTop, [0, -1]); }
      if (o.tag && o.plug) c.w(L.tagBottom, [0, 1], L.plugTop, [0, -1]);
      if (o.code && o.plug) c.w(L.plugRight, [1, 0], L.codeLeft, [-1, 0]);
    };
    // the loop, from the plug up the outside; `to` is where its top end goes
    c.loop = (top) => { const path = [P(...L.plugLeft), P(L.rail + 12, 181), ...NK.curve(P(L.rail + 12, 181), D(-1, 0), P(L.rail, 160), D(0, 1), 6).slice(1), P(L.rail, top)]; sc.line(path); return P(L.rail, top); };
    c.iface = (n, names) => { for (let k = 0; k < n; k++) { const px = 34 - (k + 1) * (60 / (n + 1)), fx = 40 - k * 26; sc.wire(P(px, 196), D(0, 1), P(fx, 250), D(0, -1)); const [X, Y] = P(fx, 250); sc.free(X, Y, `<tspan class="pinl">${names[k]}</tspan>`, rot ? "down" : "up"); } };
    return c;
  }
  // The rule's result as the engine lays it out, each new agent drawn as a cell box.
  function rhsInto(sc, app, sysKey, key, style) {
    const sys = app.raw.systems[sysKey], e = sys.pairs[key];
    const types = Object.fromEntries(sys.types.map((t) => [t.id, { ...t, circle: t.arity === 0 }]));
    const st = NK.hydrate(e.rhs, types), bx = [];
    for (const w of st.wires) sc.line(w.path);
    for (const a of st.agents) {
      const q = NK.agentBox(a), w = Math.max(36, q.x1 - q.x0 + 6), h = 26, cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2;
      const r = { x: cx - w / 2, y: cy - h / 2, w, h, title: `<tspan class="sym">${style === "waiting" ? "⟨" : "["}${esc(types[a.type].symbol)}${style === "waiting" ? "⟩" : "]"}</tspan>`, cls: style === "waiting" ? "waiting" : style === "hot" ? "cellbox hot" : "cellbox" };
      sc.box(r); bx.push(r);
    }
    for (const f of st.free) sc.free(f.x, f.y, `<tspan class="pinl">${app.pinLabel(f.name)}</tspan>`, f.dir);
    return { st, boxes: bx, b: NK.stateBounds(st) };
  }
  const mid = (b, side) => side === "top" ? [b.x + b.w / 2, b.y] : side === "bottom" ? [b.x + b.w / 2, b.y + b.h] : side === "left" ? [b.x, b.y + b.h / 2] : [b.x + b.w, b.y + b.h / 2];
  function stageScene(app, sysKey, key, mode, stageId) {
    const { T, sys } = sysInfo(app, sysKey);
    const [Lt, Rt] = key.split("|"), general = mode === "general", sc = Scene();
    const tl = (id) => `<tspan class="sym">${esc((T[id] || { symbol: id }).symbol)}</tspan>`;
    const nA = T[Lt].arity, nB = T[Rt].arity, sub = (c, k) => c + "₀₁₂₃₄₅"[k + 1];
    const top = compactCell(sc, -14, 0), bot = compactCell(sc, 14, 1);
    const both = (f) => { f(top); f(bot); };
    const label = () => { sc.label(-200, -205, `cell of ${tl(Lt)}`, "cellname", "start"); sc.label(-200, 205, `cell of ${tl(Rt)}`, "cellname", "start"); };
    if (stageId === "meet" || stageId === "tips" || stageId === "forks" || stageId === "pick") {
      const has = { tip: stageId === "meet", fork: stageId === "meet" || stageId === "tips", tag: stageId !== "pick", plug: true, code: general };
      both((c) => {
        if (has.tip) c.tip("hot");
        if (has.fork) c.fork(stageId === "tips" ? "hot" : "");
        if (has.tag) c.box("tag", "name tag");
        c.box("menu", stageId === "pick" ? `meets ${tl(c === top ? Rt : Lt)}` : "menu", stageId === "pick" ? "picked" : "");
        c.box("plug", "plug");
        if (general) c.box("code", "code", "code");
        c.inner({ tip: has.tip, fork: has.fork, tag: has.tag, plug: true, code: general });
        c.iface(c === top ? nA : nB, Array.from({ length: c === top ? nA : nB }, (_, k) => sub(c === top ? "x" : "y", k)));
      });
      if (stageId === "meet") {
        sc.line([top.P(0, 5), bot.P(0, 5)], "hot");
        both((c) => { const t = c.loop(70); sc.wire(c.P(-8, 35), c.D(0, 1), t, c.D(0, -1)); });
      } else {
        // the two loops, joined across when the tips cancelled
        const a = top.loop(70), b = bot.loop(70);
        sc.wire(a, top.D(0, -1), b, bot.D(0, -1));
        if (stageId === "tips") sc.line([top.P(44, 57), bot.P(44, 57)], "hot");
        if (stageId === "forks") { sc.wire(top.P(...top.L.menuTop), top.D(0, -1), bot.P(...bot.L.tagTop), bot.D(0, -1), "hot"); sc.wire(top.P(...top.L.tagTop), top.D(0, -1), bot.P(...bot.L.menuTop), bot.D(0, -1), "hot"); }
        if (stageId === "pick") {
          sc.wire(top.P(...top.L.menuTop), top.D(0, -1), bot.P(...bot.L.plugTop), bot.D(0, -1), "hot");
          sc.wire(bot.P(...bot.L.menuTop), bot.D(0, -1), top.P(...top.L.plugTop), top.D(0, -1), "hot");
          const m = sys.types.length;
          for (const c of [top, bot]) { const [x, y] = c.P(140, 123); sc.label(x, y, `${m - 1} other entr${m - 1 === 1 ? "y" : "ies"} erased`, "erased", c.rot ? "start" : "end"); }
        }
      }
      label();
      return sc;
    }
    if (stageId === "plug" || stageId === "code") {
      const r = rhsInto(sc, app, sysKey, key, general && stageId === "plug" ? "waiting" : "hot");
      if (general && stageId === "plug" && r.boxes.length) {
        // the other cell's code comes in through the plug; a δ copies it for each new cell
        const b = r.b, cx = b.x1 + 70, cy = (b.y0 + b.y1) / 2;
        const code = { x: cx - 35, y: cy - 15, w: 70, h: 30, title: "code", sub: "", cls: "code" }; sc.box(code);
        const d = sc.agent("δ", cx - 60, cy + 40, "up", "hot");
        sc.wire(mid(code, "bottom"), [0, 1], d.ports[0], [0, -1], "hot");
        r.boxes.forEach((x, k) => sc.wire(d.ports[1 + (k % 2)], [0, 1], mid(x, "right"), [1, 0]));
        sc.label(cx - 35, cy - 26, "the code, from the other cell", "note", "start");
      }
      if (!r.boxes.length) sc.label((r.b.x0 + r.b.x1) / 2, (r.b.y0 + r.b.y1) / 2, "only wires: the rule creates nothing", "note");
      return sc;
    }
    return null;
  }
  function RulePlayer(app, host, o) {
    const st = { sysKey: o.sysKey, key: o.key, mode: o.mode, i: 0, playing: false, real: false, ri: 0 };
    let timer = 0, realView = null;
    function realStates() { const r = app.raw.realNets && app.raw.realNets[st.sysKey]; return r && r.rules[st.key] && r.rules[st.key][st.mode]; }
    function draw() {
      const { T, tr, sym } = sysInfo(app, st.sysKey);
      const [L, R] = st.key.split("|");
      if (tr.identity) {
        host.innerHTML = `<div class="cb-id"><p>${sym(L)} and ${sym(R)} already are combinators: this rule is one combinator step.</p></div>`;
        return;
      }
      const { stages, cost } = stagesFor(app, st.sysKey, st.key, st.mode);
      const reals = realStates();
      if (st.real && reals) return drawReal(reals, cost);
      st.i = Math.max(0, Math.min(stages.length - 1, st.i));
      const S0 = stages[st.i], last = st.i === stages.length - 1;
      let pic = "";
      if (S0.id === "done") {
        const pairs = app.raw.systems[st.sysKey].pairs, e = pairs[st.key];
        const types = Object.fromEntries(app.raw.systems[st.sysKey].types.map((t) => [t.id, { ...t, circle: t.arity === 0 }]));
        const rhs = NK.hydrate(e.rhs, types);
        pic = `<div class="cb-draw">${cellsOfState(rhs, types, app, { scale: 2.4 })}</div>`;
      } else pic = `<div class="cb-draw">${render(stageScene(app, st.sysKey, st.key, st.mode, S0.id), { scale: (S0.id === "plug" || S0.id === "code" ? 2 : 1) * (o.scale || 1.25) })}</div>`;
      const why = { back: st.i === 0 ? "Back: this is the start, the two cells just about to meet." : null, step: last ? "Step: done. These are the cells of the result; Back or Replay to see it again." : null };
      host.innerHTML = `<div class="cb-rulehead"><div><b>${sym(L)} meets ${sym(R)}, in combinators</b> <span class="muted">${cost ? `${fmt(cost.total)} interactions` : ""}</span></div>
          <div class="seg sm"><button aria-pressed="${!st.real}" data-draw="schem">In stages</button><button aria-pressed="false" data-draw="real" ${reals ? "" : `aria-disabled="true"`}>Every interaction</button></div></div>
        ${cost ? costHTML(cost) : ""}
        <div class="cb-stage"><div class="cb-stagehead"><span class="cb-stepn">${st.i + 1} / ${stages.length}</span><b>${S0.title}</b></div><p>${S0.say}</p>${S0.fires ? `<p class="cb-next"><span class="hotdot"></span>Next: ${esc(S0.fires)}.</p>` : ""}</div>
        ${pic}
        <div class="cb-ctl">
          <button class="btn ghost" data-c="back" ${why.back ? `aria-disabled="true"` : ""}>${app.ICON.left}Back</button>
          <button class="btn ghost" data-c="step" ${why.step ? `aria-disabled="true"` : ""}>Step${app.ICON.right}</button>
          <button class="btn ghost" data-c="play">${st.playing ? "Pause" : last ? "Replay" : "Play slowly"}</button>
          <div class="cb-dots">${stages.map((x, k) => `<button class="cb-dot${k === st.i ? " on" : ""}${k < st.i ? " done" : ""}" data-k="${k}" data-tip="${esc(x.title)}"></button>`).join("")}</div>
        </div>
        <div class="cb-whys">${[why.back, why.step].filter(Boolean).map((w) => `<div class="cb-why">${w}</div>`).join("")}${reals ? "" : `<div class="cb-why">Every interaction: ${cost ? fmt(cost.total) : "thousands of"} steps between ${cost ? fmt(cost.size) : "hundreds of"} combinators can't be drawn readably, so this shows them in stages. "Two annihilating tokens" and "Erasing without commutation" show every one.</div>`}</div>`;
      bind(stages.length);
    }
    function drawReal(states, cost) {
      const { sym } = sysInfo(app, st.sysKey);
      const [L, R] = st.key.split("|");
      st.ri = Math.max(0, Math.min(states.length - 1, st.ri));
      const cur = states[st.ri], last = st.ri === states.length - 1;
      const kindWord = { annihilate: "Two of the same kind meet and cancel, joining their wires", erase: "An ε meets something and erases it", copy: "γ meets δ: they pass through each other, copying" };
      const why = { back: st.ri === 0 ? "Back: this is the start, before the first interaction." : null, step: last ? "Step: nothing left to fire. This is the translation of the rule's result." : null };
      host.innerHTML = `<div class="cb-rulehead"><div><b>${sym(L)} meets ${sym(R)}, in combinators</b> <span class="muted">${fmt(cur.agents.length)} combinators</span></div>
          <div class="seg sm"><button aria-pressed="false" data-draw="schem">In stages</button><button aria-pressed="true" data-draw="real">Every interaction</button></div></div>
        ${cost ? costHTML(cost) : ""}
        <div class="cb-stage"><div class="cb-stagehead"><span class="cb-stepn">${st.ri} / ${states.length - 1}</span><b>${last ? "Done" : `Next: ${kindWord[cur.kind] || ""}`}</b></div><p>${last ? "No two combinators face each other any more. What's left is the translation of the rule's result." : "The pair about to fire is marked. Step fires it, exactly as the engine would."}</p></div>
        <div class="cb-real" data-real></div>
        <div class="cb-ctl">
          <button class="btn ghost" data-c="back" ${why.back ? `aria-disabled="true"` : ""}>${app.ICON.left}Back</button>
          <button class="btn ghost" data-c="step" ${why.step ? `aria-disabled="true"` : ""}>Step${app.ICON.right}</button>
          <button class="btn ghost" data-c="play">${st.playing ? "Pause" : last ? "Replay" : "Play slowly"}</button>
        </div>
        <div class="cb-whys">${[why.back, why.step].filter(Boolean).map((w) => `<div class="cb-why">${w}</div>`).join("")}</div>`;
      const host2 = host.querySelector("[data-real]");
      realView = new NK.View(host2, { tips: false, firePill: false, maxFit: 2.4, fitPad: { t: 24, r: 24, b: 24, l: 24 } });
      realView.setContext({ types: Object.values(CT), rules: COMB_RULES }); realView.setLayout("manual");
      realView.setState(NK.hydrate(cur, CT), { fit: true });
      if (cur.fires != null) realView.setHighlight({ wires: [cur.fires] });
      host2.addEventListener("pointerdown", (e) => { if (e.button === 0) e.stopPropagation(); }, true);
      bind(states.length, true);
    }
    function bind(n, real) {
      const go = (d) => { if (real) st.ri += d; else st.i += d; draw(); o.onChange && o.onChange(st); };
      host.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => {
        if (b.getAttribute("aria-disabled") === "true") { const ws = host.querySelector(".cb-whys"); ws && ws.classList.remove("pulse"); void (ws && ws.offsetWidth); ws && ws.classList.add("pulse"); return; }
        const c = b.dataset.c;
        if (c === "back") { stop(); go(-1); }
        else if (c === "step") { stop(); go(1); }
        else if (c === "play") {
          if (st.playing) return stop(), draw();
          if ((real ? st.ri : st.i) >= n - 1) { if (real) st.ri = 0; else st.i = 0; }
          st.playing = true; draw();
          const tick = () => { if (!st.playing) return; if ((real ? st.ri : st.i) >= n - 1) { st.playing = false; draw(); return; } go(1); timer = setTimeout(tick, real ? 700 : 2400); };
          timer = setTimeout(tick, real ? 500 : 1600);
        }
      }));
      host.querySelectorAll(".cb-dot").forEach((b) => (b.onclick = () => { stop(); st.i = +b.dataset.k; draw(); }));
      host.querySelectorAll("[data-draw]").forEach((b) => (b.onclick = () => {
        if (b.getAttribute("aria-disabled") === "true") { const ws = host.querySelector(".cb-whys"); ws && ws.classList.remove("pulse"); void (ws && ws.offsetWidth); ws && ws.classList.add("pulse"); return; }
        stop(); st.real = b.dataset.draw === "real"; st.ri = 0; draw();
      }));
    }
    function stop() { st.playing = false; clearTimeout(timer); }
    draw();
    return { st, draw, set(p) { stop(); Object.assign(st, p); if (p.key || p.mode || p.sysKey) { st.i = 0; st.ri = 0; } draw(); }, stop, destroy: stop };
  }
  // A net with each agent drawn as its cell: a box [S].
  function cellsOfState(state, types, app, o = {}) {
    let s = "";
    const b = NK.stateBounds(state), pad = 22;
    for (const w of state.wires) s += `<polyline class="nk-halo" points="${pts(w.path)}"/><polyline class="nk-wire" points="${pts(w.path)}"/>`;
    for (const a of state.agents) {
      const q = NK.agentBox(a), w = Math.max(34, q.x1 - q.x0 + 8), h = 26, cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2;
      s += `<g class="cb-box cellbox"><rect class="cb-box-o" x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="5"/><rect class="cb-box-i" x="${cx - w / 2 + 2.5}" y="${cy - h / 2 + 2.5}" width="${w - 5}" height="${h - 5}" rx="3"/><text class="cb-box-t sym" x="${cx}" y="${cy}">[${esc(types[a.type].symbol)}]</text></g>`;
    }
    for (const f of state.free) s += `<circle cx="${f.x}" cy="${f.y}" r="2.4" class="nk-free"/><text x="${f.x}" y="${f.dir === "up" ? f.y - 9 : f.y + 11}" class="nk-free-label"><tspan class="pinl">${app.pinLabel(f.name)}</tspan></text>`;
    const vb = [b.x0 - pad - 10, b.y0 - pad, b.x1 - b.x0 + 2 * pad + 20, b.y1 - b.y0 + 2 * pad];
    return `<svg class="cb-svg" viewBox="${vb.join(" ")}" width="${vb[2] * (o.scale || 1.6)}" height="${vb[3] * (o.scale || 1.6)}">${s}</svg>`;
  }

  /* ------------------------------------------------------------ restricted / general switch, with the reason in place */
  function modeSwitchHTML(app, sysKey, mode) {
    const v = verdict(app, sysKey), { tr } = sysInfo(app, sysKey);
    if (tr.identity) return `<div class="cb-verdict">${v.html}</div>`;
    const ok = tr.restricted.ok;
    return `<div class="cb-modes">
        <div class="seg" role="group" aria-label="Translation"><button data-mode="restricted" aria-pressed="${mode === "restricted"}" ${ok ? "" : `aria-disabled="true"`}>Restricted</button><button data-mode="general" aria-pressed="${mode === "general"}">General</button></div>
      </div>
      <dl class="cb-defs"><dt${mode === "restricted" ? ` class="on"` : ""}>Restricted</dt><dd${mode === "restricted" ? ` class="on"` : ""}>${MODES.restricted.one}</dd><dt${mode === "general" ? ` class="on"` : ""}>General</dt><dd${mode === "general" ? ` class="on"` : ""}>${MODES.general.one}</dd></dl>
      <div class="cb-verdict${ok ? "" : " no"}" data-why="restricted">${v.html}</div>`;
  }
  function bindModeSwitch(root, onMode) {
    root.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => {
      if (b.getAttribute("aria-disabled") === "true") { const w = root.querySelector('[data-why="restricted"]'); if (w) { w.classList.remove("pulse"); void w.offsetWidth; w.classList.add("pulse"); } return; }
      onMode(b.dataset.mode);
    }));
  }

  window.EdComb = { INTRO, MODES, verdict, sysInfo, CellView, RulePlayer, modeSwitchHTML, bindModeSwitch, cellsOfState, costHTML, stagesFor, CT, COMB_RULES, fmt };
})();
