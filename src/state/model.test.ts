import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Net, NONE, free, port } from "../core/net";
import { interfaceNet, interfacePins, parseIface } from "../core/ruleNet";
import { System } from "../core/system";
import { flip, specOf } from "../core/types";
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

  it("plugs a new agent onto a loose end, not into the port the loose end's wire comes from", () => {
    createRoot((dispose) => {
      const system = new System()
        .addType({ id: "s", name: "S", symbol: "S", arity: 1, ports: [{ pol: "give" }, { pol: "take" }] })
        .addType({ id: "z", name: "Z", symbol: "Z", arity: 0, ports: [{ pol: "give" }] });
      system.typing = { dirs: "optional", types: "off", names: [] };
      const net = new Net();
      const s = net.addAgent(system.type("s"));
      net.connect(port(s, 1), free("x"));
      const model = createNetModel({ system: () => system });
      model.setNet(net);

      // Z gives, so it fits the loose end (whose wire comes from S's aux port, which takes) but not S's principal (which gives).
      const ends = model.attachEnds("z");
      expect(ends.map((c) => [c.end.kind === "port" ? `port ${c.end.slot}` : c.end.name, c.fits])).toEqual([
        ["port 0", false],
        ["x", true],
      ]);
      const at = model.layout().routed.free.get("x")!;
      expect(model.attachTarget("z", { x: at.x + 3, y: at.y })).toEqual({ end: free("x"), slot: 0 });

      const z = model.addAgent("z", at, { end: free("x"), slot: 0 });
      expect(model.net.free.size).toBe(0);
      expect(model.net.partner(port(z, 0))).toEqual(port(s, 1));
      dispose();
    });
  });
  it("plugs a new agent onto a rule's interface end, which stays, if it fits what the end stands for", () => {
    createRoot((dispose) => {
      const system = new System()
        .addType({ id: "s", name: "S", symbol: "S", arity: 1, ports: [{ pol: "give" }, { pol: "take" }] })
        .addType({ id: "t", name: "T", symbol: "T", arity: 0, ports: [{ pol: "take" }] })
        .addType({ id: "z", name: "Z", symbol: "Z", arity: 0, ports: [{ pol: "give" }] });
      system.typing = { dirs: "optional", types: "off", names: [] };
      // As the rule editor has it: x₁ stands for what was plugged into S's aux port, which took, so it gives.
      const freeSpec = (name: string) => {
        const i = parseIface(name);
        return i ? flip(specOf(system, i.side === 0 ? "s" : "t", i.slot)) : undefined;
      };
      const pins = interfacePins(system, "s", "t");
      const model = createNetModel({ system: () => system, pins: () => pins, surface: "rule", freeSpec });
      model.setNet(interfaceNet(system, "s", "t"));
      const [x1] = pins.top;

      expect(model.attachEnds("z").map((c) => [c.end.kind === "free" && c.end.name, c.fits])).toEqual([[x1, false]]);
      expect(model.attachEnds("t").map((c) => [c.end.kind === "free" && c.end.name, c.fits])).toEqual([[x1, true]]);

      const n = model.addAgent("t", undefined, { end: free(x1!), slot: 0 });
      expect(model.net.free.has(x1!)).toBe(true);
      expect(model.net.partner(free(x1!))).toEqual(port(n, 0));
      // Wired now, it's no longer somewhere to plug in.
      expect(model.attachEnds("t")).toEqual([]);
      dispose();
    });
  });
});

describe("closing a loop by hand", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  it("joins a wire's two loose ends, undoably, and the loop can be deleted and copied", () => {
    createRoot((dispose) => {
      const model = createNetModel({ system: () => new System() });
      const net = new Net();
      const w = net.connect(free("a"), free("b"));
      model.setNet(net);
      const g = model.gestureAt(free("a"));
      expect(model.checkDrop(g, free("a")).kind).toBe("back");
      expect(model.checkDrop(g, free("b")).kind).toBe("ok");
      expect(model.previewWire(g, free("b"), { x: 0, y: 0 })).toBeDefined();
      model.finishGesture(g, free("b"));
      expect([...model.net.loops]).toEqual([w]);
      expect([model.net.wires.size, model.net.free.size]).toEqual([0, 0]);
      model.selectAll();
      expect(model.copySelection()?.net.loops.size).toBe(1);
      model.deleteSelection();
      expect(model.net.loops.size).toBe(0);
      model.undo();
      expect(model.net.loops.size).toBe(1);
      model.undo();
      expect(model.net.partner(free("a"))).toEqual(free("b"));
      dispose();
    });
  });

  it("still refuses the other end of a wire from a port, and a rule's interface ends", () => {
    createRoot((dispose) => {
      const net = new Net();
      net.connect(free("L1"), free("R1"));
      const model = createNetModel({ system: () => new System(), surface: "rule" });
      model.setNet(net);
      expect(model.checkDrop(model.gestureAt(free("L1")), free("R1")).kind).toBe("refuse");
      dispose();
    });
  });
});

describe("pulling a loop apart at its weld", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  const start = (mode: "auto" | "manual" = "auto") => {
    const system = new System();
    system.addType({ id: "D", name: "D", symbol: "D", arity: 1 });
    const model = createNetModel({ system: () => system });
    const net = new Net();
    const d = net.addAgent(system.type("D"));
    const loop = net.addLoop();
    const other = net.addLoop();
    net.free.set("a", NONE);
    model.setNet(net);
    if (mode === "manual") model.setMode("manual");
    return { model, d, loop, other };
  };
  const pt = { x: 200, y: 90 };

  it("leaves two loose ends when let go over nothing, in one undoable edit", () => {
    for (const mode of ["auto", "manual"] as const)
      createRoot((dispose) => {
        const { model, loop, other } = start(mode);
        const weld = model.weldAt(loop)!;
        const g = model.gestureAtWeld(loop);
        // Only held so far: it's still a loop, and the wire runs from its weld.
        expect(model.net.loops.has(loop)).toBe(true);
        expect(model.previewWire(g, undefined, pt)!.map(({ x, y }) => [x, y])).toContainEqual([weld.x, weld.y]);
        const undos = model.historySize().undo;
        model.finishGesture(g, undefined, { path: model.previewWire(g, undefined, pt), at: pt });
        expect([...model.net.loops]).toEqual([other]);
        expect(model.net.wire(loop).ends).toEqual([free("b"), free("c")]);
        expect(model.historySize().undo).toBe(undos + 1);
        model.undo();
        expect([...model.net.loops]).toEqual([loop, other]);
        expect([...model.net.free.keys()]).toEqual(["a"]);
        expect(model.weldAt(loop)).toEqual(weld);
        dispose();
      });
  });

  it("connects to a port or joins another loose end", () => {
    createRoot((dispose) => {
      const { model, d, loop, other } = start();
      model.finishGesture(model.gestureAtWeld(loop), port(d, 1));
      expect(model.net.partner(port(d, 1))).toEqual(free("b"));
      const g = model.gestureAtWeld(other);
      expect(model.checkDrop(g, free("b"))).toEqual({ kind: "ok", join: true });
      model.finishGesture(g, free("b"));
      expect(model.net.partner(port(d, 1))).toEqual(free("c"));
      expect([model.net.loops.size, model.net.wires.size]).toEqual([0, 1]);
      model.undo();
      model.undo();
      expect(model.net.loops.size).toBe(2);
      dispose();
    });
  });

  it("stays a loop when dropped back on its other end, called off, or dropped where it can't go", () => {
    createRoot((dispose) => {
      const { model, d, loop, other } = start();
      model.finishGesture(model.gestureAtWeld(other), port(d, 0));
      const undos = model.historySize().undo;
      const g = model.gestureAtWeld(loop);
      const anchor = g.kind === "carry" ? g.anchor : free("?");
      expect(model.checkDrop(g, anchor)).toEqual({ kind: "ok", join: false });
      model.finishGesture(g, anchor);
      model.returnWire(g, { path: model.previewWire(g, undefined, pt), at: pt });
      expect(model.checkDrop(g, port(d, 0)).kind).toBe("refuse");
      model.finishGesture(g, port(d, 0));
      expect([...model.net.loops]).toEqual([loop]);
      expect(model.historySize().undo).toBe(undos);
      dispose();
    });
  });
});
