import { parallelStep } from "../core/reduce";
import { parse } from "../core/text";
import { describe, expect, it } from "vitest";
import { examples } from "../core/examples";
import { type Box, boxOf, portPos } from "./geometry";
import { autoLayout } from "./place";
import { planSteps, previewSteps, routeHoldingEnds, stepShapes } from "./replace";

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("step plans", () => {
  for (const ex of examples) {
    it(`frames every step of "${ex.name}" clear of the net`, () => {
      const system = ex.system();
      const net = ex.net(system);
      const l = autoLayout(net);
      const ws = net.activePairs().filter((w) => {
        const [a, b] = net.wire(w).ends;
        return a.kind === "port" && b.kind === "port" && !!system.ruleFor(net.agent(a.agent).type, net.agent(b.agent).type);
      });
      {
        const drawn = { placement: l.placement, routed: l.routed, columns: l.columns };
        const plans = planSteps(net, system, drawn, ws);
        const frames = [...plans.values()].map((p) => p.frame);
        for (const p of plans.values()) {
          expect(p.agents.length).toBe(p.rule.agents.length);
          // The pair stays visible beside its preview.
          for (const id of p.pair) expect(overlaps(boxOf(l.placement.get(id)!, net.agent(id).wires.length - 1), p.frame)).toBe(false);
          // New agents sit inside their frame.
          for (const a of p.agents) {
            expect(a.x).toBeGreaterThan(p.frame.x0);
            expect(a.x).toBeLessThan(p.frame.x1);
            expect(a.y).toBeGreaterThan(p.frame.y0);
            expect(a.y).toBeLessThan(p.frame.y1);
          }
        }
        // Frames for one parallel step don't cover each other.
        frames.forEach((f, i) => frames.slice(i + 1).forEach((g) => expect(overlaps(f, g)).toBe(false)));

        // Every pair fires in the preview, and its new wires show; solid stretches lie inside frames.
        const pv = previewSteps(net, system, drawn, ws);
        expect(pv.wires).toEqual(ws);
        const aux = pv.agents.reduce((n, id) => n + net.agent(id).wires.length - 1, 0);
        if (aux) expect(pv.strokes.length).toBeGreaterThan(0);
        for (const st of pv.strokes) {
          if (st.dashed) continue;
          for (const q of st.pts) expect(frames.some((f) => q.x >= f.x0 - 1 && q.x <= f.x1 + 1 && q.y >= f.y0 - 1 && q.y <= f.y1 + 1)).toBe(true);
        }
      }
    });
  }

  it("keeps loose ends where they're drawn when rerouting", () => {
    const ex = examples.find((e) => e.name === "Commutation")!;
    const system = ex.system();
    const net = ex.net(system);
    const l = autoLayout(net);
    // Move every agent far off, as a step's result would sit somewhere new.
    const moved = new Map([...l.placement].map(([id, p]) => [id, { ...p, x: p.x + 300, y: p.y + 200 }]));
    const r = routeHoldingEnds(net, moved, {}, l.routed.free);
    for (const [name, w] of net.free) {
      const at = l.routed.free.get(name)!;
      expect(r.free.get(name)).toEqual(at);
      const pts = r.wires.get(w)!;
      const ends = [pts[0]!, pts[pts.length - 1]!];
      expect(ends.some((q) => Math.hypot(q.x - at.x, q.y - at.y) < 0.5)).toBe(true);
    }
  });
});

describe("loose ends and loops made by a step", () => {
  const wire = "agent W 1\nW(x) >< W(y) => x ~ y;\n";
  const drawn = (text: string) => {
    const { system, net } = parse(wire + text);
    const l = autoLayout(net);
    return { system, net, drawn: { placement: l.placement, routed: l.routed, columns: l.columns } };
  };

  it("leaves a wire between two empty ports where the ports were", () => {
    const { system, net, drawn: d } = drawn("W(_) ~ W(_);");
    const ports = [...net.agents.keys()].map((id) => portPos(d.placement.get(id)!, 1, 1));
    const pv = previewSteps(net, system, d, net.activePairs());
    expect(pv.ends.map(({ x, y }) => [x, y]).sort()).toEqual(ports.map(({ x, y }) => [x, y]).sort());
    const ys = pv.strokes.flatMap((s) => s.pts.map((p) => p.y));
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...ports.map((p) => p.y)));
    expect(Math.max(...ys)).toBeCloseTo(Math.max(...ports.map((p) => p.y)));
  });

  it("closes a loop along the wire it continues, across the pair", () => {
    const { system, net, drawn: d } = drawn("W(a) ~ W(a);");
    const pv = previewSteps(net, system, d, net.activePairs());
    expect(pv.kept).toHaveLength(1);
    expect(pv.strokes.length).toBeGreaterThan(0);
    const after = net.clone();
    const { loops } = stepShapes(system, d, parallelStep(after, system));
    const pts = [...loops.values()][0]!;
    expect(Math.hypot(pts[0]!.x - pts.at(-1)!.x, pts[0]!.y - pts.at(-1)!.y)).toBeLessThan(1);
  });

  it("closes a loop that several pairs firing at once make together", () => {
    const { system, net, drawn: d } = drawn("W(a) ~ W(b), W(a) ~ W(b);");
    const after = net.clone();
    const { loops } = stepShapes(system, d, parallelStep(after, system));
    expect(loops.size).toBe(1);
    const pts = [...loops.values()][0]!;
    // It passes along every aux wire, without jumps: the longest straight stretch is an old wire's or a link's.
    const longest = d.routed.bounds.y1 - d.routed.bounds.y0 + (d.routed.bounds.x1 - d.routed.bounds.x0);
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)).toBeLessThan(longest);
    for (const a of net.agents.keys()) {
      const q = portPos(d.placement.get(a)!, 1, 1);
      expect(Math.min(...pts.map((p) => Math.hypot(p.x - q.x, p.y - q.y)))).toBeLessThan(1);
    }
    expect(Math.hypot(pts[0]!.x - pts.at(-1)!.x, pts[0]!.y - pts.at(-1)!.y)).toBeLessThan(1);
  });
});
