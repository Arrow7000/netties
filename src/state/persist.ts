import { Net, type NetJSON } from "../core/net";
import { System, type SystemJSON } from "../core/system";
import type { Placed } from "../layout/geometry";

export type LayoutMode = "auto" | "manual";

/** Everything needed to restore a session. */
export interface Doc {
  v: 1;
  system: SystemJSON;
  net: NetJSON;
  mode: LayoutMode;
  /** Agent positions, kept in manual mode only. */
  positions?: [number, Placed][];
}

export function decode(doc: Doc): { system: System; net: Net; mode: LayoutMode; positions: Map<number, Placed> } {
  if (doc.v !== 1) throw new Error(`unknown save format ${doc.v}`);
  return {
    system: System.fromJSON(doc.system),
    net: Net.fromJSON(doc.net),
    mode: doc.mode,
    positions: new Map(doc.positions ?? []),
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

// Share links carry the document deflated and base64url-encoded in the hash.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function toShareHash(doc: Doc): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream("deflate-raw"));
  let bin = "";
  packed.forEach((b) => (bin += String.fromCharCode(b)));
  return "#n=" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function fromShareHash(hash: string): Promise<Doc | undefined> {
  const m = /^#n=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return undefined;
  try {
    const bin = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = await pipe(bytes, new DecompressionStream("deflate-raw"));
    return JSON.parse(new TextDecoder().decode(json)) as Doc;
  } catch {
    return undefined;
  }
}
