import "./palettes.css";
import { PALETTES, paletteCss, type Theme } from "./palettes";

/**
 * Dev only: a list in the top-left corner that switches the app between the
 * palettes in palettes.ts. The choice is remembered in this browser, and
 * `?palette=nord` picks one from the address. Light and dark still come from
 * the app's own theme menu.
 */
const KEY = "netties:dev-palette";

function stored(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function apply(id: string) {
  if (id) document.documentElement.dataset.palette = id;
  else delete document.documentElement.dataset.palette;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private windows: the choice just isn't remembered.
  }
}

const CURRENT: { light: Theme; dark: Theme } = {
  light: { paper: "#ffffff", chrome: "#ffffff", ink: "#000000", muted: "#697080", accent: "#2d5bff", active: "#f2a20c", stuck: "#d9472b" },
  dark: { paper: "#000000", chrome: "#17181b", ink: "#ffffff", muted: "#9aa1ad", accent: "#7090ff", active: "#ffb321", stuck: "#ff6a4d" },
};

export function mountPalettePicker() {
  const style = document.createElement("style");
  style.textContent = paletteCss();
  document.head.append(style);

  const fromUrl = new URLSearchParams(location.search).get("palette");
  apply(fromUrl ?? stored());

  const dark = matchMedia("(prefers-color-scheme: dark)");
  const showingDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : dark.matches;
  };

  const bar = document.createElement("div");
  bar.className = "dev-palette";
  // Folded to one line on narrow screens, where the list would cover the canvas.
  const fold = document.createElement("button");
  fold.className = "fold";
  bar.classList.toggle("folded", innerWidth < 700);
  fold.onclick = () => bar.classList.toggle("folded");
  bar.append(fold);
  // Colour the interface, or leave it plain to compare.
  const PLAIN = "netties:dev-palette-plain";
  const plainLabel = document.createElement("label");
  plainLabel.className = "ui-colour";
  const box = document.createElement("input");
  box.type = "checkbox";
  const setPlain = (plain: boolean) => {
    if (plain) document.documentElement.dataset.plain = "";
    else delete document.documentElement.dataset.plain;
    box.checked = !plain;
    try {
      localStorage.setItem(PLAIN, plain ? "1" : "");
    } catch {
      // Not remembered.
    }
  };
  let wasPlain = false;
  try {
    wasPlain = localStorage.getItem(PLAIN) === "1";
  } catch {
    // Not remembered.
  }
  setPlain(wasPlain);
  box.onchange = () => setPlain(!box.checked);
  plainLabel.append(box, "Colour the interface");
  bar.append(plainLabel);
  const rows = [{ id: "", name: "Current", after: "pure black and white", ...CURRENT }, ...PALETTES].map((p) => {
    const b = document.createElement("button");
    const label = document.createElement("span");
    label.textContent = p.name;
    const note = document.createElement("small");
    note.textContent = p.after;
    label.append(note);
    const sw = document.createElement("span");
    sw.className = "sw";
    b.append(label, sw);
    b.onclick = () => {
      apply(p.id);
      update();
    };
    bar.append(b);
    return { p, b, sw };
  });

  function update() {
    const on = document.documentElement.dataset.palette ?? "";
    fold.textContent = `Palette: ${rows.find((r) => r.p.id === on)?.p.name ?? "Current"}`;
    const mode = showingDark() ? "dark" : "light";
    for (const { p, b, sw } of rows) {
      b.setAttribute("aria-pressed", String(p.id === on));
      const t = p[mode];
      sw.replaceChildren(
        ...[t.paper, t.ink, t.accent, t.active, t.stuck].map((c) => {
          const i = document.createElement("i");
          i.style.background = c;
          return i;
        }),
      );
    }
  }
  update();
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
  dark.addEventListener("change", update);
  document.body.append(bar);
}
