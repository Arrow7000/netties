import { A, L, R, System, type RuleEnd } from "./system";

/**
 * Experimental call-by-name evaluator for the triage presentation of tree
 * calculus. A source term uses only Leaf and App; Stem and Fork are the
 * exposed head forms made by evaluation. Their children remain unevaluated
 * terms, so a Fork can be inspected while a child still contains an App.
 *
 * Eval produces a head form at its auxiliary output. Call handles applying
 * that form; Case inspects the first child of a function Fork; Triage inspects
 * its final argument. Dup and Erase make copying and discarding explicit.
 * This is an operational candidate, not a proof of correctness.
 */
export function triageMachine(): System {
  const term = "term";
  const give = { pol: "give" as const, type: term };
  const take = { pol: "take" as const, type: term };
  const sys = new System()
    .addType({ id: "Leaf", name: "leaf", symbol: "Leaf", arity: 0, ports: [give] })
    .addType({ id: "Stem", name: "stem", symbol: "Stem", arity: 1, ports: [give, take] })
    .addType({ id: "Fork", name: "fork", symbol: "Fork", arity: 2, ports: [give, take, take] })
    .addType({ id: "App", name: "application", symbol: "App", arity: 2, ports: [give, take, take] })
    .addType({ id: "Eval", name: "evaluate head", symbol: "Eval", arity: 1, ports: [take, give] })
    .addType({ id: "Call", name: "apply value", symbol: "Call", arity: 2, ports: [take, give, take] })
    .addType({ id: "Case", name: "classify function", symbol: "Case", arity: 3, ports: [take, give, take, take] })
    .addType({ id: "Triage", name: "inspect argument", symbol: "Triage", arity: 4, ports: [take, give, take, take, take] })
    .addType({ id: "Dup", name: "duplicate term", symbol: "Dup", arity: 2, ports: [take, give, give] })
    .addType({ id: "Erase", name: "erase term", symbol: "Erase", arity: 0, ports: [take] });
  sys.typing = { dirs: "required", types: "required", names: [term] };

  // Eval only emits Leaf, Stem or Fork. The children of Stem/Fork stay raw.
  for (const [value, arity] of [["Leaf", 0], ["Stem", 1], ["Fork", 2]] as const) {
    sys.addRule({
      left: "Eval", right: value, agents: [value],
      wires: [
        [A(0, 0), L(1)],
        ...Array.from({ length: arity }, (_, i): [RuleEnd, RuleEnd] => [A(0, i + 1), R(i + 1)]),
      ],
    });
  }
  sys.addRule({
    left: "Eval", right: "App", agents: ["Eval", "Call"],
    wires: [
      [A(0, 0), R(1)], // evaluate the function
      [A(0, 1), A(1, 0)],
      [A(1, 1), L(1)], // eventual result
      [A(1, 2), R(2)], // argument stays raw
    ],
  });

  // Applying the first two head forms builds a larger value without forcing
  // the new child. Applying a Fork must inspect the head of its first child.
  sys.addRule({ left: "Call", right: "Leaf", agents: ["Stem"], wires: [[A(0, 0), L(1)], [A(0, 1), L(2)]] });
  sys.addRule({
    left: "Call", right: "Stem", agents: ["Fork"],
    wires: [[A(0, 0), L(1)], [A(0, 1), R(1)], [A(0, 2), L(2)]],
  });
  sys.addRule({
    left: "Call", right: "Fork", agents: ["Eval", "Case"],
    wires: [
      [A(0, 0), R(1)], [A(0, 1), A(1, 0)],
      [A(1, 1), L(1)], [A(1, 2), R(2)], [A(1, 3), L(2)],
    ],
  });

  // Leaf case: (Leaf (Leaf w) y) z -> y.
  sys.addRule({
    left: "Case", right: "Leaf", agents: ["Eval", "Erase"],
    wires: [[A(0, 0), L(2)], [A(0, 1), L(1)], [A(1, 0), L(3)]],
  });
  // Stem case: (Leaf (Stem x) y) z -> x z (y z).
  sys.addRule({
    left: "Case", right: "Stem", agents: ["Dup", "App", "App", "App", "Eval"],
    wires: [
      [A(0, 0), L(3)], [A(0, 1), A(1, 2)], [A(0, 2), A(2, 2)],
      [A(1, 1), R(1)], [A(2, 1), L(2)],
      [A(3, 1), A(1, 0)], [A(3, 2), A(2, 0)],
      [A(4, 0), A(3, 0)], [A(4, 1), L(1)],
    ],
  });
  // Fork case: the final argument itself must be inspected.
  sys.addRule({
    left: "Case", right: "Fork", agents: ["Eval", "Triage"],
    wires: [
      [A(0, 0), L(3)], [A(0, 1), A(1, 0)],
      [A(1, 1), L(1)], [A(1, 2), R(1)], [A(1, 3), R(2)], [A(1, 4), L(2)],
    ],
  });

  // (Leaf (Fork w x) y) Leaf -> w
  sys.addRule({
    left: "Triage", right: "Leaf", agents: ["Eval", "Erase", "Erase"],
    wires: [[A(0, 0), L(2)], [A(0, 1), L(1)], [A(1, 0), L(3)], [A(2, 0), L(4)]],
  });
  // (Leaf (Fork w x) y) (Stem u) -> x u
  sys.addRule({
    left: "Triage", right: "Stem", agents: ["App", "Eval", "Erase", "Erase"],
    wires: [
      [A(0, 1), L(3)], [A(0, 2), R(1)], [A(1, 0), A(0, 0)], [A(1, 1), L(1)],
      [A(2, 0), L(2)], [A(3, 0), L(4)],
    ],
  });
  // (Leaf (Fork w x) y) (Fork u v) -> y u v
  sys.addRule({
    left: "Triage", right: "Fork", agents: ["App", "App", "Eval", "Erase", "Erase"],
    wires: [
      [A(0, 1), L(4)], [A(0, 2), R(1)],
      [A(1, 1), A(0, 0)], [A(1, 2), R(2)],
      [A(2, 0), A(1, 0)], [A(2, 1), L(1)],
      [A(3, 0), L(2)], [A(4, 0), L(3)],
    ],
  });

  // Copy and erase syntax trees. Neither asks for a term's head form.
  for (const [value, arity] of [["Leaf", 0], ["Stem", 1], ["Fork", 2], ["App", 2]] as const) {
    sys.addRule({
      left: "Erase", right: value, agents: Array(arity).fill("Erase"),
      wires: Array.from({ length: arity }, (_, i): [RuleEnd, RuleEnd] => [A(i, 0), R(i + 1)]),
    });
    const copies = [value, value];
    const dupes = Array(arity).fill("Dup");
    const wires: [RuleEnd, RuleEnd][] = [[A(0, 0), L(1)], [A(1, 0), L(2)]];
    for (let i = 0; i < arity; i++) {
      wires.push([A(2 + i, 0), R(i + 1)]);
      wires.push([A(2 + i, 1), A(0, i + 1)]);
      wires.push([A(2 + i, 2), A(1, i + 1)]);
    }
    sys.addRule({ left: "Dup", right: value, agents: [...copies, ...dupes], wires });
  }
  return sys;
}
