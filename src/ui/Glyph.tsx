import type { ComponentDef } from "../core/groups";
import type { AgentType } from "../core/net";
import { shape } from "../layout/geometry";
import { agentOutline, labelPos } from "../render/svg";

/** A small drawing of an agent type, for palettes and lists. */
export function Glyph(props: { type: AgentType }) {
  const o = () => agentOutline({ x: 0, y: 0, orient: "down" }, props.type.arity);
  const l = () => labelPos({ x: 0, y: 0, orient: "down" }, props.type.arity);
  const scale = () => {
    const s = shape(props.type.arity);
    return Math.min(1, 30 / s.w, 22 / s.h);
  };
  return (
    <svg class="glyph" classList={{ filled: !!props.type.filled }} viewBox="-17 -13 34 26" aria-hidden="true">
      <g transform={`scale(${scale()})`}>
        {(() => {
          const s = o();
          return s.kind === "circle" ? (
            <circle class="body" r={s.r} />
          ) : (
            <polygon class="body" points={s.points.map((p) => `${p.x},${p.y}`).join(" ")} />
          );
        })()}
        <text x={l().x} y={l().y} text-anchor="middle" dominant-baseline="central">
          {props.type.symbol}
        </text>
      </g>
    </svg>
  );
}

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
