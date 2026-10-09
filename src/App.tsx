import { Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { type Doc, fromShareHash, loadLocal } from "./state/persist";
import { createEditor } from "./state/editor";
import { Canvas } from "./ui/Canvas";
import { RuleEditor } from "./ui/RuleEditor";
import { Sidebar } from "./ui/Sidebar";

const THEME_KEY = "netties:theme";

export function App(props: { initial?: Doc }) {
  const ed = createEditor(props.initial);
  ed.init();

  const [theme, setTheme] = createSignal<string>(safeGet(THEME_KEY) ?? "system");
  createEffect(() => {
    const t = theme();
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    safeSet(THEME_KEY, t);
  });

  // Save after every change.
  createEffect(on([ed.rev, ed.model.mode], () => ed.save()));

  createEffect(
    on(ed.message, (m) => {
      if (!m) return;
      const t = setTimeout(() => ed.setMessage(undefined), 3200);
      onCleanup(() => clearTimeout(t));
    }),
  );

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? ed.model.redo() : ed.model.undo();
      } else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") ed.model.deleteSelection();
      else if (e.key === "Escape") {
        ed.model.setArmed(undefined);
        ed.model.setSelection(undefined);
      } else if (e.key === "s") ed.stepOne();
      else if (e.key === "a") ed.stepAll();
      else if (e.key === "r") ed.run();
      else if (e.key === "f") ed.model.requestFit();
      else if (e.key === "x") {
        const s = ed.model.selection();
        if (s?.kind === "agent") ed.model.flipAgent(s.id);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  /** Clicking a pair with no rule opens the rule editor for it. */
  const openStuck = (w: number) => {
    const [a, b] = ed.net.wire(w).ends;
    if (a.kind === "port" && b.kind === "port") ed.openRule(ed.net.agent(a.agent).type, ed.net.agent(b.agent).type);
  };

  const active = () => ed.model.activeWires().size;
  const stuck = () => ed.model.stuckWires().size;

  return (
    <div class="app">
      <main class="stage-wrap" style={{ position: "relative", "min-height": "0" }}>
        <Canvas m={ed.model} system={() => (ed.rev(), ed.system)} onFire={ed.fire} onStuck={openStuck} />
        <div class="toolbar">
          <button class="btn" onClick={ed.stepOne} disabled={!active() || ed.running()} title="Fire one active pair (S)">
            Step
          </button>
          <button class="btn" onClick={ed.stepAll} disabled={!active() || ed.running()} title="Fire every active pair at once (A)">
            Step all
          </button>
          <button class="btn" classList={{ on: ed.running() }} onClick={ed.run} disabled={!active() && !ed.running()} title="Keep stepping until nothing is left to fire (R)">
            {ed.running() ? "Stop" : "Run"}
          </button>
          <span class="sep" />
          <button class="btn" onClick={ed.model.undo} disabled={!ed.model.historySize().undo} title="Undo (⌘Z)">
            Undo
          </button>
          <button class="btn" onClick={ed.model.redo} disabled={!ed.model.historySize().redo} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <span class="sep" />
          <div class="seg" role="group" aria-label="Layout">
            <button class="btn" classList={{ on: ed.model.mode() === "auto" }} onClick={() => ed.model.setMode("auto")} title="Lay the net out automatically">
              Auto layout
            </button>
            <button class="btn" classList={{ on: ed.model.mode() === "manual" }} onClick={() => ed.model.setMode("manual")} title="Place agents yourself; wires still route automatically">
              Manual
            </button>
          </div>
          <button class="btn" onClick={ed.model.requestFit} title="Fit the net in view (F)">
            Fit
          </button>
          <button class="btn" onClick={ed.clearNet} title="Remove every agent and wire">
            Clear
          </button>
        </div>
        <div class="status" aria-live="polite">
          <span>{active() === 1 ? "1 active pair" : `${active()} active pairs`}</span>
          <Show when={stuck()}>
            <span class="warn">
              {stuck() === 1 ? "1 pair has no rule; click it to write one" : `${stuck()} pairs have no rule; click one to write it`}
            </span>
          </Show>
          <Show when={ed.stats().interactions}>
            <span>{ed.stats().interactions} interactions</span>
          </Show>
          <Show when={ed.model.mode() === "manual" && ed.model.selection()?.kind === "agent"}>
            <span>Press X to turn the agent round</span>
          </Show>
        </div>
        <Show when={ed.rev() >= 0 && ed.net.agents.size === 0 && ed.net.free.size === 0}>
          <div class="hint">Add an agent from the list on the right, then drag between ports to wire them up.</div>
        </Show>
        <Show when={ed.ruleOpen()} keyed>
          {([a, b]) => <RuleEditor ed={ed} left={a} right={b} />}
        </Show>
        <Show when={ed.message()}>
          <div class="toast" role="status">
            {ed.message()}
          </div>
        </Show>
      </main>
      <Sidebar ed={ed} theme={theme()} setTheme={setTheme} />
    </div>
  );
}

export async function initialDoc(): Promise<Doc | undefined> {
  return (await fromShareHash(location.hash)) ?? loadLocal();
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // ignore
  }
}
