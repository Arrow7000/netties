import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { canonical } from "../core/canon";
import { isCellRoot, reduceWith } from "../core/catchup";
import { type ComponentDef, Groups } from "../core/groups";
import { type AgentId, Net, type WireId } from "../core/net";
import { combinators } from "../core/presets";
import { interact, isActive, parallelStep } from "../core/reduce";
import { pairKey } from "../core/system";
import { type Mode, type Translation, TranslationError, translation } from "../core/translate";
import type { Editor } from "../state/editor";
import { createNetModel } from "../state/model";
import { Canvas } from "./Canvas";

/** Bigger than this and the combinator side shows counts instead of a drawing. */
const DRAW_LIMIT = 2500;
const COMBINATORS = combinators();

/**
 * Side by side: the net as it is, and its translation into Lafont's
 * interaction combinators. Each translated agent starts out as a box;
 * double-click one to see the combinators inside. Stepping the source runs
 * the translation until it is exactly the translation of the new source,
 * and reports how many combinator interactions that took.
 */
export function TranslateView(props: { ed: Editor }) {
  const ed = props.ed;
  const sys = ed.system;
  const [mode, setMode] = createSignal<Mode>("general");
  const [error, setError] = createSignal<string>();
  const [synced, setSynced] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [sourceSteps, setSourceSteps] = createSignal(0);
  const [combSteps, setCombSteps] = createSignal(0);
  const [last, setLast] = createSignal<{ rule: string; cost: number }>();
  const [costs, setCosts] = createSignal(new Map<string, number>());

  const restrictedOk = (() => {
    try {
      translation(sys, "restricted");
      return true;
    } catch (e) {
      return e instanceof TranslationError ? e.message : String(e);
    }
  })();

  const source = createNetModel({ system: () => sys });
  source.setNet(ed.net.clone());

  const defs = new Map<string, ComponentDef>(
    [...sys.types.values()].map((t) => [
      `[${t.id}]`,
      { id: `[${t.id}]`, name: `[${t.name}]`, symbol: `[${t.symbol}]`, net: new Net().toJSON(), groups: new Groups().toJSON(), iface: [] },
    ]),
  );
  const target = createNetModel({ system: () => COMBINATORS, defs: () => defs });

  let tr: Translation | undefined;
  /** Which translated agent is the root of each source agent's translation. */
  let tags = new Map<AgentId, AgentId>();

  /** Translate the source afresh, drawing each translated agent as a box. */
  const retranslate = () => {
    setError(undefined);
    try {
      tr = translation(sys, mode());
      const { net, tagOf, ports } = tr.net(source.net);
      const groups = new Groups();
      const groupOf = new Map<AgentId, number>();
      for (const a of source.net.agents.values()) {
        const iface = ports.get(a.id)!.map((e, i): [string, typeof e] => [`p${i}`, e]);
        groupOf.set(a.id, groups.add({ def: `[${a.type}]`, iface, collapsed: true }));
      }
      for (const [cell, a] of tagOf) groups.of.set(cell, groupOf.get(a)!);
      tags = tagOf;
      target.setNet(net, new Map(), groups);
      target.clearHistory();
      setSynced(true);
      target.requestFit();
    } catch (e) {
      tr = undefined;
      target.setNet(new Net());
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  retranslate();

  const rootsOf = (a: AgentId) => [...target.net.agents.keys()].filter((id) => tags.get(id) === a && isCellRoot(target.net, id));

  /** Fire one source pair, and run the translation to the translation of the result. */
  const stepSource = (w?: WireId): boolean => {
    const net = source.net;
    const pick = w ?? [...source.activeWires()][0];
    if (pick === undefined || !net.wires.has(pick) || !isActive(net, pick) || !tr) return false;
    if (!synced()) retranslate();
    const [ea, eb] = net.wire(pick).ends;
    if (ea.kind !== "port" || eb.kind !== "port") return false;
    const rule = pairKey(net.agent(ea.agent).type, net.agent(eb.agent).type);
    const roots = new Set([...rootsOf(ea.agent), ...rootsOf(eb.agent)]);
    const t = target.net;
    const cut = t.activePairs().find((x) => t.wire(x).ends.every((e) => e.kind === "port" && roots.has(e.agent)));
    const snap = source.animSnapshot();
    const rec = interact(net, sys, pick);
    source.bump();
    source.animate(snap, [rec]);
    setSourceSteps((n) => n + 1);
    if (cut === undefined) {
      setError("Couldn't find this pair's counterpart in the translation.");
      return false;
    }
    const r = reduceWith(t, COMBINATORS, {
      start: [cut],
      allow: (x) => x === cut || !t.wire(x).ends.every((e) => e.kind === "port" && isCellRoot(t, e.agent)),
    });
    setCombSteps((n) => n + r.interactions);
    setLast({ rule, cost: r.interactions });
    setCosts((m) => new Map(m).set(rule, r.interactions));
    const want = tr.net(net);
    if (canonical(t) !== canonical(want.net)) {
      setError("The translation went somewhere other than the translation of the result. That shouldn't happen.");
      target.bump();
      return false;
    }
    retranslate();
    return true;
  };

  /** Keep stepping the source, in small batches so the page stays responsive. */
  let stop = false;
  const runSource = () => {
    if (busy()) {
      stop = true;
      return;
    }
    stop = false;
    setBusy(true);
    let n = 0;
    const tick = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 60) {
        if (stop || n >= 500 || !stepSource()) return setBusy(false);
        n++;
      }
      setTimeout(tick, 0);
    };
    tick();
  };

  /** Step the combinators directly: free exploration, which leaves the two sides out of step. */
  const stepCombinators = (all: boolean) => {
    const t = target.net;
    let recs;
    if (all) recs = parallelStep(t, COMBINATORS);
    else {
      const [w] = target.activeWires();
      recs = w === undefined ? [] : [interact(t, COMBINATORS, w)];
    }
    for (const r of recs) target.dissolveAround(r.removed);
    setCombSteps((n) => n + recs.length);
    if (recs.length) setSynced(false);
    target.bump();
  };

  const fire = (w: WireId) => {
    const t = target.net;
    if (!t.wires.has(w) || !isActive(t, w)) return;
    const rec = interact(t, COMBINATORS, w);
    target.dissolveAround(rec.removed);
    setCombSteps((n) => n + 1);
    setSynced(false);
    target.bump();
  };

  const sizes = createMemo(() => {
    source.rev();
    target.rev();
    return { source: source.net.agents.size, target: target.net.agents.size };
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") ed.closeTranslate();
      else if (e.key === "s") stepSource();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => {
      stop = true;
      window.removeEventListener("keydown", onKey, { capture: true });
    });
  });

  return (
    <div class="rule-editor translate" role="dialog" aria-label="Translation into interaction combinators">
      <header class="rule-head">
        <h2>Into interaction combinators</h2>
        <div class="rule-actions">
          <div class="seg" role="group" aria-label="Translation">
            <button
              class="btn"
              classList={{ on: mode() === "general" }}
              onClick={() => {
                setMode("general");
                retranslate();
              }}
              title="Lafont's general translation, §2.7: every agent carries the system's genetic code"
            >
              General
            </button>
            <button
              class="btn"
              classList={{ on: mode() === "restricted" }}
              disabled={restrictedOk !== true}
              onClick={() => {
                setMode("restricted");
                retranslate();
              }}
              title={
                restrictedOk === true
                  ? "Lafont's restricted translation, §2.4: much smaller, no genetic code"
                  : `Restricted translation unavailable: ${restrictedOk}`
              }
            >
              Restricted
            </button>
          </div>
          <button class="btn" onClick={ed.closeTranslate}>
            Close
          </button>
        </div>
      </header>
      <div class="rule-palette">
        <button class="btn" onClick={() => stepSource()} disabled={busy() || !source.activeWires().size || !tr}>
          Step
        </button>
        <button class="btn" classList={{ on: busy() }} onClick={runSource} disabled={!busy() && (!source.activeWires().size || !tr)}>
          {busy() ? "Stop" : "Run"}
        </button>
        <span class="sep" />
        <button class="btn" onClick={() => stepCombinators(false)} disabled={busy() || !target.activeWires().size}>
          Step combinators
        </button>
        <button class="btn" onClick={() => stepCombinators(true)} disabled={busy() || !target.activeWires().size}>
          Step all combinators
        </button>
        <Show when={!synced()}>
          <button class="btn" onClick={retranslate}>
            Translate again
          </button>
        </Show>
        <span class="rule-status" classList={{ warn: !!error() }}>
          {error() ??
            (last()
              ? `That ${last()!.rule.replace("|", " ⋈ ")} interaction took ${last()!.cost.toLocaleString()} combinator interactions.`
              : "Step the net on the left; the translation follows on the right.")}
        </span>
      </div>
      <div class="rule-body translate-body">
        <div class="pane">
          <Canvas m={source} onFire={(w) => !busy() && stepSource(w)} class="rule-lhs" />
          <p class="pane-caption">
            {sizes().source} agents, {sourceSteps()} interactions
          </p>
        </div>
        <div class="rule-arrow" aria-hidden="true">
          ↦
        </div>
        <div class="pane">
          <Canvas m={target} onFire={fire} limit={DRAW_LIMIT} class="rule-rhs" />
          <p class="pane-caption">
            {sizes().target.toLocaleString()} combinators, {combSteps().toLocaleString()} interactions
            {synced() ? "" : " (out of step with the left)"}
          </p>
        </div>
      </div>
      <div class="rule-help translate-help">
        <Show when={costs().size}>
          <span>
            Cost per rule:{" "}
            <For each={[...costs()]}>
              {([k, v], i) => (
                <>
                  {i() ? ", " : ""}
                  <i>{k.replace("|", " ⋈ ")}</i> {v.toLocaleString()}
                </>
              )}
            </For>
            .{" "}
          </span>
        </Show>
        <Show when={tr?.missing.length}>
          <span>Pairs with no rule are translated arbitrarily, as in the paper. </span>
        </Show>
        Double-click a box to see the combinators inside it.
      </div>
    </div>
  );
}
