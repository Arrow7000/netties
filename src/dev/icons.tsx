/**
 * Candidate icons for Step and Step all, side by side in the real bottom
 * bar and phone sheet bar: open /icons.html on the dev server. Each set is
 * drawn the way `src/ui/icons.tsx` draws its icons, with the app's own CSS.
 */
import { For, type JSX, createSignal } from "solid-js";
import { render } from "solid-js/web";
import * as I from "../ui/icons";
import "../styles.css";
import "../phone.css";

const icon = (body: () => JSX.Element) => () => (
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    {body()}
  </svg>
);

const line = { fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

/** →: one reduction step. */
const Arrow = icon(() => <path d="M2.5 8H13M9.5 4.5L13 8l-3.5 3.5" {...line} />);
/** ⇉: parallel reduction. */
const Parallel = icon(() => <path d="M2.5 4.5H13M10.5 2L13 4.5 10.5 7M2.5 11.5H13M10.5 9l2.5 2.5-2.5 2.5" {...line} />);
/** ⇶: parallel, three abreast. */
const Parallel3 = icon(() => <path d="M2.5 3H13M11 1.2L13 3l-2 1.8M2.5 8H13M11 6.2L13 8l-2 1.8M2.5 13H13M11 11.2l2 1.8-2 1.8" {...line} stroke-width={1.4} />);
/** ↠: reduce all the way, to normal form. */
const Reduce = icon(() => <path d="M2.5 8H13M9.5 4.5L13 8l-3.5 3.5M6 4.5L9.5 8 6 11.5" {...line} />);
/** ⧗: an active pair, two agents tip to tip. */
const Pair = icon(() => <path d="M3 1.5h10L8 7.3zM3 14.5h10L8 8.7z" fill="currentColor" stroke="currentColor" stroke-width={1} stroke-linejoin="round" />);
/** The pair as agents are drawn on the canvas: outlines, joined at the tips. */
const PairLine = icon(() => <path d="M3 2h10L8 6.8zM3 14h10L8 9.2zM8 6.8v2.4" {...line} stroke-width={1.3} />);
/** Two outlined pairs abreast. */
const PairsLine = icon(() => <path d="M1 2.5h5.6L3.8 6.9zM1 13.5h5.6L3.8 9.1zM3.8 6.9v2.2M9.4 2.5H15l-2.8 4.4zM9.4 13.5H15l-2.8-4.4zM12.2 6.9v2.2" {...line} stroke-width={1.2} />);
/** Three active pairs abreast. */
const Pairs = icon(() => (
  <path
    d="M0.8 2.5h3.6L2.6 7.3zM0.8 13.5h3.6L2.6 8.7zM6.2 2.5h3.6L8 7.3zM6.2 13.5h3.6L8 8.7zM11.6 2.5h3.6l-1.8 4.8zM11.6 13.5h3.6l-1.8-4.8z"
    fill="currentColor"
    stroke="currentColor"
    stroke-width={0.6}
    stroke-linejoin="round"
  />
));

interface Set {
  key: string;
  name: string;
  about: string;
  step: () => JSX.Element;
  all: () => JSX.Element;
  run: () => JSX.Element;
  allLabel: string;
}

const sets: Set[] = [
  { key: "A", name: "Now", about: "▶| and ▶▶, borrowed from media players.", step: I.Step, all: I.StepAll, run: I.Play, allLabel: "Step all" },
  { key: "B", name: "Arrow, parallel arrows, play", about: "Rewriting notation: one step, parallel step. Run stays play.", step: Arrow, all: Parallel, run: I.Play, allLabel: "Parallel step" },
  { key: "C", name: "Arrow, parallel arrows, two-headed arrow", about: "Notation all the way: Run is the two-headed arrow (→*), reduce to normal form.", step: Arrow, all: Parallel, run: Reduce, allLabel: "Parallel step" },
  { key: "D", name: "Arrow, three parallel arrows, play", about: "Three arrows abreast, to say “all” more than “two”.", step: Arrow, all: Parallel3, run: I.Play, allLabel: "Parallel step" },
  { key: "E", name: "Pair, three pairs, play", about: "The active pair itself, two agents tip to tip; then every pair at once.", step: Pair, all: Pairs, run: I.Play, allLabel: "Parallel step" },
  { key: "F", name: "Outlined pair, two pairs, play", about: "The pair drawn like agents on the canvas: outlines, with the wire between their tips.", step: PairLine, all: PairsLine, run: I.Play, allLabel: "Parallel step" },
];

function Desktop(props: { set: Set }) {
  const s = props.set;
  return (
    <div class="strip">
      <div class="island counters">
        <div class="chip">
          <b>12</b>
          <span>steps</span>
        </div>
        <div class="chip">
          <b>31</b>
          <span>interactions</span>
        </div>
        <div class="chip">
          <b>18</b>
          <span>agents</span>
        </div>
      </div>
      <div class="island transport">
        <button class="btn outline">
          {s.step()}
          Step
        </button>
        <button class="btn outline">
          {s.all()}
          {s.allLabel}
        </button>
        <button class="btn run">
          {s.run()}
          Run
        </button>
        <span class="sep" />
        <div class="speed">
          <button class="btn icon">
            <I.Slow />
          </button>
          <input type="range" min={-2} max={2} step={0.25} value={0} />
          <output>1×</output>
        </div>
      </div>
    </div>
  );
}

function Phone(props: { set: Set }) {
  const s = props.set;
  return (
    <div class="island sheet phone">
      <div class="sheet-bar">
        <div class="sheet-transport">
          <button class="btn outline icon">{s.step()}</button>
          <button class="btn outline icon">{s.all()}</button>
          <button class="btn run">
            {s.run()}
            Run
          </button>
        </div>
        <div class="view-controls sheet-view">
          <button class="btn icon">
            <I.Fit />
          </button>
          <button class="btn icon">
            <I.Sliders />
          </button>
        </div>
      </div>
    </div>
  );
}

function Big(props: { set: Set }) {
  return (
    <div class="big">
      {props.set.step()}
      {props.set.all()}
      {props.set.run()}
    </div>
  );
}

function Page() {
  const [dark, setDark] = createSignal(matchMedia("(prefers-color-scheme: dark)").matches);
  const flip = () => {
    setDark(!dark());
    document.documentElement.dataset.theme = dark() ? "dark" : "light";
  };
  return (
    <main>
      <header>
        <h1>Step icons</h1>
        <button class="btn outline" onClick={flip}>
          <I.Theme />
          {dark() ? "Light" : "Dark"}
        </button>
      </header>
      <For each={sets}>
        {(s) => (
          <section>
            <h2>
              <span class="key">{s.key}</span> {s.name}
            </h2>
            <p class="muted">{s.about}</p>
            <div class="row">
              <Desktop set={s} />
              <Phone set={s} />
              <Big set={s} />
            </div>
          </section>
        )}
      </For>
    </main>
  );
}

const style = document.createElement("style");
style.textContent = `
  body { overflow: auto; height: auto; }
  main { max-width: 1240px; margin: 0 auto; padding: 24px 16px 64px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0; }
  h2 { font-size: 14px; font-weight: 600; margin: 0; }
  section { padding: 20px 0; border-top: 1px solid var(--line); }
  section p { margin: 2px 0 14px; }
  .key { display: inline-block; min-width: 1.6em; color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; }
  .island { position: static; }
  .strip { display: flex; gap: 8px; align-items: flex-end; }
  .phone .sheet-bar { border-top: 0; }
  .phone { width: 360px; max-width: 100%; }
  .phone .btn { height: 40px; min-width: 40px; }
  .phone .btn.icon { width: 40px; }
  .big { display: flex; gap: 20px; color: var(--text); }
  .big .icon { width: 48px; height: 48px; }
`;
document.head.append(style);

render(() => <Page />, document.getElementById("root")!);
