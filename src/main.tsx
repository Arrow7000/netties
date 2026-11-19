import { render } from "solid-js/web";
import { App, initialDoc } from "./App";
import "./styles.css";
import "./phone.css";

// Softer palettes to try, in development only (src/dev/palettes.css).
if (import.meta.env.DEV) void import("./dev/palettePicker").then((p) => p.mountPalettePicker());

initialDoc().then(({ doc, fromLink, error }) => render(() => <App initial={doc} fromLink={fromLink} initialError={error} />, document.getElementById("root")!));
