import { For, Show, createMemo, onCleanup, onMount } from "solid-js";
import { interfaceNet, interfacePins, isSymmetric, netToRule, pairNet, parseIface, ruleToNet } from "../core/ruleNet";
import { createNetModel } from "../state/model";
import type { Editor } from "../state/editor";
import { Canvas } from "./Canvas";
import { Glyph } from "./Glyph";

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUB[Number(d)]!);

/** Interface ports read as x₁… for the top agent and y₁… for the bottom one. */
const ifaceLabel = (name: string) => {
  const i = parseIface(name);
  return i ? `${i.side === 0 ? "x" : "y"}${sub(i.slot)}` : name;
};

/**
 * Draw what a pair turns into. The left side shows the pair tip to tip with
 * its aux wires running out to the interface; the right side keeps that
 * interface fixed along the top and bottom while you build the result.
 */
export function RuleEditor(props: { ed: Editor; left: string; right: string }) {
  const ed = props.ed;
  const sys = () => ed.system;
  // A rule stored the other way round is edited from its own point of view.
  const existing = sys().ruleFor(props.left, props.right);
  const [left, right] = existing?.swapped ? [props.right, props.left] : [props.left, props.right];
  const pins = interfacePins(sys(), left, right);

  const lhs = createNetModel({ system: sys, pins: () => pins, fixedInterface: true });
  lhs.setNet(pairNet(sys(), left, right).net);
  const rhs = createNetModel({ system: sys, pins: () => pins, fixedInterface: true });
  rhs.setNet(existing ? ruleToNet(sys(), existing.rule) : interfaceNet(sys(), left, right));

  const types = () => {
    ed.rev();
    return [...sys().types.values()];
  };

  const status = createMemo(() => {
    rhs.rev();
    const { rule, open } = netToRule(left, right, rhs.net);
    const symmetric = left !== right || isSymmetric(rhs.net);
    return { rule, open, symmetric };
  });

  const sym = (id: string) => sys().types.get(id)?.symbol ?? id;

  const save = () => {
    const { rule, open } = status();
    if (open) return;
    ed.saveRule(rule);
    ed.closeRule();
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea, select")) return;
      e.stopImmediatePropagation();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? rhs.redo() : rhs.undo();
      } else if (mod && e.key === "Enter") save();
      else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") rhs.deleteSelection();
      else if (e.key === "Escape") {
        if (rhs.selection() || rhs.armed()) {
          rhs.setSelection(undefined);
          rhs.setArmed(undefined);
        } else ed.closeRule();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));
  });

  return (
    <div class="rule-editor" role="dialog" aria-label={`Rule for ${sym(left)} and ${sym(right)}`}>
      <header class="rule-head">
        <h2>
          When <i>{sym(left)}</i> meets <i>{sym(right)}</i>
        </h2>
        <div class="rule-actions">
          <button class="btn" onClick={rhs.undo} disabled={!rhs.historySize().undo}>
            Undo
          </button>
          <button class="btn" onClick={rhs.redo} disabled={!rhs.historySize().redo}>
            Redo
          </button>
          <Show when={existing}>
            <button
              class="btn"
              onClick={() => {
                ed.deleteRule(left, right);
                ed.closeRule();
              }}
            >
              Delete rule
            </button>
          </Show>
          <button class="btn" onClick={ed.closeRule}>
            Cancel
          </button>
          <button class="btn on" onClick={save} disabled={status().open > 0} title="Save rule (⌘↵)">
            Save rule
          </button>
        </div>
      </header>
      <div class="rule-palette">
        <span class="caption">Add</span>
        <For each={types()}>
          {(t) => (
            <button class="palette-btn" onClick={() => rhs.addAgent(t.id)} title={`Add ${t.name}`}>
              <Glyph type={t} />
            </button>
          )}
        </For>
        <span class="rule-status" classList={{ warn: status().open > 0 || !status().symmetric }}>
          {status().open > 0
            ? status().open === 1
              ? "1 port still needs a wire."
              : `${status().open} ports still need a wire.`
            : !status().symmetric
              ? "Not symmetric: the result depends on which one is on top."
              : "Every port is wired."}
        </span>
      </div>
      <div class="rule-body">
        <Canvas m={lhs} readonly freeLabel={ifaceLabel} class="rule-lhs" />
        <div class="rule-arrow" aria-hidden="true">
          ↦
        </div>
        <Canvas m={rhs} freeLabel={ifaceLabel} class="rule-rhs" />
      </div>
      <p class="rule-help">
        Drag from a port to another port, or to one of the interface ends labelled x and y. Two interface ends can be
        wired straight to each other.
      </p>
    </div>
  );
}
