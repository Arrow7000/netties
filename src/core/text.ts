import { type AgentId, type End, Net, NONE, endKey, free, port } from "./net";
import { ifaceName, netToRule } from "./ruleNet";
import { type Rule, System } from "./system";
import { type Level, type PortSpec, typingOn } from "./types";

/**
 * A text format in the style of Inpla:
 *
 *     agent γ 2 filled "constructor"     -- optional declarations
 *     directions required                -- optional: ports give (+) or take (-)
 *     types optional number list         -- optional: the types ports can carry
 *     agent S 1 ports +number "the number", -number "the one before"
 *     γ(a, b) >< δ(c, d) => a ~ δ(e, f), b ~ δ(g, h), c ~ γ(e, g), d ~ γ(f, h);
 *     γ(x, y) ~ δ(z, w);                 -- a net
 *
 * A term `A(t₁, …, tₙ)` is an agent whose aux ports are plugged into the
 * terms tᵢ (aux ports numbered clockwise from the principal port, as
 * everywhere else). `s ~ t` joins two principal ports. Names that aren't
 * agents are wires: in a rule each appears once on each side (or twice on
 * the right), in a net a name used once is a free port.
 *
 * Agents are names that are declared, written with parentheses, or start
 * with an upper-case letter (Inpla's convention).
 * In a net, `_` leaves a port empty; it is not a named loose end.
 *
 * A port is written `+type` (gives), `-type` (takes) or `type` (either way);
 * `+` or `-` alone has a direction but any type, and `_` neither. A quoted
 * label can follow.
 */

type Term = { kind: "agent"; name: string; args: Term[]; line: number } | { kind: "var"; name: string; line: number };
type Eq = [Term, Term];

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
  }
}

type Tok = { t: string; line: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (src.startsWith("--", i) || src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("><", i) || src.startsWith("=>", i)) {
      out.push({ t: src.slice(i, i + 2), line });
      i += 2;
    } else if ("(),;~".includes(c)) {
      out.push({ t: c, line });
      i++;
    } else if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new ParseError("unterminated string", line);
      out.push({ t: src.slice(i, j + 1), line });
      i = j + 1;
    } else {
      let j = i;
      while (j < src.length && !/[\s(),;~"]/.test(src[j]!) && !src.startsWith("><", j) && !src.startsWith("=>", j)) j++;
      out.push({ t: src.slice(i, j), line });
      i = j;
    }
  }
  return out;
}

const LEVELS = ["off", "optional", "required"];

function parsePort(tok: string, line: number): PortSpec {
  if (tok === "_") return {};
  const m = /^([+-]?)(.*)$/.exec(tok)!;
  const spec: PortSpec = {};
  if (m[1]) spec.pol = m[1] === "+" ? "give" : "take";
  if (m[2]) {
    if (/[^\p{L}\p{N}_'-]/u.test(m[2])) throw new ParseError(`"${tok}" isn't a port: write +type, -type, type, + or -`, line);
    spec.type = m[2];
  }
  return spec;
}

function printPort(p: PortSpec): string {
  const head = (p.pol === "give" ? "+" : p.pol === "take" ? "-" : "") + (p.type ?? "") || "_";
  return p.label ? `${head} "${p.label}"` : head;
}

interface Parsed {
  decls: { symbol: string; arity: number; filled: boolean; name?: string; ports?: PortSpec[]; line: number }[];
  dirs?: Level;
  types?: { level: Level; names: string[] };
  rules: { lhs: [Term, Term]; rhs: Eq[]; line: number }[];
  net: Eq[];
}

function parseStatements(src: string): Parsed {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const line = () => toks[Math.min(p, toks.length - 1)]?.line ?? 1;
  const next = () => {
    const t = toks[p++];
    if (!t) throw new ParseError("unexpected end of input", line());
    return t;
  };
  const expect = (s: string) => {
    const t = next();
    if (t.t !== s) throw new ParseError(`expected "${s}" but found "${t.t}"`, t.line);
  };
  const term = (): Term => {
    const t = next();
    if ("(),;~".includes(t.t) || t.t === "><" || t.t === "=>") throw new ParseError(`expected a name but found "${t.t}"`, t.line);
    if (peek()?.t === "(") {
      next();
      const args: Term[] = [];
      if (peek()?.t !== ")") {
        args.push(term());
        while (peek()?.t === ",") {
          next();
          args.push(term());
        }
      }
      expect(")");
      return { kind: "agent", name: t.t, args, line: t.line };
    }
    return { kind: "var", name: t.t, line: t.line };
  };
  const eqs = (): Eq[] => {
    const out: Eq[] = [];
    for (;;) {
      const a = term();
      expect("~");
      out.push([a, term()]);
      if (peek()?.t !== ",") break;
      next();
    }
    return out;
  };

  const parsed: Parsed = { decls: [], rules: [], net: [] };
  while (p < toks.length) {
    const t = peek()!;
    if (t.t === ";") {
      next();
      continue;
    }
    if ((t.t === "directions" || t.t === "types") && LEVELS.includes(toks[p + 1]?.t ?? "") && toks[p + 1]!.line === t.line) {
      next();
      const level = next().t as Level;
      const names: string[] = [];
      while (peek() && peek()!.line === t.line && peek()!.t !== ";") names.push(next().t);
      if (t.t === "directions") {
        if (names.length) throw new ParseError(`unexpected "${names[0]}" after directions ${level}`, t.line);
        parsed.dirs = level;
      } else parsed.types = { level, names };
      continue;
    }
    if (t.t === "agent") {
      next();
      const sym = next();
      const ar = next();
      const arity = Number(ar.t);
      if (!Number.isInteger(arity) || arity < 0) throw new ParseError(`"${ar.t}" isn't a number of ports`, ar.line);
      let filled = false;
      let name: string | undefined;
      let ports: PortSpec[] | undefined;
      while (peek() && peek()!.line === t.line && peek()!.t !== ";") {
        const x = next();
        if (x.t === "filled") filled = true;
        else if (x.t.startsWith('"')) name = x.t.slice(1, -1);
        else if (x.t === "ports") {
          ports = [];
          for (;;) {
            const pt = next();
            const spec = parsePort(pt.t, pt.line);
            if (peek()?.t.startsWith('"') && peek()!.line === t.line) spec.label = next().t.slice(1, -1);
            ports.push(spec);
            if (peek()?.t !== "," || peek()!.line !== t.line) break;
            next();
          }
          if (ports.length !== arity + 1)
            throw new ParseError(`${sym.t} has ${arity + 1} ports but ${ports.length} are described`, t.line);
        } else throw new ParseError(`unexpected "${x.t}" in agent declaration`, x.line);
      }
      parsed.decls.push({ symbol: sym.t, arity, filled, name, ports, line: t.line });
      continue;
    }
    const start = p;
    const a = term();
    if (peek()?.t === "><") {
      next();
      const b = term();
      expect("=>");
      const rhs = peek()?.t === ";" ? [] : eqs();
      expect(";");
      parsed.rules.push({ lhs: [a, b], rhs, line: t.line });
      continue;
    }
    p = start;
    parsed.net.push(...eqs());
    expect(";");
  }
  return parsed;
}

/** Parse a whole document: declarations, rules and a net. */
export function parse(src: string): { system: System; net: Net } {
  const parsed = parseStatements(src);
  const sys = new System();
  const arity = new Map<string, number>();
  const meta = new Map<string, { filled: boolean; name?: string; ports?: PortSpec[] }>();
  for (const d of parsed.decls) {
    arity.set(d.symbol, d.arity);
    meta.set(d.symbol, { filled: d.filled, name: d.name, ports: d.ports });
  }
  // Ports with directions or types switch those on, as optional, unless the text says otherwise.
  const specs = parsed.decls.flatMap((d) => d.ports ?? []);
  const names = [...(parsed.types?.names ?? [])];
  for (const p of specs) if (p.type && !names.includes(p.type)) names.push(p.type);
  sys.typing = {
    dirs: parsed.dirs ?? (specs.some((p) => p.pol) ? "optional" : "off"),
    types: parsed.types?.level ?? (names.length ? "optional" : "off"),
    names,
  };
  // Names written with parentheses are agents too; so are capitalised names.
  const visitTerm = (t: Term) => {
    if (t.kind === "agent") {
      const known = arity.get(t.name);
      if (known !== undefined && known !== t.args.length)
        throw new ParseError(`${t.name} has ${known} aux ports but is used with ${t.args.length}`, t.line);
      arity.set(t.name, t.args.length);
      t.args.forEach(visitTerm);
    }
  };
  for (const r of parsed.rules) [...r.lhs, ...r.rhs.flat()].forEach(visitTerm);
  parsed.net.flat().forEach(visitTerm);
  const isAgent = (t: Term) => t.kind === "agent" || arity.has(t.name) || /^\p{Lu}/u.test(t.name);
  for (const t of [...parsed.rules.flatMap((r) => [...r.lhs, ...r.rhs.flat()]), ...parsed.net.flat()]) {
    for (const v of allTerms(t)) if (v.kind === "var" && isAgent(v) && !arity.has(v.name)) arity.set(v.name, 0);
  }
  for (const [symbol, n] of arity) {
    const m = meta.get(symbol);
    sys.addType({ id: symbol, symbol, name: m?.name ?? symbol, arity: n, filled: m?.filled, ...(m?.ports && { ports: m.ports }) });
  }

  /** Build equations into a net. `bound` names ends that already exist (a rule's interface). */
  const build = (net: Net, equations: Eq[], bound: Map<string, End>, mode: "rule" | "net", line: number) => {
    const pending = new Map<string, End>();
    /** Names joined by `x ~ y` before either was attached to anything. */
    const alias = new Map<string, string>();
    const make = (t: Term): AgentId => {
      const args = t.kind === "agent" ? t.args : [];
      const id = net.addAgent(sys.type(t.name));
      args.forEach((a, i) => plug(a, port(id, i + 1)));
      return id;
    };
    const take = (v: string): End | undefined => {
      const e = bound.get(v) ?? pending.get(v);
      bound.delete(v);
      pending.delete(v);
      return e;
    };
    const plug = (t: Term, at: End) => {
      if (isAgent(t)) return void net.connect(port(make(t), 0), at);
      // In an ordinary net, `_` means an empty port rather than a named loose end.
      if (mode === "net" && t.name === "_") return;
      const other = alias.get(t.name);
      if (other !== undefined) {
        alias.delete(t.name);
        alias.delete(other);
        return plug({ kind: "var", name: other, line: t.line }, at);
      }
      const e = take(t.name);
      if (e) net.connect(e, at);
      else pending.set(t.name, at);
    };
    for (const [a, b] of equations) {
      if (isAgent(a)) plug(b, port(make(a), 0));
      else if (isAgent(b)) plug(a, port(make(b), 0));
      else {
        const ea = take(a.name);
        const eb = take(b.name);
        if (ea && eb) net.connect(ea, eb);
        else if (ea) plug(b, ea);
        else if (eb) plug(a, eb);
        else {
          alias.set(a.name, b.name);
          alias.set(b.name, a.name);
        }
      }
    }
    if (alias.size) throw new ParseError(`${[...alias.keys()].join(", ")} are only joined to each other`, line);
    if (mode === "rule") {
      if (pending.size) throw new ParseError(`${[...pending.keys()].join(", ")} only appear once`, line);
      if (bound.size) throw new ParseError(`${[...bound.keys()].join(", ")} never appear on the right`, line);
    } else {
      for (const [name, e] of pending) {
        net.free.set(name, NONE);
        net.connect(e, free(name));
      }
    }
  };

  for (const r of parsed.rules) {
    const [a, b] = r.lhs;
    if (!isAgent(a) || !isAgent(b)) throw new ParseError("both sides of >< must be agents", r.line);
    const net = new Net();
    const bound = new Map<string, End>();
    const sides = [a, b] as const;
    sides.forEach((s, side) => {
      const args = s.kind === "agent" ? s.args : [];
      args.forEach((arg, i) => {
        if (arg.kind !== "var" || isAgent(arg)) throw new ParseError("the arguments of a rule's left-hand side must be names", r.line);
        if (bound.has(arg.name)) throw new ParseError(`${arg.name} appears twice on the left`, r.line);
        const n = ifaceName(side as 0 | 1, i + 1);
        net.free.set(n, NONE);
        bound.set(arg.name, free(n));
      });
    });
    build(net, r.rhs, bound, "rule", r.line);
    const rule = netToRule(sides[0].name, sides[1].name, net).rule;
    const problems = sys.validate(rule);
    if (problems.length) throw new ParseError(problems.join("; "), r.line);
    if (sys.ruleFor(rule.left, rule.right)) throw new ParseError(`a second rule for ${rule.left} >< ${rule.right}`, r.line);
    sys.addRule(rule);
  }
  const net = new Net();
  build(net, parsed.net, new Map(), "net", 1);
  return { system: sys, net };
}

function allTerms(t: Term): Term[] {
  return t.kind === "agent" ? [t, ...t.args.flatMap(allTerms)] : [t];
}

/** Write a net as equations, nesting trees as terms. Free ports keep their names. */
function equations(net: Net, sys: System, names: (e: End) => string | undefined): string[] {
  // Each agent hangs off whatever its principal port is plugged into, unless that makes a loop.
  const parent = new Map<AgentId, End>();
  for (const a of net.agents.values()) {
    const p = net.partner(port(a.id, 0));
    if (p?.kind === "port" && p.slot > 0) parent.set(a.id, p);
  }
  const state = new Map<AgentId, number>();
  for (const start of net.agents.keys()) {
    const path: AgentId[] = [];
    let a: AgentId | undefined = start;
    while (a !== undefined && !state.has(a)) {
      state.set(a, 1);
      path.push(a);
      const p = parent.get(a);
      a = p?.kind === "port" ? p.agent : undefined;
    }
    if (a !== undefined && state.get(a) === 1) parent.delete(Math.min(...path.slice(path.indexOf(a))));
    path.forEach((x) => state.set(x, 2));
  }
  const nested = new Set<string>();
  for (const [, p] of parent) nested.add(endKey(p));
  const wireName = new Map<number, string>();
  let fresh = 0;
  const nameOf = (e: End) => {
    const given = names(e);
    if (given) return given;
    const w = net.wireAt(e);
    if (w === NONE) return "_";
    const p = net.partner(e)!;
    const there = names(p);
    if (there) return there;
    let n = wireName.get(w);
    if (!n) wireName.set(w, (n = `w${++fresh}`));
    return n;
  };
  const term = (a: AgentId): string => {
    const ag = net.agent(a);
    const sym = sys.types.get(ag.type)?.symbol ?? ag.type;
    if (ag.wires.length === 1) return sym;
    const args = ag.wires.slice(1).map((_, i) => {
      const here = port(a, i + 1);
      const p = net.partner(here);
      if (p?.kind === "port" && p.slot === 0 && parent.has(p.agent) && endKey(parent.get(p.agent)!) === endKey(here)) return term(p.agent);
      return nameOf(here);
    });
    return `${sym}(${args.join(", ")})`;
  };
  const out: string[] = [];
  const done = new Set<number>();
  for (const a of net.agents.values()) {
    if (parent.has(a.id)) continue;
    const w = net.wireAt(port(a.id, 0));
    if (w !== NONE && done.has(w)) continue;
    if (w !== NONE) done.add(w);
    const p = w === NONE ? undefined : net.partner(port(a.id, 0));
    const other = p?.kind === "port" && p.slot === 0 && !parent.has(p.agent) ? term(p.agent) : nameOf(port(a.id, 0));
    out.push(`${other} ~ ${term(a.id)}`);
  }
  // Wires joining two free ends directly.
  for (const w of net.wires.values()) {
    const [a, b] = w.ends;
    if (a.kind === "free" && b.kind === "free") out.push(`${names(a)} ~ ${names(b)}`);
  }
  return out;
}

/** Write a system and a net as text. */
export function print(sys: System, net: Net, title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`-- ${title}`, "");
  const typing = sys.typing;
  if (typing.dirs !== "off") lines.push(`directions ${typing.dirs}`);
  if (typing.types !== "off") lines.push(`types ${typing.types}${typing.names.map((n) => " " + n).join("")}`);
  if (typingOn(typing)) lines.push("");
  for (const t of sys.types.values()) {
    const described = t.ports?.some((p) => p.pol || p.type || p.label);
    const ports = described ? ` ports ${t.ports!.map(printPort).join(", ")}` : "";
    lines.push(`agent ${t.symbol} ${t.arity}${t.filled ? " filled" : ""}${t.name !== t.symbol ? ` "${t.name}"` : ""}${ports}`);
  }
  lines.push("");
  const sym = (id: string) => sys.types.get(id)?.symbol ?? id;
  for (const r of sys.rules.values()) lines.push(printRule(sys, r, sym));
  lines.push("");
  const eqs = equations(net, sys, (e) => (e.kind === "free" ? e.name : undefined));
  if (eqs.length) lines.push(eqs.join(",\n") + ";");
  return lines.join("\n") + "\n";
}

function printRule(sys: System, r: Rule, sym: (id: string) => string): string {
  const n = sys.type(r.left).arity;
  const m = sys.type(r.right).arity;
  const xs = Array.from({ length: n }, (_, i) => `x${i + 1}`);
  const ys = Array.from({ length: m }, (_, i) => `y${i + 1}`);
  const side = (s: string, vs: string[]) => (vs.length ? `${sym(s)}(${vs.join(", ")})` : sym(s));
  const net = new Net();
  const ids = r.agents.map((t) => net.addAgent(sys.type(t)));
  for (let i = 1; i <= n; i++) net.free.set(`x${i}`, NONE);
  for (let i = 1; i <= m; i++) net.free.set(`y${i}`, NONE);
  const end = (e: Rule["wires"][number][number]): End =>
    e.kind === "agent" ? port(ids[e.index]!, e.slot) : free(`${e.side === 0 ? "x" : "y"}${e.slot}`);
  for (const [a, b] of r.wires) net.connect(end(a), end(b));
  const eqs = equations(net, sys, (e) => (e.kind === "free" ? e.name : undefined));
  return `${side(r.left, xs)} >< ${side(r.right, ys)} =>${eqs.length ? " " + eqs.join(", ") : ""};`;
}
