/** Small executable probes of native graph reflection. No privileged reducer rules. */
import { canonical } from "../../src/core/canon";
import { Net, free, port, type AgentId, type End } from "../../src/core/net";
import { combinators } from "../../src/core/presets";
import { interact, redexes } from "../../src/core/reduce";
import { A, L, R, System, type Rule, type RuleEnd } from "../../src/core/system";

const gamma = "γ";
const epsilon = "ε";
const shield = "B";

export function assertClosed(net: Net): void {
  if (net.unconnected().length) throw new Error("fixture contains unconnected ports");
  for (const agent of net.agents.values()) {
    for (let slot = 0; slot < agent.wires.length; slot++) {
      const here = port(agent.id, slot);
      const there = net.partner(here);
      if (!there) throw new Error("missing partner");
      const back = net.partner(there);
      if (back?.kind !== "port" || back.agent !== agent.id || back.slot !== slot)
        throw new Error("wire is not symmetric");
    }
  }
}

/** A root with a connected principal-to-auxiliary cycle behind an auxiliary wire. */
export function hiddenCycle(length: number, sys = combinators()): Net {
  if (length < 1 || length % 2 !== 1) throw new Error("cycle length must be positive and odd");
  const net = new Net();
  const root = net.addAgent(sys.type(gamma));
  const cap = net.addAgent(sys.type(epsilon));
  const ring = Array.from({ length }, () => net.addAgent(sys.type(gamma)));
  net.connect(free("value"), port(root, 0));
  net.connect(port(root, 1), port(ring[0]!, 2));
  net.connect(port(root, 2), port(cap, 0));
  for (let i = 0; i < length; i++) net.connect(port(ring[i]!, 0), port(ring[(i + 1) % length]!, 1));
  for (let i = 1; i < length; i += 2) net.connect(port(ring[i]!, 2), port(ring[i + 1]!, 2));
  assertClosed(net);
  return net;
}

export function aliasSystem(): System {
  return combinators().addType({ id: shield, name: "ternary test cell", symbol: shield, arity: 3 });
}

/** Two root edges reach the same cell, or distinct identical cells. Both nets are normal. */
export function hiddenAliasing(shared: boolean, sys = aliasSystem()): Net {
  const net = new Net();
  const root = net.addAgent(sys.type(gamma));
  const first = net.addAgent(sys.type(shield));
  const second = shared ? first : net.addAgent(sys.type(shield));
  net.connect(free("value"), port(root, 0));
  net.connect(port(first, 0), port(first, 3));
  if (!shared) net.connect(port(second, 0), port(second, 3));
  net.connect(port(root, 1), port(first, 1));
  net.connect(port(root, 2), port(second, shared ? 2 : 1));
  if (!shared) net.connect(port(first, 2), port(second, 2));
  assertClosed(net);
  return net;
}

/** Largest set whose every principal points to an internal auxiliary port. */
export function sealedCore(net: Net): Set<AgentId> {
  const core = new Set(net.agents.keys());
  for (;;) {
    const remove = [...core].filter((id) => {
      const p = net.partner(port(id, 0));
      return !p || p.kind !== "port" || p.slot === 0 || !core.has(p.agent);
    });
    if (!remove.length) return core;
    for (const id of remove) core.delete(id);
  }
}

export function assertSealed(net: Net, core: ReadonlySet<AgentId>): void {
  for (const id of core) {
    if (!net.agents.has(id)) throw new Error("sealed agent removed");
    const p = net.partner(port(id, 0));
    if (!p || p.kind !== "port" || p.slot === 0 || !core.has(p.agent))
      throw new Error("sealed principal invariant broken");
  }
}

/** Host-side quotient for comparing the exterior; it is not an operation in the net. */
export function exterior(net: Net, core: ReadonlySet<AgentId>): string {
  const json = net.toJSON();
  const boundary: { outside: End; inside: End }[] = [];
  for (const wire of json.wires) {
    const [a, b] = wire.ends;
    const ai = a.kind === "port" && core.has(a.agent);
    const bi = b.kind === "port" && core.has(b.agent);
    if (ai !== bi) boundary.push({ outside: ai ? b : a, inside: ai ? a : b });
  }
  if (boundary.length > 2) throw new Error("fixtures expose at most two sealed boundary ends");
  // Boundary slots are deliberately indistinguishable. Try all permutations,
  // so canonical comparison cannot leak hidden IDs or ordering information.
  const permutations = boundary.length === 2 ? [[0, 1], [1, 0]] : [boundary.map((_, i) => i)];
  const versions = permutations.map((order) => {
    const projected = new Net();
    for (const a of json.agents) if (!core.has(a.id)) projected.addAgent({ id: a.type, name: a.type, symbol: a.type, arity: a.arity }, a.id);
    for (const w of json.wires) {
      if (w.ends.some((e) => e.kind === "port" && core.has(e.agent))) continue;
      projected.connect(w.ends[0], w.ends[1]);
    }
    order.forEach((index, i) => projected.connect(boundary[index]!.outside, free(`sealed${i}`)));
    return canonical(projected);
  });
  return versions.sort()[0]!;
}

export function attach(net: Net, sys: System, type: string): AgentId {
  const input = net.partner(free("value"));
  if (!input) throw new Error("fixture lacks value interface");
  const wire = net.wireAt(free("value"));
  net.disconnect(wire);
  net.removeFree("value");
  const id = net.addAgent(sys.type(type));
  net.connect(port(id, 0), input);
  for (let slot = 1; slot <= sys.type(type).arity; slot++) net.connect(port(id, slot), free(slot === 1 ? "out" : `out${slot}`));
  assertClosed(net);
  return id;
}

/** Exhaustive finite schedule exploration. A frontier is reported as incomplete. */
export function explore(net: Net, sys: System, maxSteps = 20, maxStates = 20_000) {
  const originalCore = sealedCore(net);
  const queue = [{ net, steps: 0 }];
  const seen = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const finished = new Map<string, { net: Net; steps: number }>();
  let frontier = 0;
  let transitions = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    const key = canonical(current.net);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.set(key, new Set());
    assertClosed(current.net);
    assertSealed(current.net, originalCore);
    const choices = redexes(current.net, sys);
    if (!choices.length) {
      finished.set(key, current);
      continue;
    }
    if (current.steps >= maxSteps || seen.size >= maxStates) {
      frontier++;
      continue;
    }
    for (const wire of choices) {
      const next = current.net.clone();
      const record = interact(next, sys, wire);
      if (record.removed.some((id) => originalCore.has(id))) throw new Error("interaction touched sealed core");
      queue.push({ net: next, steps: current.steps + 1 });
      edges.get(key)!.add(canonical(next));
      transitions++;
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const next of edges.get(key) ?? []) if (cyclic(next)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  const hasCycle = [...seen].some(cyclic);
  return { states: seen.size, transitions, frontier, hasCycle, finished: [...finished.values()], originalCore };
}

/** A deliberately limited walker: native IC cells become inert View cells. */
export function walkerSystem(): System {
  const sys = combinators()
    .addType({ id: "Quote", name: "recursive quote walker", symbol: "Q", arity: 1 })
    .addType({ id: "Run", name: "recursive unquote walker", symbol: "U", arity: 1 });
  for (const kind of [gamma, "δ", epsilon]) {
    const arity = sys.type(kind).arity;
    const view = `View${kind}`;
    sys.addType({ id: view, name: `view of ${kind}`, symbol: view, arity });
    for (const [walker, source, target] of [["Quote", kind, view], ["Run", view, kind]]) {
      const agents = [target!, ...Array<string>(arity).fill(walker!)];
      const wires: [RuleEnd, RuleEnd][] = [[A(0, 0), L(1)]];
      for (let slot = 1; slot <= arity; slot++) {
        wires.push([A(slot, 0), R(slot)], [A(slot, 1), A(0, slot)]);
      }
      sys.addRule({ left: walker!, right: source!, agents, wires });
    }
  }
  // Two traversals meet at an auxiliary-to-auxiliary back edge. Reconnect
  // the corresponding result ports instead of unfolding or duplicating it.
  for (const walker of ["Quote", "Run"]) sys.addRule({ left: walker, right: walker, agents: [], wires: [[L(1), R(1)]] });
  return sys;
}

/** A rooted principal tree with two different closures of its four leaf ports. */
export function leafWiring(crossed: boolean, sys = combinators()): Net {
  const net = new Net();
  const root = net.addAgent(sys.type(gamma));
  const left = net.addAgent(sys.type(gamma));
  const right = net.addAgent(sys.type(gamma));
  net.connect(free("value"), port(root, 0));
  net.connect(port(root, 1), port(left, 0));
  net.connect(port(root, 2), port(right, 0));
  if (crossed) {
    net.connect(port(left, 1), port(right, 1));
    net.connect(port(left, 2), port(right, 2));
  } else {
    net.connect(port(left, 1), port(left, 2));
    net.connect(port(right, 1), port(right, 2));
  }
  assertClosed(net);
  return net;
}

/** A genuine internal observer distinguishing the two leaf-wiring fixtures. */
export function wiringObserverSystem(): System {
  const sys = combinators();
  for (const [id, arity] of [["Inspect", 1], ["Left", 1], ["Right", 1], ["l", 1], ["r", 1], ["Result", 2], ["Branch", 2], ["Same", 0], ["Cross", 0]] as const)
    sys.addType({ id, name: id, symbol: id, arity });
  sys.addRule({ left: "Inspect", right: gamma, agents: ["Result", "Left", "Right"], wires: [
    [A(0, 0), L(1)], [A(1, 0), R(1)], [A(2, 0), R(2)], [A(0, 1), A(1, 1)], [A(0, 2), A(2, 1)],
  ] });
  for (const [branch, token] of [["Left", "l"], ["Right", "r"]]) sys.addRule({
    left: branch!, right: gamma, agents: ["Branch", token!, token!], wires: [
      [A(0, 0), L(1)], [A(1, 0), R(1)], [A(2, 0), R(2)], [A(0, 1), A(1, 1)], [A(0, 2), A(2, 1)],
    ],
  });
  for (const [a, b] of [["l", "l"], ["r", "r"], ["l", "r"]]) {
    const tag = a === b ? "Same" : "Cross";
    sys.addRule({ left: a!, right: b!, agents: [tag, tag], wires: [[A(0, 0), L(1)], [A(1, 0), R(1)]] });
  }
  return sys;
}

/** Detect implicit orientation of an unordered same-symbol active pair. */
export function sameKindRuleSymmetric(sys: System, rule: Rule): boolean {
  if (rule.left !== rule.right) return true;
  const rhs = (flip: boolean) => {
    const net = new Net();
    const ids = rule.agents.map((type) => net.addAgent(sys.type(type)));
    const end = (e: RuleEnd): End => e.kind === "agent" ? port(ids[e.index]!, e.slot)
      : free(`${flip ? 1 - e.side : e.side}:${e.slot}`);
    for (const [a, b] of rule.wires) net.connect(end(a), end(b));
    return canonical(net);
  };
  return rhs(false) === rhs(true);
}

/** Replace IC annihilation by self-commutation. This copies all finite trees,
 * including trees containing δ, but it need not copy principal nets. */
export function treeDuplicatorSystem(): System {
  const original = combinators().toJSON();
  const sys = System.fromJSON({ ...original, rules: original.rules.filter((r) => !(r.left === "δ" && r.right === "δ")) });
  const wires: [RuleEnd, RuleEnd][] = [];
  for (let i = 0; i < 2; i++) {
    wires.push([A(i, 0), L(i + 1)], [A(i + 2, 0), R(i + 1)]);
    for (let j = 0; j < 2; j++) wires.push([A(i, j + 1), A(j + 2, i + 1)]);
  }
  sys.addRule({ left: "δ", right: "δ", agents: ["δ", "δ", "δ", "δ"], wires });
  return sys;
}

export function duplicatorInput(loop: boolean, sys = treeDuplicatorSystem()): Net {
  const net = new Net();
  const root = net.addAgent(sys.type("δ"));
  net.connect(free("value"), port(root, 0));
  if (loop) net.connect(port(root, 1), port(root, 2));
  else for (let slot = 1; slot <= 2; slot++) net.connect(port(root, slot), port(net.addAgent(sys.type(epsilon)), 0));
  assertClosed(net);
  return net;
}

export function expectedDuplicatorCopies(loop: boolean, sys = treeDuplicatorSystem()): Net {
  const net = new Net();
  for (const name of ["out", "out2"]) {
    const root = net.addAgent(sys.type("δ"));
    net.connect(free(name), port(root, 0));
    if (loop) net.connect(port(root, 1), port(root, 2));
    else for (let slot = 1; slot <= 2; slot++) net.connect(port(root, slot), port(net.addAgent(sys.type(epsilon)), 0));
  }
  assertClosed(net);
  return net;
}
