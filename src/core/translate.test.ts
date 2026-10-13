import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { examples } from "./examples";
import { Net, free } from "./net";
import { arithmetic, combinators } from "./presets";
import { interact, normalize } from "./reduce";
import { Builder, type Ref, code, split, translation } from "./translate";

const sys = combinators();
const partner = (net: Net, name: string) => {
  const p = net.partner(free(name));
  return p?.kind === "free" ? p.name : undefined;
};
const f = (name: string): Ref => ({ f: name });

describe("Lafont's constructions", () => {
  it("M_n against M*_n gives straight wires", () => {
    for (let n = 0; n <= 5; n++) {
      const b = new Builder();
      const mid = b.hole();
      b.M(mid, Array.from({ length: n }, (_, i) => f(`x${i}`)));
      b.Mstar(mid, Array.from({ length: n }, (_, i) => f(`y${i}`)));
      const { net } = b.toNet();
      expect(normalize(net, sys).normal).toBe(true);
      expect(net.agents.size).toBe(0);
      for (let i = 0; i < n; i++) expect(partner(net, `x${i}`)).toBe(`y${i}`);
    }
  });

  it("T_σ against T_σ gives the wiring σ", () => {
    const sigma = [3, 2, 1, 0, 4, 6, 5];
    const b = new Builder();
    const mid = b.hole();
    b.Tsigma(mid, sigma.map((_, i) => f(`x${i}`)), sigma);
    b.Tsigma(mid, sigma.map((_, i) => f(`y${i}`)), sigma);
    const { net } = b.toNet();
    expect(normalize(net, sys).normal).toBe(true);
    expect(net.agents.size).toBe(0);
    sigma.forEach((s, a) => expect(partner(net, `x${a}`)).toBe(`y${s}`));
  });

  it("a selector picks one package from a menu and erases the rest", () => {
    const b = new Builder();
    const mid = b.hole();
    b.menu(mid, [0, 1, 2].map((k) => (r: Ref) => {
      // Package k: a γ tree with k+1 erasers, easy to tell apart.
      const g = b.cell("γ");
      b.link({ c: g, s: 0 }, r);
      b.link({ c: g, s: 1 }, { c: b.cell("ε"), s: 0 });
      if (k === 0) b.link({ c: g, s: 2 }, { c: b.cell("ε"), s: 0 });
      else {
        const d = b.cell(k === 1 ? "δ" : "γ");
        b.link({ c: g, s: 2 }, { c: d, s: 0 });
        b.link({ c: d, s: 1 }, { c: b.cell("ε"), s: 0 });
        b.link({ c: d, s: 2 }, { c: b.cell("ε"), s: 0 });
      }
    }));
    b.selector(mid, 1, 3, f("out"));
    const { net } = b.toNet();
    normalize(net, sys);
    const types = [...net.agents.values()].map((a) => a.type).sort();
    expect(types).toEqual(["γ", "δ", "ε", "ε", "ε"]);
  });

  it("decoding a code gives back the package, δ cells and all (Fig. 9)", () => {
    // π: a package with δ cells in it, including wires between leaves.
    const pi = new Builder();
    const g = pi.cell("γ");
    const d1 = pi.cell("δ");
    const d2 = pi.cell("δ");
    const g2 = pi.cell("γ");
    pi.link({ c: g, s: 0 }, f("root"));
    pi.link({ c: g, s: 1 }, { c: d1, s: 0 });
    pi.link({ c: g, s: 2 }, { c: g2, s: 0 });
    pi.link({ c: g2, s: 1 }, { c: d2, s: 0 });
    pi.link({ c: d1, s: 1 }, { c: d2, s: 2 });
    pi.link({ c: d1, s: 2 }, { c: g2, s: 2 });
    pi.link({ c: d2, s: 1 }, { c: pi.cell("ε"), s: 0 });
    const expected = pi.toNet().net;

    const b = new Builder();
    const mid = b.hole();
    b.embed(code(pi), { root: mid });
    b.decoder(mid, f("root"));
    const { net } = b.toNet();
    expect(normalize(net, sys).normal).toBe(true);
    expect(canonical(net)).toBe(canonical(expected));
    // And the code itself has no δ.
    expect(code(pi).cells.some((c) => c.type === "δ")).toBe(false);
  });

  it("copies a code with a δ comb (Lemma 3)", () => {
    const pi = new Builder();
    const d = pi.cell("δ");
    pi.link({ c: d, s: 0 }, f("root"));
    pi.link({ c: d, s: 1 }, { c: d, s: 2 });
    const b = new Builder();
    const mid = b.hole();
    b.embed(code(pi), { root: mid });
    b.T(mid, [f("a"), f("b")]);
    const { net } = b.toNet();
    expect(normalize(net, sys).normal).toBe(true);
    const one = new Builder();
    one.embed(code(pi), { root: f("a") });
    const two = new Builder();
    two.embed(code(pi), { root: f("a") });
    two.embed(code(pi), { root: f("b") });
    expect(canonical(net)).toBe(canonical(two.toNet().net));
  });

  it("splits a rule's result into the two halves and σ", () => {
    const s = split(sys, sys.ruleFor("γ", "γ")!.rule);
    expect(s.sigma).toEqual([1, 0]);
    const c = split(sys, sys.ruleFor("γ", "δ")!.rule);
    expect(c.L.net.agents.size + c.R.net.agents.size).toBe(4);
    expect(c.sigma).toEqual([0, 1, 2, 3]);
  });
});

/** Translating then reducing should land on the translation of the reduced source. */
function commutes(source: Net, s: ReturnType<typeof combinators>, mode: "general" | "restricted", limit = 200_000) {
  const tr = translation(s, mode);
  const t = tr.net(source).net;
  const r = normalize(t, combinators(), { limit });
  expect(r.normal).toBe(true);
  const done = source.clone();
  expect(normalize(done, s).normal).toBe(true);
  expect(canonical(t)).toBe(canonical(tr.net(done).net));
  return r.stats.interactions;
}

describe("translation", () => {
  it("leaves the exact combinators as themselves, preserving each step", () => {
    for (const name of ["Commutation", "Erasing a tree", "Copying a feedback loop"]) {
      const ex = examples.find((e) => e.name === name)!;
      const s = ex.system();
      const source = ex.net(s);
      const tr = translation(s);
      const translated = tr.net(source);
      expect(tr.identity).toBe(true);
      expect(translation(s, "restricted").identity).toBe(true);
      expect(canonical(translated.net)).toBe(canonical(source));
      expect(translated.net.agents.size).toBe(source.agents.size);
      for (const a of source.agents.values()) {
        expect(translated.tagOf.get(a.id)).toBe(a.id);
        expect(translated.ports.get(a.id)).toEqual(a.wires.map((_, slot) => ({ kind: "port", agent: a.id, slot })));
      }
      const first = source.activePairs()[0]!;
      interact(source, s, first);
      interact(translated.net, combinators(), first);
      expect(canonical(translated.net)).toBe(canonical(source));
      commutes(ex.net(s), s, "general");
    }
  });

  it("recognizes equivalent combinator rules regardless of order or pair orientation", () => {
    const s = combinators();
    const rule = s.rules.get("δ|γ")!;
    s.rules.delete("δ|γ");
    s.rules.set("γ|δ", {
      left: "γ", right: "δ", agents: [...rule.agents],
      wires: [...rule.wires].reverse().map(([a, b]) => {
        const flip = (e: typeof a) => e.kind === "iface" ? { ...e, side: (1 - e.side) as 0 | 1 } : e;
        return [flip(a), flip(b)];
      }),
    });
    expect(translation(s).identity).toBe(true);
  });

  it("does not use identity when a combinator rule has changed", () => {
    const s = combinators();
    s.rules.set("γ|γ", { left: "γ", right: "γ", agents: [], wires: [
      [{ kind: "iface", side: 0, slot: 1 }, { kind: "iface", side: 1, slot: 1 }],
      [{ kind: "iface", side: 0, slot: 2 }, { kind: "iface", side: 1, slot: 2 }],
    ] });
    expect(translation(s).identity).toBe(false);
  });

  it("translates unary arithmetic", () => {
    const ex = examples.find((e) => e.name === "3 × 2")!;
    const s = ex.system();
    commutes(ex.net(s), s, "general");
  });

  it("uses the restricted translation only for systems without recursion", () => {
    expect(() => translation(arithmetic(), "restricted")).toThrow(/restricted/);
    // Combinators without γδ are recursion-free (ε < γ, ε < δ).
    const s = combinators();
    s.rules.delete("δ|γ");
    const ex = examples.find((e) => e.name === "Erasing a tree")!;
    commutes(ex.net(s), s, "restricted");
  });
});

describe("following the source step by step", () => {
  it("each source interaction maps to a run of combinator interactions ending at the translated result", async () => {
    const { reduceWith, isCellRoot } = await import("./catchup");
    const { interact } = await import("./reduce");
    const ex = examples.find((e) => e.name === "3 + 2")!;
    const s = ex.system();
    const source = ex.net(s);
    const tr = translation(s);
    const c = combinators();
    let steps = 0;
    while (source.activePairs().length) {
      // Fire one source pair, and its counterpart in a fresh translation.
      const { net, tagOf } = tr.net(source);
      const w = source.activePairs()[0]!;
      const [a, b] = source.wire(w).ends as { agent: number }[];
      const roots = [...net.agents.keys()].filter((id) => [a!.agent, b!.agent].includes(tagOf.get(id)!) && isCellRoot(net, id));
      const cut = net.activePairs().find((x) => net.wire(x).ends.every((e) => e.kind === "port" && roots.includes(e.agent)));
      expect(cut).toBeDefined();
      interact(source, s, w);
      const r = reduceWith(net, c, {
        allow: (x) => x === cut || !net.wire(x).ends.every((e) => e.kind === "port" && isCellRoot(net, e.agent)),
      });
      expect(r.interactions).toBeGreaterThan(0);
      expect(canonical(net)).toBe(canonical(tr.net(source).net));
      steps++;
    }
    expect(steps).toBe(4);
  }, 30_000);
});
