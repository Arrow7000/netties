/**
 * Softer palettes to try instead of pure black and white, each in light and
 * dark, after code editors' themes. Dev only: the picker in palettePicker.ts
 * sets data-palette on the root, and the CSS for it is made here.
 *
 * Each theme gives its own colours for an active pair and a stuck one, from
 * the editor's warning and error colours, so they sit in the theme rather
 * than on top of it. The in-between shades (panel greys, lines, the faint
 * text, the soft accent, the canvas dots) are mixed from the given ones, so
 * every palette has the same structure.
 *
 * Each theme also colours the interface around the net from the editor's
 * syntax colours: ports, types and directions each get one, and controls
 * take the accent, and section headings the theme's keyword colour. Agents
 * stay in ink, symbols too.
 * `data-plain` on the root turns that off, to compare.
 */
export type Theme = {
  /** The canvas. */
  paper: string;
  /** Panels and bars. */
  chrome: string;
  /** Agents and wires, and the main text. */
  ink: string;
  muted: string;
  accent: string;
  /** An active pair, and the Run button. */
  active: string;
  /** A stuck pair. */
  stuck: string;
  /**
   * Colours for the interface, as an editor colours code: `agent` (the
   * keyword colour) for section headings; ports, types, directions.
   */
  ui?: { agent: string; port: string; type: string; dir: string };
};

export type Palette = { id: string; name: string; after: string; light: Theme; dark: Theme };

export const PALETTES: Palette[] = [
  {
    id: "soft",
    name: "Soft",
    after: "today's, softened",
    light: { paper: "#fbfbfa", chrome: "#ffffff", ink: "#1d1f23", muted: "#697080", accent: "#2d5bff", active: "#f2a20c", stuck: "#d9472b", ui: { agent: "#7c3aed", port: "#c2410c", type: "#0f766e", dir: "#2d5bff" } },
    dark: { paper: "#111215", chrome: "#1b1d21", ink: "#e4e6ea", muted: "#9aa1ad", accent: "#7090ff", active: "#ffb321", stuck: "#ff6a4d", ui: { agent: "#b392f0", port: "#f0935c", type: "#5cc8b8", dir: "#7090ff" } },
  },
  {
    id: "dimmed",
    name: "Dimmed",
    after: "GitHub",
    light: { paper: "#f6f8fa", chrome: "#ffffff", ink: "#24292f", muted: "#57606a", accent: "#0969da", active: "#d4a72c", stuck: "#cf222e", ui: { agent: "#8250df", port: "#953800", type: "#116329", dir: "#0550ae" } },
    dark: { paper: "#22272e", chrome: "#2d333b", ink: "#cdd9e5", muted: "#8d9aa7", accent: "#539bf5", active: "#daaa3f", stuck: "#e5534b", ui: { agent: "#dcbdfb", port: "#f69d50", type: "#8ddb8c", dir: "#6cb6ff" } },
  },
  {
    id: "warm",
    name: "Warm",
    after: "printed paper",
    light: { paper: "#f6f2e9", chrome: "#fcfaf6", ink: "#2b2824", muted: "#756d60", accent: "#3b5fc7", active: "#e09422", stuck: "#c8442b", ui: { agent: "#9b3f7a", port: "#b0532c", type: "#557a2e", dir: "#3b5fc7" } },
    dark: { paper: "#1d1b18", chrome: "#282521", ink: "#e6dfd1", muted: "#a89f90", accent: "#8ea6f0", active: "#e8a646", stuck: "#e2674c", ui: { agent: "#d38bb8", port: "#e8946a", type: "#a9c27a", dir: "#8ea6f0" } },
  },
  {
    id: "one",
    name: "One",
    after: "Atom",
    light: { paper: "#fafafa", chrome: "#ffffff", ink: "#383a42", muted: "#696c77", accent: "#4078f2", active: "#c18401", stuck: "#e45649", ui: { agent: "#a626a4", port: "#50a14f", type: "#0184bc", dir: "#4078f2" } },
    dark: { paper: "#21252b", chrome: "#282c34", ink: "#d7dae0", muted: "#9da5b4", accent: "#61afef", active: "#e5c07b", stuck: "#e06c75", ui: { agent: "#c678dd", port: "#98c379", type: "#56b6c2", dir: "#61afef" } },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    after: "retro, earthy",
    light: { paper: "#fbf1c7", chrome: "#f9f5d7", ink: "#3c3836", muted: "#7c6f64", accent: "#076678", active: "#d79921", stuck: "#cc241d", ui: { agent: "#8f3f71", port: "#af3a03", type: "#427b58", dir: "#076678" } },
    dark: { paper: "#282828", chrome: "#32302f", ink: "#ebdbb2", muted: "#a89984", accent: "#83a598", active: "#fabd2f", stuck: "#fb4934", ui: { agent: "#d3869b", port: "#fe8019", type: "#8ec07c", dir: "#83a598" } },
  },
  {
    id: "nord",
    name: "Nord",
    after: "arctic blue-grey",
    light: { paper: "#eceff4", chrome: "#f8f9fb", ink: "#2e3440", muted: "#4c566a", accent: "#5e81ac", active: "#d08770", stuck: "#bf616a", ui: { agent: "#8c5f86", port: "#a8644a", type: "#4c8a72", dir: "#5e81ac" } },
    dark: { paper: "#2e3440", chrome: "#3b4252", ink: "#e5e9f0", muted: "#a5adbb", accent: "#88c0d0", active: "#ebcb8b", stuck: "#bf616a", ui: { agent: "#b48ead", port: "#d08770", type: "#a3be8c", dir: "#81a1c1" } },
  },
  {
    id: "solarized",
    name: "Solarized",
    after: "cream and deep teal",
    light: { paper: "#fdf6e3", chrome: "#fffcf4", ink: "#073642", muted: "#657b83", accent: "#268bd2", active: "#b58900", stuck: "#dc322f", ui: { agent: "#6c71c4", port: "#cb4b16", type: "#859900", dir: "#2aa198" } },
    dark: { paper: "#002b36", chrome: "#073642", ink: "#eee8d5", muted: "#93a1a1", accent: "#268bd2", active: "#b58900", stuck: "#dc322f", ui: { agent: "#6c71c4", port: "#cb4b16", type: "#859900", dir: "#2aa198" } },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    after: "Latte and Mocha, pastel",
    light: { paper: "#eff1f5", chrome: "#fbfbfd", ink: "#4c4f69", muted: "#6c6f85", accent: "#8839ef", active: "#fe640b", stuck: "#d20f39", ui: { agent: "#1e66f5", port: "#179299", type: "#df8e1d", dir: "#ea76cb" } },
    dark: { paper: "#1e1e2e", chrome: "#26263a", ink: "#cdd6f4", muted: "#a6adc8", accent: "#cba6f7", active: "#fab387", stuck: "#f38ba8", ui: { agent: "#89b4fa", port: "#94e2d5", type: "#f9e2af", dir: "#f5c2e7" } },
  },
  {
    id: "rose",
    name: "Rosé Pine",
    after: "Dawn and Moon, muted rose",
    light: { paper: "#faf4ed", chrome: "#fffaf3", ink: "#575279", muted: "#797593", accent: "#907aa9", active: "#ea9d34", stuck: "#b4637a", ui: { agent: "#d7827e", port: "#286983", type: "#56949f", dir: "#907aa9" } },
    dark: { paper: "#232136", chrome: "#2a273f", ink: "#e0def4", muted: "#908caa", accent: "#c4a7e7", active: "#f6c177", stuck: "#eb6f92", ui: { agent: "#ea9a97", port: "#3e8fb0", type: "#9ccfd8", dir: "#c4a7e7" } },
  },
  {
    id: "tokyo",
    name: "Tokyo Night",
    after: "Day and Night, indigo",
    light: { paper: "#e1e2e7", chrome: "#eef0f4", ink: "#343b58", muted: "#6172b0", accent: "#2e7de9", active: "#b15c00", stuck: "#f52a65", ui: { agent: "#9854f1", port: "#587539", type: "#007197", dir: "#2e7de9" } },
    dark: { paper: "#1a1b26", chrome: "#222436", ink: "#c0caf5", muted: "#9aa5ce", accent: "#7aa2f7", active: "#e0af68", stuck: "#f7768e", ui: { agent: "#bb9af7", port: "#9ece6a", type: "#7dcfff", dir: "#7aa2f7" } },
  },
  {
    id: "everforest",
    name: "Everforest",
    after: "green, forest",
    light: { paper: "#fdf6e3", chrome: "#fffbef", ink: "#5c6a72", muted: "#829181", accent: "#35a77c", active: "#dfa000", stuck: "#f85552", ui: { agent: "#df69ba", port: "#3a94c5", type: "#8da101", dir: "#35a77c" } },
    dark: { paper: "#2d353b", chrome: "#343f44", ink: "#d3c6aa", muted: "#9da9a0", accent: "#a7c080", active: "#dbbc7f", stuck: "#e67e80", ui: { agent: "#d699b6", port: "#7fbbb3", type: "#83c092", dir: "#a7c080" } },
  },
  {
    id: "dracula",
    name: "Dracula",
    after: "Alucard and Dracula, vampire purple",
    light: { paper: "#f8f4e3", chrome: "#fffbeb", ink: "#1f1f1f", muted: "#6c664b", accent: "#644ac9", active: "#a34d14", stuck: "#cb3a2a", ui: { agent: "#a3144d", port: "#14710a", type: "#036a96", dir: "#644ac9" } },
    dark: { paper: "#282a36", chrome: "#303241", ink: "#f8f8f2", muted: "#8c96c4", accent: "#bd93f9", active: "#ffb86c", stuck: "#ff5555", ui: { agent: "#ff79c6", port: "#50fa7b", type: "#8be9fd", dir: "#bd93f9" } },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    after: "neon on night, and on signal yellow",
    light: { paper: "#f6efc2", chrome: "#fdf9e2", ink: "#1b1530", muted: "#625a80", accent: "#d4007a", active: "#e08a00", stuck: "#e0003c", ui: { agent: "#7a2cf0", port: "#c24e00", type: "#008c9e", dir: "#d4007a" } },
    dark: { paper: "#0f1020", chrome: "#181a33", ink: "#e3f1ff", muted: "#8a8fb8", accent: "#00e5ff", active: "#fcee0a", stuck: "#ff2a6d", ui: { agent: "#ff4ecd", port: "#ff9e3d", type: "#39ff9e", dir: "#00e5ff" } },
  },
  {
    id: "synthwave",
    name: "Synthwave '84",
    after: "outrun sunset; the light one made up",
    light: { paper: "#fbf0f6", chrome: "#fffafc", ink: "#2b1d3d", muted: "#7a6a94", accent: "#0a9ea8", active: "#d98f00", stuck: "#e0284a", ui: { agent: "#d6339f", port: "#d0533f", type: "#1d9a6c", dir: "#0a9ea8" } },
    dark: { paper: "#241b2f", chrome: "#2d2340", ink: "#f4eefa", muted: "#9a90c4", accent: "#36f9f6", active: "#fede5d", stuck: "#fe4450", ui: { agent: "#ff7edb", port: "#f97e72", type: "#72f1b8", dir: "#36f9f6" } },
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    after: "Lotus and Wave, Hokusai's ink",
    light: { paper: "#f2ecbc", chrome: "#f8f3d4", ink: "#545464", muted: "#716e61", accent: "#4d699b", active: "#cc6d00", stuck: "#c84053", ui: { agent: "#624c83", port: "#77713f", type: "#597b75", dir: "#6693bf" } },
    dark: { paper: "#1f1f28", chrome: "#2a2a37", ink: "#dcd7ba", muted: "#9d9a8a", accent: "#7e9cd8", active: "#ffa066", stuck: "#ff5d62", ui: { agent: "#957fb8", port: "#e6c384", type: "#7aa89f", dir: "#7fb4ca" } },
  },
  {
    id: "monokai",
    name: "Monokai Pro",
    after: "warm charcoal, bright fruit",
    light: { paper: "#f3ebe8", chrome: "#faf4f2", ink: "#29242a", muted: "#7e787a", accent: "#1c8ca8", active: "#cc7a0a", stuck: "#e14775", ui: { agent: "#7058be", port: "#e16032", type: "#269d69", dir: "#1c8ca8" } },
    dark: { paper: "#2d2a2e", chrome: "#363337", ink: "#fcfcfa", muted: "#a09fa0", accent: "#78dce8", active: "#ffd866", stuck: "#ff6188", ui: { agent: "#ab9df2", port: "#fc9867", type: "#a9dc76", dir: "#78dce8" } },
  },
  {
    id: "owl",
    name: "Night Owl",
    after: "Light Owl and Night Owl, deep sea blue",
    light: { paper: "#f0f0f0", chrome: "#fbfbfb", ink: "#403f53", muted: "#6f7380", accent: "#4876d6", active: "#c99400", stuck: "#de3d3b", ui: { agent: "#994cc3", port: "#aa0982", type: "#0c969b", dir: "#4876d6" } },
    dark: { paper: "#011627", chrome: "#0b2942", ink: "#d6deeb", muted: "#8b9fb3", accent: "#82aaff", active: "#ffcb8b", stuck: "#ef5350", ui: { agent: "#c792ea", port: "#f78c6c", type: "#7fdbca", dir: "#82aaff" } },
  },
];

/** Relative luminance, for picking dark or light text on a colour. */
function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

function tokens(t: Theme) {
  return `
  --paper: ${t.paper};
  --ink: ${t.ink};
  --text: ${t.ink};
  --chrome: ${t.chrome};
  --chrome-2: ${mix(t.ink, 6, t.chrome)};
  --chrome-3: ${mix(t.ink, 10, t.chrome)};
  --line: ${mix(t.ink, 12, t.chrome)};
  --line-2: ${mix(t.ink, 22, t.chrome)};
  --muted: ${t.muted};
  --faint: ${mix(t.muted, 62, t.chrome)};
  --accent: ${t.accent};
  --accent-soft: ${mix(t.accent, 16, t.chrome)};
  --active: ${t.active};
  --on-active: ${luminance(t.active) > 0.3 ? mix(t.active, 15, "#000") : "#ffffff"};
  --stuck: ${t.stuck};
  --dot: ${mix(t.ink, 11, "transparent")};`;
}

function roles(t: Theme) {
  const u = t.ui;
  if (!u) return "";
  return `
  --c-port: ${u.port};
  --c-port-name: ${mix(u.port, 75, t.muted)};
  --c-port-edge: ${mix(u.port, 45, t.chrome)};
  --c-type: ${u.type};
  --c-type-bg: ${mix(u.type, 16, t.chrome)};
  --c-dir: ${u.dir};
  --c-outline: ${mix(t.accent, 45, t.chrome)};
  --c-outline-text: ${t.accent};
  --c-heading: ${mix(u.agent, 80, t.ink)};
  --c-pressed: ${t.accent};
  --c-pressed-bg: ${mix(t.accent, 20, t.chrome)};
  --c-primary: ${t.accent};
  --c-on-primary: ${luminance(t.accent) > 0.3 ? mix(t.accent, 15, "#000") : "#ffffff"};`;
}

/**
 * How far the panels stand from the canvas. "close" is the theme as given;
 * "apart" lifts the panels clear of the canvas (lighter in the dark, and in
 * the light a greyer canvas under whiter panels); "tinted" is apart, with
 * the panels washed in the accent's hue.
 */
export const SURFACES = ["close", "apart", "tinted"] as const;
export type Surface = (typeof SURFACES)[number];

function surfaced(t: Theme, dark: boolean, surface: Surface): Theme {
  if (surface === "close") return t;
  const apart = dark
    ? { ...t, chrome: mix(t.ink, 8, t.chrome) }
    : { ...t, paper: mix(t.ink, 5, t.paper), chrome: mix(t.chrome, 40, "#ffffff") };
  if (surface === "apart") return apart;
  return { ...apart, chrome: mix(t.accent, dark ? 10 : 6, apart.chrome) };
}

/** A block for the light theme, and the same selector for the dark one, whether chosen or from the system. */
function themed(sel: string, light: string, dark: string) {
  return `
${sel} {${light}
}
@media (prefers-color-scheme: dark) {
  ${sel}:not([data-theme="light"]) {${dark}
  }
}
${sel}[data-theme="dark"] {${dark}
}`;
}

export function paletteCss() {
  return PALETTES.map((p) =>
    SURFACES.map((surface) => {
      const sel = `:root[data-palette="${p.id}"]${surface === "close" ? "" : `[data-surface="${surface}"]`}`;
      const light = surfaced(p.light, false, surface);
      const dark = surfaced(p.dark, true, surface);
      return themed(sel, tokens(light), tokens(dark)) + themed(`${sel}:not([data-plain])`, roles(light), roles(dark));
    }).join("\n"),
  ).join("\n");
}
