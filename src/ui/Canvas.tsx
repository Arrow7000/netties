import { For, Index, type JSX, Show, createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, onMount } from "solid-js";
import type { Frame } from "../anim/morph";
import type { GroupId } from "../core/groups";
import { type AgentId, type End, NONE, type WireId, endKey, free, port, sameEnd } from "../core/net";
import { type System, pairKey } from "../core/system";
import { type Box, G, type Placed, type Pt, type Terminal, boxOf, distanceToSegment, insidePolygon, portPos, segmentHitsBox, shape } from "../layout/geometry";
import type { StepPlan, StepPreview } from "../layout/replace";
import { flattenPath, midway, polylinePath, resample, roundedPath } from "../render/path";
import { STROKE, agentOutline, arrowPoints, labelPos } from "../render/svg";
import type { NetModel, Plug, WireGesture } from "../state/model";
import { onEscapeCancels } from "./escape";
import { type Effect, type Gesture, HOLD, type Hit, type Input, type Msg, type Near, REACH, type View, reach, update, zoomAbout } from "./gesture";
import { held } from "./keys";
import { onThaw } from "./freeze";
import { prefs } from "./prefs";

type Marquee = Extract<Gesture, { kind: "marquee" }>;

export type { View };

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
  let host: Host | undefined;
  const zoomAround = (k: number, cx: number, cy: number) => setView((v) => zoomAbout(v, k, { x: cx, y: cy }));
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
    /** The zoom that would fit the net in view. */
    fitZoom: () => host?.fitZoom() ?? 1,
    /** Centre the net in view at this zoom. */
    fitAt: (k: number) => host?.fitAt(k),
    /** Whether part of the net is out of view (and nothing is being dragged). */
    spills: () => host?.spills() ?? false,
    /** The box the net takes, labels and all, in its own units: what fitting fits. */
    bounds: (): Box | undefined => host?.bounds(),
    /** The world point under a client position, if it's over the canvas. */
    toWorld(clientX: number, clientY: number): Pt | undefined {
      const el = host?.el();
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return undefined;
      const v = view();
      return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    },
    /** Whether a client position is over this canvas itself, not something floating over it. */
    contains(clientX: number, clientY: number): boolean {
      const el = host?.el();
      return !!el && document.elementFromPoint(clientX, clientY)?.closest("svg") === el;
    },
    attach(h: Host) {
      host = h;
    },
  };
}

interface Host {
  fit(): void;
  fitZoom(): number;
  fitAt(k: number): void;
  spills(): boolean;
  bounds(): Box;
  el(): SVGSVGElement;
}

export type Camera = ReturnType<typeof createCamera>;

export interface CanvasProps {
  m: NetModel;
  camera?: Camera;
  /** Called when an active pair's wire is clicked. Without it, active pairs just select. */
  onFire?: (w: WireId) => void;
  /** What firing some active pairs would do, previewed while the pointer is on one. */
  preview?: (ws: WireId[]) => StepPreview;
  /** Active pairs to preview regardless of the pointer. */
  previewing?: () => WireId[] | undefined;
  /** Keep previews in view as well as the net (while running). */
  fitPreviews?: () => boolean;
  /** Called when an active pair with no rule is clicked. */
  onStuck?: (w: WireId) => void;
  /** Display names for free ports. */
  freeLabel?: (name: string) => string;
  /** A free end to light up as if pointed at: the same rule interface end, pointed at in the other half of the rule. */
  twinHover?: () => string | undefined;
  /** Read-only: no selecting, dragging or wiring. */
  readonly?: boolean;
  /** Don't try to draw nets with more agents than this. */
  limit?: number;
  /** Room to leave for floating panels when fitting the net in view. */
  pad?: Pad;
  /** Shown over the canvas while the net is empty. */
  empty?: JSX.Element;
  class?: string;
  /** Fingers as the phone layout has them (see `Ctx.phone`), and what the canvas tells it. */
  phone?: CanvasPhone;
}

/** What the phone layout's chrome and the canvas share. */
export interface CanvasPhone {
  /** The wire started by a tap on an end, waiting for its other end. */
  armed: () => WireGesture | undefined;
  setArmed: (g: WireGesture | undefined) => void;
  /** A finger held on empty canvas and lifted: where, on screen (client pixels), and in the net. */
  onHoldMenu: (client: Pt, at: Pt) => void;
  /** A finger's tap anywhere on the canvas: on nothing (`empty`), or on something. */
  onTap: (empty: boolean) => void;
}

const NO_PAD: Pad = { t: 40, r: 40, b: 40, l: 40 };

type EndState = "none" | "empty" | "hover" | "origin" | "candidate" | "blocked" | "target" | "refuse";

export function Canvas(props: CanvasProps) {
  const ed = props.m;
  const cam = props.camera ?? createCamera();
  const view = cam.view;
  const setView = cam.setView;
  const sys = () => ed.view().sys;
  /**
   * A rule's canvas: its free ports are the rule's interface, drawn weightier
   * than loose ends, and empty ports and ends are marked as needing a wire.
   */
  const iface = () => ed.freePorts.surface === "rule";
  let svg!: SVGSVGElement;
  const [drag, setDrag] = createSignal<Gesture>();
  /** Where the wire being dragged would run, worked out once a frame. */
  const [wirePath, setWirePath] = createSignal<Pt[]>();
  const [size, setSize] = createSignal({ w: 800, h: 600 });
  const [space, setSpace] = createSignal(false);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.getBoundingClientRect();
    const v = view();
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };

  const tooBig = () => ed.view().net.agents.size > (props.limit ?? Infinity);
  const pad = () => props.pad ?? NO_PAD;

  /**
   * The types of a rule's interface ends: once for a row whose ends all
   * carry the same type, to the left of the row, otherwise beside each end.
   */
  const ifaceTypes = createMemo(() => {
    if (!iface() || tooBig()) return [];
    const { routed } = ed.layout();
    const out: { x: number; y: number; text: string; anchor: "start" | "end" }[] = [];
    for (const dir of ["up", "down"] as const) {
      const row = [...routed.free].filter(([, f]) => f.dir === dir).sort((a, b) => a[1].x - b[1].x);
      if (!row.length) continue;
      const types = row.map(([name]) => ed.specAt(free(name)).type);
      const y = row[0]![1].y + (dir === "up" ? -IFACE_LABEL : IFACE_LABEL);
      if (types.every((t) => t && t === types[0])) out.push({ x: row[0]![1].x - 12, y, text: types[0]!, anchor: "end" });
      else row.forEach(([, f], i) => types[i] && out.push({ x: f.x + 10, y, text: types[i]!, anchor: "start" }));
    }
    return out;
  });

  const contentBounds = () => {
    const { routed } = ed.layout();
    const b = { ...routed.bounds };
    // A rule's interface ends carry their names, and types, further out.
    const room = iface() ? 24 : 16;
    for (const f of routed.free.values()) {
      b.y0 = Math.min(b.y0, f.y - room);
      b.y1 = Math.max(b.y1, f.y + room);
    }
    if (iface())
      for (const t of ifaceTypes()) {
        const w = t.text.length * TYPE_CH;
        b.x0 = Math.min(b.x0, t.anchor === "end" ? t.x - w : t.x);
        b.x1 = Math.max(b.x1, t.anchor === "end" ? t.x : t.x + w);
      }
    // While running, what's about to happen counts as part of the net too.
    const pv = props.fitPreviews?.() ? firing()?.preview : undefined;
    if (pv) {
      const boxes = [...[...pv.plans.values()].map((p) => p.frame), ...pv.vanishing];
      for (const st of pv.strokes) for (const q of st.pts) boxes.push({ x0: q.x, y0: q.y, x1: q.x, y1: q.y });
      for (const x of boxes) [b.x0, b.y0, b.x1, b.y1] = [Math.min(b.x0, x.x0), Math.min(b.y0, x.y0), Math.max(b.x1, x.x1), Math.max(b.y1, x.y1)];
    }
    return b;
  };

  let glide = 0;
  onCleanup(() => cancelAnimationFrame(glide));
  const fitZoom = () => {
    const b = contentBounds();
    const { w, h } = size();
    const p = pad();
    return Math.min((w - p.l - p.r) / Math.max(b.x1 - b.x0, 60), (h - p.t - p.b) / Math.max(b.y1 - b.y0, 60), 2.4);
  };

  /** Fit the net in view, straight away or (`smooth`) gliding there, at its own zoom or at `zoom`. */
  const fit = (smooth = false, zoom?: number) => {
    if (tooBig()) return;
    cancelAnimationFrame(glide);
    const b = contentBounds();
    const { w, h } = size();
    const p = pad();
    const k = zoom ?? fitZoom();
    const to = {
      k,
      x: p.l + (w - p.l - p.r) / 2 - ((b.x0 + b.x1) / 2) * k,
      y: p.t + (h - p.t - p.b) / 2 - ((b.y0 + b.y1) / 2) * k,
    };
    if (!smooth || matchMedia("(prefers-reduced-motion: reduce)").matches) return setView(to);
    const from = view();
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 280);
      const e = 1 - Math.pow(1 - t, 3);
      // Zoom geometrically, so the scale changes at an even pace.
      const kk = from.k * Math.pow(to.k / from.k, e);
      // Keep the point that ends up centred moving in a straight line.
      const cx = (w / 2 - from.x) / from.k + ((w / 2 - to.x) / to.k - (w / 2 - from.x) / from.k) * e;
      const cy = (h / 2 - from.y) / from.k + ((h / 2 - to.y) / to.k - (h / 2 - from.y) / from.k) * e;
      setView({ k: kk, x: w / 2 - cx * kk, y: h / 2 - cy * kk });
      if (t < 1) glide = requestAnimationFrame(tick);
    };
    glide = requestAnimationFrame(tick);
  };

  onMount(() => {
    const spills = () => {
      if (drag() || tooBig()) return false;
      const b = contentBounds();
      const v = view();
      const { w, h } = size();
      return b.x0 * v.k + v.x < 0 || b.y0 * v.k + v.y < 0 || b.x1 * v.k + v.x > w || b.y1 * v.k + v.y > h;
    };
    cam.attach({ fit, fitZoom, fitAt: (k) => fit(false, k), spills, bounds: contentBounds, el: () => svg });
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

  // In automatic mode, keep the whole net in view as it changes shape, and
  // while running, the previews of the next step too. A change being
  // animated keeps the camera still until it has settled, so a step's result
  // appears exactly where its preview was.
  createEffect(
    on(
      () => (tooBig() || ed.frame() ? undefined : [ed.layout(), props.fitPreviews?.() && firing()]),
      (l) => {
        if (!l || ed.mode() !== "auto" || drag() || tooBig()) return;
        const b = contentBounds();
        const v = view();
        const { w, h } = size();
        const p = pad();
        const sx0 = b.x0 * v.k + v.x;
        const sx1 = b.x1 * v.k + v.x;
        const sy0 = b.y0 * v.k + v.y;
        const sy1 = b.y1 * v.k + v.y;
        // The phone's sheet covers all of the room it takes, not half.
        const q = props.phone ? 1 : 0.5;
        if (sx0 < p.l * q || sy0 < p.t * q || sx1 > w - p.r * q || sy1 > h - p.b * q) fit(true);
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

  /** What a pointer event is on, for the gesture state machine. */
  const hitAt = (target: Element): Hit => {
    const end = endAt(target);
    if (end) return { kind: "end", end };
    const agentEl = target.closest("[data-agent]");
    if (agentEl) return { kind: "agent", id: Number(agentEl.getAttribute("data-agent")) };
    const collapseEl = target.closest("[data-collapse]");
    if (collapseEl) return { kind: "collapse", group: Number(collapseEl.getAttribute("data-collapse")) };
    const hullEl = target.closest("[data-group]");
    if (hullEl) return { kind: "group", group: Number(hullEl.getAttribute("data-group")) };
    const wireEl = target.closest("[data-wire]");
    if (wireEl) return { kind: "wire", id: Number(wireEl.getAttribute("data-wire")) };
    return { kind: "none" };
  };

  /** Every end drawn on the canvas, and where. */
  const endSpots = createMemo(() => {
    if (tooBig()) return [];
    const l = ed.layout();
    const net = ed.view().net;
    const out: { end: End; at: Pt }[] = [];
    for (const [id, p] of l.placement) {
      if (!net.agents.has(id)) continue;
      const arity = net.agent(id).wires.length - 1;
      for (let slot = 0; slot <= arity; slot++) out.push({ end: port(id, slot), at: portPos(p, arity, slot) });
    }
    for (const [name, at] of l.routed.free) out.push({ end: free(name), at });
    return out;
  });

  /** The ends within `reach` of a point, nearest first, with how far they are. All in the net's units. */
  const endsNear = (at: Pt, reach: number) =>
    endSpots()
      .map((s) => ({ end: s.end, d: Math.hypot(s.at.x - at.x, s.at.y - at.y) }))
      .filter((s) => s.d <= reach)
      .sort((a, b) => a.d - b.d);

  /**
   * What a finger pressed. A finger covers what it presses, and whatever the
   * zoom, it's the same size on screen: so the nearest thing within its
   * reach in screen pixels (`reach` says which), rather than what's exactly
   * under it. Inside an agent, how deep the finger is counts as nearness, so
   * the middle of an agent takes the agent and its edges go to its ports.
   */
  const reachAt = (screen: Pt, target: Element): Hit => {
    // An animation draws no ends to press, and the collapse button is small and exact.
    if (ed.frame() || tooBig() || target.closest("[data-collapse]")) return hitAt(target);
    const v = view();
    const at = { x: (screen.x - v.x) / v.k, y: (screen.y - v.y) / v.k };
    const near: Near = { ends: endsNear(at, REACH.end / v.k).map((c) => ({ end: c.end, d: c.d * v.k })), agents: [], wires: [] };
    const l = ed.layout();
    const net = ed.view().net;
    for (const [id, p] of l.placement) {
      if (!net.agents.has(id)) continue;
      const d = agentDistance(at, agentOutline(p, net.agent(id).wires.length - 1, ed.view().box.has(id)), p) * v.k;
      if (d <= REACH.agent) near.agents.push({ id, d });
    }
    for (const [id, pts] of l.routed.wires) {
      const f = flattenPath(pts, G.radius);
      let d = Infinity;
      for (let i = 1; i < f.length; i++) d = Math.min(d, distanceToSegment(at, f[i - 1]!, f[i]!));
      if (d * v.k <= REACH.wire) near.wires.push({ id, d: d * v.k });
    }
    // Nothing near: a component's outline, or nothing.
    return reach(near, v.k) ?? hitAt(target);
  };

  const ctx = {
    get readonly() {
      return !!props.readonly;
    },
    gestureAt: ed.gestureAt,
    checkDrop: ed.checkDrop,
    isSelected: ed.isSelected,
    clickable: (id: WireId) =>
      ed.activeWires().has(id) && props.onFire ? ("fire" as const) : ed.stuckWires().has(id) && props.onStuck ? ("stuck" as const) : undefined,
    hover: () => ed.hover(),
    near: (at: Pt, reach: number) => endsNear(at, reach).map((c) => c.end),
    view: () => view(),
    lastTap: () => lastTap,
    get phone() {
      return props.phone;
    },
    fixedEnds: !ed.freePorts.scratch,
  };
  /** The last finger's tap on nothing, for telling a double tap. */
  let lastTap: { screen: Pt; time: number } | undefined;

  /** Carry out what the state machine says, given the gesture it was in. */
  const perform = (fx: Effect, was: Gesture | undefined) => {
    switch (fx.kind) {
      case "hover":
        return ed.setHover(fx.hover);
      case "pick":
        return ed.pick(fx.id, fx.additive);
      case "pick-group":
        return ed.pickGroup(fx.group, fx.additive);
      case "collapse":
        return ed.setCollapsed(fx.group, true);
      case "begin-move": {
        const s = ed.selection();
        if (s?.kind === "items") ed.beginMove([...s.agents], [...s.groups]);
        return;
      }
      case "move-by":
        return ed.moveBy(fx.dx, fx.dy);
      case "end-move":
        return ed.endMove();
      case "cancel-move":
        return ed.cancelMove();
      case "view":
        return setView(fx.view);
      case "select-in": {
        const { agents, wires } = marqueed(fx.marquee);
        return ed.pickMany([...agents], wires, fx.marquee.additive);
      }
      case "clear-selection":
        return ed.clearSelection();
      case "finish-wire": {
        const at = was?.kind === "wire" ? was.cur : undefined;
        return ed.finishGesture(fx.g, fx.to, at && { path: wirePath(), at });
      }
      case "return-wire": {
        const at = was?.kind === "wire" ? was.cur : undefined;
        return ed.returnWire(fx.g, at && { path: wirePath(), at });
      }
      case "fire":
        return props.onFire?.(fx.id);
      case "stuck":
        return props.onStuck?.(fx.id);
      case "select-wire":
        return ed.selectWire(fx.id);
      case "await-hold": {
        const id = fx.pointer;
        unhold(id);
        holds.set(id, setTimeout(() => (holds.delete(id), send({ kind: "hold", pointer: id })), HOLD));
        return;
      }
      case "held":
        navigator.vibrate?.(8);
        return setRipple({ ...fx.screen, n: (ripple()?.n ?? 0) + 1 });
      case "hold-menu": {
        const r = svg.getBoundingClientRect();
        return props.phone?.onHoldMenu({ x: fx.screen.x + r.left, y: fx.screen.y + r.top }, fx.at);
      }
      case "arm":
        return props.phone?.setArmed(fx.g);
      case "disarm":
        return props.phone?.setArmed(undefined);
      case "tapped":
        lastTap = fx.empty ? { screen: fx.screen, time: fx.time } : undefined;
        return props.phone?.onTap(fx.empty);
      case "zoom":
        return zoomGlide(fx.by, fx.about);
    }
  };
  /** Where a finger was held, for a moment of feedback. */
  const [ripple, setRipple] = createSignal<Pt & { n: number }>();
  /** Fingers that might be held, and the timers that would say so. */
  const holds = new Map<number, ReturnType<typeof setTimeout>>();
  const unhold = (id: number) => {
    clearTimeout(holds.get(id));
    holds.delete(id);
  };
  onCleanup(() => holds.forEach((t) => clearTimeout(t)));

  /** Zoom by `by` about a point on screen, gliding there quickly. */
  const zoomGlide = (by: number, about: Pt) => {
    cancelAnimationFrame(glide);
    const from = view();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setView(zoomAbout(from, from.k * by, about));
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 200);
      const e = 1 - Math.pow(1 - t, 3);
      setView(zoomAbout(from, from.k * Math.pow(by, e), about));
      if (t < 1) glide = requestAnimationFrame(tick);
    };
    glide = requestAnimationFrame(tick);
  };

  let previewFrame = 0;
  const send = (msg: Msg) => {
    const was = drag();
    const [next, fx] = update(was, msg, ctx);
    if (next !== was) setDrag(next);
    for (const f of fx) perform(f, was);
    if (next?.kind === "wire") {
      // Routing the preview is the costly part: once a frame is enough.
      cancelAnimationFrame(previewFrame);
      previewFrame = requestAnimationFrame(() => {
        const now = drag();
        if (now?.kind !== "wire") return;
        const to = now.check?.kind === "ok" ? now.target : undefined;
        setWirePath(ed.previewWire(now.g, to, now.cur));
      });
    } else if (was?.kind === "wire") {
      cancelAnimationFrame(previewFrame);
      setWirePath(undefined);
    }
  };

  /** Where a pointer is in screen pixels, from the canvas's top left. */
  const onScreen = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** Decided for each gesture, not each device: a tablet can have a trackpad too. */
  const inputOf = (e: PointerEvent): Input => (e.pointerType === "mouse" ? "mouse" : "touch");
  /** Whether the canvas was last pressed by a finger, for wording "tap" rather than "click". */
  const [touched, setTouched] = createSignal(false);

  const onPointerDown = (e: PointerEvent) => {
    svg.setPointerCapture(e.pointerId);
    const input = inputOf(e);
    if (input === "mouse" && (e.button !== 0 || space())) e.preventDefault();
    if (!drag()) setTouched(input === "touch");
    const screen = onScreen(e);
    const target = e.target as Element;
    const hit = input === "touch" ? reachAt(screen, target) : hitAt(target);
    send({ kind: "down", pointer: e.pointerId, input, hit, button: e.button, screen, at: toWorld(e), shift: e.shiftKey, alt: e.altKey, space: space(), time: e.timeStamp });
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag();
    if (!d) {
      // A pen hovering over the canvas hovers what it's over; fingers don't hover.
      if (!e.buttons) ed.setHover(hoverAt(e.target as Element));
      return;
    }
    // Pointer capture sends events to the canvas; look at what's really under the mouse.
    const aiming = (d.kind === "wire" || d.kind === "press") && inputOf(e) === "mouse";
    const over = aiming ? endAt(document.elementFromPoint(e.clientX, e.clientY)) : undefined;
    send({ kind: "move", pointer: e.pointerId, screen: onScreen(e), at: toWorld(e), over });
  };

  /**
   * What a marquee selects. Dragged rightwards it's a window: the view
   * agents inside it, and the wires with both ends inside. Dragged leftwards
   * it's a crossing, as in CAD tools: anything it touches.
   */
  const marqueed = (d: Marquee) => {
    const x0 = Math.min(d.start.x, d.cur.x);
    const x1 = Math.max(d.start.x, d.cur.x);
    const y0 = Math.min(d.start.y, d.cur.y);
    const y1 = Math.max(d.start.y, d.cur.y);
    const within = (p: Pt) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    const l = ed.layout();
    const v = ed.view().net;
    if (crossing(d)) {
      const box = { x0, y0, x1, y1 };
      const corners = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      const touches = (id: AgentId, p: Placed) => {
        const o = agentOutline(p, v.agent(id).wires.length - 1, ed.view().box.has(id));
        if (o.kind === "circle") return Math.hypot(p.x - Math.max(x0, Math.min(x1, p.x)), p.y - Math.max(y0, Math.min(y1, p.y))) <= o.r;
        const q = o.points;
        return q.some((a, i) => segmentHitsBox(a, q[(i + 1) % q.length]!, box)) || insidePolygon(corners[0]!, q);
      };
      const agents = new Set([...l.placement].filter(([id, p]) => v.agents.has(id) && touches(id, p)).map(([id]) => id));
      const wires = [...v.wires.keys()].filter((id) => {
        const f = flattenPath(l.routed.wires.get(id) ?? [], G.radius);
        return f.some((a, i) => i > 0 && segmentHitsBox(f[i - 1]!, a, box));
      });
      return { agents, wires };
    }
    const agents = new Set([...l.placement].filter(([id, p]) => v.agents.has(id) && within(p)).map(([id]) => id));
    // A loose end is inside when the spot it's drawn at is.
    const inside = (e: End) => (e.kind === "port" ? agents.has(e.agent) : !!l.routed.free.get(e.name) && within(l.routed.free.get(e.name)!));
    const wires = [...v.wires.values()].filter((w) => inside(w.ends[0]) && inside(w.ends[1])).map((w) => w.id);
    return { agents, wires };
  };
  /** A marquee dragged leftwards selects whatever it touches. */
  const crossing = (d: Marquee) => d.cur.x < d.start.x;
  const preselected = createMemo(() => {
    const d = drag();
    return d?.kind === "marquee" && d.moved ? marqueed(d) : { agents: new Set<AgentId>(), wires: [] as WireId[] };
  });
  const preselectedWires = createMemo(() => new Set(preselected().wires));

  const onPointerUp = (e: PointerEvent) => {
    unhold(e.pointerId);
    if (!drag()) return;
    send({ kind: "up", pointer: e.pointerId, alt: e.altKey, time: e.timeStamp });
    // The mouse hovers what it's left over. A finger's tap has said what to hover.
    if (inputOf(e) === "mouse" && !drag()) ed.setHover(hoverAt(document.elementFromPoint(e.clientX, e.clientY)));
  };

  /** Drop whatever was being dragged, undoing what it did. Says whether there was anything. */
  const cancel = () => {
    holds.forEach((t) => clearTimeout(t));
    holds.clear();
    if (!drag()) return false;
    send({ kind: "cancel" });
    ed.setHover(undefined);
    return true;
  };

  onCleanup(onEscapeCancels(cancel));
  onCleanup(onThaw(() => {
    cancel();
    setSpace(false);
  }));

  /** Capture prevents Chrome from emitting dblclick, but mousedown still has the click count and original target. */
  const onMouseDown = (e: MouseEvent) => {
    if (props.readonly || e.button !== 0 || e.detail !== 2) return;
    const target = e.target as Element;
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
  /** A loose end being carried: it's drawn at the pointer, not where it was. */
  const carriedFree = () => {
    const d = wireDrag();
    return !iface() && d?.g.kind === "carry" && d.g.moving.kind === "free" ? d.g.moving.name : undefined;
  };
  /**
   * Where a loose end would be if the wire were let go now: at the pointer,
   * unless it's over an end it would plug into. A rule's interface has no
   * loose ends to make, so there the wire's tip is left bare.
   */
  /** The wire of a loose end that the wire being dragged would join, lit up along with it. */
  const joining = () => {
    const d = wireDrag();
    if (d?.check?.kind !== "ok" || !d.check.join || !d.target) return undefined;
    const w = ed.view().net.wireAt(d.target);
    return w === NONE ? undefined : w;
  };

  const tipEnd = () => {
    const d = wireDrag();
    if (!d || iface() || (d.target && d.check?.kind === "ok")) return undefined;
    return { at: d.cur, label: carriedFree() };
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

  /** A new agent carried in from the palette, and the end it would plug into. */
  const placingLink = () => {
    const pl = ed.placing();
    const e = pl?.attach?.end;
    if (!pl?.at || !e) return undefined;
    const from = placingEnds()?.get(endKey(e))?.at;
    return from && placingPath(from, pl.plug ?? { at: pl.at, dir: "down" });
  };
  /** Everywhere the agent being carried in could plug in, lit up from the moment it's picked up. */
  const placingType = createMemo(() => ed.placing()?.type);
  const placingEnds = createMemo(() => {
    const type = placingType();
    if (type === undefined) return undefined;
    ed.rev();
    ed.layout();
    return new Map(ed.attachEnds(type).map((c) => [endKey(c.end), c]));
  });

  /** How a port or free end should look right now. */
  const endState = (e: End): EndState => {
    const target = ed.placing()?.attach?.end;
    if (target && sameEnd(e, target)) return "target";
    const ends = placingEnds();
    if (ends) {
      const c = ends.get(endKey(e));
      if (c) return c.fits ? "candidate" : "blocked";
      return ed.view().net.wireAt(e) === NONE ? "empty" : "none";
    }
    // A wire started by a tap: its end, and where it could go, lit up as while dragging one.
    const tapped = !wireDrag() && props.phone?.armed();
    if (tapped) {
      if (sameEnd(e, tapped.kind === "new" ? tapped.from : tapped.moving)) return "origin";
      const h = ed.hover();
      if (h?.kind === "drag" && h.target && sameEnd(h.target, e) && h.check?.kind === "refuse") return "refuse";
      const open = ed.view().net.wireAt(e) === NONE || (e.kind === "free" && ed.freePorts.scratch);
      if (!open) return "none";
      return ed.checkDrop(tapped, e).kind === "refuse" ? "blocked" : "candidate";
    }
    const d = wireDrag();
    if (d) {
      if (sameEnd(e, d.g.kind === "new" ? d.g.from : d.g.anchor)) return "origin";
      if (d.target && sameEnd(e, d.target)) {
        const k = d.check?.kind;
        return k === "ok" ? "target" : k === "back" ? "empty" : "refuse";
      }
      if (d.g.kind === "carry" && sameEnd(e, d.g.moving)) return "empty";
      const open = ed.view().net.wireAt(e) === NONE || (e.kind === "free" && ed.freePorts.scratch);
      if (!open) return "none";
      // Ports the wire can't go to, because the types don't fit, are greyed out.
      return ed.checkDrop(d.g, e).kind === "refuse" ? "blocked" : "candidate";
    }
    const h = ed.hover();
    if (h?.kind === "port" && sameEnd(h.end, e)) return "hover";
    if (h?.kind === "free" && e.kind === "free" && h.name === e.name) return "hover";
    if (e.kind === "free" && props.twinHover?.() === e.name) return "hover";
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
        if (a.kind !== "port" || b.kind !== "port") return false;
        const ta = v.agent(a.agent).type;
        const tb = v.agent(b.agent).type;
        return pairKey(ta, tb) === k || pairKey(tb, ta) === k;
      }),
    );
  });

  /**
   * Whether a gesture is under way that hides previews. Fingers only moving
   * the view keep them, so a tapped pair's preview can be looked round.
   */
  const busy = () => {
    const d = drag();
    return !!d && d.kind !== "tap" && !(d.kind === "pan" && d.input === "touch");
  };

  /**
   * The active pairs being previewed: whatever the editor asks for (pointing
   * at Step or Parallel step, or a run about to step), or else the pair under the
   * pointer while clicking it would fire it.
   */
  const targets = createMemo(
    (): WireId[] | undefined => {
      if (busy() && drag()!.kind !== "click-wire") return undefined;
      const asked = props.previewing?.();
      if (asked) return asked;
      const h = ed.hover();
      if (held.alt() || !props.onFire || h?.kind !== "wire" || !ed.activeWires().has(h.id)) return undefined;
      return [h.id];
    },
    undefined,
    { equals: (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((w, i) => w === b[i])) },
  );
  /** Cuts the agents of the step being previewed out of the highlights that run on under them. */
  const seeThroughMask = `see-through-${createUniqueId()}`;
  const firing = createMemo(() => {
    const ws = targets();
    if (!ws?.length || !props.preview) return undefined;
    const p = props.preview(ws);
    return { wires: new Set(p.fading), agents: new Set(p.agents), preview: p };
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
        onMouseDown={onMouseDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancel}
        onPointerLeave={(e) => inputOf(e) === "mouse" && !drag() && ed.setHover(undefined)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label="Net canvas"
      >
        <g transform={`translate(${view().x} ${view().y}) scale(${view().k})`}>
          <Show when={ed.frame()}>{(f) => <Animated frame={f()} freeLabel={props.freeLabel} iface={iface()} />}</Show>
          <g style={{ display: ed.frame() ? "none" : undefined }}>
            <For each={hulls()}>
              {(h) => (
                <g class="hull" classList={{ selected: groupSelected(h.id) }} data-group={h.id}>
                  <rect
                    class="hull-hit"
                    x={h.box.x0}
                    y={h.box.y0}
                    width={h.box.x1 - h.box.x0}
                    height={h.box.y1 - h.box.y0}
                    rx={6}
                  />
                  <rect
                    class="hull-line"
                    x={h.box.x0}
                    y={h.box.y0}
                    width={h.box.x1 - h.box.x0}
                    height={h.box.y1 - h.box.y0}
                    rx={6}
                  />
                  <text x={h.box.x0 + 6} y={h.box.y0 - 4}>
                    {h.label}
                  </text>
                  <Show when={!props.readonly}>
                    <g
                      class="hull-collapse"
                      data-collapse={h.id}
                      data-tip="Collapse back into one box"
                      transform={`translate(${h.box.x1 - 12} ${h.box.y0})`}
                    >
                      <rect x={-6} y={-6} width={12} height={12} rx={3} />
                      <path d="M -3 0 H 3" />
                    </g>
                  </Show>
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
                  fading={!!firing()?.wires.has(id)}
                  seeThrough={firing() && { agents: firing()!.agents, mask: seeThroughMask }}
                  joining={joining() === id}
                  pre={preselectedWires().has(id)}
                />
              )}
            </For>
            <Show when={firing()}>{(f) => <SeeThroughMask ed={ed} id={seeThroughMask} agents={f().agents} system={sys} />}</Show>
            {/* Under the agents, like any wire, so it comes out from under the end it starts from. */}
            <Show when={wireDrag()}>
              {(d) => {
                const start = () => dragStart(ed, d().g) ?? d().cur;
                /** The ends the wire would join, which its highlight runs on under. */
                const ends = () => [gestureAnchor(d().g), ...(d().target && d().check?.kind === "ok" ? [d().target!] : [])];
                return (
                  <g class="drag-wire" classList={{ carried: d().g.kind === "carry", joining: joining() !== undefined }}>
                    <Show
                      when={wirePath()}
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
                          <path class="mark" d={roundedPath(tuckUnder(ed, p(), ends()), G.radius)} />
                          <path class="line" d={roundedPath(p(), G.radius)} />
                          <Show when={dragArrow(p())}>{(a) => <Arrowhead {...a()} />}</Show>
                        </>
                      )}
                    </Show>
                  </g>
                );
              }}
            </Show>
            <For each={agentIds()}>
              {(id) => (
                <Agent
                  ed={ed}
                  system={sys}
                  id={id}
                  pre={preselected().agents.has(id)}
                  fading={!!firing()?.agents.has(id)}
                  endState={endState}
                  readonly={props.readonly}
                  need={iface() && !props.readonly}
                />
              )}
            </For>
            <For each={freeNames()}>
              {(name) => {
                const pt = () => ed.layout().routed.free.get(name);
                return (
                  <Show when={pt()}>
                    {(p) =>
                      iface() ? (
                        <IfaceEnd ed={ed} name={name} at={p()} state={endState(free(name))} label={props.freeLabel?.(name) ?? name} />
                      ) : (
                      <g class="free-end" visibility={carriedFree() === name ? "hidden" : undefined}>
                        <EndMark at={p()} state={endState(free(name))} />
                        <circle class="end-dot" cx={p().x} cy={p().y} r={2.4} />
                        <text class="free-label" x={p().x} y={p().dir === "up" ? p().y - 7 : p().y + 13} text-anchor="middle">
                          {props.freeLabel?.(name) ?? name}
                        </text>
                        <circle class="hit" data-free={name} cx={p().x} cy={p().y} r={7} />
                      </g>
                      )
                    }
                  </Show>
                );
              }}
            </For>
            <Show when={iface()}>
              <For each={ifaceTypes()}>
                {(t) => (
                  <text class="iface-type" x={t.x} y={t.y} text-anchor={t.anchor}>
                    {t.text}
                  </text>
                )}
              </For>
            </Show>
            <g class="wire-labels">
              <For each={wireIds()}>
                {(id) => (
                  <Show when={carried() !== id && typeShown(id) && wireType(ed, id)}>
                    {(t) => <WireLabel pts={ed.layout().routed.wires.get(id) ?? []} text={t()} />}
                  </Show>
                )}
              </For>
            </g>
            <StepPreview ed={ed} hidden={busy() || !props.onFire || !!props.preview} />
            <Show when={firing()?.preview}>{(p) => <RulePreview preview={p()} system={sys} />}</Show>
            {/* The phone's sheet says what a tapped pair would do. */}
            <HoverPill ed={ed} hidden={(busy() && drag()!.kind !== "click-wire") || !!props.phone} canFire={!!props.onFire} canOpen={!!props.onStuck} touch={touched()} />
          </g>
          <Show when={wireDrag()}>
            {(d) => (
              <g class="drag-wire">
                <Show when={wirePath() && ed.specAt(gestureAnchor(d().g)).type}>
                  {(t) => <WireLabel pts={wirePath()!} text={t()} />}
                </Show>
                <Show when={tipEnd()}>
                  {(t) => (
                    <g class="free-end">
                      <circle class="end-dot" cx={t().at.x} cy={t().at.y} r={2.4} />
                      <Show when={t().label}>
                        {(name) => (
                          <text class="free-label" x={t().at.x} y={t().at.y + 13} text-anchor="middle">
                            {props.freeLabel?.(name()) ?? name()}
                          </text>
                        )}
                      </Show>
                    </g>
                  )}
                </Show>
              </g>
            )}
          </Show>
          <Show when={placingLink()}>
            {(l) => (
              <g class="drag-wire">
                <path class="line" d={l()} />
              </g>
            )}
          </Show>
          <Show when={drag()?.kind === "marquee" ? (drag() as Marquee) : undefined}>
            {(d) => (
              <rect
                class="marquee"
                classList={{ crossing: crossing(d()) }}
                x={Math.min(d().start.x, d().cur.x)}
                y={Math.min(d().start.y, d().cur.y)}
                width={Math.abs(d().cur.x - d().start.x)}
                height={Math.abs(d().cur.y - d().start.y)}
              />
            )}
          </Show>
        </g>
      </svg>
      <Show when={ripple()} keyed>
        {(r) => <div class="hold-ripple" style={{ left: `${r.x}px`, top: `${r.y}px` }} onAnimationEnd={() => setRipple(undefined)} />}
      </Show>
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

/** How far a point is outside an agent's outline, or, inside it, minus how deep it is. */
function agentDistance(at: Pt, o: ReturnType<typeof agentOutline>, centre: Pt): number {
  if (o.kind === "circle") return Math.hypot(at.x - centre.x, at.y - centre.y) - o.r;
  const q = o.points;
  const edge = Math.min(...q.map((a, i) => distanceToSegment(at, a, q[(i + 1) % q.length]!)));
  return insidePolygon(at, q) ? -edge : edge;
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

/**
 * The wire from the end a new agent would plug into to the port on the
 * carried agent that would plug in. It leaves that port's stub the way the
 * stub points, so when the end is behind the stub, on the far side of the
 * carried agent, it goes round the agent's nearer side instead of through it.
 */
function placingPath(from: Terminal, plug: Omit<Plug, "box"> & { box?: Plug["box"] }): string {
  const p = plug.at;
  const box = plug.box;
  const out = plug.dir === "up" ? -1 : 1;
  if (!box || (from.y - p.y) * out >= 0) {
    const mid = (from.y + p.y) / 2;
    return `M${from.x} ${from.y} C${from.x} ${mid} ${p.x} ${mid} ${p.x} ${p.y}`;
  }
  const lead = Math.max((box.y1 - box.y0) * 0.4, 4);
  const cx = (box.x0 + box.x1) / 2;
  const side = from.x < cx ? box.x0 : box.x1;
  const cy = (box.y0 + box.y1) / 2;
  const back = Math.max(Math.abs(from.y - cy) / 2, lead);
  const fo = from.dir === "up" ? -1 : 1;
  return (
    `M${p.x} ${p.y} C${p.x} ${p.y + out * lead} ${side} ${p.y + out * lead} ${side} ${cy}` +
    ` C${side} ${cy - out * back} ${from.x} ${from.y + fo * back} ${from.x} ${from.y}`
  );
}

/** The mark on a port or free end, showing what it is and what a drop there would do. */
/** How far a rule's interface end's name sits from it, and the width of a type label's letters. */
const IFACE_LABEL = 15;
const TYPE_CH = 5.9;

/**
 * An end of a rule's interface: hollow like a loose end, since it can be
 * empty, but wider and ringed, since it's fixed: it stands for a wire the
 * pair held. Its ring turns red while it still needs a wire, and an empty
 * one shows its direction the way an empty port does.
 */
function IfaceEnd(props: { ed: NetModel; name: string; at: { x: number; y: number; dir: "up" | "down" }; state: EndState; label: string }) {
  const empty = () => (props.ed.rev(), props.ed.net.free.get(props.name) === NONE);
  const out = () => (props.at.dir === "up" ? -1 : 1);
  const arrow = () => {
    const pol = props.ed.specAt(free(props.name)).pol;
    if (!pol || !empty() || props.state === "target" || props.state === "refuse") return undefined;
    // An end that gives sends its wire into the result.
    const into = -out();
    const tone = props.state === "candidate" ? "ok" : props.state === "blocked" ? "dim" : "";
    return { at: { x: props.at.x, y: props.at.y + into * 11 }, dx: 0, dy: pol === "give" ? into : -into, scale: 0.82, class: `port-arrow ${tone}` };
  };
  const c = (cls: string, r: number) => <circle class={cls} cx={props.at.x} cy={props.at.y} r={r} />;
  return (
    <g class="free-end iface-end">
      <circle class="iface-ring" classList={{ need: empty() }} cx={props.at.x} cy={props.at.y} r={6.6} />
      <Show when={props.state === "hover"}>{c("iface-hover", 9.6)}</Show>
      <Show when={props.state === "candidate"}>{c("port-candidate", 9.6)}</Show>
      <Show when={props.state === "blocked"}>{c("port-blocked", 8)}</Show>
      <Show when={props.state === "target"}>{c("port-target", 9.6)}</Show>
      <Show when={props.state === "refuse"}>{c("port-refuse", 9.6)}</Show>
      <Show when={arrow()}>{(a) => <Arrowhead {...a()} />}</Show>
      <circle class="iface-dot" cx={props.at.x} cy={props.at.y} r={3.8} />
      <Show when={props.state === "origin"}>{c("port-origin", 4.6)}</Show>
      <text class="iface-label" x={props.at.x} y={props.at.y + out() * IFACE_LABEL}>
        {props.label}
      </text>
      <circle class="hit" data-free={props.name} cx={props.at.x} cy={props.at.y} r={10} />
    </g>
  );
}

function EndMark(props: { at: Pt; state: EndState }) {
  const c = (cls: string, r: number) => <circle class={cls} cx={props.at.x} cy={props.at.y} r={r} />;
  return (
    <>
      <Show when={props.state === "empty"}>{c("port-empty", 2.6)}</Show>
      <Show when={props.state === "hover"}>{c("port-hover", 5.2)}</Show>
      <Show when={props.state === "origin"}>{c("port-origin", 4.2)}</Show>
      <Show when={props.state === "candidate"}>{c("port-candidate", 6.5)}</Show>
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

/**
 * What firing some active pairs will do: each rule's result framed exactly
 * where firing puts it, and the new stretches of wire, dashed outside the
 * frames, from where they leave the wires already drawn.
 */
function RulePreview(props: { preview: StepPreview; system: () => System }) {
  const plans = () => [...props.preview.plans.values()];
  const frame = (b: Box, empty = false) => (
    <>
      <rect class="frame-halo" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={6} />
      <rect class="frame" classList={{ empty }} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={6} />
    </>
  );
  return (
    <g class="rule-preview">
      <For each={props.preview.vanishing}>{(b) => frame(b, true)}</For>
      <For each={plans()}>{(p) => frame(p.frame)}</For>
      <For each={props.preview.kept}>{(pts) => <path class="kept" d={polylinePath(pts)} />}</For>
      <For each={props.preview.strokes}>{(st) => <path class={st.dashed ? "link" : "inner"} d={polylinePath(st.pts)} />}</For>
      <For each={plans()}>{(plan) => <PlannedAgents plan={plan} system={props.system} />}</For>
    </g>
  );
}

function PlannedAgents(props: { plan: StepPlan; system: () => System }) {
  return (
    <>
      <For each={props.plan.agents}>
        {(p, i) => {
          const type = () => props.system().types.get(props.plan.rule.agents[i()]!);
          const arity = () => type()?.arity ?? 0;
          const box = () => !!type()?.box;
          const o = () => agentOutline(p, arity(), box());
          return (
            <g class="agent" classList={{ filled: !!type()?.filled, box: box() }}>
              {(() => {
                const s = o();
                return s.kind === "circle" ? (
                  <circle class="body" cx={p.x} cy={p.y} r={s.r} />
                ) : (
                  <polygon class="body" points={s.points.map((q) => `${q.x},${q.y}`).join(" ")} />
                );
              })()}
              <Show when={type()?.symbol}>
                <text
                  class="symbol"
                  x={labelPos(p, arity(), box()).x}
                  y={labelPos(p, arity(), box()).y}
                  text-anchor="middle"
                  dominant-baseline="central"
                >
                  {type()!.symbol}
                </text>
              </Show>
            </g>
          );
        }}
      </For>
    </>
  );
}

/** "Click to fire" next to the active pair under the pointer, or "Tap again to fire" beside one a finger tapped. */
function HoverPill(props: { ed: NetModel; hidden: boolean; canFire: boolean; canOpen: boolean; touch: boolean }) {
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
    // A tap has already selected a pair it can't fire or open.
    if (props.touch && !(active ? props.canFire : props.canOpen)) return undefined;
    const text = props.touch
      ? active
        ? "Tap again to fire"
        : "No rule: tap again to write one"
      : alt
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
      {(i) => {
        // Sized to the text as drawn; the estimate only shows for the first frame.
        const [w, setW] = createSignal(0);
        let el!: SVGTextElement;
        createEffect(on(() => i().text, () => setW(el.getComputedTextLength())));
        return (
          <g class={`pill ${i().kind}`} transform={`translate(${i().mid.x + 12} ${i().mid.y})`}>
            <rect x={0} y={-6.5} width={(w() || i().text.length * 3.6) + 12} height={13} rx={6.5} />
            <text ref={el} x={6} y={0.4} dominant-baseline="central">
              {i().text}
            </text>
          </g>
        );
      }}
    </Show>
  );
}

/** How far a wire's highlight runs on under an agent: far enough to cover its width beside the narrowest tip. */
const MARK_TUCK = 9;

/**
 * A wire's points run on under the agents at its ends, for its highlight:
 * drawn with flat ends, an agent's outline then cuts it off cleanly rather
 * than leaving a flat end beside a tip.
 */
function tuckUnder(ed: NetModel, pts: Pt[], ends: readonly End[]): Pt[] {
  if (pts.length < 2) return pts;
  const out = [...pts];
  for (const e of ends) {
    if (e.kind !== "port") continue;
    const pl = ed.layout().placement.get(e.agent);
    if (!pl) continue;
    const at = portPos(pl, ed.view().net.agent(e.agent).wires.length - 1, e.slot);
    const near = (q: Pt) => Math.hypot(q.x - at.x, q.y - at.y) < 0.5;
    const i = near(out[0]!) ? 0 : near(out[out.length - 1]!) ? out.length - 1 : -1;
    if (i < 0) continue;
    // Wires leave ports vertically, so the agent lies the other way.
    const ext = { x: at.x, y: at.y + (at.dir === "down" ? -MARK_TUCK : MARK_TUCK) };
    if (i === 0) out.unshift(ext);
    else out.push(ext);
  }
  return out;
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
  /** Inside the drag selection being drawn. */
  pre?: boolean;
  /** Taken away, or rerouted, by the step being previewed. */
  fading?: boolean;
  /**
   * Agents drawn see-through, and a mask cutting them out: the highlight
   * runs on under them all the same, but masked, so it still looks to go under.
   */
  seeThrough?: { agents: ReadonlySet<AgentId>; mask: string };
  /** A loose end's wire that the wire being dragged would join. */
  joining?: boolean;
}) {
  const ed = props.ed;
  const pts = () => ed.layout().routed.wires.get(props.id) ?? [];
  const d = () => roundedPath(pts(), G.radius);
  const ends = () => (ed.view().net.wires.has(props.id) ? ed.view().net.wire(props.id).ends : []);
  const markD = () => roundedPath(tuckUnder(ed, pts(), ends()), G.radius);
  const masked = () => {
    const st = props.seeThrough;
    return st && ends().some((e) => e.kind === "port" && st.agents.has(e.agent)) ? `url(#${st.mask})` : undefined;
  };
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
    return (s?.kind === "wire" && s.id === props.id) || (s?.kind === "items" && s.wires.has(props.id)) || !!props.pre;
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
        fading: !!props.fading,
        xray: xray(),
        doomed: ed.doomed().has(props.id),
        joining: !!props.joining,
      }}
      style={{ display: props.hidden ? "none" : undefined }}
      data-wire={props.id}
    >
      <path class="halo" d={d()} />
      <path class="mark" d={markD()} mask={masked()} />
      <path class="line" d={d()} />
      <Show when={arrow()}>{(a) => <Arrowhead {...a()} />}</Show>
      <path class="hit" d={d()} />
    </g>
  );
}

/**
 * A mask that hides whatever is drawn under some agents, outline and all, as
 * their own paper would if they weren't see-through.
 */
function SeeThroughMask(props: { ed: NetModel; id: string; agents: ReadonlySet<AgentId>; system: () => System }) {
  const ed = props.ed;
  const far = 1e6;
  return (
    <mask id={props.id} maskUnits="userSpaceOnUse" x={-far} y={-far} width={2 * far} height={2 * far}>
      <rect x={-far} y={-far} width={2 * far} height={2 * far} fill="white" />
      <For each={[...props.agents]}>
        {(id) => {
          const p = () => ed.layout().placement.get(id);
          const a = () => ed.view().net.agents.get(id);
          const outline = () => {
            const pos = p();
            const ag = a();
            return pos && ag ? agentOutline(pos, ag.wires.length - 1, !!props.system().types.get(ag.type)?.box) : undefined;
          };
          return (
            <Show when={outline()}>
              {(o) => {
                const s = o();
                return s.kind === "circle" ? (
                  <circle cx={p()!.x} cy={p()!.y} r={s.r} fill="black" stroke="black" stroke-width={STROKE} />
                ) : (
                  <polygon
                    points={s.points.map((q) => `${q.x},${q.y}`).join(" ")}
                    fill="black"
                    stroke="black"
                    stroke-width={STROKE}
                    stroke-linejoin="round"
                  />
                );
              }}
            </Show>
          );
        }}
      </For>
    </mask>
  );
}

function Agent(props: {
  ed: NetModel;
  system: () => System;
  id: AgentId;
  pre: boolean;
  /** Taken away, or rerouted, by the step being previewed. */
  fading?: boolean;
  endState: (e: End) => EndState;
  readonly?: boolean;
  /** Mark empty ports as needing a wire (in a rule's result). */
  need?: boolean;
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
          fading: !!props.fading,
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
                <Show when={props.need && empty() && props.endState(port(props.id, slot)) === "empty"}>
                  <circle class="port-need" cx={pos().x} cy={pos().y} r={5.4} />
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
function Animated(props: { frame: Frame; freeLabel?: (name: string) => string; iface: boolean }) {
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
        {(f) => {
          const label = () => props.freeLabel?.(f().name) ?? f().name;
          // Drawn as on the canvas, so ends don't change look while things move.
          return props.iface ? (
            <g class="free-end iface-end">
              <circle class="iface-ring" cx={f().x} cy={f().y} r={6.6} />
              <circle class="iface-dot" cx={f().x} cy={f().y} r={3.8} />
              <text class="iface-label" x={f().x} y={f().y + (f().dir === "up" ? -IFACE_LABEL : IFACE_LABEL)}>
                {label()}
              </text>
            </g>
          ) : (
            <g class="free-end">
              <circle class="end-dot" cx={f().x} cy={f().y} r={2.4} />
              <text class="free-label" x={f().x} y={f().dir === "up" ? f().y - 7 : f().y + 13} text-anchor="middle">
                {label()}
              </text>
            </g>
          );
        }}
      </Index>
    </g>
  );
}
