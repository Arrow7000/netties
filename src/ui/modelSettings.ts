import { createSignal } from "solid-js";
import { webSearchTool } from "../create/search";
import type { Asker } from "../create/chat";
import { CUSTOM, type Connection, type Effort, type ModelInfo, ModelError, type Preset, PRESETS, type Wire, listModels, localSetup, normalizeUrl, streamReply } from "../create/provider";

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
  /** Enabled unless explicitly switched off, where search is configured. */
  webSearch?: boolean;
  provider: string;
  model: string;
  effort: Effort;
}

/** The hosted search tool to offer; an absent preference means on. */
export function searchFor(choice: Choice | undefined, fallback = false): "anthropic" | "openrouter" | "tavily" | undefined {
  if (!choice || choice.webSearch === false) return undefined;
  return choice?.provider === "anthropic" || choice?.provider === "openrouter" ? choice.provider : fallback ? "tavily" : undefined;
}

export interface ProviderEntry {
  key?: string;
  /** Overrides the provider's own address: for a custom one, or a local server on another port. */
  url?: string;
  wire?: Wire;
  /** The model last saved for it. Picks in a chat stay with that chat. */
  model?: string;
}

interface Stored {
  searchKey?: string;
  providers: Record<string, ProviderEntry>;
  default?: Choice;
  /** The reasoning levels that models have turned down, as provider, model and level. */
  noLevel?: string[];
}

const levelKey = (provider: string, model: string, effort: Effort) => `${provider}/${model}#${effort}`;

/** A pretend provider, with no cost, only under `npm run dev` (scripts/fakeModel.ts). */
const devPresets = (): Preset[] => (import.meta.env.DEV && typeof location !== "undefined" ? [{ id: "fake", name: "Pretend model (dev only)", short: "Pretend model", url: `${location.origin}/dev-model/v1`, wire: "openai", local: true, example: "fake-writer" }] : []);

export const presetsHere = (): Preset[] => [...PRESETS, ...devPresets()];

/** What a model's name looks like on a provider, for a field waiting for one. */
export const nameHint = (id: string) => {
  if (id === CUSTOM) return "Exactly as your server names it";
  const example = presetsHere().find((p) => p.id === id)?.example;
  return example ? `e.g. ${example}` : "The model's name";
};

/** What to call a provider in a sentence. */
export const nameOf = (id: string) => {
  if (id === CUSTOM) return "Custom address";
  const p = presetsHere().find((x) => x.id === id);
  return p?.short ?? p?.name ?? id;
};

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as Partial<Stored>) : undefined;
    return { providers: got?.providers ?? {}, default: got?.default, noLevel: got?.noLevel, searchKey: got?.searchKey };
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

  /** How to reach a provider, given what's filled in for it, or just to ask what it has. It may not be usable yet. */
  const connect = (id: string, entry: ProviderEntry | undefined, onlyToList = false): Connection | undefined => {
    const preset = presetsHere().find((p) => p.id === id);
    if (id !== CUSTOM && !preset) return undefined;
    const url = normalizeUrl(entry?.url ?? preset?.url ?? "");
    if (!url) return undefined;
    if (preset?.needsKey && !entry?.key && !(onlyToList && preset.openList)) return undefined;
    return { name: nameOf(id), url: preset && !preset.local ? preset.url : url, wire: preset?.wire ?? entry?.wire ?? "openai", key: entry?.key || undefined, extra: preset?.extra, maxTokens: preset?.maxTokens, keyCheck: preset?.keyCheck };
  };

  /** A provider the visitor has set up, if this one is. */
  const connection = (id: string) => {
    const entry = stored().providers[id];
    return entry ? connect(id, entry) : undefined;
  };

  const usable = (c: Choice | undefined): c is Choice => !!c && !!c.model && !!connection(c.provider);

  const setupFor = (id: string) => (typeof location === "undefined" ? undefined : localSetup(id, location.origin));

  const lists = new Map<string, { at: number; url: string; key?: string; list: Promise<ModelInfo[]> }>();
  /** What the lists that have come in said, to know what a model takes without asking again. */
  const [listed, setListed] = createSignal<Record<string, ModelInfo[]>>({});
  const imageSupport = (choice: Choice | undefined) => choice ? listed()[choice.provider]?.find((m) => m.id === choice.model)?.images : undefined;
  const levels = (provider: string, model: string) => listed()[provider]?.find((m) => m.id === model)?.levels;
  const refusesLevel = (provider: string, model: string, effort: Effort) => !!stored().noLevel?.includes(levelKey(provider, model, effort));

  /** The level a choice comes to. One this model is known not to take isn't asked for, and it goes by its own, while the chat keeps its choice for the next model. */
  const effective = (c: Choice): Effort => {
    if (c.effort === "default") return "default";
    const known = levels(c.provider, c.model);
    return (known && !known.includes(c.effort)) || refusesLevel(c.provider, c.model, c.effort) ? "default" : c.effort;
  };

  return {
    imageSupport,
    searchKey: () => stored().searchKey ?? "",
    saveSearchKey: (key: string) => write({ ...stored(), searchKey: key.trim() || undefined }),
    searchMode: (choice: Choice | undefined) => searchFor(choice, !!stored().searchKey),
    entry: (id: string) => stored().providers[id],
    connect,
    /** The providers set up so far. */
    ready: () => Object.keys(stored().providers).filter((id) => connection(id)),
    /** The choice for new chats. If its provider has stopped being usable, it's a provider that still is, rather than asking all over again. */
    defaults: (): Choice | undefined => {
      const d = stored().default;
      if (d && usable(d)) return d;
      const other = Object.keys(stored().providers).find((id) => connection(id) && stored().providers[id]!.model);
      return other ? { provider: other, model: stored().providers[other]!.model!, effort: stored().default?.effort ?? "default" } : d;
    },
    usable,
    /** Keep what was filled in for a provider, and make this the choice for new chats unless told it's only being put right. */
    save(id: string, entry: ProviderEntry, effort: Effort, asDefault = true) {
      const had = stored().default;
      write({ ...stored(), providers: { ...stored().providers, [id]: entry }, default: asDefault || !had ? { provider: id, model: entry.model ?? "", effort } : { ...had, effort } });
    },
    /** Forget a provider's key, keeping its address and model for when there's another. */
    forgetKey(id: string) {
      const entry = stored().providers[id];
      if (!entry) return;
      const { key: _gone, ...kept } = entry;
      lists.delete(id);
      write({ ...stored(), providers: { ...stored().providers, [id]: kept } });
    },
    /** Remove a provider altogether, so a server that's gone doesn't stay in the menu. What was said with it stays. */
    remove(id: string) {
      const { [id]: _gone, ...providers } = stored().providers;
      lists.delete(id);
      write({ ...stored(), providers, default: stored().default?.provider === id ? undefined : stored().default });
    },
    levels,
    effective,
    refusesLevel,
    /** This model has turned down this reasoning level. */
    refusedLevel(provider: string, model: string, effort: Effort) {
      if (!refusesLevel(provider, model, effort)) write({ ...stored(), noLevel: [...(stored().noLevel ?? []), levelKey(provider, model, effort)] });
    },
    /** Give a level that was turned down another go, as what a model takes can change. */
    forgetRefusal(provider: string, model: string, effort: Effort) {
      if (refusesLevel(provider, model, effort)) write({ ...stored(), noLevel: stored().noLevel!.filter((k) => k !== levelKey(provider, model, effort)) });
    },
    /** What a provider that's set up has to offer, from a recent list if there is one. */
    models(id: string): Promise<ModelInfo[]> {
      const c = connection(id);
      if (!c) return Promise.resolve([]);
      const had = lists.get(id);
      if (had && had.url === c.url && had.key === c.key && Date.now() - had.at < LIST_MS) return had.list;
      const list = listModels(c, { setup: setupFor(id) });
      lists.set(id, { at: Date.now(), url: c.url, key: c.key, list });
      list.then(
        (got) => setListed((had) => ({ ...had, [id]: got })),
        () => lists.delete(id),
      );
      return list;
    },
    /** What to ask for a chat's replies: this choice with these instructions. Only for a choice that's usable. */
    asker(choice: Choice, system: string): Asker {
      return async function* (messages, signal) {
        if (messages.some((m) => m.images?.length) && imageSupport(choice) === false) throw new ModelError("model", `${choice.model} doesn't accept images. Choose a model that accepts images, or start a text-only chat.`);
        const c = connection(choice.provider);
        const search = searchFor(choice, !!stored().searchKey);
        yield* streamReply({ connection: c ?? { name: nameOf(choice.provider), url: "", wire: "openai" }, model: choice.model, effort: effective(choice), system, messages, signal, webSearch: search === "tavily" ? undefined : search, tools: search === "tavily" ? [webSearchTool(stored().searchKey!)] : undefined, setup: setupFor(choice.provider) });
      };
    },
    setupFor,
  };
}
