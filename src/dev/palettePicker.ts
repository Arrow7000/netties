import "./palettes.css";

/**
 * Dev only: a row of buttons in the bottom-left corner that switches the
 * app between the palettes in palettes.css. The choice is remembered in this
 * browser; light and dark still come from the app's own theme button.
 */
const KEY = "netties:dev-palette";
const PALETTES = [
  ["", "Current"],
  ["soft", "Soft"],
  ["dimmed", "Dimmed"],
  ["warm", "Warm"],
  ["one", "One"],
] as const;

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

export function mountPalettePicker() {
  const fromUrl = new URLSearchParams(location.search).get("palette");
  apply(fromUrl ?? stored());
  const bar = document.createElement("div");
  bar.className = "dev-palette";
  const buttons = PALETTES.map(([id, label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      apply(id);
      for (const [other, ob] of buttons) ob.setAttribute("aria-pressed", String(other === id));
    };
    b.setAttribute("aria-pressed", String((document.documentElement.dataset.palette ?? "") === id));
    bar.append(b);
    return [id, b] as const;
  });
  document.body.append(bar);
}
