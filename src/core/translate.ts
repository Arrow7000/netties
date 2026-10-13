import { canonical } from "./canon";
import { type AgentId, type End, Net, NONE, endKey, free, port } from "./net";
import { combinators } from "./presets";
import { ruleToNet } from "./ruleNet";
import type { Rule, System } from "./system";

/**
 * Lafont's translation of any interaction system into the interaction
 * combinators (Interaction Combinators, 1997, §2). The pieces are built
 * exactly as in the paper:
 *
 * - multiplexors M_n, M*_n (γ trees) and autodual multiplexors T_n (δ trees),
 *   transpositors T_{p,q} and T_σ for involutions σ (Figs. 4, 5);
 * - menus π₁ & … & π_n and selectors S^i_n (§2.3);
 * - codes !π, copiers C_n and the decoder D (Figs. 8, 9);
 * - cells: [α_i] in the general case (Fig. 10), or the code-free restricted
 *   case (Fig. 6) for systems without recursion.
 *
 * Constructions are written against a small netlist builder where wires
 * can pass through junctions ("holes"), so that pieces like M₁ (a bare
 * wire) compose freely; the netlist is then resolved into a real net.
 */

export type Ref = { c: number; s: number } | { f: string } | { h: number };

export class Builder {
  readonly cells: { type: "γ" | "δ" | "ε"; tag?: number }[] = [];
  readonly links: [Ref, Ref][] = [];
  holes = 0;
  /** Cells created from now on belong to this source agent, for grouping. */
  tag?: number;

  cell(type: "γ" | "δ" | "ε"): number {
    this.cells.push({ type, tag: this.tag });
    return this.cells.length - 1;
  }

  hole(): Ref {
    return { h: this.holes++ };
  }

  link(a: Ref, b: Ref) {
    this.links.push([a, b]);
  }

  /** Copy another netlist in, plugging its free ports into the given refs. */
  embed(t: Builder, bind: Record<string, Ref>) {
    const base = this.cells.length;
    const hbase = this.holes;
    for (const c of t.cells) this.cells.push({ type: c.type, tag: this.tag });
    this.holes += t.holes;
    const map = (r: Ref): Ref => {
      if ("c" in r) return { c: r.c + base, s: r.s };
      if ("h" in r) return { h: r.h + hbase };
      const b = bind[r.f];
      if (!b) throw new Error(`unbound free port ${r.f}`);
      return b;
    };
    for (const [a, b] of t.links) this.links.push([map(a), map(b)]);
  }

  /** Resolve junctions into a real net. Every cell port must be linked exactly once. */
  toNet(): { net: Net; ids: AgentId[] } {
    const key = (r: Ref) => ("c" in r ? `c${r.c}:${r.s}` : "h" in r ? `h${r.h}` : `f${r.f}`);
    // For each ref, the links touching it (as indices into this.links).
    const touching = new Map<string, number[]>();
    this.links.forEach(([a, b], i) => {
      for (const r of a === b ? [a] : [a, b]) {
        const l = touching.get(key(r)) ?? [];
        l.push(i);
        touching.set(key(r), l);
      }
    });
    const across = (i: number, from: string): Ref => {
      const [a, b] = this.links[i]!;
      return key(a) === from ? b : a;
    };
    const sys = combinators();
    const net = new Net();
    const ids = this.cells.map((c) => net.addAgent(sys.type(c.type)));
    const end = (r: Ref): End => ("c" in r ? port(ids[r.c]!, r.s) : free((r as { f: string }).f));
    const used = new Set<number>();
    const ends: Ref[] = [];
    const arity = { γ: 2, δ: 2, ε: 0 };
    this.cells.forEach((c, i) => {
      for (let s = 0; s <= arity[c.type]; s++) ends.push({ c: i, s });
    });
    const frees = new Set<string>();
    for (const [a, b] of this.links) for (const r of [a, b]) if ("f" in r) frees.add(r.f);
    for (const f of frees) ends.push({ f });
    for (const r of ends) {
      const ls = touching.get(key(r)) ?? [];
      if (ls.length !== 1) throw new Error(`port ${key(r)} has ${ls.length} links`);
      if (used.has(ls[0]!)) continue;
      // Follow junctions until the next real port.
      let link = ls[0]!;
      let at = key(r);
      let cur = across(link, at);
      used.add(link);
      while ("h" in cur) {
        const k = key(cur);
        const both = touching.get(k)!;
        if (both.length !== 2) throw new Error(`junction ${k} has ${both.length} links`);
        link = both[0] === link ? both[1]! : both[0]!;
        used.add(link);
        at = k;
        cur = across(link, at);
      }
      for (const e of [r, cur]) if ("f" in e && !net.free.has(e.f)) net.free.set(e.f, NONE);
      net.connect(end(r), end(cur));
    }
    return { net, ids };
  }

  /** For each given junction, the cell ports reached by walking away from it along each of its links. */
  innerEnds(junctions: Map<number, Ref>): Map<number, { c: number; s: number }[]> {
    const key = (r: Ref) => ("c" in r ? `c${r.c}:${r.s}` : "h" in r ? `h${r.h}` : `f${r.f}`);
    const touching = new Map<string, number[]>();
    this.links.forEach(([a, b], i) => {
      for (const r of [a, b]) {
        const l = touching.get(key(r)) ?? [];
        l.push(i);
        touching.set(key(r), l);
      }
    });
    const out = new Map<number, { c: number; s: number }[]>();
    for (const [w, h] of junctions) {
      const found: { c: number; s: number }[] = [];
      for (const start of touching.get(key(h)) ?? []) {
        let link = start;
        let at = key(h);
        let cur = this.links[link]![0];
        if (key(cur) === at) cur = this.links[link]![1];
        while ("h" in cur) {
          const k = key(cur);
          const both = touching.get(k)!;
          link = both[0] === link ? both[1]! : both[0]!;
          at = k;
          const [x, y] = this.links[link]!;
          cur = key(x) === at ? y : x;
        }
        if ("c" in cur) found.push(cur);
      }
      out.set(w, found);
    }
    return out;
  }

  // Constructions. Each takes the refs its free ports should be linked to.

  /** M_n: a γ comb γ(x₁, γ(x₂, …)) (Fig. 4). */
  M(root: Ref, leaves: Ref[]) {
    if (leaves.length === 0) return this.link(root, port_(this.cell("ε"), 0));
    if (leaves.length === 1) return this.link(root, leaves[0]!);
    const g = this.cell("γ");
    this.link(port_(g, 0), root);
    this.link(port_(g, 1), leaves[0]!);
    this.M(port_(g, 2), leaves.slice(1));
  }

  /** M*_n: the γ comb that annihilates with M_n into straight wires. */
  Mstar(root: Ref, leaves: Ref[]) {
    if (leaves.length === 0) return this.link(root, port_(this.cell("ε"), 0));
    if (leaves.length === 1) return this.link(root, leaves[0]!);
    const g = this.cell("γ");
    this.link(port_(g, 0), root);
    this.link(port_(g, 2), leaves[0]!);
    this.Mstar(port_(g, 1), leaves.slice(1));
  }

  /** T_n: the autodual multiplexor, a δ comb (Fig. 5). Also the copier C_n. */
  T(root: Ref, leaves: Ref[]) {
    if (leaves.length === 0) return this.link(root, port_(this.cell("ε"), 0));
    if (leaves.length === 1) return this.link(root, leaves[0]!);
    const d = this.cell("δ");
    this.link(port_(d, 0), root);
    this.link(port_(d, 1), leaves[0]!);
    this.T(port_(d, 2), leaves.slice(1));
  }

  /** T_{p,q}: the first 2p ports in γ pairs, under a T_{p+q}. */
  Tpq(root: Ref, leaves: Ref[], p: number) {
    const inner: Ref[] = [];
    for (let k = 0; k < p; k++) {
      const g = this.cell("γ");
      this.link(port_(g, 1), leaves[2 * k]!);
      this.link(port_(g, 2), leaves[2 * k + 1]!);
      inner.push(port_(g, 0));
    }
    this.T(root, [...inner, ...leaves.slice(2 * p)]);
  }

  /** T_σ for an involution σ (0-based): T_σ ⋈ T_σ wires port a to port σ(a). */
  Tsigma(root: Ref, leaves: Ref[], sigma: number[]) {
    const pairs: number[] = [];
    const fixed: number[] = [];
    sigma.forEach((b, a) => {
      if (b === a) fixed.push(a);
      else if (a < b) pairs.push(a, b);
    });
    this.Tpq(root, [...pairs, ...fixed].map((i) => leaves[i]!), pairs.length / 2);
  }

  /** π₁ & … & π_n: a menu of packages, each built at the given root. */
  menu(root: Ref, packages: ((root: Ref) => void)[]) {
    const roots = packages.map(() => this.hole());
    this.M(root, roots);
    packages.forEach((p, i) => p(roots[i]!));
  }

  /** S^i_n: picks the i-th (0-based) package from a menu, erasing the rest. */
  selector(root: Ref, i: number, n: number, out: Ref) {
    const leaves: Ref[] = [];
    for (let k = 0; k < n; k++) leaves.push(k === i ? out : port_(this.cell("ε"), 0));
    this.Mstar(root, leaves);
  }

  /** The decoder D: !π at its root comes out as π (Fig. 8). */
  decoder(root: Ref, out: Ref) {
    const d = this.cell("δ");
    this.Mstar(root, [port_(d, 0), port_(d, 1), port_(d, 2), out]);
  }
}

const port_ = (c: number, s: number): Ref => ({ c, s });

/**
 * The code !π of a package (a netlist whose only free port is "root"): π
 * with its δ cells taken out and their ports gathered into multiplexors, so
 * that it contains no δ and can be copied by δ (Fig. 8).
 */
export function code(pi: Builder): Builder {
  const out = new Builder();
  const deltas: number[] = [];
  const newId = new Map<number, number>();
  pi.cells.forEach((c, i) => {
    if (c.type === "δ") deltas.push(i);
    else newId.set(i, out.cell(c.type));
  });
  const dIndex = new Map(deltas.map((d, k) => [d, k]));
  const P = deltas.map(() => out.hole());
  const A1 = deltas.map(() => out.hole());
  const A2 = deltas.map(() => out.hole());
  const d = out.hole();
  // Shift π's junctions past the ones made above.
  const holeBase = deltas.length * 3 + 1;
  for (let k = 0; k < pi.holes; k++) out.hole();
  const map = (r: Ref): Ref => {
    if ("c" in r) {
      const k = dIndex.get(r.c);
      if (k !== undefined) return [P, A1, A2][r.s]![k]!;
      return { c: newId.get(r.c)!, s: r.s };
    }
    if ("h" in r) return { h: r.h + holeBase };
    if (r.f === "root") return d;
    throw new Error(`package has unexpected free port ${r.f}`);
  };
  for (const [a, b] of pi.links) out.link(map(a), map(b));
  const a = out.hole();
  const b = out.hole();
  const c = out.hole();
  out.M({ f: "root" }, [a, b, c, d]);
  out.M(a, P);
  out.Mstar(b, A1);
  out.Mstar(c, A2);
  return out;
}

/** One side of a rule's right-hand side: the trees hanging off that agent's interface (§2.4). */
interface Half {
  net: Net;
  /** Interface ports x1..xn and the ports s1..sk wired across to the other half. */
  n: number;
  k: number;
}

export class TranslationError extends Error {}

/**
 * Split a reduced right-hand side into the trees rooted at each agent's
 * interface (Proposition 2). Wires running between the two halves become
 * the permutation σ. Ports s₁… are numbered in tree order, so for a rule
 * between two agents of the same type the halves come out identical and σ
 * is an involution; for different types σ is made the identity.
 */
export function split(sys: System, rule: Rule, place?: 0 | 1): { L: Half; R: Half; sigma: number[] } {
  const net = ruleToNet(sys, rule);
  if (net.activePairs().length) throw new TranslationError(`the rule for ${rule.left} ⋈ ${rule.right} has an active pair in its result`);
  const sideOf = new Map<AgentId, 0 | 1>();
  const leafOrder: [string[], string[]] = [[], []];
  const grow = (side: 0 | 1) => {
    const n = sys.type(side === 0 ? rule.left : rule.right).arity;
    const visit = (a: AgentId) => {
      sideOf.set(a, side);
      const ag = net.agent(a);
      for (let s = 1; s < ag.wires.length; s++) {
        const q = net.partner(port(a, s))!;
        if (q.kind === "port" && q.slot === 0 && !sideOf.has(q.agent)) visit(q.agent);
        else leafOrder[side].push(endKey(port(a, s)));
      }
    };
    for (let k = 1; k <= n; k++) {
      const x = free(`${side === 0 ? "L" : "R"}${k}`);
      const p = net.partner(x)!;
      if (p.kind === "port" && p.slot === 0 && !sideOf.has(p.agent)) visit(p.agent);
      else leafOrder[side].push(endKey(x));
    }
  };
  grow(0);
  grow(1);
  // A non-canonical split (§2.4) puts every cell on one side.
  if (place !== undefined) for (const a of net.agents.keys()) sideOf.set(a, place);
  if (sideOf.size !== net.agents.size)
    throw new TranslationError(`the rule for ${rule.left} ⋈ ${rule.right} has a vicious circle in its result`);

  const side = (e: End): 0 | 1 => (e.kind === "free" ? (e.name.startsWith("L") ? 0 : 1) : sideOf.get(e.agent)!);
  const cross: [End, End][] = [];
  const halves = [new Net(), new Net()] as const;
  const ids = new Map<AgentId, AgentId>();
  for (const a of net.agents.values()) {
    ids.set(a.id, halves[sideOf.get(a.id)!].addAgent(sys.type(a.type)));
  }
  const rename = (e: End): End => (e.kind === "free" ? free(`x${e.name.slice(1)}`) : port(ids.get(e.agent)!, e.slot));
  for (let s = 0 as 0 | 1; s <= 1; s++) {
    const n = sys.type(s === 0 ? rule.left : rule.right).arity;
    for (let k = 1; k <= n; k++) halves[s].free.set(`x${k}`, NONE);
  }
  for (const w of net.wires.values()) {
    const [a, b] = w.ends;
    if (side(a) === side(b)) halves[side(a)].connect(rename(a), rename(b));
    else cross.push(side(a) === 0 ? [a, b] : [b, a]);
  }
  // Number each half's crossing ports in tree order.
  const posL = (e: End) => (place === undefined ? leafOrder[0].indexOf(endKey(e)) : 0);
  const posR = (e: End) => leafOrder[1].indexOf(endKey(e));
  const sameType = rule.left === rule.right;
  const byL = [...cross].sort((x, y) => posL(x[0]) - posL(y[0]));
  const byR = sameType ? [...cross].sort((x, y) => posR(x[1]) - posR(y[1])) : byL;
  byL.forEach(([a], i) => {
    halves[0].free.set(`s${i + 1}`, NONE);
    halves[0].connect(rename(a), free(`s${i + 1}`));
  });
  byR.forEach(([, b], i) => {
    halves[1].free.set(`s${i + 1}`, NONE);
    halves[1].connect(rename(b), free(`s${i + 1}`));
  });
  const sigma = byL.map((c) => byR.indexOf(c));
  if (sameType) {
    if (sigma.some((b, a) => sigma[b] !== a) || canonical(halves[0]) !== canonical(halves[1]))
      throw new TranslationError(`the rule for ${rule.left} ⋈ ${rule.left} isn't symmetric`);
  }
  const L = { net: halves[0], n: sys.type(rule.left).arity, k: cross.length };
  const R = { net: halves[1], n: sys.type(rule.right).arity, k: cross.length };
  return { L, R, sigma };
}

export type Mode = "general" | "restricted";

export interface Translation {
  mode: Mode;
  /** The source already is the target calculus, so no encoding is needed. */
  identity: boolean;
  /** The source system's agent types, in the order used for menus and selectors. */
  types: string[];
  /**
   * Build the translation of a net. Cells are tagged with the source agent
   * they came from, and `ports` gives, for each source agent, the translated
   * port standing for each of its ports.
   */
  net(source: Net): { net: Net; tagOf: Map<AgentId, AgentId>; ports: Map<AgentId, End[]> };
  /** Notes on pairs with no rule, which the translation handles arbitrarily. */
  missing: [string, string][];
}

/** Compare rules as nets, so agent numbering and wire order do not matter. */
function isCombinatorSystem(sys: System): boolean {
  const target = combinators();
  if (sys.types.size !== target.types.size || sys.rules.size !== target.rules.size) return false;
  for (const [id, type] of target.types) if (sys.types.get(id)?.arity !== type.arity) return false;
  for (const expected of target.rules.values()) {
    const found = sys.ruleFor(expected.left, expected.right);
    if (!found) return false;
    const actual = ruleToNet(sys, found.rule);
    if (found.swapped) {
      const j = actual.toJSON();
      const swap = (name: string) => `${name[0] === "L" ? "R" : "L"}${name.slice(1)}`;
      const swapped = Net.fromJSON({
        agents: j.agents,
        free: j.free.map(swap),
        wires: j.wires.map((w) => ({
          id: w.id,
          ends: w.ends.map((e) => (e.kind === "free" ? free(swap(e.name)) : e)) as [End, End],
        })),
      });
      if (canonical(swapped) !== canonical(ruleToNet(target, expected))) return false;
    } else if (canonical(actual) !== canonical(ruleToNet(target, expected))) return false;
  }
  return true;
}

/**
 * Prepare a translation of a whole system. An exact combinator system uses
 * the identity map. Otherwise, throws a TranslationError if a rule's result
 * isn't reduced, a self-rule isn't symmetric, or (in the restricted case)
 * the system is recursive.
 */
export function translation(sys: System, mode: Mode = "general"): Translation {
  const types = [...sys.types.keys()];
  if (isCombinatorSystem(sys)) {
    return {
      mode,
      identity: true,
      types,
      missing: [],
      net(source: Net) {
        for (const a of source.agents.values()) {
          if (!sys.types.has(a.type)) throw new TranslationError(`unknown agent type ${a.type}`);
          if (a.wires.some((w) => w === NONE)) throw new TranslationError("every port needs a wire before translating");
        }
        return {
          net: source.clone(),
          tagOf: new Map([...source.agents.keys()].map((id) => [id, id])),
          ports: new Map([...source.agents.values()].map((a) => [a.id, a.wires.map((_, slot) => port(a.id, slot))])),
        };
      },
    };
  }
  const m = types.length;
  const idx = new Map(types.map((t, i) => [t, i]));
  const arity = types.map((t) => sys.type(t).arity);
  const missing: [string, string][] = [];

  // φ[i][j]: the half of the i ⋈ j rule hanging off α_i, and its σ.
  type Phi = ({ half: Half; sigma: number[] } | undefined)[][];
  const pairs: { i: number; j: number; rule: Rule; swapped: boolean }[] = [];
  types.forEach((a, i) =>
    types.forEach((b, j) => {
      if (j < i) return;
      const found = sys.ruleFor(a, b);
      if (!found) missing.push([a, b]);
      else pairs.push({ i, j, ...found });
    }),
  );
  /** Build φ, putting each rule's cells on α_i's side, α_j's side, or splitting canonically. */
  const buildPhi = (choice: (p: (typeof pairs)[number]) => "split" | "i" | "j"): Phi => {
    const phi: Phi = types.map(() => types.map(() => undefined));
    for (const p of pairs) {
      const c = choice(p);
      // Rule sides are (left, right); α_i is the right side when swapped.
      const iSide = p.swapped ? 1 : 0;
      const place = c === "split" ? undefined : c === "i" ? iSide : ((1 - iSide) as 0 | 1);
      const { L, R, sigma } = split(sys, p.rule, place);
      const [hi, hj] = p.swapped ? [R, L] : [L, R];
      phi[p.i]![p.j] = { half: hi, sigma };
      phi[p.j]![p.i] = { half: p.i === p.j ? hi : hj, sigma };
    }
    return phi;
  };
  /** [α_i] contains the cells of every φ_{l,i}: the types it depends on. A cycle means recursion. */
  const cycle = (phi: Phi): number | undefined => {
    const deps = types.map((_, i) => {
      const d = new Set<number>();
      for (let l = 0; l < m; l++) for (const a of phi[l]![i]?.half.net.agents.values() ?? []) d.add(idx.get(a.type)!);
      return d;
    });
    const state = types.map(() => 0);
    let bad: number | undefined;
    const visit = (i: number) => {
      if (state[i] === 2 || bad !== undefined) return;
      if (state[i] === 1) return void (bad = i);
      state[i] = 1;
      deps[i]!.forEach(visit);
      state[i] = 2;
    };
    types.forEach((_, i) => visit(i));
    return bad;
  };

  let phi = buildPhi(() => "split");
  if (mode === "restricted" && cycle(phi) !== undefined) {
    // Look for a way of placing each rule's cells that bottoms out (§2.4
    // does this by hand for γε and δε).
    const free = pairs.filter((p) => p.i !== p.j && p.rule.agents.length > 0);
    let found: Phi | undefined;
    let bad = cycle(phi)!;
    for (let bits = 0; bits < 1 << Math.min(free.length, 14) && !found; bits++) {
      const choose = (p: (typeof pairs)[number]) => {
        const k = free.indexOf(p);
        return k < 0 ? "split" : bits & (1 << k) ? "j" : "i";
      };
      const candidate = buildPhi(choose);
      const c = cycle(candidate);
      if (c === undefined) found = candidate;
      else bad = c;
    }
    if (!found) throw new TranslationError(`${types[bad]} can lead to creating itself, so the restricted translation doesn't apply`);
    phi = found;
  }

  /** Lay out a half's cells, calling `cell` for each to get the refs of its ports. */
  const half = (
    b: Builder,
    h: Half,
    iface: Ref[],
    sigmaPorts: Ref[],
    cell: (type: number, ports: Ref[]) => void,
  ) => {
    const holes = new Map<number, Ref>();
    const wireHole = (w: number) => {
      let r = holes.get(w);
      if (!r) holes.set(w, (r = b.hole()));
      return r;
    };
    for (const a of h.net.agents.values()) cell(idx.get(a.type)!, a.wires.map(wireHole));
    for (const [name, w] of h.net.free) {
      const r = name.startsWith("x") ? iface[Number(name.slice(1)) - 1]! : sigmaPorts[Number(name.slice(1)) - 1]!;
      b.link(r, wireHole(w));
    }
  };

  // Restricted case (Fig. 6): [α_i] built inline, no code.
  const restrictedCell = (b: Builder, i: number, principal: Ref, aux: Ref[]) => {
    const A = b.hole();
    const B = b.hole();
    const L = b.hole();
    const Mroot = b.hole();
    b.Tpq(principal, [A, B, L], 1);
    b.selector(B, i, m, Mroot);
    b.M(Mroot, [...aux, L]);
    b.menu(
      A,
      types.map((_, l) => (root: Ref) => gammaRestricted(b, l, i, root)),
    );
  };
  // Γ_{l,i}: what α_i offers a partner α_l, built against α_l's multiplexor.
  const gammaRestricted = (b: Builder, l: number, i: number, root: Ref) => {
    const p = phi[l]![i];
    if (!p) return b.link(root, port_(b.cell("ε"), 0));
    const xs = Array.from({ length: arity[l]! }, () => b.hole());
    const t = b.hole();
    const ss = Array.from({ length: p.half.k }, () => b.hole());
    b.Mstar(root, [...xs, t]);
    b.Tsigma(t, ss, p.sigma);
    half(b, p.half, xs, ss, (k, ports) => restrictedCell(b, k, ports[0]!, ports.slice(1)));
  };

  // General case (Fig. 10). ⟨α_k⟩ takes a code port and rebuilds [α_k] from it.
  const codedCell = (b: Builder, k: number, codePort: Ref, principal: Ref, aux: Ref[]) => {
    const A = b.hole();
    const B = b.hole();
    const L = b.hole();
    const Mroot = b.hole();
    const toM = b.hole();
    const toD = b.hole();
    const dOut = b.hole();
    b.T(codePort, [toD, toM]); // C₂
    b.decoder(toD, dOut);
    b.selector(dOut, k, m, A);
    b.Tpq(principal, [A, B, L], 1);
    b.selector(B, k, m, Mroot);
    b.M(Mroot, [toM, ...aux, L]);
  };
  const gammaGeneral = (b: Builder, l: number, i: number, root: Ref) => {
    const p = phi[l]![i];
    if (!p) return b.link(root, port_(b.cell("ε"), 0));
    const codeIn = b.hole();
    const xs = Array.from({ length: arity[l]! }, () => b.hole());
    const t = b.hole();
    const ss = Array.from({ length: p.half.k }, () => b.hole());
    b.Mstar(root, [codeIn, ...xs, t]);
    b.Tsigma(t, ss, p.sigma);
    const codePorts: Ref[] = [];
    half(b, p.half, xs, ss, (k, ports) => {
      const c = b.hole();
      codePorts.push(c);
      codedCell(b, k, c, ports[0]!, ports.slice(1));
    });
    b.T(codeIn, codePorts); // C_p
  };

  let codeTemplate: Builder | undefined;
  const genome = () => {
    if (!codeTemplate) {
      // Γ = Γ₁ & … & Γ_m, where Γ_i = Γ_{1,i} & … & Γ_{m,i}.
      const g = new Builder();
      g.menu(
        { f: "root" },
        types.map((_, i) => (r: Ref) => g.menu(r, types.map((_, l) => (rr: Ref) => gammaGeneral(g, l, i, rr)))),
      );
      codeTemplate = code(g);
    }
    return codeTemplate;
  };
  const generalCell = (b: Builder, i: number, principal: Ref, aux: Ref[]) => {
    const A = b.hole();
    const B = b.hole();
    const L = b.hole();
    const Mroot = b.hole();
    const codeRoot = b.hole();
    b.Tpq(principal, [A, B, L], 1);
    b.selector(B, i, m, Mroot);
    b.M(Mroot, [codeRoot, ...aux, L]);
    b.embed(genome(), { root: codeRoot });
    b.menu(
      A,
      types.map((_, l) => (root: Ref) => gammaGeneral(b, l, i, root)),
    );
  };

  return {
    mode,
    identity: false,
    types,
    missing,
    net(source: Net) {
      const b = new Builder();
      const wireHole = new Map<number, Ref>();
      const holeOf = (w: number) => {
        let r = wireHole.get(w);
        if (!r) wireHole.set(w, (r = b.hole()));
        return r;
      };
      for (const a of source.agents.values()) {
        const i = idx.get(a.type);
        if (i === undefined) throw new TranslationError(`unknown agent type ${a.type}`);
        if (a.wires.some((w) => w === NONE)) throw new TranslationError("every port needs a wire before translating");
        b.tag = a.id;
        const ports = a.wires.map(holeOf);
        (mode === "general" ? generalCell : restrictedCell)(b, i, ports[0]!, ports.slice(1));
      }
      b.tag = undefined;
      for (const [name, w] of source.free) if (w !== NONE) b.link({ f: name }, holeOf(w));
      const { net, ids } = b.toNet();
      const tagOf = new Map<AgentId, AgentId>();
      b.cells.forEach((c, i) => c.tag !== undefined && tagOf.set(ids[i]!, c.tag));
      // Find the cell port inside each source agent's translation that each source wire reaches.
      const ports = new Map<AgentId, End[]>();
      const inner = b.innerEnds(wireHole);
      for (const a of source.agents.values()) {
        ports.set(
          a.id,
          a.wires.map((w, slot) => {
            const options = inner.get(w)!.filter((r) => b.cells[r.c]!.tag === a.id);
            // A wire joining two ports of the same agent reaches it twice.
            const r = options.length > 1 && a.wires.indexOf(w) !== slot ? options[1]! : options[0]!;
            return port(ids[r.c]!, r.s);
          }),
        );
      }
      return { net, tagOf, ports };
    },
  };
}
