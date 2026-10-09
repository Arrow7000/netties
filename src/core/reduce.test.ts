import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { type End, Net, free, port } from "./net";
import { arithmetic, combinators, directedCombinators } from "./presets";
import { interact, normalize, parallelStep } from "./reduce";
import { A, L, R, type System } from "./system";

/** Two agents facing each other, their aux ports wired to free ports x1.. and y1.. */
function pair(sys: System, left: string, right: string) {
  const net = new Net();
  const a = net.addAgent(sys.type(left));
  const b = net.addAgent(sys.type(right));
  const w = net.connect(port(a, 0), port(b, 0));
  for (let i = 1; i <= sys.type(left).arity; i++) net.connect(port(a, i), free(`x${i}`));
  for (let i = 1; i <= sys.type(right).arity; i++) net.connect(port(b, i), free(`y${i}`));
  return { net, a, b, w };
}

const partnerName = (net: Net, name: string) => {
  const p = net.partner(free(name));
  return p?.kind === "free" ? p.name : p ? net.agent(p.agent).type + p.slot : undefined;
};

describe("combinators", () => {
  const sys = combinators();

  it("γγ annihilates with straight wires, exchanging the ports", () => {
    const { net, w } = pair(sys, "γ", "γ");
    interact(net, sys, w);
    expect(net.agents.size).toBe(0);
    expect(partnerName(net, "x1")).toBe("y2");
    expect(partnerName(net, "x2")).toBe("y1");
  });

  it("δδ annihilates with crossed wires", () => {
    const { net, w } = pair(sys, "δ", "δ");
    interact(net, sys, w);
    expect(partnerName(net, "x1")).toBe("y1");
    expect(partnerName(net, "x2")).toBe("y2");
  });

  it("reproduces Lafont's nonterminating net (Fig. 3) in four steps", () => {
    const net = new Net();
    const g = net.addAgent(sys.type("γ"));
    const d = net.addAgent(sys.type("δ"));
    const e1 = net.addAgent(sys.type("ε"));
    const e2 = net.addAgent(sys.type("ε"));
    const w = net.connect(port(g, 0), port(d, 0));
    net.connect(port(g, 2), port(e1, 0));
    net.connect(port(d, 1), port(e2, 0));
    net.connect(port(g, 1), port(d, 2));
    const start = canonical(net);
    interact(net, sys, w);
    // As in the figure: the erasers go first.
    const isEps = (e: End) => e.kind === "port" && net.agent(e.agent).type === "ε";
    for (let i = 0; i < 3; i++) {
      const rs = net.activePairs();
      const both = rs.find((r) => net.wire(r).ends.every(isEps));
      const one = rs.find((r) => net.wire(r).ends.some(isEps));
      interact(net, sys, (both ?? one ?? rs[0])!);
    }
    expect(canonical(net)).toBe(start);
  });

  it("ε erases γ by propagating", () => {
    const { net, w } = pair(sys, "ε", "γ");
    interact(net, sys, w);
    expect(net.agents.size).toBe(2);
    expect(partnerName(net, "y1")).toBe("ε0");
    expect(partnerName(net, "y2")).toBe("ε0");
  });

  it("applies rules written the other way round", () => {
    const { net, w } = pair(sys, "γ", "ε");
    interact(net, sys, w);
    expect(partnerName(net, "x1")).toBe("ε0");
    expect(partnerName(net, "x2")).toBe("ε0");
  });

  it("γδ commutes", () => {
    const { net, w } = pair(sys, "γ", "δ");
    interact(net, sys, w);
    expect(net.agents.size).toBe(4);
    // Copies of δ land on γ's aux wires and vice versa.
    expect([partnerName(net, "x1"), partnerName(net, "x2")]).toEqual(["δ0", "δ0"]);
    expect([partnerName(net, "y1"), partnerName(net, "y2")]).toEqual(["γ0", "γ0"]);
    expect(net.unconnected()).toEqual([]);
    expect(net.activePairs()).toEqual([]);
  });

  it("keeps wire identity through annihilation", () => {
    const { net, w } = pair(sys, "γ", "γ");
    const before = net.wireAt(free("x1"));
    const y2 = net.wireAt(free("y2"));
    const rec = interact(net, sys, w);
    const after = net.wireAt(free("x1"));
    expect(after).toBe(before);
    expect(rec.createdWires.find((c) => c.id === after)?.from).toContain(y2);
    expect(rec.removedWires).not.toContain(after);
  });

  it("follows chains through the pair's own aux ports", () => {
    // γ with its two aux ports joined, meeting ε: the two new erasers meet
    // each other, then vanish.
    const net = new Net();
    const g = net.addAgent(sys.type("γ"));
    const e = net.addAgent(sys.type("ε"));
    const w = net.connect(port(g, 0), port(e, 0));
    net.connect(port(g, 1), port(g, 2));
    interact(net, sys, w);
    expect(net.activePairs()).toHaveLength(1);
    expect(normalize(net, sys).normal).toBe(true);
    expect(net.agents.size).toBe(0);
    expect(net.wires.size).toBe(0);
  });
});

describe("directed combinators", () => {
  const sys = directedCombinators();

  it("has no symbol that meets itself", () => {
    for (const t of sys.types.keys()) expect(sys.ruleFor(t, t)).toBeUndefined();
    expect(sys.rules.size).toBe(9);
  });

  it("γδ* commutes, each copy keeping its type", () => {
    const { net, w } = pair(sys, "γ", "δ*");
    interact(net, sys, w);
    expect([partnerName(net, "x1"), partnerName(net, "x2")]).toEqual(["δ*0", "δ*0"]);
    expect([partnerName(net, "y1"), partnerName(net, "y2")]).toEqual(["γ0", "γ0"]);
    expect(net.unconnected()).toEqual([]);
  });

  it("γγ* annihilates with straight wires", () => {
    const { net, w } = pair(sys, "γ", "γ*");
    interact(net, sys, w);
    expect([partnerName(net, "x1"), partnerName(net, "x2")]).toEqual(["y2", "y1"]);
  });
});

describe("arithmetic", () => {
  const sys = arithmetic();

  const num = (net: Net, n: number): End => {
    let top = port(net.addAgent(sys.type("0")), 0);
    for (let i = 0; i < n; i++) {
      const s = net.addAgent(sys.type("S"));
      net.connect(port(s, 1), top);
      top = port(s, 0);
    }
    return top;
  };

  const readNum = (net: Net, name: string): number => {
    let n = 0;
    let p = net.partner(free(name));
    while (p?.kind === "port" && net.agent(p.agent).type === "S") {
      n++;
      p = net.partner(port(p.agent, 1));
    }
    expect(p?.kind === "port" && net.agent(p.agent).type).toBe("0");
    return n;
  };

  const binop = (op: string, x: number, y: number) => {
    const net = new Net();
    const o = net.addAgent(sys.type(op));
    net.connect(port(o, 0), num(net, x));
    net.connect(port(o, 1), free("out"));
    net.connect(port(o, 2), num(net, y));
    expect(normalize(net, sys).normal).toBe(true);
    return readNum(net, "out");
  };

  it("adds", () => expect(binop("+", 2, 2)).toBe(4));
  it("multiplies", () => expect(binop("×", 2, 3)).toBe(6));
  it("multiplies by zero, erasing the other argument", () => expect(binop("×", 0, 5)).toBe(0));
});

describe("rules", () => {
  it("rejects right-hand sides that leave ports unconnected", () => {
    const sys = combinators();
    expect(() => sys.addRule({ left: "γ", right: "ε", agents: ["ε"], wires: [[A(0, 0), L(1)]] })).toThrow(
      /unconnected/,
    );
    expect(() => sys.addRule({ left: "γ", right: "γ", agents: [], wires: [[L(1), R(1)], [L(1), R(2)]] })).toThrow();
  });
});

describe("reduction order", () => {
  const sys = combinators();
  const types = ["γ", "δ", "ε"];

  /** A random closed-off combinator net: random agents, ports paired up at random, the leftovers free. */
  const arbNet = fc
    .record({
      agents: fc.array(fc.constantFrom(...types), { minLength: 1, maxLength: 12 }),
      shuffle: fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
      frees: fc.integer({ min: 0, max: 4 }),
    })
    .map(({ agents, shuffle, frees }) => {
      const net = new Net();
      const ends: End[] = [];
      for (const t of agents) {
        const id = net.addAgent(sys.type(t));
        for (let s = 0; s <= sys.type(t).arity; s++) ends.push(port(id, s));
      }
      for (let i = 0; i < frees || ends.length % 2; i++) ends.push(free(`f${i}`));
      for (let i = ends.length - 1; i > 0; i--) {
        const j = (shuffle[i % shuffle.length] ?? 0) % (i + 1);
        [ends[i], ends[j]] = [ends[j]!, ends[i]!];
      }
      for (let i = 0; i < ends.length; i += 2) net.connect(ends[i]!, ends[i + 1]!);
      return net;
    });

  it("parallel and sequential reduction agree (strong confluence)", () => {
    let checked = 0;
    fc.assert(
      fc.property(arbNet, fc.array(fc.nat(), { minLength: 1 }), (net, picks) => {
        const par = net.clone();
        const seq = net.clone();
        const limit = 300;
        const p = normalize(par, sys, { strategy: "parallel", limit });
        let i = 0;
        const s = normalize(seq, sys, {
          strategy: "sequential",
          limit,
          choose: (rs) => rs[picks[i++ % picks.length]! % rs.length]!,
        });
        if (!p.normal || !s.normal) return;
        expect(canonical(seq)).toBe(canonical(par));
        expect(s.stats.interactions).toBe(p.stats.interactions);
        if (p.stats.interactions > 0) checked++;
      }),
      { numRuns: 300 },
    );
    // Make sure the property wasn't vacuous.
    expect(checked).toBeGreaterThan(100);
  });

  it("parallel steps fire every active pair", () => {
    const { net } = pair(sys, "γ", "γ");
    // Put a second active pair into the same net.
    const d1 = net.addAgent(sys.type("δ"));
    const d2 = net.addAgent(sys.type("δ"));
    net.connect(port(d1, 0), port(d2, 0));
    net.connect(port(d1, 1), port(d2, 1));
    net.connect(port(d1, 2), port(d2, 2));
    expect(net.activePairs()).toHaveLength(2);
    expect(parallelStep(net, sys)).toHaveLength(2);
    expect(net.activePairs()).toHaveLength(0);
  });
});
