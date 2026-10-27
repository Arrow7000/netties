import { type JSX, createMemo } from "solid-js";
import type { GroupId } from "../../core/groups";
import { type AgentId, type End, NONE, type WireId } from "../../core/net";
import { clash, endSpec, specOf } from "../../core/types";
import type { Editor, EditorMsg } from "../../state/editor";
import type { DropCheck, NetModel, WireGesture } from "../../state/model";
import { Glyph } from "../Glyph";
import * as I from "../icons";
import { type Info, hoverInfo } from "../Panels";
import type { RunButton } from "./transport";

/** What the Selection face is about: what's selected or tapped, or what an armed button or a tapped end is doing. */
export type Focus =
  | { kind: "armed"; from: End; refused?: DropCheck }
  | { kind: "run"; button: RunButton }
  /** `selected`: the pair's wire is selected, not just tapped (which shows its preview). */
  | { kind: "pair"; wire: WireId; active: boolean; selected: boolean }
  | { kind: "wire"; wire: WireId }
  | { kind: "items"; agents: AgentId[]; groups: GroupId[]; wires: WireId[] }
  | { kind: "hover" };

export interface Action {
  id: string;
  label: string;
  /** A shorter label for the button, where the label won't fit. */
  short?: string;
  icon: () => JSX.Element;
  run?: () => void;
  /** Why it can't be done now. */
  why?: string;
  primary?: boolean;
  danger?: boolean;
  /** Picking one of these instead of running. */
  choices?: () => Choice[];
}

export interface Choice {
  label: JSX.Element;
  lead?: JSX.Element;
  note?: string;
  disabled?: boolean;
  run: () => void;
}

const Sym = (props: { s: string }) => <i class="sym">{props.s}</i>;

const RUN_NAME: Record<RunButton, string> = { step: "Step", all: "Step all", run: "Run" };

/**
 * What the Selection face is about and acts on: the main net, through the
 * phone's kit, or a rule's result, through the rule editor (`rule`). A
 * rule's result has no pairs to fire and no components, and its free ends
 * are the rule's ends, named by `rule.freeLabel`.
 */
export interface FocusHost {
  ed: Editor;
  m: NetModel;
  /** The wire started by a tap on an end, waiting for its other end. */
  armed(): WireGesture | undefined;
  setArmed(g: WireGesture | undefined): void;
  armedRun?(): RunButton | undefined;
  copy(): void;
  cut(): void;
  paste(): void;
  canPaste(): boolean;
  duplicate(): void;
  selectConnected(from?: AgentId[]): void;
  /** Start making a component of the selection, where there can be one. */
  setMaking?(on: boolean): void;
  /** Where edits of the selection go, if not to the editor. */
  dispatch?(msg: EditorMsg): void;
  rule?: { freeLabel(name: string): string };
}

/** The focus, its words for the sheet, and what can be done with it. */
export function createFocus(host: FocusHost) {
  const ed = host.ed;
  const m = host.m;
  const rule = host.rule;
  const dispatch = (msg: EditorMsg) => (host.dispatch ?? ed.dispatch)(msg);
  const hover = hoverInfo(ed, { m, freeLabel: rule?.freeLabel });

  const typeOf = (id: AgentId) => {
    const v = m.view();
    const a = v.net.agents.get(id);
    return a ? v.sys.types.get(a.type) : undefined;
  };
  const pairOf = (w: WireId) => {
    const v = m.view().net;
    if (!v.wires.has(w)) return undefined;
    const [a, b] = v.wire(w).ends;
    return a.kind === "port" && b.kind === "port" ? ([a.agent, b.agent] as const) : undefined;
  };
  /** The agents at a wire's ends. */
  const agentsOf = (w: WireId): AgentId[] => {
    const v = m.view().net;
    if (!v.wires.has(w)) return [];
    return [...new Set(v.wire(w).ends.flatMap((e) => (e.kind === "port" ? [e.agent] : [])))];
  };
  const endName = (e: End): JSX.Element => {
    if (e.kind === "free") return rule ? <>end <Sym s={rule.freeLabel(e.name)} /></> : <>loose end <Sym s={e.name} /></>;
    const t = typeOf(e.agent);
    if (m.view().box.has(e.agent)) return <>port {e.slot + 1} of {t?.name ?? "the component"}</>;
    return e.slot === 0 ? <>the principal port of <Sym s={t?.symbol ?? "?"} /></> : <>aux port {e.slot} of <Sym s={t?.symbol ?? "?"} /></>;
  };

  const focus = createMemo((): Focus | undefined => {
    m.rev();
    const a = host.armed();
    const h = m.hover();
    if (a) {
      const from = a.kind === "new" ? a.from : a.moving;
      return { kind: "armed", from, refused: h?.kind === "drag" && h.check?.kind === "refuse" ? h.check : undefined };
    }
    const run = host.armedRun?.();
    if (run) return { kind: "run", button: run };
    if (h && (h.kind === "port" || h.kind === "free" || h.kind === "drag")) return { kind: "hover" };
    const s = m.selection();
    // A rule's result doesn't fire, so a pair in it is just a wire.
    const paired = (w: WireId) => !rule && (m.activeWires().has(w) || m.stuckWires().has(w));
    // A tapped pair's preview showing comes first; then a selected wire.
    if (h?.kind === "wire" && paired(h.id)) {
      return { kind: "pair", wire: h.id, active: m.activeWires().has(h.id), selected: s?.kind === "wire" && s.id === h.id };
    }
    if (s?.kind === "wire" && m.net.wires.has(s.id)) {
      if (paired(s.id)) return { kind: "pair", wire: s.id, active: m.activeWires().has(s.id), selected: true };
      return { kind: "wire", wire: s.id };
    }
    if (s?.kind === "items") {
      const groups = [...s.groups].filter((g) => m.groups.groups.has(g));
      const agents = [...s.agents].filter((x) => m.net.agents.has(x));
      const wires = [...s.wires].filter((w) => m.view().net.wires.has(w));
      if (agents.length + groups.length + wires.length) return { kind: "items", agents, groups, wires };
    }
    // A cell of the rule grid picked in the Rules face shows there, not here.
    if (h?.kind !== "pair" && hover()) return { kind: "hover" };
    return undefined;
  });

  const count = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : "");

  /** What kind of thing the face holds, in a word or two, over what it says about it. */
  const label = createMemo((): string => {
    const f = focus();
    switch (f?.kind) {
      case undefined:
        return "";
      case "armed":
        return "Wiring";
      case "run":
        return RUN_NAME[f.button];
      case "pair":
        return f.active ? "Active pair" : "Pair with no rule";
      case "wire":
        return "Wire";
      case "items": {
        const { agents, groups, wires } = f;
        if (agents.length + groups.length + wires.length === 1) return agents.length ? "Agent" : groups.length ? "Component" : "Wire";
        const said = [count(agents.length, "agent"), count(groups.length, "component"), count(wires.length, "wire")].filter(Boolean).join(", ");
        return said[0]!.toUpperCase() + said.slice(1);
      }
      case "hover": {
        const h = m.hover();
        return h?.kind === "port" ? "Port" : h?.kind === "free" ? (rule ? "End" : "Loose end") : h?.kind === "drag" ? "Wiring" : h?.kind === "group" ? "Component" : h?.kind === "wire" ? "Wire" : "Agent";
      }
    }
  });

  const info = createMemo((): Info | undefined => {
    const f = focus();
    if (!f) return undefined;
    m.rev();
    switch (f.kind) {
      case "armed": {
        const lines: Info["lines"] = [];
        if (f.refused?.kind === "refuse") lines.push({ text: f.refused.why, tone: "bad" });
        lines.push({ text: rule ? "Tap a lit port or end to wire it there." : "Tap a lit port or loose end to wire it there, or an agent below to plug a new one in." });
        return { title: <>Wire from {endName(f.from)}</>, lines };
      }
      case "run": {
        const again = { text: `Tap ${f.button === "run" ? "Run" : RUN_NAME[f.button]} again to ${f.button === "run" ? "start" : "fire"}, or anywhere else to leave it.`, tone: "accent" as const };
        if (f.button === "run") {
          return {
            title: "Keep stepping until nothing can fire",
            lines: [{ text: "Fires every active pair at once, over and over, showing each step, until none are left. Tap Stop to stop it sooner." }, again],
          };
        }
        const ws = ed.previewing() ?? [];
        const one = ws.length === 1 && pairOf(ws[0]!);
        const what = one ? (
          <>
            Fires <Sym s={typeOf(one[0])?.symbol ?? "?"} /> meeting <Sym s={typeOf(one[1])?.symbol ?? "?"} />, shown on the canvas.
          </>
        ) : ws.length ? (
          `Fires ${count(ws.length, "active pair")} at once, shown on the canvas.`
        ) : (
          `Fires all ${count(m.activeWires().size, "active pair")} at once.`
        );
        return { title: f.button === "step" ? "Fire one active pair" : "Fire every active pair at once", lines: [{ text: what }, again] };
      }
      case "pair": {
        const p = pairOf(f.wire);
        if (!p) return undefined;
        const ta = typeOf(p[0]);
        const tb = typeOf(p[1]);
        const found = ta && tb ? ed.system.ruleFor(ta.id, tb.id) : undefined;
        const made = found?.rule.agents.length ?? 0;
        const text = f.active
          ? (found?.rule.description ??
            (made ? `Firing replaces the pair with ${made === 1 ? "a new agent" : `${made} new agents`}.` : "Firing removes the pair and joins their wires."))
          : "Their principal ports touch, but there's no rule for this pair.";
        const lines: Info["lines"] = [{ text, tone: f.active ? undefined : "bad" }];
        // Tapped, not selected: its preview is up, and another tap does what it shows.
        if (!f.selected && m.hover()?.kind === "wire") lines.push({ text: f.active ? "Tap the pair again to fire it." : "Tap the pair again to write a rule for it.", tone: "accent" });
        return {
          title: (
            <>
              <Sym s={ta?.symbol ?? "?"} /> meets <Sym s={tb?.symbol ?? "?"} />
            </>
          ),
          lines,
        };
      }
      case "wire": {
        const w = m.view().net.wires.get(f.wire);
        return { title: "Wire", lines: w ? [{ text: <>From {endName(w.ends[0])} to {endName(w.ends[1])}.</> }] : [] };
      }
      case "items": {
        const { agents, groups, wires } = f;
        if (agents.length === 1 && !groups.length && !wires.length) {
          const t = ed.system.types.get(m.net.agent(agents[0]!).type);
          return {
            title: (
              <>
                <Sym s={t?.symbol ?? "?"} /> {t?.name}
              </>
            ),
            aside: t?.arity === 1 ? "1 aux port" : `${t?.arity} aux ports`,
            lines: [],
          };
        }
        if (groups.length === 1 && !agents.length && !wires.length) {
          return { title: ed.defs().get(m.groups.groups.get(groups[0]!)!.def)?.name ?? "Component", lines: [] };
        }
        // Several: their kinds, as symbols.
        const kinds = [
          ...new Set([
            ...agents.map((a) => typeOf(a)?.symbol ?? "?"),
            ...groups.map((g) => ed.defs().get(m.groups.groups.get(g)!.def)?.symbol ?? "C"),
          ]),
        ];
        const title: JSX.Element = kinds.length ? (
          <>
            {kinds.slice(0, 8).map((k, i) => (
              <>
                {i ? " " : ""}
                <Sym s={k} />
              </>
            ))}
            {kinds.length > 8 ? " …" : ""}
          </>
        ) : (
          count(wires.length, "wire")
        );
        return { title, lines: [] };
      }
      case "hover": {
        const i = hover();
        if (!i) return undefined;
        const h = m.hover();
        // Fingers can tap a wire into place too.
        if (h?.kind === "port" && m.view().net.wireAt(h.end) === NONE) {
          return { ...i, lines: [{ text: "Drag to draw a wire, or tap another port to wire them." }] };
        }
        if (rule && h?.kind === "free" && m.view().net.wireAt({ kind: "free", name: h.name }) === NONE) {
          return { ...i, lines: [...i.lines, { text: "Drag to draw a wire, or tap a port to wire them." }] };
        }
        return i;
      }
    }
  });

  const say = (a: Action) => () => (a.why ? ed.notify(`${a.label}: ${a.why}`) : a.run?.());

  const actions = createMemo((): Action[] => {
    const f = focus();
    m.rev();
    const paste: Action = { id: "paste", label: "Paste", icon: I.Paste, run: () => host.paste(), why: host.canPaste() ? undefined : "Copy something first." };
    const all: Action = { id: "all", label: "Select all", icon: I.SelectAll, run: () => dispatch({ kind: "selection/all" }) };
    if (!f) return [paste, all];
    switch (f.kind) {
      case "armed":
        // Along with why the last end tapped wouldn't take it.
        return [{ id: "stop", label: "Stop wiring", icon: I.Close, run: () => (host.setArmed(undefined), m.hover()?.kind === "drag" && m.setHover(undefined)) }];
      case "run":
      case "hover":
        return [];
      case "pair": {
        const p = pairOf(f.wire)!;
        const ta = typeOf(p[0])!.id;
        const tb = typeOf(p[1])!.id;
        const out: Action[] = f.active
          ? [
              { id: "fire", label: "Fire", icon: I.Step, primary: true, run: () => dispatch({ kind: "run/fire", wire: f.wire }) },
              { id: "rule", label: "Open rule", icon: I.Rule, run: () => ed.openRule(ta, tb) },
            ]
          : [{ id: "rule", label: "Write rule", icon: I.Rule, primary: true, run: () => ed.openRule(ta, tb) }];
        if (!f.selected) {
          // Its wire, selected, is just a wire: its preview goes, and a tap no longer fires it.
          out.push({ id: "select-wire", label: "Select wire", icon: I.Select, run: () => (m.selectWire(f.wire), m.setHover(undefined)) });
          return out;
        }
        return [...out, ...wireActions(f.wire, all)];
      }
      case "wire":
        return wireActions(f.wire, all);
      case "items":
        return itemActions(f, paste, all);
    }
  });

  /** What applies to a selected wire of what an agent can have done to it. */
  const wireActions = (w: WireId, all: Action): Action[] => {
    const ends = agentsOf(w);
    const none = ends.length ? undefined : "Both its ends are loose.";
    return [
      { id: "delete", label: "Delete", icon: I.Trash, danger: true, run: () => dispatch({ kind: "selection/delete" }) },
      { id: "ends", label: ends.length === 1 ? "Select its agent" : "Select its agents", short: ends.length === 1 ? "Its agent" : "Its agents", icon: I.Ends, run: () => m.pickMany(ends, []), why: none },
      { id: "connected", label: "Select connected", short: "Connected", icon: I.Connected, run: () => host.selectConnected(ends), why: none },
      all,
    ];
  };

  const itemActions = (f: Extract<Focus, { kind: "items" }>, paste: Action, all: Action): Action[] => {
    const { agents, groups } = f;
    const sys = ed.system;
    const arities = [...new Set(agents.map((a) => m.net.agent(a).wires.length - 1))];
    const current = new Set(agents.map((a) => m.net.agent(a).type));
    const alike = arities.length === 1 ? [...sys.types.values()].filter((t) => t.arity === arities[0] && !(current.size === 1 && current.has(t.id))) : [];
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
    const noAgents = !agents.length && !groups.length;
    const out: Action[] = [
      { id: "copy", label: "Copy", icon: I.Copy, run: () => host.copy() },
      { id: "duplicate", label: "Duplicate", icon: I.Duplicate, run: () => host.duplicate(), why: noAgents ? "Select some agents to duplicate." : undefined },
      {
        id: "flip",
        label: "Flip",
        icon: I.Flip,
        run: () => dispatch({ kind: "selection/flip", agents }),
        why: m.mode() !== "manual" ? "Auto layout decides which way agents point. Switch to Manual layout first." : !agents.length ? "Components don't flip." : undefined,
      },
      { id: "delete", label: "Delete", icon: I.Trash, danger: true, run: () => dispatch({ kind: "selection/delete" }) },
      { id: "cut", label: "Cut", icon: I.Cut, run: () => host.cut() },
      paste,
      {
        id: "change",
        label: "Change agent",
        icon: I.Swap,
        why: groups.length
          ? "Components can't be swapped for another agent."
          : !agents.length
            ? "Select an agent first."
            : arities.length > 1
              ? "Their numbers of aux ports differ."
              : !alike.length
                ? "No other agent has the same number of aux ports."
                : undefined,
        choices: () =>
          alike.map((t) => ({
            label: (
              <>
                <Sym s={t.symbol} /> {t.name}
              </>
            ),
            lead: <Glyph type={t} />,
            disabled: breaks(t.id) > 0,
            note: breaks(t.id) ? `Its ports wouldn't fit ${breaks(t.id) === 1 ? "1 wire" : `${breaks(t.id)} wires`}` : undefined,
            run: () => dispatch({ kind: "selection/change-type", agents, type: t.id }),
          })),
      },
      { id: "connected", label: "Select connected", icon: I.Connected, run: () => host.selectConnected(), why: noAgents ? "Select an agent first." : undefined },
      all,
    ];
    const making = host.setMaking;
    if (making) out.push({ id: "component", label: "Make component", icon: I.Component, run: () => making(true), why: agents.length ? undefined : "Select some agents first." });
    if (groups.length) {
      if (groups.length === 1 && !agents.length) {
        const def = m.groups.groups.get(groups[0]!)!.def;
        out.splice(4, 0, { id: "open", label: "Edit component", icon: I.Open, run: () => ed.openComponent(def) });
      }
      out.push(
        { id: "expand", label: allCollapsed ? "Expand" : "Collapse", icon: I.Expand, run: () => dispatch({ kind: "component/set-collapsed", groups, collapsed: !allCollapsed }) },
        { id: "apart", label: "Break apart", icon: I.Apart, run: ed.breakApart },
      );
    }
    return out;
  };

  return { focus, label, info, actions, say };
}

export type FocusKit = ReturnType<typeof createFocus>;
