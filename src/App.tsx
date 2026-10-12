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
import { TypesSheet } from "./ui/TypesSheet";
import * as I from "./ui/icons";
import { held } from "./ui/keys";
import { prefs } from "./ui/prefs";
import { typingOn } from "./core/types";

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

  // The agent editor is a floating popover: canvas shortcuts remain useful
  // while it is open. Full workspaces and sheets block those shortcuts.
  const overlayOpen = () => {
    const kind = ed.screen().kind;
    return kind !== "net" && kind !== "agent";
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      // The directions and types sheet edits the system in place, so undo works while it's open.
      const sheetOnly = ed.screen().kind === "types";
      if (overlayOpen() && !(sheetOnly && mod && e.key.toLowerCase() === "z")) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        ed.dispatch({ kind: e.shiftKey ? "history/redo" : "history/undo" });
      } else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") ed.dispatch({ kind: "selection/delete" });
      else if (e.key === "Escape") ed.dispatch({ kind: "selection/clear" });
      else if (e.key === "s") ed.dispatch({ kind: "run/step-one" });
      else if (e.key === "a") ed.dispatch({ kind: "run/step-all" });
      else if (e.key === "r") ed.dispatch({ kind: "run/toggle" });
      else if (e.key === "f") camera.fit();
      else if (e.key === "x") ed.dispatch({ kind: "selection/flip", agents: m.selectedAgents() });
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
        onFire={(wire) => ed.dispatch({ kind: "run/fire", wire })}
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
          <button role="tab" aria-pressed={ed.screen().kind !== "translation"} onClick={ed.closeTranslate}>
            Net
          </button>
          <button role="tab" aria-pressed={ed.screen().kind === "translation"} onClick={ed.openTranslate}>
            Combinator translation
          </button>
        </div>
      </div>

      <div class="island top-right">
        <button class="btn icon" onClick={() => ed.dispatch({ kind: "history/undo" })} disabled={!m.historySize().undo} title="Undo (⌘Z)">
          <I.Undo />
        </button>
        <button class="btn icon" onClick={() => ed.dispatch({ kind: "history/redo" })} disabled={!m.historySize().redo} title="Redo (⇧⌘Z)">
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
      <div class="bottom-bar">
        <Counters ed={ed} />

        <div class="island transport" aria-label="Run">
          <button class="btn outline" onClick={() => ed.dispatch({ kind: "run/step-one" })} disabled={!active() || ed.running()} title="Fire one active pair (S)">
            <I.Step />
            Step
          </button>
          <button class="btn outline" onClick={() => ed.dispatch({ kind: "run/step-all" })} disabled={!active() || ed.running()} title="Fire every active pair at once (A)">
            <I.StepAll />
            Step all
          </button>
          <button
            class="btn run"
            classList={{ stop: ed.running() }}
            onClick={() => ed.dispatch({ kind: "run/toggle" })}
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
            <button aria-pressed={m.mode() === "auto"} onClick={() => ed.dispatch({ kind: "layout/set", mode: "auto" })} title="Lay the net out automatically">
              Auto layout
            </button>
            <button aria-pressed={m.mode() === "manual"} onClick={() => ed.dispatch({ kind: "layout/set", mode: "manual" })} title="Place agents yourself; wires still route themselves">
              Manual
            </button>
          </div>
          <button class="btn" onClick={() => ed.dispatch({ kind: "layout/tidy" })} disabled={m.mode() !== "manual"} title="Tidy up manually placed agents">
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
          <span class="sep" />
          <Menu label={<I.Eye />} title="View options" class="icon up">
            {(close) => (
              <>
                <div class="menu-head">Just for you, in this browser</div>
                <MenuItem
                  lead={prefs.wireTypes() ? <I.Check /> : <span class="mi-blank" />}
                  title="Type labels on every wire"
                  note={
                    (ed.rev(), typingOn(ed.system.typing))
                      ? "Otherwise a wire shows its type when you point at it"
                      : "This system has no types"
                  }
                  onClick={() => {
                    prefs.setWireTypes(!prefs.wireTypes());
                    close();
                  }}
                />
              </>
            )}
          </Menu>
        </div>
      </div>

      <Show when={held.alt() && active() > 0 && !overlayOpen()}>
        <div class="alt-banner">
          <kbd>Alt</kbd>
          Clicking an active pair now selects its wire instead of firing it
        </div>
      </Show>

      <Show when={ed.screen().kind === "types"}>
        <TypesSheet ed={ed} />
      </Show>
      <Show when={ed.screen().kind === "text"}>
        <TextView ed={ed} />
      </Show>
      <Show when={ed.screen().kind === "translation"}>
        <TranslateView ed={ed} />
      </Show>
      <Show when={ed.screen().kind === "component" ? ed.screen() as Extract<ReturnType<typeof ed.screen>, { kind: "component" }> : undefined} keyed>
        {(screen) => <ComponentEditor ed={ed} id={screen.id} />}
      </Show>
      <Show when={ed.screen().kind === "rule" ? ed.screen() as Extract<ReturnType<typeof ed.screen>, { kind: "rule" }> : undefined} keyed>
        {(screen) => <RuleEditor ed={ed} left={screen.left} right={screen.right} />}
      </Show>
      <Show when={ed.message()}>
        <div class="toast" role="status">
          <span>{ed.message()}</span>
          <Show when={ed.undoable()}>
            <button
              onClick={() => {
                ed.dispatch({ kind: "history/undo" });
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
