import { batch, createMemo, createSignal } from "solid-js";
import { type Frame, type Snapshot as AnimSnapshot, buildMorph } from "../anim/morph";
import { type Defs, type GroupId, Groups, type GroupsJSON, collapse, instantiate } from "../core/groups";
import { type AgentId, type End, Net, NONE, type NetJSON, type WireId, free, port } from "../core/net";
import { type StepRecord, redexes } from "../core/reduce";
import type { System } from "../core/system";
import type { Placed, Placement, Pt } from "../layout/geometry";
import { autoLayout } from "../layout/place";
import { type Pins, type Routed, route } from "../layout/route";

export type LayoutMode = "auto" | "manual";

export interface Layout {
  placement: Placement;
  routed: Routed;
}

/** Selected agents and component instances, or one wire. */
export type Selection =
  | { kind: "items"; agents: ReadonlySet<AgentId>; groups: ReadonlySet<GroupId> }
  | { kind: "wire"; id: WireId }
  | undefined;

export interface NetModelOptions {
  system: () => System;
  /** Component definitions, for drawing instances. */
  defs?: () => Defs;
  /** Free ports held in place along the edges, as in a rule's interface. */
  pins?: () => Pins | undefined;
  /** Free ports are a fixed interface: never create or remove them. */
  fixedInterface?: boolean;
  /** Extra state to capture alongside the net in undo history. */
  extra?: { save(): unknown; load(x: unknown): void };
}

interface Snapshot {
  net: NetJSON;
  groups: GroupsJSON;
  positions: [AgentId, Placed][];
  mode: LayoutMode;
  extra?: unknown;
}

const HISTORY_LIMIT = 200;
const noDefs: Defs = new Map();

/**
 * An editable net: the net itself, its component instances, where its
 * agents are, what's selected, and undo history. The main editor, the rule
 * editor and the component editor are all built on one of these.
 *
 * What's drawn is the *view*: the net with collapsed instances replaced by
 * boxes. Box agents have negative ids; their ports stand for the instance's
 * interface ports.
 */
export function createNetModel(opts: NetModelOptions) {
  let net = new Net();
  let groups = new Groups();
  let positions = new Map<AgentId, Placed>();

  const [rev, setRev] = createSignal(0);
  const [mode, setModeSignal] = createSignal<LayoutMode>("auto");
  const [selection, setSelection] = createSignal<Selection>();
  const [armed, setArmed] = createSignal<string>();
  const [fitTick, setFitTick] = createSignal(0);
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const [historySize, setHistorySize] = createSignal({ undo: 0, redo: 0 });

  const [frame, setFrame] = createSignal<Frame>();
  let raf = 0;

  const bump = () => setRev((r) => r + 1);
  const requestFit = () => setFitTick((t) => t + 1);
  const defs = () => opts.defs?.() ?? noDefs;

  const snapshot = (): string =>
    JSON.stringify({
      net: net.toJSON(),
      groups: groups.toJSON(),
      positions: mode() === "manual" ? [...positions] : [],
      mode: mode(),
      extra: opts.extra?.save(),
    } satisfies Snapshot);

  const restoreSnapshot = (s: string) => {
    const snap = JSON.parse(s) as Snapshot;
    lastAuto = undefined;
    batch(() => {
      if (opts.extra) opts.extra.load(snap.extra);
      net = Net.fromJSON(snap.net);
      groups = Groups.fromJSON(snap.groups);
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

  const view = createMemo(() => {
    rev();
    return collapse(net, groups, opts.system(), defs());
  });

  /** The last automatic layout, so the next one can stay close to it. */
  let lastAuto: Placement | undefined;

  const layout = createMemo<Layout>(() => {
    const v = view();
    const pins = opts.pins?.();
    if (mode() === "auto") {
      const l = autoLayout(v.net, { pins, prev: lastAuto });
      lastAuto = l.placement;
      return { placement: l.placement, routed: l.routed };
    }
    // Agents without a position yet (new ones) get one next to the others;
    // boxes sit where their members are.
    const placement: Placement = new Map();
    let spare = 0;
    for (const id of net.agents.keys()) {
      if (!positions.has(id)) positions.set(id, { x: spare++ * 48, y: 0, orient: "down" });
    }
    for (const id of v.net.agents.keys()) {
      const g = v.box.get(id);
      if (g === undefined) placement.set(id, positions.get(id)!);
      else {
        const ps = groups.members(g).map((a) => positions.get(a)!);
        const n = Math.max(1, ps.length);
        placement.set(id, { x: ps.reduce((s, p) => s + p.x, 0) / n, y: ps.reduce((s, p) => s + p.y, 0) / n, orient: "down" });
      }
    }
    return { placement, routed: route(v.net, placement, { pins }) };
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
    groups.of.delete(id);
  };

  /** Selected agents, with every member of selected instances. */
  const selectedAgents = (): AgentId[] => {
    const s = selection();
    if (s?.kind !== "items") return [];
    return [...new Set([...s.agents, ...[...s.groups].flatMap((g) => groups.members(g))])];
  };

  /** A view agent as something selectable: a real agent, or the instance a box stands for. */
  const itemOf = (viewId: AgentId): { agent: AgentId } | { group: GroupId } => {
    const g = view().box.get(viewId);
    return g !== undefined ? { group: g } : { agent: viewId };
  };

  return {
    rev,
    bump,
    view,
    get net() {
      return net;
    },
    get groups() {
      return groups;
    },
    get positions() {
      return positions;
    },
    defs,
    /** Replace the whole net (not undoable by itself; call `checkpoint` first if it should be). */
    setNet(n: Net, pos = new Map<AgentId, Placed>(), gs = new Groups()) {
      lastAuto = undefined;
      batch(() => {
        net = n;
        groups = gs;
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
    selectedAgents,
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

    /** The current animation frame, while a step is being animated. */
    frame,
    /** Capture the net as drawn now, to animate from after a change. */
    animSnapshot(): AnimSnapshot {
      const l = layout();
      return { net: view().net.clone(), placement: l.placement, routed: l.routed };
    },
    /** Animate from a snapshot to the net as it is now, given what the step did. */
    animate(before: AnimSnapshot, records: StepRecord[], duration = 420) {
      cancelAnimationFrame(raf);
      setFrame(undefined);
      if (!records.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const l = layout();
      let morph;
      try {
        morph = buildMorph(before, { net: view().net, placement: l.placement, routed: l.routed }, records);
      } catch (e) {
        console.error("animation failed", e);
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = (now - t0) / duration;
        if (t >= 1) return setFrame(undefined);
        setFrame(morph.at(t));
        raf = requestAnimationFrame(tick);
      };
      setFrame(morph.at(0));
      raf = requestAnimationFrame(tick);
    },

    /** Whether a view agent is selected (a box counts when its instance is). */
    isSelected(viewId: AgentId) {
      const s = selection();
      if (s?.kind !== "items") return false;
      const it = itemOf(viewId);
      return "group" in it ? s.groups.has(it.group) : s.agents.has(it.agent);
    },

    /** Click on a view agent: select it, or with `additive` toggle it in the selection. */
    pick(viewId: AgentId, additive = false) {
      const it = itemOf(viewId);
      const s = selection();
      const agents = new Set(additive && s?.kind === "items" ? s.agents : []);
      const gs = new Set(additive && s?.kind === "items" ? s.groups : []);
      if ("group" in it) gs.has(it.group) && additive ? gs.delete(it.group) : gs.add(it.group);
      else agents.has(it.agent) && additive ? agents.delete(it.agent) : agents.add(it.agent);
      setSelection(agents.size || gs.size ? { kind: "items", agents, groups: gs } : undefined);
    },

    pickGroup(g: GroupId, additive = false) {
      const s = selection();
      const agents = new Set(additive && s?.kind === "items" ? s.agents : []);
      const gs = new Set(additive && s?.kind === "items" ? s.groups : []);
      gs.add(g);
      setSelection({ kind: "items", agents, groups: gs });
    },

    /** Select every view agent in a list (from a marquee). */
    pickMany(viewIds: AgentId[], additive = false) {
      const s = selection();
      const agents = new Set(additive && s?.kind === "items" ? s.agents : []);
      const gs = new Set(additive && s?.kind === "items" ? s.groups : []);
      for (const id of viewIds) {
        const it = itemOf(id);
        if ("group" in it) gs.add(it.group);
        else agents.add(it.agent);
      }
      setSelection(agents.size || gs.size ? { kind: "items", agents, groups: gs } : undefined);
    },

    setMode(m: LayoutMode, record = true) {
      if (m === mode()) return;
      if (record) checkpoint();
      if (m === "manual") {
        // Boxes in the view stand for their members; keep members' own spots.
        const l = autoLayout(net);
        positions = new Map(l.placement);
        const v = view();
        const shown = layout().placement;
        for (const [id, p] of shown) {
          const g = v.box.get(id);
          if (g === undefined) positions.set(id, p);
          else {
            // Gather the members around where the box was drawn.
            const ms = groups.members(g);
            const cx = ms.reduce((s, a) => s + (positions.get(a)?.x ?? 0), 0) / Math.max(1, ms.length);
            const cy = ms.reduce((s, a) => s + (positions.get(a)?.y ?? 0), 0) / Math.max(1, ms.length);
            for (const a of ms) {
              const q = positions.get(a)!;
              positions.set(a, { ...q, x: q.x - cx + p.x, y: q.y - cy + p.y });
            }
          }
        }
      } else positions = new Map();
      setModeSignal(m);
      bump();
    },

    addAgent(type: string, at?: Pt) {
      checkpoint();
      const id = net.addAgent(opts.system().type(type));
      if (at && mode() === "manual") positions.set(id, { x: at.x, y: at.y, orient: "down" });
      setSelection({ kind: "items", agents: new Set([id]), groups: new Set<GroupId>() });
      bump();
      return id;
    },

    /** Place a new instance of a component. */
    addComponent(defId: string, at?: Pt) {
      const def = defs().get(defId);
      if (!def) return;
      checkpoint();
      const inst = instantiate(net, groups, def, opts.system());
      if (mode() === "manual") {
        const l = autoLayout(Net.fromJSON(def.net));
        const ps = [...l.placement.values()];
        const cx = ps.reduce((s, p) => s + p.x, 0) / Math.max(1, ps.length);
        const cy = ps.reduce((s, p) => s + p.y, 0) / Math.max(1, ps.length);
        const src = [...Net.fromJSON(def.net).agents.keys()];
        inst.agents.forEach((a, i) => {
          const p = l.placement.get(src[i]!)!;
          positions.set(a, { ...p, x: p.x - cx + (at?.x ?? 0), y: p.y - cy + (at?.y ?? 0) });
        });
      }
      setSelection({ kind: "items", agents: new Set<AgentId>(), groups: new Set([inst.group]) });
      bump();
      return inst.group;
    },

    /** Join two view ends with a wire, replacing whatever they were attached to. */
    connect(va: End, vb: End) {
      const a = view().toReal(va);
      const b = view().toReal(vb);
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
    makeFree(ve: End) {
      if (opts.fixedInterface) return;
      const e = view().toReal(ve);
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
      if (sel.kind === "items") {
        for (const g of sel.groups) {
          if (!groups.groups.has(g)) continue;
          const ms = groups.members(g);
          groups.removeTree(g);
          ms.forEach((a) => net.agents.has(a) && removeAgent(a));
        }
        for (const a of sel.agents) {
          if (!net.agents.has(a)) continue;
          // Taking an agent out of an instance breaks it.
          groups.dissolveAround([a]);
          removeAgent(a);
        }
      } else if (sel.kind === "wire" && net.wires.has(sel.id)) {
        const [a, b] = net.wire(sel.id).ends;
        for (const e of [a, b]) if (e.kind === "port") groups.dissolveAround([e.agent]);
        detach(a);
      }
      setSelection(undefined);
      bump();
    },

    removeAgentsWhere(pred: (type: string) => boolean) {
      for (const a of [...net.agents.values()]) {
        if (!pred(a.type)) continue;
        groups.dissolveAround([a.id]);
        removeAgent(a.id);
      }
      bump();
    },

    /** Instances that had agents taken away by a reduction step dissolve. */
    dissolveAround(agents: AgentId[]) {
      groups.dissolveAround(agents);
    },

    setCollapsed(g: GroupId, collapsed: boolean) {
      const grp = groups.groups.get(g);
      if (!grp || grp.collapsed === collapsed) return;
      checkpoint();
      grp.collapsed = collapsed;
      bump();
    },

    /** Manual mode: move a view agent (a box moves its whole instance). Call `checkpoint` once before a drag. */
    moveAgent(viewId: AgentId, to: Pt) {
      const g = view().box.get(viewId);
      const ids = g !== undefined ? groups.members(g) : [viewId];
      const cur = layout().placement.get(viewId);
      if (!cur) return;
      const dx = to.x - cur.x;
      const dy = to.y - cur.y;
      for (const id of ids) {
        const p = positions.get(id);
        if (p) positions.set(id, { ...p, x: p.x + dx, y: p.y + dy });
      }
      bump();
    },

    /** Manual mode: move every agent in an expanded instance. */
    moveGroup(g: GroupId, dx: number, dy: number) {
      for (const id of groups.members(g)) {
        const p = positions.get(id);
        if (p) positions.set(id, { ...p, x: p.x + dx, y: p.y + dy });
      }
      bump();
    },

    /** Manual mode: turn an agent to point the other way. */
    flipAgent(viewId: AgentId) {
      const p = positions.get(viewId);
      if (!p || mode() !== "manual" || view().box.has(viewId)) return;
      checkpoint();
      positions.set(viewId, { ...p, orient: p.orient === "down" ? "up" : "down" });
      bump();
    },

    /** Lay the net out afresh, forgetting where things were. */
    tidy() {
      lastAuto = undefined;
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
