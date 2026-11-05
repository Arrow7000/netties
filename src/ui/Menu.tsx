import { type JSX, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { closeOnEscape } from "./dismiss";
import { Chevron } from "./icons";

/**
 * A button that opens a dropdown menu below it. The menu closes on a pick, a
 * click outside, or Escape. Arrow keys move a highlight over its items and Enter
 * picks the highlighted one; in a menu with a search box, Enter with nothing
 * highlighted picks the first, or the current one if nothing's been typed.
 */
export function Menu(props: {
  label: JSX.Element;
  title?: string;
  class?: string;
  menuClass?: string;
  /** Leave out the chevron, for a button that is only an icon. */
  bare?: boolean;
  /** The menu's contents; call `close` after acting on a pick. */
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  let button!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;
  let lit: HTMLElement | undefined;
  const light = (row?: HTMLElement) => {
    lit?.classList.remove("lit");
    lit = row;
    row?.classList.add("lit");
    row?.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    // Someone using the keyboard stays with the button rather than being dropped at the top of the page. A click leaves focus alone, for the canvas's shortcuts.
    const on = document.activeElement;
    const back = !!on && !!menu?.contains(on) && on.matches(":focus-visible");
    light();
    setOpen(false);
    if (back) button.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const at = e.target as HTMLElement;
    // Sliders, lists and forms in a menu have their own uses for these keys.
    if (!open() || !menu || at.closest("select, textarea, input[type=range], form")) return;
    const rows = [...menu.querySelectorAll<HTMLElement>(".mi:not(:disabled)")];
    const current = menu.querySelector<HTMLElement>(".mi.current:not(:disabled)") ?? undefined;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      const by = e.key === "ArrowDown" ? 1 : -1;
      const from = rows.indexOf((lit?.isConnected ? lit : current) as HTMLElement);
      light(rows[from < 0 ? (by > 0 ? 0 : rows.length - 1) : (from + by + rows.length) % rows.length]);
    } else if (e.key === "Enter" && (at === button || at.matches("input"))) {
      const typed = at instanceof HTMLInputElement ? at.value.trim() : undefined;
      const row = lit?.isConnected ? lit : typed === undefined ? undefined : typed ? rows[0] : (current ?? rows[0]);
      if (!row) return;
      e.preventDefault();
      row.click();
    }
  };

  onMount(() => {
    const down = (e: PointerEvent) => open() && !root.contains(e.target as Node) && close();
    document.addEventListener("pointerdown", down);
    onCleanup(() => document.removeEventListener("pointerdown", down));
  });
  createEffect(() => open() && closeOnEscape(close, true));

  return (
    <div class="menu-wrap" ref={root} onKeyDown={onKey}>
      <button
        ref={button}
        class={`btn ${props.class ?? ""}`}
        classList={{ open: open() }}
        aria-haspopup="menu"
        aria-expanded={open()}
        title={props.title}
        onClick={() => (open() ? close() : setOpen(true))}
      >
        {props.label}
        <Show when={!props.bare}>
          <Chevron />
        </Show>
      </button>
      <Show when={open()}>
        <div ref={menu} class={`menu ${props.menuClass ?? ""}`} role="menu" onInput={() => light()}>
          {props.children(close)}
        </div>
      </Show>
    </div>
  );
}

/** One item in a menu. */
export function MenuItem(props: {
  onClick: () => void;
  title: JSX.Element;
  note?: JSX.Element;
  danger?: boolean;
  current?: boolean;
  disabled?: boolean;
  lead?: JSX.Element;
}) {
  return (
    <button
      class="mi"
      classList={{ danger: !!props.danger, current: !!props.current }}
      role="menuitem"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Show when={props.lead}>
        <span class="mi-lead">{props.lead}</span>
      </Show>
      <span class="mi-text">
        <span>{props.title}</span>
        <Show when={props.note}>
          <span class="mi-note">{props.note}</span>
        </Show>
      </span>
    </button>
  );
}
