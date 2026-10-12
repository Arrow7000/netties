import { A, L, R, System } from "./system";
import type { Polarity, PortSpec } from "./types";

/** A port that gives or takes, optionally of a type, with a label. */
const P = (pol: Polarity | undefined, type: string | undefined, label?: string): PortSpec => ({
  ...(pol && { pol }),
  ...(type && { type }),
  ...(label && { label }),
});
const give = (type?: string, label?: string) => P("give", type, label);
const take = (type?: string, label?: string) => P("take", type, label);

/**
 * Lafont's interaction combinators (1997, Fig. 2). With the clockwise port
 * convention, two agents facing each other have their aux ports in opposite
 * orders, so wires drawn straight across join L(i) to R(n+1-i). γγ is drawn
 * straight (L1–R2, L2–R1: "it is γγ, not δδ, which exchanges the ports")
 * and δδ crossed (L1–R1, L2–R2).
 */
export function combinators(): System {
  const sys = new System()
    .addType({ id: "γ", name: "constructor", symbol: "γ", arity: 2, filled: true })
    .addType({ id: "δ", name: "duplicator", symbol: "δ", arity: 2 })
    .addType({ id: "ε", name: "eraser", symbol: "ε", arity: 0 });

  sys.addRule({ left: "γ", right: "γ", agents: [], wires: [[L(1), R(2)], [L(2), R(1)]] });
  sys.addRule({ left: "δ", right: "δ", agents: [], wires: [[L(1), R(1)], [L(2), R(2)]] });
  sys.addRule({ left: "ε", right: "ε", agents: [], wires: [] });
  for (const t of ["γ", "δ"]) {
    // The eraser propagates: one fresh ε on each aux wire.
    sys.addRule({ left: "ε", right: t, agents: ["ε", "ε"], wires: [[A(0, 0), R(1)], [A(1, 0), R(2)]] });
  }
  // Commutation: each agent is copied onto the other's aux wires. γ'k sits
  // on L(k) and δ'j on R(j); then γ'k's j-th aux meets δ'j's k-th aux.
  const g = (k: number) => k - 1; // γ'k is agent index k-1
  const d = (j: number) => j + 1; // δ'j is agent index j+1
  const wires: [ReturnType<typeof A>, ReturnType<typeof A>][] = [];
  for (const k of [1, 2]) wires.push([A(g(k), 0), L(k)]);
  for (const j of [1, 2]) wires.push([A(d(j), 0), R(j)]);
  for (const k of [1, 2]) for (const j of [1, 2]) wires.push([A(g(k), j), A(d(j), k)]);
  sys.addRule({ left: "δ", right: "γ", agents: ["γ", "γ", "δ", "δ"], wires });
  return sys;
}

/**
 * Lafont's unary arithmetic (1997, §1.5): 0, S, + and ×, with δ and ε to
 * copy and erase numbers. As in the paper, + and × take their first
 * argument on the principal port; aux 1 is the result and aux 2 the second
 * argument (clockwise from the tip, so drawn △ they read y, x+y left to right).
 */
export function arithmetic(): System {
  const n = "number";
  const sys = new System()
    .addType({ id: "0", name: "zero", symbol: "0", arity: 0, ports: [give(n, "zero")] })
    .addType({ id: "S", name: "successor", symbol: "S", arity: 1, ports: [give(n, "the number"), take(n, "the number before it")] })
    .addType({ id: "+", name: "add", symbol: "+", arity: 2, ports: [take(n, "first number"), give(n, "the sum"), take(n, "second number")] })
    .addType({ id: "×", name: "multiply", symbol: "×", arity: 2, ports: [take(n, "first number"), give(n, "the product"), take(n, "second number")] })
    .addType({ id: "δ", name: "duplicator", symbol: "δ", arity: 2, ports: [take(n, "what gets copied"), give(n, "first copy"), give(n, "second copy")] })
    .addType({ id: "ε", name: "eraser", symbol: "ε", arity: 0, ports: [take(n, "what gets erased")] });
  sys.typing = { dirs: "required", types: "required", names: [n] };

  // 0 + y = y
  sys.addRule({ left: "+", right: "0", agents: [], wires: [[L(1), L(2)]] });
  // S x + y = S (x + y)
  sys.addRule({
    left: "+",
    right: "S",
    agents: ["S", "+"],
    wires: [[A(0, 0), L(1)], [A(0, 1), A(1, 1)], [A(1, 0), R(1)], [A(1, 2), L(2)]],
  });
  // 0 × y = 0, erasing y
  sys.addRule({ left: "×", right: "0", agents: ["ε", "0"], wires: [[A(0, 0), L(2)], [A(1, 0), L(1)]] });
  // S x × y = (x × y) + y, copying y
  sys.addRule({
    left: "×",
    right: "S",
    agents: ["δ", "×", "+"],
    wires: [
      [A(0, 0), L(2)], // copy y
      [A(1, 0), R(1)], // x × y'
      [A(1, 2), A(0, 1)],
      [A(1, 1), A(2, 0)], // (x × y') + y''
      [A(2, 2), A(0, 2)],
      [A(2, 1), L(1)],
    ],
  });
  // δ copies numbers, ε erases them.
  sys.addRule({ left: "δ", right: "0", agents: ["0", "0"], wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]] });
  sys.addRule({
    left: "δ",
    right: "S",
    agents: ["S", "S", "δ"],
    wires: [[A(0, 0), L(1)], [A(1, 0), L(2)], [A(2, 0), R(1)], [A(2, 1), A(0, 1)], [A(2, 2), A(1, 1)]],
  });
  sys.addRule({ left: "ε", right: "0", agents: [], wires: [] });
  sys.addRule({ left: "ε", right: "S", agents: ["ε"], wires: [[A(0, 0), R(1)]] });
  return sys;
}

/**
 * Lafont's directed combinators (1997, §3.4, Fig. 16): γ, δ and ε each split
 * into two, with the starred one's principal port of the opposite polarity.
 * No symbol meets itself, and the annihilations γγ* and δδ* are both drawn
 * straight, as in the paper ("just a matter of taste").
 */
export function directedCombinators(): System {
  // Unstarred agents give on their principal port and take on their aux ports; starred ones the reverse.
  const plain = [give(), take(), take()];
  const star = [take(), give(), give()];
  const sys = new System()
    .addType({ id: "γ", name: "constructor", symbol: "γ", arity: 2, filled: true, ports: plain })
    .addType({ id: "γ*", name: "co-constructor", symbol: "γ*", arity: 2, filled: true, ports: star })
    .addType({ id: "δ", name: "duplicator", symbol: "δ", arity: 2, ports: plain })
    .addType({ id: "δ*", name: "co-duplicator", symbol: "δ*", arity: 2, ports: star })
    .addType({ id: "ε", name: "eraser", symbol: "ε", arity: 0, ports: [give()] })
    .addType({ id: "ε*", name: "co-eraser", symbol: "ε*", arity: 0, ports: [take()] });
  sys.typing = { dirs: "required", types: "off", names: [] };

  for (const t of ["γ", "δ"]) sys.addRule({ left: t, right: `${t}*`, agents: [], wires: [[L(1), R(2)], [L(2), R(1)]] });
  sys.addRule({ left: "ε", right: "ε*", agents: [], wires: [] });
  for (const [e, t] of [["ε*", "γ"], ["ε*", "δ"], ["ε", "γ*"], ["ε", "δ*"]] as const) {
    sys.addRule({ left: e, right: t, agents: [e, e], wires: [[A(0, 0), R(1)], [A(1, 0), R(2)]] });
  }
  // Commutation, as in `combinators`: copies of each agent land on the
  // other's aux wires and keep their own type.
  for (const [x, y] of [["γ", "δ*"], ["δ", "γ*"]] as const) {
    const wires: [ReturnType<typeof A>, ReturnType<typeof A>][] = [];
    for (const k of [1, 2]) wires.push([A(k - 1, 0), L(k)]);
    for (const j of [1, 2]) wires.push([A(j + 1, 0), R(j)]);
    for (const k of [1, 2]) for (const j of [1, 2]) wires.push([A(k - 1, j), A(j + 1, k)]);
    sys.addRule({ left: x, right: y, agents: [y, y, x, x], wires });
  }
  return sys;
}

/**
 * Lists of numbers and their length. Numbers and lists are separate types;
 * the duplicator and eraser have directions but take any type, so they copy
 * and erase numbers and lists alike.
 */
export function lists(): System {
  const n = "number";
  const l = "list";
  const sys = new System()
    .addType({ id: "0", name: "zero", symbol: "0", arity: 0, ports: [give(n, "zero")] })
    .addType({ id: "S", name: "successor", symbol: "S", arity: 1, ports: [give(n, "the number"), take(n, "the number before it")] })
    .addType({ id: "[]", name: "empty list", symbol: "[]", arity: 0, ports: [give(l, "the empty list")] })
    .addType({
      id: "∷",
      name: "list item",
      symbol: "∷",
      arity: 2,
      ports: [give(l, "the list"), take(n, "first item"), take(l, "rest of the list")],
    })
    .addType({ id: "#", name: "length", symbol: "#", arity: 1, ports: [take(l, "the list"), give(n, "its length")] })
    .addType({ id: "δ", name: "duplicator", symbol: "δ", arity: 2, ports: [take(undefined, "what gets copied"), give(undefined, "first copy"), give(undefined, "second copy")] })
    .addType({ id: "ε", name: "eraser", symbol: "ε", arity: 0, ports: [take(undefined, "what gets erased")] });
  sys.typing = { dirs: "required", types: "optional", names: [n, l] };

  // len [] = 0
  sys.addRule({ left: "#", right: "[]", agents: ["0"], wires: [[A(0, 0), L(1)]] });
  // len (x ∷ xs) = S (len xs), erasing x
  sys.addRule({
    left: "#",
    right: "∷",
    agents: ["S", "#", "ε"],
    wires: [[A(0, 0), L(1)], [A(0, 1), A(1, 1)], [A(1, 0), R(2)], [A(2, 0), R(1)]],
  });
  // δ copies numbers and lists, ε erases them.
  sys.addRule({ left: "δ", right: "0", agents: ["0", "0"], wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]] });
  sys.addRule({
    left: "δ",
    right: "S",
    agents: ["S", "S", "δ"],
    wires: [[A(0, 0), L(1)], [A(1, 0), L(2)], [A(2, 0), R(1)], [A(2, 1), A(0, 1)], [A(2, 2), A(1, 1)]],
  });
  sys.addRule({ left: "δ", right: "[]", agents: ["[]", "[]"], wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]] });
  sys.addRule({
    left: "δ",
    right: "∷",
    agents: ["∷", "∷", "δ", "δ"],
    wires: [
      [A(0, 0), L(1)],
      [A(1, 0), L(2)],
      [A(2, 0), R(1)],
      [A(3, 0), R(2)],
      [A(2, 1), A(0, 1)],
      [A(2, 2), A(1, 1)],
      [A(3, 1), A(0, 2)],
      [A(3, 2), A(1, 2)],
    ],
  });
  sys.addRule({ left: "ε", right: "0", agents: [], wires: [] });
  sys.addRule({ left: "ε", right: "S", agents: ["ε"], wires: [[A(0, 0), R(1)]] });
  sys.addRule({ left: "ε", right: "[]", agents: [], wires: [] });
  sys.addRule({ left: "ε", right: "∷", agents: ["ε", "ε"], wires: [[A(0, 0), R(1)], [A(1, 0), R(2)]] });
  return sys;
}

/** Lists and unary addition together, so a computed length can feed arithmetic. */
export function listArithmetic(): System {
  const sys = lists();
  const numbers = arithmetic();
  sys.addType(numbers.type("+"));
  for (const rule of numbers.rules.values()) if (rule.left === "+") sys.addRule(rule);
  return sys;
}

/** Three fully specified port types for practising which loose ports can join. */
export function typingLab(): System {
  const n = "number";
  const l = "list";
  const b = "boolean";
  const sys = new System()
    .addType({ id: "0", name: "zero", symbol: "0", arity: 0, ports: [give(n, "a number")] })
    .addType({ id: "S", name: "successor", symbol: "S", arity: 1, ports: [give(n, "the next number"), take(n, "the previous number")] })
    .addType({ id: "[]", name: "empty list", symbol: "[]", arity: 0, ports: [give(l, "a list")] })
    .addType({ id: "∷", name: "list item", symbol: "∷", arity: 2, ports: [give(l, "the list"), take(n, "its first number"), take(l, "the rest")] })
    .addType({ id: "T", name: "true", symbol: "T", arity: 0, ports: [give(b, "a boolean")] })
    .addType({ id: "¬", name: "not", symbol: "¬", arity: 1, ports: [take(b, "the input"), give(b, "the result")] });
  sys.typing = { dirs: "required", types: "required", names: [n, l, b] };
  return sys;
}
