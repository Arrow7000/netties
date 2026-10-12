import { For, Show } from "solid-js";
import type { ComponentDef } from "../core/groups";
import type { AgentType } from "../core/net";
import type { System } from "../core/system";
import { type Polarity, specOf } from "../core/types";
import { portPos, shape } from "../layout/geometry";
import { agentOutline, arrowPoints, labelPos } from "../render/svg";

/**
 * A small drawing of an agent type, for palettes and lists. With `stub`, its
 * ports get wire stubs that long, and with `dirs` an arrow on each stub for
 * the port's direction.
 */
export function Glyph(props: { type: AgentType; stub?: number; dirs?: (Polarity | undefined)[] }) {
  const p = { x: 0, y: 0, orient: "down" as const };
  const o = () => agentOutline(p, props.type.arity);
  const l = () => labelPos(p, props.type.arity);
  const scale = () => {
    const s = shape(props.type.arity);
    return Math.min(1, 30 / s.w, 22 / s.h);
  };
  const body = () => {
    const s = o();
    return s.kind === "circle" ? <circle class="body" r={s.r} /> : <polygon class="body" points={s.points.map((q) => `${q.x},${q.y}`).join(" ")} />;
  };
  const label = () => (
    <text x={l().x} y={l().y} text-anchor="middle" dominant-baseline="central">
      {props.type.symbol}
    </text>
  );
  return (
    <Show
      when={props.stub}
      fallback={
        <svg class="glyph" classList={{ filled: !!props.type.filled }} viewBox="-17 -13 34 26" aria-hidden="true">
          <g transform={`scale(${scale()})`}>
            {body()}
            {label()}
          </g>
        </svg>
      }
    >
      {(stub) => {
        const view = () => {
          const s = shape(props.type.arity);
          const pad = stub() + 2;
          return `${-s.w / 2 - pad} ${-s.h / 2 - pad} ${s.w + 2 * pad} ${s.h + 2 * pad}`;
        };
        const ports = () => Array.from({ length: props.type.arity + 1 }, (_, i) => portPos(p, props.type.arity, i));
        return (
          <svg class="glyph stubbed" classList={{ filled: !!props.type.filled }} viewBox={view()} aria-hidden="true">
            <For each={ports()}>
              {(q, i) => {
                const out = q.dir === "down" ? 1 : -1;
                const pol = () => props.dirs?.[i()];
                return (
                  <>
                    <line class="stub" x1={q.x} y1={q.y} x2={q.x} y2={q.y + out * stub()} />
                    <Show when={pol()}>
                      {(d) => (
                        <polygon
                          class="arrowhead"
                          points={arrowPoints({ x: q.x, y: q.y + out * stub() * 0.55 }, 0, d() === "give" ? out : -out, 0.85)}
                        />
                      )}
                    </Show>
                  </>
                );
              }}
            </For>
            {body()}
            {label()}
          </svg>
        );
      }}
    </Show>
  );
}

/** The directions of an agent type's ports, as the system counts them, for `Glyph`. */
export const dirsOf = (sys: System, t: AgentType) => Array.from({ length: t.arity + 1 }, (_, i) => specOf(sys, t.id, i).pol);

/** A small drawing of a component, as its box. */
export function ComponentGlyph(props: { def: ComponentDef }) {
  const w = () => Math.min(30, 12 + props.def.iface.length * 4);
  return (
    <svg class="glyph" viewBox="-17 -13 34 26" aria-hidden="true">
      <rect class="body" x={-w() / 2} y={-8} width={w()} height={16} />
      <text x={0} y={0} text-anchor="middle" dominant-baseline="central">
        {props.def.symbol}
      </text>
    </svg>
  );
}
