import { describe, expect, it } from "vitest";
import { build, examples, f, link, t, type Spec } from "./examples";
import { type End, Net, free, port } from "./net";
import { normalize, parallelStep, redexes, type NormalizeOptions } from "./reduce";
import { fibonacci, listSort, range } from "./showcaseSystems";
import type { System } from "./system";
import { badWires, missing, ruleClashes } from "./types";

const num = (n: number): Spec => n === 0 ? t("0") : t("S", num(n - 1));
const list = (values: number[]): Spec => values.reduceRight((tail, n) => t("∷", num(n), tail), t("[]"));

function readNumber(net: Net, root: End): number {
  let at = net.partner(root);
  let n = 0;
  while (at?.kind === "port" && at.slot === 0 && net.agent(at.agent).type === "S") {
    n++;
    if (n > net.agents.size) throw new Error("cyclic number");
    at = net.partner(port(at.agent, 1));
  }
  expect(at?.kind === "port" && at.slot === 0 && net.agent(at.agent).type).toBe("0");
  return n;
}

function readList(net: Net, name: string): number[] {
  const values: number[] = [];
  let at = net.partner(free(name));
  while (at?.kind === "port" && at.slot === 0 && net.agent(at.agent).type === "∷") {
    values.push(readNumber(net, port(at.agent, 1)));
    if (values.length > net.agents.size) throw new Error("cyclic list");
    at = net.partner(port(at.agent, 2));
  }
  expect(at?.kind === "port" && at.slot === 0 && net.agent(at.agent).type).toBe("[]");
  return values;
}

function finish(net: Net, sys: System, opts: NormalizeOptions = {}) {
  expect(net.unconnected()).toEqual([]);
  expect(badWires(net, sys).size).toBe(0);
  const result = normalize(net, sys, { limit: 5000, ...opts });
  expect(result.normal).toBe(true);
  // A normal form with an unimplemented active pair would be a stuck program.
  expect(net.activePairs()).toEqual([]);
  expect(net.unconnected()).toEqual([]);
  expect(badWires(net, sys).size).toBe(0);
  return result;
}

describe("flagship example systems", () => {
  it("has complete, type-correct local rules", () => {
    for (const factory of [fibonacci, listSort, range]) {
      const sys = factory();
      expect(missing(sys)).toEqual([]);
      for (const rule of sys.rules.values()) {
        expect(sys.validate(rule)).toEqual([]);
        expect(ruleClashes(sys, rule)).toEqual([]);
      }
    }
  });

  it("computes neighbouring Fibonacci values with one Fib type and rules for 0 and S", () => {
    const sys = fibonacci();
    expect([...sys.types.keys()].filter((id) => id.startsWith("Fib"))).toEqual(["Fib"]);
    expect([...sys.rules.values()].filter((rule) => rule.left === "Fib").map((rule) => rule.right)).toEqual(["0", "S"]);
    const answers = [0, 1, 1, 2, 3, 5, 8, 13];
    for (const [n, answer] of answers.slice(0, -1).entries()) {
      const net = new Net();
      link(net, build(net, sys, num(n)), build(net, sys, t("Fib", f("out"), f("next"))));
      finish(net, sys);
      expect(readNumber(net, free("out")), `fib(${n})`).toBe(answer);
      expect(readNumber(net, free("next")), `fib(${n + 1})`).toBe(answers[n + 1]);
      expect(net.agents.size).toBe(answer + answers[n + 1]! + 2);
    }
  });

  it("compares arbitrary numbers, including equal values and both zero cases", () => {
    const sys = listSort();
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
      const net = new Net();
      link(net, build(net, sys, num(a)), build(net, sys, t("↕", f("lo"), f("hi"), num(b))));
      finish(net, sys);
      expect(readNumber(net, free("lo"))).toBe(Math.min(a, b));
      expect(readNumber(net, free("hi"))).toBe(Math.max(a, b));
      expect(net.agents.size).toBe(a + b + 2);
    }
  });

  it("sorts lists of different lengths, preserving duplicates and returning only one list", () => {
    const sys = listSort();
    const cases = [[3, 1, 2, 0], [0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 1, 2, 0, 1]];
    // Every list of up to four items drawn from 0, 1 and 2, including [].
    for (let length = 0; length <= 4; length++) {
      for (let code = 0; code < 3 ** length; code++) {
        cases.push(Array.from({ length }, (_, i) => Math.floor(code / 3 ** i) % 3));
      }
    }
    for (const values of cases) {
      const net = new Net();
      link(net, build(net, sys, list(values)), build(net, sys, t("Sort", f("out"))));
      finish(net, sys);
      expect(readList(net, "out"), `sort(${values})`).toEqual([...values].sort((a, b) => a - b));
      expect([...net.free.keys()]).toEqual(["out"]);
      expect(net.agents.size).toBe(1 + values.length * 2 + values.reduce((a, b) => a + b, 0));
    }
  });

  it("leaves a source suspended until requested", () => {
    const sys = range();
    const net = new Net();
    link(net, build(net, sys, t("From", num(3))), free("stream"));
    expect(finish(net, sys).stats.interactions).toBe(0);
  });

  it("takes exactly the requested prefix, including zero items and a nonzero seed", () => {
    const sys = range();
    for (const count of [0, 1, 5]) {
      const net = new Net();
      link(net, build(net, sys, num(count)), build(net, sys, t("Take", f("out"), t("From", num(3)))));
      const result = finish(net, sys);
      const values = Array.from({ length: count }, (_, i) => 3 + i);
      expect(readList(net, "out")).toEqual(values);
      expect(result.stats.byRule.get("Pull|From") ?? 0).toBe(count);
      expect(result.stats.byRule.get("Stop|From")).toBe(1);
      expect(net.agents.size).toBe(1 + count * 2 + values.reduce((a, b) => a + b, 0));
    }
  });

  for (const strategy of ["parallel", "sequential"] as const) {
    it(`runs all three menu examples using ${strategy} reduction`, () => {
      const demos = examples.filter((ex) => [fibonacci, listSort, range].includes(ex.system));
      expect(demos).toHaveLength(3);
      for (const ex of demos) {
        const sys = ex.system();
        const net = ex.net(sys);
        const result = finish(net, sys, { strategy, choose: (rs) => rs[rs.length - 1]! });
        if (ex.system === fibonacci) {
          expect(readNumber(net, free("out"))).toBe(8);
          expect(net.agents.size).toBe(9);
        }
        if (ex.system === listSort) expect(readList(net, "out")).toEqual([0, 1, 2, 3]);
        if (ex.system === range) {
          expect(readList(net, "out")).toEqual([0, 1, 2, 3, 4]);
          expect(result.stats.byRule.get("Pull|From")).toBe(5);
        }
      }
    });
  }

  it("exposes parallel work and preserves valid wiring throughout each demo", () => {
    for (const factory of [fibonacci, listSort, range]) {
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
        expect(++rounds).toBeLessThan(100);
      }
      expect(widest).toBeGreaterThan(1);
      expect(net.activePairs()).toEqual([]);
    }
  });
});
