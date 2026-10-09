import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { build, f, link, t } from "./examples";
import { Groups, collapse, extract, instantiate, refresh, uses } from "./groups";
import { Net, free, port } from "./net";
import { arithmetic } from "./presets";
import { normalize } from "./reduce";

const sys = arithmetic();

/** 2 × out, with the 2 made into a component. */
function setup() {
  const net = new Net();
  const two = build(net, sys, t("S", t("S", t("0"))));
  const times = build(net, sys, t("×", t("S", t("S", t("0"))), f("out")));
  link(net, two, times);
  const groups = new Groups();
  const twoAgents = [...net.agents.keys()].slice(0, 3);
  const { def, boundary } = extract(net, groups, twoAgents, { id: "two", name: "two", symbol: "2" });
  const g = groups.add({ def: def.id, iface: boundary, collapsed: true });
  twoAgents.forEach((a) => groups.of.set(a, g));
  return { net, groups, def, g, twoAgents };
}

describe("components", () => {
  it("extracts a definition whose interface is the boundary", () => {
    const { def } = setup();
    expect(def.iface).toEqual(["p1"]);
    expect(def.net.agents).toHaveLength(3);
  });

  it("instantiates a copy of the definition", () => {
    const { def } = setup();
    const net = new Net();
    const groups = new Groups();
    const { group } = instantiate(net, groups, def, sys);
    // Wire the interface out to a free port and compare with the definition.
    const [, inner] = groups.groups.get(group)!.iface[0]!;
    net.connect(inner, free("p1"));
    expect(canonical(net)).toBe(canonical(Net.fromJSON(def.net)));
    expect(groups.members(group)).toHaveLength(3);
  });

  it("refreshes an instance from a new definition, keeping its outside wiring", () => {
    const { net, groups, def, g } = setup();
    // Redefine "two" as three.
    const three = new Net();
    link(three, build(three, sys, t("S", t("S", t("S", t("0"))))), free("p1"));
    refresh(net, groups, g, { ...def, net: three.toJSON() }, sys);
    expect(groups.members(g)).toHaveLength(4);
    expect(normalize(net, sys).normal).toBe(true);
    let n = 0;
    for (let p = net.partner(free("out")); p?.kind === "port" && net.agent(p.agent).type === "S"; p = net.partner(port(p.agent, 1))) n++;
    expect(n).toBe(6);
  });

  it("dissolves an instance when part of it interacts", () => {
    const { groups, g, twoAgents } = setup();
    groups.dissolveAround([twoAgents[0]!]);
    expect(groups.groups.has(g)).toBe(false);
    expect(groups.of.size).toBe(0);
  });

  it("draws a collapsed instance as one box, keeping boundary wire ids", () => {
    const { net, groups, twoAgents } = setup();
    const boundaryWire = net.wireAt(port(twoAgents[0]!, 0));
    const view = collapse(net, groups, sys, new Map());
    expect(view.net.agents.size).toBe(net.agents.size - 2);
    expect(view.net.wires.has(boundaryWire)).toBe(true);
    const box = [...view.box.keys()][0]!;
    expect(view.toReal(port(box, 0))).toEqual(port(twoAgents[0]!, 0));
  });

  it("nests instances and knows which components use which", () => {
    const { net, groups, def, g } = setup();
    // A component made of the 2-instance plus the ×.
    const all = [...net.agents.keys()];
    const outer = extract(net, groups, all, { id: "double", name: "double", symbol: "D" });
    expect(outer.def.groups.groups).toHaveLength(1);
    const defs = new Map([
      ["two", def],
      ["double", outer.def],
    ]);
    expect(uses(defs, "double", "two")).toBe(true);
    expect(uses(defs, "two", "double")).toBe(false);
    const n2 = new Net();
    const g2 = new Groups();
    const inst = instantiate(n2, g2, outer.def, sys);
    const inner = [...g2.groups.values()].find((x) => x.def === "two")!;
    expect(inner.parent).toBe(inst.group);
    expect(g2.members(inst.group)).toHaveLength(net.agents.size);
    expect(g).toBeDefined();
  });
});
