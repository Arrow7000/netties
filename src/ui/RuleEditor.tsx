import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { canonical } from "../core/canon";
import { CLIP_TYPE, type Clip, mergePlan, systemFor } from "../core/clip";
import { Groups } from "../core/groups";
import { Net, NONE } from "../core/net";
import { interfaceNet, interfacePins, isSymmetric, netToRule, pairNet, parseIface, ruleToNet } from "../core/ruleNet";
import { System } from "../core/system";
import { parse, print } from "../core/text";
import { badWires, canMeet, flip, ruleClashes, specOf } from "../core/types";
import type { Box, Pt } from "../layout/geometry";
import type { Editor } from "../state/editor";
import { createNetModel } from "../state/model";
import { Canvas, type Pad, createCamera } from "./Canvas";
import { compact } from "./compact";
import { dismissOnClickOutside } from "./dismiss";
import { Check, Fit, Left, Pencil, Redo, Right, Tidy, Trash, Undo } from "./icons";
import { shortcuts } from "./keys";
import { onThaw } from "./freeze";
import type { Phone } from "./phone/kit";
import { HoldMenu } from "./phone/parts";
import { RuleSelection, createRulePhone } from "./phone/rule";
import { gridTypes } from "./RuleGrid";
import { setSubEditor } from "./subEditor";

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUB[Number(d)]!);

/** Interface ports read as x₁… for the top agent and y₁… for the bottom one. */
const ifaceLabel = (name: string) => {
  const i = parseIface(name);
  return i ? `${i.side === 0 ? "x" : "y"}${sub(i.slot)}` : name;
};

/** Where the user moved or resized the panel to, kept while the page is open. */
let place: { left: number; top: number; w: number; h: number } | undefined;
/** Room kept clear above the bottom toolbar. */
const BOTTOM = 84;

const UNSAVED = "Unsaved changes: save or cancel them first.";

/** Room left around each half when fitting: for the captions, and on a desktop the hint and Tidy. */
const PAD: { before: Pad; after: Pad } = { before: { t: 48, r: 24, b: 48, l: 24 }, after: { t: 60, r: 56, b: 60, l: 56 } };
/**
 * On a phone the rule is fitted snugly, below the captions, and zoomed in
 * no further than `PHONE_ZOOM`, so a small rule isn't drawn huge. The
 * result leaves room for the selection's row, which comes up over it
 * without moving anything: at the bottom (over the status line too), room
 * for its words, a line of them, and its buttons; with Before beside After,
 * a column at the right.
 */
const PHONE_PAD: Pad = { t: 30, r: 14, b: 14, l: 14 };
const PHONE_AFTER_PAD: Pad = { ...PHONE_PAD, b: PHONE_PAD.b + 104 };
const PHONE_AFTER_BESIDE: Pad = { ...PHONE_PAD, r: PHONE_PAD.r + 250 };
const PHONE_ZOOM = 1.6;
/** When the editor shows Before over After rather than beside it, as styles.css has it. */
const STACKED = "(max-width: 760px)";

/**
 * Draw what a pair turns into, in a panel beside the palette. The pair sits
 * small on the left; the result is built on the right, around the
 * interface: the wires the pair held, which stay fixed. Agents come from the
 * main palette. Moving agents isn't a change, since a rule only says what's
 * wired to what; rewiring, adding or removing agents, or the description
 * is. A panel with changes stays open until they're saved or cancelled.
 */
export function RuleEditor(props: { ed: Editor; left: string; right: string; phone?: Phone }) {
  const ed = props.ed;
  const sys = () => ed.system;
  // A rule stored the other way round is edited from its own point of view.
  const existing = sys().ruleFor(props.left, props.right);
  const [left, right] = existing?.swapped ? [props.right, props.left] : [props.left, props.right];
  const pins = interfacePins(sys(), left, right);

  // An interface end stands for whatever was plugged into that aux port of the pair,
  // so it carries the far side of that port: wires in the result have to fit it.
  const freeSpec = (name: string) => {
    const i = parseIface(name);
    return i ? flip(specOf(sys(), i.side === 0 ? left : right, i.slot)) : undefined;
  };
  // Ends whose types differ are each labelled with theirs, so they need more room.
  const gap = (names: string[]) => {
    const types = names.map((n) => freeSpec(n)?.type);
    if (types.every((t) => t === types[0])) return undefined;
    return 24 + Math.max(...types.map((t) => (t ?? "").length)) * 5.9;
  };
  Object.assign(pins, { gaps: { top: gap(pins.top), bottom: gap(pins.bottom) } });
  const lhs = createNetModel({ system: sys, pins: () => pins, surface: "rule", freeSpec });
  lhs.setNet(pairNet(sys(), left, right).net);
  const rhs = createNetModel({ system: sys, pins: () => pins, surface: "rule", freeSpec });
  rhs.setNet(existing ? ruleToNet(sys(), existing.rule) : interfaceNet(sys(), left, right));
  // Agents stay where they're put; Tidy lays them out afresh.
  rhs.setMode("manual", false);
  rhs.clearHistory();
  /** The interface end under the pointer in one half, to light up in the other: both halves name them alike. */
  const hoveredEnd = (m: typeof lhs) => {
    const h = m.hover();
    return h?.kind === "free" ? h.name : undefined;
  };
  const lcam = createCamera();
  const rcam = createCamera();

  // Wires of a rule that broke when the types changed are drawn red until they're rewired.
  createEffect(() => {
    rhs.rev();
    rhs.setDoomed(new Set(badWires(rhs.net, sys(), freeSpec).keys()));
  });

  const sym = (id: string) => sys().types.get(id)?.symbol ?? id;

  const status = createMemo(() => {
    rhs.rev();
    const { rule, open } = netToRule(left, right, rhs.net);
    const symmetric = left !== right || isSymmetric(rhs.net);
    const clashes = open ? 0 : ruleClashes(sys(), rule).length;
    return { rule, open, symmetric, clashes };
  });

  // What counts as a change: the wiring and agents (not where they sit), and the description.
  const shape = createMemo(() => (rhs.rev(), canonical(rhs.net)));
  const [desc, setDesc] = createSignal(existing?.rule.description ?? "");
  const [saved, setSaved] = createSignal({ shape: shape(), desc: desc(), has: !!existing });
  const dirty = () => shape() !== saved().shape || desc().trim() !== saved().desc;
  const complete = () => !status().open && !status().clashes;
  // A pair with no rule yet can be saved as it is (say, a rule that makes nothing).
  const canSave = () => complete() && (dirty() || !saved().has);

  let panel!: HTMLDivElement;
  let beforeEl!: HTMLDivElement;
  let afterEl!: HTMLDivElement;
  let cancelBtn!: HTMLButtonElement;
  let saveBtn!: HTMLButtonElement;
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  /** Say there are unsaved changes: Save and Cancel glow for a moment. */
  const flash = (text = UNSAVED) => {
    for (const b of [cancelBtn, saveBtn]) {
      b.classList.remove("flash-warm");
      void b.offsetWidth;
      b.classList.add("flash-warm");
    }
    ed.setMessage(text);
  };
  const tryClose = () => (dirty() ? flash() : ed.closeRule());

  const commit = () => {
    if (!complete()) return false;
    const rule = { ...status().rule };
    const d = desc().trim();
    if (d) rule.description = d;
    else delete rule.description;
    ed.saveRule(rule);
    setDesc(d);
    setSaved({ shape: shape(), desc: d, has: true });
    return true;
  };
  /** Save and close (the button, ⌘↵). */
  const save = () => {
    if (!canSave() || !commit()) return;
    ed.closeRule();
    ed.notify("Saved the rule.", true);
  };
  /** Save and keep editing (⌘S). */
  const saveHere = () => {
    if (!dirty() && saved().has) return ed.setMessage("No changes to save.");
    if (!complete()) return ed.setMessage(status().open ? "Wire every port and end before saving." : "Rewire the wires that don't fit before saving.");
    if (commit()) ed.notify("Saved.", true);
  };
  const remove = () => {
    ed.deleteRule(left, right);
    ed.closeRule();
    ed.notify(`Deleted the rule for ${sym(left)} and ${sym(right)}.`, true);
  };

  // The neighbouring pairs, in grid order, skipping pairs that can never meet.
  const pairs = () => {
    const ts = gridTypes(ed);
    const out: [string, string][] = [];
    ts.forEach((a, i) => ts.slice(i).forEach((b) => !canMeet(sys(), a.id, b.id) && out.push([a.id, b.id])));
    return out;
  };
  const neighbour = (d: -1 | 1) => {
    const ps = pairs();
    const i = ps.findIndex(([a, b]) => (a === left && b === right) || (a === right && b === left));
    return i < 0 ? undefined : ps[i + d];
  };
  const go = (d: -1 | 1) => {
    const n = neighbour(d);
    if (!n) return;
    if (dirty()) return flash("Save or cancel this rule before moving to the next one.");
    ed.openRule(n[0], n[1]);
  };
  const navTip = (d: -1 | 1) => {
    const n = neighbour(d);
    const word = d < 0 ? "Previous" : "Next";
    return n ? `${word} rule: ${sym(n[0])} with ${sym(n[1])} (⌥${d < 0 ? "←" : "→"})` : "No more pairs that way";
  };

  const stackedMq = matchMedia(STACKED);
  const [stacked, setStacked] = createSignal(stackedMq.matches);
  const onStacked = (e: MediaQueryListEvent) => setStacked(e.matches);
  stackedMq.addEventListener("change", onStacked);
  onCleanup(() => stackedMq.removeEventListener("change", onStacked));
  /** A phone on its side, with Before beside After. */
  const beside = () => compact() && !stacked();
  const afterPad = () => (!compact() ? PAD.after : beside() ? PHONE_AFTER_BESIDE : PHONE_AFTER_PAD);

  /**
   * Before's height on a phone with Before over After: just what it needs at
   * the zoom both are drawn at, After getting the rest.
   */
  const [split, setSplit] = createSignal<number>();
  /** Fit both sides at one zoom, so an agent is the same size on both. */
  const fitBoth = () => {
    if (compact() && stacked()) return fitStacked();
    setSplit(undefined);
    const k = Math.min(lcam.fitZoom(), rcam.fitZoom(), compact() ? PHONE_ZOOM : Infinity);
    lcam.fitAt(k);
    rcam.fitAt(k);
  };
  /**
   * The zoom that fits Before and After into the height they share, and
   * each into the width; then the height is split between them to suit.
   */
  const fitStacked = () => {
    const lb = lcam.bounds();
    const rb = rcam.bounds();
    if (!lb || !rb) return;
    const [b, a] = [PHONE_PAD, PHONE_AFTER_PAD];
    const tall = (x: Box) => Math.max(x.y1 - x.y0, 60);
    const wide = (x: Box) => Math.max(x.x1 - x.x0, 60);
    const w = afterEl.offsetWidth;
    const h = beforeEl.offsetHeight + afterEl.offsetHeight - b.t - b.b - a.t - a.b;
    const k = Math.min(PHONE_ZOOM, (w - b.l - b.r) / wide(lb), (w - a.l - a.r) / wide(rb), h / (tall(lb) + tall(rb)));
    if (!(k > 0)) return;
    setSplit(Math.round(tall(lb) * k + b.t + b.b));
    // Once the halves have their new heights.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        lcam.fitAt(k);
        rcam.fitAt(k);
      }),
    );
  };
  // Keep the view while editing, unless the result spills out of it. On a
  // phone, where the view is the finger's to move, it stays put regardless.
  createEffect(on(rhs.rev, () => queueMicrotask(() => !compact() && rcam.spills() && fitBoth()), { defer: true }));
  const tidy = () => {
    rhs.tidy();
    queueMicrotask(fitBoth);
  };

  /** Where a click on a palette tile drops an agent: in free space just right of the result, a little apart each time. */
  let drops = 0;
  const centre = () => {
    const n = drops++ % 4;
    const placed = [...rhs.layout().placement.values()];
    if (!placed.length) {
      const r = afterEl.getBoundingClientRect();
      return rcam.toWorld(r.left + r.width / 2, r.top + r.height / 2) ?? { x: 0, y: 0 };
    }
    const right = Math.max(...placed.map((p) => p.x));
    const mid = placed.reduce((s, p) => s + p.y, 0) / placed.length;
    return { x: right + 70 + (n % 2) * 40, y: mid + (n - 1.5) * 34 };
  };

  // While the pointer is over the result, that's where a paste goes.
  let pointer: { x: number; y: number } | undefined;

  const copy = () => {
    const piece = rhs.copySelection();
    if (!piece) return undefined;
    const s = systemFor(sys(), piece.net);
    const clip: Clip = {
      v: 1,
      net: piece.net.toJSON(),
      groups: piece.groups.toJSON(),
      positions: [...piece.positions],
      system: s.toJSON(),
      components: [],
    };
    return { clip, text: print(s, piece.net) };
  };

  /**
   * Paste into the result, at `at` in it, or else under the pointer or in the
   * middle: only agents this system has, with any loose ends left as empty ports.
   */
  const paste = (src: Clip | { system: System; net: Net }, at?: Pt) => {
    const from = "v" in src ? System.fromJSON(src.system) : src.system;
    const piece = "v" in src ? Net.fromJSON(src.net) : src.net;
    const rel = new Map("v" in src ? src.positions : []);
    if (!piece.agents.size) return "There are no agents to paste.";
    const plan = mergePlan(sys(), from);
    if ("error" in plan) return plan.error;
    if (plan.types.size)
      return `Can't paste ${[...plan.types.values()].map((t) => t.symbol).join(", ")} into a rule: add ${plan.types.size === 1 ? "it" : "them"} as an agent first.`;
    for (const [name, w] of [...piece.free]) {
      if (w !== NONE) piece.disconnect(w);
      piece.free.delete(name);
    }
    const r = afterEl.getBoundingClientRect();
    const c = pointer && rcam.contains(pointer.x, pointer.y) ? pointer : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    rhs.checkpoint();
    rhs.insertPiece(piece, new Groups(), rel, at ?? rcam.toWorld(c.x, c.y) ?? { x: 0, y: 0 });
    rhs.bump();
    return undefined;
  };

  /** Fingers on a phone, as on the net: a tap on an end starts a wire, and the selection gets a row of its own. */
  const touch = props.phone && createRulePhone({ ed, kit: props.phone, m: rhs, freeLabel: ifaceLabel, copy, paste });

  // Escape lets go of a pending delete, then the selection, then closes.
  const escape = () => {
    if (confirmDelete()) setConfirmDelete(false);
    else if (rhs.selection() || rhs.armed() || touch?.armed()) {
      rhs.clearSelection();
      rhs.clearArmed();
      touch?.setArmed(undefined);
    } else tryClose();
  };
  dismissOnClickOutside(() => panel, ed.closeRule, dirty, () => flash(), ".palette, .top-right", escape);

  onMount(() => {
    setSubEditor({ m: rhs, camera: rcam, centre, canLeave: () => (dirty() ? (flash(), false) : true) });
    onCleanup(() => setSubEditor(undefined));
    requestAnimationFrame(fitBoth);
    // A new size refits, except on a phone when only the height changed (as
    // when the split between the halves moves): the middle stays in the middle.
    let was: { w: number; h: number } | undefined;
    const ro = new ResizeObserver(() => {
      const r = afterEl.getBoundingClientRect();
      const last = was;
      was = { w: r.width, h: r.height };
      if (compact() && last && Math.abs(r.width - last.w) < 1) return rcam.setView((v) => ({ ...v, y: v.y + (r.height - last.h) / 2 }));
      fitBoth();
    });
    ro.observe(afterEl);
    onCleanup(() => ro.disconnect());

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if ((e.target as Element).closest("input, textarea, select")) {
        // In the description: Enter leaves the field, as Escape does; saving still works.
        if (mod && key === "s") (e.preventDefault(), saveHere());
        else if (mod && e.key === "Enter") (e.preventDefault(), save());
        else if (e.key === "Enter") (e.target as HTMLElement).blur();
        else return;
        e.stopImmediatePropagation();
        return;
      }
      e.stopImmediatePropagation();
      if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? rhs.redo() : rhs.undo();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (mod && key === "s") {
        e.preventDefault();
        saveHere();
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        go(e.key === "ArrowLeft" ? -1 : 1);
      } else if (mod) return;
      else if (e.key === "Delete" || e.key === "Backspace") rhs.deleteSelection();
      else if (key === "x") rhs.flipAgents(rhs.selectedAgents());
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));

    const editable = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select, [contenteditable]");
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (editable(e.target) || !e.clipboardData) return;
      const c = copy();
      if (!c) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      e.clipboardData.setData(CLIP_TYPE, JSON.stringify(c.clip));
      e.clipboardData.setData("text/plain", c.text);
      if (cut) rhs.deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target) || !e.clipboardData) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const json = e.clipboardData.getData(CLIP_TYPE);
      let why: string | undefined;
      try {
        why = paste(json ? (JSON.parse(json) as Clip) : parse(e.clipboardData.getData("text/plain")));
      } catch {
        why = "Couldn't paste that.";
      }
      if (why) ed.setMessage(why);
    };
    const copyH = (e: ClipboardEvent) => onCopy(e, false);
    const cutH = (e: ClipboardEvent) => onCopy(e, true);
    const track = (e: PointerEvent) => (pointer = { x: e.clientX, y: e.clientY });
    document.addEventListener("copy", copyH, true);
    document.addEventListener("cut", cutH, true);
    document.addEventListener("paste", onPaste, true);
    window.addEventListener("pointermove", track, { passive: true });
    onCleanup(() => {
      document.removeEventListener("copy", copyH, true);
      document.removeEventListener("cut", cutH, true);
      document.removeEventListener("paste", onPaste, true);
      window.removeEventListener("pointermove", track);
    });
  });

  // Placement: beside the palette, below the top islands, above the bottom toolbar.
  const frame = () => {
    if (place) return { ...place, h: Math.min(place.h, innerHeight - place.top - BOTTOM) };
    const pal = document.querySelector(".palette")?.getBoundingClientRect();
    const right = pal ? innerWidth - pal.left + 12 : 260;
    const w = Math.min(880, innerWidth - right - 24);
    return { left: Math.max(12, innerWidth - right - w), top: 64, w, h: innerHeight - 64 - BOTTOM };
  };
  const [box, setBox] = createSignal(frame());
  const remember = () => {
    const r = panel.getBoundingClientRect();
    place = { left: r.left, top: r.top, w: r.width, h: r.height };
  };
  let stopPanelDrag: (() => void) | undefined;
  onCleanup(() => stopPanelDrag?.());
  /** Drag the header to move the panel. */
  const moveStart = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("button, input, label")) return;
    const b = box();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => setBox({ ...b, left: b.left + ev.clientX - sx, top: Math.max(8, b.top + ev.clientY - sy) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      unsubscribe();
      stopPanelDrag = undefined;
      remember();
    };
    stopPanelDrag?.();
    const unsubscribe = onThaw(up);
    stopPanelDrag = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  /** Drag the bottom-left corner to resize it. */
  const resizeStart = (e: PointerEvent) => {
    e.preventDefault();
    const b = box();
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const w = Math.max(560, b.w - (ev.clientX - sx));
      const h = Math.min(innerHeight - b.top - BOTTOM, Math.max(380, b.h + ev.clientY - sy));
      setBox({ left: b.left + b.w - w, top: b.top, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      unsubscribe();
      stopPanelDrag = undefined;
      remember();
    };
    stopPanelDrag?.();
    const unsubscribe = onThaw(up);
    stopPanelDrag = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const selected = () => rhs.selectedAgents();
  const selectedText = () => {
    const ids = selected();
    if (ids.length !== 1) return `${ids.length} agents`;
    const t = sys().types.get(rhs.view().net.agent(ids[0]!).type);
    return t ? `${t.symbol} ${t.name !== t.symbol ? t.name : ""}`.trim() : "1 agent";
  };

  const ends = () => [...rhs.net.free.keys()].sort().map(ifaceLabel);
  const info = () => {
    const es = ends();
    return `Build what this pair turns into. The pair disappears${
      es.length
        ? `, and every wire it held (${es.join(", ")}) must connect to something in the result.`
        : ". It held no other wires, so the result can be empty, or new agents wired to each other."
    }`;
  };

  return (
    <div
      ref={panel}
      class="rule-panel"
      classList={{ dirty: dirty() }}
      role="dialog"
      aria-label={`Rule for ${sym(left)} and ${sym(right)}`}
      style={{ left: `${box().left}px`, top: `${box().top}px`, width: `${box().w}px`, height: `${box().h}px` }}
    >
      <header class="rp-head" onPointerDown={moveStart}>
        <div class="rp-title">
          <h3>
            <span class="rp-nav">
              <button class="btn icon nav" onClick={() => go(-1)} disabled={!neighbour(-1)} title={navTip(-1)}>
                <Left />
              </button>
              <button class="btn icon nav" onClick={() => go(1)} disabled={!neighbour(1)} title={navTip(1)}>
                <Right />
              </button>
            </span>
            <span class="k">Rule</span> <i class="sym">{sym(left)}</i> with <i class="sym">{sym(right)}</i>
            <Show when={dirty()}>
              <span class="dirty-dot" title="Unsaved changes" />
            </Show>
          </h3>
          <label class="rp-desc">
            <span class="lab">Description</span>
            <input
              value={desc()}
              placeholder="none yet"
              spellcheck={false}
              maxLength={200}
              onInput={(e) => setDesc(e.currentTarget.value)}
            />
            <Pencil />
          </label>
        </div>
        <span class="sp" />
        <button class="btn icon" onClick={() => rhs.undo()} disabled={!rhs.historySize().undo} title="Undo in the rule (⌘Z)">
          <Undo />
        </button>
        <button class="btn icon" onClick={() => rhs.redo()} disabled={!rhs.historySize().redo} title="Redo in the rule (⇧⌘Z)">
          <Redo />
        </button>
        <span class="sep" />
        <span class="rp-info" title={info()}>
          i
        </span>
      </header>

      <div class="rp-body" style={split() ? { "grid-template-rows": `${split()}px 26px minmax(0, 1fr)` } : undefined}>
        <div ref={beforeEl} class="rp-before">
          <span class="rp-cap">Before</span>
          <Canvas m={lhs} camera={lcam} readonly freeLabel={ifaceLabel} twinHover={() => hoveredEnd(rhs)} pad={compact() ? PHONE_PAD : PAD.before} />
        </div>
        <div class="rp-arrow" aria-hidden="true">
          →
        </div>
        <div class="rp-after">
          <div ref={afterEl} class="rp-wrap">
            <Canvas
              m={rhs}
              camera={rcam}
              freeLabel={ifaceLabel}
              twinHover={() => hoveredEnd(lhs)}
              pad={afterPad()}
              phone={compact() ? touch?.canvas : undefined}
            />
            <span class="rp-cap">
              After<Show when={!saved().has}> · no rule yet</Show>
            </span>
            <span class="rp-hint">Drag agents in from the palette →</span>
            <div class="rp-tools">
              {/* On a phone the view stays where it's put, so it's fitted again by asking. */}
              <Show when={compact()}>
                <button class="btn icon rp-fit" onClick={fitBoth} aria-label="Fit the rule in view">
                  <Fit />
                </button>
              </Show>
              <button class="btn icon rp-tidy" onClick={tidy} disabled={!rhs.net.agents.size} title="Tidy: lay the result out afresh">
                <Tidy />
              </button>
            </div>
          </div>
          <div class="rp-status" classList={{ bad: !complete() || !status().symmetric }}>
            <Show
              when={complete() && status().symmetric}
              fallback={<span class="dot" />}
            >
              <Check />
            </Show>
            {status().open > 0
              ? status().open === 1
                ? "1 port still needs a wire."
                : `${status().open} ports still need a wire.`
              : status().clashes > 0
                ? `${status().clashes === 1 ? "1 wire joins" : `${status().clashes} wires join`} ports that don't fit the types. Rewire ${status().clashes === 1 ? "it" : "them"} to save.`
                : !status().symmetric
                  ? "Not symmetric: the result depends on which one is on top."
                  : "Every port and every end has a wire."}
          </div>
          <Show when={compact() && touch}>
            {(t) => (
              <>
                <RuleSelection focus={t().focus} beside={beside()} />
                <HoldMenu kit={t().hold} selectAll={t().hold.selectAll} />
              </>
            )}
          </Show>
        </div>
      </div>

      <footer class="rp-bar">
        <Show when={saved().has}>
          <div class="rp-delete">
            <button class="btn danger" onClick={() => setConfirmDelete(!confirmDelete())}>
              Delete rule
            </button>
            <Show when={confirmDelete()}>
              <div class="rp-confirm" role="alertdialog" aria-label="Delete this rule?">
                <b>
                  Delete the rule for <i class="sym">{sym(left)}</i> and <i class="sym">{sym(right)}</i>?
                </b>
                <p>When they meet they'll get stuck.</p>
                <div class="row">
                  <button class="btn outline" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                  <button class="btn dangerfill" onClick={remove}>
                    Delete
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={!compact() && selected().length}>
          <div class="rp-selection">
            <span>{selectedText()}</span>
            <button class="btn small outline" onClick={() => rhs.flipAgents(selected())} title="Flip (X)">
              Flip
            </button>
            <button class="btn small icon" onClick={() => rhs.deleteSelection()} title="Delete (⌫)">
              <Trash />
            </button>
          </div>
        </Show>
        <span class="sp" />
        <button ref={cancelBtn} class="btn" onClick={() => ed.closeRule()}>
          Cancel
        </button>
        <button
          ref={saveBtn}
          class="btn primary"
          onClick={save}
          disabled={!canSave()}
          title="Save and close (⌘↵). ⌘S saves and keeps the rule open."
        >
          Save <span class="kbd">{shortcuts("⌘↵")}</span>
        </button>
      </footer>
      <div class="rp-grip" onPointerDown={resizeStart} title="Drag to resize" />
    </div>
  );
}
