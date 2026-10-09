import { type JSX, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Chevron } from "./icons";

/** A button that opens a dropdown menu below it. The menu closes on a pick, a click outside, or Escape. */
export function Menu(props: {
  label: JSX.Element;
  title?: string;
  class?: string;
  /** The menu's contents; call `close` after acting on a pick. */
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const close = () => setOpen(false);

  onMount(() => {
    const down = (e: PointerEvent) => open() && !root.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => open() && e.key === "Escape" && close();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    onCleanup(() => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    });
  });

  return (
    <div class="menu-wrap" ref={root}>
      <button
        class={`btn ${props.class ?? ""}`}
        classList={{ open: open() }}
        aria-haspopup="menu"
        aria-expanded={open()}
        title={props.title}
        onClick={() => setOpen(!open())}
      >
        {props.label}
        <Chevron />
      </button>
      <Show when={open()}>
        <div class="menu" role="menu">
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
