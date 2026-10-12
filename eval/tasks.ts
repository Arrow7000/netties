/** What the net on `out` should read back as. */
export type Answer = { kind: "number"; value: number } | { kind: "list"; value: number[] } | { kind: "bool"; value: boolean };

export interface Task {
  id: string;
  /** What a visitor would type. */
  prompt: string;
  answer: Answer;
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
];
