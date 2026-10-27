import { createSignal, onCleanup, onMount } from "solid-js";
import { ParseError, parse, print } from "../core/text";
import type { Editor } from "../state/editor";
import { copyText } from "./clipboard";

/** The system and net as text, in the style of Inpla. Edit and load it back. */
export function TextView(props: { ed: Editor }) {
  const ed = props.ed;
  const [text, setText] = createSignal(print(ed.system, ed.net));
  const [error, setError] = createSignal<string>();
  const [note, setNote] = createSignal<string>();
  let fileInput!: HTMLInputElement;
  let area!: HTMLTextAreaElement;

  const load = () => {
    try {
      const { system, net } = parse(text());
      const cut = ed.loadParsed(system, net);
      ed.closeText();
      if (cut) ed.notify(`Loaded. Cut ${cut === 1 ? "1 wire" : `${cut} wires`} that didn't fit the types into loose ends.`, true);
    } catch (e) {
      setError(e instanceof ParseError || e instanceof Error ? e.message : String(e));
      if (e instanceof ParseError) showAt(e.line, e.col ?? 1);
    }
  };

  /** Put the caret on a line and column of the text, scrolled into view. */
  const showAt = (line: number, col: number) => {
    const lines = text().split("\n");
    let at = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) at += lines[i]!.length + 1;
    at += Math.min(col - 1, lines[line - 1]?.length ?? 0);
    area.focus();
    area.setSelectionRange(at, at);
    // Scroll so the line sits a little below the top rather than at the very edge.
    const lh = parseFloat(getComputedStyle(area).lineHeight) || 20;
    area.scrollTop = Math.max(0, (line - 4) * lh);
  };

  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text()], { type: "text/plain" }));
    a.download = "net.inet";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copy = async () => setNote((await copyText(text())) ? "Copied." : "Couldn't copy; select the text and copy it yourself.");

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        ed.closeText();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        load();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));
  });

  return (
    <div class="rule-editor text-view" role="dialog" aria-label="Net as text">
      <header class="rule-head">
        <h2>As text</h2>
        <div class="rule-actions">
          <button class="btn" onClick={() => fileInput.click()}>
            Open file
          </button>
          <button class="btn" onClick={save}>
            Save file
          </button>
          <button class="btn" onClick={copy}>
            Copy
          </button>
          <button class="btn" onClick={ed.closeText}>
            Cancel
          </button>
          <button class="btn on" onClick={load} title="Load (⌘↵)">
            Load
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".inet,.in,.txt,text/plain"
        hidden
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          if (f) setText(await f.text());
          setError(undefined);
        }}
      />
      <textarea
        ref={area}
        class="text-area"
        spellcheck={false}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setError(undefined);
          setNote(undefined);
        }}
      />
      <p class="rule-help" classList={{ "text-error": !!error() }}>
        {error() ??
          note() ??
          "Rules are A(x, y) >< B(z) => …; nets are equations t ~ u. A name used once in a net is a free port. Loading replaces the current agents, rules and net."}
      </p>
    </div>
  );
}
