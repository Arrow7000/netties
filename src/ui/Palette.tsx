import { For, type JSX, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import type { Editor } from "../state/editor";
import type { Camera } from "./Canvas";
import { ComponentGlyph, Glyph } from "./Glyph";
import { GRID_FITS, GridLegend, GridSummary, RuleGrid } from "./RuleGrid";
import { TypeChips } from "./PortControls";
import { TypeEditor } from "./TypeEditor";
import { Chevron, Close, Component, Expand, Plus } from "./icons";

interface Carry {
  what: { kind: "type" | "component"; id: string };
  x: number;
  y: number;
  over: boolean;
}

/**
 * The palette floating on the right: agent types and components to drag in,
 * and the grid of rules.
 */
export function Palette(props: { ed: Editor; camera: Camera }) {
  const ed = props.ed;
  const m = ed.model;
  const editing = ed.agentOpen;
  const setEditing = (id: string | undefined) => (id ? ed.openAgent(id) : ed.closeAgent());
  const [carry, setCarry] = createSignal<Carry>();
  const [gridOpen, setGridOpen] = createSignal(false);

  const types = () => (ed.rev(), [...ed.system.types.values()]);
  const components = () => [...ed.defs().values()];
  const selected = () => m.selectedAgents().length > 0;

  /**
   * Press on a tile: a click opens its editor, a drag carries a new one to
   * the canvas.
   */
  const press = (what: Carry["what"], open: () => void) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      dragging = true;
      const over = !!props.camera.toWorld(ev.clientX, ev.clientY) && !overChrome(ev);
      setCarry({ what, x: ev.clientX, y: ev.clientY, over });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setCarry(undefined);
      if (!dragging) return open();
      const at = props.camera.toWorld(ev.clientX, ev.clientY);
      if (!at || overChrome(ev)) return;
      if (what.kind === "type") m.addAgent(what.id, at);
      else m.addComponent(what.id, at);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ghost = (): JSX.Element => {
    const c = carry();
    if (!c) return null;
    if (c.what.kind === "type") {
      const t = ed.system.types.get(c.what.id);
      return t ? <Glyph type={t} /> : null;
    }
    const d = ed.defs().get(c.what.id);
    return d ? <ComponentGlyph def={d} /> : null;
  };

  return (
    <>
      <aside class="island palette" aria-label="Palette">
        <section>
          <div class="section-head">
            <h2>Agents</h2>
            <button class="btn small outline" onClick={() => setEditing("new")}>
              <Plus />
              New agent
            </button>
          </div>
          <TypingSummary ed={ed} />
          <div class="tiles">
            <For each={types()}>
              {(t) => (
                <button
                  class="tile"
                  classList={{ editing: editing() === t.id }}
                  onPointerDown={press({ kind: "type", id: t.id }, () => setEditing(t.id))}
                  onPointerEnter={() => m.setHover({ kind: "type", id: t.id })}
                  onPointerLeave={() => m.setHover(undefined)}
                  aria-label={`${t.name}: drag to add, click to edit`}
                >
                  <Glyph type={t} />
                  <span class="tile-name">{t.name}</span>
                </button>
              )}
            </For>
          </div>
          <div class="section-head">
            <h2>Components</h2>
            <button
              class="btn small outline"
              aria-disabled={!selected()}
              title={selected() ? "Make the selected agents a component" : "Select some agents first"}
              onClick={() => selected() && ed.makeComponent("Component", "C")}
            >
              <Component />
              From selection
            </button>
          </div>
          <Show
            when={components().length}
            fallback={<p class="palette-hint">Select some agents and make them a component to reuse them.</p>}
          >
            <div class="tiles">
              <For each={components()}>
                {(d) => (
                  <button
                    class="tile component"
                    onPointerDown={press({ kind: "component", id: d.id }, () => ed.openComponent(d.id))}
                    onPointerEnter={() => m.setHover({ kind: "component", id: d.id })}
                    onPointerLeave={() => m.setHover(undefined)}
                    aria-label={`${d.name}: drag to add, click to edit`}
                  >
                    <ComponentGlyph def={d} />
                    <span class="tile-name">{d.name}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <p class="palette-hint">Drag onto the canvas to add. Click to edit.</p>
        </section>
        <section class="rules">
          <div class="section-head">
            <h2>Rules</h2>
            <button class="btn small outline" onClick={() => setGridOpen(true)} title="Open a bigger rule grid">
              <Expand />
              Expand
            </button>
          </div>
          <Show
            when={types().length <= GRID_FITS}
            fallback={
              <>
                <p class="palette-hint">
                  {types().length} agents make {(types().length * (types().length + 1)) / 2} pairs, too many to edit
                  here.
                </p>
                <button class="grid-thumb" onClick={() => setGridOpen(true)} aria-label="Open the rule grid">
                  <RuleGrid ed={ed} thumb />
                </button>
              </>
            }
          >
            <GridSummary ed={ed} />
            <RuleGrid ed={ed} />
            <GridLegend ed={ed} />
            <p class="palette-hint">Each cell is a pair of agents. Click one to see its rule, or to write one.</p>
          </Show>
        </section>
      </aside>
      <Show when={gridOpen()}>
        <div class="pop grid-pop" role="dialog" aria-label="Rule grid">
          <div class="te-head">
            <h3>Rules for {types().length} agents</h3>
            <button class="btn icon" title="Close" onClick={() => setGridOpen(false)}>
              <Close />
            </button>
          </div>
          <p class="palette-hint">
            Each cell is one pair of agents; γ with δ is the same rule as δ with γ, so only half the grid is used.
          </p>
          <GridSummary ed={ed} />
          <RuleGrid ed={ed} big />
          <GridLegend ed={ed} />
        </div>
      </Show>
      <Show when={editing()} keyed>
        {(id) => <TypeEditor ed={ed} id={id} onClose={() => setEditing(undefined)} />}
      </Show>
      <Show when={carry()}>
        {(c) => (
          <Portal>
            <div class="drag-ghost" classList={{ off: !c().over }} style={{ left: `${c().x}px`, top: `${c().y}px` }}>
              {ghost()}
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}

const LEVEL_WORD = { off: "off", optional: "optional", required: "required" } as const;

/**
 * How strict the system is, in one line that opens the directions and types
 * sheet, and its types as chips: pointing at one lights up its ports.
 */
function TypingSummary(props: { ed: Editor }) {
  const ed = props.ed;
  const t = () => (ed.rev(), ed.system.typing);
  const part = (what: string, level: keyof typeof LEVEL_WORD) => (
    <span classList={{ off: level === "off" }}>
      {what} <b>{LEVEL_WORD[level]}</b>
    </span>
  );
  return (
    <div class="typing-summary">
      <button class="typing-line" onClick={ed.openTypes} title="Directions and types for every agent">
        <Show
          when={t().dirs === t().types}
          fallback={
            <>
              {part("Directions", t().dirs)}
              <span class="dot"> · </span>
              <span class="nowrap">
                {part("types", t().types)}
                <Chevron />
              </span>
            </>
          }
        >
          <span class="nowrap">
            Directions and types <b>{LEVEL_WORD[t().dirs]}</b>
            <Chevron />
          </span>
        </Show>
      </button>
      <Show when={t().types !== "off"}>
        <TypeChips
          names={t().names}
          uses={(n) => ed.typeUses(n)}
          onHover={(n) => ed.model.setHover(n ? { kind: "porttype", name: n } : undefined)}
          onAdd={(n) => ed.addTypeName(n)}
          onRename={(a, b) => ed.renameTypeName(a, b)}
          onDelete={(n) => ed.deleteTypeName(n)}
        />
      </Show>
    </div>
  );
}

/** Whether a pointer is over a floating panel rather than the open canvas. */
function overChrome(e: PointerEvent): boolean {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  return !!el?.closest(".island, .pop, .menu");
}
