import { batch, createMemo, createSignal } from "solid-js";
import { type Example, examples } from "../core/examples";
import { type ComponentDef, type GroupId, Groups, extract, refresh, uses } from "../core/groups";
import { type AgentId, type AgentType, Net, type WireId } from "../core/net";
import { type Stats, type StepRecord, emptyStats, interact, isActive, parallelStep } from "../core/reduce";
import { type Rule, System, type SystemJSON, pairKey } from "../core/system";
import { type PortSpec, type Typing, badWires, canMeet, flip, specOf } from "../core/types";
import type { Placed, Placement } from "../layout/geometry";
import { autoLayout } from "../layout/place";
import { createNetModel } from "./model";
import { type Doc, decode, saveLocal } from "./persist";

export type { Layout, Selection } from "./model";

/** The main editor: a net model plus the interaction system, reduction, and saving. */
export function createEditor(initial: Doc | undefined) {
  let system = new System();
  let library = new Map<string, ComponentDef>();
  const [sysRev, setSysRev] = createSignal(0);
  const touchSystem = () => setSysRev((r) => r + 1);
  const defs = () => (sysRev(), library as ReadonlyMap<string, ComponentDef>);

  const model = createNetModel({
    system: () => system,
    defs,
    extra: {
      save: () => ({ system: system.toJSON(), components: [...library.values()] }),
      load: (j) => {
        const x = j as { system: SystemJSON; components: ComponentDef[] };
        system = System.fromJSON(x.system);
        library = new Map(x.components.map((d) => [d.id, d]));
        touchSystem();
      },
    },
  });

  const [stats, setStats] = createSignal<Stats>(emptyStats());
  /** Steps taken this run: single firings and parallel steps alike. */
  const [steps, setSteps] = createSignal(0);
  const [running, setRunning] = createSignal(false);
  const [message, setMessage] = createSignal<string>();
  /** A message with an Undo button, after something that replaced the net. */
  const [undoable, setUndoable] = createSignal(false);
  const notify = (text: string, canUndo = false) => {
    setUndoable(canUndo);
    setMessage(text);
  };
  /** How fast steps animate: 1 is normal, below 1 is slow motion. */
  const [speed, setSpeedSignal] = createSignal(readSpeed());
  const setSpeed = (s: number) => {
    setSpeedSignal(s);
    try {
      localStorage.setItem(SPEED_KEY, String(s));
    } catch {
      // ignore
    }
  };
  const stepDuration = () => 420 / speed();
  const resetRun = () => {
    setStats(emptyStats());
    setSteps(0);
  };
  /** The pair whose rule is open in the rule editor. */
  const [ruleOpen, setRuleOpen] = createSignal<[string, string]>();
  /** The component open in the component editor. */
  const [componentOpen, setComponentOpen] = createSignal<string>();
  const [translateOpen, setTranslateOpen] = createSignal(false);
  const [textOpen, setTextOpen] = createSignal(false);
  /** The directions and types sheet. */
  const [typesOpen, setTypesOpen] = createSignal(false);
  /** The agent open in the agent editor, or "new" for one being made. */
  const [agentOpen, setAgentOpen] = createSignal<string>();

  /** Changes to the net or to the system. */
  const rev = createMemo(() => model.rev() + sysRev() * 1e6);

  const toDoc = (): Doc => ({
    v: 1,
    system: system.toJSON(),
    net: model.net.toJSON(),
    mode: model.mode(),
    positions: model.mode() === "manual" ? [...model.positions] : undefined,
    components: [...library.values()],
    groups: model.groups.toJSON(),
  });

  const restore = (doc: Doc) => {
    const d = decode(doc);
    batch(() => {
      system = d.system;
      library = new Map(d.components.map((c) => [c.id, c]));
      touchSystem();
      model.setNet(d.net, new Map(), d.groups);
      model.restoreView(d.mode, d.positions);
    });
  };

  const missingRules = createMemo(() => {
    rev();
    const types = [...system.types.keys()];
    const missing: [string, string][] = [];
    types.forEach((a, i) =>
      types.slice(i).forEach((b) => !system.ruleFor(a, b) && !canMeet(system, a, b) && missing.push([a, b])),
    );
    return missing;
  });

  /** Place new agents from a reduction step near where the pair used to be. */
  const placeCreated = (removed: AgentId[], created: AgentId[], before: Placement) => {
    if (model.mode() !== "manual") return;
    const old = removed.map((id) => before.get(id)).filter((p): p is Placed => !!p);
    const cx = old.reduce((s, p) => s + p.x, 0) / Math.max(1, old.length);
    const cy = old.reduce((s, p) => s + p.y, 0) / Math.max(1, old.length);
    created.forEach((id, i) =>
      model.positions.set(id, { x: cx + (i - (created.length - 1) / 2) * 44, y: cy, orient: i % 2 ? "up" : "down" }),
    );
    removed.forEach((id) => model.positions.delete(id));
  };

  const fire = (w: WireId) => {
    const net = model.net;
    if (!net.wires.has(w) || !isActive(net, w)) return;
    const recs: StepRecord[] = [];
    model.checkpoint();
    const before = model.layout().placement;
    const snap = model.animSnapshot();
    try {
      const rec = interact(net, system, w);
      placeCreated(rec.removed, rec.created, before);
      model.dissolveAround(rec.removed);
      recs.push(rec);
      setStats((s) => {
        const byRule = new Map(s.byRule);
        const k = pairKey(rec.rule.left, rec.rule.right);
        byRule.set(k, (byRule.get(k) ?? 0) + 1);
        return { ...s, interactions: s.interactions + 1, byRule };
      });
    } catch (e) {
      setMessage((e as Error).message);
    }
    if (recs.length) setSteps((n) => n + 1);
    model.setSelection(undefined);
    model.bump();
    model.animate(snap, recs, false, stepDuration());
  };

  const stepOne = () => {
    const [w] = model.activeWires();
    if (w !== undefined) fire(w);
  };

  const stepAll = (record = true): boolean => {
    if (model.activeWires().size === 0) return false;
    if (record) model.checkpoint();
    const before = model.layout().placement;
    const snap = model.animSnapshot();
    const s: Stats = { ...stats(), byRule: new Map(stats().byRule) };
    const recs = parallelStep(model.net, system, s);
    for (const r of recs) {
      placeCreated(r.removed, r.created, before);
      model.dissolveAround(r.removed);
    }
    setStats(s);
    if (recs.length) setSteps((n) => n + 1);
    model.setSelection(undefined);
    model.bump();
    model.animate(snap, recs, false, stepDuration());
    return recs.length > 0;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    setRunning(false);
  };
  const run = () => {
    if (running()) return stop();
    if (model.activeWires().size === 0) return;
    model.checkpoint();
    setRunning(true);
    let rounds = 0;
    const tick = () => {
      if (!stepAll(false) || ++rounds >= 2000) return stop();
      // Leave each step a moment on screen once it has finished moving.
      timer = setTimeout(tick, stepDuration() + 140);
    };
    timer = setTimeout(tick, 0);
  };

  /** Manual mode: lay a fresh instance's agents out around a point, as its definition would be drawn. */
  const placeInstance = (agents: AgentId[], def: ComponentDef, at: { x: number; y: number }) => {
    if (model.mode() !== "manual") return;
    const src = Net.fromJSON(def.net);
    const l = autoLayout(src);
    const ps = [...l.placement.values()];
    const cx = ps.reduce((s, p) => s + p.x, 0) / Math.max(1, ps.length);
    const cy = ps.reduce((s, p) => s + p.y, 0) / Math.max(1, ps.length);
    [...src.agents.keys()].forEach((id, i) => {
      const p = l.placement.get(id);
      const a = agents[i];
      if (p && a !== undefined) model.positions.set(a, { ...p, x: p.x - cx + at.x, y: p.y - cy + at.y });
    });
  };

  /** Instances of the given definitions not inside another such instance. */
  const topmost = (gs: Groups, changed: Set<string>) =>
    [...gs.groups.values()]
      .filter((g) => changed.has(g.def) && !gs.chain(g.parent).some((h) => changed.has(gs.groups.get(h)!.def)))
      .map((g) => g.id);

  /** Rebuild instances of changed definitions, both in other definitions and in the net. */
  const propagate = (id: string) => {
    const changed = new Set([id]);
    // Definitions that use this one, innermost first, so each rebuild sees updated parts.
    const pending = [...library.values()].filter((d) => d.id !== id && uses(library, d.id, id));
    while (pending.length) {
      const i = pending.findIndex((d) =>
        d.groups.groups.every((g) => changed.has(g.def) || !pending.some((p) => p.id === g.def)),
      );
      const [d] = pending.splice(i < 0 ? 0 : i, 1);
      const n = Net.fromJSON(d!.net);
      const gs = Groups.fromJSON(d!.groups);
      for (const g of topmost(gs, changed)) refresh(n, gs, g, library.get(gs.groups.get(g)!.def)!, system);
      library.set(d!.id, { ...d!, net: n.toJSON(), groups: gs.toJSON() });
      changed.add(d!.id);
    }
    const shown = model.layout().placement;
    for (const g of topmost(model.groups, changed)) {
      const members = model.groups.members(g);
      const ps = members.map((a) => model.positions.get(a)).filter((p) => !!p);
      const center = ps.length
        ? { x: ps.reduce((s, p) => s + p!.x, 0) / ps.length, y: ps.reduce((s, p) => s + p!.y, 0) / ps.length }
        : (shown.get(-g) ?? { x: 0, y: 0 });
      const def = library.get(model.groups.groups.get(g)!.def)!;
      const fresh = refresh(model.net, model.groups, g, def, system);
      members.forEach((a) => model.positions.delete(a));
      placeInstance(fresh, def, center);
    }
  };

  const slug = (name: string) => {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "component";
    let id = base;
    for (let i = 2; library.has(id); i++) id = `${base}-${i}`;
    return id;
  };

  /**
   * Wires that no longer fit, after the system's types changed or a net was
   * loaded, are cut into loose ends: an ill-typed wire never stays on the
   * canvas. Part of an edit already under way. Returns how many were cut.
   */
  const enforceTypes = (): number => {
    const bad = badWires(model.net, system);
    if (bad.size) model.cutWires([...bad.keys()]);
    return bad.size;
  };
  const cutMessage = (n: number) => (n === 1 ? "Cut 1 wire that didn't fit the types." : `Cut ${n} wires that didn't fit the types.`);

  /** Replace an agent type's ports, keeping everything else about it. */
  const withPorts = (id: string, ports: PortSpec[]) => {
    const t = system.type(id);
    system.types.set(id, { ...t, ports });
  };

  /** Remove agents of a type from the net, and every rule that mentions it. */
  const dropType = (id: string) => {
    model.removeAgentsWhere((t) => t === id);
    for (const [k, r] of system.rules) if (r.left === id || r.right === id || r.agents.includes(id)) system.rules.delete(k);
  };

  return {
    model,
    rev,
    get net() {
      return model.net;
    },
    get system() {
      return system;
    },
    stats,
    steps,
    running,
    message,
    setMessage: (m: string | undefined) => {
      setUndoable(false);
      setMessage(m);
    },
    undoable,
    notify,
    speed,
    setSpeed,
    missingRules,
    fire,
    stepOne,
    stepAll: () => stepAll(),
    run,
    stop,
    toDoc,
    save: () => saveLocal(toDoc()),
    ruleOpen,
    openRule: (a: string, b: string) => setRuleOpen([a, b]),
    closeRule: () => setRuleOpen(undefined),

    load(doc: Doc) {
      stop();
      model.checkpoint();
      restore(doc);
      const n = enforceTypes();
      if (n) {
        model.bump();
        notify(cutMessage(n), true);
      }
      resetRun();
      model.requestFit();
    },

    loadExample(ex: Example, quiet = false) {
      stop();
      model.checkpoint();
      batch(() => {
        system = ex.system();
        touchSystem();
        library = new Map();
        model.setNet(ex.net(system));
        model.restoreView("auto", new Map());
        resetRun();
      });
      model.requestFit();
      if (!quiet) notify(`Loaded ${ex.name}.`, true);
    },

    clearNet() {
      stop();
      model.checkpoint();
      model.setNet(new Net());
      resetRun();
      notify("Cleared the net.", true);
    },

    addType(t: AgentType) {
      model.checkpoint();
      system.addType(t);
      touchSystem();
    },

    /**
     * Change an agent type. Changing its arity removes agents of that type
     * from the net, and their rules; wires that stop fitting are cut.
     */
    updateType(id: string, t: Omit<AgentType, "id">) {
      model.checkpoint();
      if (system.type(id).arity !== t.arity) dropType(id);
      system.types.set(id, { ...t, id });
      const n = enforceTypes();
      touchSystem();
      model.bump();
      if (n) notify(cutMessage(n), true);
    },

    /** Wires that would stop fitting if an agent type's ports changed like this. */
    conflicts(id: string, ports: PortSpec[], typing = system.typing): WireId[] {
      const trial = System.fromJSON(system.toJSON());
      trial.typing = typing;
      if (trial.types.has(id)) trial.types.set(id, { ...trial.type(id), ports });
      return [...badWires(model.net, trial).keys()];
    },

    /** Set one port's direction or type (or label), from the directions and types sheet. */
    setPort(id: string, slot: number, patch: Partial<PortSpec>) {
      model.checkpoint();
      const t = system.type(id);
      const ports = Array.from({ length: t.arity + 1 }, (_, s) => ({ ...(t.ports?.[s] ?? {}) }));
      ports[slot] = { ...ports[slot], ...patch };
      for (const k of ["pol", "type", "label"] as const) if (ports[slot]![k] === undefined) delete ports[slot]![k];
      withPorts(id, ports);
      const n = enforceTypes();
      touchSystem();
      model.bump();
      if (n) notify(cutMessage(n), true);
    },

    /** Change how strict the system is. Turning a dimension off forgets it on every port. */
    setTyping(next: Partial<Typing>) {
      model.checkpoint();
      const typing = { ...system.typing, ...next };
      for (const t of [...system.types.values()]) {
        if (!t.ports) continue;
        const ports = t.ports.map((p) => {
          const q = { ...p };
          if (typing.dirs === "off") delete q.pol;
          if (typing.types === "off") delete q.type;
          return q;
        });
        system.types.set(t.id, { ...t, ports });
      }
      if (typing.types === "off") typing.names = [];
      system.typing = typing;
      const n = enforceTypes();
      touchSystem();
      model.bump();
      if (n) notify(cutMessage(n), true);
    },

    addTypeName(name: string) {
      const n = name.trim();
      if (!n || system.typing.names.includes(n)) return;
      model.checkpoint();
      system.typing = { ...system.typing, names: [...system.typing.names, n] };
      touchSystem();
    },

    renameTypeName(from: string, to: string): string | undefined {
      const n = to.trim();
      if (!n || n === from) return;
      if (system.typing.names.includes(n)) return `There's already a type called ${n}.`;
      model.checkpoint();
      system.typing = { ...system.typing, names: system.typing.names.map((x) => (x === from ? n : x)) };
      for (const t of [...system.types.values()]) {
        if (t.ports?.some((p) => p.type === from)) withPorts(t.id, t.ports.map((p) => (p.type === from ? { ...p, type: n } : p)));
      }
      touchSystem();
      model.bump();
    },

    /** Forget a type: its ports fit anything again, so no wire breaks. */
    deleteTypeName(name: string) {
      model.checkpoint();
      system.typing = { ...system.typing, names: system.typing.names.filter((x) => x !== name) };
      for (const t of [...system.types.values()]) {
        if (!t.ports?.some((p) => p.type === name)) continue;
        withPorts(t.id, t.ports.map((p) => { if (p.type !== name) return p; const { type: _, ...rest } = p; return rest; }));
      }
      touchSystem();
      model.bump();
    },

    /** Fill in missing directions and types from what the ports are wired to on the canvas. Returns how many it filled. */
    guessPorts(what: "dir" | "type" | "both" = "both"): number {
      const net = model.net;
      // For each agent type, a guess per slot from the first wired port that says something.
      const guesses = new Map<string, PortSpec[]>();
      for (const a of net.agents.values()) {
        const t = system.types.get(a.type);
        if (!t) continue;
        const gs = guesses.get(a.type) ?? Array.from({ length: t.arity + 1 }, () => ({}) as PortSpec);
        guesses.set(a.type, gs);
        a.wires.forEach((_, slot) => {
          const p = net.partner({ kind: "port", agent: a.id, slot });
          if (p?.kind !== "port") return;
          const there = flip(specOf(system, net.agent(p.agent).type, p.slot));
          if (what !== "type" && there.pol && !t.ports?.[slot]?.pol) gs[slot]!.pol ??= there.pol;
          if (what !== "dir" && there.type && !t.ports?.[slot]?.type) gs[slot]!.type ??= there.type;
        });
      }
      const n = [...guesses.values()].flat().reduce((k, g) => k + (g.pol ? 1 : 0) + (g.type ? 1 : 0), 0);
      if (!n) return 0;
      model.checkpoint();
      for (const [id, gs] of guesses) {
        const t = system.type(id);
        withPorts(id, Array.from({ length: t.arity + 1 }, (_, s) => ({ ...gs[s], ...(t.ports?.[s] ?? {}) })));
      }
      enforceTypes();
      touchSystem();
      model.bump();
      return n;
    },

    removeType(id: string) {
      model.checkpoint();
      dropType(id);
      system.types.delete(id);
      if (model.armed() === id) model.setArmed(undefined);
      touchSystem();
      model.bump();
    },

    /** Save a rule from the rule editor, replacing any rule for the same pair. */
    saveRule(rule: Rule) {
      model.checkpoint();
      system.rules.delete(pairKey(rule.left, rule.right));
      system.rules.delete(pairKey(rule.right, rule.left));
      system.addRule(rule);
      touchSystem();
      model.bump();
    },

    deleteRule(a: string, b: string) {
      model.checkpoint();
      system.rules.delete(pairKey(a, b));
      system.rules.delete(pairKey(b, a));
      touchSystem();
      model.bump();
    },

    defs,

    /** Make a component from the selection; the selection becomes its first instance. */
    makeComponent(name: string, symbol: string): GroupId | undefined {
      const agents = model.selectedAgents();
      if (!agents.length) return;
      model.checkpoint();
      const gs = model.groups;
      const inside = new Set(agents);
      // Instances straddling the edge of the selection are broken up.
      for (const g of [...gs.groups.keys()]) {
        if (!gs.groups.has(g)) continue;
        const ms = gs.members(g);
        if (ms.some((a) => inside.has(a)) && !ms.every((a) => inside.has(a))) gs.dissolve(g);
      }
      const shown = model.layout().placement;
      const xOf = (a: AgentId) => {
        const p = shown.get(a);
        if (p) return p.x;
        const outer = gs.chain(gs.of.get(a)).find((h) => shown.has(-h));
        return outer !== undefined ? shown.get(-outer)!.x : 0;
      };
      const id = slug(name);
      const { def, boundary } = extract(model.net, gs, agents, { id, name: name.trim() || id, symbol }, (e) =>
        e.kind === "port" ? xOf(e.agent) : 0,
      );
      library.set(id, def);
      const g = gs.add({ def: id, iface: boundary, collapsed: true });
      for (const h of gs.groups.values()) {
        if (h.id !== g && h.parent === undefined && gs.members(h.id).every((a) => inside.has(a))) h.parent = g;
      }
      for (const a of agents) if (!gs.of.has(a)) gs.of.set(a, g);
      touchSystem();
      model.bump();
      model.pickGroup(g);
      return g;
    },

    /** Save an edited definition and rebuild every instance of it. */
    updateComponent(id: string, net: Net, groups: Groups, meta: { name: string; symbol: string }): string | undefined {
      const old = library.get(id);
      if (!old) return "That component no longer exists.";
      for (const w of net.wires.values()) {
        if (w.ends[0].kind === "free" && w.ends[1].kind === "free") return "Interface ports can't be wired straight to each other.";
      }
      model.checkpoint();
      const names = [...net.free.keys()];
      const iface = [...old.iface.filter((n) => names.includes(n)), ...names.filter((n) => !old.iface.includes(n))];
      library.set(id, { ...old, ...meta, net: net.toJSON(), groups: groups.toJSON(), iface });
      propagate(id);
      touchSystem();
      model.bump();
      return undefined;
    },

    /** Start a new, empty component. Returns its id, for opening in the component editor. */
    newComponent(): string {
      model.checkpoint();
      const id = slug("component");
      library.set(id, { id, name: "New component", symbol: "C", net: new Net().toJSON(), groups: new Groups().toJSON(), iface: [] });
      touchSystem();
      return id;
    },

    deleteComponent(id: string): string | undefined {
      const users = [...library.values()].filter((d) => d.id !== id && d.groups.groups.some((g) => g.def === id));
      if (users.length) return `It's used inside ${users.map((u) => u.name).join(", ")}.`;
      model.checkpoint();
      for (const g of [...model.groups.groups.values()]) if (g.def === id && model.groups.groups.has(g.id)) model.groups.dissolve(g.id);
      library.delete(id);
      touchSystem();
      model.bump();
      return undefined;
    },

    /** Turn selected instances back into loose agents. */
    breakApart() {
      const s = model.selection();
      if (s?.kind !== "items" || !s.groups.size) return;
      model.checkpoint();
      for (const g of s.groups) if (model.groups.groups.has(g)) model.groups.dissolve(g);
      model.setSelection(undefined);
      model.bump();
    },

    addComponent(id: string) {
      const g = model.addComponent(id);
      if (g !== undefined) model.bump();
    },

    agentOpen,
    openAgent: (id: string) => setAgentOpen(id),
    closeAgent: () => setAgentOpen(undefined),
    typesOpen,
    openTypes: () => setTypesOpen(true),
    closeTypes: () => setTypesOpen(false),
    textOpen,
    openText: () => setTextOpen(true),
    closeText: () => setTextOpen(false),
    /** Replace everything with a parsed system and net. */
    loadParsed(sys: System, net: Net) {
      stop();
      model.checkpoint();
      batch(() => {
        system = sys;
        library = new Map();
        touchSystem();
        model.setNet(net);
        model.restoreView("auto", new Map());
        resetRun();
      });
      const n = enforceTypes();
      if (n) model.bump();
      model.requestFit();
      return n;
    },
    translateOpen,
    /** Open the combinator translation, if the net is ready for it. */
    openTranslate() {
      if (model.net.unconnected().length) return setMessage("Wire up every port before translating.");
      stop();
      setTranslateOpen(true);
    },
    closeTranslate: () => setTranslateOpen(false),
    componentOpen,
    openComponent: (id: string) => setComponentOpen(id),
    closeComponent: () => setComponentOpen(undefined),

    examples,
    init() {
      if (initial) {
        try {
          restore(initial);
        } catch {
          this.loadExample(examples[0]!, true);
        }
      } else this.loadExample(examples[0]!, true);
      model.clearHistory();
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;

const SPEED_KEY = "netties:speed";

function readSpeed(): number {
  try {
    const s = Number(localStorage.getItem(SPEED_KEY));
    return s > 0 ? s : 1;
  } catch {
    return 1;
  }
}
