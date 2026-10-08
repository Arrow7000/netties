import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { examples } from "../core/examples";
import { type End, Net, free, port } from "../core/net";
import { combinators } from "../core/presets";
import { parallelStep } from "../core/reduce";
import { boxOf, portPos } from "./geometry";
import { autoLayout } from "./place";

const sys = combinators();
const types = ["γ", "δ", "ε"];

const arbNet = fc
  .record({
    agents: fc.array(fc.constantFrom(...types), { minLength: 1, maxLength: 10 }),
    shuffle: fc.array(fc.nat(), { minLength: 30, maxLength: 30 }),
    frees: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ agents, shuffle, frees }) => {
    const net = new Net();
    const ends: End[] = [];
    for (const t of agents) {
      const id = net.addAgent(sys.type(t));
      for (let s = 0; s <= sys.type(t).arity; s++) ends.push(port(id, s));
    }
    for (let i = 0; i < frees || ends.length % 2; i++) ends.push(free(`f${i}`));
    for (let i = ends.length - 1; i > 0; i--) {
      const j = (shuffle[i % shuffle.length] ?? 0) % (i + 1);
      [ends[i], ends[j]] = [ends[j]!, ends[i]!];
    }
    for (let i = 0; i < ends.length; i += 2) net.connect(ends[i]!, ends[i + 1]!);
    return net;
  });

function checkLayout(net: Net) {
  const { placement, routed } = autoLayout(net);
  expect(placement.size).toBe(net.agents.size);
  // Agents never overlap.
  const boxes = [...placement].map(([id, p]) => boxOf(p, net.agent(id).wires.length - 1));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap = a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
      expect(overlap).toBe(false);
    }
  // Every wire is routed, from one of its ends to the other.
  expect(routed.wires.size).toBe(net.wires.size);
  for (const w of net.wires.values()) {
    const pts = routed.wires.get(w.id)!;
    const at = (e: End) =>
      e.kind === "free" ? routed.free.get(e.name)! : portPos(placement.get(e.agent)!, net.agent(e.agent).wires.length - 1, e.slot);
    const [a, b] = w.ends.map(at);
    expect(pts[0]!.x).toBeCloseTo(a!.x);
    expect(pts[0]!.y).toBeCloseTo(a!.y);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(b!.x);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(b!.y);
  }
}

describe("auto layout", () => {
  it("lays out random nets without overlaps, routing every wire end to end", () => {
    fc.assert(fc.property(arbNet, (net) => checkLayout(net)), { numRuns: 150 });
  });

  it("lays out every step of the examples", () => {
    for (const ex of examples) {
      const s = ex.system();
      const net = ex.net(s);
      for (let i = 0; i < 8; i++) {
        checkLayout(net);
        if (!parallelStep(net, s).length) break;
      }
    }
  });
});
