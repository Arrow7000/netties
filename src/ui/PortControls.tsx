import { For, Show, createSignal } from "solid-js";
import type { Level, Polarity } from "../core/types";
import { Popover } from "./Popover";
import { Check, Chevron, Plus } from "./icons";
import { PolarityIcon } from "./PolarityIcon";

/**
 * The two settings every port can have, used alike in the agent editor and
 * in the directions and types sheet: which way it goes, and what it carries.
 */

/**
 * Gives / Takes / Either. Under Required, Either can't be chosen. Gives and
 * Takes carry their icons, still until pointed at: the directions sheet has
 * a row of these per port, and all of them moving would be a lot.
 */
export function DirectionControl(props: { value?: Polarity; level: Level; onChange: (v: Polarity | undefined) => void }) {
  const required = () => props.level === "required";
  const [pointed, setPointed] = createSignal<Polarity>();
  const opt = (label: string, v: Polarity | undefined, title: string) => (
    <button
      type="button"
      aria-pressed={props.value === v}
      classList={{ missing: required() && !props.value && v === undefined }}
      disabled={required() && v === undefined}
      title={required() && v === undefined ? "Directions are required: every port gives or takes" : title}
      onClick={() => props.onChange(v)}
      onPointerEnter={() => setPointed(v)}
      onPointerLeave={() => setPointed(undefined)}
    >
      {v && <PolarityIcon pol={v} playing={pointed() === v} />}
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
  onNew: (name: string) => string | undefined;
}) {
  let button!: HTMLButtonElement;
  const [open, setOpen] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const required = () => props.level === "required";
  const close = () => {
    setOpen(false);
    setAdding(false);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        class="select type-select"
        classList={{ missing: required() && !props.value, any: !props.value, open: open() }}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => (open() ? close() : setOpen(true))}
      >
        <span>{props.value ?? (required() ? "choose a type" : "any type")}</span>
        <Chevron />
      </button>
      <Show when={open()}>
        <Popover anchor={button} onClose={close}>
          <Show
            when={!adding()}
            fallback={<NewTypeForm onAdd={(n) => { const why = props.onNew(n); if (!why) { props.onChange(n); close(); } return why; }} />}
          >
            <For each={props.names}>
              {(n) => (
                <button type="button" class="mi" role="menuitemradio" aria-checked={props.value === n} onClick={() => (props.onChange(n), close())}>
                  <span class="mi-lead">{props.value === n ? <Check /> : <span class="mi-blank" />}</span>
                  <span class="mi-text">
                    <span>{n}</span>
                  </span>
                </button>
              )}
            </For>
            <button
              type="button"
              class="mi"
              role="menuitemradio"
              aria-checked={!props.value}
              disabled={required()}
              onClick={() => (props.onChange(undefined), close())}
            >
              <span class="mi-lead">{!props.value ? <Check /> : <span class="mi-blank" />}</span>
              <span class="mi-text">
                <span>any type</span>
                <span class="mi-note">{required() ? "Types are required in this system" : "Fits a port of any type"}</span>
              </span>
            </button>
            <hr />
            <button type="button" class="mi" onClick={() => setAdding(true)}>
              <span class="mi-lead">
                <Plus />
              </span>
              <span class="mi-text">
                <span>New type…</span>
              </span>
            </button>
          </Show>
        </Popover>
      </Show>
    </>
  );
}

/** Name a new type. Enter adds it; the reason shows if the name won't do. */
export function NewTypeForm(props: { onAdd: (name: string) => string | undefined; initial?: string; label?: string }) {
  const [why, setWhy] = createSignal<string>();
  return (
    <div class="type-form">
      <div class="menu-head">{props.label ?? "New type"}</div>
      <input
        class="input"
        value={props.initial ?? ""}
        placeholder="e.g. list, bool, tree"
        ref={(el) => setTimeout(() => (el.focus(), el.select()))}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const n = e.currentTarget.value.trim();
          if (!n) return setWhy("Give it a name.");
          setWhy(props.onAdd(n));
        }}
      />
      <div class="type-form-note" classList={{ bad: !!why() }}>
        {why() ?? "Enter adds it."}
      </div>
    </div>
  );
}

/**
 * A system's types as chips. Pointing at one lights up its ports on the
 * canvas; clicking one renames or deletes it; the last chip adds a type.
 */
export function TypeChips(props: {
  names: string[];
  uses: (name: string) => number;
  onHover: (name: string | undefined) => void;
  onAdd: (name: string) => string | undefined;
  onRename: (from: string, to: string) => string | undefined;
  onDelete: (name: string) => void;
}) {
  const [open, setOpen] = createSignal<{ name?: string; el: HTMLElement }>();
  return (
    <div class="type-chips">
      <For each={props.names}>
        {(n) => (
          <button
            type="button"
            class="type-chip"
            classList={{ on: open()?.name === n }}
            onPointerEnter={() => props.onHover(n)}
            onPointerLeave={() => props.onHover(undefined)}
            onClick={(e) => setOpen({ name: n, el: e.currentTarget })}
            title="Point at it to light up its ports. Click to rename or delete it."
          >
            {n}
          </button>
        )}
      </For>
      <button type="button" class="type-chip add" classList={{ on: !!open() && !open()!.name }} onClick={(e) => setOpen({ el: e.currentTarget })}>
        <Plus />
        Add type
      </button>
      <Show when={open()} keyed>
        {(o) => (
          <Popover anchor={o.el} onClose={() => setOpen(undefined)}>
            <Show
              when={o.name}
              fallback={<NewTypeForm onAdd={(n) => { const why = props.onAdd(n); if (!why) setOpen(undefined); return why; }} />}
            >
              {(name) => (
                <>
                  <NewTypeForm
                    label="Rename type"
                    initial={name()}
                    onAdd={(to) => {
                      const why = to === name() ? undefined : props.onRename(name(), to);
                      if (!why) setOpen(undefined);
                      return why;
                    }}
                  />
                  <hr />
                  <button
                    type="button"
                    class="mi danger"
                    onClick={() => {
                      props.onDelete(name());
                      setOpen(undefined);
                    }}
                  >
                    <span class="mi-text">
                      <span>Delete type</span>
                      <span class="mi-note">
                        {props.uses(name())
                          ? `Its ${props.uses(name()) === 1 ? "port takes" : `${props.uses(name())} ports take`} any type instead.`
                          : "Nothing uses it."}
                      </span>
                    </span>
                  </button>
                </>
              )}
            </Show>
          </Popover>
        )}
      </Show>
    </div>
  );
}
