import { type AgentId, type Net, NONE, type WireId, port } from "./net";
import { interact, isActive } from "./reduce";
import type { System } from "./system";

/**
 * Reduction for large nets, keeping a queue of candidate redexes instead of
 * scanning every wire each step. `allow` can hold back particular cuts.
 */
export function reduceWith(
  net: Net,
  sys: System,
  opts: { start?: WireId[]; allow?: (w: WireId) => boolean; limit?: number } = {},
): { interactions: number; normal: boolean; held: WireId[] } {
  const { allow = () => true, limit = 1_000_000 } = opts;
  const queue: WireId[] = opts.start ? [...opts.start] : net.activePairs();
  const held = new Set<WireId>();
  let interactions = 0;
  while (queue.length) {
    if (interactions >= limit) return { interactions, normal: false, held: [...held] };
    const w = queue.pop()!;
    if (!net.wires.has(w) || !isActive(net, w)) continue;
    if (!allow(w)) {
      held.add(w);
      continue;
    }
    const [a, b] = net.wire(w).ends;
    if (a.kind !== "port" || b.kind !== "port" || !sys.ruleFor(net.agent(a.agent).type, net.agent(b.agent).type)) {
      held.add(w);
      continue;
    }
    const rec = interact(net, sys, w);
    interactions++;
    for (const c of rec.createdWires) if (isActive(net, c.id)) queue.push(c.id);
  }
  return { interactions, normal: held.size === 0, held: [...held] };
}

/**
 * Whether a δ is the root of a translated cell, [α] or a ⟨α⟩ still waiting
 * for its code: its first aux port holds the γ of T₁,₁, whose second aux
 * port faces the principal γ of the selector, and its second aux port
 * carries the loop to the multiplexor. Cuts between two such roots are the
 * source's own cuts, so they should wait their turn.
 */
export function isCellRoot(net: Net, a: AgentId): boolean {
  const ag = net.agents.get(a);
  if (!ag || ag.type !== "δ") return false;
  const g = net.partner(port(a, 1));
  if (g?.kind !== "port" || g.slot !== 0 || net.agent(g.agent).type !== "γ") return false;
  const facesPrincipal = (slot: number) => {
    if (net.agent(g.agent).wires[slot] === NONE) return false;
    const p = net.partner(port(g.agent, slot));
    return p?.kind === "port" && p.slot === 0 && net.agent(p.agent).type === "γ";
  };
  const loop = net.partner(port(a, 2));
  return facesPrincipal(2) && loop?.kind === "port" && loop.slot > 0;
}
