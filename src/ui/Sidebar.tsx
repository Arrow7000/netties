import { For, Show, createSignal } from "solid-js";
import type { ComponentDef } from "../core/groups";
import type { AgentType } from "../core/net";
import { agentOutline, labelPos } from "../render/svg";
import type { Editor } from "../state/editor";

export function Glyph(props: { type: AgentType }) {
  const o = () => agentOutline({ x: 0, y: 0, orient: "down" }, props.type.arity);
  const l = () => labelPos({ x: 0, y: 0, orient: "down" }, props.type.arity);
  const scale = () => Math.min(1, 32 / Math.max(16, (props.type.arity + 1) * 16));
  return (
    <svg class="glyph" classList={{ filled: !!props.type.filled }} viewBox="-17 -13 34 26" aria-hidden="true">
      <g transform={`scale(${scale()})`}>
        {(() => {
          const s = o();
          return s.kind === "circle" ? (
            <circle class="body" r={s.r} />
          ) : (
            <polygon class="body" points={s.points.map((p) => `${p.x},${p.y}`).join(" ")} />
          );
        })()}
        <text x={l().x} y={l().y} text-anchor="middle" dominant-baseline="central">
          {props.type.symbol}
        </text>
      </g>
    </svg>
  );
}

export function ComponentGlyph(props: { def: ComponentDef }) {
  const w = () => Math.min(30, 12 + props.def.iface.length * 4);
  return (
    <svg class="glyph" viewBox="-17 -13 34 26" aria-hidden="true">
      <rect class="body" x={-w() / 2} y={-8} width={w()} height={16} />
      <text x={0} y={0} text-anchor="middle" dominant-baseline="central">
        {props.def.symbol}
      </text>
    </svg>
  );
}

function TypeForm(props: {
  initial?: AgentType;
  taken: (id: string) => boolean;
  onSave: (t: AgentType) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [symbol, setSymbol] = createSignal(props.initial?.symbol ?? "");
  const [name, setName] = createSignal(props.initial?.name ?? "");
  const [arity, setArity] = createSignal(props.initial?.arity ?? 2);
  const [filled, setFilled] = createSignal(!!props.initial?.filled);
  const [error, setError] = createSignal<string>();

  const save = (e: Event) => {
    e.preventDefault();
    const sym = symbol().trim();
    if (!sym) return setError("Give the agent a symbol.");
    const id = props.initial?.id ?? sym;
    if (!props.initial && props.taken(id)) return setError(`There is already an agent called ${sym}.`);
    const n = Math.round(arity());
    if (!(n >= 0 && n <= 8)) return setError("Agents can have between 0 and 8 aux ports.");
    props.onSave({ id, symbol: sym, name: name().trim() || sym, arity: n, filled: filled() });
  };

  return (
    <form class="form" onSubmit={save}>
      <label for="t-symbol">Symbol</label>
      <input id="t-symbol" type="text" value={symbol()} onInput={(e) => setSymbol(e.currentTarget.value)} maxLength={3} />
      <label for="t-name">Name</label>
      <input id="t-name" type="text" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      <label for="t-arity">Aux ports</label>
      <input
        id="t-arity"
        type="number"
        min={0}
        max={8}
        value={arity()}
        onInput={(e) => setArity(e.currentTarget.valueAsNumber)}
      />
      <label for="t-filled">Filled</label>
      <input id="t-filled" type="checkbox" checked={filled()} onChange={(e) => setFilled(e.currentTarget.checked)} />
      <Show when={props.initial && arity() !== props.initial.arity}>
        <p class="error">Changing the number of ports removes these agents from the net, and their rules.</p>
      </Show>
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <div class="actions">
        <Show when={props.onDelete}>
          <button type="button" class="btn" onClick={props.onDelete} style={{ "margin-right": "auto" }}>
            Delete
          </button>
        </Show>
        <button type="button" class="btn" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn on">
          {props.initial ? "Save" : "Add agent"}
        </button>
      </div>
    </form>
  );
}

export function Sidebar(props: { ed: Editor; theme: string; setTheme: (t: string) => void }) {
  const ed = props.ed;
  const [editing, setEditing] = createSignal<string | "new">();
  const [copied, setCopied] = createSignal(false);

  const types = () => {
    ed.rev();
    return [...ed.system.types.values()];
  };

  const components = () => [...ed.defs().values()];

  const pairs = () => {
    ed.rev();
    const ts = types();
    const out: { a: AgentType; b: AgentType; has: boolean }[] = [];
    ts.forEach((a, i) => ts.slice(i).forEach((b) => out.push({ a, b, has: !!ed.system.ruleFor(a.id, b.id) })));
    return out;
  };

  const pick = (t: AgentType) => {
    if (ed.model.mode() === "auto") ed.model.addAgent(t.id);
    else ed.model.setArmed(ed.model.armed() === t.id ? undefined : t.id);
  };

  const share = async () => {
    const { toShareHash } = await import("../state/persist");
    const hash = await toShareHash(ed.toDoc());
    const url = location.origin + location.pathname + hash;
    history.replaceState(null, "", hash);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      ed.setMessage("Couldn't copy; the link is in the address bar.");
    }
  };

  const exportSVG = async () => {
    const { toSVG } = await import("../render/svg");
    const css = getComputedStyle(document.documentElement);
    const l = ed.model.layout();
    const v = ed.model.view();
    const svg = toSVG(v.net, v.sys, l.placement, l.routed, {
      paper: css.getPropertyValue("--paper").trim(),
      ink: css.getPropertyValue("--ink").trim(),
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = "net.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const byRule = () => [...ed.stats().byRule.entries()].sort((x, y) => y[1] - x[1]);

  return (
    <aside class="sidebar">
      <h1 class="wordmark">
        <svg viewBox="-12 -14 24 28" aria-hidden="true">
          <polygon points="-9,-13 9,-13 0,-2" fill="var(--ink)" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round" />
          <polygon points="-9,13 9,13 0,2" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round" />
        </svg>
        netties
      </h1>

      <section>
        <h2>Agents</h2>
        <p class="caption">
          {ed.model.mode() === "auto" ? "Click an agent to add it to the net." : "Pick an agent, then click the canvas to place it."}
        </p>
        <ul class="list">
          <For each={types()}>
            {(t) => (
              <li>
                <div class="type-row" classList={{ armed: ed.model.armed() === t.id }}>
                  <button class="place" onClick={() => pick(t)} title={`Add ${t.name}`}>
                    <Glyph type={t} />
                    <span class="name">
                      {t.name} <span class="meta">{t.arity === 1 ? "1 aux port" : `${t.arity} aux ports`}</span>
                    </span>
                  </button>
                  <button class="edit" onClick={() => setEditing(editing() === t.id ? undefined : t.id)}>
                    Edit
                  </button>
                </div>
                <Show when={editing() === t.id}>
                  <TypeForm
                    initial={t}
                    taken={(id) => ed.system.types.has(id)}
                    onSave={(nt) => {
                      ed.updateType(t.id, nt);
                      setEditing(undefined);
                    }}
                    onCancel={() => setEditing(undefined)}
                    onDelete={() => {
                      ed.removeType(t.id);
                      setEditing(undefined);
                    }}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
        <Show
          when={editing() === "new"}
          fallback={
            <button class="link-btn" onClick={() => setEditing("new")} style={{ "margin-top": "6px" }}>
              New agent type
            </button>
          }
        >
          <TypeForm
            taken={(id) => ed.system.types.has(id)}
            onSave={(t) => {
              ed.addType(t);
              setEditing(undefined);
            }}
            onCancel={() => setEditing(undefined)}
          />
        </Show>
      </section>

      <section>
        <h2>Components</h2>
        <p class="caption">
          {components().length
            ? "Click to add one. Edit a component and every copy of it changes."
            : "Select some agents (shift-click or shift-drag), then make them a component."}
        </p>
        <ul class="list">
          <For each={components()}>
            {(d) => (
              <li>
                <div class="type-row">
                  <button class="place" onClick={() => ed.addComponent(d.id)} title={`Add ${d.name}`}>
                    <ComponentGlyph def={d} />
                    <span class="name">
                      {d.name} <span class="meta">{d.iface.length === 1 ? "1 port" : `${d.iface.length} ports`}</span>
                    </span>
                  </button>
                  <button class="edit" onClick={() => ed.openComponent(d.id)}>
                    Edit
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
        <button class="link-btn" onClick={() => ed.openComponent(ed.newComponent())} style={{ "margin-top": "6px" }}>
          New component
        </button>
      </section>

      <section>
        <h2>Rules</h2>
        <p class="caption">What happens when two agents meet, tip to tip. Click one to redraw it.</p>
        <div class="rules">
          <For each={pairs().filter((p) => p.has)}>
            {(p) => (
              <button class="pair" onClick={() => ed.openRule(p.a.id, p.b.id)}>
                {p.a.symbol} ⋈ {p.b.symbol}
              </button>
            )}
          </For>
        </div>
        <Show when={pairs().some((p) => !p.has)}>
          <details class="missing">
            <summary>
              {(() => {
                const n = pairs().filter((p) => !p.has).length;
                return n === 1 ? "1 pair has no rule" : `${n} pairs have no rule`;
              })()}
            </summary>
            <div class="rules">
              <For each={pairs().filter((p) => !p.has)}>
                {(p) => (
                  <button class="pair" onClick={() => ed.openRule(p.a.id, p.b.id)}>
                    {p.a.symbol} ⋈ {p.b.symbol}
                  </button>
                )}
              </For>
            </div>
          </details>
        </Show>
      </section>

      <Show when={ed.stats().interactions > 0}>
        <section>
          <h2>This run</h2>
          <div class="stats">
            <span>Interactions</span>
            <span class="num">{ed.stats().interactions}</span>
            <Show when={ed.stats().rounds > 0}>
              <span>Parallel rounds</span>
              <span class="num">{ed.stats().rounds}</span>
            </Show>
            <For each={byRule()}>
              {([k, n]) => (
                <>
                  <span style={{ "font-style": "italic", "padding-left": "12px" }}>{k.replace("|", " ⋈ ")}</span>
                  <span class="num">{n}</span>
                </>
              )}
            </For>
          </div>
        </section>
      </Show>

      <section>
        <h2>Examples</h2>
        <ul class="list examples">
          <For each={ed.examples}>
            {(ex) => (
              <li>
                <button class="link-btn" onClick={() => ed.loadExample(ex)}>
                  {ex.name}
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>

      <div class="footer">
        <div class="seg" role="group" aria-label="Theme">
          <For each={["system", "light", "dark"]}>
            {(t) => (
              <button class="btn" classList={{ on: props.theme === t }} onClick={() => props.setTheme(t)}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            )}
          </For>
        </div>
        <button class="btn" onClick={share}>
          {copied() ? "Link copied" : "Copy link"}
        </button>
        <button class="btn" onClick={exportSVG}>
          Export SVG
        </button>
        <button class="btn" onClick={ed.openText} title="See and edit the agents, rules and net as text">
          Text
        </button>
      </div>
    </aside>
  );
}

