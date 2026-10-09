import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { examples } from "./examples";
import { free, port } from "./net";
import { normalize } from "./reduce";
import { ruleToNet } from "./ruleNet";
import { ParseError, parse, print } from "./text";

describe("text format", () => {
  it("round-trips every example, rules and all", () => {
    for (const ex of examples) {
      const sys = ex.system();
      const net = ex.net(sys);
      const text = print(sys, net, ex.name);
      const back = parse(text);
      expect(canonical(back.net)).toBe(canonical(net));
      expect([...back.system.types.keys()]).toEqual([...sys.types.keys()]);
      for (const r of sys.rules.values()) {
        const found = back.system.ruleFor(r.left, r.right);
        expect(found?.swapped).toBe(false);
        expect(canonical(ruleToNet(back.system, found!.rule))).toBe(canonical(ruleToNet(sys, r)));
      }
    }
  });

  it("reads Inpla-style programs", () => {
    const { system, net } = parse(`
      // addition, Inpla style: capitalised names are agents
      Add(r, y) >< Z => r ~ y;
      Add(r, y) >< S(x) => r ~ S(w), x ~ Add(w, y);
      Add(r, S(Z)) ~ S(S(Z));
    `);
    expect([...system.types.keys()].sort()).toEqual(["Add", "S", "Z"]);
    expect(normalize(net, system).normal).toBe(true);
    let n = 0;
    for (let p = net.partner(free("r")); p?.kind === "port" && net.agent(p.agent).type === "S"; p = net.partner(port(p.agent, 1))) n++;
    expect(n).toBe(3);
  });

  it("wires names joined to each other", () => {
    const { net } = parse(`agent A 1\n A(a) ~ A(b), a ~ c, c ~ b;`);
    expect(net.unconnected()).toEqual([]);
    expect(net.free.size).toBe(0);
  });

  it("points at the line of a mistake", () => {
    expect(() => parse("A(x) >< B => y ~ x;")).toThrow(ParseError);
    try {
      parse("agent A 1\n\nA(x) >< A(y) => x ~ z;");
    } catch (e) {
      expect((e as ParseError).line).toBe(3);
    }
  });
});
