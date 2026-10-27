import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { createEditor } from "./state/editor";
import { type Doc, arrival, fromShareHash, loadLocal, sharePushes } from "./state/persist";
import { Canvas, type Pad, createCamera } from "./ui/Canvas";
import { compact, fingers } from "./ui/compact";
import { ComponentEditor } from "./ui/ComponentEditor";
import { ExamplesMenu } from "./ui/ExamplesMenu";
import { Menu, MenuItem } from "./ui/Menu";
import { Palette } from "./ui/Palette";
import { Counters, HoverPanel, SelectionPanel } from "./ui/Panels";
import { RuleEditor } from "./ui/RuleEditor";
import { canLeave, subEditor } from "./ui/subEditor";
import { TextView } from "./ui/TextView";
import { Tooltips } from "./ui/Tooltip";
import { TranslateView } from "./ui/TranslateView";
import { TypesSheet } from "./ui/TypesSheet";
import { createPhone } from "./ui/phone/kit";
import { PhoneSheet } from "./ui/phone/Sheet";
import * as I from "./ui/icons";
import { held, shortcuts } from "./ui/keys";
import { freezeState } from "./ui/freeze";
import { prefs } from "./ui/prefs";
import { CLIP_TYPE, type Clip } from "./core/clip";
import { parse } from "./core/text";
import { typingOn } from "./core/types";

const THEME_KEY = "netties:theme";

/** Speeds the slider steps through, as powers of two. */
const SPEED_MIN = -3;
const SPEED_MAX = 2;
const SLOW = 0.2;

/** Room the desktop chrome takes round the canvas: the bars, and the palette on the right. */
const DESKTOP_PAD: Pad = { t: 72, r: 270, b: 90, l: 48 };

export function App(props: { initial?: Doc; fromLink?: boolean }) {
  const ed = createEditor(props.initial);
  ed.init();
  const m = ed.model;
  const camera = createCamera();
  const phone = createPhone(ed, camera);

  const stored = safeGet(THEME_KEY);
  const [theme, setTheme] = createSignal<string | undefined>(stored === "light" || stored === "dark" ? stored : undefined);
  createEffect(() => {
    const t = theme();
    if (!t) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    if (t) safeSet(THEME_KEY, t);
  });
  const dark = () => (theme() ? theme() === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  const toggleTheme = () => setTheme(dark() ? "light" : "dark");

  // Save after every change.
  createEffect(on([ed.rev, m.mode], () => ed.save()));

  // The share link in the address bar only changes when it's asked to, so
  // keep track of which state it holds, to offer to update it.
  const here = createMemo(on([ed.rev, m.mode], () => ed.fingerprint()));
  const [linked, setLinked] = createSignal(props.fromLink ? ed.fingerprint() : undefined);
  const stale = () => linked() !== undefined && linked() !== here();

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

  // The undo and redo buttons light up when their shortcuts are used.
  let undoBtn!: HTMLButtonElement;
  let redoBtn!: HTMLButtonElement;
  const flash = (b: HTMLElement) => b.animate([{ background: "var(--accent-soft)", color: "var(--accent)" }, {}], { duration: 450, easing: "ease-out" });

  onMount(() => {
    // Going back or forward to another address, or one typed in. Sharing pushes
    // its link without a hashchange, so this never reloads what it just shared.
    // (Entries with the same address hold the same net, so popstate adds nothing.)
    let hashNavigation = 0;
    const onHashChange = async () => {
      const hash = location.hash;
      const navigation = ++hashNavigation;
      const doc = hash.startsWith("#n=") ? await fromShareHash(hash) : undefined;
      if (navigation !== hashNavigation || location.hash !== hash) return;
      switch (arrival(hash, doc, ed.fingerprint())) {
        case "no-net":
          return setLinked(undefined);
        case "unreadable":
          return ed.setMessage("Couldn't load this shared net.");
        case "showing":
          return setLinked(ed.fingerprint());
        case "load":
          // Not over a panel with unsaved changes (it says so); any other panel closes first.
          if (!canLeave()) return setLinked(undefined);
          if (ed.screen().kind !== "net") ed.dispatch({ kind: "screen/close" });
          try {
            ed.load(doc!, "Loaded the net in the link.");
            setLinked(ed.fingerprint());
          } catch {
            ed.setMessage("Couldn't load this shared net.");
          }
      }
    };
    window.addEventListener("hashchange", onHashChange);
    onCleanup(() => window.removeEventListener("hashchange", onHashChange));

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      // The directions and types sheet edits the system in place, so undo works while it's open.
      const sheetOnly = ed.screen().kind === "types";
      if (overlayOpen() && !(sheetOnly && mod && e.key.toLowerCase() === "z")) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const redo = e.shiftKey;
        if (m.historySize()[redo ? "redo" : "undo"]) flash(redo ? redoBtn : undoBtn);
        ed.dispatch({ kind: redo ? "history/redo" : "history/undo" });
      } else if (mod && e.key.toLowerCase() === "a" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        ed.dispatch({ kind: "selection/all" });
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

    // Copy, cut and paste the selection. The clipboard gets the piece twice:
    // as JSON for netties, and in the text format for anywhere else.
    const editable = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select, [contenteditable]");
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (editable(e.target) || overlayOpen() || !e.clipboardData) return;
      const c = ed.copySelection();
      const s = m.selection();
      if (!c || s?.kind !== "items") return;
      e.preventDefault();
      e.clipboardData.setData(CLIP_TYPE, JSON.stringify(c.clip));
      e.clipboardData.setData("text/plain", c.text);
      const count = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : "");
      const what = [count(s.agents.size, "agent"), count(s.groups.size, "component")].filter(Boolean).join(" and ");
      if (cut) {
        ed.dispatch({ kind: "selection/delete" });
        ed.notify(`Cut ${what}.`, true);
      } else ed.notify(`Copied ${what}.`);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target) || overlayOpen() || !e.clipboardData) return;
      const json = e.clipboardData.getData(CLIP_TYPE);
      const text = e.clipboardData.getData("text/plain");
      if (!json && !text.trim()) return;
      e.preventDefault();
      let src: Parameters<typeof ed.paste>[0];
      try {
        src = json ? (JSON.parse(json) as Clip) : parse(text);
      } catch (err) {
        ed.notify(`The clipboard doesn't hold a net: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      try {
        const problem = ed.paste(src, pasteSpot());
        if (problem) ed.notify(problem);
      } catch (err) {
        console.error("paste failed", err);
        ed.notify("Couldn't paste that.");
      }
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", onPaste);
    const track = (e: PointerEvent) => (pointer = { x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", track, { passive: true });
    onCleanup(() => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("pointermove", track);
    });
  });

  /**
   * Where a paste goes: under the pointer when it's over the canvas,
   * otherwise the middle of the screen. Pasting again at the same spot
   * steps each copy down and to the right, so they don't pile up.
   */
  let pointer: { x: number; y: number } | undefined;
  let lastPaste: { x: number; y: number; n: number } | undefined;
  const pasteSpot = () => {
    const over = pointer && document.elementFromPoint(pointer.x, pointer.y)?.closest(".canvas");
    const c = over ? pointer! : { x: innerWidth / 2, y: innerHeight / 2 };
    const at = camera.toWorld(c.x, c.y) ?? { x: 0, y: 0 };
    const again = lastPaste && Math.hypot(lastPaste.x - at.x, lastPaste.y - at.y) < 1;
    lastPaste = { x: at.x, y: at.y, n: again ? lastPaste!.n + 1 : 0 };
    const step = 24 * lastPaste.n;
    return { x: at.x + step, y: at.y + step };
  };

  createEffect(on(m.fitTick, () => queueMicrotask(camera.fit), { defer: true }));

  // On a phone the canvas is fitted between the top bar, measured, so the room
  // it takes follows rotation and the safe areas, and the sheet at its peek.
  let topBar!: HTMLDivElement;
  const [viewport, setViewport] = createSignal(0);
  onMount(() => {
    const resized = () => setViewport((n) => n + 1);
    window.addEventListener("resize", resized);
    // Turning the phone refits the net, once the canvas has its new size.
    const turn = matchMedia("(orientation: portrait)");
    const turned = () => compact() && requestAnimationFrame(() => requestAnimationFrame(() => camera.fit()));
    turn.addEventListener("change", turned);
    // Safari zooms the whole page on a pinch, whatever touch-action says.
    const noPinch = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", noPinch);
    onCleanup(() => {
      window.removeEventListener("resize", resized);
      turn.removeEventListener("change", turned);
      document.removeEventListener("gesturestart", noPinch);
    });
  });
  const pad = (): Pad => {
    if (!compact()) return DESKTOP_PAD;
    viewport();
    const top = topBar.getBoundingClientRect();
    const sheet = phone.room();
    return { t: top.bottom + 12, r: sheet.r + 8, b: sheet.b + 12, l: top.left + 8 };
  };

  /** Clicking a pair with no rule opens the rule editor for it. */
  const openStuck = (w: number) => {
    if (!canLeave()) return;
    const [a, b] = ed.net.wire(w).ends;
    if (a.kind === "port" && b.kind === "port") ed.openRule(ed.net.agent(a.agent).type, ed.net.agent(b.agent).type);
  };

  const active = () => m.activeWires().size;

  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const share = async () => {
    const { toShareHash } = await import("./state/persist");
    const print = ed.fingerprint();
    const hash = await toShareHash(ed.toDoc());
    const url = location.origin + location.pathname + hash;
    // A new entry, so the back button goes to the address before.
    if (sharePushes(location.hash, hash)) history.pushState(null, "", hash);
    setLinked(print);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), 900);
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

  // Pieces of the bottom bar that move into the view menu on a phone.
  const speed = () => (
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
  );
  const layout = () => (
    <>
      <div class="seg" role="group" aria-label="Layout">
        <button aria-pressed={m.mode() === "auto"} onClick={() => ed.dispatch({ kind: "layout/set", mode: "auto" })} title="Lay the net out automatically">
          Auto
        </button>
        <button aria-pressed={m.mode() === "manual"} onClick={() => ed.dispatch({ kind: "layout/set", mode: "manual" })} title="Place agents yourself; wires still route themselves">
          Manual
        </button>
      </div>
      <button class="btn" onClick={() => ed.dispatch({ kind: "layout/tidy" })} disabled={m.mode() !== "manual"} title="Tidy up manually placed agents">
        Tidy
      </button>
    </>
  );
  const wireTypes = (close: () => void) => (
    <MenuItem
      lead={prefs.wireTypes() ? <I.Check /> : <span class="mi-blank" />}
      title="Type labels on every wire"
      note={(ed.rev(), typingOn(ed.system.typing)) ? "Otherwise a wire shows its type when you point at it" : "This system has no types"}
      onClick={() => {
        prefs.setWireTypes(!prefs.wireTypes());
        close();
      }}
    />
  );

  /** The phone's view menu: speed, layout, and the preferences. */
  const viewMenu = () => (
    <Menu label={<I.Sliders />} title="Speed, layout and view" class="icon" menuClass="view-menu" bare>
      {(close) => (
        <>
          <div class="menu-row">
            <span class="menu-label">Speed</span>
            {speed()}
          </div>
          <div class="menu-row">
            <span class="menu-label">Layout</span>
            {layout()}
          </div>
          <hr />
          <div class="menu-head">Just for you, in this browser</div>
          {wireTypes(close)}
          <MenuItem
            lead={dark() ? <I.Check /> : <span class="mi-blank" />}
            title="Dark theme"
            onClick={() => {
              toggleTheme();
              close();
            }}
          />
        </>
      )}
    </Menu>
  );

  return (
    <div class="app">
      <Canvas
        m={m}
        camera={camera}
        onFire={(wire) => ed.dispatch({ kind: "run/fire", wire })}
        preview={ed.preview}
        previewing={ed.previewing}
        // On a phone, a tapped pair's preview is brought into view too, since there's no room to spare beside it.
        fitPreviews={() => ed.running() || (compact() && fingers())}
        onStuck={openStuck}
        pad={pad()}
        phone={compact() ? phone.canvas : undefined}
        empty={
          <div class="empty-card">
            <b>The net is empty</b>
            {compact() ? "Drag an agent in from below, or load one from Examples." : "Drag an agent in from the panel on the right, or load an example."}
          </div>
        }
      />

      <div class="island top-left" ref={topBar}>
        <div class="brand">
          <svg viewBox="-12 -14 24 28" aria-hidden="true">
            <polygon points="-9,-13 9,-13 0,-2" class="brand-filled" />
            <polygon points="-9,13 9,13 0,2" class="brand-hollow" />
          </svg>
          <span class="brand-name">netties</span>
        </div>
        <span class="sep" />
        <Menu label="File" title="Text, translation, sharing and export">
          {(close) => (
            <>
              {/* On a phone the link is shared from here, to keep the top bar short. */}
              <Show when={compact()}>
                <MenuItem
                  title={stale() ? "Update link" : "Copy link"}
                  note={stale() ? "The net has changed since the link in the address bar was made" : "Put a link to this net in the address bar and copy it"}
                  onClick={() => {
                    share().then(() => copied() && ed.setMessage("Copied a link to this net."));
                    close();
                  }}
                />
                <hr />
              </Show>
              <MenuItem
                title="Text view"
                note="See and edit the agents, rules and net as text"
                onClick={() => {
                  ed.openText();
                  close();
                }}
              />
              <MenuItem
                title="Combinator translation"
                note="See the same computation built from γ, δ and ε alone"
                onClick={() => {
                  ed.openTranslate();
                  close();
                }}
              />
              <hr />
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
        <ExamplesMenu examples={ed.examples} onPick={ed.loadExample} />
        <Show when={!compact()}>
        <span class="sep" />
        <button
          class="btn share"
          classList={{ stale: stale() && !copied(), copied: copied() }}
          onClick={share}
          title={
            stale()
              ? "This net has changed since the link in the address bar was made. Update the link and copy it"
              : "Put a link to this net in the address bar and copy it"
          }
        >
          <Show when={copied()} fallback={<I.Copy />}>
            <I.Check />
          </Show>
          {copied() ? "Copied" : stale() ? "Update link" : "Copy link"}
        </button>
        </Show>
      </div>

      <div class="island top-right">
        {/* While a rule is open, undo and redo act on it. */}
        <button
          ref={undoBtn}
          class="btn icon"
          onClick={() => (subEditor() ? subEditor()!.m.undo() : ed.dispatch({ kind: "history/undo" }))}
          disabled={!(subEditor()?.m ?? m).historySize().undo}
          title={subEditor() ? "Undo in the rule (⌘Z)" : "Undo (⌘Z)"}
        >
          <I.Undo />
        </button>
        <button
          ref={redoBtn}
          class="btn icon"
          onClick={() => (subEditor() ? subEditor()!.m.redo() : ed.dispatch({ kind: "history/redo" }))}
          disabled={!(subEditor()?.m ?? m).historySize().redo}
          title={subEditor() ? "Redo in the rule (⇧⌘Z)" : "Redo (⇧⌘Z)"}
        >
          <I.Redo />
        </button>
        {/* On a phone the theme is in the view menu. */}
        <Show when={!compact()}>
          <span class="sep" />
          <button class="btn icon" onClick={toggleTheme} title="Switch between light and dark">
            <I.Theme />
          </button>
        </Show>
      </div>

      <Palette ed={ed} camera={camera} />

      <Show when={!compact()} fallback={<PhoneSheet kit={phone} viewMenu={viewMenu} />}>
        <div class="panel-stack" classList={{ hidden: !!subEditor() }}>
          <HoverPanel ed={ed} />
          <SelectionPanel ed={ed} />
        </div>
        <div class="bottom-bar">
          <Counters ed={ed} />

          <div class="island transport" aria-label="Run">
            <button
              class="btn outline"
              onClick={() => ed.dispatch({ kind: "run/step-one" })}
              onPointerEnter={() => !ed.running() && ed.setPreviewMode("next")}
              onPointerLeave={() => !ed.running() && ed.setPreviewMode(undefined)}
              disabled={!active() || ed.running()}
              title="Fire one active pair (S)"
            >
              <I.Step />
              Step
            </button>
            <button
              class="btn outline"
              onClick={() => ed.dispatch({ kind: "run/step-all" })}
              onPointerEnter={() => !ed.running() && ed.setPreviewMode("all")}
              onPointerLeave={() => !ed.running() && ed.setPreviewMode(undefined)}
              disabled={!active() || ed.running()}
              title="Fire every active pair at once (A)"
            >
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
            <Show when={ed.canResetExample()}>
              <button class="btn outline" onClick={ed.resetExample} title="Restore the loaded example to its starting net. You can undo this.">
                Reset example
              </button>
            </Show>
            <span class="sep" />
            {speed()}
          </div>

          <div class="island view-controls">
            {layout()}
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
                  {wireTypes(close)}
                </>
              )}
            </Menu>
          </div>
        </div>
      </Show>

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
        {(screen) => <RuleEditor ed={ed} left={screen.left} right={screen.right} phone={phone} />}
      </Show>
      <Tooltips />
      {import.meta.env.DEV && <Show when={freezeState()}>
        <div class="dev-freeze-notice" role="status">
          <strong>DEV · Freeze state</strong>
          <span>Triggered by <kbd>Shift+F</kbd>. Press <kbd>Shift+F</kbd> or <kbd>Escape</kbd> to return to normal.</span>
        </div>
      </Show>}
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
              Undo <span class="kbd">{shortcuts("⌘Z")}</span>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** The document to start with: the one in a share link, or the last session's. */
export async function initialDoc(): Promise<{ doc?: Doc; fromLink: boolean }> {
  const linked = await fromShareHash(location.hash);
  return linked ? { doc: linked, fromLink: true } : { doc: loadLocal(), fromLink: false };
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
