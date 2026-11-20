import { For, Show, createEffect, createSignal, on } from "solid-js";
import { sameEnd } from "../../core/net";
import type { Clip } from "../../core/clip";
import type { Pt } from "../../layout/geometry";
import type { Editor } from "../../state/editor";
import type { NetModel, WireGesture } from "../../state/model";
import type { Camera, CanvasPhone } from "../Canvas";
import { compact } from "../compact";
import { type FocusHost, createFocus } from "./focus";
import { type Pasted, type Phone, type TileTarget, besideSelection, selectConnected } from "./kit";
import { SelectionView, Tile, edgeFades } from "./parts";

/**
 * The rule editor's result on a phone, worked as the net is: a tap on an
 * empty port or end starts a wire, lighting up where it can go, and a tap
 * on one of those finishes it; and what's selected or tapped has the
 * Selection face's words and actions (./focus.tsx), in a row of its own.
 * The clipboard is the phone's (./kit.ts), so what's copied on the net can
 * be pasted into a rule. With nothing selected, that row holds the agents,
 * to drag into the result as from the sheet, or tap to add one.
 */
export function createRulePhone(opts: {
  ed: Editor;
  kit: Phone;
  m: NetModel;
  camera: Camera;
  /** Where a tap on a tile adds an agent: just beside the result. */
  centre: () => Pt;
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

  /**
   * The selection a tile last made, by adding its agent: like the net's
   * sheet, the row keeps the agents for more, until the selection changes.
   */
  const [added, setAdded] = createSignal<ReturnType<typeof m.selection>>();
  /** A tile carried out of the row: the row gets out of the way. */
  const [lifted, setLifted] = createSignal(false);
  const add = (id: string, at: Pt, attach?: Parameters<typeof m.addAgent>[2]) => {
    setArmed(undefined);
    // The end tapped to start a wire was tapped for this, and is done with.
    m.setHover(undefined);
    m.addAgent(id, at, attach);
    setAdded(m.selection());
  };
  /** A tap on a tile: plugged into the end a tap started a wire from, if one is waiting, as on the net; otherwise one is added beside the result. */
  const tapTile = (id: string) => {
    const a = armed();
    if (!a) return add(id, opts.centre());
    const from = a.kind === "new" ? a.from : a.moving;
    const c = m.attachEnds(id).find((c) => sameEnd(c.end, from));
    if (!c || !c.fits) return ed.notify(`${ed.system.types.get(id)?.name ?? "That agent"} has no port that fits there.`);
    add(id, { x: c.at.x, y: c.at.y }, { end: c.end, slot: c.slot });
  };
  /** The rule, as somewhere a tile adds to: the result's canvas, but not the buttons over it. */
  const tiles: TileTarget = {
    m,
    camera: opts.camera,
    over: (x, y) => opts.camera.contains(x, y) && !document.elementFromPoint(x, y)?.closest(".rp-tools, .rp-focus, .rp-tiles"),
    add: (w, at, attach) => w.kind === "type" && add(w.id, at, attach),
    tap: (w) => w.kind === "type" && tapTile(w.id),
  };

  /** For the hold menu (./parts.tsx). */
  const hold = { heldAt, setHeldAt, canPaste: kit.canPaste, paste, selectAll: () => m.selectAll() };

  return { armed, setArmed, canvas, hold, focus: createFocus(host), kit, tiles, added, lifted, setLifted };
}

/**
 * What's selected or tapped in the result, in a row of its own over the
 * bottom of After: the net's Selection view (./parts.tsx), whose More opens
 * the rest of the actions in the row, as the sheet's does by pulling up.
 * On a phone on its side, with Before beside After, it's a column at the
 * right instead, with room for them all.
 */
export function RuleSelection(props: { touch: RulePhone; m: NetModel; beside: boolean }) {
  const t = props.touch;
  const f = t.focus;
  const [expanded, setExpanded] = createSignal(false);
  // Another selection, or none, folds the rest away again.
  createEffect(on([() => f.focus()?.kind, props.m.selection, props.m.hover], () => setExpanded(false), { defer: true }));
  const kind = () => (props.beside ? "rp-focus beside" : "rp-focus");
  const tiles = () => <RuleTiles touch={t} beside={props.beside} class={`${kind()} rp-tiles`} />;
  // Wiring, the agents stay under what it says, so a tap on one plugs a new one in.
  const below = () => (f.focus()?.kind === "armed" ? <RuleTiles touch={t} beside={props.beside} class="rp-tiles inline" /> : undefined);
  // Just added by a tile, the new agent is selected, but the agents stay.
  const quiet = () => f.focus()?.kind === "items" && props.m.selection() === t.added();
  return (
    <Show when={!quiet()} fallback={tiles()}>
      <SelectionView
        class={kind()}
        focus={f}
        row={props.beside ? 3 : 5}
        folds={!props.beside}
        expanded={expanded()}
        onMore={() => setExpanded(true)}
        fallback={tiles()}
        below={below()}
      />
    </Show>
  );
}

export type RulePhone = ReturnType<typeof createRulePhone>;

/**
 * The agents, in the selection's row while nothing is selected, or under
 * what it says while wiring: drag one into the result, or tap it to add one
 * beside it, or to plug one into the end waiting for a wire.
 */
function RuleTiles(props: { touch: RulePhone; beside: boolean; class: string }) {
  const t = props.touch;
  const ed = t.kit.ed;
  const types = () => (ed.rev(), [...ed.system.types.keys()]);
  return (
    <div class={props.class} classList={{ out: t.lifted() }}>
      <div class="sheet-tiles" ref={edgeFades} classList={{ wrap: props.beside }}>
        <For each={types()}>{(id) => <Tile kit={t.kit} what={{ kind: "type", id }} axis={props.beside ? "y" : "x"} onLift={t.setLifted} into={t.tiles} />}</For>
      </div>
    </div>
  );
}
