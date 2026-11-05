import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { CUSTOM, EFFORTS, type Effort, type ModelInfo, type Wire, isLocalAddress, listModels, normalizeUrl } from "../create/provider";
import type { Chat, Waiting } from "./chatStore";
import { fingers } from "./compact";
import { Menu, MenuItem } from "./Menu";
import { nameOf, presetsHere } from "./modelSettings";

/** How a provider's list of models stands. */
type Listing = { kind: "idle" } | { kind: "loading" } | { kind: "loaded"; models: ModelInfo[] } | { kind: "failed"; message: string };

/** Where to look through a list of models: a lot of them, on some providers. */
const matching = (models: ModelInfo[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) : models;
};
const MOST_SHOWN = 100;

/** What the form says when something's waiting for it, so that Save going ahead with it is no surprise. */
const WAITING: Record<Waiting, { head: string; note: string; button: string }> = {
  send: { head: "Choose a model to send your message", note: "Your message goes as soon as you save. Cancel keeps it in the box.", button: "Save and send" },
  resume: { head: "Choose a model to carry on with", note: "The reply picks up from where it got to as soon as you save.", button: "Save and resume" },
  retry: { head: "Choose a model to try again with", note: "The reply starts over as soon as you save.", button: "Save and try again" },
};

/**
 * Choosing a provider, its key and a model. The key stays in this browser. The
 * list of models comes from the provider itself as soon as there's enough to ask it with, which also shows whether the key works.
 */
export function ModelSettingsForm(props: { chat: Chat; first: boolean }) {
  const models = props.chat.models;
  const here = presetsHere();
  const why = () => props.chat.settings();
  /**
   * The chat's provider, when it's the chat that needs setting up. Asked for from
   * the menu, it's the default's, or Save would move the default to wherever this chat happens to be.
   */
  const onChat = props.chat.choice()?.provider;
  const onDefault = models.defaults()?.provider;
  // A chat left on a provider that has been removed is better off being offered what's still set up.
  const start = (why()?.kind === "asked" || (why()?.kind !== "fixing" && onChat && !models.entry(onChat)) ? onDefault : onChat) ?? onChat ?? onDefault ?? here[0]!.id;
  const [provider, setProvider] = createSignal(start);
  const saved = () => models.entry(provider());
  const preset = () => here.find((p) => p.id === provider());
  const local = () => !!preset()?.local;
  const custom = () => provider() === CUSTOM;

  const [url, setUrl] = createSignal("");
  const [wire, setWire] = createSignal<Wire>("openai");
  const [key, setKey] = createSignal("");
  const [model, setModel] = createSignal("");
  const [effort, setEffort] = createSignal<Effort>(models.defaults()?.effort ?? "default");
  const [listing, setListing] = createSignal<Listing>({ kind: "idle" });
  /** Having just forgotten the key, as nothing else on the form shows that it happened. */
  const [forgot, setForgot] = createSignal(false);

  /** Fill in what's known for this provider. */
  const load = () => {
    const e = saved();
    setUrl(e?.url ?? (preset()?.local ? preset()!.url : ""));
    setWire(e?.wire ?? "openai");
    setKey(e?.key ?? "");
    setModel(filled());
  };
  /** What new chats really use, which a pick in a chat doesn't change, or else what was last saved for this provider. */
  const filled = () => {
    const d = models.defaults();
    return d?.provider === provider() ? d.model : (saved()?.model ?? "");
  };
  load();

  const entry = () => ({ ...(key().trim() ? { key: key().trim() } : {}), ...(local() || custom() ? { url: url().trim() } : {}), ...(custom() ? { wire: wire() } : {}), model: model().trim() });
  const connection = () => models.connect(provider(), entry());
  const canSave = () => !!connection() && !!model().trim();

  // What can be chosen from depends on the address and the key. Typing either in shouldn't ask at every letter.
  createEffect(
    on([provider, url, key, wire], () => {
      setListing({ kind: "idle" });
      const c = connection();
      if (!c) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => {
        setListing({ kind: "loading" });
        listModels(c, { signal: ctrl.signal, setup: models.setupFor(provider()) }).then(
          (list) => !ctrl.signal.aborted && setListing({ kind: "loaded", models: list }),
          (e: Error) => !ctrl.signal.aborted && setListing({ kind: "failed", message: e.message }),
        );
      }, 400);
      onCleanup(() => {
        clearTimeout(timer);
        ctrl.abort();
      });
    }),
  );

  const choices = () => {
    const l = listing();
    return l.kind === "loaded" ? matching(l.models, model()).slice(0, MOST_SHOWN) : [];
  };

  /** Whether saving only puts a failed chat's key or address right: the same provider, and the model field left alone. Then it's on the model it was on, and new chats are too. */
  const keepsChat = () => {
    const w = why();
    return w?.kind === "fixing" && w.code !== "model" && props.chat.choice()?.provider === provider() && model().trim() === filled();
  };

  /** What the chat being put right is on, if that isn't what's in the model field. */
  const chatOnOther = () => (why()?.kind === "fixing" && props.chat.choice()?.model !== model().trim() ? props.chat.choice()?.model : undefined);

  const save = () => {
    if (!canSave()) return;
    const keep = keepsChat();
    models.save(provider(), entry(), effort(), !keep);
    props.chat.closeSettings(true, keep);
  };

  /** Save takes a chat that's waiting along with it, so a field only about new chats would mislead. */
  const modelLabel = () => (why()?.kind === "waiting" ? "Model for this chat and new chats" : "Model for new chats");

  const saveLabel = () => {
    const w = why();
    if (w?.kind === "waiting") return WAITING[w.action].button;
    if (w?.kind === "fixing") return w.action === "resume" ? "Save and resume" : "Save and try again";
    return "Save";
  };

  return (
    <form
      class="model-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {(() => {
        const w = why();
        if (w?.kind === "waiting") {
          return (
            <>
              <h2>{WAITING[w.action].head}</h2>
              <p>{WAITING[w.action].note}</p>
            </>
          );
        }
        if (w?.kind === "fixing") {
          return (
            <>
              <h2>{w.code === "key" ? "Change the key" : "Check the settings"}</h2>
              <p class="model-why">{w.message}</p>
            </>
          );
        }
        if (!props.first) return <h2>Model</h2>;
        return (
          <>
            <h2>Choose a model to chat with</h2>
            <p>The chat runs on your own provider and API key, or on a model on your own computer.</p>
          </>
        );
      })()}
      <label>
        Provider
        <select
          class="input"
          aria-label="Provider"
          value={provider()}
          onChange={(e) => {
            setProvider(e.currentTarget.value);
            setForgot(false);
            load();
          }}
        >
          <For each={here}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          <option value={CUSTOM}>Custom address</option>
        </select>
      </label>
      <Show when={local() || custom()}>
        <label>
          Address
          <input class="input" aria-label="Address" spellcheck={false} autocomplete="off" placeholder="http://localhost:8080/v1" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} />
          <Show when={local() || isLocalAddress(normalizeUrl(url()))}>
            <span class="hint">Your browser may ask to let this site reach your computer or network: say yes. It goes straight there, and nothing passes through netties.</span>
          </Show>
        </label>
      </Show>
      <Show when={custom()}>
        <label>
          API style
          <select class="input" aria-label="API style" value={wire()} onChange={(e) => setWire(e.currentTarget.value as Wire)}>
            <option value="openai">OpenAI (Chat Completions), the usual one</option>
            <option value="anthropic">Anthropic (Messages)</option>
          </select>
        </label>
      </Show>
      <label>
        <span>
          API key <Show when={!preset()?.needsKey}><span class="optional">(optional)</span></Show>
        </span>
        <input class="input" aria-label="API key" type="password" spellcheck={false} autocomplete="off" value={key()} onInput={(e) => (setKey(e.currentTarget.value), setForgot(false))} />
        <Show when={forgot()}>
          <span class="hint">Key forgotten. The address, model and your chats stay.</span>
        </Show>
        <span class="hint">
          Kept in this browser, and sent only to {nameOf(provider())}.
          <Show when={preset()?.keysAt}>
            {" "}
            <a href={preset()!.keysAt} target="_blank" rel="noreferrer">
              Get a key
            </a>
          </Show>
        </span>
      </label>
      <label>
        {modelLabel()}
        <input class="input" aria-label={modelLabel()} spellcheck={false} autocomplete="off" placeholder={listing().kind === "loaded" ? "Search, or type a model's name" : "The model's name"} value={model()} onInput={(e) => setModel(e.currentTarget.value)} />
        <Show when={listing().kind === "loading"}>
          <span class="hint">Asking {nameOf(provider())} what it has…</span>
        </Show>
        <Show when={listing().kind === "failed" ? (listing() as { message: string }).message : undefined}>{(m) => <span class="hint bad">{m()}</span>}</Show>
        <Show when={listing().kind === "loaded" && !(listing() as { models: ModelInfo[] }).models.length}>
          <span class="hint">{nameOf(provider())} didn't list any models{local() ? ". If you haven't downloaded one yet, do that first" : ""}. You can still type a name here.</span>
        </Show>
        <Show when={chatOnOther()}>
          {(m) => <span class="hint">{keepsChat() ? `Saving keeps this chat on ${m()}. Change the model here to move it.` : `This chat moves to ${model().trim() || "this model"} when you save.`}</span>}
        </Show>
        <Show when={choices().length && !choices().some((m) => m.id === model())}>
          <div class="model-choices" role="listbox" aria-label="Models">
            <For each={choices()}>{(m) => <MenuItem title={m.name ?? m.id} note={m.name ? m.id : undefined} onClick={() => setModel(m.id)} />}</For>
          </div>
        </Show>
      </label>
      <label>
        Reasoning
        <select class="input" aria-label="Reasoning" value={effort()} onChange={(e) => setEffort(e.currentTarget.value as Effort)}>
          <For each={EFFORTS}>{(l) => <option value={l.id}>{l.name}</option>}</For>
        </select>
      </label>
      <div class="model-actions">
        <button type="submit" class="btn primary" disabled={!canSave()}>
          {saveLabel()}
        </button>
        <Show when={props.chat.settings()}>
          <button type="button" class="btn" onClick={() => props.chat.closeSettings()}>
            Cancel
          </button>
        </Show>
        <span class="spacer" />
        <Show when={saved()?.key}>
          <button
            type="button"
            class="btn"
            title={`Forget the key kept for ${nameOf(provider())}, keeping the rest. Your chats stay.`}
            onClick={() => {
              models.forgetKey(provider());
              setKey("");
              setForgot(true);
            }}
          >
            Forget this key
          </button>
        </Show>
        <Show when={saved() && !preset()?.needsKey}>
          <button
            type="button"
            class="btn"
            title={`Remove ${nameOf(provider())} and all that's kept for it, so it's no longer in the model menu. Your chats stay.`}
            onClick={() => {
              models.remove(provider());
              load();
            }}
          >
            Remove this provider
          </button>
        </Show>
      </div>
    </form>
  );
}

/** What each provider that's set up has to offer, as it comes in. */
function ProviderModels(props: { chat: Chat; provider: string; query: string; heading: boolean; onPick: () => void }) {
  const [listing, setListing] = createSignal<Listing>({ kind: "loading" });
  props.chat.models.models(props.provider).then(
    (models) => setListing({ kind: "loaded", models }),
    (e: Error) => setListing({ kind: "failed", message: e.message }),
  );
  const shown = createMemo(() => {
    const l = listing();
    return l.kind === "loaded" ? matching(l.models, props.query).slice(0, MOST_SHOWN) : [];
  });
  const current = () => props.chat.choice();
  return (
    <>
      <Show when={props.heading}>
        <div class="menu-head">{nameOf(props.provider)}</div>
      </Show>
      <Show when={listing().kind === "loading"}>
        <div class="model-note">Asking what it has…</div>
      </Show>
      <Show when={listing().kind === "failed" ? (listing() as { message: string }).message : undefined}>{(m) => <div class="model-note bad">{m()}</div>}</Show>
      <Show when={listing().kind === "loaded" && !props.query.trim() && !shown().length}>
        <div class="model-note">It didn't list any models. Type a name above to use one.</div>
      </Show>
      <For each={shown()}>
        {(m) => (
          <MenuItem
            title={m.name ?? m.id}
            note={m.name ? m.id : undefined}
            current={current()?.provider === props.provider && current()?.model === m.id}
            onClick={() => {
              props.chat.setModel(props.provider, m.id);
              props.onPick();
            }}
          />
        )}
      </For>
    </>
  );
}

/** Which model this chat uses. It can change at any time, and the next reply goes by it. */
export function ModelPicker(props: { chat: Chat }) {
  const chat = props.chat;
  const label = () => (chat.usable() ? chat.choice()!.model : "Choose a model");
  return (
    <Menu class="chat-model-button" menuClass="model-menu" title={chat.usable() ? `${nameOf(chat.choice()!.provider)}: ${chat.choice()!.model}` : "Choose a model"} label={<span>{label()}</span>}>
      {(close) => {
        const [query, setQuery] = createSignal("");
        let box!: HTMLInputElement;
        onMount(() => {
          if (!fingers()) box.focus();
        });
        const typed = () => query().trim();
        const providers = () => chat.models.ready();
        /** A name that isn't on any list can still be used, on the provider this chat is on. */
        const typedOn = () => (chat.usable() ? chat.choice()!.provider : providers()[0]);
        return (
          <>
            <input ref={box} class="input" aria-label="Search models" placeholder="Search, or type a model's name" spellcheck={false} autocomplete="off" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
            <div class="model-scroll">
              <For each={providers()}>{(id) => <ProviderModels chat={chat} provider={id} query={query()} heading={providers().length > 1} onPick={close} />}</For>
              <Show when={typed() && typedOn()}>
                <MenuItem
                  title={`Use "${typed()}"`}
                  note={nameOf(typedOn()!)}
                  onClick={() => {
                    chat.setModel(typedOn()!, typed());
                    close();
                  }}
                />
              </Show>
            </div>
            <hr />
            <MenuItem
              title="Providers and keys…"
              onClick={() => {
                close();
                chat.openSettings();
              }}
            />
          </>
        );
      }}
    </Menu>
  );
}

/** How hard the model should think, for this chat. */
export function EffortPicker(props: { chat: Chat }) {
  const chat = props.chat;
  const now = () => chat.choice()?.effort ?? "default";
  return (
    <Menu class="chat-effort-button" title="How hard the model should think. Not every model takes this." label={<span>{now() === "default" ? "Reasoning" : `Reasoning: ${EFFORTS.find((e) => e.id === now())!.name}`}</span>}>
      {(close) => (
        <For each={EFFORTS}>
          {(l) => (
            <MenuItem
              title={l.name}
              note={l.id === "default" ? "Whatever the model does by itself" : l.id === "off" ? "Or as little as it allows" : undefined}
              current={now() === l.id}
              disabled={!chat.choice()}
              onClick={() => {
                chat.setEffort(l.id);
                close();
              }}
            />
          )}
        </For>
      )}
    </Menu>
  );
}
