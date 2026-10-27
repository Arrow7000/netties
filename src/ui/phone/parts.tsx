import { For, type JSX, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { closeOnEscape } from "../dismiss";
import { ComponentGlyph, Glyph, dirsOf } from "../Glyph";
import * as I from "../icons";
import type { Info } from "../Panels";
import type { Action, Choice } from "./focus";
import type { Phone, TileWhat } from "./kit";
import type { RunButton } from "./transport";

/** The tile being carried, drawn above the finger. */
export function Ghost(props: { kit: Phone }) {
  const kit = props.kit;
  const ed = kit.ed;
  return (
    <Show when={kit.carry()}>
      {(c) => (
        <Portal>
          <div class="drag-ghost lifted" classList={{ off: !c().over }} style={{ left: `${c().x}px`, top: `${c().y}px` }}>
            {(() => {
              const w = c().what;
              if (w.kind === "type") {
                const t = ed.system.types.get(w.id);
                return t ? <Glyph type={t} stub={kit.ghostStub} dirs={dirsOf(ed.system, t)} /> : null;
              }
              const d = ed.defs().get(w.id);
              return d ? <ComponentGlyph def={d} /> : null;
            })()}
          </div>
        </Portal>
      )}
    </Show>
  );
}

/** A tile in the sheet: tap to select it, drag it out (or hold it) to carry one onto the canvas. */
export function Tile(props: { kit: Phone; what: TileWhat; axis: "x" | "y"; onLift: (on: boolean) => void }) {
  const kit = props.kit;
  const ed = kit.ed;
  const t = () => (props.what.kind === "type" ? (ed.rev(), ed.system.types.get(props.what.id)) : undefined);
  const d = () => (props.what.kind === "component" ? ed.defs().get(props.what.id) : undefined);
  const picked = () => {
    const s = kit.tile();
    return s?.kind === props.what.kind && s.id === props.what.id;
  };
  const keepFinger = (el: HTMLElement) => {
    const hold = (e: TouchEvent) => kit.tileOut() && e.preventDefault();
    el.addEventListener("touchmove", hold, { passive: false });
    onCleanup(() => el.removeEventListener("touchmove", hold));
  };
  return (
    <button
      ref={keepFinger}
      class="tile sheet-tile"
      classList={{ component: props.what.kind === "component", picked: picked(), [`along-${props.axis}`]: true }}
      aria-pressed={picked()}
      onPointerDown={kit.pressTile(props.what, { axis: props.axis, onLift: props.onLift })}
      // Keyboards still click.
      onClick={(e) => e.detail === 0 && kit.setTile(picked() ? undefined : props.what)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${t()?.name ?? d()?.name}: drag onto the canvas to add one, tap to edit`}
    >
      <Show when={t()} fallback={<Show when={d()}>{(dd) => <ComponentGlyph def={dd()} />}</Show>}>
        {(tt) => <Glyph type={tt()} stub={7} dirs={(ed.rev(), dirsOf(ed.system, tt()))} />}
      </Show>
      <span class="tile-name">{t()?.name ?? d()?.name}</span>
    </button>
  );
}

/** Every agent type and component as tiles, in order. */
export function tileList(kit: Phone): { types: TileWhat[]; components: TileWhat[] } {
  const ed = kit.ed;
  ed.rev();
  return {
    types: [...ed.system.types.values()].map((t) => ({ kind: "type" as const, id: t.id })),
    components: [...ed.defs().values()].map((d) => ({ kind: "component" as const, id: d.id })),
  };
}

/**
 * Under the tiles: what a tile does, or, with one selected, its name and a
 * button to edit it.
 */
export function TileHint(props: { kit: Phone; of: "type" | "component" }) {
  const kit = props.kit;
  const ed = kit.ed;
  const picked = () => {
    const w = kit.tile();
    return w?.kind === props.of ? w : undefined;
  };
  return (
    <Show
      when={picked()}
      fallback={
        <p class="palette-hint sheet-hint">
          {props.of === "type"
            ? "Drag a tile onto the canvas to add one, or onto a port to plug it in. Tap it to edit."
            : "Drag one onto the canvas to add it. Tap it to edit."}
        </p>
      }
    >
      {(w) => {
        const t = () => (ed.rev(), ed.system.types.get(w().id));
        const d = () => ed.defs().get(w().id);
        return (
          <div class="sheet-hint picked">
            <span class="sheet-hint-name">
              <Show when={t()} fallback={d()?.name}>
                {(tt) => (
                  <>
                    <i class="sym">{tt().symbol}</i> {tt().name}
                  </>
                )}
              </Show>
            </span>
            <button class="btn small outline" onClick={() => kit.openTile(w())}>
              <I.Pencil />
              {w().kind === "type" ? "Edit" : "Edit component"}
            </button>
          </div>
        );
      }}
    </Show>
  );
}

/**
 * Step, Step all and Run, and Reset example when it applies. A quick tap
 * fires; a hold arms the button (./transport.ts), and a tap on it then fires.
 */
export function RunButtons(props: { kit: Phone }) {
  const kit = props.kit;
  const ed = kit.ed;
  const active = () => ed.model.activeWires().size;
  const press = (button: RunButton) => ({
    "data-run": button,
    "aria-pressed": kit.armedRun() === button,
    onPointerDown: (e: PointerEvent) => {
      const b = e.currentTarget as HTMLButtonElement;
      if (b.disabled || e.button !== 0) return;
      b.setPointerCapture(e.pointerId);
      kit.sendTransport({ kind: "down", button, pointer: e.pointerId, holdable: !(button === "run" && ed.running()) });
    },
    onPointerMove: (e: PointerEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const slack = 24;
      const inside = e.clientX > r.left - slack && e.clientX < r.right + slack && e.clientY > r.top - slack && e.clientY < r.bottom + slack;
      kit.sendTransport({ kind: "slide", pointer: e.pointerId, inside });
    },
    onPointerUp: (e: PointerEvent) => kit.sendTransport({ kind: "up", pointer: e.pointerId }),
    onPointerCancel: (e: PointerEvent) => kit.sendTransport({ kind: "cancel", pointer: e.pointerId }),
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    // Keyboards still click.
    onClick: (e: MouseEvent) => e.detail === 0 && ed.dispatch({ kind: button === "step" ? "run/step-one" : button === "all" ? "run/step-all" : "run/toggle" }),
  });
  return (
    <div class="sheet-transport">
      <button class="btn outline icon" {...press("step")} disabled={!active() || ed.running()} aria-label="Step: fire one active pair. Hold to see which first.">
        <I.Step />
      </button>
      <button class="btn outline icon" {...press("all")} disabled={!active() || ed.running()} aria-label="Step all: fire every active pair at once. Hold to see them first.">
        <I.StepAll />
      </button>
      <button class="btn run" classList={{ stop: ed.running() }} {...press("run")} disabled={!active() && !ed.running()}>
        <Show when={ed.running()} fallback={<I.Play />}>
          <I.Stop />
        </Show>
        {ed.running() ? "Stop" : "Run"}
      </button>
      <Show when={ed.canResetExample()}>
        <button class="btn outline icon" onClick={ed.resetExample} aria-label="Reset example: restore its starting net. You can undo this.">
          <I.Reset />
        </button>
      </Show>
    </div>
  );
}

/** An action as a button: an icon over a short label. A greyed-out one says why when tapped. */
export function ActionButton(props: { a: Action; say: (a: Action) => () => void; onChoices?: (a: Action) => void }) {
  return (
    <button
      class="sheet-act"
      classList={{ primary: !!props.a.primary, danger: !!props.a.danger }}
      aria-disabled={!!props.a.why}
      aria-label={props.a.label}
      onClick={() => (props.a.choices && !props.a.why ? props.onChoices?.(props.a) : props.say(props.a)())}
    >
      {props.a.icon()}
      <span>{props.a.short ?? props.a.label}</span>
    </button>
  );
}

/** What the Selection face says about what it holds, and what can be done with it, as buttons. */
export function FocusInfo(props: {
  label: string;
  info: Info;
  actions: Action[];
  say: (a: Action) => () => void;
  onChoices: (a: Action) => void;
  ref?: (el: HTMLDivElement) => void;
  class?: string;
}) {
  return (
    <div class={`sheet-focus ${props.class ?? ""}`} ref={props.ref}>
      <div class="sheet-kind">{props.label}</div>
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
      <Show when={props.actions.length}>
        <div class="sheet-acts">
          <For each={props.actions}>{(a) => <ActionButton a={a} say={props.say} onChoices={props.onChoices} />}</For>
        </div>
      </Show>
    </div>
  );
}

/**
 * A list that slides up from the bottom over everything, as phones do for
 * "more" and for picking one of several: a tap on an item or outside closes it.
 */
export function ActionSheet(props: {
  title?: JSX.Element;
  items: (Action | Choice)[];
  say?: (a: Action) => () => void;
  onChoices?: (a: Action) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = createSignal(false);
  onMount(() => requestAnimationFrame(() => setShown(true)));
  closeOnEscape(props.onClose);
  const close = () => {
    setShown(false);
    setTimeout(props.onClose, 180);
  };
  return (
    <Portal>
      <div class="action-sheet-scrim" classList={{ on: shown() }} onClick={close} />
      <div class="action-sheet island phone-chrome" classList={{ on: shown() }} role="menu">
        <Show when={props.title}>
          <div class="action-sheet-title">{props.title}</div>
        </Show>
        <div class="action-sheet-list">
          <For each={props.items}>
            {(it) => {
              const a = "id" in it ? it : undefined;
              const c = "id" in it ? undefined : (it as Choice);
              return (
                <button
                  class="action-sheet-item"
                  classList={{ danger: !!a?.danger }}
                  aria-disabled={!!a?.why || !!c?.disabled}
                  onClick={() => {
                    if (a) {
                      if (a.choices && !a.why) return props.onChoices?.(a);
                      props.say?.(a)();
                      return close();
                    }
                    if (c && !c.disabled) {
                      c.run();
                      close();
                    }
                  }}
                >
                  <span class="action-sheet-lead">{a ? a.icon() : c?.lead}</span>
                  <span class="action-sheet-text">
                    <span>{a ? a.label : c?.label}</span>
                    <Show when={a?.why ?? c?.note}>
                      <span class="action-sheet-note">{a?.why ?? c?.note}</span>
                    </Show>
                  </span>
                  <Show when={a?.choices && !a.why}>
                    <I.Right />
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
        <button class="btn action-sheet-cancel" onClick={close}>
          Cancel
        </button>
      </div>
    </Portal>
  );
}

/** "More" and its pick-one lists, as action sheets, one at a time. */
export function createSheets(say: (a: Action) => () => void) {
  const [open, setOpen] = createSignal<{ title?: JSX.Element; items: (Action | Choice)[] }>();
  const choices = (a: Action) => setOpen({ title: a.label, items: a.choices?.() ?? [] });
  /** The actions that didn't fit, as a list. */
  const more = (title: JSX.Element, items: Action[]) => setOpen({ title, items });
  const view = () => (
    <Show when={open()} keyed>
      {(o) => <ActionSheet title={o.title} items={o.items} say={say} onChoices={choices} onClose={() => setOpen(undefined)} />}
    </Show>
  );
  return { choices, more, view };
}

/**
 * A finger held on empty canvas and lifted: paste there, or select
 * everything. On the net, or in a rule's result (./rule.tsx).
 */
export function HoldMenu(props: { kit: Pick<Phone, "heldAt" | "setHeldAt" | "canPaste" | "paste">; selectAll: () => void }) {
  const kit = props.kit;
  let el: HTMLDivElement | undefined;
  onMount(() => {
    const away = (e: PointerEvent) => kit.heldAt() && !el?.contains(e.target as Node) && kit.setHeldAt(undefined);
    document.addEventListener("pointerdown", away, true);
    onCleanup(() => document.removeEventListener("pointerdown", away, true));
  });
  return (
    <Show when={kit.heldAt()} keyed>
      {(h) => {
        const x = Math.min(Math.max(h.client.x, 124), innerWidth - 124);
        const below = h.client.y < 150;
        return (
          <div ref={el} class="hold-menu island phone-chrome" classList={{ below }} style={{ left: `${x}px`, top: `${h.client.y}px` }}>
            <button
              class="btn"
              aria-disabled={!kit.canPaste()}
              onClick={() => {
                kit.setHeldAt(undefined);
                kit.paste(h.at);
              }}
            >
              <I.Paste />
              Paste here
            </button>
            <span class="sep" />
            <button
              class="btn"
              onClick={() => {
                kit.setHeldAt(undefined);
                props.selectAll();
              }}
            >
              <I.SelectAll />
              Select all
            </button>
          </div>
        );
      }}
    </Show>
  );
}

/** Naming a component made from the selection, near the top, clear of the keyboard. */
export function MakeDialog(props: { kit: Phone }) {
  const kit = props.kit;
  return (
    <Show when={kit.making()}>
      <Portal>
        <div class="action-sheet-scrim on" onClick={() => kit.setMaking(false)} />
        <form
          class="make-dialog island phone-chrome"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            kit.ed.makeComponent(String(f.get("name") ?? ""), String(f.get("symbol") ?? "").trim() || "C");
            kit.setMaking(false);
          }}
        >
          <div class="make-dialog-title">Make a component</div>
          <p class="make-dialog-note">The selected agents become one reusable piece, with a tile of its own.</p>
          <div class="make-dialog-row">
            <input class="input" name="name" placeholder="Name" required ref={(el) => setTimeout(() => el.focus())} />
            <input class="input short" name="symbol" placeholder="Symbol" maxLength={4} />
          </div>
          <div class="make-dialog-row end">
            <button class="btn outline" type="button" onClick={() => kit.setMaking(false)}>
              Cancel
            </button>
            <button class="btn primary" type="submit">
              Make
            </button>
          </div>
        </form>
      </Portal>
    </Show>
  );
}

/** The directions and types line, as in the palette: one tap opens the sheet. */
export function TypesLine(props: { kit: Phone }) {
  const ed = props.kit.ed;
  const t = () => (ed.rev(), ed.system.typing);
  const word = { off: "off", optional: "optional", required: "required" } as const;
  return (
    <button class="types-line" onClick={ed.openTypes}>
      <I.Types />
      <span>
        Directions <b>{word[t().dirs]}</b> · types <b>{word[t().types]}</b>
      </span>
      <I.Right />
    </button>
  );
}
