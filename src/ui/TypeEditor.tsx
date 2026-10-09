import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { AgentType } from "../core/net";
import { portPos, shape } from "../layout/geometry";
import { agentOutline, labelPos } from "../render/svg";
import type { Editor } from "../state/editor";
import { Close, Minus, Plus } from "./icons";

const MAX_AUX = 8;

/**
 * Create or edit an agent type, with a live drawing of it. Symbol and fill
 * only tell agents apart; the shape follows from the ports (no aux ports
 * makes a circle); what an agent does comes from its rules.
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

  const rules = () =>
    initial
      ? [...ed.system.rules.values()].filter((r) => r.left === initial.id || r.right === initial.id)
      : [];
  const sym = (id: string) => ed.system.types.get(id)?.symbol ?? id;
  const inNet = () => (ed.rev(), initial ? [...ed.net.agents.values()].filter((a) => a.type === initial.id).length : 0);

  const changeArity = (d: number) => {
    setArity((n) => Math.max(0, Math.min(MAX_AUX, n + d)));
    setBump((b) => b + 1);
  };

  const save = (e?: Event) => {
    e?.preventDefault();
    const s = symbol().trim();
    if (!s) return setError("Give the agent a symbol.");
    const id = initial?.id ?? s;
    if (!initial && ed.system.types.has(id)) return setError(`There's already an agent called ${s}.`);
    const t: AgentType = { id, symbol: s, name: name().trim() || s, arity: arity(), filled: filled() };
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
    <form class="pop type-editor" role="dialog" aria-label="Agent type" onSubmit={save}>
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
                      <circle class={i() === 0 ? "principal" : "aux"} cx={q.x} cy={q.y} r={2} />
                      <Show when={i() > 0}>
                        <text class="num" x={q.x} y={q.y - 11} text-anchor="middle" dominant-baseline="central">
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
          <h3>{initial ? "Agent type" : "New agent type"}</h3>
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
            The symbol and fill are only labels, to tell agents apart, and the shape just follows from the ports: an agent
            with no aux ports is drawn as a circle. What an agent does comes entirely from its rules.
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
        <Show when={initial && arity() !== initial.arity}>
          <p class="te-warn">
            Changing the number of aux ports removes its rules
            {inNet() ? `, and the ${inNet() === 1 ? "agent" : `${inNet()} agents`} of this type in the net` : ""}.
          </p>
        </Show>
        <Show when={error()}>
          <p class="te-warn">{error()}</p>
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
              Delete type
            </button>
          </Show>
          <span class="push" />
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary">
            {initial ? "Save" : "Add type"}
          </button>
        </div>
      </div>
    </form>
  );
}
