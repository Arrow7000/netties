import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { type End, Net, free, port } from "./net";
import { intensionalTrees } from "./presets";
import { interact, redexes } from "./reduce";
import { type System } from "./system";
import { canMeet } from "./types";

function leaf(net: Net, sys: System): End {
  return port(net.addAgent(sys.type("R0")), 0);
}

function stem(net: Net, sys: System, child: End): End {
  const id = net.addAgent(sys.type("BS"));
  net.connect(port(id, 0), child);
  return port(id, 1);
}

function fork(net: Net, sys: System, left: End, right: End): End {
  const id = net.addAgent(sys.type("BF"));
  net.connect(port(id, 0), left);
  net.connect(port(id, 2), right);
  return port(id, 1);
}

function inspect(net: Net, sys: System, input: End): void {
  const id = net.addAgent(sys.type("Shape"));
  net.connect(port(id, 0), input);
  net.connect(port(id, 1), free("out"));
}

function run(net: Net, sys: System, choose: "first" | "last" = "first") {
  const trace: string[] = [];
  for (let steps = 0; steps < 100; steps++) {
    const active = redexes(net, sys);
    if (active.length === 0) return trace;
    const wire = choose === "first" ? active[0]! : active[active.length - 1]!;
    const rec = interact(net, sys, wire);
    trace.push(`${rec.rule.left}/${rec.rule.right}`);
  }
  throw new Error("experiment did not settle within 100 interactions");
}

function result(net: Net): string {
  const end = net.partner(free("out"));
  if (!end || end.kind !== "port") throw new Error("no result");
  return net.agent(end.agent).type;
}

describe("intensional tree experiment", () => {
  const sys = intensionalTrees();

  it("observes all three TC-inspired tree shapes", () => {
    for (const [make, tag] of [
      [(n: Net) => leaf(n, sys), "View0"],
      [(n: Net) => stem(n, sys, leaf(n, sys)), "View1"],
      [(n: Net) => fork(n, sys, leaf(n, sys), stem(n, sys, leaf(n, sys))), "View2"],
    ] as const) {
      const net = new Net();
      inspect(net, sys, make(net));
      run(net, sys);
      expect(result(net)).toBe(tag);
      expect(net.unconnected()).toEqual([]);
    }
  });

  it("makes the inspector wait for both computed children, regardless of step order", () => {
    const net = new Net();
    inspect(net, sys, fork(net, sys, stem(net, sys, leaf(net, sys)), stem(net, sys, leaf(net, sys))));
    expect(redexes(net, sys)).toHaveLength(2);
    expect(canMeet(sys, "Shape", "BF")?.kind).toBe("pol");
    expect(sys.ruleFor("Shape", "BF")).toBeUndefined();

    const first = net.clone();
    const last = net.clone();
    const firstTrace = run(first, sys, "first");
    const lastTrace = run(last, sys, "last");
    for (const trace of [firstTrace, lastTrace]) {
      const observedAt = trace.indexOf("Shape/R2");
      expect(observedAt).toBeGreaterThan(-1);
      expect(observedAt).toBe(trace.length - 1);
      expect(trace).toContain("BF/R1");
      expect(trace).toContain("AR/R1");
    }
    expect(result(first)).toBe("View2");
    const viewEnd = first.partner(free("out"));
    if (!viewEnd || viewEnd.kind !== "port") throw new Error("missing view");
    for (const slot of [1, 2]) {
      const child = first.partner(port(viewEnd.agent, slot));
      expect(child?.kind === "port" && first.agent(child.agent).type).toBe("R1");
    }
    expect(canonical(first)).toBe(canonical(last));
  });

  it("shows why hand-built ready constructors still need a well-formedness rule", () => {
    const net = new Net();
    const readyStem = net.addAgent(sys.type("R1"));
    net.connect(port(readyStem, 1), stem(net, sys, leaf(net, sys)));
    inspect(net, sys, port(readyStem, 0));
    // Both are fireable: the port types alone cannot certify that R1's child is ready.
    expect(redexes(net, sys)).toHaveLength(2);
  });
});
