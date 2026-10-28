import { arithmetic, lists } from "./presets";
import { A, L, R, type RuleEnd, System } from "./system";
import type { PortSpec } from "./types";

const give = (type: string, label: string): PortSpec => ({ pol: "give", type, label });
const take = (type: string, label: string): PortSpec => ({ pol: "take", type, label });
const n = "number";
const l = "list";

/** Only the data constructors this example uses, with a generic copier and eraser. */
function dataSystem(withLists: boolean): System {
  const data = lists();
  const sys = new System();
  for (const id of ["0", "S", "δ", "ε", ...(withLists ? ["[]", "∷"] : [])]) sys.addType(data.type(id));
  sys.typing = { ...data.typing, names: withLists ? [n, l] : [n] };
  for (const rule of data.rules.values()) if (sys.types.has(rule.left) && sys.types.has(rule.right)) sys.addRule(rule);
  return sys;
}

function withArithmetic(sys: System): System {
  const numbers = arithmetic();
  for (const id of ["+", "×"]) sys.addType(numbers.type(id));
  for (const rule of numbers.rules.values()) if (["+", "×"].includes(rule.left)) sys.addRule(rule);
  return sys;
}

/** Copy and erase syntax structurally, including any captured numbers. */
function syntaxRules(sys: System, constructors: string[]) {
  for (const id of constructors) {
    const arity = sys.type(id).arity;
    sys.addRule({
      left: "ε", right: id, agents: Array(arity).fill("ε"),
      wires: Array.from({ length: arity }, (_, i): [RuleEnd, RuleEnd] => [A(i, 0), R(i + 1)]),
      description: "Discard this piece of syntax and its children.",
    });
    const wires: [RuleEnd, RuleEnd][] = [[A(0, 0), L(1)], [A(1, 0), L(2)]];
    for (let i = 0; i < arity; i++) {
      wires.push([A(i + 2, 0), R(i + 1)], [A(i + 2, 1), A(0, i + 1)], [A(i + 2, 2), A(1, i + 1)]);
    }
    sys.addRule({ left: "δ", right: id, agents: [id, id, ...Array(arity).fill("δ")], wires, description: "Copy this piece of syntax, recursively copying its children." });
  }
}

/** Function values, captured arguments, composition, application and higher-order map. */
export function higherOrderMap(): System {
  const fn = "function";
  const sys = withArithmetic(dataSystem(true))
    .addType({ id: "Sq", name: "square function", symbol: "Sq", arity: 0, ports: [give(fn, "x ↦ x × x")] })
    .addType({ id: "Plus", name: "add a captured number", symbol: "Plus", arity: 1, ports: [give(fn, "x ↦ x + k"), take(n, "captured k")] })
    .addType({ id: "Then", name: "compose two functions", symbol: "Then", arity: 2, ports: [give(fn, "first, then second"), take(fn, "first function"), take(fn, "second function")] })
    .addType({ id: "Apply", name: "apply a function", symbol: "Apply", arity: 2, ports: [take(fn, "function to run"), give(n, "result"), take(n, "argument")] })
    .addType({ id: "Map", name: "map a function over a list", symbol: "Map", arity: 2, ports: [take(l, "input list"), give(l, "result list"), take(fn, "function to apply to each item")] });
  sys.typing.names.push(fn);
  syntaxRules(sys, ["Sq", "Plus", "Then"]);

  sys.addRule({
    left: "Apply", right: "Sq", agents: ["δ", "×"],
    wires: [[A(0, 0), L(2)], [A(0, 1), A(1, 0)], [A(0, 2), A(1, 2)], [A(1, 1), L(1)]],
    description: "Run the square function: copy the argument and multiply the copies.",
  });
  sys.addRule({
    left: "Apply", right: "Plus", agents: ["+"],
    wires: [[A(0, 0), L(2)], [A(0, 1), L(1)], [A(0, 2), R(1)]],
    description: "Add the captured number to the argument.",
  });
  sys.addRule({
    left: "Apply", right: "Then", agents: ["Apply", "Apply"],
    wires: [[A(0, 0), R(1)], [A(0, 1), A(1, 2)], [A(0, 2), L(2)], [A(1, 0), R(2)], [A(1, 1), L(1)]],
    description: "Apply the first function, then pass its result to the second function.",
  });
  sys.addRule({ left: "Map", right: "[]", agents: ["[]", "ε"], wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]], description: "Mapping over [] returns []; discard the unused function." });
  sys.addRule({
    left: "Map", right: "∷", agents: ["∷", "δ", "Apply", "Map"],
    wires: [
      [A(0, 0), L(1)], [A(0, 1), A(2, 1)], [A(0, 2), A(3, 1)],
      [A(1, 0), L(2)], [A(1, 1), A(2, 0)], [A(1, 2), A(3, 2)],
      [A(2, 2), R(1)], [A(3, 0), R(2)],
    ],
    description: "Copy the function itself. Apply one copy to the head and map the other over the tail.",
  });
  return sys;
}

/** A symbolic differentiator whose output is executable expression syntax. */
export function differentiation(): System {
  const expr = "expression";
  const sys = withArithmetic(dataSystem(false))
    .addType({ id: "X", name: "variable x", symbol: "X", arity: 0, ports: [give(expr, "variable x")] })
    .addType({ id: "K", name: "constant expression", symbol: "K", arity: 1, ports: [give(expr, "constant expression"), take(n, "constant value")] });
  for (const [id, name] of [["Add", "sum expression"], ["Mul", "product expression"]] as const) {
    sys.addType({ id, name, symbol: id, arity: 2, ports: [give(expr, "expression"), take(expr, "left expression"), take(expr, "right expression")] });
  }
  sys.addType({ id: "D", name: "differentiate with respect to x", symbol: "D", arity: 1, ports: [take(expr, "expression to differentiate"), give(expr, "derivative expression")] });
  sys.addType({ id: "Eval", name: "evaluate an expression", symbol: "Eval", arity: 2, ports: [take(expr, "expression to run"), give(n, "result"), take(n, "value of x")] });
  sys.typing.names.push(expr);
  syntaxRules(sys, ["X", "K", "Add", "Mul"]);

  sys.addRule({ left: "D", right: "X", agents: ["K", "S", "0"], wires: [[A(0, 0), L(1)], [A(0, 1), A(1, 0)], [A(1, 1), A(2, 0)]], description: "The derivative of x is 1." });
  sys.addRule({ left: "D", right: "K", agents: ["K", "0", "ε"], wires: [[A(0, 0), L(1)], [A(0, 1), A(1, 0)], [A(2, 0), R(1)]], description: "The derivative of a constant is 0; discard its old value." });
  sys.addRule({
    left: "D", right: "Add", agents: ["Add", "D", "D"],
    wires: [[A(0, 0), L(1)], [A(0, 1), A(1, 1)], [A(0, 2), A(2, 1)], [A(1, 0), R(1)], [A(2, 0), R(2)]],
    description: "Sum rule: D(u + v) = D(u) + D(v). Differentiate both children independently.",
  });
  sys.addRule({
    left: "D", right: "Mul", agents: ["Add", "Mul", "Mul", "D", "D", "δ", "δ"],
    wires: [
      [A(0, 0), L(1)], [A(0, 1), A(1, 0)], [A(0, 2), A(2, 0)],
      [A(1, 1), A(3, 1)], [A(1, 2), A(6, 2)], [A(2, 1), A(5, 2)], [A(2, 2), A(4, 1)],
      [A(3, 0), A(5, 1)], [A(4, 0), A(6, 1)], [A(5, 0), R(1)], [A(6, 0), R(2)],
    ],
    description: "Product rule: D(u × v) = D(u) × v + u × D(v). Copy the expressions as syntax, not their numerical results.",
  });
  sys.addRule({ left: "Eval", right: "X", agents: [], wires: [[L(1), L(2)]], description: "Substitute the supplied value for x." });
  sys.addRule({ left: "Eval", right: "K", agents: ["ε"], wires: [[L(1), R(1)], [A(0, 0), L(2)]], description: "Return the constant and discard the unused x." });
  for (const [constructor, operation] of [["Add", "+"], ["Mul", "×"]] as const) {
    sys.addRule({
      left: "Eval", right: constructor, agents: [operation, "δ", "Eval", "Eval"],
      wires: [
        [A(0, 0), A(2, 1)], [A(0, 1), L(1)], [A(0, 2), A(3, 1)],
        [A(1, 0), L(2)], [A(1, 1), A(2, 2)], [A(1, 2), A(3, 2)], [A(2, 0), R(1)], [A(3, 0), R(2)],
      ],
      description: "Copy x, evaluate both child expressions, and combine their numerical results.",
    });
  }
  return sys;
}

/** Sieve [2, 3, …, bound], using local divisibility checks. */
export function primeSieve(): System {
  const b = "boolean";
  const sys = dataSystem(true)
    .addType({ id: "T", name: "divides exactly", symbol: "T", arity: 0, ports: [give(b, "is a multiple")] })
    .addType({ id: "F", name: "does not divide exactly", symbol: "F", arity: 0, ports: [give(b, "is not a multiple")] })
    .addType({ id: "Sieve", name: "sieve of primes", symbol: "Sieve", arity: 1, ports: [take(l, "consecutive candidates starting at 2"), give(l, "primes")] })
    .addType({ id: "Filter", name: "remove multiples", symbol: "Filter", arity: 2, ports: [take(l, "candidates"), give(l, "nonmultiples"), take(n, "positive divisor")] })
    .addType({ id: "Keep", name: "keep or discard candidate", symbol: "Keep", arity: 4, ports: [take(b, "is this a multiple?"), give(l, "filtered list"), take(n, "candidate"), take(l, "remaining candidates"), take(n, "divisor for the rest")] })
    .addType({ id: "Mod", name: "count dividend units", symbol: "Mod", arity: 3, ports: [take(n, "dividend still to count"), give(b, "divides exactly?"), take(n, "positive divisor"), take(n, "countdown, initially 0")] })
    .addType({ id: "Count", name: "advance divisibility countdown", symbol: "Count", arity: 3, ports: [take(n, "countdown"), give(b, "divides exactly?"), take(n, "positive divisor"), take(n, "remaining dividend")] })
    .addType({ id: "Z?", name: "did the countdown reach zero?", symbol: "Z?", arity: 1, ports: [take(n, "final countdown"), give(b, "divides exactly?")] });
  sys.typing.names.push(b);

  sys.addRule({ left: "Sieve", right: "[]", agents: ["[]"], wires: [[A(0, 0), L(1)]], description: "No candidates remain." });
  sys.addRule({
    left: "Sieve", right: "∷", agents: ["∷", "δ", "Filter", "Sieve"],
    wires: [
      [A(0, 0), L(1)], [A(0, 1), A(1, 1)], [A(0, 2), A(3, 1)],
      [A(1, 0), R(1)], [A(1, 2), A(2, 2)], [A(2, 0), R(2)], [A(2, 1), A(3, 0)],
    ],
    description: "The first remaining candidate is prime. Emit it, filter its multiples from the tail, and sieve again.",
  });
  sys.addRule({ left: "Filter", right: "[]", agents: ["[]", "ε"], wires: [[A(0, 0), L(1)], [A(1, 0), L(2)]], description: "The filtered tail is empty; discard the divisor." });
  sys.addRule({
    left: "Filter", right: "∷", agents: ["δ", "δ", "Mod", "0", "Keep"],
    wires: [
      [A(0, 0), R(1)], [A(0, 1), A(2, 0)], [A(0, 2), A(4, 2)],
      [A(1, 0), L(2)], [A(1, 1), A(2, 2)], [A(1, 2), A(4, 4)],
      [A(2, 1), A(4, 0)], [A(2, 3), A(3, 0)],
      [A(4, 1), L(1)], [A(4, 3), R(2)],
    ],
    description: "Test this candidate for divisibility; keep the tail and divisor ready for the next candidate.",
  });
  sys.addRule({
    left: "Keep", right: "T", agents: ["ε", "Filter"],
    wires: [[A(0, 0), L(2)], [A(1, 0), L(3)], [A(1, 1), L(1)], [A(1, 2), L(4)]],
    description: "This is a multiple: discard it and continue filtering the tail.",
  });
  sys.addRule({
    left: "Keep", right: "F", agents: ["∷", "Filter"],
    wires: [[A(0, 0), L(1)], [A(0, 1), L(2)], [A(0, 2), A(1, 1)], [A(1, 0), L(3)], [A(1, 2), L(4)]],
    description: "Keep this candidate, then continue filtering the tail.",
  });

  // Mod consumes the dividend. Count consumes one countdown unit; at zero,
  // it copies the positive divisor and tries again. A final zero means divisibility.
  sys.addRule({ left: "Mod", right: "0", agents: ["Z?", "ε"], wires: [[A(0, 0), L(3)], [A(0, 1), L(1)], [A(1, 0), L(2)]], description: "The dividend is exhausted: test the final countdown and discard the divisor." });
  sys.addRule({ left: "Mod", right: "S", agents: ["Count"], wires: [[A(0, 0), L(3)], [A(0, 1), L(1)], [A(0, 2), L(2)], [A(0, 3), R(1)]], description: "Consume one dividend unit, then advance the countdown." });
  sys.addRule({
    left: "Count", right: "0", agents: ["δ", "Count"],
    wires: [[A(0, 0), L(2)], [A(0, 1), A(1, 0)], [A(0, 2), A(1, 2)], [A(1, 1), L(1)], [A(1, 3), L(3)]],
    description: "At a divisor boundary, copy the positive divisor to restart the countdown.",
  });
  sys.addRule({ left: "Count", right: "S", agents: ["Mod"], wires: [[A(0, 0), L(3)], [A(0, 1), L(1)], [A(0, 2), L(2)], [A(0, 3), R(1)]], description: "Consume one countdown unit and continue with the remaining dividend." });
  sys.addRule({ left: "Z?", right: "0", agents: ["T"], wires: [[A(0, 0), L(1)]], description: "A zero countdown means the divisor fits exactly." });
  sys.addRule({ left: "Z?", right: "S", agents: ["F", "ε"], wires: [[A(0, 0), L(1)], [A(1, 0), R(1)]], description: "A positive countdown means there is a remainder." });
  return sys;
}
