import { For, Show, createMemo, createSignal } from "solid-js";
import { pairKey } from "../core/system";
import { canMeet, specOf, typingOn } from "../core/types";
import type { Editor } from "../state/editor";
import { canLeave } from "./subEditor";

/** Up to this many types, the grid fits in the side panel. */
export const GRID_FITS = 8;

type CellState = "has" | "live" | "none" | "stuck" | "never" | "broken";

/** What each cell of the grid shows for a pair of agent types, kept up to date with the net. */
function cellStates(ed: Editor): (a: string, b: string) => CellState {
  const m = ed.model;
  /** Pairs in the net now, by pair key (both ways round): whether they can fire. */
  const present = createMemo(() => {
    m.rev();
    const v = m.view().net;
    const out = new Map<string, "live" | "stuck">();
    const add = (ws: Iterable<number>, kind: "live" | "stuck") => {
      for (const w of ws) {
        if (!v.wires.has(w)) continue;
        const [a, b] = v.wire(w).ends;
        if (a.kind !== "port" || b.kind !== "port") continue;
        const [ta, tb] = [v.agent(a.agent).type, v.agent(b.agent).type];
        out.set(pairKey(ta, tb), kind);
        out.set(pairKey(tb, ta), kind);
      }
    };
    add(m.activeWires(), "live");
    add(m.stuckWires(), "stuck");
    return out;
  });
  return (a, b) => {
    ed.rev();
    if (canMeet(ed.system, a, b)) return "never";
    const p = present().get(pairKey(a, b));
    const found = ed.system.ruleFor(a, b);
    if (found && ed.system.broken(found.rule)) return "broken";
    if (p === "stuck") return "stuck";
    if (!found) return "none";
    return p === "live" ? "live" : "has";
  };
}

/**
 * Every pair of agent types, as half of a square: each cell is one pair,
 * and says whether it has a rule, and whether that pair is in the net now.
 * Clicking a cell opens its rule, or starts one.
 */
/**
 * The agents in grid order. With directions, types whose principal ports
 * give come first, then those that take, so the pairs that can never meet
 * gather into two blocks.
 */
export function gridTypes(ed: Editor) {
  ed.rev();
  const all = [...ed.system.types.values()];
  if (ed.system.typing.dirs === "off") return all;
  const rank = (id: string) => {
    const pol = specOf(ed.system, id, 0).pol;
    return pol === "give" ? 0 : pol === "take" ? 1 : 2;
  };
  return all.map((t, i) => ({ t, i })).sort((x, y) => rank(x.t.id) - rank(y.t.id) || x.i - y.i).map((x) => x.t);
}

export function RuleGrid(props: { ed: Editor; big?: boolean; thumb?: boolean }) {
  const ed = props.ed;
  const m = ed.model;
  const [hot, setHot] = createSignal<[number, number]>();

  const types = () => gridTypes(ed);

  const state = cellStates(ed);

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
                    tabIndex={props.thumb || state(a.id, b.id) === "never" ? -1 : 0}
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
                      if (state(a.id, b.id) === "never" || !canLeave()) return;
                      m.setHover(undefined);
                      ed.openRule(a.id, b.id);
                    }}
                  >
                    <Show when={props.big && state(a.id, b.id) !== "never"}>
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

/**
 * One line over the grid of a typed system: whether every pair that can
 * meet has a rule, which is what makes a typed net unable to get stuck.
 */
export function GridSummary(props: { ed: Editor }) {
  const ed = props.ed;
  const counts = createMemo(() => {
    ed.rev();
    const types = [...ed.system.types.keys()];
    let never = 0;
    let missing = 0;
    let broken = 0;
    types.forEach((a, i) =>
      types.slice(i).forEach((b) => {
        if (canMeet(ed.system, a, b)) return void never++;
        const f = ed.system.ruleFor(a, b);
        if (!f) missing++;
        else if (ed.system.broken(f.rule)) broken++;
      }),
    );
    return { never, missing, broken };
  });
  const pairs = (n: number) => (n === 1 ? "1 pair" : `${n} pairs`);
  return (
    <Show when={(ed.rev(), typingOn(ed.system.typing)) && counts().never > 0}>
      <div class="grid-summary" classList={{ done: !counts().missing && !counts().broken }}>
        <Show
          when={!counts().missing && !counts().broken}
          fallback={
            <span>
              <Show when={counts().broken}>{pairs(counts().broken)} with a rule that breaks the types. </Show>
              <Show when={counts().missing}>{pairs(counts().missing)} that can meet have no rule yet. </Show>
              <small>{pairs(counts().never)} can never meet.</small>
            </span>
          }
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" />
            <path d="M4.8 8.2l2.2 2.2 4.2-4.6" />
          </svg>
          <span>
            Every pair that can meet has a rule.
            <small>The other {counts().never} can never meet, so nothing can get stuck.</small>
          </span>
        </Show>
      </div>
    </Show>
  );
}

export function GridLegend(props: { ed?: Editor }) {
  const typed = () => !!props.ed && (props.ed.rev(), typingOn(props.ed.system.typing));
  const state = props.ed ? cellStates(props.ed) : undefined;
  /** The state of the cell under the pointer, so its entry lights up. */
  const hot = (): CellState | undefined => {
    const h = props.ed?.model.hover();
    return h?.kind === "pair" && state ? state(h.a, h.b) : undefined;
  };
  const entry = (kind: CellState, label: string) => (
    <span classList={{ hl: hot() === kind }}>
      <i class={kind} />
      {label}
    </span>
  );
  return (
    <div class="grid-legend">
      {entry("has", "Rule")}
      {entry("live", "Rule, pair on canvas")}
      {entry("none", "No rule yet")}
      {entry("stuck", "Stuck here")}
      <Show when={typed()}>{entry("never", "Can never meet")}</Show>
    </div>
  );
}
