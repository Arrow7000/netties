import { describe, expect, it } from "vitest";
import { Net } from "../core/net";
import { System } from "../core/system";
import { type Doc, arrival, fromShareHash, sharePushes, toShareHash } from "./persist";

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
