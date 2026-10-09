import { batch, createMemo, createSignal } from "solid-js";
import { type AgentId, type End, Net, NONE, type NetJSON, type WireId, free, port } from "../core/net";
import { redexes } from "../core/reduce";
import type { System } from "../core/system";
import type { Placed, Placement, Pt } from "../layout/geometry";
import { autoLayout } from "../layout/place";
import { type Pins, type Routed, route } from "../layout/route";

export type LayoutMode = "auto" | "manual";

export interface Layout {
  placement: Placement;
  routed: Routed;
}

export type Selection = { kind: "agent"; id: AgentId } | { kind: "wire"; id: WireId } | undefined;

export interface NetModelOptions {
  system: () => System;
  /** Free ports held in place along the edges, as in a rule's interface. */
  pins?: () => Pins | undefined;
  /** Free ports are a fixed interface: never create or remove them. */
  fixedInterface?: boolean;
  /** Extra state to capture alongside the net in undo history. */
  extra?: { save(): unknown; load(x: unknown): void };
}

interface Snapshot {
  net: NetJSON;
  positions: [AgentId, Placed][];
  mode: LayoutMode;
  extra?: unknown;
}

const HISTORY_LIMIT = 200;

/**
 * An editable net: the net itself, where its agents are, what's selected,
 * and undo history. The main editor and the rule editor are both built on
 * one of these.
 */
export function createNetModel(opts: NetModelOptions) {
  let net = new Net();
  let positions = new Map<AgentId, Placed>();

  const [rev, setRev] = createSignal(0);
  const [mode, setModeSignal] = createSignal<LayoutMode>("auto");
  const [selection, setSelection] = createSignal<Selection>();
  const [armed, setArmed] = createSignal<string>();
  const [fitTick, setFitTick] = createSignal(0);
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const [historySize, setHistorySize] = createSignal({ undo: 0, redo: 0 });

  const bump = () => setRev((r) => r + 1);
  const requestFit = () => setFitTick((t) => t + 1);

  const snapshot = (): string =>
    JSON.stringify({
      net: net.toJSON(),
      positions: mode() === "manual" ? [...positions] : [],
      mode: mode(),
      extra: opts.extra?.save(),
    } satisfies Snapshot);

  const restoreSnapshot = (s: string) => {
    const snap = JSON.parse(s) as Snapshot;
    batch(() => {
      if (opts.extra) opts.extra.load(snap.extra);
      net = Net.fromJSON(snap.net);
      positions = new Map(snap.positions);
      setModeSignal(snap.mode);
      setSelection(undefined);
      bump();
    });
  };

  /** Record the current state so the next change can be undone. */
  const checkpoint = () => {
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    setHistorySize({ undo: undoStack.length, redo: 0 });
  };

  const undo = () => {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(snapshot());
    restoreSnapshot(prev);
    setHistorySize({ undo: undoStack.length, redo: redoStack.length });
  };

  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(snapshot());
    restoreSnapshot(next);
    setHistorySize({ undo: undoStack.length, redo: redoStack.length });
  };

  const clearHistory = () => {
    undoStack.length = 0;
    redoStack.length = 0;
    setHistorySize({ undo: 0, redo: 0 });
  };

  const layout = createMemo<Layout>(() => {
    rev();
    const pins = opts.pins?.();
    if (mode() === "auto") {
      const l = autoLayout(net, { pins });
      return { placement: l.placement, routed: l.routed };
    }
    // Agents without a position yet (new ones) get one next to the others.
    const placement: Placement = new Map();
    let spare = 0;
    for (const id of net.agents.keys()) {
      const p = positions.get(id) ?? { x: spare++ * 48, y: 0, orient: "down" as const };
      positions.set(id, p);
      placement.set(id, p);
    }
    return { placement, routed: route(net, placement, { pins }) };
  });

  const activeWires = createMemo(() => {
    rev();
    return new Set(redexes(net, opts.system()));
  });

  /** Active pairs with no rule: they can never fire. */
  const stuckWires = createMemo(() => {
    rev();
    const live = activeWires();
    return new Set(net.activePairs().filter((w) => !live.has(w)));
  });

  const nextFreeName = () => {
    for (let i = 0; ; i++) {
      const letter = String.fromCharCode(97 + (i % 26));
      const name = i < 26 ? letter : `${letter}${Math.floor(i / 26)}`;
      if (!net.free.has(name)) return name;
    }
  };

  /** Disconnect whatever is attached at `e`, removing free ports left dangling (unless they're interface). */
  const detach = (e: End) => {
    const w = net.wireAt(e);
    if (w === NONE) return;
    const other = net.partner(e)!;
    net.disconnect(w);
    if (opts.fixedInterface) return;
    if (other.kind === "free") net.free.delete(other.name);
    if (e.kind === "free") net.free.delete(e.name);
  };

  const removeAgent = (id: AgentId) => {
    const a = net.agent(id);
    a.wires.forEach((w, slot) => w !== NONE && detach(port(id, slot)));
    net.removeAgent(id);
    positions.delete(id);
  };

  return {
    rev,
    bump,
    get net() {
      return net;
    },
    get positions() {
      return positions;
    },
    /** Replace the whole net (not undoable by itself; call `checkpoint` first if it should be). */
    setNet(n: Net, pos = new Map<AgentId, Placed>()) {
      batch(() => {
        net = n;
        positions = pos;
        setSelection(undefined);
        setArmed(undefined);
        bump();
      });
    },
    layout,
    mode,
    selection,
    setSelection,
    armed,
    setArmed,
    activeWires,
    stuckWires,
    fitTick,
    requestFit,
    historySize,
    checkpoint,
    undo,
    redo,
    clearHistory,
    fixedInterface: !!opts.fixedInterface,

    setMode(m: LayoutMode, record = true) {
      if (m === mode()) return;
      if (record) checkpoint();
      positions = m === "manual" ? new Map(layout().placement) : new Map();
      setModeSignal(m);
      bump();
    },

    addAgent(type: string, at?: Pt) {
      checkpoint();
      const id = net.addAgent(opts.system().type(type));
      if (at && mode() === "manual") positions.set(id, { x: at.x, y: at.y, orient: "down" });
      setSelection({ kind: "agent", id });
      bump();
      return id;
    },

    /** Join two ends with a wire, replacing whatever they were attached to. */
    connect(a: End, b: End) {
      if (a.kind === "port" && b.kind === "port" && a.agent === b.agent && a.slot === b.slot) return;
      if (a.kind === "free" && b.kind === "free" && a.name === b.name) return;
      checkpoint();
      detach(a);
      detach(b);
      // Detaching may have removed a free end along with its old wire.
      for (const e of [a, b]) if (e.kind === "free" && !net.free.has(e.name)) net.free.set(e.name, NONE);
      net.connect(a, b);
      bump();
    },

    /** Give a port its own free port, dangling off the edge of the net. */
    makeFree(e: End) {
      if (opts.fixedInterface) return;
      checkpoint();
      detach(e);
      const name = nextFreeName();
      net.free.set(name, NONE);
      net.connect(e, free(name));
      bump();
    },

    deleteSelection() {
      const sel = selection();
      if (!sel) return;
      checkpoint();
      if (sel.kind === "agent" && net.agents.has(sel.id)) removeAgent(sel.id);
      else if (sel.kind === "wire" && net.wires.has(sel.id)) detach(net.wire(sel.id).ends[0]);
      setSelection(undefined);
      bump();
    },

    removeAgentsWhere(pred: (type: string) => boolean) {
      for (const a of [...net.agents.values()]) if (pred(a.type)) removeAgent(a.id);
      bump();
    },

    /** Manual mode: move an agent. Call `checkpoint` once before a drag. */
    moveAgent(id: AgentId, to: Pt) {
      const p = positions.get(id);
      if (!p) return;
      positions.set(id, { ...p, x: to.x, y: to.y });
      bump();
    },

    /** Manual mode: turn an agent to point the other way. */
    flipAgent(id: AgentId) {
      const p = positions.get(id);
      if (!p || mode() !== "manual") return;
      checkpoint();
      positions.set(id, { ...p, orient: p.orient === "down" ? "up" : "down" });
      bump();
    },

    /** Restore mode and positions directly, e.g. when loading a saved document. */
    restoreView(m: LayoutMode, pos: Map<AgentId, Placed>) {
      positions = pos;
      setModeSignal(m);
      bump();
    },
  };
}

export type NetModel = ReturnType<typeof createNetModel>;
