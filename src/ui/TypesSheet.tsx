import { For, type JSX, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Rule } from "../core/system";
import {
  type Level,
  addTypeNameOn,
  deleteTypeNameOn,
  guessPortsOn,
  missing,
  portName,
  renameTypeNameOn,
  setPortOn,
  setTypingOn,
  typeUses,
} from "../core/types";
import type { Editor } from "../state/editor";
import { Glyph, dirsOf } from "./Glyph";
import { DirectionControl, TypeChips, TypeControl } from "./PortControls";
import { DirWords } from "./PolarityIcon";
import { Close, Pencil } from "./icons";
import { dismissOnClickOutside } from "./dismiss";

type Dim = "dirs" | "types";

const LEVELS: { level: Level; label: string }[] = [
  { level: "off", label: "Off" },
  { level: "optional", label: "Optional" },
  { level: "required", label: "Required" },
];

/** What each setting means, and what choosing it would do. */
const MEANS: Record<Dim, Record<Level, string>> = {
  dirs: {
    off: "Any port can join any other.",
    optional: "Ports can give, take, or go either way.",
    required: "Every port gives or takes.",
  },
  types: {
    off: "Ports carry anything.",
    optional: "Ports can have a type. Ports without one fit any.",
    required: "Every port has a type.",
  },
};

/**
 * Every agent's ports in one table, for the whole system. The Directions and
 * Types settings head the columns they govern; the types themselves sit under
 * the Types heading. Changes go to a draft until Save, which applies them as
 * one edit; wires that would stop fitting are marked red on the canvas first.
 */
export function TypesSheet(props: { ed: Editor }) {
  const ed = props.ed;
  const draft = ed.draftSystem();
  const [drev, setDrev] = createSignal(0);
  /** Change the draft. */
  const edit = <T,>(f: () => T): T => {
    const out = f();
    setDrev((n) => n + 1);
    return out;
  };
  const sys = () => (drev(), draft);
  const typing = () => sys().typing;
  /** Agents by id, so a row stays put while its ports change. */
  const agentIds = [...draft.types.values()].filter((t) => !t.box).map((t) => t.id);
  const [preview, setPreview] = createSignal<{ dim: Dim; level: Level }>();

  const level = (d: Dim): Level => typing()[d];
  /** Ports still to fill in, for a setting switched to Required. */
  const gaps = createMemo(() => missing(sys()));
  const gapsIn = (d: Dim) => gaps().filter((g) => g.what === (d === "dirs" ? "dir" : "type"));
  const isGap = (type: string, slot: number, d: Dim) => gapsIn(d).some((g) => g.type === type && g.slot === slot);

  const choose = (d: Dim, l: Level) => {
    setPreview(undefined);
    if (l !== typing()[d]) edit(() => setTypingOn(draft, { [d]: l }));
  };

  /** What saving would cut and delete. */
  const effects = createMemo(() => (drev(), ed.rev(), ed.draftEffects(draft)));
  createEffect(() => ed.model.setDoomed(new Set(effects().wires)));
  onCleanup(() => ed.model.setDoomed(new Set<number>()));

  const snapshot = () => (drev(), JSON.stringify([draft.typing, [...draft.types.values()].map((t) => t.ports)]));
  const pristine = snapshot();
  const dirty = () => snapshot() !== pristine;
  const blockedWhy = () => {
    const n = gaps().length;
    if (!n) return undefined;
    return `${n === 1 ? "1 port still needs" : `${n} ports still need`} ${gapsIn("dirs").length ? (gapsIn("types").length ? "a direction or a type" : "a direction") : "a type"}, or set it back to Optional.`;
  };

  const note = (d: Dim): JSX.Element => {
    const p = preview();
    if (p?.dim === d) return <span class="preview">{d === "dirs" ? <DirWords text={MEANS[d][p.level]} /> : MEANS[d][p.level]}</span>;
    const n = level(d) === "required" ? gapsIn(d).length : 0;
    if (n) {
      return (
        <span class="pending">
          {n === 1 ? "1 port to go." : `${n} ports to go.`}{" "}
          <button class="link-btn" onClick={() => edit(() => guessPortsOn(draft, ed.net, d === "dirs" ? "dir" : "type"))}>
            Guess from the canvas
          </button>{" "}
          or{" "}
          <button class="link-btn" onClick={() => edit(() => setTypingOn(draft, { [d]: "optional" }))}>
            Stay optional
          </button>
        </span>
      );
    }
    return d === "dirs" ? <DirWords text={MEANS[d][typing()[d]]} /> : MEANS[d][typing()[d]];
  };

  const LevelSeg = (p: { dim: Dim }) => (
    <div class="seg level-seg" role="group" aria-label={p.dim === "dirs" ? "Directions" : "Types"}>
      <For each={LEVELS}>
        {(o) => (
          <button
            aria-pressed={level(p.dim) === o.level}
            onPointerEnter={() => setPreview({ dim: p.dim, level: o.level })}
            onPointerLeave={() => setPreview(undefined)}
            onClick={() => choose(p.dim, o.level)}
          >
            {o.label}
          </button>
        )}
      </For>
    </div>
  );

  // A click outside or Escape closes the sheet unless something has been changed; then Cancel and Save glow.
  let sheet!: HTMLDivElement;
  let cancelBtn!: HTMLButtonElement;
  let saveBtn!: HTMLButtonElement;
  const flash = () => {
    for (const b of [cancelBtn, saveBtn]) {
      b.classList.remove("flash-warm");
      void b.offsetWidth;
      b.classList.add("flash-warm");
    }
  };
  dismissOnClickOutside(() => sheet, ed.closeTypes, dirty, flash);
  const save = () => {
    if (blockedWhy()) return;
    if (dirty()) ed.applyTyping(draft);
    ed.closeTypes();
  };
  const sym = (id: string) => draft.types.get(id)?.symbol ?? id;
  const pairs = (rs: Rule[]) => rs.map((r, i) => (
    <>
      {i > 0 && (i === rs.length - 1 ? " and " : ", ")}
      <i class="sym">{sym(r.left)}</i> with <i class="sym">{sym(r.right)}</i>
    </>
  ));

  const off = (d: Dim) => level(d) === "off";
  const shade = (d: Dim) => {
    const p = preview();
    return !!p && p.dim === d && p.level !== level(d);
  };

  return (
    <div ref={sheet} class="pop types-sheet" role="dialog" aria-label="Directions and types">
      <div class="ts-head">
        <h3>
          Directions and types <small>for every agent in this system</small>
        </h3>
        <button class="btn icon" title="Close" onClick={ed.closeTypes}>
          <Close />
        </button>
      </div>
      <div class="ts-table">
        <div class="ts-row ts-top">
          <div class="ts-cell port-col">Port</div>
          <div class="ts-cell dir-col" classList={{ off: off("dirs"), shade: shade("dirs") }}>
            <span class="col-name" title="Does each port give or take?">
              Directions
            </span>
            <LevelSeg dim="dirs" />
            <p class="col-note">{note("dirs")}</p>
          </div>
          <div class="ts-cell type-col" classList={{ off: off("types"), shade: shade("types") }}>
            <span class="col-name" title="What does each port carry?">
              Types
            </span>
            <LevelSeg dim="types" />
            <p class="col-note">{note("types")}</p>
            <Show when={!off("types")}>
              <TypeChips
                names={typing().names}
                uses={(n) => typeUses(sys(), n)}
                onHover={(n) => ed.model.setHover(n ? { kind: "porttype", name: n } : undefined)}
                onAdd={(n) => edit(() => addTypeNameOn(draft, n))}
                onRename={(a, b) => edit(() => renameTypeNameOn(draft, a, b))}
                onDelete={(n) => edit(() => deleteTypeNameOn(draft, n))}
              />
            </Show>
          </div>
        </div>
        <For each={agentIds}>
          {(id) => {
            const t = () => sys().type(id);
            return (
            <>
              <div class="ts-row ts-agent">
                <div class="ts-cell port-col">
                  <span class="ts-glyph">
                    <Glyph type={t()} stub={6} dirs={dirsOf(sys(), t())} />
                  </span>
                  <i class="sym">{t().symbol}</i> {t().name}
                  <button
                    class="btn icon tiny"
                    title={`Edit ${t().name}`}
                    onClick={() => {
                      if (dirty()) return flash();
                      ed.closeTypes();
                      ed.openAgent(id);
                    }}
                  >
                    <Pencil />
                  </button>
                </div>
                <div class="ts-cell dir-col" classList={{ off: off("dirs"), shade: shade("dirs") }} />
                <div class="ts-cell type-col" classList={{ off: off("types"), shade: shade("types") }} />
              </div>
              <For each={Array.from({ length: t().arity + 1 }, (_, i) => i)}>
                {(slot) => {
                  const p = () => t().ports?.[slot] ?? {};
                  return (
                    <div class="ts-row">
                      <div class="ts-cell port-col">
                        <span class="slot-tag">{slot === 0 ? "P" : slot}</span>
                        <span class="ts-label">{p().label ?? portName(slot)}</span>
                      </div>
                      <div
                        class="ts-cell dir-col"
                        classList={{ off: off("dirs"), shade: shade("dirs"), gap: isGap(id, slot, "dirs") }}
                      >
                        <Show when={!off("dirs")}>
                          <DirectionControl
                            value={p().pol}
                            level={level("dirs")}
                            onChange={(v) => edit(() => setPortOn(draft, id, slot, { pol: v }))}
                          />
                        </Show>
                      </div>
                      <div
                        class="ts-cell type-col"
                        classList={{ off: off("types"), shade: shade("types"), gap: isGap(id, slot, "types") }}
                      >
                        <Show when={!off("types")}>
                          <TypeControl
                            value={p().type}
                            names={typing().names}
                            level={level("types")}
                            onChange={(v) => edit(() => setPortOn(draft, id, slot, { type: v }))}
                            onNew={(n) => edit(() => addTypeNameOn(draft, n))}
                          />
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </>
            );
          }}
        </For>
      </div>
      <div class="ts-bottom">
        <Show when={effects().rules.length}>
          <p class="te-warn">
            {pairs(effects().rules)} could no longer meet, so saving deletes {effects().rules.length === 1 ? "their rule" : "their rules"}.
          </p>
        </Show>
        <Show when={effects().wires.length}>
          <p class="te-warn">
            {effects().wires.length === 1 ? "1 wire on the canvas (marked red) wouldn't fit" : `${effects().wires.length} wires on the canvas (marked red) wouldn't fit`} these ports any more. Saving cuts {effects().wires.length === 1 ? "it" : "them"} into loose ends.
          </p>
        </Show>
        <Show when={blockedWhy()}>
          <p class="te-warn">{blockedWhy()}</p>
        </Show>
        <div class="te-foot">
          <span class="push" />
          <button ref={cancelBtn} type="button" class="btn" onClick={ed.closeTypes}>
            Cancel
          </button>
          <button ref={saveBtn} type="button" class="btn primary" disabled={!!blockedWhy()} onClick={save}>
            {effects().wires.length
              ? `Save and cut ${effects().wires.length === 1 ? "1 wire" : `${effects().wires.length} wires`}`
              : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
