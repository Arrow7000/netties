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

      model.beginSelectionMove();
      model.moveSelectionBy([id], [], 20, -10);

      expect(model.positionOf(id)).toEqual({ ...before, x: before.x + 20, y: before.y - 10 });
      expect(model.historySize()).toEqual({ undo: 1, redo: 0 });

      model.undo();
      expect(model.positionOf(id)).toEqual(before);
      dispose();
    });
  });
});
