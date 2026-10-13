import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

/** Wait this long before the first tooltip shows, so sweeping across the UI doesn't flash them. */
const DELAY = 120;
/** Once one has shown, the next one within this long shows at once. */
const WARM = 500;
const GAP = 6;
const EDGE = 8;

/**
 * Near-instant tooltips for everything with a `title`. The browser's own
 * take about a second to appear and can't be sped up, so this takes each
 * `title` over as `data-tip` the first time the pointer reaches it, and
 * draws the tip itself; a title set again later is taken over at once. Elements whose only name was the title keep it as
 * their aria-label.
 */
export function Tooltips() {
  const [tip, setTip] = createSignal<string>();
  const [pos, setPos] = createSignal<{ x: number; y: number; above: boolean }>();
  let el: HTMLDivElement | undefined;
  let current: Element | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHidden = -Infinity;

  const adopt = (t: Element) => {
    const title = t.getAttribute("title");
    if (title === null) return;
    t.removeAttribute("title");
    t.setAttribute("data-tip", title);
    if (!t.hasAttribute("aria-label") && !t.textContent?.trim()) t.setAttribute("aria-label", title);
  };

  const hide = () => {
    clearTimeout(timer);
    if (tip()) lastHidden = performance.now();
    current = undefined;
    setTip(undefined);
    setPos(undefined);
  };

  const show = (t: Element) => {
    const text = t.getAttribute("data-tip");
    if (!text) return hide();
    setTip(text);
    // Place it once it has been measured.
    requestAnimationFrame(() => {
      if (current !== t || !el) return;
      const a = t.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const above = a.bottom + GAP + h > window.innerHeight - EDGE;
      const x = Math.max(EDGE, Math.min(window.innerWidth - EDGE - w, a.left + a.width / 2 - w / 2));
      setPos({ x, y: above ? a.top - GAP - h : a.bottom + GAP, above });
    });
  };

  const enter = (t: Element) => {
    if (t === current) return;
    hide();
    current = t;
    const wait = performance.now() - lastHidden < WARM ? 0 : DELAY;
    timer = setTimeout(() => current === t && show(t), wait);
  };

  const target = (e: Event) => {
    const t = (e.target as Element | null)?.closest?.("[title], [data-tip]");
    if (t) adopt(t);
    return t ?? undefined;
  };

  onMount(() => {
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const t = target(e);
      if (t) enter(t);
      else if (current) hide();
    };
    const out = (e: PointerEvent) => {
      if (current && !current.contains(e.relatedTarget as Node | null)) hide();
    };
    const focus = (e: FocusEvent) => {
      const t = target(e);
      if (t && (e.target as Element).matches(":focus-visible")) enter(t);
    };
    // Components set titles reactively: take a changed one over before the browser can show it.
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target as Element;
        if (!t.hasAttribute("title")) continue;
        adopt(t);
        if (t === current && tip()) show(t);
      }
    });
    watch.observe(document.body, { attributes: true, attributeFilter: ["title"], subtree: true });
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", hide, true);
    window.addEventListener("scroll", hide, true);
    onCleanup(() => {
      clearTimeout(timer);
      watch.disconnect();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", hide, true);
      window.removeEventListener("scroll", hide, true);
    });
  });

  return (
    <Portal>
      <Show when={tip()}>
        {(t) => (
          <div
            ref={el}
            class="tooltip"
            role="tooltip"
            classList={{ placed: !!pos() }}
            style={{ left: `${pos()?.x ?? 0}px`, top: `${pos()?.y ?? 0}px` }}
          >
            {t()}
          </div>
        )}
      </Show>
    </Portal>
  );
}
