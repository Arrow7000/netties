import { For, type JSX, Show, createMemo, createSignal } from "solid-js";
import type { GroupId } from "../core/groups";
import { type AgentId, type End, NONE, type WireId } from "../core/net";
import { pairKey } from "../core/system";
import { type Effective, canMeet, clash, clashText, endSpec, looseSpec, specOf } from "../core/types";
import type { Editor } from "../state/editor";
import { Menu, MenuItem } from "./Menu";
import { held } from "./keys";
import { Glyph } from "./Glyph";
import { PolarityIcon } from "./PolarityIcon";
import { Trash } from "./icons";

/** A symbol set the way the nets set it. */
const Sym = (props: { s: string }) => <i class="sym">{props.s}</i>;

/** A port's direction as rings rippling out (gives) or draining in (takes), and its type as a chip. */
export function PortBadge(props: { spec: Effective }) {
  return (
    <span class="port-badge">
      <Show when={props.spec.pol}>
        {(pol) => (
          <span class="dir" classList={{ give: pol() === "give", take: pol() === "take" }}>
            <PolarityIcon pol={pol()} />
            {pol() === "give" ? "gives" : "takes"}
          </span>
        )}
      </Show>
      <Show when={props.spec.type}>{(t) => <span class="type-chip">{t()}</span>}</Show>
      <Show when={!props.spec.pol && !props.spec.type}>
        <span class="dir">fits anything</span>
      </Show>
    </span>
  );
}

/** Principal or aux, as a small tag. */
const SlotTag = (props: { slot: number }) => <span class="slot-tag">{props.slot === 0 ? "principal" : `aux ${props.slot}`}</span>;

interface Info {
  title: JSX.Element;
  aside?: JSX.Element;
  lines: { text: JSX.Element; tone?: "bad" | "accent" }[];
}

/** Names for things on the canvas, as people would say them. */
function namer(ed: Editor) {
  const m = ed.model;
  const view = () => m.view();
  const typeOf = (id: AgentId) => {
    const v = view();
    const a = v.net.agents.get(id);
    return a ? v.sys.types.get(a.type) : undefined;
  };
  const sym = (id: AgentId) => <Sym s={typeOf(id)?.symbol ?? "?"} />;
  const end = (e: End): JSX.Element => {
    if (e.kind === "free") return <>loose end <Sym s={e.name} /></>;
    const box = view().box.has(e.agent);
    if (box) return <>port {e.slot + 1} of {typeOf(e.agent)?.name ?? "the component"}</>;
    return e.slot === 0 ? <>the principal port of {sym(e.agent)}</> : <>aux port {e.slot} of {sym(e.agent)}</>;
  };
  /** The two agent types meeting across a wire, if it joins two ports. */
  const pairOf = (w: WireId) => {
    const v = view().net;
    if (!v.wires.has(w)) return undefined;
    const [a, b] = v.wire(w).ends;
    return a.kind === "port" && b.kind === "port" ? ([a.agent, b.agent] as const) : undefined;
  };
  return { typeOf, sym, end, pairOf };
}

/** What the pointer is over. Information only: it appears and goes with the pointer. */
export function HoverPanel(props: { ed: Editor }) {
  const ed = props.ed;
  const m = ed.model;
  const n = namer(ed);

  const typed = () => (ed.rev(), ed.system.typing.dirs !== "off" || ed.system.typing.types !== "off");
  const info = createMemo((): Info | undefined => {
    const h = m.hover();
    if (!h) return undefined;
    m.rev();
    const v = m.view();
    const manual = m.mode() === "manual";
    switch (h.kind) {
      case "agent": {
        const t = n.typeOf(h.id);
        if (!t) return undefined;
        if (t.box) {
          return {
            title: <>{t.name}</>,
            aside: "component",
            lines: [
              { text: `A component instance with ${t.arity + 1} ports. It comes apart as soon as anything inside it interacts.` },
              { text: "Double-click to open it." },
            ],
          };
        }
        return {
          title: (
            <>
              <Sym s={t.symbol} /> {t.name}
            </>
          ),
          aside: t.arity === 1 ? "1 aux port" : `${t.arity} aux ports`,
          lines: [{ text: manual ? "Click to select. Drag to move." : "Click to select. Drag to move; auto layout will return it to place." }],
        };
      }
      case "port": {
        const e = h.end;
        if (e.kind !== "port") return undefined;
        const t = n.typeOf(e.agent);
        const other = v.net.partner(e);
        const label = t?.box ? undefined : t?.ports?.[e.slot]?.label;
        return {
          title: (
            <>
              <SlotTag slot={e.slot} /> <Sym s={t?.symbol ?? "?"} /> {label ?? t?.name}
            </>
          ),
          aside: typed() ? <PortBadge spec={m.specAt(e)} /> : undefined,
          lines: [{ text: other ? "Drag to unplug it." : "Drag to draw a wire." }],
        };
      }
      case "free": {
        const other = v.net.partner({ kind: "free", name: h.name });
        return {
          title: (
            <>
              Loose end <Sym s={h.name} />
            </>
          ),
          aside: typed() && other ? <PortBadge spec={looseSpec(v.net, v.sys, h.name)} /> : undefined,
          lines: [{ text: other ? "The net's connection to the outside. Drag it onto a port to plug it in." : "Drag from it to wire it up." }],
        };
      }
      case "wire": {
        const pair = n.pairOf(h.id);
        const active = m.activeWires().has(h.id);
        const stuck = m.stuckWires().has(h.id);
        if (pair && (active || stuck)) {
          const title = (
            <>
              {n.sym(pair[0])} meets {n.sym(pair[1])}
            </>
          );
          if (held.alt()) return { title, lines: [{ text: "Alt-click to select the wire.", tone: "accent" }] };
          if (active) {
            const found = v.sys.ruleFor(n.typeOf(pair[0])!.id, n.typeOf(pair[1])!.id);
            const made = found?.rule.agents.length ?? 0;
            const what = made
              ? `Firing replaces the pair with ${made === 1 ? "a new agent" : `${made} new agents`}.`
              : "Firing removes the pair and joins their wires along the dashed lines.";
            return {
              title,
              aside: "active pair",
              lines: [{ text: found?.rule.description ?? what }, { text: "Click to fire. Alt-click selects the wire." }],
            };
          }
          const broken = v.sys.ruleFor(n.typeOf(pair[0])!.id, n.typeOf(pair[1])!.id);
          if (broken) {
            return {
              title,
              aside: "rule breaks the types",
              lines: [{ text: "Its rule joins ports that don't fit, so it can't fire. Click to fix it.", tone: "bad" }],
            };
          }
          return {
            title,
            aside: "no rule",
            lines: [
              { text: "Their principal ports touch, but there's no rule for this pair.", tone: "bad" },
              { text: "Click to write one." },
            ],
          };
        }
        const w = v.net.wires.get(h.id);
        if (!w) return undefined;
        const [a, b] = w.ends;
        const sa = m.specAt(a);
        const sb = m.specAt(b);
        const carried: Effective = { type: sa.type ?? sb.type };
        return {
          title: "Wire",
          aside: typed() && carried.type ? <PortBadge spec={carried} /> : undefined,
          lines: [{ text: <>From {n.end(a)} to {n.end(b)}.</> }],
        };
      }
      case "group": {
        const g = m.groups.groups.get(h.id);
        return {
          title: <>{ed.defs().get(g?.def ?? "")?.name ?? "Component"}</>,
          aside: "open component",
          lines: [{ text: "Double-click the outline to close it." }],
        };
      }
      case "drag": {
        const g = h.gesture;
        const title = g.kind === "new" ? "Drawing a wire" : "Moving a wire end";
        const c = h.check;
        if (h.target && c?.kind === "refuse") return { title, lines: [{ text: c.why, tone: "bad" }] };
        if (h.target && c?.kind === "back") return { title, lines: [{ text: "Let go to put it back." }] };
        if (h.target && c?.kind === "ok") {
          return {
            title,
            lines: [
              {
                text: c.join ? (
                  <>Let go to join it to {n.end(h.target)}.</>
                ) : (
                  <>Let go to connect it to {n.end(h.target)}.</>
                ),
                tone: "accent",
              },
            ],
          };
        }
        return {
          title,
          lines: [
            {
              text: m.fixedInterface
                ? g.kind === "new"
                  ? "Let go on an empty port to connect it."
                  : "Let go on an empty port to plug it in, or anywhere else to unplug it."
                : g.kind === "new"
                  ? "Let go on an empty port to connect it, or on the canvas to leave a loose end."
                  : "Let go on an empty port to plug it in, or on the canvas to leave it loose.",
            },
          ],
        };
      }
      case "type": {
        const t = ed.system.types.get(h.id);
        if (!t) return undefined;
        return {
          title: (
            <>
              <Sym s={t.symbol} /> {t.name}
            </>
          ),
          aside: t.arity === 1 ? "1 aux port" : `${t.arity} aux ports`,
          lines: [{ text: "Drag onto the canvas to add one. Click to edit it." }],
        };
      }
      case "component": {
        const d = ed.defs().get(h.id);
        if (!d) return undefined;
        return {
          title: d.name,
          aside: "component",
          lines: [{ text: "Drag onto the canvas to add one. Click to edit it; every copy changes with it." }],
        };
      }
      case "porttype": {
        let count = 0;
        for (const t of ed.system.types.values()) for (let s = 0; s <= t.arity; s++) if (specOf(ed.system, t.id, s).type === h.name) count++;
        return {
          title: <span class="type-chip">{h.name}</span>,
          aside: count === 1 ? "1 port" : `${count} ports`,
          lines: [{ text: "Its ports and wires are lit up on the canvas." }],
        };
      }
      case "pair": {
        const sa = ed.system.types.get(h.a)?.symbol ?? h.a;
        const sb = ed.system.types.get(h.b)?.symbol ?? h.b;
        const has = !!ed.system.ruleFor(h.a, h.b);
        const never = canMeet(ed.system, h.a, h.b);
        if (never) {
          return {
            title: (
              <>
                <Sym s={sa} /> with <Sym s={sb} />
              </>
            ),
            aside: "can never meet",
            lines: [{ text: `Their principal ports don't fit. ${clashText(never).split(". ")[0]}.` }],
          };
        }
        const brokenRule = has && ed.system.broken(ed.system.ruleFor(h.a, h.b)!.rule);
        if (brokenRule) {
          return {
            title: (
              <>
                <Sym s={sa} /> with <Sym s={sb} />
              </>
            ),
            aside: "rule breaks the types",
            lines: [{ text: "It joins ports that don't fit, so it can't fire.", tone: "bad" }, { text: "Click to fix it." }],
          };
        }
        const here = [...m.activeWires(), ...m.stuckWires()].filter((w) => {
          const p = n.pairOf(w);
          if (!p) return false;
          return pairKey(n.typeOf(p[0])?.id ?? "", n.typeOf(p[1])?.id ?? "") === pairKey(h.a, h.b);
        }).length;
        const count = here === 0 ? "" : here === 1 ? " One such pair is in the net now." : ` ${here} such pairs are in the net now.`;
        return {
          title: (
            <>
              <Sym s={sa} /> with <Sym s={sb} />
            </>
          ),
          aside: has ? "has a rule" : "no rule yet",
          lines: has
            ? [
                { text: `${ed.system.ruleFor(h.a, h.b)!.rule.description ?? "Says what the pair turns into when they meet."}${count}` },
                { text: "Click to see or change it." },
              ]
            : [{ text: `Nothing happens when they meet.${count}`, tone: here ? "bad" : undefined }, { text: "Click to write a rule." }],
        };
      }
    }
  });

  return (
    <Show when={info()}>
      {(i) => <InfoBox info={i()} class="hover-panel" />}
    </Show>
  );
}

function InfoBox(props: { info: Info; class: string; children?: JSX.Element }) {
  return (
    <div class={`island panel ${props.class}`}>
      <div class="panel-title">
        <span>{props.info.title}</span>
        <Show when={props.info.aside}>
          <span class="panel-aside">{props.info.aside}</span>
        </Show>
      </div>
      <For each={props.info.lines}>
        {(l) => (
          <div class="panel-line" classList={{ bad: l.tone === "bad", accent: l.tone === "accent" }}>
            {l.text}
          </div>
        )}
      </For>
      {props.children}
    </div>
  );
}

interface Action {
  label: JSX.Element;
  run?: () => void;
  /** Why it can't be done right now. */
  why?: string;
  primary?: boolean;
  menu?: (close: () => void) => JSX.Element;
}

/** What's selected, and what you can do with it. */
export function SelectionPanel(props: { ed: Editor }) {
  const ed = props.ed;
  const m = ed.model;
  const n = namer(ed);
  const [why, setWhy] = createSignal<string>();
  const [making, setMaking] = createSignal(false);

  const items = () => {
    const s = m.selection();
    if (s?.kind !== "items") return undefined;
    m.rev();
    const groups = [...s.groups].filter((g) => m.groups.groups.has(g));
    const agents = [...s.agents].filter((a) => m.net.agents.has(a));
    const wires = [...s.wires].filter((w) => m.view().net.wires.has(w));
    return agents.length + groups.length + wires.length ? { agents, groups, wires } : undefined;
  };

  const itemActions = (agents: AgentId[], groups: GroupId[]): Action[] => {
    const sys = ed.system;
    const arities = [...new Set(agents.map((a) => m.net.agent(a).wires.length - 1))];
    const current = new Set(agents.map((a) => m.net.agent(a).type));
    const alike = arities.length === 1 ? [...sys.types.values()].filter((t) => t.arity === arities[0] && !(current.size === 1 && current.has(t.id))) : [];
    const typeWhy = groups.length
      ? "Components can't be swapped for another agent."
      : arities.length > 1
        ? `Their numbers of aux ports differ (${arities.sort().join(" and ")}), so no one agent fits them all.`
        : !alike.length
          ? "No other agent has the same number of aux ports."
          : undefined;
    /** How many wires would stop fitting if these agents became another agent. */
    const breaks = (type: string) => {
      let n = 0;
      for (const a of agents) {
        m.net.agent(a).wires.forEach((_, slot) => {
          const p = m.net.partner({ kind: "port", agent: a, slot });
          if (!p) return;
          const there = p.kind === "port" && agents.includes(p.agent) ? specOf(sys, type, p.slot) : endSpec(m.net, sys, p);
          if (clash(specOf(sys, type, slot), there)) n++;
        });
      }
      return n;
    };
    const allCollapsed = groups.every((g) => m.groups.groups.get(g)?.collapsed);
    return [
      {
        label: "Change agent",
        why: typeWhy,
        menu: (close) => (
          <For each={alike}>
            {(t) => (
              <MenuItem
                lead={<Glyph type={t} />}
                title={
                  <>
                    <Sym s={t.symbol} /> {t.name}
                  </>
                }
                disabled={breaks(t.id) > 0}
                note={breaks(t.id) ? `Its ports wouldn't fit ${breaks(t.id) === 1 ? "1 wire" : `${breaks(t.id)} wires`}` : undefined}
                onClick={() => {
                  ed.dispatch({ kind: "selection/change-type", agents, type: t.id });
                  close();
                }}
              />
            )}
          </For>
        ),
      },
      {
        label: "Flip",
        run: () => ed.dispatch({ kind: "selection/flip", agents }),
        why: m.mode() !== "manual" ? "Auto layout decides which way agents point." : !agents.length ? "Components don't flip." : undefined,
      },
      {
        label: "Make component",
        run: () => setMaking(true),
      },
      {
        label: groups.length && !allCollapsed ? "Collapse" : "Expand",
        run: () => ed.dispatch({ kind: "component/set-collapsed", groups, collapsed: !allCollapsed }),
        why: groups.length ? undefined : "There are no components in the selection.",
      },
      {
        label: "Break apart",
        run: ed.breakApart,
        why: groups.length ? undefined : "There are no components in the selection.",
      },
    ];
  };

  const content = createMemo(() => {
    const s = m.selection();
    if (s?.kind === "wire") {
      m.rev();
      if (!m.net.wires.has(s.id)) return undefined;
      const pair = n.pairOf(s.id);
      const active = m.activeWires().has(s.id);
      const stuck = m.stuckWires().has(s.id);
      const types = pair ? ([n.typeOf(pair[0])!.id, n.typeOf(pair[1])!.id] as const) : undefined;
      if (pair && types && (active || stuck)) {
        return {
          info: {
            title: (
              <>
                {n.sym(pair[0])} meets {n.sym(pair[1])}
              </>
            ),
            aside: active ? "active pair" : "no rule",
            lines: [],
          } as Info,
          actions: (active
            ? [
                { label: "Fire", primary: true, run: () => ed.dispatch({ kind: "run/fire", wire: s.id }) },
                { label: "Open rule", run: () => ed.openRule(types[0], types[1]) },
              ]
            : [{ label: "Write rule", primary: true, run: () => ed.openRule(types[0], types[1]) }]) as Action[],
        };
      }
      const w = m.view().net.wires.get(s.id);
      return {
        info: { title: "Wire", lines: w ? [{ text: <>From {n.end(w.ends[0])} to {n.end(w.ends[1])}.</> }] : [] } as Info,
        actions: [] as Action[],
      };
    }
    const it = items();
    if (!it) return undefined;
    const { agents, groups, wires } = it;
    const count = [
      agents.length ? (agents.length === 1 ? "1 agent" : `${agents.length} agents`) : "",
      groups.length ? (groups.length === 1 ? "1 component" : `${groups.length} components`) : "",
      wires.length ? (wires.length === 1 ? "1 wire" : `${wires.length} wires`) : "",
    ]
      .filter(Boolean)
      .join(", ");
    // Wires only: there's nothing to do with them here but delete or copy them.
    if (!agents.length && !groups.length) return { info: { title: count, lines: [] } as Info, actions: [] as Action[] };
    let title: JSX.Element = `${agents.length + groups.length} selected`;
    if (agents.length === 1 && !groups.length) {
      const t = ed.system.types.get(m.net.agent(agents[0]!).type);
      title = (
        <>
          <Sym s={t?.symbol ?? "?"} /> {t?.name}
        </>
      );
    } else if (groups.length === 1 && !agents.length) {
      title = ed.defs().get(m.groups.groups.get(groups[0]!)!.def)?.name ?? "Component";
    }
    return { info: { title, aside: count, lines: [] } as Info, actions: itemActions(agents, groups) };
  });

  const hint = () => (m.selection()?.kind === "wire" ? "Esc clears the selection." : "Shift-click adds to the selection. Esc clears it.");

  return (
    <Show when={content()}>
      {(c) => (
        <InfoBox info={c().info} class="selection-panel">
          <Show
            when={!making()}
            fallback={
              <form
                class="panel-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  ed.makeComponent(String(f.get("name") ?? ""), String(f.get("symbol") ?? "").trim() || "C");
                  setMaking(false);
                }}
              >
                <input class="input" name="name" placeholder="Component name" required ref={(el) => setTimeout(() => el.focus())} />
                <input class="input short" name="symbol" placeholder="Symbol" maxLength={4} />
                <button class="btn small primary" type="submit">
                  Make
                </button>
                <button class="btn small" type="button" onClick={() => setMaking(false)}>
                  Cancel
                </button>
              </form>
            }
          >
            <div class="panel-row">
              <For each={c().actions}>
                {(a) =>
                  a.menu && !a.why ? (
                    <Menu label={a.label} class="small">
                      {a.menu}
                    </Menu>
                  ) : (
                    <button
                      class="btn small"
                      classList={{ primary: !!a.primary }}
                      aria-disabled={!!a.why}
                      onPointerEnter={() => a.why && setWhy(`${typeof a.label === "string" ? a.label : "This"}: ${a.why}`)}
                      onPointerLeave={() => setWhy(undefined)}
                      onClick={() => (a.why ? setWhy(`${typeof a.label === "string" ? a.label : "This"}: ${a.why}`) : a.run?.())}
                    >
                      {a.label}
                    </button>
                  )
                }
              </For>
              <button class="btn small icon danger push" title="Delete (⌫)" onClick={() => ed.dispatch({ kind: "selection/delete" })}>
                <Trash />
              </button>
            </div>
            <div class="panel-why" classList={{ on: !!why() }}>
              {why() ?? hint()}
            </div>
          </Show>
        </InfoBox>
      )}
    </Show>
  );
}

/** Steps, interactions and agents so far. */
export function Counters(props: { ed: Editor }) {
  const ed = props.ed;
  const agents = () => (ed.rev(), ed.net.agents.size);
  const open = () => (ed.rev(), ed.net.unconnected().filter((e) => e.kind === "port" && ed.net.wireAt(e) === NONE).length);
  return (
    <div class="island counters" title="This run">
      <div class="chip">
        <b>{ed.steps().toLocaleString()}</b>
        <span>steps</span>
      </div>
      <div class="chip">
        <b>{ed.stats().interactions.toLocaleString()}</b>
        <span>interactions</span>
      </div>
      <div class="chip">
        <b>{agents().toLocaleString()}</b>
        <span>agents</span>
      </div>
      <Show when={open()}>
        <div class="chip warn">
          <b>{open()}</b>
          <span>{open() === 1 ? "empty port" : "empty ports"}</span>
        </div>
      </Show>
    </div>
  );
}

