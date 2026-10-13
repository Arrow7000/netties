import { describe, expect, it } from "vitest";
import { cutOut, graft, looseName, mergePlan, systemFor } from "./clip";
import { Groups } from "./groups";
import { parse } from "./text";

const doc = `
agent S 1
agent Z 0
agent Add 2
agent E 0
agent D 0

Add(y, r) >< Z => y ~ r;
Add(y, r) >< E => y ~ D, r ~ D;
Add(y, r) >< S(x) => r ~ S(w), x ~ Add(y, w);
E >< S(x) => x ~ E;

Add(S(Z), out) ~ S(S(Z));
`;

describe("clipboard pieces", () => {
  it("cuts agents out, turning wires to the rest into loose ends", () => {
    const { net } = parse(doc);
    const add = [...net.agents.values()].find((a) => a.type === "Add")!.id;
    const piece = cutOut(net, new Groups(), [add]);
    expect(piece.net.agents.size).toBe(1);
    // Principal, y and r: all three wires led out of the piece.
    expect([...piece.net.free.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(piece.net.unconnected()).toEqual([]);
  });

  it("keeps wires among the copied agents", () => {
    const { net } = parse(doc);
    const piece = cutOut(net, new Groups(), net.agents.keys());
    expect(piece.net.agents.size).toBe(net.agents.size);
    expect(piece.net.wires.size).toBe(net.wires.size);
    expect(piece.net.free.size).toBe(1);
  });

  it("brings the rules among its types, and the types those rules make", () => {
    const { system, net } = parse(doc);
    const add = [...net.agents.values()].find((a) => a.type === "Add")!.id;
    const sub = systemFor(system, cutOut(net, new Groups(), [add]).net);
    expect([...sub.types.keys()]).toEqual(["Add"]);
    const zs = [...net.agents.values()].filter((a) => a.type !== "S").map((a) => a.id);
    const both = systemFor(system, cutOut(net, new Groups(), zs).net);
    // Add and Z meet by a rule that makes nothing new, so S stays out.
    expect([...both.types.keys()].sort()).toEqual(["Add", "Z"]);
    expect(both.rules.size).toBe(1);
    // Add meeting E makes Ds, so a copy of Add and E brings D along.
    const withE = parse(doc + "Add(_, _) ~ E;");
    const ae = [...withE.net.agents.values()].filter((a) => a.type === "Add" || a.type === "E").map((a) => a.id);
    expect([...systemFor(withE.system, cutOut(withE.net, new Groups(), ae).net).types.keys()].sort()).toEqual(["Add", "D", "E"]);
  });

  it("adds missing types and their rules, never rules for types already there", () => {
    const { system } = parse(doc);
    const into = parse("agent S 1\nagent Z 0\n").system;
    const plan = mergePlan(into, system);
    if ("error" in plan) throw new Error(plan.error);
    expect([...plan.types.keys()].sort()).toEqual(["Add", "D", "E"]);
    expect(plan.rules.size).toBe(4);
    expect(mergePlan(parse("agent Add 1\n").system, system)).toEqual({ error: expect.stringMatching(/Add has 1 aux port here but 2/) });
  });

  it("grafts under fresh ids and loose-end names", () => {
    const { system, net } = parse(doc);
    const piece = cutOut(net, new Groups(), net.agents.keys()).net;
    const target = net.clone();
    let i = 0;
    const fresh = () => {
      while (target.free.has(looseName(i))) i++;
      return looseName(i++);
    };
    const { ids } = graft(target, new Groups(), system, piece, new Groups(), fresh);
    expect(target.agents.size).toBe(net.agents.size * 2);
    expect(new Set(ids.values()).size).toBe(net.agents.size);
    expect([...target.free.keys()].sort()).toEqual(["a", "out"]);
    expect(target.unconnected()).toEqual([]);
  });
});
