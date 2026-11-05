import { describe, expect, it } from "vitest";
import { examples } from "../core/examples";
import { free } from "../core/net";
import { parallelStep } from "../core/reduce";
import { arithmeticValue, carries, checkReading, compile, fold, formula, guess, parseShows, printShows, readingFor, regions, runAhead } from "./reading";

const example = (name: string) => {
  const ex = examples.find((e) => e.name === name)!;
  const sys = ex.system();
  return { sys, net: ex.net(sys), r: readingFor(sys) };
};

describe("reading data", () => {
  it("reads a chain of S ending in 0 as a number", () => {
    const { net, r } = example("3 + 2");
    expect(regions(net, r).map((g) => g.label).sort()).toEqual(["2", "3"]);
  });

  it("says where a number isn't finished", () => {
    const { net, sys, r } = example("3 + 2");
    parallelStep(net, sys);
    parallelStep(net, sys);
    expect(regions(net, r).map((g) => g.label)).toContain("2 + ·");
  });

  it("reads lists, with numbers inside them", () => {
    const { net, r } = example("Sort a list");
    expect(regions(net, r).map((g) => g.label)).toEqual(["[3, 1, 2, 0]"]);
  });

  it("leaves plain combinators alone, since they don't stand for anything", () => {
    const { net, sys, r } = example("Commutation");
    expect(guess(sys)).toEqual([]);
    expect(regions(net, r)).toEqual([]);
    expect(formula(net, r, free("a"))).toBe("?");
  });
});

describe("formulas", () => {
  it("reads a net as arithmetic, one step at a time", () => {
    const { net, sys, r } = example("3 + 2");
    const said: string[] = [];
    do said.push(formula(net, r, free("out")));
    while (parallelStep(net, sys).length);
    expect(said).toEqual(["3 + 2", "1 + (2 + 2)", "2 + (1 + 2)", "3 + (0 + 2)", "5"]);
  });

  it("isn't changed by copying", () => {
    const { net, sys, r } = example("Copy a number");
    do {
      expect(formula(net, r, free("a"))).toBe("2");
      expect(formula(net, r, free("b"))).toBe("2");
    } while (parallelStep(net, sys).length);
  });

  it("shows sharing as the thing shared", () => {
    const { net, r } = example("Square of a sum");
    expect(formula(net, r, free("out"))).toBe("(2 + 1) × (2 + 1)");
  });
});

describe("running ahead", () => {
  const answers: [string, Record<string, string>][] = [
    ["3 + 2", { out: "5" }],
    ["3 × 2", { out: "6" }],
    ["Square of a sum", { out: "9" }],
    ["Length of a list", { out: "3" }],
    ["Add two list lengths", { out: "5" }],
    ["One number, two calculations", { sum: "5", product: "6" }],
    ["Fibonacci: 6 → 8", { out: "8" }],
    ["Sort a list", { out: "[0, 1, 2, 3]" }],
    ["range(5)", { out: "[0, 1, 2, 3, 4]" }],
    ["Find the primes up to 7", { out: "[2, 3, 5, 7]" }],
    ["Map a function: x² + 1", { out: "[2, 5, 10]" }],
    ["Differentiate a formula, then run it", { out: "7" }],
  ];
  it.each(answers)("%s comes out right from the first step", (name, want) => {
    const { net, sys, r } = example(name);
    const a = runAhead(net, sys, r);
    expect(a.kind).toBe("done");
    if (a.kind === "done") expect(Object.fromEntries(a.ends)).toEqual(want);
  });

  it.each(examples.map((e) => e.name))("%s: the answer and the work left agree at every step", (name) => {
    const { net, sys, r } = example(name);
    const first = runAhead(net, sys, r);
    if (first.kind === "running") return;
    let done = 0;
    for (let i = 0; i < 80; i++) {
      const now = runAhead(net, sys, r);
      expect(now.kind).toBe(first.kind);
      if (now.kind === "running") return;
      expect(now.interactions).toBe(first.interactions - done);
      expect(now.ends).toEqual(first.ends);
      const fired = parallelStep(net, sys);
      if (!fired.length) break;
      done += fired.length;
    }
  });

  it("says when a net doesn't finish", () => {
    const { net, sys, r } = example("Runs forever");
    expect(runAhead(net, sys, r, 500).kind).toBe("running");
  });

  it("says what a wire will carry, whatever is beyond it", () => {
    const { net, sys, r } = example("Square of a sum");
    const seen = new Set([...net.wires.keys()].map((w) => carries(net, sys, r, w)));
    expect(seen).toContain("3"); // the sum, on its way to being copied
    expect(seen).toContain("9");
    expect(seen).toContain("2");
  });
});

describe("folding", () => {
  it.each(examples.map((e) => e.name))("%s: keeps every active pair and loose end at every step", (name) => {
    const { net, sys, r } = example(name);
    for (let i = 0; i < 40; i++) {
      const f = fold(net, sys, r);
      expect(f.net.activePairs().length).toBe(net.activePairs().length);
      expect([...f.net.free.keys()]).toEqual([...net.free.keys()]);
      expect(f.net.agents.size).toBeLessThanOrEqual(net.agents.size);
      expect(f.net.unconnected().length).toBe(net.unconnected().length);
      for (const g of f.folded.values()) expect(f.net.agent(g.root).wires.length - 1).toBe(g.holes.length);
      if (!parallelStep(net, sys).length) break;
    }
  });

  it("turns a finished number into one agent with no aux ports", () => {
    const { net, sys, r } = example("Copy a number");
    const end = net.clone();
    while (parallelStep(end, sys).length);
    const f = fold(end, sys, r);
    expect(f.net.agents.size).toBe(2);
    for (const a of f.net.agents.values()) expect(a.wires.length).toBe(1);
    void net;
  });

  it("keeps an agent in an active pair out of its number", () => {
    const { net, sys, r } = example("3 + 2");
    const f = fold(net, sys, r);
    // +, the S it's about to meet, the 2 under that S, and the 2 it adds.
    expect([...f.net.agents.values()].map((a) => f.sys.type(a.type).symbol).sort()).toEqual(["+", "2", "2", "S"]);
  });
});

describe("show lines", () => {
  const { sys } = example("3 + 2");

  it("round-trips", () => {
    const text = printShows(guess(sys), sys);
    expect(printShows(parseShows(text, sys).shows, sys)).toBe(text);
  });

  it("lets written lines replace guessed ones", () => {
    const { net } = example("3 + 2");
    const { shows } = parseShows('show + "add {0} and {2}" on 1', sys);
    expect(formula(net, readingFor(sys, shows), free("out"))).toBe("add 3 and 2");
  });

  it.each([
    ["show number Q 0", "no agent Q"],
    ["show number + 0", "needs one aux port"],
    ['show S "{4}"', "doesn't have"],
    ['show + "{1} and {2}" on 1', "in terms of port 1 itself"],
    ['show + "{2}" on 0', "takes rather than gives"],
    ['show δ "{1}" on 2', "gives rather than takes"],
    ["hello", "only show lines"],
  ])("says what's wrong with %s", (line, says) => {
    expect(parseShows(line, sys).problems[0]?.message).toContain(says);
  });
});

describe("catching a wrong reading", () => {
  it("does the sums", () => {
    expect(arithmeticValue("(2 + 1) × 3")).toBe(9);
    expect(arithmeticValue("1 + (2 × 2) - 1")).toBe(4);
    expect(arithmeticValue("F(3)")).toBeUndefined();
    expect(arithmeticValue("2 +")).toBeUndefined();
  });

  it.each(["3 + 2", "3 × 2", "Square of a sum", "One number, two calculations", "Add two list lengths"])("%s: a right reading passes", (name) => {
    const { net, sys, r } = example(name);
    expect(checkReading(net, sys, r)).toEqual([]);
  });

  it("catches a wrong one on the first step", () => {
    const { net, sys } = example("3 + 2");
    const wrong = compile([...guess(sys), ...parseShows('show + "{0} - {2}" on 1', sys).shows]);
    expect(checkReading(net, sys, wrong)[0]).toMatchObject({ step: 0, end: "out", said: "3 - 2", value: 1, ends: "5" });
  });

  it("catches a wrong one that only shows later", () => {
    const { net, sys } = example("3 × 2");
    const wrong = compile([...guess(sys), ...parseShows('show × "{0} × {0}" on 1', sys).shows]);
    expect(checkReading(net, sys, wrong).length).toBe(1);
  });
});
