import type { AgentType, End, Net, WireId } from "./net";
import type { Rule, RuleEnd, System } from "./system";

/**
 * Directions and types on ports.
 *
 * A port can have a direction (it gives or it takes) and, separately, a
 * type (number, list). The two are independent: a port may take a number,
 * take anything, or carry a number either way. A wire may not join two ports
 * that both give or both take, nor two ports whose types differ. A port
 * without a direction or a type fits anything in that respect, like
 * TypeScript's `any`.
 *
 * Each system says how strict it is about each, separately: off (the
 * dimension doesn't exist), optional, or required (every port must have one).
 */

export type Level = "off" | "optional" | "required";
export type Polarity = "give" | "take";

export interface PortSpec {
  pol?: Polarity;
  type?: string;
  /** What the port is for, in a few words: "the sum". */
  label?: string;
}

export interface Typing {
  dirs: Level;
  types: Level;
  /** The types ports can have, in the order they were added. */
  names: string[];
}

export const untyped = (): Typing => ({ dirs: "off", types: "off", names: [] });

/** A port's direction and type as they count, given the system's settings. */
export interface Effective {
  pol?: Polarity;
  type?: string;
}

export const opposite = (p: Polarity): Polarity => (p === "give" ? "take" : "give");

/** The same constraint, seen from the other side of a wire. */
export const flip = (s: Effective): Effective => ({ pol: s.pol && opposite(s.pol), type: s.type });

export function effective(typing: Typing, spec: PortSpec | undefined): Effective {
  const out: Effective = {};
  if (spec?.pol && typing.dirs !== "off") out.pol = spec.pol;
  if (spec?.type && typing.types !== "off") out.type = spec.type;
  return out;
}

export const portSpec = (t: AgentType | undefined, slot: number): PortSpec | undefined => t?.ports?.[slot];

/** The direction and type of an agent type's port. */
export function specOf(sys: System, type: string, slot: number): Effective {
  return effective(sys.typing, portSpec(sys.types.get(type), slot));
}

export const typingOn = (t: Typing) => t.dirs !== "off" || t.types !== "off";

/** Why two ends can't share a wire, if they can't. */
export type Clash = { kind: "pol"; pol: Polarity; type?: string } | { kind: "type"; a: Effective; b: Effective };

export function clash(a: Effective, b: Effective): Clash | undefined {
  if (a.pol && b.pol && a.pol === b.pol) return { kind: "pol", pol: a.pol, type: a.type && a.type === b.type ? a.type : undefined };
  if (a.type && b.type && a.type !== b.type) return { kind: "type", a, b };
  return undefined;
}

/** "gives a number", "takes", "carries a list", "fits anything" */
export function phrase(s: Effective): string {
  const art = (w: string) => (/^[aeiou]/i.test(w) ? "an " : "a ") + w;
  if (s.pol && s.type) return `${s.pol === "give" ? "gives" : "takes"} ${art(s.type)}`;
  if (s.pol) return s.pol === "give" ? "gives" : "takes";
  if (s.type) return `carries ${art(s.type)}`;
  return "fits anything";
}

/** Why a clash is one, in a short sentence. */
export function clashText(c: Clash): string {
  if (c.kind === "pol") {
    const what = c.type ? ` ${/^[aeiou]/i.test(c.type) ? "an" : "a"} ${c.type}` : "";
    return `Both ${c.pol}${what}. A wire runs from a port that gives to one that takes.`;
  }
  return `One ${phrase({ type: c.a.type })}, the other ${phrase({ type: c.b.type })}.`;
}

export const clashShort = (c: Clash) => (c.kind === "pol" ? (c.pol === "give" ? "Both give" : "Both take") : "Wrong type");

/**
 * What an end of a net carries. A loose end in an ordinary net fits
 * anything (it takes on whatever it's attached to); `freeSpec` can give
 * free ports a fixed meaning, as a rule's interface does.
 */
export function endSpec(net: Net, sys: System, e: End, freeSpec?: (name: string) => Effective | undefined): Effective {
  if (e.kind === "free") return freeSpec?.(e.name) ?? {};
  return specOf(sys, net.agent(e.agent).type, e.slot);
}

/** Wires whose two ends don't fit together. */
export function badWires(net: Net, sys: System, freeSpec?: (name: string) => Effective | undefined): Map<WireId, Clash> {
  const out = new Map<WireId, Clash>();
  if (!typingOn(sys.typing)) return out;
  for (const w of net.wires.values()) {
    const c = clash(endSpec(net, sys, w.ends[0], freeSpec), endSpec(net, sys, w.ends[1], freeSpec));
    if (c) out.set(w.id, c);
  }
  return out;
}

/** Whether agents of two types could ever face each other: their principal ports must fit. */
export function canMeet(sys: System, a: string, b: string): Clash | undefined {
  return clash(specOf(sys, a, 0), specOf(sys, b, 0));
}

/**
 * Where a rule breaks the types. An interface end stands for whatever was
 * plugged into the pair's aux port, so it carries the far side of that port.
 */
export function ruleClashes(sys: System, r: Rule): { wire: [RuleEnd, RuleEnd]; clash: Clash }[] {
  if (!typingOn(sys.typing)) return [];
  const spec = (e: RuleEnd): Effective =>
    e.kind === "agent"
      ? specOf(sys, r.agents[e.index]!, e.slot)
      : flip(specOf(sys, e.side === 0 ? r.left : r.right, e.slot));
  const out: { wire: [RuleEnd, RuleEnd]; clash: Clash }[] = [];
  for (const w of r.wires) {
    const c = clash(spec(w[0]), spec(w[1]));
    if (c) out.push({ wire: w, clash: c });
  }
  return out;
}

/** Ports that still need a direction or a type, for the settings that require one. */
export function missing(sys: System, typing = sys.typing): { type: string; slot: number; what: "dir" | "type" }[] {
  const out: { type: string; slot: number; what: "dir" | "type" }[] = [];
  for (const t of sys.types.values()) {
    if (t.box) continue;
    for (let s = 0; s <= t.arity; s++) {
      const p = portSpec(t, s);
      if (typing.dirs === "required" && !p?.pol) out.push({ type: t.id, slot: s, what: "dir" });
      if (typing.types === "required" && !p?.type) out.push({ type: t.id, slot: s, what: "type" });
    }
  }
  return out;
}

/** An agent type's port list, padded or cut to its arity. */
export function portsFor(t: AgentType, arity = t.arity): PortSpec[] {
  return Array.from({ length: arity + 1 }, (_, s) => ({ ...(t.ports?.[s] ?? {}) }));
}

/** Port labels fall back to their position. */
export const portName = (slot: number) => (slot === 0 ? "principal port" : `aux port ${slot}`);

/*
 * Editing a system's directions and types. Each changes the system it's
 * given in place, so the same edit works on the live system and on a draft
 * (the directions and types sheet edits a copy until it's saved).
 */

/** Replace an agent type's ports, keeping everything else about it. */
export function setPorts(sys: System, id: string, ports: PortSpec[]) {
  const t = sys.type(id);
  sys.types.set(id, { ...t, ports });
}

/** Set one port's direction or type (or label); undefined clears it. */
export function setPortOn(sys: System, id: string, slot: number, patch: Partial<PortSpec>) {
  const ports = portsFor(sys.type(id));
  ports[slot] = { ...ports[slot], ...patch };
  for (const k of ["pol", "type", "label"] as const) if (ports[slot]![k] === undefined) delete ports[slot]![k];
  setPorts(sys, id, ports);
}

/** Change how strict the system is. Turning a dimension off forgets it on every port. */
export function setTypingOn(sys: System, next: Partial<Typing>) {
  const typing = { ...sys.typing, ...next };
  for (const t of [...sys.types.values()]) {
    if (!t.ports) continue;
    const ports = t.ports.map((p) => {
      const q = { ...p };
      if (typing.dirs === "off") delete q.pol;
      if (typing.types === "off") delete q.type;
      return q;
    });
    sys.types.set(t.id, { ...t, ports });
  }
  if (typing.types === "off") typing.names = [];
  sys.typing = typing;
}

/** Why a name won't do for a new type, if it won't. */
export function typeNameProblem(sys: System, name: string): string | undefined {
  if (!name) return "Give it a name.";
  if (sys.typing.names.includes(name)) return `There's already a type called ${name}.`;
  if (/[\s,;()~"+]/.test(name) || name.startsWith("-")) return "Use letters, digits, - and _ only.";
  return undefined;
}

/** Add a type ports can have. Returns why not, if the name won't do. */
export function addTypeNameOn(sys: System, name: string): string | undefined {
  const n = name.trim();
  const why = typeNameProblem(sys, n);
  if (why) return why;
  sys.typing = { ...sys.typing, names: [...sys.typing.names, n] };
  return undefined;
}

/** Rename a type, on every port that has it. Returns why not, if the name won't do. */
export function renameTypeNameOn(sys: System, from: string, to: string): string | undefined {
  const n = to.trim();
  if (!n || n === from) return;
  const why = typeNameProblem(sys, n);
  if (why) return why;
  sys.typing = { ...sys.typing, names: sys.typing.names.map((x) => (x === from ? n : x)) };
  for (const t of [...sys.types.values()]) {
    if (t.ports?.some((p) => p.type === from)) setPorts(sys, t.id, t.ports.map((p) => (p.type === from ? { ...p, type: n } : p)));
  }
}

/** Forget a type: its ports fit anything again, so no wire breaks. */
export function deleteTypeNameOn(sys: System, name: string) {
  sys.typing = { ...sys.typing, names: sys.typing.names.filter((x) => x !== name) };
  for (const t of [...sys.types.values()]) {
    if (!t.ports?.some((p) => p.type === name)) continue;
    setPorts(sys, t.id, t.ports.map((p) => { if (p.type !== name) return p; const { type: _, ...rest } = p; return rest; }));
  }
}

/** How many ports have a type. */
export function typeUses(sys: System, name: string): number {
  let n = 0;
  for (const t of sys.types.values()) for (const p of t.ports ?? []) if (p.type === name) n++;
  return n;
}

/** Fill in missing directions and types from what the ports are wired to in a net. Returns how many it filled. */
export function guessPortsOn(sys: System, net: Net, what: "dir" | "type" | "both" = "both"): number {
  // For each agent type, a guess per slot from the first wired port that says something.
  const guesses = new Map<string, PortSpec[]>();
  for (const a of net.agents.values()) {
    const t = sys.types.get(a.type);
    if (!t) continue;
    const gs = guesses.get(a.type) ?? Array.from({ length: t.arity + 1 }, () => ({}) as PortSpec);
    guesses.set(a.type, gs);
    a.wires.forEach((_, slot) => {
      const p = net.partner({ kind: "port", agent: a.id, slot });
      if (p?.kind !== "port") return;
      const there = flip(specOf(sys, net.agent(p.agent).type, p.slot));
      if (what !== "type" && there.pol && !t.ports?.[slot]?.pol) gs[slot]!.pol ??= there.pol;
      if (what !== "dir" && there.type && !t.ports?.[slot]?.type) gs[slot]!.type ??= there.type;
    });
  }
  const n = [...guesses.values()].flat().reduce((k, g) => k + (g.pol ? 1 : 0) + (g.type ? 1 : 0), 0);
  for (const [id, gs] of guesses) {
    const t = sys.type(id);
    setPorts(sys, id, Array.from({ length: t.arity + 1 }, (_, s) => ({ ...gs[s], ...(t.ports?.[s] ?? {}) })));
  }
  return n;
}
