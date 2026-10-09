import { createSignal, onCleanup, onMount } from "solid-js";
import { ParseError, parse, print } from "../core/text";
import type { Editor } from "../state/editor";

/** The system and net as text, in the style of Inpla. Edit and load it back. */
export function TextView(props: { ed: Editor }) {
  const ed = props.ed;
  const [text, setText] = createSignal(print(ed.system, ed.net));
  const [error, setError] = createSignal<string>();
  const [note, setNote] = createSignal<string>();
  let fileInput!: HTMLInputElement;

  const load = () => {
    try {
      const { system, net } = parse(text());
      ed.loadParsed(system, net);
      ed.closeText();
    } catch (e) {
      setError(e instanceof ParseError || e instanceof Error ? e.message : String(e));
    }
  };

  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text()], { type: "text/plain" }));
    a.download = "net.inet";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setNote("Copied.");
    } catch {
      setNote("Couldn't copy; select the text and copy it yourself.");
    }
  };

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
