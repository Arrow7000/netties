/**
 * Core interaction net data model.
 *
 * Port convention: slot 0 is the principal port; slots 1..arity are the
 * auxiliary ports, numbered clockwise starting from the principal port.
 * This keeps nets planar-oriented: rotating an agent preserves its port
 * order, mirroring it would not (so we never mirror).
 */

export type AgentId = number;
export type WireId = number;

export interface AgentType {
  id: string;
  name: string;
  /** Short label drawn inside the agent, e.g. "γ". */
  symbol: string;
  arity: number;
  /** Drawn as a solid shape rather than an outline. */
  filled?: boolean;
}

/** Where a wire ends: an agent's port, or one of the net's free ports. */
export type End =
  | { kind: "port"; agent: AgentId; slot: number }
  | { kind: "free"; name: string };

export interface Agent {
  id: AgentId;
  type: string;
  /** wires[slot] is the wire attached at that slot, or NONE while unconnected. */
  wires: WireId[];
}

export interface Wire {
  id: WireId;
  ends: [End, End];
}

export const NONE: WireId = -1;

export interface NetJSON {
  agents: { id: AgentId; type: string; arity: number }[];
  wires: { id: WireId; ends: [End, End] }[];
  free: string[];
}

export const port = (agent: AgentId, slot: number): End => ({ kind: "port", agent, slot });
export const free = (name: string): End => ({ kind: "free", name });

export const endKey = (e: End): string =>
  e.kind === "port" ? `${e.agent}:${e.slot}` : `free:${e.name}`;

export const sameEnd = (a: End, b: End): boolean => endKey(a) === endKey(b);

export class Net {
  readonly agents = new Map<AgentId, Agent>();
  readonly wires = new Map<WireId, Wire>();
  /** Free ports of the net (its interface), by name. */
  readonly free = new Map<string, WireId>();
  private nextAgent: AgentId = 1;
  private nextWire: WireId = 1;

  addAgent(type: AgentType): AgentId {
    const id = this.nextAgent++;
    this.agents.set(id, { id, type: type.id, wires: new Array(type.arity + 1).fill(NONE) });
    return id;
  }

  agent(id: AgentId): Agent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`no agent ${id}`);
    return a;
  }

  wire(id: WireId): Wire {
    const w = this.wires.get(id);
    if (!w) throw new Error(`no wire ${id}`);
    return w;
  }

  /** The wire attached at an end, or NONE. */
  wireAt(e: End): WireId {
    if (e.kind === "free") return this.free.get(e.name) ?? NONE;
    const w = this.agent(e.agent).wires[e.slot];
    if (w === undefined) throw new Error(`agent ${e.agent} has no slot ${e.slot}`);
    return w;
  }

  /** The end at the other side of the wire attached at `e`. */
  partner(e: End): End | undefined {
    const w = this.wireAt(e);
    if (w === NONE) return undefined;
    const [a, b] = this.wire(w).ends;
    return sameEnd(a, e) ? b : a;
  }

  /**
   * Connect two currently unconnected ends. `id` lets the caller reuse a
   * wire id that has been freed, so wires keep their identity across
   * rewrites (useful for animation).
   */
  connect(a: End, b: End, id?: WireId): WireId {
    if (sameEnd(a, b)) throw new Error(`cannot connect ${endKey(a)} to itself`);
    for (const e of [a, b]) {
      if (this.wireAt(e) !== NONE) throw new Error(`${endKey(e)} is already connected`);
    }
    if (id !== undefined && this.wires.has(id)) throw new Error(`wire ${id} already exists`);
    const wid = id ?? this.nextWire++;
    if (wid >= this.nextWire) this.nextWire = wid + 1;
    this.wires.set(wid, { id: wid, ends: [a, b] });
    this.attach(a, wid);
    this.attach(b, wid);
    return wid;
  }

  disconnect(id: WireId): void {
    const w = this.wire(id);
    for (const e of w.ends) this.attach(e, NONE);
    this.wires.delete(id);
  }

  /** Remove an agent along with every wire attached to it. */
  removeAgent(id: AgentId): void {
    for (const w of this.agent(id).wires) if (w !== NONE && this.wires.has(w)) this.disconnect(w);
    this.agents.delete(id);
  }

  removeFree(name: string): void {
    const w = this.free.get(name);
    if (w !== undefined && w !== NONE) this.disconnect(w);
    this.free.delete(name);
  }

  /** Wires joining two principal ports. */
  activePairs(): WireId[] {
    const out: WireId[] = [];
    for (const w of this.wires.values()) {
      const [a, b] = w.ends;
      if (a.kind === "port" && b.kind === "port" && a.slot === 0 && b.slot === 0) out.push(w.id);
    }
    return out;
  }

  /** Ports with no wire attached. A finished net has none. */
  unconnected(): End[] {
    const out: End[] = [];
    for (const a of this.agents.values()) {
      a.wires.forEach((w, slot) => w === NONE && out.push(port(a.id, slot)));
    }
    for (const [name, w] of this.free) if (w === NONE) out.push(free(name));
    return out;
  }

  clone(): Net {
    const n = new Net();
    for (const a of this.agents.values()) n.agents.set(a.id, { ...a, wires: [...a.wires] });
    for (const w of this.wires.values()) n.wires.set(w.id, { id: w.id, ends: [{ ...w.ends[0] }, { ...w.ends[1] }] });
    for (const [k, v] of this.free) n.free.set(k, v);
    n.nextAgent = this.nextAgent;
    n.nextWire = this.nextWire;
    return n;
  }

  toJSON(): NetJSON {
    return {
      agents: [...this.agents.values()].map((a) => ({ id: a.id, type: a.type, arity: a.wires.length - 1 })),
      wires: [...this.wires.values()].map((w) => ({ id: w.id, ends: w.ends })),
      free: [...this.free.keys()],
    };
  }

  static fromJSON(j: NetJSON): Net {
    const n = new Net();
    for (const a of j.agents) {
      n.agents.set(a.id, { id: a.id, type: a.type, wires: new Array(a.arity + 1).fill(NONE) });
      n.nextAgent = Math.max(n.nextAgent, a.id + 1);
    }
    for (const name of j.free) n.free.set(name, NONE);
    for (const w of j.wires) n.connect(w.ends[0], w.ends[1], w.id);
    return n;
  }

  private attach(e: End, w: WireId): void {
    if (e.kind === "free") this.free.set(e.name, w);
    else this.agent(e.agent).wires[e.slot] = w;
  }
}
