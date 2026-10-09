import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { arithmetic, combinators } from "./presets";
import { isSymmetric, netToRule, pairNet, ruleToNet } from "./ruleNet";
import { A, L, R, type Rule } from "./system";

describe("rules as nets", () => {
  it("round-trips every preset rule", () => {
    for (const sys of [combinators(), arithmetic()]) {
      for (const rule of sys.rules.values()) {
        const net = ruleToNet(sys, rule);
        const back = netToRule(rule.left, rule.right, net);
        expect(back.open).toBe(0);
        expect(sys.validate(back.rule)).toEqual([]);
        expect(canonical(ruleToNet(sys, back.rule))).toBe(canonical(net));
      }
    }
  });

  it("knows the combinators' self-rules are symmetric", () => {
    const sys = combinators();
    expect(isSymmetric(ruleToNet(sys, sys.ruleFor("γ", "γ")!.rule))).toBe(true);
    expect(isSymmetric(ruleToNet(sys, sys.ruleFor("δ", "δ")!.rule))).toBe(true);
    // γ⋈γ with one ε on a left wire isn't.
    const lopsided: Rule = {
      left: "γ",
      right: "γ",
      agents: ["ε", "ε"],
      wires: [[A(0, 0), L(1)], [A(1, 0), L(2)], [R(1), R(2)]],
    };
    expect(isSymmetric(ruleToNet(sys, lopsided))).toBe(false);
  });

  it("builds the left-hand side as an active pair", () => {
    const { net } = pairNet(combinators(), "γ", "δ");
    expect(net.activePairs()).toHaveLength(1);
    expect(net.unconnected()).toEqual([]);
  });
});
