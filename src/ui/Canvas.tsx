import { For, Index, Show, createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import type { Frame } from "../anim/morph";
import type { GroupId } from "../core/groups";
import { type AgentId, type End, NONE, type WireId, free, port } from "../core/net";
import type { System } from "../core/system";
import { type Box, G, type Pt, boxOf, portPos, shape } from "../layout/geometry";
import { polylinePath, roundedPath } from "../render/path";
import { agentOutline, labelPos } from "../render/svg";
import type { NetModel } from "../state/model";

type Drag =
  | { kind: "pan"; start: Pt; origin: Pt; moved: boolean }
  | { kind: "marquee"; start: Pt; cur: Pt }
  | { kind: "wire"; from: End; fromPt: Pt; cur: Pt; dock?: "top" | "bottom" }
  | { kind: "move"; ids: AgentId[]; groups: GroupId[]; last: Pt; moved: boolean }
  | { kind: "click-wire"; id: WireId; shift: boolean; start: Pt };

const DOCK = 44;

export interface CanvasProps {
  m: NetModel;
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
  class?: string;
}

export function Canvas(props: CanvasProps) {
  const ed = props.m;
  const sys = () => ed.view().sys;
  let svg!: SVGSVGElement;
  const [view, setView] = createSignal({ x: 0, y: 0, k: 1.5 });
  const [drag, setDrag] = createSignal<Drag>();
  const [size, setSize] = createSignal({ w: 800, h: 600 });

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.getBoundingClientRect();
    const v = view();
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  };

  const tooBig = () => ed.view().net.agents.size > (props.limit ?? Infinity);

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
    const bw = Math.max(b.x1 - b.x0, 60);
    const bh = Math.max(b.y1 - b.y0, 60);
    const topBar = 56;
    const k = Math.min((w - 80) / bw, (h - topBar - 60) / bh, 2.4);
    setView({ k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: topBar + (h - topBar) / 2 - ((b.y0 + b.y1) / 2) * k });
  };

  onMount(() => {
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(svg);
    const r = svg.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    fit();
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
        const sx0 = b.x0 * v.k + v.x;
        const sx1 = b.x1 * v.k + v.x;
        const sy0 = b.y0 * v.k + v.y;
        const sy1 = b.y1 * v.k + v.y;
        if (sx0 < 0 || sy0 < 48 || sx1 > w || sy1 > h - 30) fit();
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

  const endPoint = (e: End): Pt | undefined => {
    const l = ed.layout();
    if (e.kind === "free") return l.routed.free.get(e.name);
    const p = l.placement.get(e.agent);
    if (!p) return undefined;
    return portPos(p, ed.view().net.agent(e.agent).wires.length - 1, e.slot);
  };

  const dockAt = (e: PointerEvent): "top" | "bottom" | undefined => {
    const r = svg.getBoundingClientRect();
    if (e.clientY - r.top < DOCK) return "top";
    if (r.bottom - e.clientY < DOCK) return "bottom";
    return undefined;
  };

  /** Start dragging the selection in manual mode. */
  const startMove = (w: Pt) => {
    if (ed.mode() !== "manual") return;
    const s = ed.selection();
    if (s?.kind !== "items") return;
    ed.checkpoint();
    setDrag({ kind: "move", ids: [...s.agents], groups: [...s.groups], last: w, moved: false });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || props.readonly) return;
    const target = e.target as Element;
    const w = toWorld(e);
    const end = endAt(target);
    svg.setPointerCapture(e.pointerId);
    if (end) {
      const from = endPoint(end) ?? w;
      setDrag({ kind: "wire", from: end, fromPt: from, cur: w });
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
      setDrag({ kind: "click-wire", id: Number(wireEl.getAttribute("data-wire")), shift: e.shiftKey, start: w });
      return;
    }
    const armed = ed.armed();
    if (armed) {
      ed.addAgent(armed, w);
      if (!e.shiftKey) ed.setArmed(undefined);
      return;
    }
    if (e.shiftKey) return setDrag({ kind: "marquee", start: w, cur: w });
    const v = view();
    setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, origin: { x: v.x, y: v.y }, moved: false });
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    if (d.kind === "pan") {
      const dx = e.clientX - d.start.x;
      const dy = e.clientY - d.start.y;
      setView((v) => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy }));
      if (!d.moved && Math.hypot(dx, dy) > 3) setDrag({ ...d, moved: true });
    } else if (d.kind === "marquee") {
      setDrag({ ...d, cur: toWorld(e) });
    } else if (d.kind === "wire") {
      setDrag({ ...d, cur: toWorld(e), dock: dockAt(e) });
    } else if (d.kind === "move") {
      const w = toWorld(e);
      const dx = w.x - d.last.x;
      const dy = w.y - d.last.y;
      for (const id of d.ids) {
        const p = ed.positions.get(id);
        if (p) ed.positions.set(id, { ...p, x: p.x + dx, y: p.y + dy });
      }
      for (const g of d.groups) ed.moveGroup(g, dx, dy);
      ed.bump();
      setDrag({ ...d, last: w, moved: true });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag();
    setDrag(undefined);
    if (!d) return;
    if (d.kind === "pan" && !d.moved) ed.setSelection(undefined);
    if (d.kind === "marquee") {
      const x0 = Math.min(d.start.x, d.cur.x);
      const x1 = Math.max(d.start.x, d.cur.x);
      const y0 = Math.min(d.start.y, d.cur.y);
      const y1 = Math.max(d.start.y, d.cur.y);
      const inside = [...ed.layout().placement]
        .filter(([, p]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
        .map(([id]) => id);
      ed.pickMany(inside, true);
    }
    if (d.kind === "wire") {
      const target = endAt(document.elementFromPoint(e.clientX, e.clientY));
      if (target) ed.connect(d.from, target);
      else if (d.dock && d.from.kind === "port" && !ed.fixedInterface) ed.makeFree(d.from);
    }
    if (d.kind === "click-wire") {
      const active = ed.activeWires().has(d.id);
      if (active && !d.shift && props.onFire) props.onFire(d.id);
      else if (ed.stuckWires().has(d.id) && !d.shift && props.onStuck) props.onStuck(d.id);
      else ed.setSelection({ kind: "wire", id: d.id });
    }
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
    if (e.ctrlKey || e.metaKey) {
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(8, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  const groupSelected = (g: GroupId) => {
    const s = ed.selection();
    return s?.kind === "items" && s.groups.has(g);
  };

  return (
    <div class={`stage ${props.class ?? ""}`} style={{ height: "100%" }}>
      <svg
        ref={svg}
        class="canvas"
        classList={{ panning: drag()?.kind === "pan" && (drag() as { moved: boolean }).moved, armed: !!ed.armed() }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDblClick={onDblClick}
        onWheel={onWheel}
        role="application"
        aria-label="Net canvas"
      >
        <g transform={`translate(${view().x} ${view().y}) scale(${view().k})`}>
          <Show when={ed.frame()}>{(f) => <Animated frame={f()} system={sys} freeLabel={props.freeLabel} />}</Show>
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
            <For each={wireIds()}>{(id) => <Wire ed={ed} id={id} plain={props.readonly} />}</For>
            <For each={agentIds()}>{(id) => <Agent ed={ed} system={sys} id={id} />}</For>
            <For each={freeNames()}>
              {(name) => {
                const pt = () => ed.layout().routed.free.get(name);
                return (
                  <Show when={pt()}>
                    {(p) => (
                      <g>
                        <circle
                          class="free-end"
                          classList={{ open: (ed.rev(), ed.net.free.get(name) === NONE) }}
                          data-free={name}
                          cx={p().x}
                          cy={p().y}
                          r={6}
                        />
                        <text
                          class="free-label"
                          x={p().x}
                          y={p().dir === "up" ? p().y - 5 : p().y + 12}
                          text-anchor="middle"
                        >
                          {props.freeLabel?.(name) ?? name}
                        </text>
                      </g>
                    )}
                  </Show>
                );
              }}
            </For>
          </g>
          <Show when={drag()?.kind === "wire" ? (drag() as Extract<Drag, { kind: "wire" }>) : undefined}>
            {(d) => <path class="drag-line" d={`M${d().fromPt.x} ${d().fromPt.y} L${d().cur.x} ${d().cur.y}`} />}
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
        <div class="hint">
          {ed.view().net.agents.size.toLocaleString()} agents: too many to draw. The counts still update as it runs.
        </div>
      </Show>
      <Show
        when={
          !ed.fixedInterface && drag()?.kind === "wire" && (drag() as Extract<Drag, { kind: "wire" }>).from.kind === "port"
        }
      >
        <div class="dock top" classList={{ hot: (drag() as Extract<Drag, { kind: "wire" }>).dock === "top" }}>
          Drop here to leave it as a free port
        </div>
        <div class="dock bottom" classList={{ hot: (drag() as Extract<Drag, { kind: "wire" }>).dock === "bottom" }}>
          Drop here to leave it as a free port
        </div>
      </Show>
    </div>
  );
}

function Wire(props: { ed: NetModel; id: WireId; plain?: boolean }) {
  const ed = props.ed;
  const d = () => roundedPath(ed.layout().routed.wires.get(props.id) ?? [], G.radius);
  const sel = () => {
    const s = ed.selection();
    return s?.kind === "wire" && s.id === props.id;
  };
  return (
    <g
      class="wire"
      classList={{
        active: !props.plain && ed.activeWires().has(props.id),
        stuck: !props.plain && ed.stuckWires().has(props.id),
        selected: sel(),
      }}
      data-wire={props.id}
    >
      <path class="halo" d={d()} />
      <path class="mark" d={d()} />
      <path class="line" d={d()} />
      <path class="hit" d={d()} />
    </g>
  );
}

function Agent(props: { ed: NetModel; system: () => System; id: AgentId }) {
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

  return (
    <Show when={p() && outline()}>
      <g
        class="agent"
        classList={{ filled: !!type()?.filled, box: box(), selected: ed.isSelected(props.id), movable: ed.mode() === "manual" }}
        data-agent={props.id}
      >
        {(() => {
          const o = outline()!;
          return o.kind === "circle" ? (
            <>
              <circle class="ring" cx={p()!.x} cy={p()!.y} r={o.r + 4} />
              <circle class="body" cx={p()!.x} cy={p()!.y} r={o.r} />
            </>
          ) : (
            <>
              <polygon class="ring" points={grow(o.points, 4)} />
              <polygon class="body" points={o.points.map((q) => `${q.x},${q.y}`).join(" ")} />
            </>
          );
        })()}
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
            const open = () => agent()?.wires[slot] === NONE;
            return (
              <circle
                class="port"
                classList={{ open: open() }}
                data-port={`${props.id}:${slot}`}
                cx={pos().x}
                cy={pos().y}
                r={5}
              />
            );
          }}
        </For>
      </g>
    </Show>
  );
}

/** Push a polygon's points outward from its centroid, for selection rings. */
function grow(points: Pt[], by: number): string {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return points
    .map((p) => {
      const d = Math.hypot(p.x - cx, p.y - cy) || 1;
      const k = (d + by * 1.8) / d;
      return `${cx + (p.x - cx) * k},${cy + (p.y - cy) * k}`;
    })
    .join(" ");
}

/** One frame of a step being animated. */
function Animated(props: { frame: Frame; system: () => System; freeLabel?: (name: string) => string }) {
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
          const type = () => props.system().types.get(a().type);
          const o = () => agentOutline({ x: 0, y: 0, orient: "down" }, a().arity);
          const deg = () => (a().angle * 180) / Math.PI;
          const label = () => {
            // The label sits at the centroid of the turned triangle, kept upright.
            const sh = shape(a().arity);
            const ly = sh.circle ? 0 : -sh.h / 6;
            return { x: -Math.sin(a().angle) * ly, y: Math.cos(a().angle) * ly };
          };
          return (
            <g
              class="agent"
              classList={{ filled: !!type()?.filled }}
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
              <Show when={type()?.symbol}>
                <text class="symbol" x={label().x} y={label().y} text-anchor="middle" dominant-baseline="central">
                  {type()!.symbol}
                </text>
              </Show>
            </g>
          );
        }}
      </Index>
      <Index each={props.frame.free}>
        {(f) => (
          <text class="free-label" x={f().x} y={f().dir === "up" ? f().y - 5 : f().y + 12} text-anchor="middle">
            {props.freeLabel?.(f().name) ?? f().name}
          </text>
        )}
      </Index>
    </g>
  );
}
