import { createSignal } from "solid-js";
import type { Asker } from "../create/chat";
import { CUSTOM, type Connection, type Effort, type ModelInfo, type Preset, PRESETS, type Wire, listModels, localSetup, normalizeUrl, streamReply } from "../create/provider";

/**
 * The visitor's own providers and keys, kept in this browser and sent only to the
 * provider they belong to. Each provider remembers its own key, so moving between
 * them doesn't mean typing it again.
 */

const KEY = "netties:models";
/** How long a provider's list of models is good for. */
const LIST_MS = 10 * 60_000;

/** A model to use, and how hard it should think. */
export interface Choice {
  provider: string;
  model: string;
  effort: Effort;
}

export interface ProviderEntry {
  key?: string;
  /** Overrides the provider's own address: for a custom one, or a local server on another port. */
  url?: string;
  wire?: Wire;
  /** The model last chosen from it. */
  model?: string;
}

interface Stored {
  providers: Record<string, ProviderEntry>;
  default?: Choice;
}

/** A pretend provider, with no cost, only under `npm run dev` (scripts/fakeModel.ts). */
const devPresets = (): Preset[] => (import.meta.env.DEV && typeof location !== "undefined" ? [{ id: "fake", name: "Pretend model (dev only)", url: `${location.origin}/dev-model/v1`, wire: "openai", local: true }] : []);

export const presetsHere = (): Preset[] => [...PRESETS, ...devPresets()];

export const nameOf = (id: string) => (id === CUSTOM ? "Custom provider" : (presetsHere().find((p) => p.id === id)?.name ?? id));

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as Partial<Stored>) : undefined;
    return { providers: got?.providers ?? {}, default: got?.default };
  } catch {
    return { providers: {} };
  }
}

export type ModelSettings = ReturnType<typeof createModelSettings>;

export function createModelSettings() {
  const [stored, setStored] = createSignal(read());
  const write = (s: Stored) => {
    setStored(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // It lasts as long as the page does.
    }
  };
  // Another tab has changed them.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === KEY) setStored(read());
  });

  /** How to reach a provider, given what's filled in for it. It may not be usable yet. */
  const connect = (id: string, entry: ProviderEntry | undefined): Connection | undefined => {
    const preset = presetsHere().find((p) => p.id === id);
    if (id !== CUSTOM && !preset) return undefined;
    const url = normalizeUrl(entry?.url ?? preset?.url ?? "");
    if (!url) return undefined;
    if (preset?.needsKey && !entry?.key) return undefined;
    return { name: nameOf(id), url: preset && !preset.local ? preset.url : url, wire: preset?.wire ?? entry?.wire ?? "openai", key: entry?.key || undefined, extra: preset?.extra, maxTokens: preset?.maxTokens };
  };

  /** A provider the visitor has set up, if this one is. */
  const connection = (id: string) => {
    const entry = stored().providers[id];
    return entry ? connect(id, entry) : undefined;
  };

  const setupFor = (id: string) => (typeof location === "undefined" ? undefined : localSetup(id, location.origin));

  const lists = new Map<string, { at: number; url: string; key?: string; list: Promise<ModelInfo[]> }>();

  return {
    entry: (id: string) => stored().providers[id],
    connect,
    /** The providers set up so far. */
    ready: () => Object.keys(stored().providers).filter((id) => connection(id)),
    defaults: () => stored().default,
    usable: (c: Choice | undefined): c is Choice => !!c && !!c.model && !!connection(c.provider),
    /** Keep what was filled in for a provider, and make this the choice for new chats. */
    save(id: string, entry: ProviderEntry, effort: Effort) {
      write({ providers: { ...stored().providers, [id]: entry }, default: { provider: id, model: entry.model ?? "", effort } });
    },
    /** Forget a provider, key and all. What was said with it stays. */
    forget(id: string) {
      const { [id]: _gone, ...providers } = stored().providers;
      lists.delete(id);
      const left = stored().default?.provider === id ? undefined : stored().default;
      write({ providers, default: left });
    },
    /** Remember which model was last used from a provider. */
    remember(id: string, model: string) {
      const entry = stored().providers[id];
      if (entry && entry.model !== model) write({ ...stored(), providers: { ...stored().providers, [id]: { ...entry, model } } });
    },
    /** What a provider that's set up has to offer, from a recent list if there is one. */
    models(id: string): Promise<ModelInfo[]> {
      const c = connection(id);
      if (!c) return Promise.resolve([]);
      const had = lists.get(id);
      if (had && had.url === c.url && had.key === c.key && Date.now() - had.at < LIST_MS) return had.list;
      const list = listModels(c, { setup: setupFor(id) });
      lists.set(id, { at: Date.now(), url: c.url, key: c.key, list });
      list.catch(() => lists.delete(id));
      return list;
    },
    /** What to ask for a chat's replies: this choice with these instructions. Only for a choice that's usable. */
    asker(choice: Choice, system: string): Asker {
      return (messages, signal) => {
        const c = connection(choice.provider);
        return streamReply({ connection: c ?? { name: nameOf(choice.provider), url: "", wire: "openai" }, model: choice.model, effort: choice.effort, system, messages, signal, setup: setupFor(choice.provider) });
      };
    },
    setupFor,
  };
}
