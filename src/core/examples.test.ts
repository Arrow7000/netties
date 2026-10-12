import { describe, expect, it } from "vitest";
import { examples } from "./examples";
import { free, port, type Net } from "./net";
import { normalize } from "./reduce";

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
  it("reconnects the four ends of a directed annihilation", () => {
    const { system, net } = loaded("Directed annihilation");
    expect(normalize(net, system).normal).toBe(true);
    expect(net.partner(free("a"))).toEqual(free("d"));
    expect(net.partner(free("b"))).toEqual(free("c"));
  });

  it("runs the dual directed commutation", () => {
    const { system, net } = loaded("Other directed commutation");
    expect(normalize(net, system, { limit: 100 }).normal).toBe(true);
    expect(net.activePairs()).toEqual([]);
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
  });
});
