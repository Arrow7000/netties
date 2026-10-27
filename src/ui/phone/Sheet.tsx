import { For, type JSX, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { canMeet } from "../../core/types";
import { sideways } from "../compact";
import * as I from "../icons";
import { openRuleGrid } from "../Palette";
import { hoverInfo } from "../Panels";
import { GRID_FITS, GridLegend, GridSummary, RuleGrid } from "../RuleGrid";
import { canLeave } from "../subEditor";
import { type Detent, type DetentMsg, type SheetAt, updateDetent } from "./detent";
import { createFocus } from "./focus";
import type { Phone } from "./kit";
import { Ghost, HoldMenu, MakeDialog, RunButtons, SelectionView, Tile, TileHint, TypesLine, edgeFades, tileList } from "./parts";

type Face = "agents" | "rules" | "focus";

/** The sheet's parts, in pixels: its grabber, the row of faces, the first row of a face, and the run bar. */
const GRAB = 18;
const FACES = 42;
const PEEK = 124;
const BAR = 52;
/** The line along the top of the sheet's body, inside its height. */
const EDGE = 1;

/**
 * The phone layout's one sheet along the bottom (sideways, down the right).
 * The run bar is its floor, and above it a face shows the agents to add,
 * the rules, or what's selected or tapped. It rests at a peek (one row of
 * the face), pulls up for the whole face, and flicks down to just the bar.
 */
export function PhoneSheet(props: { kit: Phone; viewMenu: () => JSX.Element }) {
  const kit = props.kit;
  const ed = kit.ed;
  const m = ed.model;
  const f = createFocus(kit);

  // How far up it is, by its machine (./detent.ts).
  const [height, setHeight] = createSignal<SheetAt>({ detent: "peek" });
  const detent = () => height().detent;
  const send = (msg: DetentMsg) => setHeight((s) => updateDetent(s, msg));
  const [chosenFace, setChosenFace] = createSignal<Exclude<Face, "focus">>("agents");
  const [face, setFace] = createSignal<Face>("agents");
  /** The body's height while a finger drags the sheet. */
  const [dragged, setDragged] = createSignal<number>();
  const [vh, setVh] = createSignal(innerHeight);
  onMount(() => {
    const r = () => setVh(innerHeight);
    window.addEventListener("resize", r);
    onCleanup(() => window.removeEventListener("resize", r));
  });

  /** How tall what's selected is, all said: the sheet's peek fits it. */
  const [focusH, setFocusH] = createSignal(PEEK);
  let focusRo: ResizeObserver | undefined;
  onCleanup(() => focusRo?.disconnect());
  const measure = (el: HTMLElement) => {
    focusRo?.disconnect();
    focusRo = new ResizeObserver(() => setFocusH(el.offsetHeight));
    focusRo.observe(el);
  };

  /**
   * How tall the whole face is: pulled up, the sheet is no taller than that.
   * Rounded up, since a face can be a fraction of a pixel tall, and the
   * body is then that and its top line, or it would scroll by a pixel.
   */
  const [contentH, setContentH] = createSignal(400);
  let contentRo: ResizeObserver | undefined;
  onCleanup(() => contentRo?.disconnect());
  const measureContent = (el: HTMLElement) => {
    contentRo = new ResizeObserver(() => setContentH(Math.ceil(el.getBoundingClientRect().height)));
    contentRo.observe(el);
  };

  /** How tall the face is at each detent. Sideways the sheet is a column: closed or as tall as the screen. */
  const heights = createMemo(() => {
    if (sideways()) {
      const full = Math.max(PEEK, vh() - 16 - GRAB - FACES - BAR - 12);
      return { closed: 0, peek: full, open: full };
    }
    const peek = face() === "focus" ? Math.min(Math.max(focusH() + EDGE, 60), 230) : PEEK;
    const most = Math.round(vh() * 0.66) - GRAB - FACES - BAR;
    return { closed: 0, peek, open: Math.max(peek, Math.min(most, contentH() + EDGE)) };
  });
  const bodyHeight = () => dragged() ?? heights()[detent()];
  /** Pulled up, the body scrolls, but only if the face is taller than it is, so there's no scrollbar for nothing. */
  const scrolls = () => open() && dragged() === undefined && contentH() + EDGE > bodyHeight() + 0.5;

  // The net is fitted clear of the sheet put away, wherever it is now: the net gets all
  // the room there is, and a sheet pulled up covers some of it, like a keyboard.
  createEffect(() => {
    if (sideways()) kit.setRoom({ b: 8, r: 300 + 8 });
    else kit.setRoom({ b: 8 + GRAB + BAR + 2, r: 8 });
  });

  // What's selected takes the sheet over, and lifts it to its peek if it was down;
  // when it goes, the sheet goes back to the face (and height) it had.
  createEffect(
    on(
      () => f.focus()?.kind,
      (k, was) => {
        if (k && !was) {
          if (kit.fromTile() && face() !== "focus") return;
          setFace("focus");
          send({ kind: "focus", on: true });
        } else if (!k && was) {
          setFace(chosenFace());
          send({ kind: "focus", on: false });
        }
      },
    ),
  );
  // A new selection, or a new tap, brings the face back even if another was picked;
  // a cell picked in the rule grid is pointed at too, but keeps to the Rules face.
  const tapped = createMemo<ReturnType<typeof m.hover>>((was) => {
    const h = m.hover();
    return h?.kind === "pair" ? was : h;
  });
  createEffect(on(() => [m.selection(), tapped(), kit.armed(), kit.armedRun()], () => f.focus() && !kit.fromTile() && setFace("focus"), { defer: true }));
  // A tap on empty canvas puts the sheet away; a tap on something shows it at the peek.
  createEffect(on(kit.taps, (t) => send({ kind: "tap-canvas", empty: t.empty, focus: !!f.focus() }), { defer: true }));

  const pick = (x: Face) => {
    if (x !== "focus") setChosenFace(x);
    setFace(x);
    send({ kind: "pick" });
  };

  // A tile lifted out: the sheet gets out of the way, and comes back after.
  const onLift = (on: boolean) => send({ kind: "lift", on });

  /**
   * A finger on the grabber's row or the faces row, anywhere but a button:
   * the sheet follows it, and settles on the nearest detent, or the one it
   * was flicked to. A tap there puts it away, or brings it back to its peek.
   */
  const grab = (e: PointerEvent) => {
    if ((e.target as Element).closest("button")) return;
    const y0 = e.clientY;
    const h0 = bodyHeight();
    let moved = false;
    let last = { y: y0, t: performance.now() };
    let v = 0;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 6) return;
      moved = true;
      const now = performance.now();
      v = (ev.clientY - last.y) / Math.max(1, now - last.t);
      last = { y: ev.clientY, t: now };
      const hs = heights();
      const want = h0 - (ev.clientY - y0);
      // Past the ends it gives a little, then stops.
      const over = want > hs.open ? hs.open + (want - hs.open) * 0.25 : want < 0 ? want * 0.25 : want;
      setDragged(Math.max(-12, over));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const h = dragged();
      setDragged(undefined);
      if (!moved || h === undefined) return send({ kind: "tap-grabber" });
      const hs = heights();
      const order: Detent[] = sideways() ? ["closed", "open"] : ["closed", "peek", "open"];
      const at = (d: Detent) => hs[d];
      let target: Detent;
      if (Math.abs(v) > 0.45) {
        // A flick goes on to the next detent that way; a hard flick down shuts it.
        if (v > 1.6) target = "closed";
        else if (v > 0) target = [...order].reverse().find((d) => at(d) < h - 4) ?? "closed";
        else target = order.find((d) => at(d) > h + 4) ?? order[order.length - 1]!;
      } else target = order.reduce((a, b) => (Math.abs(at(b) - h) < Math.abs(at(a) - h) ? b : a));
      send({ kind: "settle", to: target });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const tiles = () => tileList(kit);
  const axis = () => (sideways() ? "y" : "x");
  const open = () => detent() === "open" || sideways();

  return (
    <>
      <div
        class="island sheet phone-chrome"
        classList={{ dragging: dragged() !== undefined, closed: detent() === "closed" && dragged() === undefined, side: sideways() }}
      >
        <div class="sheet-handle" onPointerDown={grab}>
          <div class="sheet-grab" role="button" aria-label={detent() === "closed" ? "Bring up the sheet" : "Put the sheet away"}>
            <span />
          </div>
          <div class="sheet-faces">
            <div class="seg" role="tablist">
              <button aria-pressed={face() === "agents"} onClick={() => pick("agents")}>
                Agents
              </button>
              <button aria-pressed={face() === "rules"} onClick={() => pick("rules")}>
                Rules
              </button>
              <Show when={f.focus()}>
                <button class="sheet-focus-tab" aria-pressed={face() === "focus"} onClick={() => pick("focus")}>
                  Selection
                </button>
              </Show>
            </div>
            <Show when={face() === "agents" && !sideways()}>
              <button class="btn small outline push" onClick={() => ed.openAgent("new")}>
                <I.Plus />
                New
              </button>
            </Show>
          </div>
        </div>

        <div class="sheet-body" style={{ height: `${Math.max(0, bodyHeight())}px` }} classList={{ scroll: scrolls() }}>
          <div ref={measureContent}>
            <Show when={face() === "agents"}>
              {/* At its peek, the sheet shows this much: the agents, and what to do with them. */}
              <div class="sheet-agents">
                <div class="sheet-tiles" ref={edgeFades} classList={{ wrap: sideways() }}>
                  <For each={tiles().types}>{(w) => <Tile kit={kit} what={w} axis={axis()} onLift={onLift} />}</For>
                  <Show when={sideways()}>
                    <button class="tile sheet-tile new" onClick={() => ed.openAgent("new")}>
                      <I.Plus />
                      <span class="tile-name">New</span>
                    </button>
                  </Show>
                </div>
                <TileHint kit={kit} of="type" />
              </div>
              <div class="sheet-section">
                <div class="section-head">
                  <h2>Components</h2>
                  <button
                    class="btn small outline"
                    aria-disabled={!m.selectedAgents().length}
                    onClick={() => (m.selectedAgents().length ? kit.setMaking(true) : ed.notify("Select some agents first, then make them a component."))}
                  >
                    <I.Component />
                    From selection
                  </button>
                </div>
                <Show when={tiles().components.length} fallback={<p class="palette-hint">Select some agents and make them a component to reuse them.</p>}>
                  <div class="sheet-tiles" ref={edgeFades} classList={{ wrap: sideways() }}>
                    <For each={tiles().components}>{(w) => <Tile kit={kit} what={w} axis={axis()} onLift={onLift} />}</For>
                  </div>
                  <TileHint kit={kit} of="component" />
                </Show>
              </div>
              <div class="sheet-section">
                <TypesLine kit={kit} />
              </div>
            </Show>

            <Show when={face() === "rules"}>
              <RulesFace kit={kit} />
            </Show>

            <Show when={face() === "focus"}>
              {/* Pulled up, all the actions show; otherwise a row of them, with More to pull it up. On its side, a column with them all. */}
              <SelectionView
                ref={measure}
                focus={f}
                row={sideways() ? 3 : 5}
                folds={!sideways()}
                expanded={open()}
                onMore={() => send({ kind: "more" })}
                fallback={<p class="palette-hint sheet-empty">Tap something on the canvas to see what it is.</p>}
              />
            </Show>
          </div>
        </div>

        <div class="sheet-bar">
          <RunButtons kit={kit} />
          <div class="view-controls sheet-view">
            <button class="btn icon" onClick={kit.camera.fit} aria-label="Fit the net in view">
              <I.Fit />
            </button>
            {props.viewMenu()}
          </div>
        </div>
      </div>
      <Ghost kit={kit} />
      <HoldMenu kit={kit} selectAll={() => ed.dispatch({ kind: "selection/all" })} />
      <MakeDialog kit={kit} />
    </>
  );
}

/**
 * The Rules face: the grid of rules and its legend. A tap on a cell picks
 * it (its kind lights up in the legend), and what it is shows under them,
 * with a button to open its rule.
 */
function RulesFace(props: { kit: Phone }) {
  const kit = props.kit;
  const ed = kit.ed;
  const m = ed.model;
  const cellInfo = hoverInfo(ed, { hints: false });
  const cell = () => {
    const h = m.hover();
    return h?.kind === "pair" ? h : undefined;
  };
  // Leaving the face lets go of the cell picked in it.
  onCleanup(() => cell() && m.setHover(undefined));
  const types = () => (ed.rev(), [...ed.system.types.values()]);
  return (
    <div class="sheet-rules">
      <div class="sheet-rules-head">
        <span>
          {(ed.rev(), ed.system.rules.size)} rules for {types().length} agents
        </span>
        <button class="btn small outline" onClick={openRuleGrid}>
          <I.Expand />
          Full grid
        </button>
      </div>
      <GridSummary ed={ed} />
      <Show
        when={types().length <= GRID_FITS}
        fallback={
          <button class="grid-thumb" onClick={openRuleGrid} aria-label="Open the rule grid">
            <RuleGrid ed={ed} thumb />
          </button>
        }
      >
        <RuleGrid ed={ed} pick />
      </Show>
      <GridLegend ed={ed} />
      <Show when={cell() && cellInfo()}>
        {(i) => {
          const has = () => (ed.rev(), !!cell() && !!ed.system.ruleFor(cell()!.a, cell()!.b));
          const never = () => (ed.rev(), !cell() || !!canMeet(ed.system, cell()!.a, cell()!.b));
          return (
            <div class="sheet-cell">
              <div class="panel-title">
                <span>{i().title}</span>
                <Show when={i().aside}>
                  <span class="panel-aside">{i().aside}</span>
                </Show>
              </div>
              <For each={i().lines}>
                {(l) => (
                  <div class="panel-line" classList={{ bad: l.tone === "bad", accent: l.tone === "accent" }}>
                    {l.text}
                  </div>
                )}
              </For>
              <Show when={!never()}>
                <button
                  class="btn small primary"
                  onClick={() => {
                    const c = cell();
                    if (!c || !canLeave()) return;
                    m.setHover(undefined);
                    ed.openRule(c.a, c.b);
                  }}
                >
                  <I.Rule />
                  {has() ? "Edit rule" : "Write rule"}
                </button>
              </Show>
            </div>
          );
        }}
      </Show>
      <TypesLine kit={kit} />
    </div>
  );
}
