import { For, Show, createMemo, createSignal } from "solid-js";
import { pairKey } from "../core/system";
import type { Editor } from "../state/editor";

/** Up to this many types, the grid fits in the side panel. */
export const GRID_FITS = 8;

type CellState = "has" | "live" | "none" | "stuck";

/**
 * Every pair of agent types, as half of a square: each cell is one pair,
 * and says whether it has a rule, and whether that pair is in the net now.
 * Clicking a cell opens its rule, or starts one.
 */
export function RuleGrid(props: { ed: Editor; big?: boolean; thumb?: boolean }) {
  const ed = props.ed;
  const m = ed.model;
  const [hot, setHot] = createSignal<[number, number]>();

  const types = () => (ed.rev(), [...ed.system.types.values()]);

  /** Pairs in the net now, by pair key: whether they can fire. */
  const present = createMemo(() => {
    m.rev();
    const v = m.view().net;
    const out = new Map<string, "live" | "stuck">();
    const add = (ws: Iterable<number>, kind: "live" | "stuck") => {
      for (const w of ws) {
        if (!v.wires.has(w)) continue;
        const [a, b] = v.wire(w).ends;
        if (a.kind === "port" && b.kind === "port") out.set(pairKey(v.agent(a.agent).type, v.agent(b.agent).type), kind);
      }
    };
    add(m.activeWires(), "live");
    add(m.stuckWires(), "stuck");
    return out;
  });

  const state = (a: string, b: string): CellState => {
    const p = present().get(pairKey(a, b));
    if (p === "stuck") return "stuck";
    if (!ed.system.ruleFor(a, b)) return "none";
    return p === "live" ? "live" : "has";
  };

  const n = () => types().length;
  const cell = () => (props.thumb ? 7 : props.big ? 36 : Math.max(17, Math.min(24, Math.floor(188 / Math.max(1, n())))));

  return (
    <div
      class="rule-grid"
      classList={{ big: !!props.big, thumb: !!props.thumb }}
      style={{
        "grid-template-columns": `${props.big ? "auto" : `${cell()}px`} repeat(${n()}, ${cell()}px)`,
        "grid-auto-rows": `${cell()}px`,
      }}
      onPointerLeave={() => {
        setHot(undefined);
        if (m.hover()?.kind === "pair") m.setHover(undefined);
      }}
    >
      <span />
      <For each={types()}>
        {(t, j) => (
          <span class="head col" classList={{ hl: hot()?.[1] === j() }}>
            <i class="sym">{t.symbol}</i>
            <Show when={props.big}>
              <small>{t.name}</small>
            </Show>
          </span>
        )}
      </For>
      <For each={types()}>
        {(a, i) => (
          <>
            <span class="head row" classList={{ hl: hot()?.[0] === i() }}>
              <Show when={props.big}>
                <small>{a.name}</small>
              </Show>
              <i class="sym">{a.symbol}</i>
            </span>
            <For each={types()}>
              {(b, j) =>
                j() < i() ? (
                  <span />
                ) : (
                  <button
                    class={`cell ${state(a.id, b.id)}`}
                    classList={{ hl: !!hot() && (hot()![0] === i() || hot()![1] === j()) }}
                    tabIndex={props.thumb ? -1 : 0}
                    aria-label={`${a.name} with ${b.name}`}
                    onPointerEnter={() => {
                      if (props.thumb) return;
                      setHot([i(), j()]);
                      m.setHover({ kind: "pair", a: a.id, b: b.id });
                    }}
                    onFocus={() => !props.thumb && m.setHover({ kind: "pair", a: a.id, b: b.id })}
                    onBlur={() => m.setHover(undefined)}
                    onClick={(e) => {
                      if (props.thumb) return;
                      e.stopPropagation();
                      m.setHover(undefined);
                      ed.openRule(a.id, b.id);
                    }}
                  >
                    <Show when={props.big}>
                      {a.symbol}
                      {b.symbol}
                    </Show>
                  </button>
                )
              }
            </For>
          </>
        )}
      </For>
    </div>
  );
}

export function GridLegend() {
  return (
    <div class="grid-legend">
      <span>
        <i class="has" />
        Rule
      </span>
      <span>
        <i class="live" />
        Rule, pair on canvas
      </span>
      <span>
        <i class="none" />
        No rule yet
      </span>
      <span>
        <i class="stuck" />
        Stuck here
      </span>
    </div>
  );
}
