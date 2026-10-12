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

  it("runs the dual directed commutation and co-erasing cases", () => {
    for (const name of ["Other directed commutation", "Co-erasing a tree"]) {
      const { system, net } = loaded(name);
      expect(normalize(net, system, { limit: 100 }).normal, name).toBe(true);
      expect(net.activePairs(), name).toEqual([]);
    }
  });

  it("runs the additional typed examples to their expected results", () => {
    for (const [name, output] of [["0 × 3", 0], ["Length of an empty list", 0]] as const) {
      const { system, net } = loaded(name);
      expect(normalize(net, system).normal, name).toBe(true);
      expect(readNumber(net, "out"), name).toBe(output);
    }
    const { system, net } = loaded("Copy a number");
    expect(normalize(net, system).normal).toBe(true);
    expect(readNumber(net, "a")).toBe(2);
    expect(readNumber(net, "b")).toBe(2);
    const erased = loaded("Erase a mixed list");
    expect(normalize(erased.net, erased.system).normal).toBe(true);
    expect(erased.net.agents.size).toBe(0);
  });
});
