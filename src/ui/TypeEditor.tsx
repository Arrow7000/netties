import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { AgentType } from "../core/net";
import { type PortSpec, portName, portsFor, typingOn } from "../core/types";
import { portPos, shape } from "../layout/geometry";
import { agentOutline, labelPos } from "../render/svg";
import type { Editor } from "../state/editor";
import { DirectionControl, TypeControl } from "./PortControls";
import { Close, Minus, Plus } from "./icons";

const MAX_AUX = 8;

/**
 * Create or edit an agent, with a live drawing of it. Symbol and fill only
 * tell agents apart; the shape follows from the ports (no aux ports makes a
 * circle); what an agent does comes from its rules. Each port gets a row:
 * what it's for and, when the system has them, its direction and type.
 */
export function TypeEditor(props: { ed: Editor; id: string | "new"; onClose: () => void }) {
  const ed = props.ed;
  const initial = props.id === "new" ? undefined : ed.system.types.get(props.id);
  const [symbol, setSymbol] = createSignal(initial?.symbol ?? "");
  const [name, setName] = createSignal(initial?.name ?? "");
  const [arity, setArity] = createSignal(initial?.arity ?? 2);
  const [filled, setFilled] = createSignal(!!initial?.filled);
  const [error, setError] = createSignal<string>();
  const [bump, setBump] = createSignal(0);
  const [ports, setPorts] = createSignal<PortSpec[]>(initial ? portsFor(initial) : portsFor({ id: "", name: "", symbol: "", arity: 2 }));
  /** The port row under the pointer, to light it up in the drawing. */
  const [hotPort, setHotPort] = createSignal<number>();
  const typing = () => (ed.rev(), ed.system.typing);

  const setPort = (slot: number, patch: Partial<PortSpec>) =>
    setPorts((ps) =>
      ps.map((p, i) => {
        if (i !== slot) return p;
        const q = { ...p, ...patch };
        for (const k of ["pol", "type", "label"] as const) if (!q[k]) delete q[k];
        return q;
      }),
    );

  /** Wires on the canvas that saving would cut, because they'd stop fitting. */
  const conflicts = createMemo(() => {
    if (!initial || arity() !== initial.arity || !typingOn(typing())) return [] as number[];
    return ed.conflicts(initial.id, ports());
  });
  createEffect(() => ed.model.setDoomed(new Set(conflicts())));
  onCleanup(() => ed.model.setDoomed(new Set<number>()));

  /** What still has to be filled in, when the system requires directions or types. */
  const missingWhy = () => {
    const t = typing();
    const ps = ports();
    if (t.dirs === "required" && ps.some((p) => !p.pol)) return "Directions are required: say whether every port gives or takes.";
    if (t.types === "required" && ps.some((p) => !p.type)) return "Types are required: give every port a type.";
    return undefined;
  };

  const rules = () =>
    initial
      ? [...ed.system.rules.values()].filter((r) => r.left === initial.id || r.right === initial.id)
      : [];
  const sym = (id: string) => ed.system.types.get(id)?.symbol ?? id;
  const inNet = () => (ed.rev(), initial ? [...ed.net.agents.values()].filter((a) => a.type === initial.id).length : 0);

  const changeArity = (d: number) => {
    setArity((n) => Math.max(0, Math.min(MAX_AUX, n + d)));
    setPorts((ps) => Array.from({ length: arity() + 1 }, (_, i) => ps[i] ?? {}));
    setBump((b) => b + 1);
  };

  const save = (e?: Event) => {
    e?.preventDefault();
    const s = symbol().trim();
    if (!s) return setError("Give the agent a symbol.");
    const id = initial?.id ?? s;
    if (!initial && ed.system.types.has(id)) return setError(`There's already an agent called ${s}.`);
    if (missingWhy()) return setError(missingWhy());
    const described = ports().some((p) => p.pol || p.type || p.label);
    const t: AgentType = {
      id,
      symbol: s,
      name: name().trim() || s,
      arity: arity(),
      filled: filled(),
      ...(described && { ports: ports() }),
    };
    if (initial) ed.updateType(initial.id, t);
    else ed.addType(t);
    props.onClose();
  };

  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", key, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", key, { capture: true }));
  });

  // The preview: the agent drawn large, with its ports marked and numbered.
  const preview = () => {
    const n = arity();
    const p = { x: 0, y: 0, orient: "down" as const };
    const o = agentOutline(p, n);
    const s = shape(n);
    const k = Math.min(3.2, 150 / Math.max(s.w, 1), 110 / s.h);
    return { n, o, k, ports: Array.from({ length: n + 1 }, (_, i) => portPos(p, n, i)), label: labelPos(p, n) };
  };

  return (
    <form class="pop type-editor" role="dialog" aria-label="Agent" onSubmit={save}>
      <div class="te-preview">
        <svg viewBox="-95 -80 190 160" class="te-stage" classList={{ filled: filled() }} aria-hidden="true">
          {(() => {
            bump();
            const v = preview();
            return (
              <g transform={`scale(${v.k})`} class="te-agent">
                {v.o.kind === "circle" ? (
                  <circle class="body" r={v.o.r} />
                ) : (
                  <polygon class="body" points={v.o.points.map((q) => `${q.x},${q.y}`).join(" ")} />
                )}
                <text class="symbol" x={v.label.x} y={v.label.y} text-anchor="middle" dominant-baseline="central">
                  {symbol() || "?"}
                </text>
                <For each={v.ports}>
                  {(q, i) => (
                    <>
                      <line class="stub" x1={q.x} y1={q.y} x2={q.x} y2={q.y + (q.dir === "down" ? 7 : -7)} />
                      <Show when={typing().dirs !== "off" && ports()[i()]?.pol}>
                        {(pol) => {
                          const out = q.dir === "down" ? 1 : -1;
                          const dy = pol() === "give" ? out : -out;
                          const y = q.y + out * 4.6;
                          return <polygon class="arrow" points={`${q.x},${y + dy * 2} ${q.x - 2},${y - dy * 1.4} ${q.x + 2},${y - dy * 1.4}`} />;
                        }}
                      </Show>
                      <Show when={hotPort() === i()}>
                        <circle class="hot-port" cx={q.x} cy={q.y} r={4.2} />
                      </Show>
                      <circle class={i() === 0 ? "principal" : "aux"} cx={q.x} cy={q.y} r={2} />
                      <Show when={i() > 0}>
                        <text class="num" x={q.x + 4.5} y={q.y + (q.dir === "up" ? 4.5 : -4.5)} text-anchor="middle" dominant-baseline="central">
                          {i()}
                        </text>
                      </Show>
                    </>
                  )}
                </For>
              </g>
            );
          })()}
        </svg>
        <div class="te-legend">
          <span>
            <i class="principal" />
            principal port
          </span>
          <Show when={arity() > 0}>
            <span>
              <i class="aux" />
              aux ports, numbered clockwise
            </span>
          </Show>
        </div>
      </div>
      <div class="te-form">
        <div class="te-head">
          <h3>{initial ? "Agent" : "New agent"}</h3>
          <button type="button" class="btn icon" title="Close" onClick={props.onClose}>
            <Close />
          </button>
        </div>
        <div class="te-two">
          <label class="field">
            <span>Symbol</span>
            <input
              class="input symbol"
              value={symbol()}
              maxLength={3}
              onInput={(e) => setSymbol(e.currentTarget.value)}
              ref={(el) => setTimeout(() => !initial && el.focus())}
            />
          </label>
          <label class="field">
            <span>Name</span>
            <input class="input" value={name()} placeholder={symbol() || "e.g. duplicator"} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        </div>
        <div class="field">
          <span>Aux ports</span>
          <div class="stepper">
            <button type="button" onClick={() => changeArity(-1)} disabled={arity() === 0} aria-label="Fewer aux ports">
              <Minus />
            </button>
            <output>{arity()}</output>
            <button type="button" onClick={() => changeArity(1)} disabled={arity() === MAX_AUX} aria-label="More aux ports">
              <Plus />
            </button>
          </div>
        </div>
        <div class="field">
          <span>Fill</span>
          <div class="seg" role="group" aria-label="Fill">
            <button type="button" aria-pressed={!filled()} onClick={() => setFilled(false)}>
              Hollow
            </button>
            <button type="button" aria-pressed={filled()} onClick={() => setFilled(true)}>
              Filled
            </button>
          </div>
        </div>
        <div class="te-note">
          <p>
            Symbol and fill only tell agents apart, and the shape follows from the ports: no aux ports makes a circle. What
            an agent does comes from its rules.
          </p>
          <Show when={initial}>
            <div class="te-rules">
              <For each={rules()} fallback={<span class="muted">No rules mention it yet.</span>}>
                {(r) => (
                  <button
                    type="button"
                    class="chip-btn"
                    onClick={() => {
                      props.onClose();
                      ed.openRule(r.left, r.right);
                    }}
                  >
                    <i class="sym">{sym(r.left)}</i> with <i class="sym">{sym(r.right)}</i>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class="te-ports">
        <div class="te-ports-head">
          <h4>Ports</h4>
          <Show
            when={typingOn(typing())}
            fallback={
              <button type="button" class="link-btn" onClick={() => (props.onClose(), ed.openTypes())}>
                Add directions or types…
              </button>
            }
          >
            <button type="button" class="link-btn" onClick={() => (props.onClose(), ed.openTypes())}>
              All agents' ports…
            </button>
          </Show>
        </div>
        <div
          class="port-rows"
          classList={{ dirs: typing().dirs !== "off", types: typing().types !== "off" }}
          onPointerLeave={() => setHotPort(undefined)}
        >
          <div class="port-row port-head">
            <span />
            <span>Label</span>
            <Show when={typing().dirs !== "off"}>
              <span>Direction</span>
            </Show>
            <Show when={typing().types !== "off"}>
              <span>Type</span>
            </Show>
          </div>
          <For each={ports()}>
            {(p, i) => (
              <div class="port-row" onPointerEnter={() => setHotPort(i())}>
                <span class="slot-tag">{i() === 0 ? "P" : i()}</span>
                <input
                  class="input"
                  value={p.label ?? ""}
                  placeholder={i() === 0 ? "e.g. the list" : i() === 1 ? "e.g. the first item" : "e.g. the rest"}
                  aria-label={`Label for the ${portName(i())}`}
                  onInput={(e) => setPort(i(), { label: e.currentTarget.value })}
                />
                <Show when={typing().dirs !== "off"}>
                  <DirectionControl value={p.pol} level={typing().dirs} onChange={(v) => setPort(i(), { pol: v })} />
                </Show>
                <Show when={typing().types !== "off"}>
                  <TypeControl
                    value={p.type}
                    names={typing().names}
                    level={typing().types}
                    onChange={(v) => setPort(i(), { type: v })}
                    onNew={(n) => ed.addTypeName(n)}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
      <div class="te-bottom">
        <Show when={initial && arity() !== initial.arity}>
          <p class="te-warn">
            Changing the number of aux ports removes its rules
            {inNet() ? `, and ${inNet() === 1 ? "the one in the net" : `the ${inNet()} in the net`}` : ""}.
          </p>
        </Show>
        <Show when={conflicts().length}>
          <p class="te-warn">
            {conflicts().length === 1 ? "1 wire on the canvas (marked red) wouldn't fit" : `${conflicts().length} wires on the canvas (marked red) wouldn't fit`} these ports any more. Saving cuts {conflicts().length === 1 ? "it" : "them"} into loose ends.
          </p>
        </Show>
        <Show when={error() ?? missingWhy()}>
          <p class="te-warn">{error() ?? missingWhy()}</p>
        </Show>
        <div class="te-foot">
          <Show when={initial}>
            <button
              type="button"
              class="btn danger"
              onClick={() => {
                ed.removeType(initial!.id);
                props.onClose();
              }}
            >
              Delete agent
            </button>
          </Show>
          <span class="push" />
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={!!missingWhy()}>
            {conflicts().length
              ? `Save and cut ${conflicts().length === 1 ? "1 wire" : `${conflicts().length} wires`}`
              : initial
                ? "Save"
                : "Add agent"}
          </button>
        </div>
      </div>
    </form>
  );
}
