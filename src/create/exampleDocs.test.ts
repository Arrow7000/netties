import { describe, expect, it } from "vitest";
import { examples } from "../core/examples";
import { checkDocument } from "./check";
import { exampleIndex, examplesReply, namesAskedFor } from "./exampleDocs";
import { EXAMPLE_INDEX } from "./prompt";

describe("the examples the model can look at", () => {
  // The server's prompt can't import the examples, since the edge function's bundler can't follow what they import.
  it("are listed in the prompt exactly as they are in the app", () => {
    expect(EXAMPLE_INDEX).toBe(exampleIndex());
  });

  it("can each be read back as a document that parses", () => {
    for (const ex of examples) {
      const reply = examplesReply([ex.name]);
      const doc = /```inet\n([\s\S]*?)```/.exec(reply)?.[1];
      expect(doc, ex.name).toBeDefined();
      expect(checkDocument(doc!).kind, ex.name).not.toBe("wrong");
    }
  });

  it("are asked for with a block of names, however they're written", () => {
    expect(namesAskedFor("```examples\nrange(5)\n- Sort a list\n\n```")).toEqual(["range(5)", "Sort a list"]);
    expect(namesAskedFor("Let me look.\n\n```examples\nrange(5)\n```")).toEqual(["range(5)"]);
  });

  it("are asked for just the same in a block marked as something else, as long as it holds nothing else", () => {
    expect(namesAskedFor("```text\nFind the primes\n```\n\n```text\nMap a function\n```")).toEqual(["Find the primes", "Map a function"]);
    expect(namesAskedFor("```\nrange(5)\n```")).toEqual(["range(5)"]);
    expect(namesAskedFor("Try this:\n\n```text\nnot an example\n```")).toBeUndefined();
    expect(namesAskedFor("```text\nrange(5)\nand then some\n```")).toBeUndefined();
  });

  it("aren't asked for by a reply with a document in it, or none", () => {
    expect(namesAskedFor("Here.\n\n```inet\nagent A 0\n```\n\n```examples\nrange(5)\n```")).toBeUndefined();
    expect(namesAskedFor("Just words about examples.")).toBeUndefined();
  });

  it("answer to any capitalisation, and say so when a name is wrong", () => {
    expect(examplesReply(["SORT A LIST"])).toContain("```inet");
    const reply = examplesReply(["Nope", "range(5)"]);
    expect(reply).toContain('no example called "Nope"');
    expect(reply).toContain("# range(5)");
    expect(examplesReply([])).toContain("didn't name any");
  });

  it("can go by a clear part of their name, but not one that could mean several", () => {
    expect(examplesReply(["Fibonacci"])).toContain("# Fibonacci: 6 → 8");
    expect(examplesReply(["list"])).toContain('no example called "list"');
  });
});
