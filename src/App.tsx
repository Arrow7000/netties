import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { createEditor } from "./state/editor";
import { type Doc, fromShareHash, loadLocal } from "./state/persist";
import { Canvas, createCamera } from "./ui/Canvas";
import { ComponentEditor } from "./ui/ComponentEditor";
import { Menu, MenuItem } from "./ui/Menu";
import { Palette } from "./ui/Palette";
import { Counters, HoverPanel, SelectionPanel } from "./ui/Panels";
import { RuleEditor } from "./ui/RuleEditor";
import { TextView } from "./ui/TextView";
import { TranslateView } from "./ui/TranslateView";
import * as I from "./ui/icons";
import { held } from "./ui/keys";

const THEME_KEY = "netties:theme";

/** Speeds the slider steps through, as powers of two. */
const SPEED_MIN = -3;
const SPEED_MAX = 2;
const SLOW = 0.2;

export function App(props: { initial?: Doc }) {
  const ed = createEditor(props.initial);
  ed.init();
  const m = ed.model;
  const camera = createCamera();

  const stored = safeGet(THEME_KEY);
  const [theme, setTheme] = createSignal<string | undefined>(stored === "light" || stored === "dark" ? stored : undefined);
  createEffect(() => {
    const t = theme();
    if (!t) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    if (t) safeSet(THEME_KEY, t);
  });
  const toggleTheme = () => {
    const dark = theme() ? theme() === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(dark ? "light" : "dark");
  };

  // Save after every change.
  createEffect(on([ed.rev, m.mode], () => ed.save()));

  createEffect(
    on(ed.message, (msg) => {
      if (!msg) return;
      const t = setTimeout(() => ed.setMessage(undefined), ed.undoable() ? 6000 : 3600);
      onCleanup(() => clearTimeout(t));
    }),
  );

  const overlayOpen = () => !!(ed.ruleOpen() || ed.componentOpen() || ed.translateOpen() || ed.textOpen());

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      if (overlayOpen()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? m.redo() : m.undo();
      } else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") m.deleteSelection();
      else if (e.key === "Escape") m.setSelection(undefined);
      else if (e.key === "s") ed.stepOne();
      else if (e.key === "a") ed.stepAll();
      else if (e.key === "r") ed.run();
      else if (e.key === "f") camera.fit();
      else if (e.key === "x") m.selectedAgents().forEach((a) => m.flipAgent(a));
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  createEffect(on(m.fitTick, () => queueMicrotask(camera.fit), { defer: true }));

  /** Clicking a pair with no rule opens the rule editor for it. */
  const openStuck = (w: number) => {
    const [a, b] = ed.net.wire(w).ends;
    if (a.kind === "port" && b.kind === "port") ed.openRule(ed.net.agent(a.agent).type, ed.net.agent(b.agent).type);
  };

  const active = () => m.activeWires().size;

  const share = async () => {
    const { toShareHash } = await import("./state/persist");
    const hash = await toShareHash(ed.toDoc());
    const url = location.origin + location.pathname + hash;
    history.replaceState(null, "", hash);
    try {
      await navigator.clipboard.writeText(url);
      ed.setMessage("Copied a link to this net.");
    } catch {
      ed.setMessage("Couldn't copy the link; it's in the address bar.");
    }
  };

  const exportSVG = async () => {
    const { toSVG } = await import("./render/svg");
    const css = getComputedStyle(document.documentElement);
    const l = m.layout();
    const v = m.view();
    const svg = toSVG(v.net, v.sys, l.placement, l.routed, {
      paper: css.getPropertyValue("--paper").trim(),
      ink: css.getPropertyValue("--ink").trim(),
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = "net.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Speed: the slider is logarithmic; the clock button toggles slow motion.
  let beforeSlow = 1;
  const slow = () => ed.speed() <= SLOW + 1e-6;
  const toggleSlow = () => {
    if (slow()) ed.setSpeed(beforeSlow);
    else {
      beforeSlow = ed.speed();
      ed.setSpeed(SLOW);
    }
  };
  const speedText = () => {
    const s = ed.speed();
    return `${s >= 1 ? Math.round(s * 10) / 10 : Math.round(s * 100) / 100}×`;
  };

  return (
    <div class="app">
      <Canvas
        m={m}
        camera={camera}
        onFire={ed.fire}
        onStuck={openStuck}
        pad={{ t: 72, r: 270, b: 90, l: 48 }}
        empty={
          <div class="empty-card">
            <b>The net is empty</b>
            Drag an agent in from the panel on the right, or load an example.
          </div>
        }
      />

      <div class="island top-left">
        <div class="brand">
          <svg viewBox="-12 -14 24 28" aria-hidden="true">
            <polygon points="-9,-13 9,-13 0,-2" class="brand-filled" />
            <polygon points="-9,13 9,13 0,2" class="brand-hollow" />
          </svg>
          netties
        </div>
        <span class="sep" />
        <Menu label="Examples" title="Load an example net">
          {(close) => (
            <>
              <div class="menu-head">Loading an example replaces the whole net. You can undo it.</div>
              <For each={ed.examples}>
                {(ex) => (
                  <MenuItem
                    title={ex.name}
                    note={ex.about}
                    onClick={() => {
                      ed.loadExample(ex);
                      close();
                    }}
                  />
                )}
              </For>
            </>
          )}
        </Menu>
        <Menu label="Net" title="Text, sharing and export">
          {(close) => (
            <>
              <MenuItem
                title="Text view"
                note="See and edit the agents, rules and net as text"
                onClick={() => {
                  ed.openText();
                  close();
                }}
              />
              <MenuItem
                title="Copy share link"
                onClick={() => {
                  share();
                  close();
                }}
              />
              <MenuItem
                title="Export SVG"
                onClick={() => {
                  exportSVG();
                  close();
                }}
              />
              <hr />
              <MenuItem
                title="Clear net"
                note="Removes everything. You can undo it."
                danger
                onClick={() => {
                  ed.clearNet();
                  close();
                }}
              />
            </>
          )}
        </Menu>
      </div>

      <div class="island top-mid">
        <div class="seg" role="tablist" aria-label="Screen">
          <button role="tab" aria-pressed={!ed.translateOpen()} onClick={ed.closeTranslate}>
            Net
          </button>
          <button role="tab" aria-pressed={ed.translateOpen()} onClick={ed.openTranslate}>
            Combinator translation
          </button>
        </div>
      </div>

      <div class="island top-right">
        <button class="btn icon" onClick={m.undo} disabled={!m.historySize().undo} title="Undo (⌘Z)">
          <I.Undo />
        </button>
        <button class="btn icon" onClick={m.redo} disabled={!m.historySize().redo} title="Redo (⇧⌘Z)">
          <I.Redo />
        </button>
        <span class="sep" />
        <button class="btn icon" onClick={toggleTheme} title="Switch between light and dark">
          <I.Theme />
        </button>
      </div>

      <Palette ed={ed} camera={camera} />

      <div class="panel-stack">
        <HoverPanel ed={ed} />
        <SelectionPanel ed={ed} />
      </div>
      <Counters ed={ed} />

      <div class="island transport" aria-label="Run">
        <button class="btn outline" onClick={ed.stepOne} disabled={!active() || ed.running()} title="Fire one active pair (S)">
          <I.Step />
          Step
        </button>
        <button class="btn outline" onClick={ed.stepAll} disabled={!active() || ed.running()} title="Fire every active pair at once (A)">
          <I.StepAll />
          Step all
        </button>
        <button
          class="btn run"
          classList={{ stop: ed.running() }}
          onClick={ed.run}
          disabled={!active() && !ed.running()}
          title="Keep stepping until nothing can fire (R)"
        >
          <Show when={ed.running()} fallback={<I.Play />}>
            <I.Stop />
          </Show>
          {ed.running() ? "Stop" : "Run"}
        </button>
        <span class="sep" />
        <div class="speed">
          <button class="btn icon" aria-pressed={slow()} classList={{ on: slow() }} onClick={toggleSlow} title="Slow motion">
            <I.Slow />
          </button>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.25}
            value={Math.log2(ed.speed())}
            onInput={(e) => ed.setSpeed(2 ** e.currentTarget.valueAsNumber)}
            aria-label="Animation speed"
          />
          <output>{speedText()}</output>
        </div>
      </div>

      <div class="island view-controls">
        <div class="seg" role="group" aria-label="Layout">
          <button aria-pressed={m.mode() === "auto"} onClick={() => m.setMode("auto")} title="Lay the net out automatically">
            Auto layout
          </button>
          <button aria-pressed={m.mode() === "manual"} onClick={() => m.setMode("manual")} title="Place agents yourself; wires still route themselves">
            Manual
          </button>
        </div>
        <button class="btn" onClick={m.tidy} disabled={m.mode() !== "auto"} title="Lay the net out afresh, ignoring where things were">
          Tidy
        </button>
        <span class="sep" />
        <button class="btn icon" onClick={() => camera.zoomBy(1 / 1.25)} title="Zoom out">
          <I.Minus />
        </button>
        <button class="btn zoom" onClick={() => camera.zoomTo(1)} title="Zoom to 100%">
          {Math.round(camera.view().k * 100)}%
        </button>
        <button class="btn icon" onClick={() => camera.zoomBy(1.25)} title="Zoom in">
          <I.Plus />
        </button>
        <button class="btn" onClick={camera.fit} title="Fit the net in view (F)">
          <I.Fit />
          Fit
        </button>
      </div>

      <Show when={held.alt() && active() > 0 && !overlayOpen()}>
        <div class="alt-banner">
          <kbd>Alt</kbd>
          Clicking an active pair now selects its wire instead of firing it
        </div>
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
          <span>{ed.message()}</span>
          <Show when={ed.undoable()}>
            <button
              onClick={() => {
                m.undo();
                ed.setMessage(undefined);
              }}
            >
              Undo
            </button>
          </Show>
        </div>
      </Show>
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
