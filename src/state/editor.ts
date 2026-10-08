import { batch, createMemo, createSignal } from "solid-js";
import { examples, type Example } from "../core/examples";
import { type AgentId, type AgentType, type End, Net, NONE, type WireId, free, port } from "../core/net";
import { type Stats, emptyStats, interact, isActive, parallelStep, redexes } from "../core/reduce";
import { pairKey, System } from "../core/system";
import type { Placed, Placement, Pt } from "../layout/geometry";
import { autoLayout } from "../layout/place";
import { type Routed, route } from "../layout/route";
import { type Doc, type LayoutMode, decode, saveLocal } from "./persist";

export interface Layout {
  placement: Placement;
  routed: Routed;
}

export type Selection = { kind: "agent"; id: AgentId } | { kind: "wire"; id: WireId } | undefined;

const HISTORY_LIMIT = 200;

export function createEditor(initial: Doc | undefined) {
  let system = new System();
  let net = new Net();
  let positions = new Map<AgentId, Placed>();

  const [rev, setRev] = createSignal(0);
  const [mode, setModeSignal] = createSignal<LayoutMode>("auto");
  const [selection, setSelection] = createSignal<Selection>();
  const [armed, setArmed] = createSignal<string>();
  const [stats, setStats] = createSignal<Stats>(emptyStats());
  const [running, setRunning] = createSignal(false);
  const [message, setMessage] = createSignal<string>();
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const [historySize, setHistorySize] = createSignal({ undo: 0, redo: 0 });

  const bump = () => setRev((r) => r + 1);

  const toDoc = (): Doc => ({
    v: 1,
    system: system.toJSON(),
    net: net.toJSON(),
    mode: mode(),
    positions: mode() === "manual" ? [...positions] : undefined,
  });

  const restore = (doc: Doc) => {
    const d = decode(doc);
    batch(() => {
      system = d.system;
      net = d.net;
      positions = d.positions;
      setModeSignal(d.mode);
      setSelection(undefined);
      setArmed(undefined);
      bump();
    });
  };

  /** Record the current state so the next change can be undone. */
  const checkpoint = () => {
    undoStack.push(JSON.stringify(toDoc()));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    setHistorySize({ undo: undoStack.length, redo: 0 });
  };

  const undo = () => {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(JSON.stringify(toDoc()));
    restore(JSON.parse(prev));
    setHistorySize({ undo: undoStack.length, redo: redoStack.length });
  };

  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(toDoc()));
    restore(JSON.parse(next));
    setHistorySize({ undo: undoStack.length, redo: redoStack.length });
  };

  const layout = createMemo<Layout>(() => {
    rev();
    if (mode() === "auto") {
      const l = autoLayout(net);
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
    return { placement, routed: route(net, placement) };
  });

  const activeWires = createMemo(() => {
    rev();
    return new Set(redexes(net, system));
  });

  /** Active pairs with no rule: they can never fire. */
  const stuckWires = createMemo(() => {
    rev();
    const live = activeWires();
    return new Set(net.activePairs().filter((w) => !live.has(w)));
  });

  const missingRules = createMemo(() => {
    rev();
    const types = [...system.types.keys()];
    const missing: [string, string][] = [];
    types.forEach((a, i) => types.slice(i).forEach((b) => !system.ruleFor(a, b) && missing.push([a, b])));
    return missing;
  });

  /** Bumped whenever the view should frame the whole net again. */
  const [fitTick, setFitTick] = createSignal(0);
  const requestFit = () => setFitTick((t) => t + 1);

  const nextFreeName = () => {
    for (let i = 0; ; i++) {
      const letter = String.fromCharCode(97 + (i % 26));
      const name = i < 26 ? letter : `${letter}${Math.floor(i / 26)}`;
      if (!net.free.has(name)) return name;
    }
  };

  /** Disconnect whatever is attached at `e`, removing a free port left dangling. */
  const detach = (e: End) => {
    const w = net.wireAt(e);
    if (w === NONE) return;
    const other = net.partner(e)!;
    net.disconnect(w);
    if (other.kind === "free") net.free.delete(other.name);
    if (e.kind === "free") net.free.delete(e.name);
  };

  /** Place new agents from a reduction step near where the pair used to be. */
  const placeCreated = (removed: AgentId[], created: AgentId[], before: Placement) => {
    if (mode() !== "manual") return;
    const old = removed.map((id) => before.get(id)).filter((p): p is Placed => !!p);
    const cx = old.reduce((s, p) => s + p.x, 0) / Math.max(1, old.length);
    const cy = old.reduce((s, p) => s + p.y, 0) / Math.max(1, old.length);
    created.forEach((id, i) =>
      positions.set(id, { x: cx + (i - (created.length - 1) / 2) * 44, y: cy, orient: i % 2 ? "up" : "down" }),
    );
    removed.forEach((id) => positions.delete(id));
  };

  const fire = (w: WireId) => {
    if (!net.wires.has(w) || !isActive(net, w)) return;
    checkpoint();
    const before = layout().placement;
    try {
      const rec = interact(net, system, w);
      placeCreated(rec.removed, rec.created, before);
      setStats((s) => {
        const byRule = new Map(s.byRule);
        const k = pairKey(rec.rule.left, rec.rule.right);
        byRule.set(k, (byRule.get(k) ?? 0) + 1);
        return { ...s, interactions: s.interactions + 1, byRule };
      });
    } catch (e) {
      setMessage((e as Error).message);
    }
    setSelection(undefined);
    bump();
  };

  const stepOne = () => {
    const [w] = activeWires();
    if (w !== undefined) fire(w);
  };

  const stepAll = (record = true): boolean => {
    if (activeWires().size === 0) return false;
    if (record) checkpoint();
    const before = layout().placement;
    const s: Stats = { ...stats(), byRule: new Map(stats().byRule) };
    const recs = parallelStep(net, system, s);
    for (const r of recs) placeCreated(r.removed, r.created, before);
    setStats(s);
    setSelection(undefined);
    bump();
    return recs.length > 0;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    setRunning(false);
  };
  const run = () => {
    if (running()) return stop();
    if (activeWires().size === 0) return;
    checkpoint();
    setRunning(true);
    let rounds = 0;
    timer = setInterval(() => {
      if (!stepAll(false) || ++rounds >= 2000) stop();
    }, 380);
  };

  return {
    rev,
    get net() {
      return net;
    },
    get system() {
      return system;
    },
    layout,
    mode,
    selection,
    setSelection,
    armed,
    setArmed,
    stats,
    running,
    message,
    setMessage,
    activeWires,
    stuckWires,
    missingRules,
    historySize,
    undo,
    redo,
    fire,
    stepOne,
    stepAll: () => stepAll(),
    run,
    stop,
    toDoc,
    save: () => saveLocal(toDoc()),
    fitTick,
    requestFit,

    load(doc: Doc) {
      stop();
      checkpoint();
      restore(doc);
      setStats(emptyStats());
      requestFit();
    },

    loadExample(ex: Example) {
      stop();
      checkpoint();
      const sys = ex.system();
      batch(() => {
        system = sys;
        net = ex.net(sys);
        positions = new Map();
        setModeSignal("auto");
        setSelection(undefined);
        setArmed(undefined);
        setStats(emptyStats());
        bump();
      });
      requestFit();
    },

    clearNet() {
      stop();
      checkpoint();
      net = new Net();
      positions = new Map();
      setStats(emptyStats());
      setSelection(undefined);
      bump();
    },

    setMode(m: LayoutMode) {
      if (m === mode()) return;
      checkpoint();
      if (m === "manual") positions = new Map(layout().placement);
      else positions = new Map();
      setModeSignal(m);
      bump();
    },

    addAgent(type: string, at?: Pt) {
      checkpoint();
      const id = net.addAgent(system.type(type));
      if (at) positions.set(id, { x: at.x, y: at.y, orient: "down" });
      setSelection({ kind: "agent", id });
      bump();
      return id;
    },

    /** Join two ends with a wire, replacing whatever they were attached to. */
    connect(a: End, b: End) {
      if (a.kind === "port" && b.kind === "port" && a.agent === b.agent && a.slot === b.slot) return;
      checkpoint();
      detach(a);
      detach(b);
      net.connect(a, b);
      bump();
    },

    /** Give a port its own free port, dangling off the edge of the net. */
    makeFree(e: End) {
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
      if (sel.kind === "agent" && net.agents.has(sel.id)) {
        const a = net.agent(sel.id);
        a.wires.forEach((w, slot) => w !== NONE && detach(port(sel.id, slot)));
        net.removeAgent(sel.id);
        positions.delete(sel.id);
      } else if (sel.kind === "wire" && net.wires.has(sel.id)) {
        detach(net.wire(sel.id).ends[0]);
      }
      setSelection(undefined);
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

    checkpoint,

    addType(t: AgentType) {
      checkpoint();
      system.addType(t);
      bump();
    },

    /** Change an agent type. Changing its arity removes the agents of that type from the net. */
    updateType(id: string, t: Omit<AgentType, "id">) {
      checkpoint();
      const old = system.type(id);
      if (old.arity !== t.arity) {
        for (const a of [...net.agents.values()]) {
          if (a.type !== id) continue;
          a.wires.forEach((w, slot) => w !== NONE && detach(port(a.id, slot)));
          net.removeAgent(a.id);
        }
        // Rules mentioning this type no longer fit its ports.
        for (const [k, r] of system.rules) if (r.left === id || r.right === id || r.agents.includes(id)) system.rules.delete(k);
      }
      system.types.set(id, { ...t, id });
      bump();
    },

    removeType(id: string) {
      checkpoint();
      for (const a of [...net.agents.values()]) {
        if (a.type !== id) continue;
        a.wires.forEach((w, slot) => w !== NONE && detach(port(a.id, slot)));
        net.removeAgent(a.id);
      }
      for (const [k, r] of system.rules) if (r.left === id || r.right === id || r.agents.includes(id)) system.rules.delete(k);
      system.types.delete(id);
      if (armed() === id) setArmed(undefined);
      bump();
    },

    examples,
    init() {
      if (initial) restore(initial);
      else this.loadExample(examples[0]!);
      undoStack.length = 0;
      setHistorySize({ undo: 0, redo: 0 });
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;
