/* edkit-panel.js: the large floating panel the editors live in, and the
   editors' canvases. Shared by every round 3 direction; each direction gives
   the panel its own frame (where the title and buttons go), its own place
   on screen and its own rule-editor layout. Throwaway prototype code.

   Decided behaviour, the same everywhere:
   - a click outside closes the panel; with unsaved changes it doesn't, and
     the Save and Cancel buttons flash instead;
   - ⌘Z / ⌘⇧Z undo and redo inside the panel while it's open; saving puts the
     whole change into the main history as one step;
   - Escape clears the panel's selection, then closes (or flashes);
   - ⌘↵ saves. */
(function () {
  "use strict";
  const NK = NetKit, esc = NK.esc, clone = NK.clone;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ------------------------------------------------------------ an editor canvas: a View with its own history */
  function EditorCanvas(app, host, o = {}) {
    const TY = app.TY;
    let problems = null;
    const v = new NK.View(host, {
      selectWireKey: "alt", hoverRing: true, tips: false, firePill: false,
      pins: !!o.pins, maxFit: o.maxFit || 2.2,
      fitPad: o.fitPad || { t: 46, r: 46, b: 46, l: 46 },
      emptyHTML: o.emptyHTML || "Drag an agent in from the palette.",
      freeLabel: (f) => (f.pin || o.pinLabels ? `<tspan class="pinl">${app.pinLabel(f.name)}</tspan>` : esc(f.name)),
      typing: { endType: (vv, e) => TY.endType(vv, e), clash: (vv, D, e) => TY.clash(vv, D, e) },
      plugFits: (vv, typeId, t) => !TY.compare(TY.portOf(typeId, 0), TY.endType(vv, t.free != null ? { free: t.free } : { agent: t.agent, slot: t.slot })),
      hooks: app.makeHooks(TY, { overlay: (vv) => (o.overlay ? o.overlay(vv) : "") }),
    });
    v.readonly = !!o.readonly;
    v.setContext({ types: o.types(), rules: o.rules ? o.rules() : [] });
    v.setLayout("manual");
    if (o.readonly) host.addEventListener("pointerdown", (e) => { if (e.button === 0) { e.stopPropagation(); e.preventDefault(); } }, true);
    app.views.push(v);
    app.attachHover(v);
    if (!o.readonly) app.attachSel(v);
    v.on("hover", () => (app.focusPointer = v));
    v.on("hint", (h) => app.toast(h.kind === "refuse" ? "Not connected. " + h.text : h.text));
    v.on("fire", () => {});
    // history
    let stack = [], at = 0;
    const snap = () => clone(v.state);
    const ser = (st) => JSON.stringify([st.agents.map((a) => [a.id, a.type, Math.round(a.x), Math.round(a.y), a.orient]), st.wires.map((w) => w.ends), st.free.map((f) => f.name)]);
    function reset(state, fit = true) { v.setState(state, { fit }); stack = [{ state: snap(), label: null }]; at = 0; o.onChange && o.onChange(); }
    v.on("change", (label) => { stack = stack.slice(0, at + 1); stack.push({ state: snap(), label }); at = stack.length - 1; o.onChange && o.onChange(label); });
    const H = {
      canUndo: () => at > 0, canRedo: () => at < stack.length - 1,
      undoLabel: () => (at > 0 ? stack[at].label : null), redoLabel: () => (at < stack.length - 1 ? stack[at + 1].label : null),
      undo() { if (!H.canUndo()) return null; const l = stack[at].label; at--; v.setState(clone(stack[at].state)); o.onChange && o.onChange(); return l; },
      redo() { if (!H.canRedo()) return null; at++; v.setState(clone(stack[at].state)); o.onChange && o.onChange(); return stack[at].label; },
      changed: () => at > 0 && ser(stack[at].state) !== ser(stack[0].state),
      depth: () => at,
    };
    return { view: v, host, reset, history: H, destroy() { v.dead = true; app.views = app.views.filter((x) => x !== v); } };
  }

  /* ------------------------------------------------------------ problems in a rule's result, shown where they are */
  function openEnds(v) {
    const used = new Set(); for (const w of v.state.wires) for (const e of w.ends) used.add(e.agent != null ? e.agent + ":" + e.slot : "f:" + e.free);
    const out = [];
    for (const a of v.state.agents) a.ports.forEach((p, i) => { if (!used.has(a.id + ":" + i)) out.push({ agent: a.id, slot: i, pos: p, dir: NK.portDir(a, i) }); });
    for (const f of v.state.free) if (f.pin && !used.has("f:" + f.name)) out.push({ free: f.name, pos: [f.x, f.y], dir: f.dir === "up" ? [0, -1] : [0, 1] });
    return out;
  }
  // Symmetry for a rule between two agents of the same type: the result must look the same with
  // x and y swapped. Compared with a few rounds of colour refinement (good enough for small rules).
  function signature(st, swap) {
    const nodes = new Map();
    const pinName = (n) => (swap ? n.replace(/^L/, "#").replace(/^R/, "L").replace(/^#/, "R") : n);
    for (const a of st.agents) nodes.set("a" + a.id, { lab: "A:" + a.type, nb: [] });
    for (const f of st.free) nodes.set("f" + f.name, { lab: "P:" + pinName(f.name), nb: [] });
    const key = (e) => (e.agent != null ? "a" + e.agent : "f" + e.free);
    for (const w of st.wires) {
      const [e0, e1] = w.ends, n0 = nodes.get(key(e0)), n1 = nodes.get(key(e1)); if (!n0 || !n1) continue;
      n0.nb.push([e0.slot ?? -1, key(e1), e1.slot ?? -1]); n1.nb.push([e1.slot ?? -1, key(e0), e0.slot ?? -1]);
    }
    let col = new Map([...nodes].map(([k, n]) => [k, n.lab]));
    for (let r = 0; r < 5; r++) col = new Map([...nodes].map(([k, n]) => [k, col.get(k) + "(" + n.nb.map(([s, o, t]) => s + ">" + col.get(o) + ":" + t).sort().join(",") + ")"]));
    return [...col.values()].sort().join("|");
  }

  /* ------------------------------------------------------------ the rule editor's data */
  function RuleData(app, key) {
    const S = app.S, sysKey = S.ex.family, pairs = app.raw.systems[sysKey].pairs;
    const [a, b] = key.split("|");
    const ek = pairs[a + "|" + b] ? a + "|" + b : b + "|" + a;
    const entry = pairs[ek];
    if (!entry) return null;
    const types = () => S.types;
    const T = Object.fromEntries(S.types.map((t) => [t.id, t]));
    const sideType = (name) => (name[0] === "L" ? entry.left : entry.right);
    const decoratePins = (st, pin) => {
      for (const f of st.free) {
        const slot = +f.name.slice(1), ty = sideType(f.name);
        f.pin = pin; f.of = [ty, slot];
        const pt = app.TY.portOf(ty, slot); f.ptype = pt ? { pol: app.TY.opp(pt.pol), name: pt.name } : null;
      }
      return st;
    };
    const lhs = decoratePins(NK.hydrate(entry.lhs, T), false);
    for (const f of lhs.free) f.pinShow = true;
    const saved = S.extra.ruleNets && S.extra.ruleNets[ek];
    const has = S.rules.includes(ek) || S.rules.includes(entry.right + "|" + entry.left);
    const rhs0 = decoratePins(saved ? clone(saved) : has && entry.rhs ? NK.hydrate(entry.rhs, T) : NK.hydrate({ agents: [], wires: [], free: entry.rhs.free }, T), true);
    return { key: ek, entry, left: entry.left, right: entry.right, has, lhs, rhs0, types, same: entry.left === entry.right, T };
  }
  function ruleProblems(app, rd, v) {
    const open = openEnds(v);
    const asym = rd.same && signature(v.state, false) !== signature(v.state, true);
    let clash = 0; if (app.TY.on()) for (const w of v.state.wires) if (app.TY.compare(app.TY.endType(v, w.ends[0]), app.TY.endType(v, w.ends[1]))) clash++;
    return { open, asym, clash, ok: !open.length && !asym && !clash };
  }
  function problemOverlay(app, getP, showText) {
    return (v) => {
      const p = getP(); if (!p) return "";
      let s = "";
      for (const o of p.open) {
        const [x, y] = o.pos;
        s += `<circle cx="${x}" cy="${y}" r="5.4" class="ek-need"/>`;
        if (showText()) { const d = o.dir, tx = x + (d[0] || 0) * 14 + 7, ty = y + (d[1] || 0) * 12; s += `<text x="${tx}" y="${ty}" class="ek-need-t">needs a wire</text>`; }
      }
      return s;
    };
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  function problemText(app, p, rd) {
    if (p.open.length) {
      const pins = p.open.filter((o) => o.free != null).map((o) => app.pinLabel(o.free)), ports = p.open.length - pins.length;
      const bits = [];
      if (pins.length) bits.push(`${pins.join(", ")} ${pins.length === 1 ? "needs" : "need"} a wire`);
      if (ports) bits.push(`${plural(ports, "port")} of the new agents ${ports === 1 ? "needs" : "need"} a wire`);
      const t = bits.join("; ");
      return (pins.length ? t : cap(t)) + ".";
    }
    if (p.clash) return `${plural(p.clash, "wire")} ${p.clash === 1 ? "joins" : "join"} ports that don't fit.`;
    if (p.asym) return `Not symmetric. Two ${esc(rd.T[rd.left].symbol)} meeting have no top and bottom, so the result must look the same turned upside down.`;
    return "";
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ------------------------------------------------------------ the panel shell */
  function Panel(app, cfg) {
    const el = document.createElement("div");
    el.className = "ep " + (cfg.cls || ""); el.setAttribute("data-chrome", ""); el.setAttribute("role", "dialog");
    document.body.appendChild(el);
    let scrim = null;
    if (cfg.scrim) { scrim = document.createElement("div"); scrim.className = "ep-scrim"; document.body.appendChild(scrim); }
    let ctl = null, kind = null, flashT = 0, escArm = 0;
    const P = { el, isOpen: () => !!ctl, kind: () => kind, ctl: () => ctl };

    function bindFrame() {
      const q = (k) => el.querySelector(`[data-ep="${k}"]`);
      if (q("save")) q("save").onclick = () => P.save();
      if (q("cancel")) q("cancel").onclick = () => P.close(true);
      if (q("close")) q("close").onclick = () => P.requestClose();
      if (q("undo")) q("undo").onclick = () => P.undo();
      if (q("redo")) q("redo").onclick = () => P.redo();
      if (q("delete")) q("delete").onclick = () => ctl && ctl.del && ctl.del();
    }
    P.sync = () => {
      if (!ctl) return;
      const q = (k) => el.querySelector(`[data-ep="${k}"]`);
      const H = ctl.history && ctl.history();
      if (q("undo")) { q("undo").disabled = !H || !H.canUndo(); q("undo").setAttribute("data-tip", H && H.canUndo() ? `Undo ${(H.undoLabel() || "").toLowerCase()} (⌘Z)` : "Nothing to undo in this editor yet"); }
      if (q("redo")) { q("redo").disabled = !H || !H.canRedo(); q("redo").setAttribute("data-tip", H && H.canRedo() ? `Redo ${(H.redoLabel() || "").toLowerCase()} (⇧⌘Z)` : "Nothing to redo"); }
      const why = ctl.saveWhy ? ctl.saveWhy() : null;
      if (q("save")) { q("save").setAttribute("aria-disabled", why ? "true" : "false"); q("save").setAttribute("data-tip", why || "Save (⌘↵)"); }
      if (q("cancel")) q("cancel").setAttribute("data-tip", P.dirty() ? "Throw away these changes (Esc, then confirm)" : "Close (Esc)");
      el.classList.toggle("dirty", P.dirty());
      if (cfg.onSync) cfg.onSync(P, ctl);
      app.syncUI && app.syncUI();
    };
    P.dirty = () => !!(ctl && ctl.dirty && ctl.dirty());

    P.open = (o) => {
      if (ctl) { if (P.dirty()) { P.flash(); return false; } P.close(true, true); }
      kind = o.kind;
      el.className = "ep " + (cfg.cls || "") + " k-" + o.kind;
      el.innerHTML = cfg.frame(o);
      const body = el.querySelector("[data-slot=body]");
      ctl = o.build(body, P);
      bindFrame();
      cfg.place(P, o);
      el.classList.add("on");
      if (scrim) scrim.classList.add("on");
      app.clearHover();
      ctl.afterOpen && ctl.afterOpen(); P.sync();
      if (cfg.grow && o.origin) grow(o.origin);
      app.emit("panel", true);
      return true;
    };
    function grow(origin) {
      const r = origin.getBoundingClientRect(), p = el.getBoundingClientRect();
      if (!r.width || !p.width) return;
      const sx = r.width / p.width, sy = r.height / p.height, dx = r.left - p.left, dy = r.top - p.top;
      el.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.4 }, { transformOrigin: "0 0", transform: "none", opacity: 1 }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    P.close = (discard, quiet) => {
      if (!ctl) return;
      if (discard && P.dirty() && !quiet) app.toast(cfg.discardWord ? cfg.discardWord(kind) : "Changes thrown away.");
      ctl.destroy && ctl.destroy();
      ctl = null; kind = null;
      el.classList.remove("on"); el.innerHTML = "";
      if (scrim) scrim.classList.remove("on");
      app.focusView(app.view); app.clearHover();
      app.emit("panel", false);
      app.syncUI && app.syncUI();
    };
    P.requestClose = () => { if (P.dirty()) P.flash(); else P.close(); };
    P.save = () => {
      if (!ctl) return;
      const why = ctl.saveWhy ? ctl.saveWhy() : null;
      if (why) { ctl.showProblems && ctl.showProblems(); P.flashNote(why, true); return; }
      if (ctl.save() !== false) P.close(false);
    };
    P.undo = () => { if (ctl && ctl.history && ctl.history().undo() != null) P.sync(); };
    P.redo = () => { if (ctl && ctl.history && ctl.history().redo() != null) P.sync(); };
    P.flashNote = (text, bad) => {
      const n = el.querySelector("[data-slot=flashnote]"); if (!n) return app.toast(text);
      n.innerHTML = text; n.classList.toggle("bad", !!bad); n.classList.add("on");
      clearTimeout(flashT); flashT = setTimeout(() => n.classList.remove("on"), 3200);
    };
    // "Deal with this first": Save and Cancel pulse, and say why.
    P.flash = (note) => {
      $$('[data-ep="save"],[data-ep="cancel"]', el).forEach((b) => { b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); });
      el.classList.remove("flashing"); void el.offsetWidth; el.classList.add("flashing");
      P.flashNote(note || (cfg.flashText ? cfg.flashText(kind) : "You have unsaved changes. Save or cancel them first."));
    };

    // Clicks outside: a click (not a drag or a pan) closes the panel, or flashes it when it has changes.
    let down = null;
    const inside = (t) => !!t && (el.contains(t) || (t.closest && t.closest(".menu,#toast,#tooltip,.nk-paghost,[data-keep]" + (cfg.attached ? "," + cfg.attached : ""))));
    document.addEventListener("pointerdown", (e) => { down = ctl && e.button === 0 && !inside(e.target) ? { x: e.clientX, y: e.clientY, t: e.target } : null; }, true);
    document.addEventListener("pointerup", (e) => {
      const d = down; down = null;
      if (!d || !ctl || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      if (P.dirty()) { P.flash(); if (cfg.swallowDirtyClick) { e.stopPropagation(); } }
      else P.close();
    }, true);

    // Keys: the open panel gets them first.
    P.onKey = (e) => {
      if (!ctl) return false;
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (ctl.onKey && ctl.onKey(e)) return true;
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? P.redo() : P.undo(); flashBtn(e.shiftKey ? "redo" : "undo"); return true; }
      if (mod && e.key === "Enter") { e.preventDefault(); P.save(); return true; }
      if (e.key === "Escape") {
        const v = ctl.focusView && ctl.focusView();
        if (v && (v.selection().agents.length || v.selection().wires.length)) { v.select([]); return true; }
        if (!P.dirty()) { P.close(); return true; }
        if (cfg.escTwice) {
          if (Date.now() - escArm < 2200) { escArm = 0; P.close(true); return true; }
          escArm = Date.now(); P.flash("Unsaved changes. Press Esc again to throw them away, or ⌘↵ to save."); return true;
        }
        P.flash(); return true;
      }
      const v = ctl.focusView && ctl.focusView();
      if (!v || v.readonly) return cfg.ownsKeys ? true : false;
      if (mod && k === "c") { const c = v.copySelection(); if (c) { app.clip = c; app.toast(`Copied ${c.agents.length} agent${c.agents.length === 1 ? "" : "s"}.`); } else if (app.view.copySelection()) { app.clip = app.view.copySelection(); app.clip.fromMain = true; app.toast(`Copied ${app.clip.agents.length} agent${app.clip.agents.length === 1 ? "" : "s"} from the net. ⌘V pastes them here.`); } return true; }
      if (mod && k === "x") { const c = v.copySelection(); if (c) { app.clip = c; v.deleteSelection(); } return true; }
      if (mod && k === "v") {
        if (!app.clip) { app.toast("Nothing copied yet. Select agents (here or on the net) and press ⌘C."); return true; }
        const r = v.host.getBoundingClientRect(), [px, py] = app.pointer, overIt = px > r.left && px < r.right && py > r.top && py < r.bottom;
        const n = v.paste(app.clip, overIt ? px : r.left + r.width / 2, overIt ? py : r.top + r.height / 2);
        app.focusView(v); if (n) app.toast(`Pasted ${n} agent${n === 1 ? "" : "s"}${app.clip.fromMain ? " from the net" : ""}. Wires to anything left behind were dropped.`);
        return true;
      }
      if (mod && k === "a") { e.preventDefault(); v.selectAll(); return true; }
      if (e.key === "Backspace" || e.key === "Delete") { v.deleteSelection(); return true; }
      if (k === "f" && !mod) { v.fit(); return true; }
      if (e.key === " ") { e.preventDefault(); return true; }
      return false;
    };
    function flashBtn(k) { const b = el.querySelector(`[data-ep="${k}"]`); if (!b) return; b.classList.remove("kflash"); void b.offsetWidth; b.classList.add("kflash"); }
    return P;
  }

  /* ------------------------------------------------------------ the rule editor */
  // layout: "side" (A: pair small on the left, result on the right),
  //         "toggle" (B: one canvas, Before / After, the pair turning into the result),
  //         "preview" (C: drawn like the step preview: the pair, and its result in a frame, joined by dashed links).
  function ruleEditor(app, key, o) {
    const rd = RuleData(app, key); if (!rd) return null;
    const S = app.S, T = rd.T, sym = (id) => esc((T[id] || { symbol: id }).symbol);
    let showText = false, probs = null, mode = o.layout === "toggle" ? "after" : null;
    return {
      rd,
      title: () => `<i class="sym">${sym(rd.left)}</i> with <i class="sym">${sym(rd.right)}</i>`,
      build(body, P) {
        body.innerHTML = o.bodyHTML(rd);
        const pairHost = body.querySelector("[data-slot=pair]"), resHost = body.querySelector("[data-slot=result]");
        const pair = pairHost ? EditorCanvas(app, pairHost, { readonly: true, types: rd.types, rules: () => [rd.key], pinLabels: true, fitPad: o.pairPad || { t: 30, r: 24, b: 30, l: 24 }, maxFit: 1.6 }) : null;
        if (pair) pair.reset(rd.lhs);
        const statusEl = body.querySelector("[data-slot=status]");
        let ready = false, ctl = null;
        const res = EditorCanvas(app, resHost, {
          pins: true, types: rd.types, fitPad: o.resPad, maxFit: o.resMaxFit || 1.8,
          emptyHTML: "Empty. Drag agents in, or wire the ends straight to each other.",
          overlay: problemOverlay(app, () => probs, () => showText),
          onChange: () => { if (!ready) return; probs = ruleProblems(app, rd, res.view); res.view.render(); renderStatus(); P.sync(); o.onChange && o.onChange(ctl); },
        });
        res.reset(clone(rd.rhs0));
        function renderStatus() {
          if (!probs) return;
          const t = problemText(app, probs, rd);
          if (statusEl) {
            statusEl.innerHTML = t ? `<span class="ek-dot"></span>${t}` : `<span class="ek-ok">✓</span>${rd.has || res.history.depth() ? "Every port and every end has a wire." : ""}`;
            statusEl.classList.toggle("bad", !!t);
          }
          const sym = body.querySelector("[data-slot=symnote]");
          if (sym) sym.classList.toggle("on", !!probs.asym);
          if (o.renderStatus) o.renderStatus(ctl, probs, t);
        }
        if (statusEl) { statusEl.onpointerenter = () => { showText = true; res.view.render(); }; statusEl.onpointerleave = () => { showText = false; res.view.render(); }; }
        ctl = {
          rd, pair, res, P,
          history: () => res.history,
          dirty: () => res.history.changed(),
          saveWhy: () => { const t = probs && problemText(app, probs, rd); return t ? "Can't save yet: " + (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t) : null; },
          showProblems: () => { showText = true; res.view.render(); setTimeout(() => { showText = false; res.view.render(); }, 2600); },
          save() {
            S.extra.ruleNets = S.extra.ruleNets || {};
            const st = clone(res.view.state); for (const f of st.free) { delete f.ptype; }
            S.extra.ruleNets[rd.key] = st;
            const was = S.rules.includes(rd.key);
            if (!was) S.rules.push(rd.key);
            app.commit(`${was ? "Edit" : "Add"} rule ${(T[rd.left] || {}).symbol} with ${(T[rd.right] || {}).symbol}`);
            app.toast(`Saved the rule. One undo on the net takes it back.`, true);
          },
          del() {
            if (!S.rules.includes(rd.key)) return;
            S.rules = S.rules.filter((k) => k !== rd.key); if (S.extra.ruleNets) delete S.extra.ruleNets[rd.key];
            P.close(true, true); app.commit(`Delete rule ${(T[rd.left] || {}).symbol} with ${(T[rd.right] || {}).symbol}`);
            app.toast("Deleted the rule. Pairs that used it are stuck now.", true);
          },
          focusView: () => res.view,
          setMode(m) { mode = m; o.onMode && o.onMode(ctl, m); },
          mode: () => mode,
          afterOpen() { pair && pair.view.fit(false); res.view.fit(false); o.afterOpen && o.afterOpen(ctl); },
          destroy() { pair && pair.destroy(); res.destroy(); o.destroy && o.destroy(ctl); },
          onKey: (e) => (o.onKey ? o.onKey(ctl, e) : false),
        };
        ready = true;
        probs = ruleProblems(app, rd, res.view); renderStatus();
        if (o.bind) o.bind(ctl, body);
        return ctl;
      },
    };
  }

  /* ------------------------------------------------------------ the component editor */
  function componentEditor(app, compId, o) {
    const S = app.S, c = S.typeById(compId); if (!c) return null;
    const def = S.extra.compDefs[compId];
    const instances = () => app.view.state.agents.filter((a) => a.type === compId).length;
    let name = c.name, symbol = c.symbol || "", fieldsDirty = false;
    return {
      title: () => esc(c.name),
      instances,
      build(body, P) {
        body.innerHTML = o.bodyHTML(c, instances());
        const host = body.querySelector("[data-slot=def]");
        let ready = false;
        const ed = EditorCanvas(app, host, { types: () => S.types, fitPad: o.fitPad, maxFit: 1.8, onChange: () => { if (ready) { renderIface(); P.sync(); } } });
        ed.view.setLayout("manual");
        const T = Object.fromEntries(S.types.map((t) => [t.id, t]));
        const st = clone(def); st.agents = st.agents.map((a) => NK.makeAgent(T[a.type], a.id, a.x, a.y, a.orient));
        ed.reset(st);
        const ifEl = body.querySelector("[data-slot=iface]");
        function renderIface() {
          if (!ifEl) return;
          const fr = ed.view.state.free;
          ifEl.innerHTML = `<b>Interface:</b> ${fr.length ? fr.map((f, i) => `<span class="ifchip">${esc(f.name)}</span>${i === 0 ? `<span class="muted">principal</span>` : ""}`).join(" ") : `<span class="bad">no loose ends: it couldn't be wired to anything</span>`}`;
        }
        ready = true;
        renderIface();
        const nm = body.querySelector("[data-slot=name]"), sy = body.querySelector("[data-slot=symbol]");
        if (nm) nm.oninput = () => { name = nm.value; fieldsDirty = true; P.sync(); };
        if (sy) sy.oninput = () => { symbol = sy.value; fieldsDirty = true; P.sync(); };
        const ctl = {
          ed, P,
          history: () => ed.history,
          dirty: () => ed.history.changed() || fieldsDirty,
          saveWhy: () => (!ed.view.state.free.length ? "Can't save yet: a component needs at least one loose end to plug into." : !name.trim() ? "Can't save yet: give it a name." : null),
          save() {
            const n = instances();
            S.extra.compDefs[compId] = clone(ed.view.state);
            const t = S.typeById(compId); t.name = name.trim(); t.symbol = symbol;
            const arity = Math.max(0, ed.view.state.free.length - 1);
            if (arity !== t.arity) { t.arity = arity; S._ctx(); app.view.regenType(compId); }
            app.view.render(); app.commit("Edit component " + t.name);
            app.toast(`Saved "${t.name}". Updated ${n} instance${n === 1 ? "" : "s"} on the canvas. One undo takes it all back.`, true);
          },
          del() {
            const n = instances();
            P.close(true, true);
            app.view.state.agents = app.view.state.agents.filter((a) => a.type !== compId);
            app.view.state.wires = app.view.state.wires.filter((w) => !w.ends.some((e) => e.agent != null && !app.view.agent(e.agent)));
            S.components = S.components.filter((x) => x.id !== compId);
            app.commit("Delete component " + c.name);
            app.toast(`Deleted the component and its ${n} instance${n === 1 ? "" : "s"}.`, true);
          },
          focusView: () => ed.view,
          afterOpen() { ed.view.fit(false); },
          destroy() { ed.destroy(); },
          onKey: (e) => (o.onKey ? o.onKey(ctl, e) : false),
        };
        if (o.bind) o.bind(ctl, body);
        return ctl;
      },
    };
  }

  window.EdPanel = { Panel, EditorCanvas, ruleEditor, componentEditor, RuleData, openEnds };
})();
