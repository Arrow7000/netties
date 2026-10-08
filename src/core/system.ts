import type { AgentType } from "./net";

/**
 * An end inside a rule's right-hand side: a port of one of the agents the
 * rule creates, or an interface port. The interface is the auxiliary ports
 * of the two interacting agents: side 0 is the rule's `left` agent, side 1
 * its `right` agent, and `slot` is that agent's aux slot (1..arity).
 */
export type RuleEnd =
  | { kind: "agent"; index: number; slot: number }
  | { kind: "iface"; side: 0 | 1; slot: number };

export interface Rule {
  left: string;
  right: string;
  /** Types of the agents created by the rule, referenced by index. */
  agents: string[];
  wires: [RuleEnd, RuleEnd][];
}

export const L = (slot: number): RuleEnd => ({ kind: "iface", side: 0, slot });
export const R = (slot: number): RuleEnd => ({ kind: "iface", side: 1, slot });
export const A = (index: number, slot: number): RuleEnd => ({ kind: "agent", index, slot });

const ruleEndKey = (e: RuleEnd): string =>
  e.kind === "agent" ? `a${e.index}:${e.slot}` : `i${e.side}:${e.slot}`;

export const pairKey = (a: string, b: string): string => `${a}|${b}`;

export class System {
  readonly types = new Map<string, AgentType>();
  readonly rules = new Map<string, Rule>();

  addType(t: AgentType): this {
    if (this.types.has(t.id)) throw new Error(`duplicate agent type ${t.id}`);
    this.types.set(t.id, t);
    return this;
  }

  type(id: string): AgentType {
    const t = this.types.get(id);
    if (!t) throw new Error(`unknown agent type ${id}`);
    return t;
  }

  addRule(r: Rule): this {
    const problems = this.validate(r);
    if (problems.length) throw new Error(`bad rule ${pairKey(r.left, r.right)}: ${problems.join("; ")}`);
    if (this.ruleFor(r.left, r.right)) throw new Error(`duplicate rule for ${pairKey(r.left, r.right)}`);
    this.rules.set(pairKey(r.left, r.right), r);
    return this;
  }

  /**
   * The rule for an active pair of types `a` and `b`. `swapped` means the
   * rule was written as (b, a), so `a` plays the rule's right side.
   */
  ruleFor(a: string, b: string): { rule: Rule; swapped: boolean } | undefined {
    const direct = this.rules.get(pairKey(a, b));
    if (direct) return { rule: direct, swapped: false };
    const flipped = this.rules.get(pairKey(b, a));
    if (flipped) return { rule: flipped, swapped: true };
    return undefined;
  }

  /** Every port of the right-hand side, created agents and interface alike, must be used exactly once. */
  validate(r: Rule): string[] {
    const problems: string[] = [];
    const expected = new Set<string>();
    const sides = [r.left, r.right];
    for (const [side, id] of sides.entries()) {
      const t = this.types.get(id);
      if (!t) {
        problems.push(`unknown agent type ${id}`);
        continue;
      }
      for (let s = 1; s <= t.arity; s++) expected.add(ruleEndKey({ kind: "iface", side: side as 0 | 1, slot: s }));
    }
    for (const [index, id] of r.agents.entries()) {
      const t = this.types.get(id);
      if (!t) {
        problems.push(`unknown agent type ${id}`);
        continue;
      }
      for (let s = 0; s <= t.arity; s++) expected.add(ruleEndKey({ kind: "agent", index, slot: s }));
    }
    const seen = new Set<string>();
    for (const end of r.wires.flat()) {
      const k = ruleEndKey(end);
      if (!expected.has(k)) problems.push(`no such port ${k}`);
      else if (seen.has(k)) problems.push(`port ${k} used twice`);
      seen.add(k);
    }
    for (const k of expected) if (!seen.has(k)) problems.push(`port ${k} left unconnected`);
    return problems;
  }
}
