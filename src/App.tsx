import { Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { type Doc, fromShareHash, loadLocal } from "./state/persist";
import { createEditor } from "./state/editor";
import { Canvas } from "./ui/Canvas";
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
  createEffect(on([ed.rev, ed.mode], () => ed.save()));

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
        e.shiftKey ? ed.redo() : ed.undo();
      } else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") ed.deleteSelection();
      else if (e.key === "Escape") {
        ed.setArmed(undefined);
        ed.setSelection(undefined);
      } else if (e.key === "s") ed.stepOne();
      else if (e.key === "a") ed.stepAll();
      else if (e.key === "r") ed.run();
      else if (e.key === "f") ed.requestFit();
      else if (e.key === "x") {
        const s = ed.selection();
        if (s?.kind === "agent") ed.flipAgent(s.id);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const active = () => ed.activeWires().size;
  const stuck = () => ed.stuckWires().size;

  return (
    <div class="app">
      <main class="stage-wrap" style={{ position: "relative", "min-height": "0" }}>
        <Canvas ed={ed} />
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
          <button class="btn" onClick={ed.undo} disabled={!ed.historySize().undo} title="Undo (⌘Z)">
            Undo
          </button>
          <button class="btn" onClick={ed.redo} disabled={!ed.historySize().redo} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <span class="sep" />
          <div class="seg" role="group" aria-label="Layout">
            <button class="btn" classList={{ on: ed.mode() === "auto" }} onClick={() => ed.setMode("auto")} title="Lay the net out automatically">
              Auto layout
            </button>
            <button class="btn" classList={{ on: ed.mode() === "manual" }} onClick={() => ed.setMode("manual")} title="Place agents yourself; wires still route automatically">
              Manual
            </button>
          </div>
          <button class="btn" onClick={ed.requestFit} title="Fit the net in view (F)">
            Fit
          </button>
          <button class="btn" onClick={ed.clearNet} title="Remove every agent and wire">
            Clear
          </button>
        </div>
        <div class="status" aria-live="polite">
          <span>{active() === 1 ? "1 active pair" : `${active()} active pairs`}</span>
          <Show when={stuck()}>
            <span class="warn">{stuck() === 1 ? "1 pair has no rule" : `${stuck()} pairs have no rule`}</span>
          </Show>
          <Show when={ed.stats().interactions}>
            <span>{ed.stats().interactions} interactions</span>
          </Show>
          <Show when={ed.mode() === "manual" && ed.selection()?.kind === "agent"}>
            <span>Press X to turn the agent round</span>
          </Show>
        </div>
        <Show when={ed.rev() >= 0 && ed.net.agents.size === 0 && ed.net.free.size === 0}>
          <div class="hint">Add an agent from the list on the right, then drag between ports to wire them up.</div>
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
