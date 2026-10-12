import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentType } from "../core/net";
import { createEditor } from "./editor";

const unary: AgentType = { id: "u", name: "Unary", symbol: "U", arity: 1 };

describe("editor update boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  it("represents the active workspace as one mutually exclusive state", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);

      ed.openTypes();
      expect(ed.screen()).toEqual({ kind: "types" });

      ed.openRule("a", "b");
      expect(ed.screen()).toEqual({ kind: "rule", left: "a", right: "b" });

      ed.closeRule();
      expect(ed.screen()).toEqual({ kind: "net" });
      dispose();
    });
  });

  it("keeps guarded navigation in the central dispatcher", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      ed.addType(unary);
      ed.model.addAgent(unary.id);

      ed.dispatch({ kind: "screen/open", screen: { kind: "translation" } });

      expect(ed.screen()).toEqual({ kind: "net" });
      expect(ed.message()).toBe("Wire up every port before translating.");
      dispose();
    });
  });

  it("records a system edit as one complete undoable transaction", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);

      ed.addType(unary);
      expect(ed.system.types.has(unary.id)).toBe(true);
      expect(ed.model.historySize()).toEqual({ undo: 1, redo: 0 });

      ed.dispatch({ kind: "history/undo" });
      expect(ed.system.types.has(unary.id)).toBe(false);
      expect(ed.model.historySize()).toEqual({ undo: 0, redo: 1 });
      dispose();
    });
  });
});
