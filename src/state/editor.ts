import { batch, createMemo, createSignal } from "solid-js";
import { type Example, examples } from "../core/examples";
import { type AgentId, type AgentType, Net, type WireId } from "../core/net";
import { type Stats, emptyStats, interact, isActive, parallelStep } from "../core/reduce";
import { type Rule, System, type SystemJSON, pairKey } from "../core/system";
import type { Placed, Placement } from "../layout/geometry";
import { createNetModel } from "./model";
import { type Doc, decode, saveLocal } from "./persist";

export type { Layout, Selection } from "./model";

/** The main editor: a net model plus the interaction system, reduction, and saving. */
export function createEditor(initial: Doc | undefined) {
  let system = new System();
  const [sysRev, setSysRev] = createSignal(0);
  const touchSystem = () => setSysRev((r) => r + 1);

  const model = createNetModel({
    system: () => system,
    extra: {
      save: () => system.toJSON(),
      load: (j) => {
        system = System.fromJSON(j as SystemJSON);
        touchSystem();
      },
    },
  });

  const [stats, setStats] = createSignal<Stats>(emptyStats());
  const [running, setRunning] = createSignal(false);
  const [message, setMessage] = createSignal<string>();
  /** The pair whose rule is open in the rule editor. */
  const [ruleOpen, setRuleOpen] = createSignal<[string, string]>();

  /** Changes to the net or to the system. */
  const rev = createMemo(() => model.rev() + sysRev() * 1e6);

  const toDoc = (): Doc => ({
    v: 1,
    system: system.toJSON(),
    net: model.net.toJSON(),
    mode: model.mode(),
    positions: model.mode() === "manual" ? [...model.positions] : undefined,
  });

  const restore = (doc: Doc) => {
    const d = decode(doc);
    batch(() => {
      system = d.system;
      touchSystem();
      model.setNet(d.net);
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
    model.checkpoint();
    const before = model.layout().placement;
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
    model.setSelection(undefined);
    model.bump();
  };

  const stepOne = () => {
    const [w] = model.activeWires();
    if (w !== undefined) fire(w);
  };

  const stepAll = (record = true): boolean => {
    if (model.activeWires().size === 0) return false;
    if (record) model.checkpoint();
    const before = model.layout().placement;
    const s: Stats = { ...stats(), byRule: new Map(stats().byRule) };
    const recs = parallelStep(model.net, system, s);
    for (const r of recs) placeCreated(r.removed, r.created, before);
    setStats(s);
    model.setSelection(undefined);
    model.bump();
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
    }, 380);
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
