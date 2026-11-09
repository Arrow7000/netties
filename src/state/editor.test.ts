import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentType, port } from "../core/net";
import { examples } from "../core/examples";
import { setPortOn, setTypingOn } from "../core/types";
import { SPEEDS, createEditor, nearestSpeed } from "./editor";
import { parseProgram } from "../core/programText";

const unary: AgentType = { id: "u", name: "Unary", symbol: "U", arity: 1 };

describe("editor update boundary", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("requestAnimationFrame", () => 0);
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

  it("changes nothing while a draft of the directions and types is edited, then saves it as one step", () => {
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      ed.addType({ id: "a", name: "A", symbol: "A", arity: 0, ports: [{ pol: "give" }] });
      ed.addType({ id: "b", name: "B", symbol: "B", arity: 0, ports: [{ pol: "take" }] });
      ed.setTyping({ dirs: "optional" });
      ed.saveRule({ left: "a", right: "b", agents: [], wires: [] });
      const a = ed.model.addAgent("a");
      const b = ed.model.addAgent("b");
      ed.model.connect(port(a, 0), port(b, 0));
      ed.model.clearHistory();

      const draft = ed.draftSystem();
      setPortOn(draft, "b", 0, { pol: "give" });
      setTypingOn(draft, { types: "optional" });
      expect(ed.system.type("b").ports?.[0]?.pol).toBe("take");
      expect(ed.system.typing.types).toBe("off");
      const fx = ed.draftEffects(draft);
      expect(fx.wires).toHaveLength(1);
      expect(fx.rules.map((r) => r.left + r.right)).toEqual(["ab"]);

      ed.applyTyping(draft);
      expect(ed.system.type("b").ports?.[0]?.pol).toBe("give");
      expect(ed.system.typing.types).toBe("optional");
      expect(ed.system.ruleFor("a", "b")).toBeUndefined();
      expect(ed.net.free.size).toBe(2);
      expect(ed.model.historySize()).toEqual({ undo: 1, redo: 0 });
      dispose();
    });
  });

  it("loads and copies component text, including types used only by its definition", () => {
    createRoot(dispose => {
      const program = parseProgram(`agent A 0
agent B 0
component "c" "C" "component" ports ["p1"]
p1 ~ B;
end
out ~ A;
instance "c" parent - expanded members [0] ports [["p1",0,0]];
`);
      const ed = createEditor(undefined);
      ed.loadParsed(program.system, program.net, program.components, program.groups);
      expect(ed.toDoc().components).toHaveLength(1);
      expect(ed.model.groups.groups.size).toBe(1);
      ed.model.selectAll();
      const copied = ed.copySelection()!;
      const parsed = parseProgram(copied.text);
      expect(parsed.system.types.has("B")).toBe(true);
      expect(parsed.components[0]!.net.agents[0]!.type).toBe("B");
      expect([...parsed.groups.groups.values()][0]!.collapsed).toBe(false);
      const into = createEditor(undefined);
      expect(into.paste(parsed, { x: 0, y: 0 })).toBeUndefined();
      expect(into.toDoc().components).toHaveLength(1);
      expect(into.model.groups.groups.size).toBe(1);
      expect(into.net.agents.size).toBe(1);
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

describe("the speed of a run", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 16));
    vi.stubGlobal("cancelAnimationFrame", (t: ReturnType<typeof setTimeout>) => clearTimeout(t));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const running = (speed: number, f: (ed: ReturnType<typeof createEditor>) => void, example = "Runs forever") =>
    createRoot((dispose) => {
      const ed = createEditor(undefined);
      ed.loadExample(examples.find((e) => e.name === example)!, true);
      ed.setSpeed(speed);
      ed.dispatch({ kind: "run/toggle" });
      f(ed);
      ed.dispatch({ kind: "run/stop" });
      dispose();
    });

  it("has stops at round numbers, a third of the slider below 1× and a third above 4×", () => {
    expect(SPEEDS.indexOf(1)).toBe((SPEEDS.length - 1) / 3);
    expect(SPEEDS.indexOf(4)).toBe(((SPEEDS.length - 1) * 2) / 3);
    expect(SPEEDS.at(-1)).toBe(16);
  });

  it("takes a speed saved before there were stops to the closest one", () => {
    expect(nearestSpeed(0.59)).toBe(0.5);
    expect(nearestSpeed(1.19)).toBe(1);
    expect(nearestSpeed(2.83)).toBe(3);
    expect(nearestSpeed(100)).toBe(16);
    expect(nearestSpeed(0.01)).toBe(0.1);
    for (const s of SPEEDS) expect(nearestSpeed(s)).toBe(s);
  });

  // Each simulated speed gets its own timeout and fresh timers. Grouping all
  // eight into one test exhausted its timeout when other suites were busy.
  it.each([0.25, 1, 2, 4, 6, 8, 12, 16])("is really %s times as fast, whether it's animating or stepping ahead", (speed) => {
    running(speed, (ed) => {
      vi.advanceTimersByTime(30_000);
      const expected = (30_000 * speed) / 896;
      expect(Math.abs(ed.steps() - expected), `${ed.steps()} steps at ${speed}×`).toBeLessThanOrEqual(Math.max(1, expected * 0.05));
    });
  });

  it("takes as many steps as are due when drawing can't keep up, and rests in proportion", () => {
    // A frame that takes half a second to come, as on a net too big to draw in time.
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 150));
    running(16, (ed) => {
      vi.advanceTimersByTime(10_000);
      expect(ed.steps()).toBeGreaterThan(160);
      expect(ed.steps()).toBeLessThan(200);
    });
  });

  it("gets to the end of a net going flat out, and stops", () => {
    running(16, (ed) => {
      vi.advanceTimersByTime(60_000);
      expect(ed.running()).toBe(false);
      expect(ed.steps()).toBeGreaterThan(0);
      expect(ed.stats().interactions).toBeGreaterThan(0);
      expect(ed.previewing()).toBeUndefined();
    }, "3 × 2");
  });

  it("ends up with the same net stepping ahead as step by step", () => {
    const outcome = (speed: number) => {
      let text = "";
      running(speed, (ed) => {
        vi.advanceTimersByTime(600_000);
        expect(ed.running()).toBe(false);
        text = JSON.stringify([ed.steps(), ed.stats().interactions, ed.toDoc().net]);
      }, "Fibonacci: 6 → 8");
      return text;
    };
    expect(outcome(16)).toBe(outcome(1));
  });

  it("can be slowed down partway, going back to animating and previewing", () => {
    running(16, (ed) => {
      vi.advanceTimersByTime(5_000);
      const fast = ed.steps();
      ed.setSpeed(1);
      vi.advanceTimersByTime(5_000);
      const gained = ed.steps() - fast;
      expect(gained).toBeGreaterThanOrEqual(4);
      expect(gained).toBeLessThanOrEqual(7);
    });
  });

  it("stops at once when told to, at any speed, and stays stopped", () => {
    for (const speed of [1, 8, 16]) {
      running(speed, (ed) => {
        vi.advanceTimersByTime(2_000);
        expect(ed.running()).toBe(true);
        ed.dispatch({ kind: "run/toggle" });
        expect(ed.running()).toBe(false);
        const at = ed.steps();
        vi.advanceTimersByTime(10_000);
        expect(ed.steps()).toBe(at);
        expect(vi.getTimerCount()).toBe(0);
      });
    }
  });

  it("keeps going in a background tab, where no frames come", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    running(16, (ed) => {
      vi.advanceTimersByTime(10_000);
      expect(ed.steps()).toBeGreaterThan(160);
      expect(ed.steps()).toBeLessThan(200);
    });
  });

  it("gets past the old limit of 2,000 steps", () => {
    running(16, (ed) => {
      vi.advanceTimersByTime(150_000);
      expect(ed.steps()).toBeGreaterThan(2_000);
      expect(ed.running()).toBe(true);
    });
  });
});
