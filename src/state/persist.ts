import { readSharePayload, sharePayload } from "./shareFormat";
import { type ComponentDef, Groups, type GroupsJSON } from "../core/groups";
import { Net, type NetJSON } from "../core/net";
import { System, type SystemJSON } from "../core/system";
import type { Placed } from "../layout/geometry";
import type { LayoutMode } from "./model";

export type { LayoutMode };

/** Everything needed to restore a session. */
export interface Doc {
  v: 1;
  system: SystemJSON;
  net: NetJSON;
  mode: LayoutMode;
  /** Agent positions, kept in manual mode only. */
  positions?: [number, Placed][];
  components?: ComponentDef[];
  groups?: GroupsJSON;
}

export function decode(doc: Doc) {
  if (doc.v !== 1) throw new Error(`unknown save format ${doc.v}`);
  return {
    system: System.fromJSON(doc.system),
    net: Net.fromJSON(doc.net),
    mode: doc.mode,
    positions: new Map(doc.positions ?? []),
    components: doc.components ?? [],
    groups: Groups.fromJSON(doc.groups),
  };
}

const STORAGE_KEY = "netties:doc";

export function saveLocal(doc: Doc) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage can be full or blocked; the session just won't persist.
  }
}

export function loadLocal(): Doc | undefined {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? (JSON.parse(s) as Doc) : undefined;
  } catch {
    return undefined;
  }
}

export const SHARE_LOAD_ERROR = "Couldn't load the net from the URL.";

/** Initial visits and refreshes report the same error as hash navigation,
 * while retaining the last local document as a fallback. */
export async function loadInitialDoc(hash: string): Promise<{ doc?: Doc; fromLink: boolean; error?: string }> {
  if (hash.startsWith("#n=")) {
    const linked = await fromShareHash(hash);
    if (linked) {
      try {
        decode(linked);
        return { doc: linked, fromLink: true };
      } catch {
        // A legacy JSON payload may parse but fail to restore as a document.
      }
    }
    return { doc: loadLocal(), fromLink: false, error: SHARE_LOAD_ERROR };
  }
  return { doc: loadLocal(), fromLink: false };
}

// #n=2.<base64url> selects the text format before decompression.
// Unprefixed links select the original JSON format; neither decoder falls back.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function toShareHash(doc: Doc): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(sharePayload(doc))), new CompressionStream("deflate-raw"));
  let bin = "";
  packed.forEach((b) => (bin += String.fromCharCode(b)));
  return "#n=2." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function fromShareHash(hash: string): Promise<Doc | undefined> {
  const m = /^#n=(?:(\d+)\.)?([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return undefined;
  const version = m[1];
  if (version !== undefined && version !== "2") return undefined;
  try {
    const bin = atob(m[2]!.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = await pipe(bytes, new DecompressionStream("deflate-raw"));
    const payload: unknown = JSON.parse(new TextDecoder().decode(json));
    if (version === "2") return readSharePayload(payload);
    if (payload && !Array.isArray(payload) && typeof payload === "object" && "v" in payload && payload.v === 1) return payload as Doc;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * What going back or forward to an address (`hash`, holding `doc` once
 * read) does to the net showing, whose fingerprint is `here`: nothing, with
 * no net in the address, as it's only the address that changed; nothing
 * either if its net is the one showing; otherwise its net is loaded, as a
 * step that can be undone, so nothing is lost by going back.
 */
export function arrival(hash: string, doc: Doc | undefined, here: string): "no-net" | "unreadable" | "showing" | "load" {
  if (!hash.startsWith("#n=")) return "no-net";
  if (!doc) return "unreadable";
  if (JSON.stringify(doc) === here) return "showing";
  try {
    return JSON.stringify(sharePayload(doc)) === JSON.stringify(sharePayload(JSON.parse(here) as Doc)) ? "showing" : "load";
  } catch {
    return "load";
  }
}

/** Whether sharing makes a new history entry: not when the address holds that link already. */
export const sharePushes = (current: string, hash: string) => current !== hash;
