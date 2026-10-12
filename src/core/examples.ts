import { type End, Net, free, port } from "./net";
import { arithmetic, combinators, directedCombinators, lists } from "./presets";
import type { System } from "./system";

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
  system: () => System;
  net: (sys: System) => Net;
}

const num = (n: number): Spec => (n === 0 ? t("0") : t("S", num(n - 1)));

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
    name: "Duplicating a loop",
    about: "A duplicator copies a net that loops back on itself.",
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
    name: "Directed erasing",
    about: "Lafont's directed combinators: ε takes apart a tree of starred agents.",
    system: directedCombinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("ε")), build(net, sys, t("γ*", t("δ*", f("a"), f("b")), t("ε*"))));
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
    name: "Other directed commutation",
    about: "The dual case: δ meets γ*, copying each across the other's branches.",
    system: directedCombinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("δ", f("a"), f("b"))), build(net, sys, t("γ*", f("c"), f("d"))));
      return net;
    },
  },
  {
    name: "Co-erasing a tree",
    about: "A starred eraser travels through ordinary constructors and duplicators.",
    system: directedCombinators,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("ε*")), build(net, sys, t("γ", t("δ", f("a"), f("b")), t("ε"))));
      return net;
    },
  },
  {
    name: "2 × 2",
    about: "Unary arithmetic: multiplication, done by repeated addition.",
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, num(2)), build(net, sys, t("×", f("out"), num(2))));
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
    name: "0 × 3",
    about: "Multiplying by zero erases the other number.",
    system: arithmetic,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("0")), build(net, sys, t("×", f("out"), num(3))));
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
    name: "Length of an empty list",
    about: "The empty list has type list; its length is the number zero.",
    system: lists,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("#", f("out"))), build(net, sys, t("[]")));
      return net;
    },
  },
  {
    name: "Erase a mixed list",
    about: "A type-flexible eraser removes both a list and its number items.",
    system: lists,
    net: (sys) => {
      const net = new Net();
      link(net, build(net, sys, t("ε")), build(net, sys, t("∷", num(2), t("∷", t("0"), t("[]")))));
      return net;
    },
  },
];
