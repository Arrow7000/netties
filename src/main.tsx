import { render } from "solid-js/web";
import { App, initialDoc } from "./App";
import "./styles.css";

initialDoc().then((doc) => render(() => <App initial={doc} />, document.getElementById("root")!));
