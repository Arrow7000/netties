import { describe, expect, it } from "vitest";
import { examples } from "./examples";
import { free, port } from "./net";
import { arithmetic, directedCombinators, lists } from "./presets";
import { normalize } from "./reduce";
import { A, L } from "./system";
import { badWires, canMeet, clash, missing, ruleClashes } from "./types";

describe("directions and types", () => {
  it("every example's rules and net fit its types", () => {
    for (const ex of examples) {
      const sys = ex.system();
      for (const r of sys.rules.values()) expect(ruleClashes(sys, r), `${ex.name}: ${r.left} >< ${r.right}`).toEqual([]);
      expect(badWires(ex.net(sys), sys).size, ex.name).toBe(0);
      expect(missing(sys), ex.name).toEqual([]);
    }
  });

  it("joins a giver to a taker, and only matching types", () => {
    expect(clash({ pol: "give", type: "number" }, { pol: "take", type: "number" })).toBeUndefined();
    expect(clash({ pol: "give" }, { pol: "give" })?.kind).toBe("pol");
    expect(clash({ pol: "give", type: "number" }, { pol: "take", type: "list" })?.kind).toBe("type");
    // A port without a direction or type fits anything in that respect.
    expect(clash({ type: "number" }, { pol: "give", type: "number" })).toBeUndefined();
    expect(clash({}, { pol: "take", type: "list" })).toBeUndefined();
  });

  it("knows which pairs can never meet", () => {
    const sys = arithmetic();
    expect(canMeet(sys, "+", "×")?.kind).toBe("pol");
    expect(canMeet(sys, "0", "S")?.kind).toBe("pol");
    expect(canMeet(sys, "+", "S")).toBeUndefined();
    const d = directedCombinators();
    for (const t of d.types.keys()) expect(canMeet(d, t, t)).toBeDefined();
    expect(canMeet(lists(), "#", "S")?.kind).toBe("type");
  });

  it("doesn't fire a rule that breaks the types", () => {
    const sys = arithmetic();
    // 0 + y = y written wrongly: join the sum to zero's copy.
    sys.rules.delete("+|0");
    sys.addRule({ left: "+", right: "0", agents: ["0", "ε"], wires: [[A(0, 0), L(2)], [A(1, 0), L(1)]] });
    expect(sys.broken(sys.ruleFor("+", "0")!.rule)).toBe(true);
  });

  it("measures a list", () => {
    const ex = examples.find((e) => e.name === "Length of a list")!;
    const sys = ex.system();
    const net = ex.net(sys);
    expect(normalize(net, sys).normal).toBe(true);
    let n = 0;
    for (let p = net.partner(free("out")); p?.kind === "port" && net.agent(p.agent).type === "S"; p = net.partner(port(p.agent, 1))) n++;
    expect(n).toBe(3);
  });
});
