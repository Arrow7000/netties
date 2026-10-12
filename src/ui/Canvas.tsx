import { For, Index, type JSX, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Frame } from "../anim/morph";
import type { GroupId } from "../core/groups";
import { type AgentId, type End, NONE, type WireId, free, port, sameEnd } from "../core/net";
import { type System, pairKey } from "../core/system";
import { type Box, G, type Pt, boxOf, portPos, shape } from "../layout/geometry";
import { flattenPath, polylinePath, resample, roundedPath } from "../render/path";
import { agentOutline, arrowPoints, labelPos } from "../render/svg";
import type { DropCheck, NetModel, WireGesture } from "../state/model";
import { held } from "./keys";
import { prefs } from "./prefs";

type Drag =
  | { kind: "pan"; start: Pt; origin: Pt; moved: boolean }
  | { kind: "marquee"; start: Pt; cur: Pt; additive: boolean; moved: boolean }
  | { kind: "wire"; g: WireGesture; cur: Pt; target?: End; check?: DropCheck; path?: Pt[] }
  | { kind: "move"; ids: AgentId[]; groups: GroupId[]; last: Pt; moved: boolean }
  | { kind: "click-wire"; id: WireId; alt: boolean };

export interface View {
  x: number;
  y: number;
  k: number;
}

/** Room to leave around the net when fitting it in view, for panels floating over the canvas. */
export interface Pad {
  t: number;
  r: number;
  b: number;
  l: number;
}

/** Pan and zoom, shared between a canvas and the controls that drive it. */
export function createCamera() {
  const [view, setView] = createSignal<View>({ x: 0, y: 0, k: 1.5 });
  let host: { fit(): void; el(): SVGSVGElement } | undefined;
  const zoomAround = (k: number, cx: number, cy: number) =>
    setView((v) => {
      const nk = Math.min(8, Math.max(0.15, k));
      return { k: nk, x: cx - ((cx - v.x) * nk) / v.k, y: cy - ((cy - v.y) * nk) / v.k };
    });
  const center = () => {
    const r = host?.el().getBoundingClientRect();
    return r ? { x: r.width / 2, y: r.height / 2 } : { x: 0, y: 0 };
  };
  return {
    view,
    setView,
    zoomAround,
    zoomBy(f: number) {
      const c = center();
      zoomAround(view().k * f, c.x, c.y);
    },
    zoomTo(k: number) {
      const c = center();
      zoomAround(k, c.x, c.y);
    },
    fit: () => host?.fit(),
    /** The world point under a client position, if it's over the canvas. */
    toWorld(clientX: number, clientY: number): Pt | undefined {
      const el = host?.el();
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return undefined;
      const v = view();
      return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    },
    attach(h: { fit(): void; el(): SVGSVGElement }) {
      host = h;
    },
  };
}

export type Camera = ReturnType<typeof createCamera>;

export interface CanvasProps {
  m: NetModel;
  camera?: Camera;
  /** Called when an active pair's wire is clicked. Without it, active pairs just select. */
  onFire?: (w: WireId) => void;
  /** Called when an active pair with no rule is clicked. */
  onStuck?: (w: WireId) => void;
  /** Display names for free ports. */
  freeLabel?: (name: string) => string;
  /** Read-only: no selecting, dragging or wiring. */
  readonly?: boolean;
  /** Don't try to draw nets with more agents than this. */
  limit?: number;
  /** Room to leave for floating panels when fitting the net in view. */
  pad?: Pad;
  /** Shown over the canvas while the net is empty. */
  empty?: JSX.Element;
  class?: string;
}

const NO_PAD: Pad = { t: 40, r: 40, b: 40, l: 40 };

type EndState = "none" | "empty" | "hover" | "origin" | "candidate" | "blocked" | "target" | "refuse";

export function Canvas(props: CanvasProps) {
  const ed = props.m;
  const cam = props.camera ?? createCamera();
  const view = cam.view;
  const setView = cam.setView;
  const sys = () => ed.view().sys;
  let svg!: SVGSVGElement;
  const [drag, setDrag] = createSignal<Drag>();
  const [size, setSize] = createSignal({ w: 800, h: 600 });
  const [space, setSpace] = createSignal(false);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.getBoundingClientRect();
    const v = view();
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };

  const tooBig = () => ed.view().net.agents.size > (props.limit ?? Infinity);
  const pad = () => props.pad ?? NO_PAD;

  const contentBounds = () => {
    const { routed } = ed.layout();
    const b = { ...routed.bounds };
    for (const f of routed.free.values()) {
      b.y0 = Math.min(b.y0, f.y - 16);
      b.y1 = Math.max(b.y1, f.y + 16);
    }
    return b;
  };

  const fit = () => {
    if (tooBig()) return;
    const b = contentBounds();
    const { w, h } = size();
    const p = pad();
    const bw = Math.max(b.x1 - b.x0, 60);
    const bh = Math.max(b.y1 - b.y0, 60);
    const k = Math.min((w - p.l - p.r) / bw, (h - p.t - p.b) / bh, 2.4);
    setView({
      k,
      x: p.l + (w - p.l - p.r) / 2 - ((b.x0 + b.x1) / 2) * k,
      y: p.t + (h - p.t - p.b) / 2 - ((b.y0 + b.y1) / 2) * k,
    });
  };

  onMount(() => {
    cam.attach({ fit, el: () => svg });
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(svg);
    const r = svg.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    fit();
    // Space held turns a left-drag into a pan, as in drawing tools.
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key !== " " || (e.target as Element).closest?.("input, textarea, select, button")) return;
      if (down) e.preventDefault();
      setSpace(down);
    };
    const kd = key(true);
    const ku = key(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    });
  });

  createEffect(on(ed.fitTick, () => queueMicrotask(fit), { defer: true }));

  // In automatic mode, keep the whole net in view as it changes shape.
  createEffect(
    on(
      () => (tooBig() ? undefined : ed.layout()),
      () => {
        if (ed.mode() !== "auto" || drag() || tooBig()) return;
        const b = contentBounds();
        const v = view();
        const { w, h } = size();
        const p = pad();
        const sx0 = b.x0 * v.k + v.x;
        const sx1 = b.x1 * v.k + v.x;
        const sy0 = b.y0 * v.k + v.y;
        const sy1 = b.y1 * v.k + v.y;
        if (sx0 < p.l / 2 || sy0 < p.t / 2 || sx1 > w - p.r / 2 || sy1 > h - p.b / 2) fit();
      },
      { defer: true },
    ),
  );

  const wireIds = createMemo(() => (tooBig() ? [] : [...ed.layout().routed.wires.keys()]));
  const agentIds = createMemo(() =>
    tooBig() ? [] : [...ed.layout().placement.keys()].filter((id) => ed.view().net.agents.has(id)),
  );
  const freeNames = createMemo(() => (tooBig() ? [] : [...ed.layout().routed.free.keys()]));

  /** Outlines around expanded instances whose agents are on show. */
  const hulls = createMemo(() => {
    if (tooBig()) return [];
    const l = ed.layout();
    const v = ed.view();
    const gs = ed.groups;
    const out: { id: GroupId; box: Box; label: string; depth: number }[] = [];
    for (const g of gs.groups.values()) {
      if (g.collapsed || gs.chain(g.parent).some((h) => gs.groups.get(h)?.collapsed)) continue;
      const boxes = gs
        .members(g.id)
        .map((a) => {
          const p = l.placement.get(a);
          return p && v.net.agents.has(a) ? boxOf(p, v.net.agent(a).wires.length - 1) : undefined;
        })
        .filter((b): b is Box => !!b);
      // Nested boxes inside count too.
      for (const [id, h] of v.box) {
        if (h !== g.id && gs.chain(h).includes(g.id)) {
          const p = l.placement.get(id);
          if (p) boxes.push(boxOf(p, v.net.agent(id).wires.length - 1));
        }
      }
      if (!boxes.length) continue;
      const depth = gs.chain(g.id).length;
      const pad = 8 + 6 * (4 - Math.min(4, depth));
      out.push({
        id: g.id,
        depth,
        label: ed.defs().get(g.def)?.name ?? "component",
        box: {
          x0: Math.min(...boxes.map((b) => b.x0)) - pad,
          y0: Math.min(...boxes.map((b) => b.y0)) - pad,
          x1: Math.max(...boxes.map((b) => b.x1)) + pad,
          y1: Math.max(...boxes.map((b) => b.y1)) + pad,
        },
      });
    }
    return out.sort((a, b) => a.depth - b.depth);
  });

  const endAt = (el: Element | null): End | undefined => {
    const p = el?.closest("[data-port]");
    if (p) {
      const [a, s] = p.getAttribute("data-port")!.split(":").map(Number);
      return port(a!, s!);
    }
    const f = el?.closest("[data-free]");
    if (f) return free(f.getAttribute("data-free")!);
    return undefined;
  };

  /** What's under the pointer, for the hover panel. */
  const hoverAt = (el: Element | null) => {
    if (!el || !svg.contains(el)) return undefined;
    const end = endAt(el);
    if (end) return end.kind === "port" ? { kind: "port" as const, end } : { kind: "free" as const, name: end.name };
    const a = el.closest("[data-agent]");
    if (a) return { kind: "agent" as const, id: Number(a.getAttribute("data-agent")) };
    const w = el.closest("[data-wire]");
    if (w) return { kind: "wire" as const, id: Number(w.getAttribute("data-wire")) };
    const g = el.closest("[data-group]");
    if (g) return { kind: "group" as const, id: Number(g.getAttribute("data-group")) };
    return undefined;
  };

  /** Start dragging the selection in either layout mode. */
  const startMove = (w: Pt) => {
    const s = ed.selection();
    if (s?.kind !== "items") return;
    if (ed.mode() === "manual") ed.beginSelectionMove();
    else ed.beginAutoSelectionMove([...s.agents], [...s.groups]);
    setDrag({ kind: "move", ids: [...s.agents], groups: [...s.groups], last: w, moved: false });
  };

  const startPan = (e: PointerEvent) => {
    const v = view();
    setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, origin: { x: v.x, y: v.y }, moved: false });
  };

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element;
    svg.setPointerCapture(e.pointerId);
    ed.setHover(undefined);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space())) {
      e.preventDefault();
      return startPan(e);
    }
    if (e.button !== 0) return;
    if (props.readonly) return startPan(e);
    const w = toWorld(e);
    const end = endAt(target);
    if (end) {
      const g = ed.gestureAt(end);
      setDrag({ kind: "wire", g, cur: w });
      ed.setHover({ kind: "drag", gesture: g });
      return;
    }
    const agentEl = target.closest("[data-agent]");
    if (agentEl) {
      const id = Number(agentEl.getAttribute("data-agent"));
      if (!ed.isSelected(id) || e.shiftKey) ed.pick(id, e.shiftKey);
      return startMove(w);
    }
    const hullEl = target.closest("[data-group]");
    if (hullEl) {
      const g = Number(hullEl.getAttribute("data-group"));
      ed.pickGroup(g, e.shiftKey);
      return startMove(w);
    }
    const wireEl = target.closest("[data-wire]");
    if (wireEl) {
      setDrag({ kind: "click-wire", id: Number(wireEl.getAttribute("data-wire")), alt: e.altKey });
      return;
    }
    setDrag({ kind: "marquee", start: w, cur: w, additive: e.shiftKey, moved: false });
  };

  let previewFrame = 0;
  const onPointerMove = (e: PointerEvent) => {
    const d = drag();
    if (!d) {
      if (!e.buttons) ed.setHover(hoverAt(e.target as Element));
      return;
    }
    if (d.kind === "pan") {
      const dx = e.clientX - d.start.x;
      const dy = e.clientY - d.start.y;
      setView((v) => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy }));
      if (!d.moved && Math.hypot(dx, dy) > 3) setDrag({ ...d, moved: true });
    } else if (d.kind === "marquee") {
      const cur = toWorld(e);
      const moved = d.moved || Math.hypot(cur.x - d.start.x, cur.y - d.start.y) * view().k > 3;
      setDrag({ ...d, cur, moved });
    } else if (d.kind === "wire") {
      const cur = toWorld(e);
      // Pointer capture sends events to the canvas; look at what's really under the pointer.
      const over = endAt(document.elementFromPoint(e.clientX, e.clientY));
      const target = over && !(d.g.kind === "new" && sameEnd(over, d.g.from)) ? over : undefined;
      const check = target ? ed.checkDrop(d.g, target) : undefined;
      setDrag({ ...d, cur, target, check });
      ed.setHover({ kind: "drag", gesture: d.g, target, check });
      cancelAnimationFrame(previewFrame);
      previewFrame = requestAnimationFrame(() => {
        const now = drag();
        if (now?.kind !== "wire") return;
        const to = now.check?.kind === "ok" ? now.target : undefined;
        setDrag({ ...now, path: ed.previewWire(now.g, to, now.cur) });
      });
    } else if (d.kind === "move") {
      const w = toWorld(e);
      const dx = w.x - d.last.x;
      const dy = w.y - d.last.y;
      if (ed.mode() === "manual") ed.moveSelectionBy(d.ids, d.groups, dx, dy);
      else ed.moveAutoSelectionBy(dx, dy);
      setDrag({ ...d, last: w, moved: true });
    }
  };

  /** View agents inside a marquee. */
  const marqueed = (d: Extract<Drag, { kind: "marquee" }>) => {
    const x0 = Math.min(d.start.x, d.cur.x);
    const x1 = Math.max(d.start.x, d.cur.x);
    const y0 = Math.min(d.start.y, d.cur.y);
    const y1 = Math.max(d.start.y, d.cur.y);
    return [...ed.layout().placement]
      .filter(([id, p]) => ed.view().net.agents.has(id) && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
      .map(([id]) => id);
  };
  const preselected = createMemo(() => {
    const d = drag();
    return d?.kind === "marquee" && d.moved ? new Set(marqueed(d)) : new Set<AgentId>();
  });

  const onPointerUp = (e: PointerEvent) => {
    const d = drag();
    setDrag(undefined);
    cancelAnimationFrame(previewFrame);
    if (!d) return;
    if (d.kind === "move" && ed.mode() === "auto") ed.endAutoSelectionMove();
    if (d.kind === "marquee") {
      if (d.moved) ed.pickMany(marqueed(d), d.additive);
      else if (!d.additive) ed.clearSelection();
    }
    if (d.kind === "wire") {
      if (!d.target) ed.finishGesture(d.g);
      else if (d.check?.kind === "ok") ed.finishGesture(d.g, d.target);
    }
    if (d.kind === "click-wire") {
      const alt = d.alt || e.altKey;
      if (ed.activeWires().has(d.id) && !alt && props.onFire) props.onFire(d.id);
      else if (ed.stuckWires().has(d.id) && !alt && props.onStuck) props.onStuck(d.id);
      else ed.selectWire(d.id);
    }
    ed.setHover(hoverAt(document.elementFromPoint(e.clientX, e.clientY)));
  };

  const onPointerCancel = () => {
    const d = drag();
    setDrag(undefined);
    cancelAnimationFrame(previewFrame);
    if (d?.kind === "move" && ed.mode() === "auto") ed.endAutoSelectionMove();
    ed.setHover(undefined);
  };

  /** Double-click a box to open it up, or an instance's outline to close it. */
  const onDblClick = (e: MouseEvent) => {
    if (props.readonly) return;
    // Pointer capture retargets the event to the canvas, so look at what's under the pointer.
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    const agentEl = target.closest("[data-agent]");
    if (agentEl) {
      const g = ed.view().box.get(Number(agentEl.getAttribute("data-agent")));
      if (g !== undefined) ed.setCollapsed(g, false);
      return;
    }
    const hullEl = target.closest("[data-group]");
    if (hullEl) ed.setCollapsed(Number(hullEl.getAttribute("data-group")), true);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    // Pinches arrive with ctrlKey set. A mouse wheel moves in whole notches;
    // a trackpad scrolls in small, uneven steps, and pans.
    const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || notch) {
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      cam.zoomAround(view().k * f, e.clientX - r.left, e.clientY - r.top);
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  const groupSelected = (g: GroupId) => {
    const s = ed.selection();
    return s?.kind === "items" && s.groups.has(g);
  };

  const wireDrag = () => {
    const d = drag();
    return d?.kind === "wire" ? d : undefined;
  };
  const carried = () => {
    const d = wireDrag();
    return d?.g.kind === "carry" ? d.g.wire : undefined;
  };

  /** The arrowhead on the wire being dragged, pointing the way its anchor's direction says. */
  const dragArrow = (pts: Pt[]) => {
    const d = wireDrag();
    if (!d) return undefined;
    const pol = ed.specAt(gestureAnchor(d.g)).pol;
    const flat = flattenPath(pts, G.radius);
    const m = midway(flat);
    if (!pol || !m || m.len < 14) return undefined;
    const start = dragStart(ed, d.g);
    const p0 = flat[0]!;
    const q0 = flat[flat.length - 1]!;
    const forward = !start || Math.hypot(p0.x - start.x, p0.y - start.y) <= Math.hypot(q0.x - start.x, q0.y - start.y);
    const sgn = (forward ? 1 : -1) * (pol === "give" ? 1 : -1);
    return { at: m.at, dx: m.dx * sgn, dy: m.dy * sgn, class: d.g.kind === "new" ? "drag" : "" };
  };

  /** How a port or free end should look right now. */
  const endState = (e: End): EndState => {
    const d = wireDrag();
    if (d) {
      if (sameEnd(e, d.g.kind === "new" ? d.g.from : d.g.anchor)) return "origin";
      if (d.target && sameEnd(e, d.target)) {
        const k = d.check?.kind;
        return k === "ok" ? "target" : k === "back" ? "empty" : "refuse";
      }
      if (d.g.kind === "carry" && sameEnd(e, d.g.moving)) return "empty";
      const open = ed.view().net.wireAt(e) === NONE || (e.kind === "free" && !ed.fixedInterface);
      if (!open) return "none";
      // Ports the wire can't go to, because the types don't fit, are greyed out.
      return ed.checkDrop(d.g, e).kind === "refuse" ? "blocked" : "candidate";
    }
    const h = ed.hover();
    if (h?.kind === "port" && sameEnd(h.end, e)) return "hover";
    if (h?.kind === "free" && e.kind === "free" && h.name === e.name) return "hover";
    return ed.view().net.wireAt(e) === NONE ? "empty" : "none";
  };

  /** Wires to highlight because the rule grid is pointing at their pair of types. */
  const highlighted = createMemo(() => {
    const h = ed.hover();
    if (h?.kind !== "pair") return new Set<WireId>();
    const k = pairKey(h.a, h.b);
    const v = ed.view().net;
    return new Set(
      v.activePairs().filter((w) => {
        const [a, b] = v.wire(w).ends;
        return a.kind === "port" && b.kind === "port" && pairKey(v.agent(a.agent).type, v.agent(b.agent).type) === k;
      }),
    );
  });

  /** Whether a wire's type label shows: always, by preference, or when the pointer is on or near it. */
  const typeShown = (id: WireId) => {
    if (prefs.wireTypes()) return true;
    const h = ed.hover();
    const v = ed.view().net;
    if (!v.wires.has(id)) return false;
    const ends = v.wire(id).ends;
    const touches = (e: End) => ends.some((x) => sameEnd(x, e));
    if (h?.kind === "wire") return h.id === id;
    if (h?.kind === "port") return touches(h.end);
    if (h?.kind === "free") return touches(free(h.name));
    if (h?.kind === "agent") return ends.some((x) => x.kind === "port" && x.agent === h.id);
    if (h?.kind === "porttype") return wireType(ed, id) === h.name;
    return false;
  };

  const grid = () => {
    const v = view();
    const g = 20 * v.k;
    return { "background-size": `${g}px ${g}px`, "background-position": `${v.x}px ${v.y}px` };
  };

  const isEmpty = () => (ed.rev(), ed.net.agents.size === 0 && ed.net.free.size === 0);

  return (
    <div class={`stage ${props.class ?? ""}`} style={grid()}>
      <svg
        ref={svg}
        class="canvas"
        classList={{
          panning: drag()?.kind === "pan" && (drag() as { moved: boolean }).moved,
          "space-pan": space() && !drag(),
          wiring: !!wireDrag(),
          alt: held.alt(),
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => !drag() && ed.setHover(undefined)}
        onDblClick={onDblClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label="Net canvas"
      >
        <g transform={`translate(${view().x} ${view().y}) scale(${view().k})`}>
          <Show when={ed.frame()}>{(f) => <Animated frame={f()} freeLabel={props.freeLabel} />}</Show>
          <g style={{ display: ed.frame() ? "none" : undefined }}>
            <For each={hulls()}>
              {(h) => (
                <g class="hull" classList={{ selected: groupSelected(h.id) }} data-group={h.id}>
                  <rect
                    x={h.box.x0}
                    y={h.box.y0}
                    width={h.box.x1 - h.box.x0}
                    height={h.box.y1 - h.box.y0}
                    rx={6}
                  />
                  <text x={h.box.x0 + 6} y={h.box.y0 - 4}>
                    {h.label}
                  </text>
                </g>
              )}
            </For>
            <For each={wireIds()}>
              {(id) => (
                <Wire
                  ed={ed}
                  id={id}
                  plain={props.readonly}
                  hidden={carried() === id}
                  highlighted={highlighted().has(id)}
                />
              )}
            </For>
            <For each={agentIds()}>
              {(id) => <Agent ed={ed} system={sys} id={id} pre={preselected().has(id)} endState={endState} readonly={props.readonly} />}
            </For>
            <For each={freeNames()}>
              {(name) => {
                const pt = () => ed.layout().routed.free.get(name);
                return (
                  <Show when={pt()}>
                    {(p) => (
                      <g class="free-end">
                        <EndMark at={p()} state={endState(free(name))} />
                        <circle class="end-dot" cx={p().x} cy={p().y} r={2.4} />
                        <text class="free-label" x={p().x} y={p().dir === "up" ? p().y - 7 : p().y + 13} text-anchor="middle">
                          {props.freeLabel?.(name) ?? name}
                        </text>
                        <circle class="hit" data-free={name} cx={p().x} cy={p().y} r={7} />
                      </g>
                    )}
                  </Show>
                );
              }}
            </For>
            <g class="wire-labels">
              <For each={wireIds()}>
                {(id) => (
                  <Show when={carried() !== id && typeShown(id) && wireType(ed, id)}>
                    {(t) => <WireLabel pts={ed.layout().routed.wires.get(id) ?? []} text={t()} />}
                  </Show>
                )}
              </For>
            </g>
            <StepPreview ed={ed} hidden={!!drag() || !props.onFire} />
            <HoverPill ed={ed} hidden={!!drag()} canFire={!!props.onFire} />
          </g>
          <Show when={wireDrag()}>
            {(d) => {
              const start = () => dragStart(ed, d().g) ?? d().cur;
              return (
                <g class="drag-wire" classList={{ carried: d().g.kind === "carry" }}>
                  <Show
                    when={d().path}
                    fallback={
                      <path
                        class="line"
                        d={`M${start().x} ${start().y} C${start().x} ${(start().y + d().cur.y) / 2} ${d().cur.x} ${(start().y + d().cur.y) / 2} ${d().cur.x} ${d().cur.y}`}
                      />
                    }
                  >
                    {(p) => (
                      <>
                        <path class="halo" d={roundedPath(p(), G.radius)} />
                        <path class="line" d={roundedPath(p(), G.radius)} />
                        <Show when={dragArrow(p())}>{(a) => <Arrowhead {...a()} />}</Show>
                        <Show when={ed.specAt(gestureAnchor(d().g)).type}>
                          {(t) => <WireLabel pts={p()} text={t()} />}
                        </Show>
                      </>
                    )}
                  </Show>
                </g>
              );
            }}
          </Show>
          <Show when={drag()?.kind === "marquee" ? (drag() as Extract<Drag, { kind: "marquee" }>) : undefined}>
            {(d) => (
              <rect
                class="marquee"
                x={Math.min(d().start.x, d().cur.x)}
                y={Math.min(d().start.y, d().cur.y)}
                width={Math.abs(d().cur.x - d().start.x)}
                height={Math.abs(d().cur.y - d().start.y)}
              />
            )}
          </Show>
        </g>
      </svg>
      <Show when={tooBig()}>
        <div class="canvas-note">
          {ed.view().net.agents.size.toLocaleString()} agents: too many to draw. The counts still update as it runs.
        </div>
      </Show>
      <Show when={props.empty && isEmpty()}>
        <div class="canvas-empty">{props.empty}</div>
      </Show>
    </div>
  );
}

const gestureAnchor = (g: WireGesture): End => (g.kind === "new" ? g.from : g.anchor);

/** Where a wire drag starts from: the anchor end. */
function dragStart(ed: NetModel, g: WireGesture): Pt | undefined {
  const e = g.kind === "new" ? g.from : g.anchor;
  const l = ed.layout();
  if (e.kind === "free") return l.routed.free.get(e.name);
  const p = l.placement.get(e.agent);
  return p ? portPos(p, ed.view().net.agent(e.agent).wires.length - 1, e.slot) : undefined;
}

/** The mark on a port or free end, showing what it is and what a drop there would do. */
function EndMark(props: { at: Pt; state: EndState }) {
  const c = (cls: string, r: number) => <circle class={cls} cx={props.at.x} cy={props.at.y} r={r} />;
  return (
    <>
      <Show when={props.state === "empty"}>{c("port-empty", 2.6)}</Show>
      <Show when={props.state === "hover"}>{c("port-hover", 5.2)}</Show>
      <Show when={props.state === "origin"}>{c("port-origin", 4.2)}</Show>
      <Show when={props.state === "candidate"}>{c("port-candidate", 5)}</Show>
      <Show when={props.state === "blocked"}>{c("port-blocked", 4.6)}</Show>
      <Show when={props.state === "target"}>{c("port-target", 6.5)}</Show>
      <Show when={props.state === "refuse"}>
        {c("port-refuse", 6)}
        <line
          class="port-refuse"
          x1={props.at.x - 3.4}
          y1={props.at.y + 3.4}
          x2={props.at.x + 3.4}
          y2={props.at.y - 3.4}
        />
      </Show>
    </>
  );
}

/**
 * For a pair under the pointer whose rule only reconnects wires: dashed
 * lines between the ends that firing it would join.
 */
function StepPreview(props: { ed: NetModel; hidden: boolean }) {
  const ed = props.ed;
  const joins = createMemo(() => {
    const h = ed.hover();
    if (props.hidden || held.alt() || h?.kind !== "wire" || !ed.activeWires().has(h.id)) return [];
    const v = ed.view();
    const [a, b] = v.net.wire(h.id).ends;
    if (a.kind !== "port" || b.kind !== "port") return [];
    const found = v.sys.ruleFor(v.net.agent(a.agent).type, v.net.agent(b.agent).type);
    if (!found || found.rule.agents.length) return [];
    const sides = found.swapped ? [b.agent, a.agent] : [a.agent, b.agent];
    const l = ed.layout();
    const at = (e: End): Pt | undefined => {
      if (e.kind === "free") return l.routed.free.get(e.name);
      const p = l.placement.get(e.agent);
      return p ? portPos(p, v.net.agent(e.agent).wires.length - 1, e.slot) : undefined;
    };
    const outside = (side: 0 | 1, slot: number) => v.net.partner(port(sides[side]!, slot));
    const out: [Pt, Pt][] = [];
    for (const [x, y] of found.rule.wires) {
      if (x.kind !== "iface" || y.kind !== "iface") continue;
      const ex = outside(x.side, x.slot);
      const ey = outside(y.side, y.slot);
      const px = ex && at(ex);
      const py = ey && at(ey);
      if (px && py) out.push([px, py]);
    }
    return out;
  });
  return (
    <g class="step-preview">
      <For each={joins()}>{([p, q]) => <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} />}</For>
    </g>
  );
}

/** "Click to fire" next to the active pair under the pointer. */
function HoverPill(props: { ed: NetModel; hidden: boolean; canFire: boolean }) {
  const ed = props.ed;
  const info = () => {
    const h = ed.hover();
    if (props.hidden || h?.kind !== "wire") return undefined;
    const active = ed.activeWires().has(h.id);
    const stuck = ed.stuckWires().has(h.id);
    if (!active && !stuck) return undefined;
    const pts = ed.layout().routed.wires.get(h.id);
    if (!pts) return undefined;
    const mid = resample(flattenPath(pts, G.radius), 3)[1]!;
    const alt = held.alt();
    const text = alt
      ? "Click to select the wire"
      : active
        ? props.canFire
          ? "Click to fire"
          : "Click to select"
        : "No rule: click to write one";
    return { mid, text, kind: alt ? "alt" : active ? "fire" : "stuck" };
  };
  return (
    <Show when={info()}>
      {(i) => (
        <g class={`pill ${i().kind}`} transform={`translate(${i().mid.x + 12} ${i().mid.y})`}>
          <rect x={0} y={-6.5} width={i().text.length * 4.3 + 12} height={13} rx={6.5} />
          <text x={6} y={0.4} dominant-baseline="central">
            {i().text}
          </text>
        </g>
      )}
    </Show>
  );
}

/** Where a view end is drawn. */
function endPos(ed: NetModel, e: End): Pt | undefined {
  const l = ed.layout();
  if (e.kind === "free") return l.routed.free.get(e.name);
  const p = l.placement.get(e.agent);
  return p ? portPos(p, ed.view().net.agent(e.agent).wires.length - 1, e.slot) : undefined;
}

/** Which way a wire runs: +1 from its first end to its second, -1 the other way, 0 if it has no direction. */
function wireFlow(ed: NetModel, id: WireId): number {
  const [a, b] = ed.view().net.wire(id).ends;
  const sa = ed.specAt(a);
  const sb = ed.specAt(b);
  if (sa.pol) return sa.pol === "give" ? 1 : -1;
  if (sb.pol) return sb.pol === "take" ? 1 : -1;
  return 0;
}

/** The type a wire carries, from whichever end has one. */
function wireType(ed: NetModel, id: WireId): string | undefined {
  const v = ed.view().net;
  if (!v.wires.has(id)) return undefined;
  const [a, b] = v.wire(id).ends;
  return ed.specAt(a).type ?? ed.specAt(b).type;
}

/** The point halfway along a polyline, the direction it runs there, and its length. */
function midway(pts: Pt[]): { at: Pt; dx: number; dy: number; len: number } | undefined {
  if (pts.length < 2) return undefined;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= left && len > 0) {
      const t = left / len;
      return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len, len: total };
    }
    left -= len;
  }
  return undefined;
}

/** A small arrowhead at a point, pointing along (dx, dy). */
function Arrowhead(props: { at: Pt; dx: number; dy: number; scale?: number; class?: string }) {
  return <polygon class={`arrowhead ${props.class ?? ""}`} points={arrowPoints(props.at, props.dx, props.dy, props.scale)} />;
}

/** A wire's type, written beside its midpoint. */
function WireLabel(props: { pts: Pt[]; text: string }) {
  const m = () => midway(flattenPath(props.pts, G.radius));
  return (
    <Show when={m()}>
      {(mm) => (
        <text class="wire-type" x={mm().at.x + (Math.abs(mm().dy) > 0.5 ? 6 : 0)} y={mm().at.y + (Math.abs(mm().dy) > 0.5 ? 0 : -6)}>
          {props.text}
        </text>
      )}
    </Show>
  );
}

function Wire(props: {
  ed: NetModel;
  id: WireId;
  plain?: boolean;
  hidden?: boolean;
  highlighted?: boolean;
}) {
  const ed = props.ed;
  const pts = () => ed.layout().routed.wires.get(props.id) ?? [];
  const d = () => roundedPath(pts(), G.radius);
  /** The arrowhead halfway along, pointing from the end that gives to the end that takes. */
  const arrow = () => {
    if (!ed.view().net.wires.has(props.id)) return undefined;
    const flow = wireFlow(ed, props.id);
    if (!flow) return undefined;
    const flat = flattenPath(pts(), G.radius);
    const m = midway(flat);
    if (!m || m.len < 8) return undefined;
    // Paths can run either way between the ends; check which end they start at.
    const start = endPos(ed, ed.view().net.wire(props.id).ends[0]);
    const p0 = flat[0]!;
    const q0 = flat[flat.length - 1]!;
    const forward = !start || Math.hypot(p0.x - start.x, p0.y - start.y) <= Math.hypot(q0.x - start.x, q0.y - start.y);
    const sgn = forward ? flow : -flow;
    return { at: m.at, dx: m.dx * sgn, dy: m.dy * sgn };
  };
  const xray = () => {
    const h = ed.hover();
    return h?.kind === "porttype" && wireType(ed, props.id) === h.name;
  };
  const sel = () => {
    const s = ed.selection();
    return s?.kind === "wire" && s.id === props.id;
  };
  const hot = () => {
    const h = ed.hover();
    return h?.kind === "wire" && h.id === props.id;
  };
  return (
    <g
      class="wire"
      classList={{
        active: !props.plain && ed.activeWires().has(props.id),
        stuck: !props.plain && ed.stuckWires().has(props.id),
        selected: sel(),
        hot: hot(),
        highlighted: !!props.highlighted,
        xray: xray(),
        doomed: ed.doomed().has(props.id),
      }}
      style={{ display: props.hidden ? "none" : undefined }}
      data-wire={props.id}
    >
      <path class="halo" d={d()} />
      <path class="mark" d={d()} />
      <path class="line" d={d()} />
      <Show when={arrow()}>{(a) => <Arrowhead {...a()} />}</Show>
      <path class="hit" d={d()} />
    </g>
  );
}

function Agent(props: {
  ed: NetModel;
  system: () => System;
  id: AgentId;
  pre: boolean;
  endState: (e: End) => EndState;
  readonly?: boolean;
}) {
  const ed = props.ed;
  const p = () => ed.layout().placement.get(props.id);
  const agent = () => ed.view().net.agents.get(props.id);
  const type = () => {
    const a = agent();
    return a ? props.system().types.get(a.type) : undefined;
  };
  const arity = () => (agent()?.wires.length ?? 1) - 1;
  const box = () => !!type()?.box;
  const outline = () => {
    const pos = p();
    return pos ? agentOutline(pos, arity(), box()) : undefined;
  };
  const slots = () => Array.from({ length: arity() + 1 }, (_, i) => i);
  const selected = () => ed.isSelected(props.id);
  const hot = () => {
    const h = ed.hover();
    return h?.kind === "agent" && h.id === props.id;
  };

  /** The agent's outline with some class: its body, or the selection ring drawn under it. */
  const shapeEl = (cls: string) => {
    const o = outline()!;
    return o.kind === "circle" ? (
      <circle class={cls} cx={p()!.x} cy={p()!.y} r={o.r} />
    ) : (
      <polygon class={cls} points={o.points.map((q) => `${q.x},${q.y}`).join(" ")} />
    );
  };

  return (
    <Show when={p() && outline()}>
      <g
        class="agent"
        classList={{
          filled: !!type()?.filled,
          box: box(),
          selected: selected(),
          pre: props.pre && !selected(),
          hot: hot(),
          movable: !props.readonly,
        }}
        data-agent={props.id}
      >
        <Show when={selected() || props.pre}>
          {shapeEl("sel-outer")}
          {shapeEl("sel-inner")}
        </Show>
        {shapeEl("body")}
        <Show when={type()?.symbol}>
          <text
            class="symbol"
            x={labelPos(p()!, arity(), box()).x}
            y={labelPos(p()!, arity(), box()).y}
            text-anchor="middle"
            dominant-baseline="central"
          >
            {type()!.symbol}
          </text>
        </Show>
        <For each={slots()}>
          {(slot) => {
            const pos = () => portPos(p()!, arity(), slot);
            const spec = () => ed.specAt(port(props.id, slot));
            const empty = () => ed.view().net.wireAt(port(props.id, slot)) === NONE;
            /**
             * On an empty port with a direction, a little arrow says whether it gives (out) or takes (in).
             * While a wire is dragged it turns accent on ports it could go to and faint on ports it can't.
             */
            const arrow = () => {
              const pol = spec().pol;
              if (!pol || !empty()) return undefined;
              const state = props.endState(port(props.id, slot));
              if (state === "origin" || state === "target" || state === "refuse") return undefined;
              const out = pos().dir === "down" ? 1 : -1;
              const dy = pol === "give" ? out : -out;
              const tone = state === "candidate" ? "ok" : state === "blocked" ? "dim" : "";
              return { at: { x: pos().x, y: pos().y + out * 7.2 }, dx: 0, dy, scale: 0.82, class: `port-arrow ${tone}` };
            };
            const xray = () => {
              const h = ed.hover();
              return h?.kind === "porttype" && spec().type === h.name;
            };
            return (
              <g class="port">
                <Show when={arrow()}>{(a) => <Arrowhead {...a()} />}</Show>
                <Show when={xray()}>
                  <circle class="port-xray" cx={pos().x} cy={pos().y} r={5} />
                </Show>
                <EndMark at={pos()} state={props.endState(port(props.id, slot))} />
                <circle class="hit" data-port={`${props.id}:${slot}`} cx={pos().x} cy={pos().y} r={6.5} />
              </g>
            );
          }}
        </For>
      </g>
    </Show>
  );
}

/** One frame of a change being animated. */
function Animated(props: { frame: Frame; freeLabel?: (name: string) => string }) {
  return (
    <g class="animated" style={{ "pointer-events": "none" }}>
      <Index each={props.frame.wires}>
        {(w) => {
          const d = () => polylinePath(w().pts);
          return (
            <g class="wire" style={{ opacity: w().opacity }}>
              <path class="halo" d={d()} />
              <path class="line" d={d()} />
            </g>
          );
        }}
      </Index>
      <Index each={props.frame.agents}>
        {(a) => {
          const o = () => agentOutline({ x: 0, y: 0, orient: "down" }, a().arity, a().box);
          const deg = () => (a().angle * 180) / Math.PI;
          const label = () => {
            // The label sits at the centroid of the turned triangle, kept upright.
            const sh = shape(a().arity);
            const ly = sh.circle || a().box ? 0 : -sh.h / 6;
            return { x: -Math.sin(a().angle) * ly, y: Math.cos(a().angle) * ly };
          };
          return (
            <g
              class="agent"
              classList={{ filled: a().filled, box: a().box }}
              transform={`translate(${a().x} ${a().y}) scale(${a().scale})`}
              style={{ opacity: a().opacity }}
            >
              <g transform={`rotate(${deg()})`}>
                {(() => {
                  const s = o();
                  return s.kind === "circle" ? (
                    <circle class="body" r={s.r} />
                  ) : (
                    <polygon class="body" points={s.points.map((q) => `${q.x},${q.y}`).join(" ")} />
                  );
                })()}
              </g>
              <Show when={a().symbol}>
                <text class="symbol" x={label().x} y={label().y} text-anchor="middle" dominant-baseline="central">
                  {a().symbol}
                </text>
              </Show>
            </g>
          );
        }}
      </Index>
      <Index each={props.frame.free}>
        {(f) => (
          <text class="free-label" x={f().x} y={f().dir === "up" ? f().y - 7 : f().y + 13} text-anchor="middle">
            {props.freeLabel?.(f().name) ?? f().name}
          </text>
        )}
      </Index>
    </g>
  );
}
