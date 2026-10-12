/* typekit2.js: the port model for direction A2. Throwaway prototype code.
   A port has two independent settings:
     direction: gives / takes / either (pol "give" | "take" | null)
     type:      a named type like number or list, or any type (name id | null)
   A wire joins two ports when
     - their directions are opposite, if both are directed, and
     - their types are the same, if both have one.
   Each system has two strictness settings, Directions and Types, each
   Off / Optional / Required. Off hides that dimension entirely. */
(function () {
  "use strict";
  const NK = window.NetKit, clone = NK.clone, esc = NK.esc;

  /* ------------------------------------------------------------ data */
  const P = (pol, name) => ({ pol: pol || null, name: name || null });
  const g = (n) => P("give", n), t = (n) => P("take", n);
  const PORTS = {
    arith: { "0": [g("num")], S: [g("num"), t("num")], "+": [t("num"), g("num"), t("num")], "×": [t("num"), g("num"), t("num")], δ: [t("num"), g("num"), g("num")], ε: [t("num")] },
    directed: { γ: [g(), t(), t()], δ: [g(), t(), t()], ε: [g()], "γ*": [t(), g(), g()], "δ*": [t(), g(), g()], "ε*": [t()] },
    // δ and ε have directions but take any type: they copy and erase numbers and lists alike
    lists: { "0": [g("num")], S: [g("num"), t("num")], "+": [t("num"), g("num"), t("num")], Nil: [g("list")], Cons: [g("list"), t("num"), t("list")], len: [t("list"), g("num")], δ: [t(), g(), g()], ε: [t()] },
  };
  const ROLES = {
    "0": ["zero"], S: ["the number", "the number before it"], "+": ["first number", "the sum", "second number"],
    "×": ["first number", "the product", "second number"], δ: ["what gets copied", "first copy", "second copy"],
    ε: ["what gets erased"], Nil: ["the empty list"], Cons: ["the list", "first item", "rest of the list"], len: ["the list", "its length"],
  };
  const TYPES = { num: { id: "num", label: "number" }, list: { id: "list", label: "list" } };
  const SAYS = {
    "len|Nil": { create: true, say: "The length of the empty list is 0." },
    "len|Cons": { create: true, say: "Adds 1 to the length of the rest. The first item gets erased." },
    "δ|Nil": { create: true, say: "Copying the empty list makes two." },
    "ε|Nil": { create: true, say: "The eraser deletes the empty list." },
    "ε|Cons": { create: true, say: "The eraser deletes the item and moves on to both its wires." },
    "γ|γ*": { create: true, say: "They cancel out. Their wires join crosswise." },
    "δ|δ*": { create: true, say: "They cancel out. Their wires join straight across." },
    "ε|ε*": { create: true, say: "Two erasers meet and both disappear." },
    "ε*|γ": { create: true, say: "The co-eraser deletes γ and leaves one on each wire." },
    "ε*|δ": { create: true, say: "The co-eraser deletes δ and leaves one on each wire." },
    "ε|γ*": { create: true, say: "The eraser deletes γ* and leaves one on each wire." },
    "ε|δ*": { create: true, say: "The eraser deletes δ* and leaves one on each wire." },
    "γ|δ*": { create: true, say: "They pass through each other: each gets copied." },
    "δ|γ*": { create: true, say: "They pass through each other: each gets copied." },
  };

  function buildLists(arith) {
    const types = arith.types.filter((x) => ["0", "S", "+", "δ", "ε"].includes(x.id)).map(clone);
    types.splice(3, 0,
      { id: "Nil", name: "empty list", symbol: "[]", arity: 0, filled: false, circle: true },
      { id: "Cons", name: "list item", symbol: "∷", arity: 2, filled: false, circle: false },
      { id: "len", name: "length", symbol: "#", arity: 1, filled: false, circle: false });
    const T = Object.fromEntries(types.map((x) => [x.id, x]));
    const A = (id, type, x, y, o) => NK.makeAgent(T[type], id, x, y, o);
    const ag = [A(1, "0", -16, -141, "down"), A(2, "S", -16, -88, "down"), A(3, "0", 20, -141, "down"), A(4, "Nil", 44, -141, "down"),
      A(5, "Cons", 32, -88, "down"), A(6, "Cons", 24, -28, "down"), A(7, "len", 24, 28, "up"), A(8, "0", 110, -21, "down"), A(9, "δ", 110, 28, "up")];
    const byId = Object.fromEntries(ag.map((a) => [a.id, a]));
    const free = [{ name: "out", x: 24, y: 103, dir: "down" }, { name: "a", x: 118, y: 103, dir: "down" }, { name: "b", x: 102, y: 103, dir: "down" }];
    const st = { agents: ag, wires: [], free };
    const fr = (n) => free.find((f) => f.name === n);
    const pos = (e) => (e.free != null ? [fr(e.free).x, fr(e.free).y] : byId[e.agent].ports[e.slot]);
    const dir = (e) => (e.free != null ? (fr(e.free).dir === "up" ? [0, 1] : [0, -1]) : NK.portDir(byId[e.agent], e.slot));
    const W = (id, e0, e1) => st.wires.push({ id, ends: [e0, e1], path: NK.curve(pos(e0), dir(e0), pos(e1), dir(e1), 16) });
    W(1, { agent: 2, slot: 1 }, { agent: 1, slot: 0 }); W(2, { agent: 5, slot: 1 }, { agent: 3, slot: 0 }); W(3, { agent: 5, slot: 2 }, { agent: 4, slot: 0 });
    W(4, { agent: 6, slot: 1 }, { agent: 2, slot: 0 }); W(5, { agent: 6, slot: 2 }, { agent: 5, slot: 0 }); W(6, { agent: 6, slot: 0 }, { agent: 7, slot: 0 });
    W(7, { agent: 7, slot: 1 }, { free: "out" }); W(8, { agent: 8, slot: 0 }, { agent: 9, slot: 0 }); W(9, { agent: 9, slot: 1 }, { free: "a" }); W(10, { agent: 9, slot: 2 }, { free: "b" });
    return { name: "Length of a list", family: "arith", types, rules: ["+|0", "+|S", "len|Nil", "len|Cons", "δ|0", "δ|S", "δ|Nil", "ε|0", "ε|S", "ε|Nil", "ε|Cons"], states: [st] };
  }

  function prepare(data) {
    NK.addEffects(SAYS);
    const src = (n) => data.examples.find((e) => e.name === n);
    const out = [];
    const add = (e, sys, ports, extra) => {
      e = clone(e); e.sys = clone(sys);
      for (const ty of e.types) { ty.ports = ports ? clone(ports[ty.id] || Array.from({ length: ty.arity + 1 }, () => P())) : Array.from({ length: ty.arity + 1 }, () => P()); ty.roles = clone(ROLES[ty.id] || []); }
      Object.assign(e, extra || {}); out.push(e); return e;
    };
    const num = [TYPES.num];
    add(src("3 + 2"), { dirs: "required", types: "required", names: num }, PORTS.arith, { sub: "Directions and types required", group: "Typed" });
    add(src("2 × 2"), { dirs: "required", types: "required", names: num }, PORTS.arith, { sub: "Directions and types required", group: "Typed" });
    add(buildLists(src("3 + 2")), { dirs: "optional", types: "optional", names: [TYPES.num, TYPES.list] }, PORTS.lists, { sub: "Two types, both optional. δ and ε take any type", group: "Typed", noSteps: true });
    add(src("Directed commutation"), { dirs: "required", types: "off", names: [] }, PORTS.directed, { sub: "Directions only, no types", group: "Directions only" });
    add(src("Directed erasing"), { dirs: "required", types: "off", names: [] }, PORTS.directed, { sub: "Directions only, no types", group: "Directions only" });
    for (const n of ["Commutation", "Erasing a tree", "Duplicating a loop", "Runs forever"]) add(src(n), { dirs: "off", types: "off", names: [] }, null, { group: "Plain" });
    for (const e of out) for (const s of e.states) NK.normaliseState(s);
    data.examples = out;
    const bad = clone(out[0]); bad.name = "sum.inet"; bad.types.find((x) => x.id === "+").ports[2] = g("num");
    data.badFile = bad;
    return data;
  }

  /* ------------------------------------------------------------ levels */
  const DL = (S) => (S && S.sys && S.sys.dirs) || "off";
  const TL = (S) => (S && S.sys && S.sys.types) || "off";
  const dirsOn = (S) => DL(S) !== "off" || !!(S.sys && S.sys.pendDirs);
  const typesOn = (S) => TL(S) !== "off" || !!(S.sys && S.sys.pendTypes);
  const needDirs = (S) => DL(S) === "required" || !!(S.sys && S.sys.pendDirs);
  const needTypes = (S) => TL(S) === "required" || !!(S.sys && S.sys.pendTypes);
  // kept for the shared chrome: "untyped" means neither dimension is on
  function level(S) { return dirsOn(S) || typesOn(S) ? "typed" : "untyped"; }

  /* ------------------------------------------------------------ words */
  const nameOf = (S, id) => { const n = S.sys && S.sys.names.find((x) => x.id === id); return n ? n.label : id; };
  const art = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
  const verb = (p) => (p.pol === "give" ? "gives" : "takes");
  const opp = (pol) => (pol === "give" ? "take" : pol === "take" ? "give" : null);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // "gives a number" / "gives" / "carries a number" / "fits anything"
  function phrase(S, p) {
    if (!p || (!p.pol && !p.name)) return "fits anything";
    if (p.pol && p.name) return verb(p) + " " + art(nameOf(S, p.name));
    if (p.pol) return verb(p);
    return "carries " + art(nameOf(S, p.name));
  }
  function sentence(S, p) { return cap(phrase(S, p)) + "."; }

  /* ------------------------------------------------------------ typing */
  function rawPorts(S, typeId, override) { return override && override[typeId] ? override[typeId] : (S.typeById(typeId) || {}).ports; }
  function portOf(S, typeId, slot, override) {
    const ports = rawPorts(S, typeId, override); if (!ports) return null;
    const p = ports[slot]; if (!p) return null;
    const r = { pol: dirsOn(S) ? p.pol || null : null, name: typesOn(S) ? p.name || null : null };
    return r.pol || r.name ? r : null;
  }
  function endType(S, view, end, override) {
    if (end.free != null) {
      const w = view.wireOfFree(end.free); if (!w) return null;
      const o = w.ends.find((e) => e.free !== end.free); if (!o || o.free != null) return null;
      const p = endType(S, view, o, override); return p ? { pol: opp(p.pol), name: p.name } : null;
    }
    const a = view.agent(end.agent); if (!a) return null;
    return portOf(S, a.type, end.slot, override);
  }
  const carries = (S, p) => (p.pol ? verb(p) : "carries") + " " + art(nameOf(S, p.name));
  function compare(S, a, b, o = {}) {
    if (!a || !b) return null;
    const here = o.here || "this port", there = o.there || "the wire";
    if (a.pol && b.pol && a.pol === b.pol) {
      const n = a.name && b.name && a.name === b.name ? " " + art(nameOf(S, a.name)) : "";
      return { note: a.pol === "give" ? "Both give" : "Both take", why: `Both ${a.pol}${n}. A wire runs from a port that gives to one that takes.`, kind: "pol" };
    }
    if (a.name && b.name && a.name !== b.name) return { note: "Wrong type", why: `${cap(here)} ${carries(S, b)}, but ${there} ${carries(S, a).replace(/^gives|^takes/, "carries")}.`, kind: "name" };
    return null;
  }
  function clash(S, view, D, end) {
    if (!D.originEnd || D.originEnd.free != null) return null;
    const a = endType(S, view, D.originEnd);
    if (end.free != null) {
      const v = view.wireOfFree(end.free); const gEnd = v && v.ends.find((e) => e.free !== end.free);
      if (!gEnd || gEnd.free != null) return null;
      return compare(S, a, endType(S, view, gEnd), { here: "the wire behind this loose end", there: "yours" });
    }
    return compare(S, a, endType(S, view, end));
  }
  function flow(S, view, w) {
    const t0 = endType(S, view, w.ends[0]), t1 = endType(S, view, w.ends[1]);
    if (t0 && t0.pol) return t0.pol === "give" ? 1 : -1;
    if (t1 && t1.pol) return t1.pol === "take" ? 1 : -1;
    return 0;
  }
  const wireName = (S, view, w) => { const t0 = endType(S, view, w.ends[0]), t1 = endType(S, view, w.ends[1]); return (t0 && t0.name) || (t1 && t1.name) || null; };

  /* ------------------------------------------------------------ changes */
  function endLabel(S, view, e) {
    if (e.free != null) return "loose end " + e.free;
    const a = view.agent(e.agent), ty = S.typeById(a.type) || { symbol: a.type };
    return (e.slot === 0 ? "the principal port of " : `aux port ${e.slot} of `) + ty.symbol;
  }
  function conflicts(S, view, typeId, ports) {
    const ov = { [typeId]: ports }, out = [];
    for (const w of view.state.wires) {
      if (!w.ends.some((e) => e.agent != null && (view.agent(e.agent) || {}).type === typeId)) continue;
      if (w.ends.some((e) => e.free != null)) continue;
      const t0 = endType(S, view, w.ends[0], ov), t1 = endType(S, view, w.ends[1], ov);
      const r = compare(S, t0, t1);
      if (!r) continue;
      const n0 = endLabel(S, view, w.ends[0]), n1 = endLabel(S, view, w.ends[1]);
      const why = r.kind === "pol" ? `${cap(n0)} and ${n1} would both ${t0.pol}.` : `${cap(n0)} would carry ${art(nameOf(S, t0.name))}, but ${n1} carries ${art(nameOf(S, t1.name))}.`;
      out.push({ wire: w, why, note: r.note });
    }
    return out;
  }
  function cut(view, ids, whys) {
    const s = view.state;
    for (const id of ids) {
      const w = s.wires.find((x) => x.id === id); if (!w) continue;
      s.wires = s.wires.filter((x) => x !== w);
      const ps = w.ends.map((e) => view.endPos(e));
      w.ends.forEach((e, k) => {
        if (e.free != null) { s.free = s.free.filter((f) => f.name !== e.free); return; }
        const p = ps[k], q = ps[1 - k], name = view.newFreeName(), d = view.endDir(e);
        let x = p[0] + (q[0] - p[0]) * 0.34, y = p[1] + (q[1] - p[1]) * 0.34, route = null;
        if (view.layout === "auto") {
          const b = NK.stateBounds({ agents: s.agents, wires: [], free: [] }), top = d[1] < 0;
          y = top ? b.y0 - 30 : b.y1 + 30; x = b.x0 - 18;
          while (s.free.some((f) => Math.abs(f.x - x) < 10)) x -= 12;
          route = [p, [p[0] + d[0] * 10, p[1] + d[1] * 10], [x, p[1] + d[1] * 10], [x, y]];
        }
        s.free.push({ name, x, y, dir: y < p[1] ? "up" : "down", cut: true, why: whys && whys[id] });
        const nw = { id: view.nid++, ends: [e, { free: name }], path: [] }; s.wires.push(nw);
        if (route) nw.path = route; else view._curveWire(nw);
      });
    }
    view.render();
  }
  // ports that still need a direction or a type, given the strictness settings
  function missing(S, only) {
    const out = [];
    for (const ty of S.types) for (let i = 0; i <= ty.arity; i++) {
      const p = (ty.ports && ty.ports[i]) || {};
      if (needDirs(S) && !p.pol && only !== "type") out.push({ type: ty.id, slot: i, what: "dir" });
      if (needTypes(S) && !p.name && only !== "dir") out.push({ type: ty.id, slot: i, what: "type" });
    }
    return out;
  }
  function counts(S) { let d = 0, n = 0; for (const ty of S.types) for (const p of ty.ports || []) { if (p && p.pol) d++; if (p && p.name) n++; } return { dirs: d, types: n }; }
  function portCount(S) { const c = counts(S); return c.dirs + c.types; }
  function guess(S, view, typeId, slot, what) {
    for (const a of view.state.agents) {
      if (a.type !== typeId) continue;
      const w = view.wireAt(a.id, slot); if (!w) continue;
      const o = w.ends.find((e) => !(e.agent === a.id && e.slot === slot)); if (!o || o.free != null) continue;
      const p = endType(S, view, o); if (!p) continue;
      if (what === "dir" && p.pol) return opp(p.pol);
      if (what === "type" && p.name) return p.name;
    }
    return null;
  }
  function ensurePorts(ty) {
    if (!ty.ports) ty.ports = [];
    for (let i = 0; i <= ty.arity; i++) if (!ty.ports[i]) ty.ports[i] = P();
    ty.ports.length = ty.arity + 1;
    if (!ty.roles) ty.roles = [];
  }
  function setDirs(S, lv) {
    S.sys.dirs = lv; delete S.sys.pendDirs;
    if (lv === "off") for (const ty of S.types) for (const p of ty.ports || []) if (p) p.pol = null;
    for (const ty of S.types) ensurePorts(ty);
  }
  function setTypes(S, lv) {
    S.sys.types = lv; delete S.sys.pendTypes;
    if (lv === "off") { for (const ty of S.types) for (const p of ty.ports || []) if (p) p.name = null; S.sys.names = []; }
    for (const ty of S.types) ensurePorts(ty);
  }

  /* ------------------------------------------------------------ rule grid */
  function meet(S, a, b) {
    const ta = S.typeById(a), tb = S.typeById(b);
    const pa = portOf(S, a, 0) || {}, pb = portOf(S, b, 0) || {};
    if (pa.pol && pb.pol && pa.pol === pb.pol) {
      const n = pa.name && pa.name === pb.name ? " " + art(nameOf(S, pa.name)) : "";
      if (a === b) return { can: false, why: `Two ${esc(ta.symbol)} can never meet: both principal ports would ${pa.pol}${n}.`, short: `both ${pa.pol}`, kind: "pol" };
      return { can: false, why: `Both principal ports ${pa.pol}${n}.`, short: `both ${pa.pol}`, kind: "pol" };
    }
    if (pa.name && pb.name && pa.name !== pb.name) return { can: false, why: `${esc(ta.symbol)} ${carries(S, pa)}, ${esc(tb.symbol)} ${carries(S, pb)}.`, short: "different types", kind: "name" };
    return { can: true, untyped: dirsOn(S) && (!pa.pol || !pb.pol) };
  }
  function principalPol(S, id) { const p = portOf(S, id, 0); return p && p.pol ? p.pol : null; }

  function ruleRHS(key) {
    const T = { S: { id: "S", symbol: "S", arity: 1 }, "+": { id: "+", symbol: "+", arity: 2 } };
    if (key === "+|0") return { iface: [{ name: "r", x: -16, y: -56, dir: "up" }, { name: "y", x: 16, y: -56, dir: "up" }], agents: [], wires: [{ id: 1, ends: [{ free: "r" }, { free: "y" }], path: NK.curve([-16, -56], [0, 1], [16, -56], [0, 1], 18) }] };
    if (key === "+|S") {
      const s = NK.makeAgent(T.S, 1, -8, -26, "up"), p = NK.makeAgent(T["+"], 2, 0, 34, "down");
      const pos = { r: [-8, -78], y: [24, -78], x: [0, 86] };
      return { iface: [{ name: "r", x: -8, y: -78, dir: "up" }, { name: "y", x: 24, y: -78, dir: "up" }, { name: "x", x: 0, y: 86, dir: "down" }], agents: [s, p],
        wires: [
          { id: 1, ends: [{ agent: 1, slot: 0 }, { free: "r" }], path: NK.curve(s.ports[0], [0, -1], pos.r, [0, 1], 10) },
          { id: 2, ends: [{ agent: 1, slot: 1 }, { agent: 2, slot: 1 }], path: NK.curve(s.ports[1], [0, 1], p.ports[1], [0, -1], 10) },
          { id: 3, ends: [{ agent: 2, slot: 2 }, { free: "y" }], path: NK.curve(p.ports[2], [0, -1], pos.y, [0, 1], 14) },
          { id: 4, ends: [{ agent: 2, slot: 0 }, { free: "x" }], path: NK.curve(p.ports[0], [0, 1], pos.x, [0, -1], 10) },
        ] };
    }
    return null;
  }

  window.TypeKit = { prepare, endType, compare, clash, flow, wireName, phrase, sentence, verb, art, nameOf, cap, opp, level, DL, TL, dirsOn, typesOn, needDirs, needTypes, portOf, conflicts, cut, missing, counts, portCount, guess, ensurePorts, setDirs, setTypes, meet, principalPol, ruleRHS, endLabel, ROLES, P,
    setLevel(S, lv) { if (lv === "untyped") { setDirs(S, "off"); setTypes(S, "off"); } } };
})();
