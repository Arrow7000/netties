import { describe, expect, it } from "vitest";
import { NONE, Net, free, port } from "../core/net";
import { System } from "../core/system";
import { portPos } from "../layout/geometry";
import { route } from "../layout/route";
import { buildMorph } from "./morph";

describe("edit animation", () => {
  it("starts a loose end that's new after the change where its wire's end was", () => {
    const sys = new System().addType({ id: "S", name: "S", symbol: "S", arity: 1 });
    const net = new Net();
    const a = net.addAgent(sys.type("S"));
    const b = net.addAgent(sys.type("S"));
    const placement = new Map([
      [a, { x: 0, y: 0, orient: "down" as const }],
      [b, { x: 80, y: 0, orient: "down" as const }],
    ]);
    const w = net.connect(port(a, 1), port(b, 1));
    const before = { net: net.clone(), sys, placement, routed: route(net, placement) };
    // Undoing that connection: the wire goes back to a loose end.
    net.disconnect(w);
    net.free.set("c", NONE);
    net.connect(port(a, 1), free("c"), w);
    const after = { net, sys, placement, routed: route(net, placement) };

    const start = buildMorph(before, after, []).at(0).free.find((f) => f.name === "c")!;
    const was = portPos(placement.get(b)!, 1, 1);
    expect(Math.hypot(start.x - was.x, start.y - was.y)).toBeLessThan(1);
    const end = buildMorph(before, after, []).at(1).free.find((f) => f.name === "c")!;
    expect(end).toMatchObject({ x: after.routed.free.get("c")!.x, y: after.routed.free.get("c")!.y });
  });
});
