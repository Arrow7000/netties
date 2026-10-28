import { arithmetic, lists } from "./presets";
import { A, L, R, System } from "./system";
import type { PortSpec } from "./types";

const give = (type: string, label: string): PortSpec => ({ pol: "give", type, label });
const take = (type: string, label: string): PortSpec => ({ pol: "take", type, label });
const n = "number";

/** Fib(n) returns F(n) and F(n + 1), needing only the 0 and S cases. */
export function fibonacci(): System {
  const sys = arithmetic()
    .addType({ id: "Fib", name: "neighbouring Fibonacci numbers", symbol: "Fib", arity: 2, ports: [take(n, "index n"), give(n, "F(n)"), give(n, "F(n + 1)")] });

  sys.addRule({
    left: "Fib", right: "0", agents: ["0", "S", "0"],
    wires: [[A(0, 0), L(1)], [A(1, 0), L(2)], [A(1, 1), A(2, 0)]],
    description: "At zero the neighbouring values are F(0) = 0 and F(1) = 1.",
  });
  sys.addRule({
    left: "Fib", right: "S", agents: ["Fib", "δ", "+"],
    wires: [
      [A(0, 0), R(1)],
      [A(0, 1), A(2, 0)], [A(0, 2), A(1, 0)],
      [A(1, 1), L(1)], [A(1, 2), A(2, 2)], [A(2, 1), L(2)],
    ],
    description: "If Fib(n) gives (a, b), Fib(n + 1) gives (b, a + b). Copy b for the first output and the addition.",
  });
  return sys;
}

/** Sort a list by sorting its tail and inserting its head into that sorted list. */
export function listSort(): System {
  const l = "list";
  const sys = new System();
  const data = lists();
  for (const id of ["0", "S", "[]", "∷"]) sys.addType(data.type(id));
  sys.typing = { dirs: "required", types: "required", names: [n, l] };
  sys.addType({ id: "Sort", name: "sort a list", symbol: "Sort", arity: 1, ports: [take(l, "unsorted list"), give(l, "sorted list")] });
  sys.addType({ id: "Ins", name: "insert into a sorted list", symbol: "Ins", arity: 2, ports: [take(l, "sorted list"), give(l, "list with the number inserted"), take(n, "number to insert")] });
  for (const [id, name, first, second] of [
    ["↕", "compare and exchange", "first number", "second number"],
    ["↕S", "compare after a successor", "second number", "first number minus one"],
  ] as const) {
    sys.addType({ id, name, symbol: id, arity: 3, ports: [take(n, first), give(n, "smaller number"), give(n, "larger number"), take(n, second)] });
  }

  sys.addRule({ left: "Sort", right: "[]", agents: ["[]"], wires: [[A(0, 0), L(1)]], description: "An empty list is already sorted." });
  sys.addRule({
    left: "Sort", right: "∷", agents: ["Sort", "Ins"],
    wires: [[A(0, 0), R(2)], [A(0, 1), A(1, 0)], [A(1, 1), L(1)], [A(1, 2), R(1)]],
    description: "Sort the tail, then insert the head into that sorted list.",
  });
  sys.addRule({
    left: "Ins", right: "[]", agents: ["∷", "[]"],
    wires: [[A(0, 0), L(1)], [A(0, 1), L(2)], [A(0, 2), A(1, 0)]],
    description: "Inserting into [] produces a one-item list.",
  });
  sys.addRule({
    left: "Ins", right: "∷", agents: ["∷", "↕", "Ins"],
    wires: [
      [A(0, 0), L(1)], [A(0, 1), A(1, 1)], [A(0, 2), A(2, 1)],
      [A(1, 0), L(2)], [A(1, 3), R(1)], [A(1, 2), A(2, 2)], [A(2, 0), R(2)],
    ],
    description: "Compare the new number with the head. Keep the smaller at the front and insert the larger into the tail.",
  });

  // Compare/exchange consumes two numbers and returns their min and max.
  sys.addRule({ left: "↕", right: "0", agents: ["0"], wires: [[A(0, 0), L(1)], [L(2), L(3)]], description: "Zero is the smaller number; the other number is the larger one." });
  sys.addRule({
    left: "↕", right: "S", agents: ["↕S"],
    wires: [[A(0, 0), L(3)], [A(0, 1), L(1)], [A(0, 2), L(2)], [A(0, 3), R(1)]],
    description: "The first number is positive. Inspect the second number next.",
  });
  sys.addRule({
    left: "↕S", right: "0", agents: ["0", "S"],
    wires: [[A(0, 0), L(1)], [A(1, 0), L(2)], [A(1, 1), L(3)]],
    description: "The second number is zero: exchange the two numbers.",
  });
  sys.addRule({
    left: "↕S", right: "S", agents: ["S", "S", "↕"],
    wires: [
      [A(0, 0), L(1)], [A(0, 1), A(2, 1)],
      [A(1, 0), L(2)], [A(1, 1), A(2, 2)],
      [A(2, 0), L(3)], [A(2, 3), R(1)],
    ],
    description: "Both are positive: compare their predecessors and restore one successor to each output.",
  });
  return sys;
}

/**
 * From is a suspended stream, not an eager recursive call. Only Pull can
 * unfold it; Take checks its remaining count before requesting another item.
 */
export function range(): System {
  const stream = "stream";
  const sys = lists()
    .addType({ id: "From", name: "naturals from here", symbol: "From", arity: 1, ports: [give(stream, "suspended stream"), take(n, "next number")] })
    .addType({ id: "Take", name: "take a finite prefix", symbol: "Take", arity: 2, ports: [take(n, "how many items"), give("list", "finite prefix"), take(stream, "source stream")] })
    .addType({ id: "Pull", name: "request one item", symbol: "Pull", arity: 2, ports: [take(stream, "source stream"), give("list", "finite prefix"), take(n, "items still needed after this one")] })
    .addType({ id: "Stop", name: "close the stream", symbol: "Stop", arity: 0, ports: [take(stream, "unused stream")] });
  sys.typing.names.push(stream);

  sys.addRule({
    left: "Take", right: "0", agents: ["[]", "Stop"],
    wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]],
    description: "No more items are needed: return [] and close the source without unfolding it.",
  });
  sys.addRule({
    left: "Take", right: "S", agents: ["Pull"],
    wires: [[A(0, 0), L(2)], [A(0, 1), L(1)], [A(0, 2), R(1)]],
    description: "A positive count authorizes exactly one request to the source.",
  });
  sys.addRule({
    left: "Pull", right: "From", agents: ["∷", "δ", "S", "From", "Take"],
    wires: [
      [A(0, 0), L(1)], [A(0, 1), A(1, 1)], [A(0, 2), A(4, 1)],
      [A(1, 0), R(1)], [A(1, 2), A(2, 1)], [A(2, 0), A(3, 1)],
      [A(3, 0), A(4, 2)], [A(4, 0), L(2)],
    ],
    description: "Emit n, suspend From(n + 1), and let the remaining count decide whether to request again.",
  });
  sys.addRule({ left: "Stop", right: "From", agents: ["ε"], wires: [[A(0, 0), R(1)]], description: "Dispose of the suspended generator and its seed; never generate its infinite tail." });
  return sys;
}
