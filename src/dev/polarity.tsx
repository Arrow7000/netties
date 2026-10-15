/**
 * The two ways of showing a direction on its own, side by side at the
 * sizes the app uses them: open /polarity.html on the dev server. The app
 * uses the animated arrow; the fount and drain are the user's first idea.
 * Delete this page and the loser once the user has picked.
 */
import { For, type JSX, createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { Polarity } from "../core/types";
import { PolarityIcon } from "../ui/PolarityIcon";
import { FountDrainIcon } from "./fountDrain";
import "../styles.css";

type Icon = (p: { pol: Polarity; playing?: boolean }) => JSX.Element;

const CANDIDATES: { name: string; icon: Icon }[] = [
  { name: "Animated arrow", icon: PolarityIcon },
  { name: "Fount and drain", icon: (p) => <FountDrainIcon {...p} class="fd" /> },
];

const word = (pol: Polarity) => (pol === "give" ? "gives" : "takes");

function Candidate(props: { name: string; icon: Icon }) {
  const I = props.icon;
  const [pointed, setPointed] = createSignal<Polarity>();
  return (
    <section class="pc">
      <h2>{props.name}</h2>
      <div class="pc-row">
        <span class="pc-label">Hover badge</span>
        <For each={["give", "take"] as const}>
          {(pol) => (
            <span class="port-badge">
              <span class="dir">
                <I pol={pol} />
                {word(pol)}
              </span>
              <span class="type-chip">number</span>
            </span>
          )}
        </For>
      </div>
      <div class="pc-row">
        <span class="pc-label">Switch (point to play)</span>
        <div class="seg dir-seg">
          <For each={["give", "take"] as const}>
            {(pol) => (
              <button type="button" aria-pressed={pol === "give"} onPointerEnter={() => setPointed(pol)} onPointerLeave={() => setPointed()}>
                <I pol={pol} playing={pointed() === pol} />
                {pol === "give" ? "Gives" : "Takes"}
              </button>
            )}
          </For>
          <button type="button">Either</button>
        </div>
      </div>
      <div class="pc-row">
        <span class="pc-label">Sheet note</span>
        <p class="col-note">
          Every port{" "}
          <span class="dir-word">
            <I pol="give" />
            gives
          </span>{" "}
          or{" "}
          <span class="dir-word">
            <I pol="take" />
            takes
          </span>
          .
        </p>
      </div>
      <div class="pc-row">
        <span class="pc-label">Refusal</span>
        <p class="pc-bad">
          <span class="clash-icons">
            <I pol="give" />
            <I pol="give" />
          </span>{" "}
          Both give a number. A wire runs from a port that gives to one that takes.
        </p>
      </div>
      <div class="pc-row pc-big">
        <span class="pc-label">Large</span>
        <I pol="give" />
        <I pol="take" />
        <I pol="give" playing={false} />
        <I pol="take" playing={false} />
        <span class="pc-note">moving, then still</span>
      </div>
    </section>
  );
}

function Page() {
  const [theme, setTheme] = createSignal(document.documentElement.dataset.theme ?? "dark");
  const set = (t: string) => {
    document.documentElement.dataset.theme = t;
    setTheme(t);
  };
  set(theme());
  return (
    <main class="pc-page">
      <header>
        <h1>Directions on their own</h1>
        <div class="seg">
          <For each={["light", "dark"]}>
            {(t) => (
              <button type="button" aria-pressed={theme() === t} onClick={() => set(t)}>
                {t === "light" ? "Light" : "Dark"}
              </button>
            )}
          </For>
        </div>
      </header>
      <For each={CANDIDATES}>{(c) => <Candidate {...c} />}</For>
    </main>
  );
}

const style = document.createElement("style");
style.textContent = `
  body { background: var(--paper); color: var(--text); overflow: auto; }
  .pc-page { max-width: 760px; margin: 0 auto; padding: 32px 16px; font-size: 13px; }
  .pc-page header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .pc-page h1 { font-size: 18px; font-weight: 600; margin: 0; }
  .pc { background: var(--chrome); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; }
  .pc h2 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
  .pc-row { display: flex; align-items: center; gap: 18px; min-height: 40px; flex-wrap: wrap; }
  .pc-label { width: 150px; color: var(--muted); flex: none; }
  .pc-row p { margin: 0; color: var(--muted); }
  .pc-bad { color: var(--stuck) !important; }
  .pc-big .pol-icon { width: 104px; height: 40px; }
  .pc-big .pol-icon.fd { width: 72px; height: 72px; }
  .pc-note { color: var(--muted); }
  .pol-icon.fd { width: 1.6em; height: 1.6em; fill: none; stroke: currentColor; vertical-align: -0.4em; }
  .port-badge .dir .pol-icon.fd { width: 24px; height: 24px; stroke: var(--ink); }
  .dir-seg .pol-icon.fd { width: 18px; height: 18px; }
`;
document.head.append(style);

render(() => <Page />, document.body);
