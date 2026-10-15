import { createHash } from "node:crypto";
import { canonical } from "../../src/core/canon";
import { Net, free, port } from "../../src/core/net";
import { combinators } from "../../src/core/presets";
import { translation } from "../../src/core/translate";
import { aliasSystem, assertSealed, attach, duplicatorInput, expectedDuplicatorCopies, explore, exterior, hiddenAliasing, hiddenCycle, leafWiring, sameKindRuleSymmetric, sealedCore, treeDuplicatorSystem, walkerSystem, wiringObserverSystem } from "./mechanisms";

function summarize(result: ReturnType<typeof explore>) {
  if (result.frontier || result.hasCycle || result.finished.length !== 1)
    throw new Error("experiment exploration is incomplete, cyclic, or has multiple results");
  if (result.finished[0]!.net.activePairs().length)
    throw new Error("fixture stopped at an undefined active pair instead of a normal net");
  return { states: result.states, transitions: result.transitions, frontier: result.frontier,
    hasCycle: result.hasCycle, normalForms: result.finished.length,
    interactions: result.finished[0]!.steps };
}

export function runExperiments() {
  const coreExamples = [1, 3, 5].map((length) => {
    const net = hiddenCycle(length);
    return { cycleLength: length, cells: net.agents.size, activePairs: net.activePairs().length,
      sealedCells: sealedCore(net).size, exterior: exterior(net, sealedCore(net)) };
  });
  if (new Set(coreExamples.map((e) => e.exterior)).size !== 1) throw new Error("cycle exteriors differ");
  const sys = aliasSystem();
  const tr = translation(sys);
  const aliasing = [true, false].map((shared) => {
    const source = hiddenAliasing(shared, sys);
    const core = sealedCore(source);
    const target = tr.net(source);
    const targetCore = new Set([...target.tagOf].filter(([, owner]) => core.has(owner)).map(([id]) => id));
    assertSealed(target.net, targetCore);
    return { shared, sourceCells: source.agents.size, sourceSealedCells: core.size,
      targetCells: target.net.agents.size, targetSealedCells: targetCore.size,
      targetActivePairs: target.net.activePairs().length,
      sourceExterior: exterior(source, core), targetExterior: exterior(target.net, targetCore) };
  });
  if (aliasing[0]!.sourceExterior !== aliasing[1]!.sourceExterior || aliasing[0]!.targetExterior !== aliasing[1]!.targetExterior)
    throw new Error("aliasing exteriors differ");
  const observerChecks = ["γ", "δ", "ε"].map((observer) => {
    const results = [1, 3].map((length) => {
      const net = hiddenCycle(length);
      const core = sealedCore(net);
      attach(net, combinators(), observer);
      const result = explore(net, combinators());
      return { ...summarize(result), exterior: exterior(result.finished[0]!.net, core) };
    });
    if (results[0]!.exterior !== results[1]!.exterior) throw new Error("observer distinguishes sealed region");
    return { observer, cycle1: results[0], cycle3: results[1] };
  });
  const probe = wiringObserverSystem();
  const wiring = [false, true].map((crossed) => {
    const net = leafWiring(crossed, probe);
    attach(net, probe, "Inspect");
    const result = explore(net, probe);
    const metrics = summarize(result);
    const output = result.finished[0]!.net;
    const tags = [...output.agents.values()].filter((a) => a.type === "Same" || a.type === "Cross").map((a) => a.type).sort();
    if (tags.length !== 4 || tags.some((tag) => tag !== (crossed ? "Cross" : "Same"))) throw new Error("native probe gave wrong tags");
    return { crossed, ...metrics, outputTags: tags };
  });
  const walker = walkerSystem();
  const quoting = [false, true].map((crossed) => {
    const original = leafWiring(crossed, walker);
    const quoted = original.clone();
    attach(quoted, walker, "Quote");
    const q = explore(quoted, walker);
    const qMetrics = summarize(q);
    const code = q.finished[0]!.net;
    const out = code.partner(free("out"))!;
    code.disconnect(code.wireAt(free("out")));
    code.removeFree("out");
    code.connect(free("value"), out);
    attach(code, walker, "Run");
    const u = explore(code, walker);
    const uMetrics = summarize(u);
    const reconstructed = u.finished[0]!.net;
    const root = reconstructed.partner(free("out"))!;
    reconstructed.disconnect(reconstructed.wireAt(free("out")));
    reconstructed.removeFree("out");
    reconstructed.connect(free("value"), root);
    const roundTrip = canonical(reconstructed) === canonical(original);
    if (!roundTrip) throw new Error("quote reconstruction changed graph");
    return { crossed, quote: qMetrics, run: uMetrics, roundTrip };
  });
  const buriedQuote = [1, 3].map((length) => {
    const net = hiddenCycle(length, walker);
    attach(net, walker, "Quote");
    const result = explore(net, walker);
    return { cycleLength: length, ...summarize(result),
      pendingWalkers: [...result.finished[0]!.net.agents.values()].filter((a) => a.type === "Quote").length };
  });
  const self = new Net();
  const q = self.addAgent(walker.type("Quote"));
  self.connect(free("value"), port(q, 0));
  self.connect(port(q, 1), port(self.addAgent(walker.type("ε")), 0));
  attach(self, walker, "Quote");
  const selfResult = explore(self, walker);
  const selfQuote = { ...summarize(selfResult), outputKinds: [...selfResult.finished[0]!.net.agents.values()].map((a) => a.type) };
  const copier = treeDuplicatorSystem();
  const copying = [false, true].map((loop) => {
    const net = duplicatorInput(loop, copier);
    attach(net, copier, "δ");
    const result = explore(net, copier);
    const output = result.finished[0]!.net;
    const expected = expectedDuplicatorCopies(loop, copier);
    return { loop, ...summarize(result), actualCells: output.agents.size, expectedCells: expected.agents.size,
      correctCopies: canonical(output) === canonical(expected) };
  });
  if (!copying[0]!.correctCopies || copying[1]!.correctCopies) throw new Error("tree/package distinction not reproduced");
  const symmetry = [combinators(), aliasSystem(), walker, probe, copier].map((system) => {
    const rules = [...system.rules.values()];
    const invalid = rules.filter((r) => !sameKindRuleSymmetric(system, r));
    if (invalid.length) throw new Error("candidate uses an oriented same-kind interaction");
    return { types: system.types.size, rules: rules.length, asymmetricSameKindRules: invalid.length };
  });
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const compact = ({ exterior, ...metrics }: ReturnType<typeof summarize> & { exterior: string }) =>
    ({ ...metrics, exteriorSha256: hash(exterior) });
  // Equality checks above compare complete canonical strings. Hashes below
  // keep the human-readable result record small; they do not decide equality.
  return { schemaVersion: 1, limits: { maxSteps: 20, maxStates: 20000 },
    coreExamples: coreExamples.map(({ exterior, ...metrics }) => ({ ...metrics, exteriorSha256: hash(exterior) })),
    aliasing: aliasing.map(({ sourceExterior, targetExterior, ...metrics }) =>
      ({ ...metrics, sourceExteriorSha256: hash(sourceExterior), targetExteriorSha256: hash(targetExterior) })),
    observerChecks: observerChecks.map(({ observer, cycle1, cycle3 }) =>
      ({ observer, cycle1: compact(cycle1!), cycle3: compact(cycle3!) })),
    wiring, quoting, buriedQuote, selfQuote, copying, symmetry };
}
