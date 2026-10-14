/**
 * Exports real engine layouts and translation numbers for the round 3
 * (editors) prototypes into design/assets/editors.json.
 *
 *   npx vite-node design/scripts/export-editors.ts
 *
 * For each example: its system (agents, ports, rules), and the net laid out
 * by the engine after every parallel step. For each pair of agent types:
 * the pair and the rule's result, laid out with the interface pinned along
 * the top and bottom as in the rule editor. For each system: Lafont's
 * translation into γ, δ, ε (whether the restricted one applies and why,
 * the size of each agent's cell, and what each rule costs in combinator
 * interactions, by kind).
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentId, type End, Net, NONE, free, port } from "../../src/core/net";
import { arithmetic, combinators, directedCombinators, lists } from "../../src/core/presets";
import { interfacePins, pairNet, ruleToNet } from "../../src/core/ruleNet";
import { interact, parallelStep, redexes } from "../../src/core/reduce";
import { System, pairKey } from "../../src/core/system";
import { TranslationError, translation } from "../../src/core/translate";
import { autoLayout } from "../../src/layout/place";
import { G } from "../../src/layout/geometry";
import type { Placement } from "../../src/layout/geometry";
import { flattenPath } from "../../src/render/path";

const here = dirname(fileURLToPath(import.meta.url));
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------ nets as trees */
type Spec = { type: string; aux: Arg[] };
type Arg = Spec | { free: string } | Hole;
class Hole {
  end?: End;
}
const t = (type: string, ...aux: Arg[]): Spec => ({ type, aux });
const f = (name: string) => ({ free: name });
function build(net: Net, sys: System, spec: Spec): End {
  const id = net.addAgent(sys.type(spec.type));
  spec.aux.forEach((arg, i) => {
    const p = port(id, i + 1);
    if (arg instanceof Hole) arg.end = p;
    else if ("free" in arg) {
      net.free.set(arg.free, NONE);
      net.connect(p, free(arg.free));
    } else net.connect(p, build(net, sys, arg));
  });
  return port(id, 0);
}
const link = (net: Net, a: Hole | End, b: Hole | End) => net.connect(a instanceof Hole ? a.end! : a, b instanceof Hole ? b.end! : b);
const num = (n: number): Spec => (n === 0 ? t("0") : t("S", num(n - 1)));

const tokens = () => new System().addType({ id: "A", name: "token", symbol: "A", arity: 0 });
const annihilating = () => tokens().addRule({ left: "A", right: "A", agents: [], wires: [] });
const noCommutation = () => {
  const s = combinators();
  s.rules.delete("δ|γ");
  return s;
};

/* ------------------------------------------------------------ layout → prototype state */
function stateOf(net: Net, placement: Placement, routed: ReturnType<typeof autoLayout>["routed"]) {
  const agents = [...net.agents.values()].map((a) => {
    const p = placement.get(a.id)!;
    return { id: a.id, type: a.type, x: r1(p.x), y: r1(p.y), orient: p.orient };
  });
  const wires = [...net.wires.values()].map((w) => {
    const ends = w.ends.map((e) => (e.kind === "port" ? { agent: e.agent, slot: e.slot } : { free: e.name }));
    const pts = routed.wires.get(w.id) ?? [];
    return { id: w.id, ends, path: flattenPath(pts, G.radius).map((p) => [r1(p.x), r1(p.y)]) };
  });
  const freeList = [...routed.free.entries()].map(([name, p]) => ({ name, x: r1(p.x), y: r1(p.y), dir: p.dir }));
  return { agents, wires, free: freeList };
}
function lay(net: Net, opts: Parameters<typeof autoLayout>[1] = {}) {
  const l = autoLayout(net, opts);
  return { l, state: stateOf(net, l.placement, l.routed) };
}

/* ------------------------------------------------------------ systems */
function systemJSON(sys: System) {
  return {
    types: [...sys.types.values()].map((ty) => ({
      id: ty.id,
      name: ty.name,
      symbol: ty.symbol,
      arity: ty.arity,
      filled: !!ty.filled,
      ports: (ty.ports ?? []).map((p) => ({ pol: p?.pol ?? null, type: p?.type ?? null, label: p?.label ?? "" })),
    })),
    rules: [...sys.rules.values()].map((r) => pairKey(r.left, r.right)),
    typing: sys.typing,
  };
}

/** Every unordered pair of agent types, with the pair and its rule's result laid out like the rule editor. */
function rulesOf(sys: System) {
  const ids = [...sys.types.keys()];
  const out: Record<string, unknown> = {};
  ids.forEach((a, i) =>
    ids.forEach((b, j) => {
      if (j < i) return;
      const found = sys.ruleFor(a, b);
      const [left, right] = found ? [found.rule.left, found.rule.right] : [a, b];
      const pins = interfacePins(sys, left, right);
      const lhs = lay(pairNet(sys, left, right).net, { pins }).state;
      let rhs = null;
      if (found) {
        const net = ruleToNet(sys, found.rule);
        rhs = lay(net, { pins }).state;
      } else {
        // just the interface, pinned where it would be
        const net = pairNet(sys, left, right).net;
        const l = autoLayout(net, { pins });
        rhs = { agents: [], wires: [], free: [...l.routed.free.entries()].map(([name, p]) => ({ name, x: r1(p.x), y: r1(p.y), dir: p.dir })) };
      }
      out[pairKey(left, right)] = { left, right, has: !!found, created: found ? found.rule.agents : [], lhs, rhs };
    }),
  );
  return out;
}

/* ------------------------------------------------------------ translation */
function kindOf(a: string, b: string) {
  if (a === "ε" || b === "ε") return "erase";
  if (a === b) return "annihilate";
  return "copy";
}
/** Reduce a translated net to normal form, counting interactions by kind. */
function costOf(net: Net, sys: System) {
  const c = { total: 0, annihilate: 0, erase: 0, copy: 0 };
  for (let guard = 0; guard < 400_000; guard++) {
    const rs = redexes(net, sys);
    if (!rs.length) return c;
    const [ea, eb] = net.wire(rs[0]!).ends;
    if (ea.kind !== "port" || eb.kind !== "port") return c;
    const k = kindOf(net.agent(ea.agent).type, net.agent(eb.agent).type) as "erase" | "annihilate" | "copy";
    interact(net, sys, rs[0]!);
    c.total++;
    c[k]++;
  }
  return { ...c, gaveUp: true };
}
/** Rules whose result makes a new agent of one of the pair's own types: why restricted can fail. */
function selfMaking(sys: System) {
  const out: { key: string; left: string; right: string; makes: string[] }[] = [];
  for (const r of sys.rules.values()) {
    const makes = [...new Set(r.agents.filter((x) => x === r.left || x === r.right))];
    if (makes.length) out.push({ key: pairKey(r.left, r.right), left: r.left, right: r.right, makes });
  }
  return out;
}
/**
 * Rules that make a new agent of *both* their types (or of their own type,
 * for a pair of the same type). Whichever of the two cells carries the
 * result, it would have to contain a cell of its own kind, forever: these
 * are what rule out the restricted translation.
 */
function blockers(sys: System) {
  return selfMaking(sys).filter((r) => (r.left === r.right ? r.makes.length > 0 : r.makes.includes(r.left) && r.makes.includes(r.right)));
}

/**
 * Take one agent's translated cell apart, following Lafont's construction
 * (translate.ts): the tip δ (T₁,₁) holds a γ whose first aux port leads to
 * the menu and second to the selector; the selector hands the chosen leaf
 * to the multiplexor M, whose first leaf is the code in the general case.
 */
function cellParts(sys: System, typeId: string, mode: "general" | "restricted") {
  const ty = sys.type(typeId);
  const types = [...sys.types.keys()];
  const m = types.length;
  const i = types.indexOf(typeId);
  const src = new Net();
  const id = src.addAgent(ty);
  for (let s = 0; s <= ty.arity; s++) {
    src.free.set(`p${s}`, NONE);
    src.connect(port(id, s), free(`p${s}`));
  }
  const net = translation(sys, mode).net(src).net;
  const partner = (a: AgentId, s: number) => net.partner(port(a, s));
  const root = net.partner(free("p0"));
  if (!root || root.kind !== "port") return null;
  const flood = (start: End, from: End) => {
    if (start.kind !== "port") return 0;
    const seen = new Set<AgentId>([start.agent]);
    const todo = [start.agent];
    while (todo.length) {
      const a = todo.pop()!;
      const ag = net.agent(a);
      for (let s = 0; s < ag.wires.length; s++) {
        const p = partner(a, s);
        if (!p || p.kind !== "port") continue;
        if (a === start.agent && s === start.slot && p.agent === (from as { agent: number }).agent) continue;
        if (!seen.has(p.agent)) {
          seen.add(p.agent);
          todo.push(p.agent);
        }
      }
    }
    return seen.size;
  };
  const g = partner(root.agent, 1)!;
  if (g.kind !== "port") return null;
  const menuRoot = partner(g.agent, 1)!;
  const menu = flood(menuRoot, port(g.agent, 1));
  // packages: M comb over m leaves (port 1 = this leaf, port 2 = the rest)
  const packages: Record<string, number> = {};
  let node: End | undefined = menuRoot;
  let from: End = port(g.agent, 1);
  for (let l = 0; l < m; l++) {
    if (!node || node.kind !== "port") break;
    if (l === m - 1) {
      packages[types[l]!] = flood(node, from);
      break;
    }
    const leaf = partner(node.agent, 1)!;
    packages[types[l]!] = flood(leaf, port(node.agent, 1));
    from = port(node.agent, 2);
    node = partner(node.agent, 2);
  }
  // selector: M* comb (port 2 = this leaf, port 1 = the rest), leaf i goes on to M
  let sel = partner(g.agent, 2);
  let n = m;
  let k = i;
  let mRoot: End | undefined = sel;
  while (n > 1 && mRoot && mRoot.kind === "port") {
    if (k === 0) {
      mRoot = partner(mRoot.agent, 2);
      break;
    }
    mRoot = partner(mRoot.agent, 1);
    k--;
    n--;
  }
  let code = 0;
  if (mode === "general" && mRoot && mRoot.kind === "port") {
    const c = partner(mRoot.agent, 1)!;
    code = flood(c, port(mRoot.agent, 1));
  }
  return { total: net.agents.size, menu, packages, code, selector: m > 1 ? 2 * (m - 1) : 0 };
}

function translationInfo(sys: System) {
  const comb = combinators();
  const info: Record<string, unknown> = {};
  let restricted: { ok: boolean; why?: string } = { ok: true };
  try {
    const tr = translation(sys, "restricted");
    if (tr.identity) {
      return { identity: true, restricted: { ok: true }, cells: {}, rules: {}, selfMaking: selfMaking(sys), blockers: blockers(sys) };
    }
  } catch (e) {
    restricted = { ok: false, why: e instanceof TranslationError ? e.message : String(e) };
  }
  info.identity = false;
  info.restricted = restricted;
  info.selfMaking = selfMaking(sys);
  const modes = restricted.ok ? (["restricted", "general"] as const) : (["general"] as const);
  const cells: Record<string, Record<string, number>> = {};
  for (const ty of sys.types.values()) {
    const net = new Net();
    const id = net.addAgent(ty);
    for (let s = 0; s <= ty.arity; s++) {
      net.free.set(`p${s}`, NONE);
      net.connect(port(id, s), free(`p${s}`));
    }
    cells[ty.id] = {};
    for (const m of modes) cells[ty.id]![m] = translation(sys, m).net(net).net.agents.size;
  }
  info.cells = cells;
  info.blockers = blockers(sys);
  info.parts = Object.fromEntries(
    [...sys.types.keys()].map((id) => [id, Object.fromEntries(modes.map((m) => [m, cellParts(sys, id, m)]))]),
  );
  const rules: Record<string, Record<string, unknown>> = {};
  for (const r of sys.rules.values()) {
    const key = pairKey(r.left, r.right);
    rules[key] = {};
    for (const m of modes) {
      const tr = translation(sys, m);
      const { net } = tr.net(pairNet(sys, r.left, r.right).net);
      const size = net.agents.size;
      rules[key]![m] = { size, ...costOf(net, comb) };
    }
  }
  info.rules = rules;
  return info;
}

/* ------------------------------------------------------------ examples */
interface Ex {
  name: string;
  group: string;
  about: string;
  sys: () => System;
  net: (sys: System) => Net;
  maxSteps?: number;
}
const EXAMPLES: Ex[] = [
  { name: "3 + 2", group: "Arithmetic", about: "Adding two numbers.", sys: arithmetic, net: (s) => { const n = new Net(); n.free.set("out", NONE); link(n, build(n, s, num(3)), build(n, s, t("+", f("out"), num(2)))); return n; } },
  { name: "3 × 2", group: "Arithmetic", about: "Multiplying by repeated adding.", sys: arithmetic, net: (s) => { const n = new Net(); link(n, build(n, s, num(3)), build(n, s, t("×", f("out"), num(2)))); return n; }, maxSteps: 14 },
  { name: "Copy a number", group: "Arithmetic", about: "A duplicator copies a number.", sys: arithmetic, net: (s) => { const n = new Net(); link(n, build(n, s, num(2)), build(n, s, t("δ", f("a"), f("b")))); return n; } },
  { name: "Commutation", group: "Combinators", about: "A constructor meets a duplicator, and each gets copied.", sys: combinators, net: (s) => { const n = new Net(); link(n, build(n, s, t("γ", f("a"), f("b"))), build(n, s, t("δ", f("c"), f("d")))); return n; } },
  { name: "Erasing a tree", group: "Combinators", about: "An eraser takes a tree apart.", sys: combinators, net: (s) => { const n = new Net(); link(n, build(n, s, t("ε")), build(n, s, t("γ", t("δ", f("a"), f("b")), t("γ", f("c"), t("ε"))))); return n; } },
  { name: "Runs forever", group: "Combinators", about: "Lafont's figure 3: comes back to itself after four steps.", sys: combinators, maxSteps: 8, net: (s) => { const n = new Net(); const x = new Hole(), y = new Hole(); link(n, build(n, s, t("γ", x, t("ε"))), build(n, s, t("δ", t("ε"), y))); link(n, x, y); return n; } },
  { name: "Directed commutation", group: "Directed combinators", about: "γ meets δ*, and each gets copied.", sys: directedCombinators, net: (s) => { const n = new Net(); link(n, build(n, s, t("γ", f("a"), f("b"))), build(n, s, t("δ*", f("c"), f("d")))); return n; } },
  { name: "Two annihilating tokens", group: "Small systems", about: "Two tokens meet and both disappear.", sys: annihilating, net: (s) => { const n = new Net(); link(n, build(n, s, t("A")), build(n, s, t("A"))); return n; } },
  { name: "Erasing without commutation", group: "Small systems", about: "The combinators without the γ–δ rule: nothing can make itself.", sys: noCommutation, net: (s) => { const n = new Net(); link(n, build(n, s, t("ε")), build(n, s, t("γ", t("ε"), t("ε")))); return n; } },
  { name: "Length of a list", group: "Lists", about: "Numbers and lists are different types.", sys: lists, net: (s) => { const n = new Net(); const list = t("∷", t("0"), t("∷", t("S", t("0")), t("∷", t("0"), t("[]")))); link(n, build(n, s, t("#", f("out"))), build(n, s, list)); return n; } },
];

function exportExample(ex: Ex) {
  const sys = ex.sys();
  const net = ex.net(sys);
  const states = [];
  let prev: Placement | undefined;
  for (let i = 0; i <= (ex.maxSteps ?? 12); i++) {
    const { l, state } = lay(net, { prev });
    prev = l.placement;
    states.push(state);
    if (!parallelStep(net, sys).length) break;
  }
  return { name: ex.name, group: ex.group, about: ex.about, sysKey: sysKeyOf(sys), states };
}

const SYSTEMS: Record<string, () => System> = { arith: arithmetic, comb: combinators, directed: directedCombinators, tokens: annihilating, nocomm: noCommutation, lists };
function sysKeyOf(sys: System) {
  const ids = [...sys.types.keys()].join(",");
  for (const [k, mk] of Object.entries(SYSTEMS)) {
    const s = mk();
    if ([...s.types.keys()].join(",") === ids && s.rules.size === sys.rules.size) return k;
  }
  throw new Error("unknown system " + ids);
}

/* ------------------------------------------------------------ whole-net translation sizes */
function sizes(ex: Ex) {
  const sys = ex.sys();
  const net = ex.net(sys);
  const out: Record<string, number | null> = { agents: net.agents.size };
  for (const m of ["restricted", "general"] as const) {
    try {
      out[m] = translation(sys, m).net(net).net.agents.size;
    } catch {
      out[m] = null;
    }
  }
  return out;
}

/* ------------------------------------------------------------ real combinator nets, for small systems */
/** One agent's cell, laid out by the engine, with its ports as loose ends p0 (principal), p1… */
function realCell(sys: System, typeId: string, mode: "general" | "restricted") {
  const ty = sys.type(typeId);
  const src = new Net();
  const id = src.addAgent(ty);
  for (let s = 0; s <= ty.arity; s++) {
    src.free.set(`p${s}`, NONE);
    src.connect(port(id, s), free(`p${s}`));
  }
  const net = translation(sys, mode).net(src).net;
  return lay(net).state;
}
/** A rule played out in combinators, one interaction per state. `fires` is the wire that fires next. */
function realRule(sys: System, key: string, mode: "general" | "restricted", max = 80) {
  const r = sys.rules.get(key)!;
  const tr = translation(sys, mode);
  const { net, tagOf } = tr.net(pairNet(sys, r.left, r.right).net);
  const comb = combinators();
  const states = [];
  let prev: Placement | undefined;
  for (let i = 0; i <= max; i++) {
    const rs = redexes(net, comb);
    const { l, state } = lay(net, { prev });
    prev = l.placement;
    const kinds = rs[0] !== undefined ? (() => { const [a, b] = net.wire(rs[0]!).ends; return a.kind === "port" && b.kind === "port" ? kindOf(net.agent(a.agent).type, net.agent(b.agent).type) : null; })() : null;
    states.push({ ...state, fires: rs[0] ?? null, kind: kinds, tags: i === 0 ? Object.fromEntries([...tagOf].map(([c, a]) => [c, a])) : undefined });
    if (!rs.length) break;
    interact(net, comb, rs[0]!);
  }
  return states;
}
const realNets = {
  tokens: {
    cells: { A: { restricted: realCell(annihilating(), "A", "restricted"), general: realCell(annihilating(), "A", "general") } },
    rules: { "A|A": { restricted: realRule(annihilating(), "A|A", "restricted"), general: realRule(annihilating(), "A|A", "general") } },
  },
  nocomm: {
    cells: {
      ε: { restricted: realCell(noCommutation(), "ε", "restricted") },
      γ: { restricted: realCell(noCommutation(), "γ", "restricted") },
      δ: { restricted: realCell(noCommutation(), "δ", "restricted") },
    },
    rules: { "ε|γ": { restricted: realRule(noCommutation(), "ε|γ", "restricted") }, "ε|δ": { restricted: realRule(noCommutation(), "ε|δ", "restricted") } },
  },
};

const data = {
  realNets,
  note: "Generated by design/scripts/export-editors.ts from src/core and src/layout. Do not edit by hand.",
  geometry: { ...G },
  systems: Object.fromEntries(
    Object.entries(SYSTEMS).map(([k, mk]) => {
      const sys = mk();
      return [k, { ...systemJSON(sys), pairs: rulesOf(sys), translation: translationInfo(sys) }];
    }),
  ),
  examples: EXAMPLES.map((e) => ({ ...exportExample(e), sizes: sizes(e) })),
};
const out = resolve(here, "../assets/editors.json");
writeFileSync(out, JSON.stringify(data));
console.log("wrote", out, (JSON.stringify(data).length / 1024).toFixed(0) + " KB");
for (const [k, s] of Object.entries(data.systems)) console.log(k, JSON.stringify((s as { translation: unknown }).translation).slice(0, 600));
for (const e of data.examples) console.log(e.name, e.states.length, "states", JSON.stringify(e.sizes));
