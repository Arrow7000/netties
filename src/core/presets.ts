import { A, L, R, System } from "./system";

/**
 * Lafont's interaction combinators (1997). With the clockwise port
 * convention, two agents facing each other have their aux ports in opposite
 * orders, so wires drawn straight across join L(i) to R(n+1-i). That makes
 * δδ (drawn straight) L1–R2, L2–R1, and γγ (drawn crossed) L1–R1, L2–R2.
 */
export function combinators(): System {
  const sys = new System()
    .addType({ id: "γ", name: "constructor", symbol: "γ", arity: 2 })
    .addType({ id: "δ", name: "duplicator", symbol: "δ", arity: 2 })
    .addType({ id: "ε", name: "eraser", symbol: "ε", arity: 0 });

  sys.addRule({ left: "γ", right: "γ", agents: [], wires: [[L(1), R(1)], [L(2), R(2)]] });
  sys.addRule({ left: "δ", right: "δ", agents: [], wires: [[L(1), R(2)], [L(2), R(1)]] });
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

/** Lafont's unary arithmetic: 0, S, + and ×, with δ and ε to copy and erase numbers. */
export function arithmetic(): System {
  const sys = new System()
    .addType({ id: "0", name: "zero", symbol: "0", arity: 0 })
    .addType({ id: "S", name: "successor", symbol: "S", arity: 1 })
    // + and ×: principal port takes the first argument, aux 1 the second, aux 2 is the result.
    .addType({ id: "+", name: "add", symbol: "+", arity: 2 })
    .addType({ id: "×", name: "multiply", symbol: "×", arity: 2 })
    .addType({ id: "δ", name: "duplicator", symbol: "δ", arity: 2 })
    .addType({ id: "ε", name: "eraser", symbol: "ε", arity: 0 });

  // 0 + y = y
  sys.addRule({ left: "+", right: "0", agents: [], wires: [[L(1), L(2)]] });
  // S x + y = S (x + y)
  sys.addRule({
    left: "+",
    right: "S",
    agents: ["S", "+"],
    wires: [[A(0, 0), L(2)], [A(0, 1), A(1, 2)], [A(1, 0), R(1)], [A(1, 1), L(1)]],
  });
  // 0 × y = 0, erasing y
  sys.addRule({ left: "×", right: "0", agents: ["ε", "0"], wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]] });
  // S x × y = y + (x × y), copying y
  sys.addRule({
    left: "×",
    right: "S",
    agents: ["δ", "×", "+"],
    wires: [
      [A(0, 0), L(1)], // copy y
      [A(1, 0), R(1)], // x × y'
      [A(1, 1), A(0, 1)],
      [A(2, 0), A(0, 2)], // y'' + (x × y')
      [A(2, 1), A(1, 2)],
      [A(2, 2), L(2)],
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
