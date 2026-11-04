import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createNetModel } from "./model";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { canonical } from "../core/canon";
import { build, examples, t } from "../core/examples";
import { Groups, collapse, extract, instantiate } from "../core/groups";
import { Net, NONE, free, port } from "../core/net";
import { arithmetic } from "../core/presets";
import { parseProgram, printProgram } from "../core/programText";
import { System } from "../core/system";
import { printNet } from "../core/text";
import { type Doc, arrival, decode, fromShareHash, toShareHash } from "./persist";
import { readSharePayload, sharePayload } from "./shareFormat";

const document = (system: System, net: Net, groups = new Groups()): Doc => ({ v: 1, system: system.toJSON(), net: net.toJSON(), mode: "auto", groups: groups.toJSON() });

describe("text share format", () => {
  it("round trips all examples and produces stable text after regenerating IDs", async () => {
    for (const ex of examples) {
      const system = ex.system();
      const doc = document(system, ex.net(system));
      const payload = sharePayload(doc);
      const read = readSharePayload(payload);
      expect(canonical(Net.fromJSON(read.net)), ex.name).toBe(canonical(Net.fromJSON(doc.net)));
      expect(sharePayload(read), ex.name).toEqual(payload);
      const hash = await toShareHash(doc);
      expect(arrival(hash, await fromShareHash(hash), JSON.stringify(doc)), ex.name).toBe("showing");
    }
  });

  it("numbers agents by first appearance, including nested terms and active pairs", () => {
    const sys = arithmetic();
    const net = new Net();
    const a = net.addAgent(sys.type("S"), 99);
    const b = net.addAgent(sys.type("S"), 3);
    const c = net.addAgent(sys.type("0"), 876);
    net.connect(port(a, 0), port(b, 0));
    net.connect(port(a, 1), port(c, 0));
    expect(printNet(sys, net).order).toEqual([a, c, b]);
    const doc = { ...document(sys, net), mode: "manual" as const, positions: [[a, { x: -1.25, y: 3.5, orient: "up" as const }], [b, { x: 40, y: 50, orient: "down" as const }]] as Doc["positions"] };
    expect(sharePayload(doc)[2]).toEqual([[-1.25, 3.5, 1], null, [40, 50, 0]]);
    const read = readSharePayload(sharePayload(doc));
    expect(sharePayload(read)).toEqual(sharePayload(doc));
    expect(read.net.agents.map(a => a.id)).toEqual([1, 2, 3]);
  });

  it("omits all positions in auto mode, including stale coordinates", () => {
    const sys = arithmetic(); const net = new Net();
    build(net, sys, t("0"));
    const doc = document(sys, net);
    expect(sharePayload({ ...doc, positions: [[1, { x: 12345, y: 67890, orient: "up" }]] })).toHaveLength(2);
    expect(readSharePayload(sharePayload(doc)).positions).toBeUndefined();
  });

  it("preserves nested components, collapsed state, hidden positions, and template bodies", async () => {
    const sys = arithmetic();
    const template = new Net();
    build(template, sys, t("S", t("0")));
    const inner = extract(template, new Groups(), [...template.agents.keys()], { id: 'inner"\\', symbol: "I", name: 'inner "name"\nnext' }).def;
    const outerNet = new Net(); const outerGroups = new Groups();
    const inst = instantiate(outerNet, outerGroups, inner, sys);
    outerGroups.groups.get(inst.group)!.collapsed = false;
    const root = outerGroups.groups.get(inst.group)!.iface[0]![1];
    outerNet.connect(root, free("out"));
    const outer = extract(outerNet, outerGroups, [...outerNet.agents.keys()], { id: "outer", symbol: "O", name: "outer" }).def;
    const net = new Net(); const groups = new Groups();
    const placed = instantiate(net, groups, outer, sys);
    net.connect(groups.groups.get(placed.group)!.iface[0]![1], free("out"));
    const doc: Doc = { ...document(sys, net, groups), mode: "manual", components: [outer, inner], positions: [...net.agents.keys()].map((id, i) => [id, { x: 11.5 + i * 20, y: -50 + i * 90, orient: i % 2 ? "down" : "up" }]) };
    const payload = sharePayload(doc);
    const read = (await fromShareHash(await toShareHash(doc)))!;
    expect(sharePayload(read)).toEqual(payload);
    const p = decode(read);
    expect(p.components.map(d => d.name)).toEqual([outer.name, inner.name]);
    expect([...p.groups.groups.values()].map(g => [g.def, g.collapsed])).toEqual([[outer.id, true], [inner.id, false]]);
    const view = collapse(p.net, p.groups, p.system, new Map(p.components.map(d => [d.id, d])));
    expect(view.box.size).toBe(1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      createRoot(dispose => {
        const defs = new Map(p.components.map(d => [d.id, d]));
        const model = createNetModel({ system: () => p.system, defs: () => defs });
        model.setNet(p.net, new Map(p.positions), p.groups);
        model.restoreView("manual", new Map(p.positions));
        const box = [...view.box.keys()][0]!;
        const shown = model.layout().placement.get(box)!;
        const points = [...p.positions.values()];
        expect(shown.x).toBe(points.reduce((sum, p) => sum + p.x, 0) / points.length);
        expect(shown.y).toBe(points.reduce((sum, p) => sum + p.y, 0) / points.length);
        for (const g of p.groups.groups.values()) model.setCollapsed(g.id, false);
        for (const [id, position] of p.positions) expect(model.layout().placement.get(id)).toEqual(position);
        dispose();
      });
      await Promise.resolve(); // finish the model's queued animation before restoring browser globals
    } finally { vi.unstubAllGlobals(); }
    // Expanding reveals exactly the retained inner placements, including orientation.
    for (const g of p.groups.groups.values()) g.collapsed = false;
    expect(collapse(p.net, p.groups, p.system, new Map()).net.agents.size).toBe(net.agents.size);
    expect([...p.positions.values()]).toEqual(doc.positions!.map(([,p]) => p));
    expect(canonical(p.net)).toBe(canonical(net));
    expect(printProgram(parseProgram(payload[1]))).toBe(payload[1]);
  });

  it("preserves names, labels and rule descriptions containing quotes, slashes and newlines", () => {
    const sys = new System();
    sys.addType({ id: "A", symbol: "A", name: 'say "hi"\\there\nnext', arity: 0, ports: [{ label: '"port"\\\nlabel' }] });
    sys.addRule({ left: "A", right: "A", agents: [], wires: [], description: 'say "hello"\\world\nagain' });
    const read = readSharePayload(sharePayload(document(sys, new Net())));
    const back = System.fromJSON(read.system);
    expect(back.type("A").name).toBe(sys.type("A").name);
    expect(back.type("A").ports).toEqual(sys.type("A").ports);
    expect([...back.rules.values()][0]!.description).toBe([...sys.rules.values()][0]!.description);
  });

  it("preserves cycles, parallel wires, holes, and free-to-free wires", () => {
    const sys = new System().addType({ id: "A", symbol: "A", name: "A", arity: 2 });
    for (let seed = 1; seed <= 100; seed++) {
      let rng = seed;
      const random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const net = new Net();
      const ends = [];
      for (let i = 0; i < 15; i++) { const id = net.addAgent(sys.type("A")); for (let j=0; j<3; j++) ends.push(port(id,j)); }
      for (let i = ends.length-1; i>0; i--) { const j = Math.floor(random()*(i+1)); [ends[i],ends[j]] = [ends[j]!,ends[i]!]; }
      while (ends.length > 1) { const a=ends.pop()!; const b=ends.pop()!; if (random()>.15) net.connect(a,b); }
      net.connect(free("x"), free("y"));
      net.free.set("unused", NONE);
      const read = readSharePayload(sharePayload(document(sys, net)));
      expect(canonical(Net.fromJSON(read.net)), `seed ${seed}`).toBe(canonical(net));
      expect(sharePayload(read), `stable text seed ${seed}`).toEqual(sharePayload(document(sys, net)));
    }
  });

  it("preserves arbitrary and duplicate agent symbols, and ambiguous free port names", () => {
    const system = new System();
    for (const [id, symbol] of [["a", "a b"], ["b", "a b"], ["c", "=>"], ["d", "agent"], ["e", "T0"]]) {
      system.addType({ id: id!, symbol: symbol!, name: id!, arity: 0 });
    }
    const net = new Net();
    [...system.types.values()].forEach((t, i) => {
      const id = net.addAgent(t);
      net.connect(port(id, 0), free(["_", "A", "space name", "quote\"", "T0"][i]!));
    });
    net.connect(free("a"), free("b")); // internal type IDs are not display symbols
    net.free.set("unattached free end", NONE);
    const payload = sharePayload(document(system, net));
    const read = readSharePayload(payload);
    expect(read.system.types.map(t => t.symbol)).toEqual([...system.types.values()].map(t => t.symbol));
    expect(new Set(read.net.free)).toEqual(new Set(net.free.keys()));
    expect(sharePayload(read)).toEqual(payload);
  });

  it("keeps disabled typing options disabled even when ports carry metadata", () => {
    const sys = new System().addType({ id: "A", name: "A", symbol: "A", arity: 0, ports: [{ pol: "give", type: "number" }] });
    sys.typing = { dirs: "off", types: "off", names: ["number", "unused"] };
    const read = readSharePayload(sharePayload(document(sys, new Net())));
    expect(read.system.typing).toEqual(sys.typing);
  });

  it("rejects invalid layout coordinates, counts, versions and component relationships", () => {
    const doc = document(new System(), new Net());
    const text = sharePayload(doc)[1];
    expect(() => readSharePayload([2, text, [[0, 0, 0]]])).toThrow();
    expect(() => readSharePayload([3, text])).toThrow();
    expect(() => parseProgram(text + 'instance "missing" parent - collapsed members [] ports [];')).toThrow(/unknown component/);
    expect(() => parseProgram(text + 'instance "missing" parent 0 collapsed members [] ports [];')).toThrow(/nesting/);
    const net = new Net(); const sys = arithmetic(); build(net,sys,t("0"));
    const one = sharePayload(document(sys,net))[1];
    expect(() => readSharePayload([2,one,[[NaN,0,0]]])).toThrow();
    expect(() => readSharePayload([2,one,[[0,0,2]]])).toThrow();
  });

  it("keeps legacy JSON links readable, including the supplied example", async () => {
    const original = readFileSync(new URL('./fixtures/share-v1.txt', import.meta.url), 'utf8').trim();
    const doc = (await fromShareHash(new URL(original).hash))!;
    expect(doc.v).toBe(1);
    const modern = await toShareHash(doc);
    expect(modern.length).toBeLessThan(new URL(original).hash.length * .7);
    expect(sharePayload((await fromShareHash(modern))!)).toEqual(sharePayload(doc));
    const empty = document(new System(), new Net());
    const hash = '#n=' + deflateRawSync(JSON.stringify(empty)).toString('base64url');
    expect(await fromShareHash(hash)).toEqual(empty);
  });
});
