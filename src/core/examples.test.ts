import { describe, expect, it } from "vitest";
import { examples } from "./examples";
import { free, port, type Net } from "./net";
import { normalize } from "./reduce";
import { clash, specOf } from "./types";

function loaded(name: string) {
  const ex = examples.find((e) => e.name === name)!;
  const system = ex.system();
  return { system, net: ex.net(system) };
}

function readNumber(net: Net, name: string): number {
  let n = 0;
  let at = net.partner(free(name));
  while (at?.kind === "port" && net.agent(at.agent).type === "S") {
    n++;
    at = net.partner(port(at.agent, 1));
  }
  expect(at?.kind === "port" && net.agent(at.agent).type).toBe("0");
  return n;
}

describe("new examples", () => {
  it("leaves ports open for a three-type wiring exercise", () => {
    for (const name of ["Wiring lab: three types", "Finish a typed list"]) {
      const { system, net } = loaded(name);
      expect(system.typing).toEqual({ dirs: "required", types: "required", names: ["number", "list", "boolean"] });
      expect(net.unconnected().length, name).toBeGreaterThan(3);
    }
    const { system } = loaded("Wiring lab: three types");
    expect(clash(specOf(system, "0", 0), specOf(system, "S", 1))).toBeUndefined();
    expect(clash(specOf(system, "[]", 0), specOf(system, "∷", 2))).toBeUndefined();
    expect(clash(specOf(system, "T", 0), specOf(system, "¬", 0))).toBeUndefined();
    expect(clash(specOf(system, "0", 0), specOf(system, "∷", 2))?.kind).toBe("type");
    expect(clash(specOf(system, "T", 0), specOf(system, "S", 1))?.kind).toBe("type");
    expect(clash(specOf(system, "0", 0), specOf(system, "[]", 0))?.kind).toBe("pol");
  });

  it("introduces addition before multiplication, with 3 × 2 = 6", () => {
    expect(examples.findIndex((e) => e.name === "3 + 2")).toBeLessThan(examples.findIndex((e) => e.name === "3 × 2"));
    const { system, net } = loaded("3 × 2");
    expect(normalize(net, system).normal).toBe(true);
    expect(readNumber(net, "out")).toBe(6);
  });

  it("reconnects the four ends of a directed annihilation", () => {
    const { system, net } = loaded("Directed annihilation");
    expect(normalize(net, system).normal).toBe(true);
    expect(net.partner(free("a"))).toEqual(free("d"));
    expect(net.partner(free("b"))).toEqual(free("c"));
  });

  it("distinguishes a finite feedback loop from the repeating net", () => {
    const { system, net } = loaded("Copying a feedback loop");
    const result = normalize(net, system, { limit: 100 });
    expect(result.normal).toBe(true);
    expect(result.stats.interactions).toBeGreaterThan(0);
  });

  it("runs the additional typed examples to their expected results", () => {
    const { system, net } = loaded("Copy a number");
    expect(normalize(net, system).normal).toBe(true);
    expect(readNumber(net, "a")).toBe(2);
    expect(readNumber(net, "b")).toBe(2);
    const lengths = loaded("Two lengths, one list");
    expect(normalize(lengths.net, lengths.system).normal).toBe(true);
    expect(readNumber(lengths.net, "a")).toBe(2);
    expect(readNumber(lengths.net, "b")).toBe(2);
  });

  it("runs the showcase nets through multiple interactions", () => {
    const square = loaded("Square of a sum");
    const squareResult = normalize(square.net, square.system, { limit: 1000 });
    expect(squareResult.normal).toBe(true);
    expect(squareResult.stats.interactions).toBeGreaterThan(5);
    expect(readNumber(square.net, "out")).toBe(9);

    const cascade = loaded("Directed cascade");
    const cascadeResult = normalize(cascade.net, cascade.system, { limit: 1000 });
    expect(cascadeResult.normal).toBe(true);
    expect(cascadeResult.stats.interactions).toBeGreaterThan(1);
    expect(cascade.net.activePairs()).toEqual([]);

    const branches = loaded("One number, two calculations");
    const branchResult = normalize(branches.net, branches.system, { limit: 1000 });
    expect(branchResult.normal).toBe(true);
    expect(branchResult.stats.interactions).toBeGreaterThan(5);
    expect(readNumber(branches.net, "sum")).toBe(5);
    expect(readNumber(branches.net, "product")).toBe(6);

    const lengths = loaded("Add two list lengths");
    const lengthResult = normalize(lengths.net, lengths.system, { limit: 1000 });
    expect(lengthResult.normal).toBe(true);
    expect(lengthResult.stats.interactions).toBeGreaterThan(5);
    expect(readNumber(lengths.net, "out")).toBe(5);
  });
});
