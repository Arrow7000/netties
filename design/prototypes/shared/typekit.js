/* typekit.js: the type model shared by the three "types" prototypes (round 2).
   Throwaway prototype code on top of netkit.js. It knows:
   - which examples this round shows, and their port types (polarity + name);
   - whether two ports fit, and why not, in plain words;
   - what a change to an agent type would break on the canvas;
   - which pairs of agent types can never meet.
   Each direction draws types its own way; this file never draws. */
(function () {
  "use strict";
  const NK = window.NetKit, clone = NK.clone, esc = NK.esc;

  /* ------------------------------------------------------------ data */
  const g = (n) => ({ pol: "give", name: n || null }), t = (n) => ({ pol: "take", name: n || null });
  const PORTS = {
    arith: { "0": [g("num")], S: [g("num"), t("num")], "+": [t("num"), g("num"), t("num")], "×": [t("num"), g("num"), t("num")], δ: [t("num"), g("num"), g("num")], ε: [t("num")] },
    directed: { γ: [g(), t(), t()], δ: [g(), t(), t()], ε: [g()], "γ*": [t(), g(), g()], "δ*": [t(), g(), g()], "ε*": [t()] },
    lists: { "0": [g("num")], S: [g("num"), t("num")], "+": [t("num"), g("num"), t("num")], Nil: [g("list")], Cons: [g("list"), t("num"), t("list")], len: [t("list"), g("num")], δ: [null, null, null], ε: [null] },
  };
  // What each port is for, in words (for the hover panel and the editor).
  const ROLES = {
    "0": ["the number zero"], S: ["the number", "the number before it"], "+": ["the first number to add", "the result", "the second number to add"],
    "×": ["the first number to multiply", "the result", "the second number to multiply"], δ: ["what gets copied", "the first copy", "the second copy"],
    ε: ["what gets erased"], Nil: ["the empty list"], Cons: ["the list", "the first item", "the rest of the list"], len: ["the list to measure", "its length"],
  };
  const NAMES = { num: { id: "num", label: "number" }, list: { id: "list", label: "list" } };
  const SAYS = {
    "len|Nil": { create: true, say: "The length of the empty list is 0." },
    "len|Cons": { create: true, say: "Adds 1 to the length of the rest of the list. The first item gets erased." },
    "δ|Nil": { create: true, say: "Copying the empty list makes two empty lists." },
    "ε|Nil": { create: true, say: "The eraser deletes the empty list." },
    "ε|Cons": { create: true, say: "The eraser deletes the list item and moves on to both its wires." },
    "γ|γ*": { create: true, say: "They cancel out. Their wires join crosswise." },
    "δ|δ*": { create: true, say: "They cancel out. Their wires join straight across." },
    "ε|ε*": { create: true, say: "Two erasers meet and both disappear." },
    "ε*|γ": { create: true, say: "The co-eraser deletes γ and leaves a co-eraser on each of its wires." },
    "ε*|δ": { create: true, say: "The co-eraser deletes δ and leaves a co-eraser on each of its wires." },
    "ε|γ*": { create: true, say: "The eraser deletes γ* and leaves an eraser on each of its wires." },
    "ε|δ*": { create: true, say: "The eraser deletes δ* and leaves an eraser on each of its wires." },
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
    // [1, 0] as a list, its length, and a duplicator copying 0 next to it.
    // Cons ports: aux 1 = first item (left), aux 2 = rest (right)
    const ag = [A(1, "0", -16, -141, "down"), A(2, "S", -16, -88, "down"), A(3, "0", 20, -141, "down"), A(4, "Nil", 44, -141, "down"),
      A(5, "Cons", 32, -88, "down"), A(6, "Cons", 24, -28, "down"), A(7, "len", 24, 28, "up"), A(8, "0", 110, -21, "down"), A(9, "δ", 110, 28, "up")];
    const byId = Object.fromEntries(ag.map((a) => [a.id, a]));
    const free = [{ name: "out", x: 24, y: 103, dir: "down" }, { name: "a", x: 118, y: 103, dir: "down" }, { name: "b", x: 102, y: 103, dir: "down" }];
    const st = { agents: ag, wires: [], free };
    const pos = (e) => (e.free != null ? [free.find((f) => f.name === e.free).x, free.find((f) => f.name === e.free).y] : byId[e.agent].ports[e.slot]);
    const dir = (e) => (e.free != null ? (free.find((f) => f.name === e.free).dir === "up" ? [0, 1] : [0, -1]) : NK.portDir(byId[e.agent], e.slot));
    const W = (id, e0, e1) => st.wires.push({ id, ends: [e0, e1], path: NK.curve(pos(e0), dir(e0), pos(e1), dir(e1), 16) });
    W(1, { agent: 2, slot: 1 }, { agent: 1, slot: 0 });
    W(2, { agent: 5, slot: 1 }, { agent: 3, slot: 0 });
    W(3, { agent: 5, slot: 2 }, { agent: 4, slot: 0 });
    W(4, { agent: 6, slot: 1 }, { agent: 2, slot: 0 });
    W(5, { agent: 6, slot: 2 }, { agent: 5, slot: 0 });
    W(6, { agent: 6, slot: 0 }, { agent: 7, slot: 0 });
    W(7, { agent: 7, slot: 1 }, { free: "out" });
    W(8, { agent: 8, slot: 0 }, { agent: 9, slot: 0 });
    W(9, { agent: 9, slot: 1 }, { free: "a" });
    W(10, { agent: 9, slot: 2 }, { free: "b" });
    return { name: "Length of a list", family: "arith", types, rules: ["+|0", "+|S", "len|Nil", "len|Cons", "δ|0", "δ|S", "δ|Nil", "ε|0", "ε|S", "ε|Nil", "ε|Cons"], states: [st] };
  }

  // Replace the round-1 example list with this round's.
  function prepare(data) {
    NK.addEffects(SAYS);
    const src = (n) => data.examples.find((e) => e.name === n);
    const out = [];
    const add = (e, sys, ports, extra) => {
      e = clone(e);
      e.sys = clone(sys);
      for (const ty of e.types) { ty.ports = ports ? clone(ports[ty.id] || Array(ty.arity + 1).fill(null)) : null; ty.roles = ROLES[ty.id] || null; }
      Object.assign(e, extra || {});
      out.push(e); return e;
    };
    const num = [NAMES.num];
    add(src("3 + 2"), { level: "required", names: num }, PORTS.arith, { sub: "Typed: every port gives or takes a number", group: "Typed" });
    add(src("2 × 2"), { level: "required", names: num }, PORTS.arith, { sub: "Typed: every port gives or takes a number", group: "Typed" });
    add(buildLists(src("3 + 2")), { level: "optional", names: [NAMES.num, NAMES.list] }, PORTS.lists, { sub: "Two type names. δ and ε are left untyped", group: "Typed", noSteps: true });
    add(src("Directed commutation"), { level: "required", names: [] }, PORTS.directed, { sub: "Polarised: gives and takes, no names", group: "Polarised" });
    add(src("Directed erasing"), { level: "required", names: [] }, PORTS.directed, { sub: "Polarised: gives and takes, no names", group: "Polarised" });
    for (const n of ["Commutation", "Erasing a tree", "Duplicating a loop", "Runs forever"]) add(src(n), { level: "untyped", names: [] }, null, { group: "Untyped" });
    for (const e of out) for (const s of e.states) NK.normaliseState(s);
    data.examples = out;
    // A file whose declarations don't fit its own net: "+" says aux 2 gives.
    const bad = clone(out[0]); bad.name = "sum.inet"; bad.types.find((x) => x.id === "+").ports[2] = g("num");
    data.badFile = bad;
    return data;
  }

  /* ------------------------------------------------------------ words */
  const nameOf = (S, id) => { const n = S.sys && S.sys.names.find((x) => x.id === id); return n ? n.label : id; };
  const art = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
  const verb = (p) => (p.pol === "give" ? "gives" : "takes");
  const opp = (pol) => (pol === "give" ? "take" : "give");
  // "gives a number" / "takes" / "untyped"
  function phrase(S, p, o = {}) {
    if (!p || !p.pol) return o.untyped || "untyped";
    return verb(p) + (p.name ? " " + art(nameOf(S, p.name)) : o.bare ? "" : "");
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // "Takes a number. Wire it to a port that gives one."
  function sentence(S, p) {
    if (!p || !p.pol) return S.sys && S.sys.level === "optional" ? "Untyped: it fits any port, giving or taking." : "";
    if (p.name) return `${cap(phrase(S, p))}. Wire it to a port that ${opp(p.pol)}s one.`;
    return `${cap(verb(p))}. Wire it to a port that ${opp(p.pol)}s.`;
  }

  /* ------------------------------------------------------------ typing */
  function level(S) { return (S.sys && S.sys.level) || "untyped"; }
  function portOf(S, typeId, slot, override) {
    if (level(S) === "untyped") return null;
    const ports = override && override[typeId] ? override[typeId] : (S.typeById(typeId) || {}).ports;
    return ports ? ports[slot] || null : null;
  }
  // type of a wire end; a loose end is the outside, which takes what its port gives
  function endType(S, view, end, override) {
    if (end.free != null) {
      const w = view.wireOfFree(end.free); if (!w) return null;
      const o = w.ends.find((e) => e.free !== end.free); if (!o || o.free != null) return null;
      const p = endType(S, view, o, override); return p && p.pol ? { pol: opp(p.pol), name: p.name } : null;
    }
    const a = view.agent(end.agent); if (!a) return null;
    return portOf(S, a.type, end.slot, override);
  }
  // Do two ports fit on one wire? null if yes, else { note, why }.
  function compare(S, a, b, o = {}) {
    if (!a || !b || !a.pol || !b.pol) return null;
    const here = o.here || "this port", there = o.there || "the other end";
    if (a.pol === b.pol) {
      const same = a.name === b.name || !a.name || !b.name;
      const n = a.name || b.name;
      if (same) return { note: a.pol === "give" ? "Both give" : "Both take", why: `Both ports ${verb(a).replace(/s$/, "")}${n ? " " + art(nameOf(S, n)) : ""}. A wire has to join a port that gives to one that takes.`, kind: "pol" };
      return { note: a.pol === "give" ? "Both give" : "Both take", why: `${cap(here)} ${phrase(S, b)}, and ${there} ${phrase(S, a)}. A wire has to join a port that gives to one that takes.`, kind: "pol" };
    }
    if (a.name && b.name && a.name !== b.name) return { note: "Wrong type", why: `${cap(here)} ${phrase(S, b)}, ${there} ${phrase(S, a)}.`, kind: "name" };
    return null;
  }
  function clash(S, view, D, end) {
    if (!D.originEnd || D.originEnd.free != null) return null;
    const a = endType(S, view, D.originEnd);
    if (end.free != null) {
      const v = view.wireOfFree(end.free); const gEnd = v && v.ends.find((e) => e.free !== end.free);
      if (!gEnd || gEnd.free != null) return null;
      const r = compare(S, a, endType(S, view, gEnd), { here: "the wire behind this loose end", there: "your wire" });
      return r;
    }
    return compare(S, a, endType(S, view, end), { here: "this port", there: "the port you started from" });
  }
  function typing(S) {
    return { endType: (view, end) => endType(S, view, end), clash: (view, D, end) => clash(S, view, D, end) };
  }
  // direction of flow along a wire: +1 from ends[0] to ends[1], -1 back, 0 unknown
  function flow(S, view, w) {
    const t0 = endType(S, view, w.ends[0]), t1 = endType(S, view, w.ends[1]);
    if (t0 && t0.pol) return t0.pol === "give" ? 1 : -1;
    if (t1 && t1.pol) return t1.pol === "take" ? 1 : -1;
    return 0;
  }
  const wireName = (S, view, w) => { const t0 = endType(S, view, w.ends[0]), t1 = endType(S, view, w.ends[1]); return (t0 && t0.name) || (t1 && t1.name) || null; };

  /* ------------------------------------------------------------ changes */
  // Wires on the canvas that wouldn't fit if typeId had these ports.
  function conflicts(S, view, typeId, ports) {
    const ov = { [typeId]: ports }, out = [];
    for (const w of view.state.wires) {
      if (!w.ends.some((e) => e.agent != null && (view.agent(e.agent) || {}).type === typeId)) continue;
      if (w.ends.some((e) => e.free != null)) continue;
      const t0 = endType(S, view, w.ends[0], ov), t1 = endType(S, view, w.ends[1], ov);
      const r = compare(S, t0, t1);
      if (r) {
        const n0 = endLabel(S, view, w.ends[0]), n1 = endLabel(S, view, w.ends[1]);
        const why = r.kind === "pol" ? `${cap(n0)} and ${n1} would both ${t0.pol}${t0.name || t1.name ? " " + art(nameOf(S, t0.name || t1.name)) : ""}.` : `${cap(n0)} would ${t0.pol} ${art(nameOf(S, t0.name))}, but ${n1} ${t1.pol}s ${art(nameOf(S, t1.name))}.`;
        out.push({ wire: w, why, note: r.note });
      }
    }
    return out;
  }
  function endLabel(S, view, e) {
    if (e.free != null) return "loose end " + e.free;
    const a = view.agent(e.agent), ty = S.typeById(a.type) || { symbol: a.type };
    return (e.slot === 0 ? "the principal port of " : `aux port ${e.slot} of `) + ty.symbol;
  }
  // Cut wires into two loose ends each.
  function cut(view, ids, whys) {
    const s = view.state;
    for (const id of ids) {
      const w = s.wires.find((x) => x.id === id); if (!w) continue;
      s.wires = s.wires.filter((x) => x !== w);
      const ps = w.ends.map((e) => view.endPos(e));
      w.ends.forEach((e, k) => {
        if (e.free != null) { s.free = s.free.filter((f) => f.name !== e.free); return; }
        const p = ps[k], q = ps[1 - k], name = view.newFreeName();
        let x = p[0] + (q[0] - p[0]) * 0.34, y = p[1] + (q[1] - p[1]) * 0.34;
        const d = view.endDir(e);
        if (view.layout === "auto") {
          // like any loose end in auto layout: off the top or bottom edge, beside the others there
          const b = NK.stateBounds({ agents: s.agents, wires: [], free: [] }), top = d[1] < 0;
          y = top ? b.y0 - 30 : b.y1 + 30; x = b.x0 - 18;
          while (s.free.some((f) => Math.abs(f.x - x) < 10)) x -= 12;
          var route = [p, [p[0] + d[0] * 10, p[1] + d[1] * 10], [x, p[1] + d[1] * 10], [x, y]];
        } else if (Math.hypot(x - p[0], y - p[1]) < 12) { x = p[0] + d[0] * 14 + (k ? 7 : -7); y = p[1] + d[1] * 14; }
        s.free.push({ name, x, y, dir: y < p[1] ? "up" : "down", cut: true, why: whys && whys[id] });
        const nw = { id: view.nid++, ends: [e, { free: name }], path: [] }; s.wires.push(nw);
        if (view.layout === "auto" && route) { nw.path = route; route = null; } else view._curveWire(nw);
      });
    }
    view.render();
  }
  function missing(S) {
    const out = [];
    for (const ty of S.types) for (let i = 0; i <= ty.arity; i++) if (!ty.ports || !ty.ports[i] || !ty.ports[i].pol) out.push({ type: ty.id, slot: i });
    return out;
  }
  function portCount(S) { let n = 0; for (const ty of S.types) if (ty.ports) n += ty.ports.filter((p) => p && p.pol).length; return n; }
  // Guess a polarity from the wiring on the canvas: the opposite of whatever it's wired to.
  function guess(S, view, typeId, slot) {
    for (const a of view.state.agents) {
      if (a.type !== typeId) continue;
      const w = view.wireAt(a.id, slot); if (!w) continue;
      const o = w.ends.find((e) => !(e.agent === a.id && e.slot === slot)); if (!o || o.free != null) continue;
      const p = endType(S, view, o); if (p && p.pol) return { pol: opp(p.pol), name: null, from: o, seen: p };
    }
    return null;
  }
  function ensurePorts(ty) { if (!ty.ports) ty.ports = Array(ty.arity + 1).fill(null); while (ty.ports.length < ty.arity + 1) ty.ports.push(null); ty.ports.length = ty.arity + 1; }
  function setLevel(S, lv) {
    if (!S.sys) S.sys = { level: "untyped", names: [] };
    S.sys.level = lv;
    if (lv === "untyped") { for (const ty of S.types) ty.ports = null; S.sys.names = []; }
    else for (const ty of S.types) ensurePorts(ty);
  }

  /* ------------------------------------------------------------ rule grid */
  // Can agents of types a and b ever meet (principal to principal)?
  function meet(S, a, b) {
    const ta = S.typeById(a), tb = S.typeById(b);
    const pa = portOf(S, a, 0), pb = portOf(S, b, 0);
    if (!pa || !pb || !pa.pol || !pb.pol) return { can: true, untyped: level(S) !== "untyped" && (!pa || !pb || !pa.pol || !pb.pol) };
    if (pa.pol === pb.pol) {
      const n = pa.name || pb.name, v = pa.pol === "give" ? "give" : "take";
      if (a === b) return { can: false, why: `Two ${esc(ta.symbol)} can never meet: both principal ports would ${v}${n ? " " + art(nameOf(S, n)) : ""}.`, short: `both ${v}`, kind: "pol" };
      return { can: false, why: `Both principal ports ${v}${n && pa.name === pb.name ? " " + art(nameOf(S, n)) : ""}.`, short: `both ${v}`, kind: "pol" };
    }
    if (pa.name && pb.name && pa.name !== pb.name) {
      const gv = pa.pol === "give" ? [ta, pa] : [tb, pb], tk = pa.pol === "give" ? [tb, pb] : [ta, pa];
      return { can: false, why: `${esc(gv[0].symbol)} gives ${art(nameOf(S, gv[1].name))}, but ${esc(tk[0].symbol)} takes ${art(nameOf(S, tk[1].name))}.`, short: "different types", kind: "name" };
    }
    return { can: true };
  }
  function principalPol(S, id) { const p = portOf(S, id, 0); return p && p.pol ? p.pol : null; }

  /* ------------------------------------------------------------ rule sheet mini nets (q7) */
  // Right-hand sides for a couple of arithmetic rules, with the interface ports.
  function ruleRHS(key) {
    const T = { S: { id: "S", symbol: "S", arity: 1 }, "+": { id: "+", symbol: "+", arity: 2 } };
    if (key === "+|0") {
      return { iface: [{ name: "r", x: -16, y: -56, dir: "up", note: "the result" }, { name: "y", x: 16, y: -56, dir: "up", note: "the second number" }], agents: [], wires: [{ id: 1, ends: [{ free: "r" }, { free: "y" }], path: NK.curve([-16, -56], [0, 1], [16, -56], [0, 1], 18) }] };
    }
    if (key === "+|S") {
      const s = NK.makeAgent(T.S, 1, -8, -26, "up"), p = NK.makeAgent(T["+"], 2, 0, 34, "down");
      const pos = { r: [-8, -78], y: [24, -78], x: [0, 86] };
      return { iface: [{ name: "r", x: -8, y: -78, dir: "up", note: "the result" }, { name: "y", x: 24, y: -78, dir: "up", note: "the second number" }, { name: "x", x: 0, y: 86, dir: "down", note: "the number before S" }],
        agents: [s, p],
        wires: [
          { id: 1, ends: [{ agent: 1, slot: 0 }, { free: "r" }], path: NK.curve(s.ports[0], [0, -1], pos.r, [0, 1], 10) },
          { id: 2, ends: [{ agent: 1, slot: 1 }, { agent: 2, slot: 1 }], path: NK.curve(s.ports[1], [0, 1], p.ports[1], [0, -1], 10) },
          { id: 3, ends: [{ agent: 2, slot: 2 }, { free: "y" }], path: NK.curve(p.ports[2], [0, -1], pos.y, [0, 1], 14) },
          { id: 4, ends: [{ agent: 2, slot: 0 }, { free: "x" }], path: NK.curve(p.ports[0], [0, 1], pos.x, [0, -1], 10) },
        ] };
    }
    return null;
  }

  window.TypeKit = { endLabel, prepare, typing, endType, compare, clash, flow, wireName, phrase, sentence, verb, art, nameOf, cap, level, portOf, conflicts, cut, missing, portCount, guess, ensurePorts, setLevel, meet, principalPol, ruleRHS, ROLES, opp };
})();
