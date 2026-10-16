import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { System } from "../core/system";
import { createNetModel } from "./model";

describe("net model gesture boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  it("owns the undo boundary and mutations for a selection move", () => {
    createRoot((dispose) => {
      const system = new System().addType({ id: "a", name: "Agent", symbol: "A", arity: 0 });
      const model = createNetModel({ system: () => system });
      const id = model.addAgent("a");
      model.setMode("manual");
      model.clearHistory();
      const before = model.positionOf(id)!;

      model.beginMove([id], []);
      model.moveBy(20, -10);
      model.endMove();

      expect(model.positionOf(id)).toEqual({ ...before, x: before.x + 20, y: before.y - 10 });
      expect(model.historySize()).toEqual({ undo: 1, redo: 0 });

      model.undo();
      expect(model.positionOf(id)).toEqual(before);
      dispose();
    });
  });

  it("previews an auto-layout drag and returns to its computed position without history", () => {
    createRoot((dispose) => {
      const system = new System().addType({ id: "a", name: "Agent", symbol: "A", arity: 0 });
      const model = createNetModel({ system: () => system });
      const id = model.addAgent("a");
      model.clearHistory();
      const before = model.layout().placement.get(id)!;

      model.beginMove([id], []);
      model.moveBy(20, -10);
      expect(model.layout().placement.get(id)).toEqual({ ...before, x: before.x + 20, y: before.y - 10 });
      expect(model.savedPositions()).toEqual([]);

      model.endMove();
      expect(model.layout().placement.get(id)).toEqual(before);
      expect(model.historySize()).toEqual({ undo: 0, redo: 0 });
      dispose();
    });
  });

  it("cancels a manual move with no trace in the history", () => {
    createRoot((dispose) => {
      const system = new System().addType({ id: "a", name: "Agent", symbol: "A", arity: 0 });
      const model = createNetModel({ system: () => system });
      const id = model.addAgent("a");
      model.setMode("manual");
      const before = model.positionOf(id)!;
      const history = model.historySize();

      model.beginMove([id], []);
      model.moveBy(20, -10);
      model.cancelMove();

      expect(model.positionOf(id)).toEqual(before);
      expect(model.historySize()).toEqual(history);
      dispose();
    });
  });

  it("tidies manual positions and keeps the change undoable", () => {
    createRoot((dispose) => {
      const system = new System().addType({ id: "a", name: "Agent", symbol: "A", arity: 0 });
      const model = createNetModel({ system: () => system });
      const id = model.addAgent("a");
      model.setMode("manual");
      const tidyPosition = model.positionOf(id)!;
      model.beginMove([id], []);
      model.moveBy(30, 20);
      model.endMove();
      const moved = model.positionOf(id)!;
      model.clearHistory();

      model.tidy();
      expect(model.mode()).toBe("manual");
      expect(model.positionOf(id)).toEqual(tidyPosition);
      expect(model.historySize()).toEqual({ undo: 1, redo: 0 });

      model.undo();
      expect(model.positionOf(id)).toEqual(moved);
      dispose();
    });
  });

  it("flips several agents as one undoable action", () => {
    createRoot((dispose) => {
      const system = new System().addType({ id: "a", name: "Agent", symbol: "A", arity: 0 });
      const model = createNetModel({ system: () => system });
      const ids = [model.addAgent("a"), model.addAgent("a")];
      model.setMode("manual");
      model.clearHistory();
      const before = ids.map((id) => model.positionOf(id)!.orient);

      model.flipAgents(ids);

      expect(ids.map((id) => model.positionOf(id)!.orient)).toEqual(before.map((o) => (o === "down" ? "up" : "down")));
      expect(model.historySize()).toEqual({ undo: 1, redo: 0 });

      model.undo();
      expect(ids.map((id) => model.positionOf(id)!.orient)).toEqual(before);
      dispose();
    });
  });
});
