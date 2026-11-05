import { describe, expect, it } from "vitest";
import { readUnlock } from "./chatUnlock";

describe("the link that lets a browser into the chat", () => {
  it("reads on and off, and takes them out of the address", () => {
    expect(readUnlock("?chat=on")).toEqual({ say: "on", search: "" });
    expect(readUnlock("?chat=off")).toEqual({ say: "off", search: "" });
  });

  it("leaves the rest of the address as it was", () => {
    expect(readUnlock("?a=1&chat=on&b=2")).toEqual({ say: "on", search: "?a=1&b=2" });
    expect(readUnlock("?a=1")).toEqual({ search: "?a=1" });
    expect(readUnlock("")).toEqual({ search: "" });
  });

  it("takes nothing else to mean anything", () => {
    expect(readUnlock("?chat=yes")).toEqual({ search: "?chat=yes" });
  });
});
