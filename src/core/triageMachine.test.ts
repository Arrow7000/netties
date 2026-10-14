import { describe, expect, it } from "vitest";
import { canonical } from "./canon";
import { type Spec, build, f, link, t } from "./examples";
import { type End, Net, free, port } from "./net";
import { redexes, interact } from "./reduce";
import { triageMachine } from "./triageMachine";
import { badWires } from "./types";

const leaf = (): Spec => t("Leaf");
const app = (fn: Spec, arg: Spec): Spec => t("App", fn, arg);
const stem = (arg: Spec): Spec => app(leaf(), arg);
const fork = (left: Spec, right: Spec): Spec => app(stem(left), right);
const triage = (w: Spec, x: Spec, y: Spec, arg: Spec): Spec => app(fork(fork(w, x), y), arg);

type Head = { kind: "leaf" } | { kind: "stem"; child: Spec } | { kind: "fork"; left: Spec; right: Spec };

/** Directly interprets the five TC rules, independently of the net rules. */
function referenceHead(term: Spec, fuel: { left: number }): Head | undefined {
  if (--fuel.left < 0) return undefined;
  if (term.type === "Leaf") return { kind: "leaf" };
  if (term.type !== "App") throw new Error(`not a source term: ${term.type}`);
  const [fnTerm, arg] = term.aux as [Spec, Spec];
  const fn = referenceHead(fnTerm, fuel);
  if (!fn) return undefined;
  if (fn.kind === "leaf") return { kind: "stem", child: arg };
  if (fn.kind === "stem") return { kind: "fork", left: fn.child, right: arg };
  const caseHead = referenceHead(fn.left, fuel);
  if (!caseHead) return undefined;
  if (caseHead.kind === "leaf") return referenceHead(fn.right, fuel);
  if (caseHead.kind === "stem")
    return referenceHead(app(app(caseHead.child, arg), app(fn.right, arg)), fuel);
  const argHead = referenceHead(arg, fuel);
  if (!argHead) return undefined;
  if (argHead.kind === "leaf") return referenceHead(caseHead.left, fuel);
  if (argHead.kind === "stem") return referenceHead(app(caseHead.right, argHead.child), fuel);
  return referenceHead(app(app(fn.right, argHead.left), argHead.right), fuel);
}

const headTerm = (head: Head): Spec =>
  head.kind === "leaf" ? leaf() : head.kind === "stem" ? stem(head.child) : fork(head.left, head.right);

function readTerm(net: Net, root: End, seen = new Set<number>()): Spec {
  if (root.kind !== "port" || root.slot !== 0) throw new Error("not a term root");
  if (seen.has(root.agent)) throw new Error("cyclic term");
  seen.add(root.agent);
  const agent = net.agent(root.agent);
  const child = (slot: number) => {
    const next = net.partner(port(agent.id, slot));
    if (!next) throw new Error("missing child");
    return readTerm(net, next, seen);
  };
  switch (agent.type) {
    case "Leaf": return leaf();
    case "Stem": return stem(child(1));
    case "Fork": return fork(child(1), child(2));
    case "App": return app(child(1), child(2));
    default: throw new Error(`unexpected ${agent.type} inside output`);
  }
}

function setup(term: Spec) {
  const sys = triageMachine();
  const net = new Net();
  link(net, build(net, sys, term), build(net, sys, t("Eval", f("out"))));
  expect(net.unconnected()).toEqual([]);
  expect(badWires(net, sys).size).toBe(0);
  return { net, sys };
}

function head(net: Net): { type: string; agent: number } {
  const at = net.partner(free("out"));
  if (!at || at.kind !== "port") throw new Error("no result at out");
  return { type: net.agent(at.agent).type, agent: at.agent };
}

function run(setupResult: ReturnType<typeof setup>, choose: "first" | "last" = "first") {
  const { net, sys } = setupResult;
  const trace: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const active = redexes(net, sys);
    if (active.length === 0) {
      expect(net.activePairs()).toEqual([]);
      expect(badWires(net, sys).size).toBe(0);
      return trace;
    }
    const wire = choose === "first" ? active[0]! : active[active.length - 1]!;
    const record = interact(net, sys, wire);
    trace.push(`${record.rule.left}/${record.rule.right}`);
  }
  throw new Error("candidate did not settle within 1000 interactions");
}

describe("TC-like head observation candidate", () => {
  it("evaluates TC leaf, stem and fork head forms", () => {
    for (const [term, expected] of [
      [leaf(), "Leaf"],
      [stem(leaf()), "Stem"],
      [fork(leaf(), leaf()), "Fork"],
    ] as const) {
      const candidate = setup(term);
      run(candidate);
      expect(head(candidate.net).type).toBe(expected);
    }
  });

  it("implements the K and S cases with explicit erasure and copying", () => {
    const k = setup(app(fork(leaf(), stem(leaf())), fork(leaf(), leaf())));
    expect(run(k)).toContain("Case/Leaf");
    expect(head(k.net).type).toBe("Stem");

    const s = setup(app(fork(stem(leaf()), leaf()), leaf()));
    const trace = run(s);
    expect(trace).toContain("Case/Stem");
    expect(trace).toContain("Dup/Leaf");
    expect(head(s.net).type).toBe("Fork");
  });

  it("triages a computed argument head as leaf, stem or fork", () => {
    for (const [arg, expected, branch] of [
      [leaf(), "Leaf", "Triage/Leaf"],
      [stem(leaf()), "Stem", "Triage/Stem"],
      [fork(leaf(), leaf()), "Fork", "Triage/Fork"],
      [app(fork(leaf(), stem(leaf())), leaf()), "Stem", "Triage/Stem"],
    ] as const) {
      const candidate = setup(triage(leaf(), leaf(), leaf(), arg));
      const trace = run(candidate);
      expect(trace).toContain(branch);
      expect(head(candidate.net).type).toBe(expected);
      const source = triage(leaf(), leaf(), leaf(), arg);
      const expectedHead = referenceHead(source, { left: 500 });
      expect(expectedHead).toBeDefined();
      const out = candidate.net.partner(free("out"));
      if (!out || !expectedHead) throw new Error("missing result");
      expect(readTerm(candidate.net, out)).toEqual(headTerm(expectedHead));
    }
  });

  it("inspects a fork without evaluating a reducible child", () => {
    const pending = app(fork(leaf(), stem(leaf())), leaf());
    const candidate = setup(triage(leaf(), leaf(), leaf(), fork(pending, leaf())));
    const trace = run(candidate);
    expect(trace).toContain("Triage/Fork");
    const result = head(candidate.net);
    expect(result.type).toBe("Fork");
    const child = candidate.net.partner(port(result.agent, 1));
    expect(child?.kind === "port" && candidate.net.agent(child.agent).type).toBe("App");
  });

  it("can inspect a fork, then run a child extracted by triage", () => {
    const pending = app(fork(leaf(), stem(leaf())), leaf());
    // In the fork branch, Stem(Leaf) is K: y u v returns the first child u.
    const candidate = setup(triage(leaf(), leaf(), stem(leaf()), fork(pending, leaf())));
    const trace = run(candidate);
    expect(trace.indexOf("Triage/Fork")).toBeGreaterThan(-1);
    expect(trace.indexOf("Triage/Fork")).toBeLessThan(trace.indexOf("Case/Leaf"));
    expect(head(candidate.net).type).toBe("Stem");
  });

  it("agrees under two redex orders on a copying example", () => {
    const input = app(fork(stem(leaf()), leaf()), stem(leaf()));
    const first = setup(input);
    const last = { sys: first.sys, net: first.net.clone() };
    run(first, "first");
    run(last, "last");
    expect(head(first.net).type).toBe("Fork");
    expect(canonical(first.net)).toBe(canonical(last.net));
  });

  it("converges under every reachable redex choice in a small copying case", () => {
    const computed = app(fork(leaf(), stem(leaf())), leaf());
    const forceArg = fork(fork(leaf(), leaf()), leaf());
    for (const source of [
      app(fork(stem(leaf()), leaf()), stem(leaf())),
      app(fork(stem(forceArg), leaf()), computed),
    ]) {
      const start = setup(source);
      const pending = [start.net];
      const seen = new Set<string>();
      const finals = new Set<string>();
      while (pending.length) {
        const net = pending.pop()!;
        const shape = canonical(net);
        if (seen.has(shape)) continue;
        seen.add(shape);
        expect(seen.size).toBeLessThan(20_000);
        const choices = redexes(net, start.sys);
        if (choices.length === 0) {
          expect(net.activePairs()).toEqual([]);
          expect(badWires(net, start.sys).size).toBe(0);
          finals.add(shape);
          continue;
        }
        for (const choice of choices) {
          const next = net.clone();
          interact(next, start.sys, choice);
          pending.push(next);
        }
      }
      expect(finals.size).toBe(1);
      expect(seen.size).toBeGreaterThan(1);
    }
  });

  it("agrees with the direct TC rules on all small closed terms", () => {
    const byLeaves: Spec[][] = [[], [leaf()]];
    for (let n = 2; n <= 6; n++) {
      const terms: Spec[] = [];
      for (let left = 1; left < n; left++)
        for (const fn of byLeaves[left]!) for (const arg of byLeaves[n - left]!) terms.push(app(fn, arg));
      byLeaves[n] = terms;
    }
    let checked = 0;
    for (const terms of byLeaves.slice(1)) for (const term of terms) {
      const expected = referenceHead(term, { left: 500 });
      if (!expected) continue;
      const candidate = setup(term);
      run(candidate);
      const out = candidate.net.partner(free("out"));
      if (!out) throw new Error("missing output");
      expect(readTerm(candidate.net, out)).toEqual(headTerm(expected));
      checked++;
    }
    expect(checked).toBe(65);
  });
});
