import { describe, expect, it } from "vitest";
import { examples } from "../core/examples";
import { type Box, boxOf } from "./geometry";
import { autoLayout } from "./place";
import { planSteps } from "./replace";

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
      for (const turn of [false, true]) {
        const plans = planSteps(net, system, { placement: l.placement, wires: l.routed.wires }, ws, { turn });
        const frames = [...plans.values()].map((p) => p.frame);
        for (const p of plans.values()) {
          expect(p.agents.length).toBe(p.rule.agents.length);
          if (!turn) expect(p.turned).toBe(false);
          // Every aux port of the pair links to its pin.
          const aux = p.pair.reduce((s, id) => s + net.agent(id).wires.length - 1, 0);
          expect(p.links.length).toBe(aux);
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
      }
    });
  }
});
