import { render } from "solid-js/web";
import { App, initialDoc } from "./App";
import "./styles.css";

initialDoc().then(({ doc, fromLink }) => render(() => <App initial={doc} fromLink={fromLink} />, document.getElementById("root")!));
