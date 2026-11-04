import type { Demands } from "./check";

/** What the net on `out` should read back as. */
export type Answer = { kind: "number"; value: number } | { kind: "list"; value: number[] } | { kind: "bool"; value: boolean };

export interface Task {
  id: string;
  /** What a visitor would type. */
  prompt: string;
  answer: Answer;
  /** What else a right answer needs, so that typing the answer in doesn't pass. */
  demands?: Demands;
  /**
   * Once it passes, the same agents and rules must solve this too, changing
   * only the starting net: a system that only fits its one example fails here.
   */
  again?: { prompt: string; answer: Answer };
}

const num = (value: number): Answer => ({ kind: "number", value });
const list = (...value: number[]): Answer => ({ kind: "list", value });
const bool = (value: boolean): Answer => ({ kind: "bool", value });

export const TASKS: Task[] = [
  { id: "add", prompt: "Add 3 and 2.", answer: num(5) },
  { id: "mul", prompt: "Multiply 3 by 4.", answer: num(12) },
  { id: "pow", prompt: "Compute 2 to the power of 3.", answer: num(8) },
  { id: "monus", prompt: "Subtract 2 from 5. These are natural numbers, so subtraction stops at zero.", answer: num(3) },
  { id: "fact", prompt: "Compute the factorial of 3.", answer: num(6) },
  { id: "fib", prompt: "Compute the 6th Fibonacci number, where fib(0) = 0 and fib(1) = 1.", answer: num(8) },
  { id: "list", prompt: "Make the list [1, 2, 3].", answer: list(1, 2, 3) },
  { id: "length", prompt: "Compute the length of the list [4, 1, 7].", answer: num(3) },
  { id: "append", prompt: "Append the lists [1, 2] and [3].", answer: list(1, 2, 3) },
  { id: "sum", prompt: "Add up the numbers in the list [1, 2, 3].", answer: num(6) },
  { id: "reverse", prompt: "Reverse the list [1, 2, 3].", answer: list(3, 2, 1) },
  { id: "bool", prompt: "Compute not (true and false).", answer: bool(true) },
  { id: "even", prompt: "Is 4 even? Answer true or false.", answer: bool(true) },

  // The same small program on bigger numbers, which are deeper nests of brackets.
  ...[3, 5, 7, 9, 12, 16].map((n): Task => ({ id: `big-${n}`, prompt: `Compute the length of the list [${n}, ${n}].`, answer: num(2) })),

  // Harder: these need copying, comparing, or several helper agents working together.
  { id: "h-square", prompt: "Compute 3 squared, by multiplying the number by itself.", answer: num(9), again: { prompt: "Compute 4 squared.", answer: num(16) } },
  { id: "h-less", prompt: "Is 2 less than 3? Answer true or false.", answer: bool(true), again: { prompt: "Is 3 less than 2?", answer: bool(false) } },
  // Typing the list out twice takes 3 interactions; copying it takes at least 9.
  { id: "h-doublist", prompt: "Append the list [1, 2] to a copy of itself.", answer: list(1, 2, 1, 2), demands: { minInteractions: 9 }, again: { prompt: "Do the same with the list [3, 1].", answer: list(3, 1, 3, 1) } },
  { id: "h-max", prompt: "Find the largest number in the list [2, 5, 3].", answer: num(5), again: { prompt: "Find the largest number in [4, 1, 6, 2].", answer: num(6) } },
  { id: "h-filter", prompt: "Keep only the even numbers of the list [1, 2, 3, 4].", answer: list(2, 4), again: { prompt: "Do the same with the list [2, 5, 6, 7, 8].", answer: list(2, 6, 8) } },
  { id: "h-sort", prompt: "Sort the list [3, 1, 2] with insertion sort.", answer: list(1, 2, 3), again: { prompt: "Sort the list [2, 4, 1, 3].", answer: list(1, 2, 3, 4) } },
  { id: "h-div", prompt: "Divide 7 by 2, rounding down.", answer: num(3), again: { prompt: "Divide 9 by 4, rounding down.", answer: num(2) } },
  { id: "h-gcd", prompt: "Compute the greatest common divisor of 6 and 4.", answer: num(2), again: { prompt: "Compute the greatest common divisor of 9 and 6.", answer: num(3) } },
  { id: "h-primes", prompt: "List the prime numbers up to 10, in increasing order.", answer: list(2, 3, 5, 7), demands: { minInteractions: 20 }, again: { prompt: "List the prime numbers up to 15.", answer: list(2, 3, 5, 7, 11, 13) } },
  { id: "h-hofmap", prompt: "Write a generic map whose rules don't know what function it applies: the function is passed in as a net. Use it to double every number in [1, 2, 3].", answer: list(2, 4, 6), again: { prompt: "Use it to double every number in [3, 1].", answer: list(6, 2) } },
  // Possible under directions and types, but it takes a reversed duplicator and labelled duplicators.
  { id: "h-lambda", prompt: "Encode the lambda calculus as agents (application, abstraction, and sharing). Evaluate the Church numeral 2 applied to the Church numeral 2, then turn the resulting Church numeral into an ordinary number.", answer: num(4), demands: { needs: [{ what: "abstraction, with a variable and a body", agent: /^\s*agent\s+\S+\s+2\s.*(lam|abs|λ)|^\s*agent\s+(lam|abs|λ)\S*\s+2\s/i }, { what: "application, with an argument and a result", agent: /^\s*agent\s+\S+\s+2\s.*(app|@)|^\s*agent\s+(app|@)\S*\s+2\s/i }, { what: "sharing, with a reversed duplicator whose principal port gives and whose two other ports take", agent: /^\s*agent\s+\S+\s+2\s.*ports\s+\+\w+[^,]*,\s*-\w+[^,]*,\s*-\w+/i }] }, again: { prompt: "Evaluate the Church numeral 3 applied to the Church numeral 2.", answer: num(8) } },
];
