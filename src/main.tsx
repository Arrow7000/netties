import { render } from "solid-js/web";
import { App, initialDoc } from "./App";
import "./styles.css";
import "./phone.css";
import { DEFAULT_PALETTE, applyPalette } from "./palettes";

applyPalette(DEFAULT_PALETTE);
// In development, a picker to try the other palettes (src/dev/palettePicker.ts).
if (import.meta.env.DEV) void import("./dev/palettePicker").then((p) => p.mountPalettePicker());

initialDoc().then(({ doc, fromLink, error }) => render(() => <App initial={doc} fromLink={fromLink} initialError={error} />, document.getElementById("root")!));
