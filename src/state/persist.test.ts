import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { Net } from "../core/net";
import { System } from "../core/system";
import { sharePayload } from "./shareFormat";
import { type Doc, arrival, fromShareHash, loadInitialDoc, SHARE_LOAD_ERROR, sharePushes, toShareHash } from "./persist";

const doc = (): Doc => ({ v: 1, system: new System().toJSON(), net: new Net().toJSON(), mode: "auto" });

describe("going back and forward between links", () => {
  it("leaves the net alone at an address with no net in it", () => {
    expect(arrival("", undefined, "x")).toBe("no-net");
    expect(arrival("#about", undefined, "x")).toBe("no-net");
  });

  it("says so when the link can't be read", () => {
    expect(arrival("#n=garbled", undefined, "x")).toBe("unreadable");
  });

  it("loads a link's net, unless it's the one showing", async () => {
    const d = doc();
    const hash = await toShareHash(d);
    const read = await fromShareHash(hash);
    // A link made from what's showing reads back as the same fingerprint.
    expect(arrival(hash, read, JSON.stringify(d))).toBe("showing");
    expect(arrival(hash, read, JSON.stringify({ ...d, mode: "manual" }))).toBe("load");
  });

  it("pushes a new entry only when the link is new", () => {
    expect(sharePushes("", "#n=abc")).toBe(true);
    expect(sharePushes("#n=abc", "#n=def")).toBe(true);
    expect(sharePushes("#n=abc", "#n=abc")).toBe(false);
  });
});


describe("share link versions", () => {
  const hashFor = (prefix: string, payload: unknown) => prefix + deflateRawSync(JSON.stringify(payload)).toString("base64url");

  it("writes an upfront version and reads it directly", async () => {
    const d = doc();
    const hash = await toShareHash(d);
    expect(hash).toMatch(/^#n=2\.[A-Za-z0-9_-]+$/);
    expect(sharePayload((await fromShareHash(hash))!)).toEqual(sharePayload(d));
  });

  it("reads original unprefixed JSON links", async () => {
    const d = doc();
    expect(await fromShareHash(hashFor("#n=", d))).toEqual(d);
  });

  it("rejects unsupported versions before attempting decompression", async () => {
    const decompress = vi.spyOn(globalThis, "DecompressionStream");
    try {
      expect(await fromShareHash("#n=1.abc")).toBeUndefined();
      expect(await fromShareHash("#n=3.abc")).toBeUndefined();
      expect(await fromShareHash("#n=999.abc")).toBeUndefined();
      expect(decompress).not.toHaveBeenCalled();
    } finally {
      decompress.mockRestore();
    }
  });

  it("does not fall back when the prefix disagrees with the payload", async () => {
    expect(await fromShareHash(hashFor("#n=2.", doc()))).toBeUndefined();
    expect(await fromShareHash(hashFor("#n=", sharePayload(doc())))).toBeUndefined();
    expect(await fromShareHash(hashFor("#n=2.", [3, ""]))).toBeUndefined();
  });
});


describe("initial share-link loading (direct visits and refreshes)", () => {
  it("reports malformed or unsupported links and retains the local document", async () => {
    const local = doc();
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(local) });
    try {
      for (const hash of ["#n=", "#n=garbled", "#n=2.garbled", "#n=999.abc"]) {
        expect(await loadInitialDoc(hash)).toEqual({ doc: local, fromLink: false, error: SHARE_LOAD_ERROR });
      }
      const broken = "#n=" + deflateRawSync(JSON.stringify({ v: 1 })).toString("base64url");
      expect(await loadInitialDoc(broken)).toEqual({ doc: local, fromLink: false, error: SHARE_LOAD_ERROR });
    } finally { vi.unstubAllGlobals(); }
  });

  it("reports invalid links even when no local document exists", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    try {
      expect(await loadInitialDoc("#n=2.invalid")).toEqual({ doc: undefined, fromLink: false, error: SHARE_LOAD_ERROR });
      for (const hash of ["", "#about"]) {
        expect(await loadInitialDoc(hash)).toEqual({ doc: undefined, fromLink: false });
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("loads original and current valid links without an error", async () => {
    const d = doc();
    const original = "#n=" + deflateRawSync(JSON.stringify(d)).toString("base64url");
    for (const hash of [original, await toShareHash(d)]) {
      const initial = await loadInitialDoc(hash);
      expect(initial.error).toBeUndefined();
      expect(initial.fromLink).toBe(true);
      expect(sharePayload(initial.doc!)).toEqual(sharePayload(d));
    }
  });
});
