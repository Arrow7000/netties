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
      expect(back.system.typing).toEqual(sys.typing);
      for (const t of sys.types.values()) expect(back.system.type(t.id).ports ?? []).toEqual(t.ports ?? []);
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

  it("reads directions and types", () => {
    const { system } = parse(`
      types required number
      agent Z 0 ports +number "zero"
      agent S 1 ports +number, -number "the one before"
      agent E 0 ports -
    `);
    expect(system.typing).toEqual({ dirs: "optional", types: "required", names: ["number"] });
    expect(system.type("S").ports).toEqual([{ pol: "give", type: "number" }, { pol: "take", type: "number", label: "the one before" }]);
    expect(system.type("E").ports).toEqual([{ pol: "take" }]);
    expect(() => parse("agent S 1 ports +number")).toThrow(/2 ports/);
  });

  it("wires names joined to each other", () => {
    const { net } = parse(`agent A 1\n A(a) ~ A(b), a ~ c, c ~ b;`);
    expect(net.unconnected()).toEqual([]);
    expect(net.free.size).toBe(0);
  });

  it("uses _ for empty ports, not loose ends", () => {
    const { net, system } = parse("agent A 1\n\n_ ~ A(_), _ ~ A(_);");
    expect(net.agents.size).toBe(2);
    expect(net.unconnected().length).toBe(4);
    expect(net.free.size).toBe(0);
    expect(print(system, net)).toContain("_ ~ A(_),");
  });

  it("points at the line of a mistake", () => {
    expect(() => parse("A(x) >< B => y ~ x;")).toThrow(ParseError);
    try {
      parse("agent A 1\n\nA(x) >< A(y) => x ~ z;");
    } catch (e) {
      expect((e as ParseError).line).toBe(3);
    }
  });

  it("points at the column, and names bracket mistakes", () => {
    const at = (src: string) => {
      try {
        parse(src);
      } catch (e) {
        const p = e as ParseError;
        return { line: p.line, col: p.col, message: p.message };
      }
      throw new Error("parsed");
    };
    // One ) too many, pointing at the extra one.
    expect(at("S(S(Z))) ~ x;")).toMatchObject({ line: 1, col: 8, message: expect.stringMatching(/one "\)" too many/) });
    // A missing ), reported at the ; and naming where the unclosed ( opened.
    const missing = at("Add(x, y) ~ S(S(S(Z));");
    expect(missing).toMatchObject({ line: 1, col: 22 });
    expect(missing.message).toMatch(/one "\(" is never closed before this ";"; it opens after S on line 1, column 14/);
    // Errors from the parser proper carry a column too.
    expect(at("x ~ y\nz ~ w;")).toMatchObject({ line: 2, col: 1, message: expect.stringMatching(/line 2, column 1: expected ";"/) });
  });

  it("reads and writes rule descriptions", () => {
    const src = 'agent S 1\nagent Z 0\nagent Add 2\nAdd(y, r) >< Z "adding zero" => y ~ r;\nAdd(y, r) >< S(x) => r ~ S(w), x ~ Add(y, w);\n';
    const { system, net } = parse(src);
    expect(system.ruleFor("Add", "Z")?.rule.description).toBe("adding zero");
    expect(system.ruleFor("Add", "S")?.rule.description).toBeUndefined();
    const again = parse(print(system, net)).system;
    expect(again.ruleFor("Add", "Z")?.rule.description).toBe("adding zero");
  });
});
