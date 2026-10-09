import { batch, createMemo, createSignal } from "solid-js";
import { type Frame, type Snapshot as AnimSnapshot, buildMorph } from "../anim/morph";
import { type Defs, type GroupId, Groups, type GroupsJSON, collapse, instantiate } from "../core/groups";
import { type AgentId, type End, Net, NONE, type NetJSON, type WireId, free, port, sameEnd } from "../core/net";
import { type StepRecord, redexes } from "../core/reduce";
import type { System } from "../core/system";
import { G, type Placed, type Placement, type Pt, portPos } from "../layout/geometry";
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

/**
 * Dragging a wire end. From an empty end it draws a new wire; from an end
 * that has a wire, it unplugs that end and carries it, leaving the end it
 * came from empty. The other end of the wire, the anchor, stays put.
 */
export type WireGesture =
  | { kind: "new"; from: End }
  | { kind: "carry"; wire: WireId; moving: End; anchor: End };

/** What letting go of a wire end over some end would do. */
export type DropCheck =
  | { kind: "ok"; join: boolean }
  | { kind: "back" }
  | { kind: "refuse"; why: string };

/** What the pointer is over, for the hover panel and for highlighting. */
export type Hover =
  | { kind: "agent"; id: AgentId }
  | { kind: "port"; end: End }
  | { kind: "free"; name: string }
  | { kind: "wire"; id: WireId }
  | { kind: "group"; id: GroupId }
  | { kind: "drag"; gesture: WireGesture; target?: End; check?: DropCheck }
  | { kind: "type"; id: string }
  | { kind: "component"; id: string }
  | { kind: "pair"; a: string; b: string };

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
  const [hover, setHover] = createSignal<Hover>();
  /** Where agents just dropped from the palette were let go, to animate them from there. */
  const spawnAt = new Map<AgentId, Pt>();
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const [historySize, setHistorySize] = createSignal({ undo: 0, redo: 0 });

  const [frame, setFrame] = createSignal<Frame>();
  let raf = 0;

  /**
   * The net as drawn just before the current edit. The next `bump` animates
   * from it to the result, so a change re-lays the net out smoothly instead
   * of jumping. Steps animate themselves, with their records.
   */
  let pending: AnimSnapshot | undefined;

  const bump = () => {
    setRev((r) => r + 1);
    const before = pending;
    if (!before) return;
    // Let the rest of the edit finish first; a step may still claim it.
    queueMicrotask(() => {
      if (pending !== before) return;
      pending = undefined;
      animate(before, [], true);
    });
  };
  /** Animate the next change from the net as it's drawn now. */
  const expectEdit = () => {
    if (!pending) pending = animSnapshot();
  };
  /** Changes that follow the pointer, or replace the net wholesale, shouldn't animate. */
  const noAnimation = () => {
    pending = undefined;
    cancelAnimationFrame(raf);
    if (frame()) setFrame(undefined);
  };
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
    expectEdit();
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    setHistorySize({ undo: undoStack.length, redo: 0 });
  };

  const undo = () => {
    const prev = undoStack.pop();
    if (!prev) return;
    expectEdit();
    redoStack.push(snapshot());
    restoreSnapshot(prev);
    setHistorySize({ undo: undoStack.length, redo: redoStack.length });
  };

  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    expectEdit();
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

  /** Capture the net as drawn now, to animate from after a change. */
  function animSnapshot(): AnimSnapshot {
    const l = layout();
    return { net: view().net.clone(), sys: view().sys, placement: l.placement, routed: l.routed };
  }

  /** Animate from a snapshot to the net as it is now, given what the step did (if it was a step). */
  function animate(before: AnimSnapshot, records: StepRecord[], edit = false, duration = 420) {
    pending = undefined;
    cancelAnimationFrame(raf);
    setFrame(undefined);
    const spawned = spawnAt.size > 0;
    if ((!records.length && !edit && !spawned) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const l = layout();
    let morph;
    try {
      // An agent coming out of a collapsed instance, or going into one, moves via its box.
      const boxOf = (shown: Placement) => (id: AgentId) =>
        id < 0 ? undefined : groups.chain(groups.of.get(id)).map((g) => -g).find((b) => shown.has(b));
      const dropped = new Map(spawnAt);
      morph = buildMorph(before, { net: view().net, sys: view().sys, placement: l.placement, routed: l.routed }, records, {
        from: boxOf(before.placement),
        to: boxOf(l.placement),
        origin: (id) => dropped.get(id),
      });
    } catch (e) {
      console.error("animation failed", e);
      return;
    } finally {
      spawnAt.clear();
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
  }

  /** What dropping the end held in `g` onto `to` would do. Ends are view ends. */
  function checkDrop(g: WireGesture, to: End): DropCheck {
    const v = view().net;
    const anchor = g.kind === "new" ? g.from : g.anchor;
    if (g.kind === "carry" && sameEnd(to, g.moving)) return { kind: "back" };
    if (sameEnd(to, anchor)) {
      return { kind: "refuse", why: g.kind === "new" ? "That's where this wire starts." : "That's the other end of this wire." };
    }
    const w = v.wireAt(to);
    if (w === NONE) return { kind: "ok", join: false };
    if (to.kind === "port") return { kind: "refuse", why: "This port already has a wire. Each port takes exactly one." };
    if (opts.fixedInterface) return { kind: "refuse", why: "This interface port already has a wire." };
    return { kind: "ok", join: true };
  }

  /** Where the wire would run if the held end were let go over `to`, or at `pt` over empty canvas. */
  function previewWire(g: WireGesture, to: End | undefined, pt: Pt): Pt[] | undefined {
    const v = view();
    const l = layout();
    const tmp = v.net.clone();
    const placement = new Map(l.placement);
    const anchor = g.kind === "new" ? g.from : g.anchor;
    // A loose end has no place of its own until the router puts it on an edge.
    if (anchor.kind === "free") return undefined;
    if (g.kind === "carry") {
      tmp.disconnect(g.wire);
      if (g.moving.kind === "free") tmp.free.delete(g.moving.name);
    }
    let other: End | undefined;
    if (to && checkDrop(g, to).kind === "ok") {
      const w = tmp.wireAt(to);
      if (w === NONE) other = to;
      else if (to.kind === "free") {
        other = tmp.partner(to);
        tmp.disconnect(w);
        tmp.free.delete(to.name);
      }
    }
    if (!other) {
      // Over empty canvas: aim at a stand-in port under the pointer, facing the wire.
      const a = portPos(placement.get(anchor.agent)!, tmp.agent(anchor.agent).wires.length - 1, anchor.slot);
      const facing = a.dir === "down" ? (pt.y > a.y ? "up" : "down") : pt.y < a.y ? "down" : "up";
      const probe = tmp.addAgent({ id: "·", name: "", symbol: "", arity: 0 });
      placement.set(probe, { x: pt.x, y: facing === "up" ? pt.y + G.circleR : pt.y - G.circleR, orient: facing });
      other = port(probe, 0);
    }
    try {
      const id = tmp.connect(anchor, other);
      return route(tmp, placement, { pins: opts.pins?.() }).wires.get(id);
    } catch {
      return undefined;
    }
  }

  return {
    rev,
    bump,
    hover,
    setHover,
    checkDrop,
    previewWire,

    /** What dragging from a view end would do. */
    gestureAt(e: End): WireGesture {
      const v = view().net;
      const w = v.wireAt(e);
      if (w === NONE) return { kind: "new", from: e };
      return { kind: "carry", wire: w, moving: e, anchor: v.partner(e)! };
    },

    /**
     * Let go of a wire end: over an end, or over empty canvas (`to` unset),
     * where it becomes a loose end, a free port of the net.
     */
    finishGesture(g: WireGesture, to?: End) {
      if (to && checkDrop(g, to).kind !== "ok") return;
      if (!to && g.kind === "carry" && g.moving.kind === "free") return;
      if (!to && g.kind === "new" && opts.fixedInterface) return;
      const v = view();
      checkpoint();
      const anchor = v.toReal(g.kind === "new" ? g.from : g.anchor);
      // Carrying keeps the wire's identity, so it's animated as the same wire moving.
      let reuse: WireId | undefined;
      if (g.kind === "carry") {
        const moving = v.toReal(g.moving);
        net.disconnect(g.wire);
        reuse = g.wire;
        if (moving.kind === "free" && !opts.fixedInterface) net.free.delete(moving.name);
      }
      if (!to) {
        if (!opts.fixedInterface) {
          const name = nextFreeName();
          net.free.set(name, NONE);
          net.connect(anchor, free(name), reuse);
        }
      } else {
        const t = v.toReal(to);
        const w = net.wireAt(t);
        if (w === NONE) net.connect(anchor, t, reuse);
        else {
          // Joining a loose end: the two wires become one.
          const other = net.partner(t)!;
          net.disconnect(w);
          if (t.kind === "free") net.free.delete(t.name);
          net.connect(anchor, other, reuse ?? w);
        }
      }
      setSelection(undefined);
      bump();
    },

    /** Change the type of some agents to another type with the same number of aux ports. */
    changeType(ids: AgentId[], type: string) {
      const t = opts.system().types.get(type);
      const ok = ids.filter((id) => net.agents.has(id) && net.agent(id).wires.length - 1 === t?.arity);
      if (!ok.length) return;
      checkpoint();
      for (const id of ok) net.agent(id).type = type;
      bump();
    },
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
      noAnimation();
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

    /** The current animation frame, while a change is being animated. */
    frame,
    animSnapshot,
    animate,

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
      else if (at) spawnAt.set(id, at);
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
      noAnimation();
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
      noAnimation();
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
      expectEdit();
      lastAuto = undefined;
      bump();
    },

    /** Restore mode and positions directly, e.g. when loading a saved document. */
    restoreView(m: LayoutMode, pos: Map<AgentId, Placed>) {
      noAnimation();
      positions = pos;
      setModeSignal(m);
      bump();
    },
  };
}

export type NetModel = ReturnType<typeof createNetModel>;
