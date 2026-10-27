import { createEffect, createSignal, on } from "solid-js";
import type { Clip } from "../../core/clip";
import type { Pt } from "../../layout/geometry";
import type { Editor } from "../../state/editor";
import type { NetModel, WireGesture } from "../../state/model";
import type { CanvasPhone } from "../Canvas";
import { compact } from "../compact";
import { type FocusHost, type FocusKit, createFocus } from "./focus";
import { type Pasted, type Phone, besideSelection, selectConnected } from "./kit";
import { SelectionView } from "./parts";

/**
 * The rule editor's result on a phone, worked as the net is: a tap on an
 * empty port or end starts a wire, lighting up where it can go, and a tap
 * on one of those finishes it; and what's selected or tapped has the
 * Selection face's words and actions (./focus.tsx), in a row of its own.
 * The clipboard is the phone's (./kit.ts), so what's copied on the net can
 * be pasted into a rule.
 */
export function createRulePhone(opts: {
  ed: Editor;
  kit: Phone;
  m: NetModel;
  /** The rule's ends' names, x₁ and so on. */
  freeLabel: (name: string) => string;
  /** The selection in the result, copied. */
  copy: () => { clip: Clip; text: string } | undefined;
  /** Paste into the result, at a point in it or in the middle of the view; why not, if it can't be. */
  paste: (src: Pasted, at?: Pt) => string | undefined;
}) {
  const { ed, kit, m } = opts;
  const [armed, setArmed] = createSignal<WireGesture>();
  /** Where a finger was held on empty canvas and lifted: a small menu opens there. */
  const [heldAt, setHeldAt] = createSignal<{ client: Pt; at: Pt }>();

  // A waiting wire, or the menu, goes when the phone layout does; a wire, when the end it came from does.
  createEffect(() => !compact() && setHeldAt(undefined));
  createEffect(() => {
    const a = armed();
    if (!a) return;
    const from = a.kind === "new" ? a.from : a.moving;
    m.rev();
    const v = m.view().net;
    const still = from.kind === "port" ? v.agents.has(from.agent) : v.free.has(from.name);
    if (!still || !compact()) setArmed(undefined);
  });

  /** What the canvas is told of, and tells. */
  const canvas: CanvasPhone = { armed, setArmed, onHoldMenu: (client, at) => setHeldAt({ client, at }), onTap: () => {} };

  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const what = () => {
    const s = m.selection();
    if (s?.kind !== "items") return "the wire";
    return s.agents.size ? count(s.agents.size, "agent") : count(s.wires.size, "wire");
  };
  const pasteAt = (src: Pasted, at?: Pt) => {
    const why = opts.paste(src, at);
    if (why) ed.notify(why);
  };
  /** Paste what's on the clipboard, at `at` or in the middle of the view. */
  const paste = async (at?: Pt) => {
    const src = await kit.clipboard();
    if (src) pasteAt(src, at);
  };

  const host: FocusHost = {
    ed,
    m,
    armed,
    setArmed,
    copy: () => {
      const c = opts.copy();
      if (!c) return;
      kit.keep(c);
      ed.notify(`Copied ${what()}.`);
    },
    cut: () => {
      const c = opts.copy();
      if (!c) return;
      const said = what();
      kit.keep(c);
      m.deleteSelection();
      ed.notify(`Cut ${said}.`);
    },
    paste: () => paste(),
    canPaste: kit.canPaste,
    duplicate: () => {
      const c = opts.copy();
      if (c) pasteAt(c.clip, besideSelection(m));
    },
    selectConnected: (from) => selectConnected(m, from),
    // The result's own edits, not the net's.
    dispatch: (msg) => {
      switch (msg.kind) {
        case "selection/all":
          return m.selectAll();
        case "selection/delete":
          return m.deleteSelection();
        case "selection/flip":
          return m.flipAgents(msg.agents);
        case "selection/change-type":
          return m.changeType(msg.agents, msg.type);
      }
    },
    rule: { freeLabel: opts.freeLabel },
  };

  /** For the hold menu (./parts.tsx). */
  const hold = { heldAt, setHeldAt, canPaste: kit.canPaste, paste, selectAll: () => m.selectAll() };

  return { armed, setArmed, canvas, hold, focus: createFocus(host) };
}

/**
 * What's selected or tapped in the result, in a row of its own over the
 * bottom of After: the net's Selection view (./parts.tsx), whose More opens
 * the rest of the actions in the row, as the sheet's does by pulling up.
 * On a phone on its side, with Before beside After, it's a column at the
 * right instead, with room for them all.
 */
export function RuleSelection(props: { focus: FocusKit; m: NetModel; beside: boolean }) {
  const f = props.focus;
  const [expanded, setExpanded] = createSignal(false);
  // Another selection, or none, folds the rest away again.
  createEffect(on([() => f.focus()?.kind, props.m.selection, props.m.hover], () => setExpanded(false), { defer: true }));
  return (
    <SelectionView
      class={props.beside ? "rp-focus beside" : "rp-focus"}
      focus={f}
      row={props.beside ? 3 : 5}
      folds={!props.beside}
      expanded={expanded()}
      onMore={() => setExpanded(true)}
    />
  );
}
