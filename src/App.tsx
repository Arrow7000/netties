import { Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { type Doc, fromShareHash, loadLocal } from "./state/persist";
import { createEditor } from "./state/editor";
import { Canvas } from "./ui/Canvas";
import { ComponentEditor } from "./ui/ComponentEditor";
import { RuleEditor } from "./ui/RuleEditor";
import { TextView } from "./ui/TextView";
import { TranslateView } from "./ui/TranslateView";
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
        if (s?.kind === "items") s.agents.forEach((a) => ed.model.flipAgent(a));
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

  const [making, setMaking] = createSignal(false);
  const selectedItems = () => {
    const s = ed.model.selection();
    return s?.kind === "items" ? s.agents.size + s.groups.size : 0;
  };
  const selectedGroups = () => {
    const s = ed.model.selection();
    return s?.kind === "items" ? [...s.groups].filter((g) => ed.model.groups.groups.has(g)) : [];
  };
  const allCollapsed = () => (ed.rev(), selectedGroups().every((g) => ed.model.groups.groups.get(g)?.collapsed));

  const active = () => ed.model.activeWires().size;
  const stuck = () => ed.model.stuckWires().size;

  return (
    <div class="app">
      <main class="stage-wrap" style={{ position: "relative", "min-height": "0" }}>
        <Canvas m={ed.model} onFire={ed.fire} onStuck={openStuck} />
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
          <Show when={ed.model.mode() === "auto"}>
            <button class="btn" onClick={ed.model.tidy} title="Lay the net out afresh, ignoring where things were">
              Tidy
            </button>
          </Show>
          <button class="btn" onClick={ed.model.requestFit} title="Fit the net in view (F)">
            Fit
          </button>
          <button class="btn" onClick={ed.clearNet} title="Remove every agent and wire">
            Clear
          </button>
          <span class="sep" />
          <button class="btn" onClick={ed.openTranslate} title="Translate the net into Lafont's interaction combinators">
            To combinators
          </button>
          <Show when={selectedItems() > 0}>
            <span class="sep" />
            <Show
              when={making()}
              fallback={
                <button class="btn" onClick={() => setMaking(true)} title="Make the selection a reusable component">
                  Make component
                </button>
              }
            >
              <form
                class="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  ed.makeComponent(String(f.get("name") ?? ""), String(f.get("symbol") ?? "").trim() || "C");
                  setMaking(false);
                }}
              >
                <input name="name" placeholder="Name" required ref={(el) => setTimeout(() => el.focus())} />
                <input name="symbol" placeholder="Symbol" class="short" maxLength={4} />
                <button class="btn on" type="submit">
                  Make
                </button>
                <button class="btn" type="button" onClick={() => setMaking(false)}>
                  Cancel
                </button>
              </form>
            </Show>
            <Show when={selectedGroups().length}>
              <button
                class="btn"
                onClick={() => selectedGroups().forEach((g) => ed.model.setCollapsed(g, !allCollapsed()))}
                title="Show or hide what's inside (double-click works too)"
              >
                {allCollapsed() ? "Expand" : "Collapse"}
              </button>
              <button class="btn" onClick={ed.breakApart} title="Turn the instance back into loose agents">
                Break apart
              </button>
            </Show>
          </Show>
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
          <Show when={ed.model.mode() === "manual" && ed.model.selection()?.kind === "items"}>
            <span>Press X to turn the agent round</span>
          </Show>
        </div>
        <Show when={ed.rev() >= 0 && ed.net.agents.size === 0 && ed.net.free.size === 0}>
          <div class="hint">Add an agent from the list on the right, then drag between ports to wire them up.</div>
        </Show>
        <Show when={ed.textOpen()}>
          <TextView ed={ed} />
        </Show>
        <Show when={ed.translateOpen()}>
          <TranslateView ed={ed} />
        </Show>
        <Show when={ed.componentOpen()} keyed>
          {(id) => <ComponentEditor ed={ed} id={id} />}
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
