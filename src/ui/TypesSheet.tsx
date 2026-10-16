import { For, type JSX, Show, createMemo, createSignal } from "solid-js";
import { type Level, missing, portName } from "../core/types";
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
 * the Types heading. Changes apply at once and can be undone.
 */
export function TypesSheet(props: { ed: Editor }) {
  const ed = props.ed;
  const sys = () => (ed.rev(), ed.system);
  const typing = () => sys().typing;
  const agents = () => [...sys().types.values()].filter((t) => !t.box);
  /** A setting being switched to Required, waiting for the ports that don't have one yet. */
  const [pending, setPending] = createSignal<Dim>();
  const [preview, setPreview] = createSignal<{ dim: Dim; level: Level }>();

  const level = (d: Dim): Level => (pending() === d ? "required" : typing()[d]);
  const gaps = createMemo(() => {
    const d = pending();
    if (!d) return [];
    return missing(sys(), { ...typing(), [d]: "required" }).filter((g) => g.what === (d === "dirs" ? "dir" : "type"));
  });
  const isGap = (type: string, slot: number, d: Dim) =>
    pending() === d && gaps().some((g) => g.type === type && g.slot === slot);

  // Once the last gap is filled, the switch to Required goes through.
  const settle = () => {
    const d = pending();
    if (d && gaps().length === 0) {
      setPending(undefined);
      ed.setTyping({ [d]: "required" });
    }
  };

  const choose = (d: Dim, l: Level) => {
    setPreview(undefined);
    if (l === typing()[d] && !pending()) return;
    if (l === "required") {
      const left = missing(sys(), { ...typing(), [d]: "required" }).filter((g) => g.what === (d === "dirs" ? "dir" : "type"));
      if (left.length) {
        // Required needs every port filled in first; until then the setting stays where it was.
        if (typing()[d] === "off") ed.setTyping({ [d]: "optional" });
        setPending(d);
        return;
      }
    }
    if (pending() === d) setPending(undefined);
    const had = agents().some((t) => t.ports?.some((p) => (d === "dirs" ? p.pol : p.type)));
    ed.setTyping({ [d]: l });
    if (l === "off" && had) ed.notify(d === "dirs" ? "Turned directions off." : "Turned types off.", true);
  };

  const note = (d: Dim): JSX.Element => {
    const p = preview();
    if (p?.dim === d) return <span class="preview">{d === "dirs" ? <DirWords text={MEANS[d][p.level]} /> : MEANS[d][p.level]}</span>;
    if (pending() === d) {
      const n = gaps().length;
      return (
        <span class="pending">
          {n === 1 ? "1 port to go." : `${n} ports to go.`}{" "}
          <button
            class="link-btn"
            onClick={() => {
              ed.guessPorts(d === "dirs" ? "dir" : "type");
              settle();
            }}
          >
            Guess from the canvas
          </button>{" "}
          or{" "}
          <button class="link-btn" onClick={() => setPending(undefined)}>
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

  // Changes apply at once, so a click outside closes the sheet, and so does Escape.
  // A click outside leaves it open while a switch to Required is waiting on ports.
  let sheet!: HTMLDivElement;
  dismissOnClickOutside(() => sheet, ed.closeTypes, () => !!pending(), undefined, undefined, ed.closeTypes);

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
                uses={(n) => ed.typeUses(n)}
                onHover={(n) => ed.model.setHover(n ? { kind: "porttype", name: n } : undefined)}
                onAdd={(n) => ed.addTypeName(n)}
                onRename={(a, b) => ed.renameTypeName(a, b)}
                onDelete={(n) => ed.deleteTypeName(n)}
              />
            </Show>
          </div>
        </div>
        <For each={agents()}>
          {(t) => (
            <>
              <div class="ts-row ts-agent">
                <div class="ts-cell port-col">
                  <span class="ts-glyph">
                    <Glyph type={t} stub={6} dirs={(ed.rev(), dirsOf(ed.system, t))} />
                  </span>
                  <i class="sym">{t.symbol}</i> {t.name}
                  <button
                    class="btn icon tiny"
                    title={`Edit ${t.name}`}
                    onClick={() => {
                      ed.closeTypes();
                      ed.openAgent(t.id);
                    }}
                  >
                    <Pencil />
                  </button>
                </div>
                <div class="ts-cell dir-col" classList={{ off: off("dirs"), shade: shade("dirs") }} />
                <div class="ts-cell type-col" classList={{ off: off("types"), shade: shade("types") }} />
              </div>
              <For each={Array.from({ length: t.arity + 1 }, (_, i) => i)}>
                {(slot) => {
                  const p = () => t.ports?.[slot] ?? {};
                  return (
                    <div class="ts-row">
                      <div class="ts-cell port-col">
                        <span class="slot-tag">{slot === 0 ? "P" : slot}</span>
                        <span class="ts-label">{p().label ?? portName(slot)}</span>
                      </div>
                      <div
                        class="ts-cell dir-col"
                        classList={{ off: off("dirs"), shade: shade("dirs"), gap: isGap(t.id, slot, "dirs") }}
                      >
                        <Show when={!off("dirs")}>
                          <DirectionControl
                            value={p().pol}
                            level={level("dirs")}
                            onChange={(v) => {
                              ed.setPort(t.id, slot, { pol: v });
                              settle();
                            }}
                          />
                        </Show>
                      </div>
                      <div
                        class="ts-cell type-col"
                        classList={{ off: off("types"), shade: shade("types"), gap: isGap(t.id, slot, "types") }}
                      >
                        <Show when={!off("types")}>
                          <TypeControl
                            value={p().type}
                            names={typing().names}
                            level={level("types")}
                            onChange={(v) => {
                              ed.setPort(t.id, slot, { type: v });
                              settle();
                            }}
                            onNew={(n) => ed.addTypeName(n)}
                          />
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}
