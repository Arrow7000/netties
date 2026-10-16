import { describe, expect, it } from "vitest";
import { NONE, Net, free, port } from "../core/net";
import { System } from "../core/system";
import { G, portPos } from "../layout/geometry";
import { flattenPath } from "../render/path";
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

  it("peels a loose end's wire off the wire it was joined into, when undoing a join", () => {
    const sys = new System().addType({ id: "S", name: "S", symbol: "S", arity: 1 });
    const net = new Net();
    const a = net.addAgent(sys.type("S"));
    const b = net.addAgent(sys.type("S"));
    const placement = new Map([
      [a, { x: 0, y: 0, orient: "down" as const }],
      [b, { x: 80, y: 0, orient: "down" as const }],
    ]);
    const joined = net.connect(port(a, 1), port(b, 1));
    const before = { net: net.clone(), sys, placement, routed: route(net, placement) };
    // Undo: a's wire to loose end "c" (same id), and b's own wire to loose end "d" again.
    net.disconnect(joined);
    for (const n of ["c", "d"]) net.free.set(n, NONE);
    net.connect(port(a, 1), free("c"), joined);
    const back = net.connect(port(b, 1), free("d"));
    const after = { net, sys, placement, routed: route(net, placement) };

    const frame = buildMorph(before, after, []).at(0);
    const wire = frame.wires.find((w) => w.id === String(back))!;
    const from = portPos(placement.get(b)!, 1, 1);
    // It starts on the joined wire's old path, not at its final shape.
    const old = flattenPath(before.routed.wires.get(joined)!, G.radius);
    const onOld = (q: { x: number; y: number }) => old.some((o) => Math.hypot(o.x - q.x, o.y - q.y) < 3);
    expect(Math.hypot(wire.pts[0]!.x - from.x, wire.pts[0]!.y - from.y)).toBeLessThan(1);
    expect(wire.pts.every(onOld)).toBe(true);
  });
});
