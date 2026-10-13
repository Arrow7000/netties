import { type End, Net, free, port } from "./net";
import { arithmetic, combinators, directedCombinators, listArithmetic, lists, typingLab } from "./presets";
import { System } from "./system";

/**
 * A small helper for writing nets as trees: `t("S", t("0"))` is the agent
 * S whose aux port holds 0. Aux arguments are subtrees, free ports (`f("x")`),
 * or `Hole`s to wire up later.
 */
export type Spec = { type: string; aux: Arg[] };
export type Arg = Spec | { free: string } | Hole;
export class Hole {
  end?: End;
}

export const t = (type: string, ...aux: Arg[]): Spec => ({ type, aux });
export const f = (name: string) => ({ free: name });

/** Build a tree and return its principal port. */
export function build(net: Net, sys: System, spec: Spec): End {
  const id = net.addAgent(sys.type(spec.type));
  spec.aux.forEach((arg, i) => {
    const p = port(id, i + 1);
    if (arg instanceof Hole) arg.end = p;
    else if ("free" in arg) net.connect(p, free(arg.free));
    else net.connect(p, build(net, sys, arg));
  });
  return port(id, 0);
}

/** Wire two holes (or ends) together. */
export function link(net: Net, a: Hole | End, b: Hole | End) {
  const ea = a instanceof Hole ? a.end! : a;
  const eb = b instanceof Hole ? b.end! : b;
  net.connect(ea, eb);
}

export interface Example {
  name: string;
  /** One line on what it shows. */
  about: string;
  /** A larger net with several interactions, shown after the introductory examples. */
  showcase?: boolean;
  system: () => System;
  net: (sys: System) => Net;
}

const num = (n: number): Spec => (n === 0 ? t("0") : t("S", num(n - 1)));

const tokenSystem = () => new System().addType({ id: "A", name: "token", symbol: "A", arity: 0 });
const annihilatingTokens = () => tokenSystem().addRule({ left: "A", right: "A", agents: [], wires: [] });
const combinatorsWithoutCommutation = () => {
  const sys = combinators();
  sys.rules.delete("δ|γ");
  return sys;
};

/** Small translation examples kept here for comparison; enable in `examples` below. */
export const smallTranslationExamples: Example[] = [
  {
    name: "One token, no rules",
    about: "The smallest system: one zero-port token, with no interactions. Compare both translations.",
    system: tokenSystem,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("A")), free("x"));
      return net;
    },
  },
  {
    name: "Two annihilating tokens",
    about: "A minimal interaction: two tokens meet and disappear. Compare both translations.",
    system: annihilatingTokens,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("A")), build(net, sys, t("A")));
      return net;
    },
  },
  {
    name: "Erasing without commutation",
    about: "Erase a γ tree in the recursion-free combinator system without the γ–δ rule.",
    system: combinatorsWithoutCommutation,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("ε")), build(net, sys, t("γ", t("ε"), t("ε"))));
      return net;
    },
  },
];

export const examples: Example[] = [
  {
    name: "Commutation",
    about: "A constructor meets a duplicator, and each one gets copied.",
    system: combinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("γ", f("a"), f("b"))), build(net, sys, t("δ", f("c"), f("d"))));
      return net;
    },
  },
  {
    name: "Erasing a tree",
    about: "An eraser takes apart a tree of constructors.",
    system: combinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("ε")), build(net, sys, t("γ", t("δ", f("a"), f("b")), t("γ", f("c"), t("ε")))));
      return net;
    },
  },
  {
    name: "Copying a feedback loop",
    about: "A duplicator copies a small loop, then the reduction stops.",
    system: combinators,
    net: (sys) => {
      // A γ whose aux ports are joined, copied by a δ.
      const net = new Net();
      const x = new Hole();
      const y = new Hole();
      link(net, build(net, sys, t("γ", x, y)), build(net, sys, t("δ", f("a"), f("b"))));
      link(net, x, y);
      return net;
    },
  },
  {
    name: "Runs forever",
    about: "Lafont's figure 3: the net comes back to itself after four steps.",
    system: combinators,
    net: (sys) => {
      // Lafont's Fig. 3: reduces to itself in four steps.
      const net = new Net();
      const x = new Hole();
      const y = new Hole();
      link(net, build(net, sys, t("γ", x, t("ε"))), build(net, sys, t("δ", t("ε"), y)));
      link(net, x, y);
      return net;
    },
  },
  // ...smallTranslationExamples,
  {
    name: "Directed commutation",
    about: "Lafont's directed combinators: γ meets δ*, and each one gets copied.",
    system: directedCombinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("γ", f("a"), f("b"))), build(net, sys, t("δ*", f("c"), f("d"))));
      return net;
    },
  },
  {
    name: "Directed annihilation",
    about: "A constructor meets its starred twin; their four branches reconnect.",
    system: directedCombinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("γ", f("a"), f("b"))), build(net, sys, t("γ*", f("c"), f("d"))));
      return net;
    },
  },
  {
    name: "3 + 2",
    about: "Unary arithmetic: adding two numbers.",
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, num(3)), build(net, sys, t("+", f("out"), num(2))));
      return net;
    },
  },
  {
    name: "3 × 2",
    about: "Unary arithmetic: multiplication by repeated addition.",
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, num(3)), build(net, sys, t("×", f("out"), num(2))));
      return net;
    },
  },
  {
    name: "Copy a number",
    about: "A typed duplicator makes two copies of the same unary number.",
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, num(2)), build(net, sys, t("δ", f("a"), f("b"))));
      return net;
    },
  },
  {
    name: "Length of a list",
    about: "Numbers and lists are different types; # counts the items in a list.",
    system: lists,
    net: (sys) => {
      const net = new Net();
      const list = t("∷", t("0"), t("∷", t("S", t("0")), t("∷", t("0"), t("[]"))));
      link(net, build(net, sys, t("#", f("out"))), build(net, sys, list));
      return net;
    },
  },
  {
    name: "Try three types",
    about: "Wire [] to #, 0 to Z?, and T to ¬; try wrong types too, then Run.",
    system: typingLab,
    net: (sys) => {
      const net = new Net();
      for (const type of ["0", "S", "[]", "∷", "T"]) net.addAgent(sys.type(type));
      build(net, sys, t("#", f("length")));
      build(net, sys, t("Z?", f("zero?")));
      build(net, sys, t("¬", f("answer")));
      return net;
    },
  },
  {
    name: "Complete a typed if",
    about: "Connect [] to #, then 1 and 2 to if's true/false branches. Run chooses 1.",
    system: typingLab,
    net: (sys) => {
      const net = new Net();
      const length = new Hole();
      const isEmpty = new Hole();
      const whenTrue = new Hole();
      const whenFalse = new Hole();
      build(net, sys, t("[]"));
      build(net, sys, t("#", length));
      link(net, length, build(net, sys, t("Z?", isEmpty)));
      link(net, isEmpty, build(net, sys, t("if", f("out"), whenTrue, whenFalse)));
      build(net, sys, num(1));
      build(net, sys, num(2));
      return net;
    },
  },
  {
    name: "Two lengths, one list",
    about: "A list is copied, then both copies are measured independently.",
    showcase: true,
    system: lists,
    net: (sys) => {
      const net = new Net();
      const list = t("∷", num(1), t("∷", t("0"), t("[]")));
      link(net, build(net, sys, list), build(net, sys, t("δ", t("#", f("a")), t("#", f("b")))));
      return net;
    },
  },
  {
    name: "Square of a sum",
    about: "Add 2 and 1, copy the result, then multiply the copies: (2 + 1)².",
    showcase: true,
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      const sum = new Hole();
      const a = new Hole();
      const b = new Hole();
      const secondFactor = new Hole();
      link(net, build(net, sys, num(2)), build(net, sys, t("+", sum, num(1))));
      link(net, sum, build(net, sys, t("δ", a, b)));
      link(net, a, build(net, sys, t("×", f("out"), secondFactor)));
      link(net, b, secondFactor);
      return net;
    },
  },
  {
    name: "Directed cascade",
    about: "A branching γ–δ* clash exposes more directed interactions downstream.",
    showcase: true,
    system: directedCombinators,
    net: (sys) => {
      const net = new Net();
      const plain = t("γ", t("γ", f("a"), f("b")), t("δ", f("c"), f("d")));
      const starred = t("δ*", t("γ*", f("e"), f("f")), t("δ*", f("g"), f("h")));
      link(net, build(net, sys, plain), build(net, sys, starred));
      return net;
    },
  },
  {
    name: "One number, two calculations",
    about: "Copy 3, then add 2 on one branch and multiply by 2 on the other.",
    showcase: true,
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      const addInput = new Hole();
      const multiplyInput = new Hole();
      link(net, build(net, sys, num(3)), build(net, sys, t("δ", addInput, multiplyInput)));
      link(net, addInput, build(net, sys, t("+", f("sum"), num(2))));
      link(net, multiplyInput, build(net, sys, t("×", f("product"), num(2))));
      return net;
    },
  },
  {
    name: "Add two list lengths",
    about: "Measure two different lists, then add their lengths to get 5.",
    showcase: true,
    system: listArithmetic,
    net: (sys) => {
      const net = new Net();
      const firstLength = new Hole();
      const secondLength = new Hole();
      const secondAddend = new Hole();
      const first = t("∷", num(1), t("∷", num(2), t("[]")));
      const second = t("∷", num(2), t("∷", num(1), t("∷", t("0"), t("[]"))));
      link(net, build(net, sys, first), build(net, sys, t("#", firstLength)));
      link(net, build(net, sys, second), build(net, sys, t("#", secondLength)));
      link(net, firstLength, build(net, sys, t("+", f("out"), secondAddend)));
      link(net, secondLength, secondAddend);
      return net;
    },
  },
];
