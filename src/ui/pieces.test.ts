import { describe, expect, it } from "vitest";
import { pieces } from "./pieces";

/** What the pieces show when each is a block of its own: a block boundary is a line break. */
const shown = (ps: string[], text: string) => {
  // Cuts at a space or mid-word lose nothing, so they join straight; cuts at a line break gave up that line break.
  let at = 0;
  return ps
    .map((p, i) => {
      at += p.length;
      if (text[at] === "\n" && i < ps.length - 1) {
        at++;
        return p + "\n";
      }
      return p;
    })
    .join("");
};

describe("pieces", () => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `Line ${i} of the reasoning, going on for a while about agents and ports.${i % 7 === 0 ? "\n" : ""}\n`).join("");

  it("leaves short text whole", () => {
    expect(pieces("")).toEqual([""]);
    expect(pieces("a short thought\nand another")).toEqual(["a short thought\nand another"]);
  });

  it("loses nothing", () => {
    for (const text of [paragraphs, paragraphs + "no line break at the end", "word ".repeat(3000), "x".repeat(10_000), "\n".repeat(2000)]) {
      expect(shown(pieces(text), text)).toBe(text);
    }
  });

  it("keeps pieces small, however the text runs", () => {
    for (const text of [paragraphs.repeat(20), "word ".repeat(10_000), "x".repeat(50_000)]) {
      const ps = pieces(text);
      expect(ps.length).toBeGreaterThan(1);
      expect(Math.max(...ps.map((p) => p.length))).toBeLessThanOrEqual(4000);
    }
  });

  it("cuts at line breaks when it can", () => {
    const ps = pieces(paragraphs);
    expect(ps.length).toBeGreaterThan(1);
    expect(ps.slice(0, -1).every((p) => p.endsWith(".") || p.endsWith("\n"))).toBe(true);
  });

  it("never changes a finished piece as more comes in", () => {
    for (const text of [paragraphs.repeat(3), "word ".repeat(3000), "x".repeat(12_000)]) {
      let before: string[] = [];
      for (let n = 0; n <= text.length; n += 37) {
        const now = pieces(text.slice(0, n));
        expect(now.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
        before = now;
      }
    }
  });
});
