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

  it("splits a joined wire at its halfway point when undoing the join of two loose ends' wires", () => {
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
    const old = flattenPath(before.routed.wires.get(joined)!, G.radius);
    const segs = old.slice(1).map((q, i) => [old[i]!, q] as const);
    const len = segs.reduce((s, [p, q]) => s + Math.hypot(q.x - p.x, q.y - p.y), 0);
    const toSeg = (r: { x: number; y: number }, [p, q]: readonly [typeof r, typeof r]) => {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const k = Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x + k * dx - r.x, p.y + k * dy - r.y);
    };
    const onOld = (r: { x: number; y: number }) => segs.some((s) => toSeg(r, s) < 0.5);
    // How far along the joined wire a point on it is.
    const along = (r: { x: number; y: number }) => {
      let s = 0;
      for (const [p, q] of segs) {
        if (toSeg(r, [p, q]) < 0.5) return s + Math.hypot(r.x - p.x, r.y - p.y);
        s += Math.hypot(q.x - p.x, q.y - p.y);
      }
      return NaN;
    };
    const c = frame.free.find((f) => f.name === "c")!;
    const d = frame.free.find((f) => f.name === "d")!;
    // Both loose ends start at the same point, halfway along the joined wire.
    expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeLessThan(0.5);
    expect(Math.abs(along(c) - len / 2)).toBeLessThan(0.5);
    // Each wire starts as its half of the joined wire, from its own port.
    for (const [id, at] of [[String(joined), a], [String(back), b]] as const) {
      const wire = frame.wires.find((w) => w.id === id)!;
      const from = portPos(placement.get(at)!, 1, 1);
      expect(Math.hypot(wire.pts[0]!.x - from.x, wire.pts[0]!.y - from.y)).toBeLessThan(1);
      expect(wire.pts.every(onOld)).toBe(true);
    }
    // Nothing of the joined wire is left behind to fade.
    expect(frame.wires.some((w) => w.id.startsWith("gone-"))).toBe(false);
  });
});
