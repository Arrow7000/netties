import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentType, port } from "../core/net";
import { examples } from "../core/examples";
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

  it("does not let the Net tab close the floating agent editor", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      ed.openAgent("new");

      ed.closeTranslate();

      expect(ed.screen()).toEqual({ kind: "agent", id: "new" });
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

  it("undoes a system edit and the net repairs it caused together", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      ed.addType({ id: "a", name: "A", symbol: "A", arity: 0, ports: [{ type: "x" }] });
      ed.addType({ id: "b", name: "B", symbol: "B", arity: 0, ports: [{ type: "x" }] });
      ed.setTyping({ types: "optional" });
      const a = ed.model.addAgent("a");
      const b = ed.model.addAgent("b");
      ed.model.connect(port(a, 0), port(b, 0));
      ed.model.clearHistory();

      ed.updateType("b", { name: "B", symbol: "B", arity: 0, ports: [{ type: "y" }] });
      expect(ed.net.free.size).toBe(2);
      expect(ed.model.historySize()).toEqual({ undo: 1, redo: 0 });

      ed.dispatch({ kind: "history/undo" });
      expect(ed.system.type("b").ports?.[0]?.type).toBe("x");
      expect(ed.net.free.size).toBe(0);
      expect(ed.net.wires.size).toBe(1);
      dispose();
    });
  });

  it("deletes the rules of pairs that a port change stops from meeting, undoably", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      ed.addType({ id: "a", name: "A", symbol: "A", arity: 0, ports: [{ pol: "give" }] });
      ed.addType({ id: "b", name: "B", symbol: "B", arity: 0, ports: [{ pol: "take" }] });
      ed.setTyping({ dirs: "optional" });
      ed.saveRule({ left: "a", right: "b", agents: [], wires: [] });
      ed.model.clearHistory();

      expect(ed.unmeetable("b", [{ pol: "give" }]).map((r) => r.left + r.right)).toEqual(["ab"]);
      expect(ed.unmeetable("b", [{ pol: "take" }])).toEqual([]);

      ed.setPort("b", 0, { pol: "give" });
      expect(ed.system.ruleFor("a", "b")).toBeUndefined();
      expect(ed.message()).toBe("Deleted the rule for A with B, which can no longer meet.");
      expect(ed.model.historySize()).toEqual({ undo: 1, redo: 0 });

      ed.dispatch({ kind: "history/undo" });
      expect(ed.system.type("b").ports?.[0]?.pol).toBe("take");
      expect(ed.system.ruleFor("a", "b")).toBeDefined();
      dispose();
    });
  });

  it("resets an unchanged example after stepping, but not after editing it", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      const ex = examples.find((e) => e.name === "3 + 2")!;
      ed.loadExample(ex);
      const start = ed.toDoc().net;
      expect(ed.canResetExample()).toBe(false);

      ed.stepAll();
      expect(ed.canResetExample()).toBe(true);
      ed.resetExample();
      expect(ed.toDoc().net).toEqual(start);
      expect(ed.steps()).toBe(0);
      expect(ed.canResetExample()).toBe(false);

      ed.stepAll();
      ed.model.addAgent("0");
      expect(ed.canResetExample()).toBe(false);
      ed.model.undo();
      expect(ed.canResetExample()).toBe(true);
      dispose();
    });
  });

  it("offers a one-click reset after Run finishes", () => {
    vi.useFakeTimers();
    try {
      createRoot((dispose) => {
        const ed = createEditor(undefined);
        ed.loadExample(examples.find((e) => e.name === "3 + 2")!);
        const start = ed.toDoc().net;
        ed.run();
        vi.runAllTimers();
        expect(ed.running()).toBe(false);
        expect(ed.steps()).toBeGreaterThan(0);
        expect(ed.canResetExample()).toBe(true);
        ed.resetExample();
        expect(ed.toDoc().net).toEqual(start);
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
