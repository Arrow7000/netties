import { type AgentId, type Net, NONE, port } from "./net";

/**
 * A string that two nets share exactly when they are isomorphic (same
 * agents and wiring, ignoring ids). Components reachable from free ports are
 * walked from those ports in name order; closed components are each walked
 * from every agent, keeping the smallest result.
 */
export function canonical(net: Net): string {
  const done = new Set<AgentId>();

  const walk = (starts: AgentId[], seed: Map<AgentId, number>): { text: string; order: AgentId[] } => {
    const num = new Map(seed);
    const order: AgentId[] = [];
    const queue: AgentId[] = [];
    const visit = (id: AgentId) => {
      if (num.has(id)) return;
      num.set(id, num.size);
      order.push(id);
      queue.push(id);
    };
    starts.forEach(visit);
    const parts: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      const a = net.agent(id);
      const slots = a.wires.map((w, slot) => {
        if (w === NONE) return "_";
        const p = net.partner(port(id, slot))!;
        if (p.kind === "free") return `<${p.name}>`;
        visit(p.agent);
        return `${num.get(p.agent)}.${p.slot}`;
      });
      parts.push(`${num.get(id)}:${a.type}(${slots.join(",")})`);
    }
    return { text: parts.join(" "), order };
  };

  const sections: string[] = [];
  for (const name of [...net.free.keys()].sort()) {
    const p = net.partner({ kind: "free", name });
    if (!p) sections.push(`<${name}>:_`);
    else if (p.kind === "free") sections.push(`<${name}>~<${p.name}>`);
    else sections.push(`<${name}>~${p.agent}.${p.slot}`);
  }

  // Number agents reachable from the free ports first.
  const fromFree: AgentId[] = [];
  for (const name of [...net.free.keys()].sort()) {
    const p = net.partner({ kind: "free", name });
    if (p?.kind === "port") fromFree.push(p.agent);
  }
  const reached = walk(fromFree, new Map());
  reached.order.forEach((id) => done.add(id));
  // Rewrite the free-port sections in terms of canonical numbers.
  const num = new Map(reached.order.map((id, i) => [id, i]));
  const freeText = sections.map((s) => s.replace(/~(\d+)\.(\d+)$/, (_, a, slot) => `~${num.get(Number(a))}.${slot}`));

  const closed: string[] = [];
  for (const id of net.agents.keys()) {
    if (done.has(id)) continue;
    const component = walk([id], new Map()).order;
    component.forEach((c) => done.add(c));
    let best: string | undefined;
    for (const start of component) {
      const t = walk([start], new Map()).text;
      if (best === undefined || t < best) best = t;
    }
    closed.push(best!);
  }
  closed.sort();
  return [freeText.join(" "), reached.text, ...closed.map((c) => `[${c}]`)].join(" | ");
}
