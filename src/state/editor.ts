import { batch, createMemo, createSignal } from "solid-js";
import { type Example, examples } from "../core/examples";
import { type ComponentDef, type GroupId, Groups, extract, refresh, uses } from "../core/groups";
import { type AgentId, type AgentType, Net, type WireId } from "../core/net";
import { type Stats, type StepRecord, emptyStats, interact, isActive, parallelStep } from "../core/reduce";
import { type Rule, System, type SystemJSON, pairKey } from "../core/system";
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
  const [running, setRunning] = createSignal(false);
  const [message, setMessage] = createSignal<string>();
  /** The pair whose rule is open in the rule editor. */
  const [ruleOpen, setRuleOpen] = createSignal<[string, string]>();
  /** The component open in the component editor. */
  const [componentOpen, setComponentOpen] = createSignal<string>();

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
    types.forEach((a, i) => types.slice(i).forEach((b) => !system.ruleFor(a, b) && missing.push([a, b])));
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
    model.setSelection(undefined);
    model.bump();
    model.animate(snap, recs);
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
    model.setSelection(undefined);
    model.bump();
    model.animate(snap, recs);
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
    if (model.activeWires().size === 0) return;
    model.checkpoint();
    setRunning(true);
    let rounds = 0;
    timer = setInterval(() => {
      if (!stepAll(false) || ++rounds >= 2000) stop();
    }, 560);
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
    running,
    message,
    setMessage,
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
      setStats(emptyStats());
      model.requestFit();
    },

    loadExample(ex: Example) {
      stop();
      model.checkpoint();
      batch(() => {
        system = ex.system();
        touchSystem();
        library = new Map();
        model.setNet(ex.net(system));
        model.restoreView("auto", new Map());
        setStats(emptyStats());
      });
      model.requestFit();
    },

    clearNet() {
      stop();
      model.checkpoint();
      model.setNet(new Net());
      setStats(emptyStats());
    },

    addType(t: AgentType) {
      model.checkpoint();
      system.addType(t);
      touchSystem();
    },

    /** Change an agent type. Changing its arity removes agents of that type from the net, and their rules. */
    updateType(id: string, t: Omit<AgentType, "id">) {
      model.checkpoint();
      if (system.type(id).arity !== t.arity) dropType(id);
      system.types.set(id, { ...t, id });
      touchSystem();
      model.bump();
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

    componentOpen,
    openComponent: (id: string) => setComponentOpen(id),
    closeComponent: () => setComponentOpen(undefined),

    examples,
    init() {
      if (initial) {
        try {
          restore(initial);
        } catch {
          this.loadExample(examples[0]!);
        }
      } else this.loadExample(examples[0]!);
      model.clearHistory();
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;
