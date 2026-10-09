import { For, createSignal, onCleanup, onMount } from "solid-js";
import { Groups, uses } from "../core/groups";
import { Net } from "../core/net";
import type { Editor } from "../state/editor";
import { createNetModel } from "../state/model";
import { Canvas } from "./Canvas";
import { ComponentGlyph, Glyph } from "./Glyph";

/**
 * Edit a component's definition. Its free ports are its interface: drop a
 * wire on the top or bottom edge to add one. Saving rebuilds every instance.
 */
export function ComponentEditor(props: { ed: Editor; id: string }) {
  const ed = props.ed;
  const def = ed.defs().get(props.id)!;
  const [name, setName] = createSignal(def.name);
  const [symbol, setSymbol] = createSignal(def.symbol);
  const [error, setError] = createSignal<string>();

  // Components that use this one can't go inside it.
  const allowed = () => new Map([...ed.defs()].filter(([id]) => !uses(ed.defs(), id, props.id)));
  const m = createNetModel({ system: () => ed.system, defs: () => ed.defs() });
  m.setNet(Net.fromJSON(def.net), new Map(), Groups.fromJSON(def.groups));

  const save = () => {
    const err = ed.updateComponent(props.id, m.net, m.groups, { name: name().trim() || def.name, symbol: symbol().trim() || "?" });
    if (err) setError(err);
    else ed.closeComponent();
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      e.stopImmediatePropagation();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? m.redo() : m.undo();
      } else if (mod && e.key === "Enter") save();
      else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") m.deleteSelection();
      else if (e.key === "Escape") {
        if (m.selection() || m.armed()) {
          m.setSelection(undefined);
          m.setArmed(undefined);
        } else ed.closeComponent();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));
  });

  return (
    <div class="rule-editor" role="dialog" aria-label={`Component ${def.name}`}>
      <header class="rule-head">
        <div class="component-meta">
          <label>
            Name <input type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label>
            Symbol{" "}
            <input type="text" class="short" maxLength={4} value={symbol()} onInput={(e) => setSymbol(e.currentTarget.value)} />
          </label>
        </div>
        <div class="rule-actions">
          <button class="btn" onClick={m.undo} disabled={!m.historySize().undo}>
            Undo
          </button>
          <button class="btn" onClick={m.redo} disabled={!m.historySize().redo}>
            Redo
          </button>
          <button
            class="btn"
            onClick={() => {
              const err = ed.deleteComponent(props.id);
              if (err) setError(err);
              else ed.closeComponent();
            }}
          >
            Delete component
          </button>
          <button class="btn" onClick={ed.closeComponent}>
            Cancel
          </button>
          <button class="btn on" onClick={save} title="Save component (⌘↵)">
            Save component
          </button>
        </div>
      </header>
      <div class="rule-palette">
        <span class="caption">Add</span>
        <For each={[...ed.system.types.values()]}>
          {(t) => (
            <button class="palette-btn" onClick={() => m.addAgent(t.id)} title={`Add ${t.name}`}>
              <Glyph type={t} />
            </button>
          )}
        </For>
        <For each={[...allowed().values()]}>
          {(d) => (
            <button class="palette-btn" onClick={() => m.addComponent(d.id)} title={`Add ${d.name}`}>
              <ComponentGlyph def={d} />
            </button>
          )}
        </For>
        <span class="rule-status" classList={{ warn: !!error() }}>
          {error() ??
            (() => {
              m.rev();
              const n = m.net.free.size;
              return n === 1 ? "1 interface port." : `${n} interface ports.`;
            })()}
        </span>
      </div>
      <div class="rule-body single">
        <Canvas m={m} class="rule-rhs" />
      </div>
      <p class="rule-help">
        Free ports are the component's interface: drag a wire end onto empty canvas to leave a loose end. Saving updates every
        instance.
      </p>
    </div>
  );
}

