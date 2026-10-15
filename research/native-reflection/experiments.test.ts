import { describe, expect, it } from "vitest";
import { canonical } from "../../src/core/canon";
import { Net, free, port } from "../../src/core/net";
import { combinators } from "../../src/core/presets";
import { interact, redexes } from "../../src/core/reduce";
import { A, L, R, type Rule } from "../../src/core/system";
import { translation } from "../../src/core/translate";
import { aliasSystem, assertClosed, assertSealed, attach, duplicatorInput, expectedDuplicatorCopies, explore, exterior, hiddenAliasing, hiddenCycle, leafWiring, sameKindRuleSymmetric, sealedCore, treeDuplicatorSystem, walkerSystem, wiringObserverSystem } from "./mechanisms";

function renameOutput(net: ReturnType<typeof leafWiring>): void {
  const p = net.partner(free("out"))!;
  net.disconnect(net.wireAt(free("out")));
  net.removeFree("out");
  net.connect(free("value"), p);
}

describe("native reflection feasibility", () => {
  it("uses connected normal inputs with an exposed principal root", () => {
    for (const net of [hiddenCycle(1), hiddenCycle(3), hiddenAliasing(true), hiddenAliasing(false), leafWiring(true), leafWiring(false)]) {
      assertClosed(net);
      expect(net.activePairs()).toEqual([]);
      expect(net.partner(free("value"))?.kind).toBe("port");
      expect(canonical(net).split(" | ").slice(2)).toEqual([]);
    }
  });

  it("finds different sealed cycle lengths behind the same exterior", () => {
    const first = hiddenCycle(1);
    const second = hiddenCycle(3);
    expect(canonical(first)).not.toBe(canonical(second));
    expect(sealedCore(first).size).toBe(1);
    expect(sealedCore(second).size).toBe(3);
    expect(exterior(first, sealedCore(first))).toBe(exterior(second, sealedCore(second)));
  });

  it("puts actual aliasing and distinct equal cells behind the same two boundaries", () => {
    const shared = hiddenAliasing(true);
    const separate = hiddenAliasing(false);
    expect(canonical(shared)).not.toBe(canonical(separate));
    const sharedRoot = shared.partner(free("value"));
    const separateRoot = separate.partner(free("value"));
    if (sharedRoot?.kind !== "port" || separateRoot?.kind !== "port") throw new Error("missing roots");
    const a = shared.partner(port(sharedRoot.agent, 1));
    const b = shared.partner(port(sharedRoot.agent, 2));
    expect(a?.kind === "port" && b?.kind === "port" && a.agent === b.agent).toBe(true);
    const c = separate.partner(port(separateRoot.agent, 1));
    const d = separate.partner(port(separateRoot.agent, 2));
    expect(c?.kind === "port" && d?.kind === "port" && c.agent !== d.agent).toBe(true);
    expect(exterior(shared, sealedCore(shared))).toBe(exterior(separate, sealedCore(separate)));
  });

  it("the existing nonidentity Lafont translation preserves the aliasing blind spot", () => {
    const sys = aliasSystem();
    const tr = translation(sys);
    expect(tr.identity).toBe(false);
    const views: string[] = [];
    const sizes: number[] = [];
    for (const shared of [true, false]) {
      const source = hiddenAliasing(shared, sys);
      const core = sealedCore(source);
      const target = tr.net(source);
      const protectedIds = new Set([...target.tagOf].filter(([, owner]) => core.has(owner)).map(([id]) => id));
      assertClosed(target.net);
      assertSealed(target.net, protectedIds);
      expect(protectedIds).toEqual(sealedCore(target.net));
      expect(target.net.activePairs()).toEqual([]);
      sizes.push(target.net.agents.size);
      views.push(exterior(target.net, protectedIds));
    }
    expect(sizes[0]).not.toBe(sizes[1]);
    expect(views[0]).toBe(views[1]);
  });

  it("preserves sealed cores for every explored IC observer schedule", () => {
    for (const type of ["γ", "δ", "ε"]) {
      const sys = combinators();
      const projections: string[][] = [];
      for (const length of [1, 3]) {
        const net = hiddenCycle(length, sys);
        const core = sealedCore(net);
        attach(net, sys, type);
        const result = explore(net, sys, 12);
        expect(result.frontier).toBe(0);
        expect(result.finished.length).toBeGreaterThan(0);
        projections.push(result.finished.map(({ net }) => exterior(net, core)).sort());
      }
      expect(projections[0]).toEqual(projections[1]);
    }
  });

  it("can distinguish accessible graph wiring by actual internal interactions", () => {
    const sys = wiringObserverSystem();
    for (const crossed of [false, true]) {
      const net = leafWiring(crossed, sys);
      attach(net, sys, "Inspect");
      const result = explore(net, sys);
      expect(result.frontier).toBe(0);
      expect(result.finished).toHaveLength(1);
      const output = result.finished[0]!.net;
      expect([...output.agents.values()].filter((a) => a.type === (crossed ? "Cross" : "Same"))).toHaveLength(4);
      expect([...output.agents.values()].some((a) => a.type === (crossed ? "Same" : "Cross"))).toBe(false);
    }
  });

  it("quotes and reconstructs cyclic leaf wirings without unfolding them", () => {
    const sys = walkerSystem();
    const codes: string[] = [];
    for (const crossed of [false, true]) {
      const original = leafWiring(crossed, sys);
      const net = original.clone();
      attach(net, sys, "Quote");
      const result = explore(net, sys);
      expect(result.frontier).toBe(0);
      expect(result.finished).toHaveLength(1);
      const quoted = result.finished[0]!.net;
      expect([...quoted.agents.values()].every((a) => a.type === "Viewγ")).toBe(true);
      expect(quoted.agents.size).toBe(original.agents.size);
      codes.push(canonical(quoted));
      renameOutput(quoted);
      attach(quoted, sys, "Run");
      const reconstructed = explore(quoted, sys);
      expect(reconstructed.frontier).toBe(0);
      expect(reconstructed.finished).toHaveLength(1);
      const final = reconstructed.finished[0]!.net;
      renameOutput(final);
      expect(canonical(final)).toBe(canonical(original));
    }
    expect(codes[0]).not.toBe(codes[1]);
  });

  it("the same quote mechanism cannot enter buried principal cycles", () => {
    const sys = walkerSystem();
    for (const length of [1, 3, 5]) {
      const net = hiddenCycle(length, sys);
      const core = sealedCore(net);
      attach(net, sys, "Quote");
      const result = explore(net, sys);
      expect(result.frontier).toBe(0);
      expect(result.finished).toHaveLength(1);
      const output = result.finished[0]!.net;
      assertSealed(output, core);
      expect([...output.agents.values()].filter((a) => a.type === "Quote")).toHaveLength(1);
      expect([...output.agents.values()].filter((a) => a.type === "γ")).toHaveLength(length);
    }
  });

  it("exposes why a same-kind rule cannot secretly choose which cell is data", () => {
    const sys = walkerSystem().addType({ id: "ViewQuote", name: "view of Quote", symbol: "VQ", arity: 1 });
    const invalidNativeInspection: Rule = { left: "Quote", right: "Quote", agents: ["ViewQuote"], wires: [[A(0, 0), L(1)], [A(0, 1), R(1)]] };
    expect(sys.validate(invalidNativeInspection)).toEqual([]);
    expect(sameKindRuleSymmetric(sys, invalidNativeInspection)).toBe(false);
    for (const rule of sys.rules.values()) expect(sameKindRuleSymmetric(sys, rule)).toBe(true);
  });

  it("the sealed witness survives the enabled IC copy interaction", () => {
    const sys = aliasSystem();
    const net = hiddenAliasing(true, sys);
    const core = sealedCore(net);
    attach(net, sys, "δ");
    for (const wire of redexes(net, sys)) {
      const next = net.clone();
      const record = interact(next, sys, wire);
      expect(record.removed.every((id) => !core.has(id))).toBe(true);
      assertSealed(next, core);
      assertClosed(next);
    }
  });

  it("the quote walker does not inspect its own symbol as ordinary input data", () => {
    const sys = walkerSystem();
    const net = new Net();
    const q = net.addAgent(sys.type("Quote"));
    const cap = net.addAgent(sys.type("ε"));
    net.connect(free("value"), port(q, 0));
    net.connect(port(q, 1), port(cap, 0));
    attach(net, sys, "Quote");
    const result = explore(net, sys);
    expect(result.frontier).toBe(0);
    expect(result.finished).toHaveLength(1);
    expect([...result.finished[0]!.net.agents.values()].map((a) => a.type)).toEqual(["ε"]);
  });

  it("self-commutation duplicates a tree containing the duplicator", () => {
    const sys = treeDuplicatorSystem();
    const net = duplicatorInput(false, sys);
    attach(net, sys, "δ");
    const result = explore(net, sys);
    expect(result.frontier).toBe(0);
    expect(result.finished).toHaveLength(1);
    expect(canonical(result.finished[0]!.net)).toBe(canonical(expectedDuplicatorCopies(false, sys)));
    expect(sameKindRuleSymmetric(sys, sys.ruleFor("δ", "δ")!.rule)).toBe(true);
  });

  it("the same valid rule fails on a one-cell package with an auxiliary loop", () => {
    const sys = treeDuplicatorSystem();
    const net = duplicatorInput(true, sys);
    expect(sealedCore(net).size).toBe(0);
    attach(net, sys, "δ");
    const result = explore(net, sys);
    expect(result.frontier).toBe(0);
    expect(result.finished).toHaveLength(1);
    const output = result.finished[0]!.net;
    expect(output.agents.size).toBe(6);
    expect(canonical(output)).not.toBe(canonical(expectedDuplicatorCopies(true, sys)));
  });
});
