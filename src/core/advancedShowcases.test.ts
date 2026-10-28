import { describe, expect, it } from "vitest";
import { differentiation, higherOrderMap, primeSieve } from "./advancedShowcases";
import { build, examples, f, Hole, link, t, type Spec } from "./examples";
import { type End, Net, free, port } from "./net";
import { normalize, parallelStep, redexes, type NormalizeOptions } from "./reduce";
import type { System } from "./system";
import { badWires, missing, ruleClashes } from "./types";

const num = (n: number): Spec => n === 0 ? t("0") : t("S", num(n - 1));
const list = (values: number[]): Spec => values.reduceRight((tail, n) => t("∷", num(n), tail), t("[]"));

function at(net: Net, end: End) {
  const p = net.partner(end);
  if (p?.kind !== "port" || p.slot !== 0) throw new Error("expected a value at its principal port");
  return net.agent(p.agent);
}

function readNumber(net: Net, end: End): number {
  let value = at(net, end);
  let n = 0;
  while (value.type === "S") {
    if (++n > net.agents.size) throw new Error("cyclic number");
    value = at(net, port(value.id, 1));
  }
  expect(value.type).toBe("0");
  return n;
}

function readList(net: Net): number[] {
  const values: number[] = [];
  let value = at(net, free("out"));
  while (value.type === "∷") {
    values.push(readNumber(net, port(value.id, 1)));
    if (values.length > net.agents.size) throw new Error("cyclic list");
    value = at(net, port(value.id, 2));
  }
  expect(value.type).toBe("[]");
  return values;
}

function finish(net: Net, sys: System, opts: NormalizeOptions = {}) {
  expect(net.unconnected()).toEqual([]);
  expect(badWires(net, sys).size).toBe(0);
  const result = normalize(net, sys, { limit: 10000, ...opts });
  expect(result.normal).toBe(true);
  expect(net.activePairs()).toEqual([]);
  expect(net.unconnected()).toEqual([]);
  expect(badWires(net, sys).size).toBe(0);
  expect([...net.free.keys()]).toEqual(["out"]);
  return result;
}

function expectList(net: Net, values: number[]) {
  expect(readList(net)).toEqual(values);
  // Every agent belongs to the result: no detached values or work left over.
  expect(net.agents.size).toBe(1 + values.length * 2 + values.reduce((a, b) => a + b, 0));
}

describe("advanced showcase systems", () => {
  it("defines complete rules that preserve port types", () => {
    for (const factory of [primeSieve, higherOrderMap, differentiation]) {
      const sys = factory();
      expect(missing(sys)).toEqual([]);
      for (const rule of sys.rules.values()) {
        expect(sys.validate(rule)).toEqual([]);
        expect(ruleClashes(sys, rule)).toEqual([]);
      }
    }
  });

  it("tests divisibility by positive divisors, including zero dividends and divisor one", () => {
    const sys = primeSieve();
    for (let divisor = 1; divisor <= 5; divisor++) for (let dividend = 0; dividend <= 12; dividend++) {
      const net = new Net();
      link(net, build(net, sys, num(dividend)), build(net, sys, t("Mod", f("out"), num(divisor), num(0))));
      finish(net, sys);
      expect(at(net, free("out")).type, `${dividend} % ${divisor}`).toBe(dividend % divisor === 0 ? "T" : "F");
      expect(net.agents.size).toBe(1);
    }
  });

  it("filters values rather than list positions", () => {
    const sys = primeSieve();
    const net = new Net();
    link(net, build(net, sys, list([2, 3, 4, 7, 9, 10, 12])), build(net, sys, t("Filter", f("out"), num(3))));
    finish(net, sys);
    expectList(net, [2, 4, 7, 10]);
  });

  it("sieves different bounds into one list of primes", () => {
    const sys = primeSieve();
    for (const bound of [1, 2, 4, 9, 12]) {
      const values = Array.from({ length: bound - 1 }, (_, i) => i + 2);
      const primes = values.filter((n) => !values.some((d) => d < n && n % d === 0));
      const net = new Net();
      link(net, build(net, sys, list(values)), build(net, sys, t("Sieve", f("out"))));
      finish(net, sys);
      expectList(net, primes);
    }
  });

  it("applies captured and composed functions in the specified order", () => {
    const sys = higherOrderMap();
    const functions: [Spec, (x: number) => number][] = [
      [t("Sq"), (x) => x * x],
      [t("Plus", num(3)), (x) => x + 3],
      [t("Then", t("Sq"), t("Plus", num(1))), (x) => x * x + 1],
      [t("Then", t("Plus", num(1)), t("Sq")), (x) => (x + 1) ** 2],
      [t("Then", t("Plus", num(1)), t("Then", t("Sq"), t("Plus", num(2)))), (x) => (x + 1) ** 2 + 2],
    ];
    for (const [fn, expected] of functions) for (const x of [0, 1, 3]) {
      const net = new Net();
      link(net, build(net, sys, fn), build(net, sys, t("Apply", f("out"), num(x))));
      finish(net, sys);
      expect(readNumber(net, free("out"))).toBe(expected(x));
      expect(net.agents.size).toBe(expected(x) + 1);
    }
  });

  it("maps function values, preserving captures and disposing of unused syntax", () => {
    const sys = higherOrderMap();
    for (const values of [[], [0], [1, 2, 1]]) {
      const net = new Net();
      const fn = t("Then", t("Plus", num(2)), t("Sq"));
      link(net, build(net, sys, list(values)), build(net, sys, t("Map", f("out"), fn)));
      finish(net, sys);
      expectList(net, values.map((x) => (x + 2) ** 2));
    }
  });

  it("produces symbolic syntax with the product rule before any numerical evaluation", () => {
    const sys = differentiation();
    const net = new Net();
    link(net, build(net, sys, t("Mul", t("X"), t("X"))), build(net, sys, t("D", f("out"))));
    finish(net, sys);
    const read = (end: End): string => {
      const value = at(net, end);
      if (value.type === "X") return "x";
      if (value.type === "K") return String(readNumber(net, port(value.id, 1)));
      expect(["Add", "Mul"]).toContain(value.type);
      return `(${read(port(value.id, 1))}${value.type === "Add" ? "+" : "*"}${read(port(value.id, 2))})`;
    };
    expect(read(free("out"))).toBe("((1*x)+(x*1))");
    expect(net.agents.size).toBe(11);
  });

  it("evaluates derivatives of constants, sums and products at different points", () => {
    const sys = differentiation();
    const cases: [Spec, (x: number) => number][] = [
      [t("K", num(4)), () => 0],
      [t("X"), () => 1],
      [t("Add", t("X"), t("K", num(2))), () => 1],
      [t("Mul", t("Add", t("X"), t("K", num(1))), t("Add", t("X"), t("K", num(2)))), (x) => 2 * x + 3],
      [t("Mul", t("Mul", t("X"), t("X")), t("X")), (x) => 3 * x * x],
    ];
    for (const [expression, expected] of cases) for (const x of [0, 2, 3]) {
      const net = new Net();
      const derivative = new Hole();
      link(net, build(net, sys, expression), build(net, sys, t("D", derivative)));
      link(net, derivative, build(net, sys, t("Eval", f("out"), num(x))));
      finish(net, sys);
      expect(readNumber(net, free("out"))).toBe(expected(x));
      expect(net.agents.size).toBe(expected(x) + 1);
    }
  });

  for (const strategy of ["parallel", "sequential"] as const) {
    it(`runs the menu examples using ${strategy} reduction`, () => {
      const demos = examples.filter((ex) => [primeSieve, higherOrderMap, differentiation].includes(ex.system));
      expect(demos).toHaveLength(3);
      for (const ex of demos) {
        const sys = ex.system();
        const net = ex.net(sys);
        finish(net, sys, { strategy, choose: (rs) => rs[rs.length - 1]! });
        if (ex.system === primeSieve) expectList(net, [2, 3, 5, 7]);
        if (ex.system === higherOrderMap) expectList(net, [2, 5, 10]);
        if (ex.system === differentiation) {
          expect(readNumber(net, free("out"))).toBe(7);
          expect(net.agents.size).toBe(8);
        }
      }
    });
  }

  it("keeps every intermediate state wired correctly while exposing parallel work", () => {
    for (const factory of [primeSieve, higherOrderMap, differentiation]) {
      const ex = examples.find((ex) => ex.system === factory)!;
      const sys = ex.system();
      const net = ex.net(sys);
      let widest = 0;
      let rounds = 0;
      while (redexes(net, sys).length) {
        widest = Math.max(widest, redexes(net, sys).length);
        parallelStep(net, sys);
        expect(net.unconnected()).toEqual([]);
        expect(badWires(net, sys).size).toBe(0);
        expect(++rounds).toBeLessThan(500);
      }
      expect(widest).toBeGreaterThan(1);
      expect(net.activePairs()).toEqual([]);
    }
  });
});
