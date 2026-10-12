import { type JSX, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

/**
 * A menu-like panel pinned under (or above) the element that opened it.
 * It floats over everything, so it isn't clipped by a scrolling sheet, and
 * closes on a click outside, Escape, or scrolling.
 */
export function Popover(props: { anchor: HTMLElement; onClose: () => void; class?: string; children: JSX.Element }) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal<{ left?: number; right?: number; top?: number; bottom?: number }>();

  const place = () => {
    const r = props.anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // Near the right edge, line the popover up with the anchor's right side instead.
    const x = r.left + 320 > window.innerWidth ? { right: Math.max(8, window.innerWidth - r.right) } : { left: r.left };
    setPos(below < 260 && r.top > below ? { ...x, bottom: window.innerHeight - r.top + 6 } : { ...x, top: r.bottom + 6 });
  };

  onMount(() => {
    place();
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!el.contains(t) && !props.anchor.contains(t)) props.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        props.onClose();
      }
    };
    const scroll = (e: Event) => !el.contains(e.target as Node) && props.onClose();
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, { capture: true });
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", props.onClose);
    onCleanup(() => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, { capture: true });
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", props.onClose);
    });
  });

  return (
    <Portal>
      <Show when={pos()}>
        {(p) => (
          <div
            ref={el}
            class={`menu popover ${props.class ?? ""}`}
            role="menu"
            style={{
              left: p().left !== undefined ? `${p().left}px` : undefined,
              right: p().right !== undefined ? `${p().right}px` : undefined,
              top: p().top !== undefined ? `${p().top}px` : undefined,
              bottom: p().bottom !== undefined ? `${p().bottom}px` : undefined,
            }}
          >
            {props.children}
          </div>
        )}
      </Show>
    </Portal>
  );
}
