import { For, Show, createSignal } from "solid-js";
import type { Level, Polarity } from "../core/types";

/**
 * The two settings every port can have, used alike in the agent editor and
 * in the directions and types sheet: which way it goes, and what it carries.
 */

const NEW = "\u0000new";
const ANY = "";

/** Gives / Takes / Either. Under Required, Either can't be chosen. */
export function DirectionControl(props: { value?: Polarity; level: Level; onChange: (v: Polarity | undefined) => void }) {
  const required = () => props.level === "required";
  const opt = (label: string, v: Polarity | undefined, title: string) => (
    <button
      type="button"
      aria-pressed={props.value === v}
      classList={{ missing: required() && !props.value && v === undefined }}
      disabled={required() && v === undefined}
      title={required() && v === undefined ? "Directions are required: every port gives or takes" : title}
      onClick={() => props.onChange(v)}
    >
      {label}
    </button>
  );
  return (
    <div class="seg dir-seg" classList={{ missing: required() && !props.value }} role="group" aria-label="Direction">
      {opt("Gives", "give", "Wires from it run to a port that takes")}
      {opt("Takes", "take", "Wires into it come from a port that gives")}
      {opt("Either", undefined, "Wires can go either way")}
    </div>
  );
}

/** A port's type: one of the system's types, or any type. "New type…" adds one on the spot. */
export function TypeControl(props: {
  value?: string;
  names: string[];
  level: Level;
  onChange: (v: string | undefined) => void;
  onNew: (name: string) => void;
}) {
  const [adding, setAdding] = createSignal(false);
  const required = () => props.level === "required";
  return (
    <Show
      when={!adding()}
      fallback={
        <input
          class="input type-input"
          placeholder="New type, like bool"
          ref={(el) => setTimeout(() => el.focus())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const n = e.currentTarget.value.trim();
              if (n) {
                props.onNew(n);
                props.onChange(n);
              }
              setAdding(false);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setAdding(false);
            }
          }}
          onBlur={() => setAdding(false)}
        />
      }
    >
      <select
        class="select type-select"
        classList={{ missing: required() && !props.value, any: !props.value }}
        value={props.value ?? ANY}
        aria-label="Type"
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === NEW) {
            e.currentTarget.value = props.value ?? ANY;
            setAdding(true);
          } else props.onChange(v || undefined);
        }}
      >
        <Show when={!required() || !props.value}>
          <option value={ANY} disabled={required()}>
            {required() ? "choose a type" : "any type"}
          </option>
        </Show>
        <For each={props.names}>{(n) => <option value={n}>{n}</option>}</For>
        <option value={NEW}>New type…</option>
      </select>
    </Show>
  );
}
