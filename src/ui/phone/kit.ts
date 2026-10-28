import { batch, createEffect, createSignal, on, onCleanup } from "solid-js";
import type { Clip } from "../../core/clip";
import { type AgentId, type End, type WireId, sameEnd } from "../../core/net";
import { parse } from "../../core/text";
import { type Pt, boxOf } from "../../layout/geometry";
import type { Editor } from "../../state/editor";
import type { NetModel, WireGesture } from "../../state/model";
import type { Camera, CanvasPhone, Pad } from "../Canvas";
import { copyText } from "../clipboard";
import { compact, sideways } from "../compact";
import { HOLD } from "../gesture";
import { GHOST_STUB, ghostPlug } from "../Palette";
import { type TileEffect, type TileMsg, type TilePress, updateTile } from "./tile";
import { type RunButton, type Transport, type TransportEffect, type TransportMsg, updateTransport } from "./transport";

/** Something to add from a tile in the sheet. */
export type TileWhat = { kind: "type" | "component"; id: string };

/** A tile being carried onto the canvas, drawn at (x, y); `over`, over the canvas rather than the chrome. */
export interface Carry {
  what: TileWhat;
  x: number;
  y: number;
  over: boolean;
}

/** How far above a finger a carried tile is drawn, so the finger doesn't hide it. */
const LIFT = 56;

/** Where what was last copied is kept, for pasting back where the phone's clipboard can't be read. */
const CLIP_KEY = "netties:clip";

/**
 * The phone layout's state, shared by the canvas and the sheet: the wire
 * started by a tap, the hold menu, the selected tile and the one being
 * carried, the armed run button, the clipboard, and the room the sheet
 * takes. Made once by the app; it only does anything while `compact()`.
 */
export function createPhone(ed: Editor, camera: Camera) {
  const m = ed.model;
  const [armed, setArmed] = createSignal<WireGesture>();
  /** Where a finger was held on empty canvas and lifted: a small menu opens there. */
  const [heldAt, setHeldAt] = createSignal<{ client: Pt; at: Pt }>();
  /** The tile tapped: it looks selected, and the sheet offers to edit it. */
  const [tile, setTile] = createSignal<TileWhat>();
  const [carry, setCarry] = createSignal<Carry>();
  const [making, setMaking] = createSignal(false);
  /** The canvas's last tap, for the sheet to follow: counted, and whether it was on nothing. */
  const [taps, setTaps] = createSignal({ n: 0, empty: false });
  /** Room the sheet takes at the bottom and the right, beyond the top bar. */
  const [room, setRoom] = createSignal<Pick<Pad, "b" | "r">>({ b: 72, r: 8 });

  // Leaving the phone layout lets go of everything it was in the middle of.
  createEffect(
    on(compact, (on) => {
      if (on) return;
      batch(() => {
        setArmed(undefined);
        setHeldAt(undefined);
        setTile(undefined);
        setTransport({});
        setMaking(false);
      });
    }),
  );

  // A wire started by a tap goes when the net changes under it, or the screen does.
  createEffect(() => {
    const a = armed();
    if (!a) return;
    const from = a.kind === "new" ? a.from : a.moving;
    m.rev();
    const v = m.view().net;
    const still = from.kind === "port" ? v.agents.has(from.agent) : v.free.has(from.name);
    if (!still || ed.screen().kind !== "net") setArmed(undefined);
  });

  // The net is fitted afresh when the sheet's room changes (the phone turning).
  createEffect(on(room, () => compact() && requestAnimationFrame(() => requestAnimationFrame(() => camera.fit())), { defer: true }));

  /** What the canvas is told of, and tells. */
  const canvas: CanvasPhone = {
    armed,
    setArmed,
    onHoldMenu: (client, at) => setHeldAt({ client, at }),
    onTap: (empty) => {
      setTile(undefined);
      setTaps((t) => ({ n: t.n + 1, empty }));
    },
  };

  /** The middle of the canvas that the chrome leaves showing, on screen: above the sheet as it is now, not as the fit counts it. */
  const visibleMiddle = (): Pt => {
    const top = document.querySelector(".top-left")?.getBoundingClientRect().bottom ?? 60;
    const r = room();
    const sheet = document.querySelector(".sheet.phone-chrome")?.getBoundingClientRect();
    const bottom = sheet && !sideways() ? sheet.top : innerHeight - r.b;
    return { x: (8 + innerWidth - r.r) / 2, y: (top + bottom) / 2 };
  };
  const middleOfView = (): Pt => {
    const c = visibleMiddle();
    return camera.toWorld(c.x, c.y) ?? { x: 0, y: 0 };
  };

  // Clipboard. The system clipboard gets the text format; netties keeps the
  // richer clip itself (positions, components), in this browser, for pasting back.
  const loadClip = (): { clip: Clip; text: string } | undefined => {
    try {
      const raw = localStorage.getItem(CLIP_KEY);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  };
  const [held, setHeld] = createSignal(loadClip());
  const secure = typeof isSecureContext !== "undefined" && isSecureContext && !!navigator.clipboard;
  const canPaste = () => secure || !!held();

  const writeText = (t: string) => void copyText(t);

  const count = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : "");
  /** What's selected, in words, for saying what was copied. */
  const what = () => {
    const s = m.selection();
    if (s?.kind !== "items") return "the selection";
    return [count(s.agents.size, "agent"), count(s.groups.size, "component"), s.agents.size || s.groups.size ? "" : count(s.wires.size, "wire")]
      .filter(Boolean)
      .join(" and ");
  };

  /** Keep what was copied: here, for pasting back, and as text on the phone's clipboard. */
  const keep = (c: { clip: Clip; text: string }) => {
    setHeld(c);
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify(c));
    } catch {
      // ignore
    }
    writeText(c.text);
  };

  const copy = (quiet = false) => {
    const c = ed.copySelection();
    if (!c) return false;
    keep(c);
    if (!quiet) ed.notify(`Copied ${what()}.`);
    return true;
  };
  const cut = () => {
    const said = what();
    if (!copy(true)) return;
    ed.dispatch({ kind: "selection/delete" });
    ed.notify(`Cut ${said}.`, true);
  };

  let lastPaste: (Pt & { n: number }) | undefined;
  /** Where a paste with nowhere given goes: the middle of the view, stepping on for each paste in a row. */
  const pasteSpot = (): Pt => {
    const at = middleOfView();
    const again = lastPaste && Math.hypot(lastPaste.x - at.x, lastPaste.y - at.y) < 1;
    lastPaste = { ...at, n: again ? lastPaste!.n + 1 : 0 };
    return { x: at.x + 24 * lastPaste.n, y: at.y + 24 * lastPaste.n };
  };
  const pasteFrom = (src: Parameters<typeof ed.paste>[0], at: Pt) => {
    try {
      const problem = ed.paste(src, at);
      if (problem) ed.notify(problem);
    } catch (err) {
      console.error("paste failed", err);
      ed.notify("Couldn't paste that.");
    }
  };
  /**
   * What a paste pastes: what's on the phone's clipboard if it can be read
   * and holds a net, otherwise what was last copied here. Nothing, having
   * said why, when there's nothing to paste.
   */
  const clipboard = async (): Promise<Pasted | undefined> => {
    const mine = held();
    if (secure) {
      try {
        const text = await navigator.clipboard.readText();
        if (text.trim() && text.trim() !== mine?.text.trim()) {
          try {
            return parse(text);
          } catch (err) {
            if (!mine) {
              ed.notify(`The clipboard doesn't hold a net: ${err instanceof Error ? err.message : String(err)}`);
              return undefined;
            }
          }
        }
      } catch {
        // Not allowed: fall back on what was copied here.
      }
    }
    if (!mine) ed.notify("Nothing to paste yet: copy something first.");
    return mine?.clip;
  };
  /** Paste at `at`, or in the middle of the view. */
  const paste = async (at?: Pt) => {
    const spot = at ?? pasteSpot();
    const src = await clipboard();
    if (src) pasteFrom(src, spot);
  };

  /** Copy and paste beside, in one; the clipboard is left alone. */
  const duplicate = () => {
    const c = ed.copySelection();
    if (!c) return;
    pasteFrom(c.clip, besideSelection(m) ?? pasteSpot());
  };

  /** When a tile last added something: what that selects isn't a tap on the canvas. */
  let tileAt = 0;
  const fromTile = () => performance.now() - tileAt < 700;

  /** A tap on a tile: plugged into the end a tap started a wire from, if one is waiting; otherwise the tile is selected, or let go. */
  const tapTile = (w: TileWhat) => {
    const a = armed();
    if (!a) return setTile((t) => (t && t.kind === w.kind && t.id === w.id ? undefined : w));
    if (w.kind !== "type") return ed.notify("Only an agent can be plugged in straight away. Drag the component onto the canvas instead.");
    const from: End = a.kind === "new" ? a.from : a.moving;
    const c = m.attachEnds(w.id).find((c) => sameEnd(c.end, from));
    if (!c || !c.fits) return ed.notify(`${ed.system.types.get(w.id)?.name ?? "That agent"} has no port that fits there.`);
    setArmed(undefined);
    tileAt = performance.now();
    ed.dispatch({ kind: "net/add-agent", type: w.id, at: { x: c.at.x, y: c.at.y }, attach: { end: c.end, slot: c.slot } });
  };

  const openTile = (w: TileWhat) => (w.kind === "type" ? ed.openAgent(w.id) : ed.openComponent(w.id));

  /** Where on the canvas a tile drawn at (x, y) would go: nowhere over the chrome. */
  const spot = (x: number, y: number) => {
    const under = document.elementFromPoint(x, y);
    const chrome = !!under?.closest(".island, .pop, .menu, .phone-chrome");
    const at = camera.toWorld(x, y);
    return at && !chrome ? at : undefined;
  };

  /** Draw the carried tile at (x, y), lighting up where it would plug in. */
  const carryTo = (w: TileWhat, x: number, y: number) => {
    const at = spot(x, y);
    setCarry({ what: w, x, y, over: !!at });
    if (w.kind !== "type") return;
    const attach = at && m.attachTarget(w.id, at);
    const t = ed.system.types.get(w.id);
    const g = attach && t && ghostPlug(t, attach.slot, x, y);
    const toW = (px: number, py: number) => camera.toWorld(px, py);
    const [tip, a, b] = g ? [toW(g.tip.x, g.tip.y), toW(g.box.x0, g.box.y0), toW(g.box.x1, g.box.y1)] : [];
    const plug = g && tip && a && b && { at: tip, dir: g.dir, box: { x0: a.x, y0: a.y, x1: b.x, y1: b.y } };
    m.setPlacing({ type: w.id, at, attach, plug });
  };

  /** The sheet, told when a tile lifts out of it and when it's let go. */
  let onLift: ((on: boolean) => void) | undefined;
  let pressed: TilePress | undefined;
  let pressing: { what: TileWhat; el: HTMLElement; stop: () => void } | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => pressing?.stop());

  const sendTile = (msg: TileMsg) => {
    const p = pressing;
    if (!p) return;
    const [next, fx] = updateTile(pressed, msg);
    pressed = next;
    for (const f of fx) performTile(f, p.what, p.el);
    if (!next) p.stop();
  };
  const performTile = (fx: TileEffect, w: TileWhat, el: HTMLElement) => {
    switch (fx.kind) {
      case "await-hold": {
        const id = fx.pointer;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => sendTile({ kind: "hold", pointer: id }), HOLD);
        return;
      }
      case "tap":
        return tapTile(w);
      case "lift":
        if (fx.held) {
          navigator.vibrate?.(8);
          el.classList.add("held");
          setTimeout(() => el.classList.remove("held"), 250);
        }
        return onLift?.(true);
      case "carry":
        return carryTo(w, fx.at.x, fx.at.y);
      case "drop": {
        const at = spot(fx.at.x, fx.at.y);
        const attach = m.placing()?.attach;
        if (at) {
          setArmed(undefined);
          tileAt = performance.now();
          if (w.kind === "type") ed.dispatch({ kind: "net/add-agent", type: w.id, at, attach });
          else ed.dispatch({ kind: "net/add-component", id: w.id, at });
        }
        return putBack();
      }
      case "put-back":
        return putBack();
    }
  };
  const putBack = () => {
    setCarry(undefined);
    m.setPlacing(undefined);
    onLift?.(false);
  };

  /**
   * Once a tile is out, the finger is the tile's: the row mustn't scroll
   * under it. A tile's touchmove listener (not passive, and there before the
   * finger comes down, or the browser won't wait for it) asks this.
   */
  const tileOut = () => !!pressed && pressed.kind !== "press";

  /**
   * A pointer down on a tile, which the tile machine (./tile.ts) follows to
   * its end. `axis` is the way the tiles scroll; `lifted` tells the sheet.
   */
  const pressTile = (w: TileWhat, opts: { axis: "x" | "y"; onLift: (on: boolean) => void }) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    pressing?.stop();
    onLift = opts.onLift;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => sendTile({ kind: "move", pointer: ev.pointerId, at: { x: ev.clientX, y: ev.clientY } });
    const up = (ev: PointerEvent) => sendTile({ kind: "up", pointer: ev.pointerId, at: { x: ev.clientX, y: ev.clientY } });
    const cancel = () => sendTile({ kind: "cancel" });
    const stop = () => {
      clearTimeout(holdTimer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      pressing = undefined;
      pressed = undefined;
    };
    pressing = { what: w, el, stop };
    pressed = undefined;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    sendTile({ kind: "down", pointer: e.pointerId, at: { x: e.clientX, y: e.clientY }, axis: opts.axis, lift: e.pointerType === "mouse" ? 0 : LIFT });
  };

  // The run buttons, by their machine (./transport.ts).
  const [transport, setTransport] = createSignal<Transport>({});
  let runTimer: ReturnType<typeof setTimeout> | undefined;
  const fire = (b: RunButton) => ed.dispatch({ kind: b === "step" ? "run/step-one" : b === "all" ? "run/step-all" : "run/toggle" });
  const sendTransport = (msg: TransportMsg) => {
    const [next, fx] = updateTransport(transport(), msg);
    setTransport(next);
    for (const f of fx) performTransport(f);
  };
  const performTransport = (fx: TransportEffect) => {
    switch (fx.kind) {
      case "await-hold": {
        clearTimeout(runTimer);
        const id = fx.pointer;
        runTimer = setTimeout(() => sendTransport({ kind: "hold", pointer: id }), HOLD);
        return;
      }
      case "held":
        navigator.vibrate?.(8);
        return;
      case "fire":
        return fire(fx.button);
    }
  };
  onCleanup(() => clearTimeout(runTimer));
  /** The button armed, if any. */
  const armedRun = () => transport().armed;
  // Step and Parallel step, armed, show on the canvas what they'd fire.
  createEffect(
    on(armedRun, (b, was) => {
      if (b === "step" || b === "all") ed.setPreviewMode(b === "step" ? "next" : "all");
      else if (was && was !== "run" && !ed.running()) ed.setPreviewMode(undefined);
    }),
  );
  // An armed button that can't fire any more lets go.
  createEffect(() => {
    const b = armedRun();
    const active = m.activeWires().size;
    if (b && (!active || (b !== "run" && ed.running()))) sendTransport({ kind: "elsewhere" });
  });
  // A tap anywhere but the armed button lets it go.
  const away = (e: PointerEvent) => {
    const b = armedRun();
    if (b && !(e.target as Element).closest?.(`[data-run="${b}"]`)) sendTransport({ kind: "elsewhere" });
  };
  document.addEventListener("pointerdown", away, true);
  onCleanup(() => document.removeEventListener("pointerdown", away, true));

  return {
    ed,
    m,
    camera,
    canvas,
    armed,
    setArmed,
    heldAt,
    setHeldAt,
    tile,
    setTile,
    carry,
    making,
    setMaking,
    taps,
    room,
    setRoom,
    visibleMiddle,
    middleOfView,
    keep,
    clipboard,
    copy,
    cut,
    paste,
    canPaste,
    duplicate,
    selectConnected: (from?: AgentId[]) => selectConnected(m, from),
    fromTile,
    openTile,
    pressTile,
    tileOut,
    transport,
    armedRun,
    sendTransport,
    ghostStub: GHOST_STUB,
  };
}

export type Phone = ReturnType<typeof createPhone>;

/** What can be pasted: a clip copied here, or a net read from text. */
export type Pasted = Parameters<Editor["paste"]>[0];

/** The box round the selected agents, in the net's coordinates. */
function selectionBox(m: NetModel) {
  const l = m.layout();
  const v = m.view().net;
  let b: { x0: number; y0: number; x1: number; y1: number } | undefined;
  for (const [id, p] of l.placement) {
    if (!v.agents.has(id) || !m.isSelected(id)) continue;
    const q = boxOf(p, v.agent(id).wires.length - 1);
    b = b ? { x0: Math.min(b.x0, q.x0), y0: Math.min(b.y0, q.y0), x1: Math.max(b.x1, q.x1), y1: Math.max(b.y1, q.y1) } : q;
  }
  return b;
}

/** Where a copy of the selected agents goes when duplicated: just right of them. */
export function besideSelection(m: NetModel): Pt | undefined {
  const b = selectionBox(m);
  return b && { x: b.x1 + (b.x1 - b.x0) / 2 + 36, y: (b.y0 + b.y1) / 2 };
}

/** Select everything joined by wires to these agents (the selected ones, by default), and those wires. */
export function selectConnected(m: NetModel, from?: AgentId[]) {
  const v = m.view().net;
  const seen = new Set<AgentId>(from ?? [...v.agents.keys()].filter((id) => m.isSelected(id)));
  const wires = new Set<WireId>();
  const todo = [...seen];
  while (todo.length) {
    const a = todo.pop()!;
    for (const w of v.agent(a).wires) {
      if (!v.wires.has(w)) continue;
      wires.add(w);
      for (const e of v.wire(w).ends) {
        if (e.kind === "port" && !seen.has(e.agent)) {
          seen.add(e.agent);
          todo.push(e.agent);
        }
      }
    }
  }
  m.pickMany([...seen], [...wires]);
}
