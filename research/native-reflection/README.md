# Native graph reflection feasibility

**Conclusion:** the requested combination is impossible under the ordinary
interaction-net model if reflection must inspect literal graph structure of
all finite normal nets, including deadlocked principal-port cycles. This is
an obstruction to any number of added agent kinds, not a lower bound on the
size of a particular basis.

The reason is local reachability. Some connected normal nets contain a region
whose cells cannot participate in a first interaction with any outside
observer. Changing the contents of that region changes the graph without
changing what any program attached to the interface can observe. Universality
by compositional principal-net translation preserves examples of this kind.
The argument is given below; finite experiments reproduce the examples and
check candidate mechanisms against the existing Netties reducer.

The requirement to include these deadlocked nets was explicitly confirmed on
2026-10-15. Excluding them would change the question. No alternative with a
restricted value domain is counted as satisfying this target.

## Requirements and assumptions

### Ordinary interaction nets

An input is a finite graph of labelled cells. Each cell has one fixed
principal port, slot 0, and an ordered finite collection of auxiliary ports.
Each port has exactly one wire partner. Cell and wire IDs and drawing
coordinates have no semantic meaning. The external interface is ordered or
named and must be preserved by graph isomorphisms.

A step replaces two cells joined at their principal ports. Its right-hand
side depends only on their two kinds and reconnects their auxiliary interface
linearly. It cannot inspect or mutate a third cell through an auxiliary wire.
Rules are unique for each unordered pair of kinds; a same-kind rule must be
invariant under exchanging the two input cells. These are the ordinary local
rules used here. [Lafont, section 1.2](https://www.i2m.univ-amu.fr/perso/yves.lafont/pub/combinators.ps)

A *normal* net below means one with no principal-to-principal wire, even if it
is deadlocked. This is stricter than merely having no applicable rule. It
must not be confused with Lafont's *reduced* nets, which also exclude vicious
circles. [Mazza, sections 1.1.5 and 1.1.6](https://www.lipn.fr/~mazza/papers/Thesis-1.1.pdf)

### Native reflection

The observer is a fixed finite net attached through the input's existing
external interface. It may consume and replace the input. Preservation of the
original input, constant running time, and zero allocation are **not** assumed.
Its computation uses ordinary interaction rules, without a host graph API,
allocation-ID tests, or a caller-supplied encoding of the input.

The domain includes finite connected normal nets with a principal root,
including the deadlocked examples below. Two different graph structures must
be distinguishable up to renaming that preserves kinds, ports, and interface.
Sharing and cycles are part of that structure. The reflection machinery must
also be within the inspectable native domain when presented as a value.

At minimum, completeness must make total finite-graph functions such as cell
counting and structural comparison representable on that domain. For example,
there should be a program `size` whose observable numeral counts every cell,
including each shared cell once. Merely returning the original graph does
not meet this requirement: the program must obtain usable structural
information. Boolean and numeral results must support ordinary internal case
analysis; an uninspectable difference in leftover heap cells is not an answer.
This avoids calling the identity function a reifier.

This is stronger than exhibiting a branch on three constructor labels.
Structural completeness in the SF literature concerns representable functions
on the calculus's own normal forms, including structural equality; an
encoding into another calculus does not automatically transfer that claim to
all host values. The present target deliberately replaces the term domain
with literal port graphs. [Jay and Given-Wilson, introduction and section 8](https://opus.lib.uts.edu.au/bitstream/10453/14486/1/2010003973.pdf),
[Rowe, abstract and section 5](https://arxiv.org/abs/1508.06713)

### Universality and confluence

For each finite source system, a compositional translation maps every source
cell to a fixed principal net with the same arity and maps wiring by plugging
those interfaces together. Each source interaction must be simulated by
finitely many target interactions. A nondegenerate principal net has one
exposed principal root and only auxiliary ports at the other interface
positions. This is the translation criterion used for IC universality.
[Lafont, sections 1.6 and 1.7 and Theorem 1](https://www.i2m.univ-amu.fr/perso/yves.lafont/pub/combinators.ps)

Inspection must respect confluence. The counterexamples already have no
active pairs, so choosing a normalization strategy or waiting longer cannot
make them more inspectable. The obstruction below does not require confluence
as an additional hypothesis.

"Zero cost reflection" means a shared native representation for execution
and structural access, without compulsory conversion into a separately
encoded syntax language. Traversal and reconstruction may take steps.

## A region that no outside interaction can enter

Call a nonempty set of cells `S` *sealed* when every principal port of a cell
in `S` is wired to an auxiliary port of another cell in `S`. The other cell
may be the same cell. Auxiliary wires may still connect `S` to the rest of the
net. Thus a sealed region can be part of a connected graph exposed through a
principal root; this is not an example based on inaccessible disconnected
rubbish.

**Lemma.** No cell in an initially sealed set can ever be rewritten by any
sequence of ordinary IN interactions, under any extension of the signature
and rule table.

**Proof.** Suppose some step were the first to rewrite a cell in `S`. Before
that step, no cell of `S` has been removed or replaced. Each of its principal
wires still joins two cells in `S`, at a principal and an auxiliary port.
An earlier rewrite outside `S` cannot have changed one of these wires because
neither of its endpoints belongs to that earlier pair. The proposed first
step therefore cannot contain a principal-to-principal wire involving `S`,
contradicting the requirement for an active pair. This argument applies to
any finite prefix, so no such first step exists. **End proof.**

The terminology *vicious circle* for principal-to-auxiliary cycles is standard;
Mazza distinguishes these deadlocked configurations from cut-free nets.
The sealed-set lemma and the contextual argument below are our deductions
from ordinary rewrite locality. They are not attributed to a new theorem in
that thesis. [Mazza, sections 1.1.5 and 1.2.4](https://www.lipn.fr/~mazza/papers/Thesis-1.1.pdf)

### Contextual consequence

Consider two sealed interiors with the same number of auxiliary attachment
points and an identical exterior. Identify their attachment points in a
fixed order. No outside step can rewrite an interior cell. Every outside
active pair and its replacement therefore has a matching outside step in the
other net, with exactly the same interface reconnection. Fresh cell names
can be renamed to match. This relation is preserved after each step.

Consequently, no finite observer connected through the exterior can produce
different independently readable Boolean or numeral outputs for those two
interiors. This is true even for an observer designed specifically for the
two examples. It does not depend on limiting the observer to a particular
agent kind or on how many cells or states it uses.

The original hidden graphs remain different. A host program that reads the
whole heap can distinguish them. Such access is absent from the ordinary IN
step relation and cannot be used as evidence for an internal reifier.

### Two explicit connected normal counterexamples

The `hiddenCycle(n)` fixture uses an outer gamma cell `r`, an epsilon cell
`e`, and an odd ring of `n` gamma cells `b[i]`:

| Wire | Endpoints |
| --- | --- |
| Input | `value` to `r.0` |
| Hidden attachment | `r.1` to `b[0].2` |
| Other outer branch | `r.2` to `e.0` |
| Principal cycle | `b[i].0` to `b[(i+1) mod n].1` |
| Remaining auxiliary closure | `b[1].2` to `b[2].2`, `b[3].2` to `b[4].2`, and so on |

All ports are connected. The graph is connected and has one principal root.
There are no active pairs. For `n=1` it has three cells; for `n=3` it has five.
The two exteriors are identical, while the sealed regions have one and three
cells. The contextual consequence rules out a total native `size` program
on this domain. This already contradicts the required structural
completeness without making assumptions about a particular reifier format.

A second fixture, `hiddenAliasing`, uses an outer gamma cell and ternary cells
`B`. Each `B` has its principal wired to its own third auxiliary port. The
root's two auxiliary wires reach either two ports of the **same** `B` or one
port each of **two distinct** `B` cells; the spare ports are connected to
complete the graph. The inputs have two and three cells respectively. The
same sealed-interior argument prevents observing that aliasing distinction.

Port linearity matters: two wires cannot occupy the same port. This fixture
checks whether distinct wires reach the same cell through different ports,
which is a legal graph-level identity question.

## Why a new universal signature does not remove the obstruction

The counterexamples are not limited to extending gamma and delta unchanged.
Suppose an ordinary target system admits the required principal-net
translation of ICs. Write `P` for the image of gamma and `E` for the image of
epsilon. Both are nondegenerate because a bare wire cannot have respectively
three or one free ports. Let their cell counts be `p > 0` and `e > 0`.

Translate the `hiddenCycle(1)` and `hiddenCycle(3)` inputs compositionally.
Inside each ring copy of `P`, every cell principal except its root is wired
to an auxiliary port of another cell in that copy. Its root principal is
wired to an auxiliary interface port of the next ring copy, which is itself
an auxiliary cell port. The union of the ring copies is therefore sealed.
The surrounding copies of `P` and `E` are identical in both translations.

Their hidden regions contain `p` and `3p` cells, and their total sizes are
`2p + e` and `4p + e`. They are distinct connected normal target graphs with
indistinguishable exteriors. No target program can count them correctly.
This proves the incompatibility for a new signature satisfying the chosen
universality criterion as well as for a conservative extension of ICs.

This corollary uses only the geometry of principal-net translation, not the
particular implementation of an IC compiler. As a separate executable check,
Netties' existing nonidentity translation of `hiddenAliasing` produces
699-cell and 1,021-cell IC nets. Their sealed regions contain 322 and 644 cells;
both nets have zero active pairs and the same exterior under the interface
identification. Compilation does not turn their hidden structure into an
observable data description.

## What the duplication result actually says

Lippi's thesis distinguishes trees from principal nets and packages. Section
3.2.1 explicitly permits a universal tree duplicator, with a self-commutation
rule copying the duplicator too. The obstruction concerns arbitrary
principal nets; section 3.2.2, Proposition 3.2.1, rules out a single binary
duplicator symbol satisfying the universal package-copying diagram. Packages
already exclude vicious circles. [Lippi, chapter 3, pages 19–22](https://users.polytech.unice.fr/~lippi/r/phd.ps.gz)

Thus defining copy rules for agent kinds is possible. The difficult requirement
is preserving arbitrary auxiliary wiring while copying all values, including
ones containing the copier. We reproduce the tree/loop distinction below.
The original theorem's single-symbol interface must not silently be extended
to every composite or destructive reflection protocol. The reflection
obstruction in this report follows from the sealed-region proof, independently
of that duplication theorem.

## Executable experiments

All mechanisms run through the existing `System`, `Net`, and `interact`
implementations. The reducer has no reflection hooks. Input construction,
schedule exploration, graph isomorphism checks, and sealed-set detection run
in the host test harness; none is offered to the programs as a primitive.

| Mechanism | Actual result | What it establishes |
| --- | --- | --- |
| Existing IC gamma, delta, and epsilon contexts on the one-cell and three-cell buried cycles | Matching exteriors after 1, 2, and 2 interactions respectively | Reproduces the obstruction for these particular contexts |
| A fixed internal wiring observer on two closures of a three-cell gamma tree | Four `Same` tags versus four `Cross` tags, after five interactions | Some cyclic graph wiring can be observed by ordinary local programs |
| Recursive quote and run walkers on those two cyclic leaf wirings | Five interactions each way; exact graph round trips | A walker can preserve auxiliary back edges without unfolding them |
| The same quoting walker on buried principal cycles | One quote cell remains blocked after two interactions | The walker does not provide total graph reification |
| Quoting a value containing a quote cell | The quote handshake removes it and returns epsilon | The walker is not closed under its own native signature |
| Delta self-commutation on a finite tree containing delta | Correct two copies after three interactions | Self-copying trees are possible |
| The same copier on one delta with its two auxiliaries linked | Six cells after two interactions; two were required | The tree-copy rule fails on a cyclic package |
| A proposed direct asymmetric `Quote/Quote` inspection rule | Passes the engine's port-linearity validator, fails input-swap invariance | Wire orientation must not be used as a hidden way to choose which cell is the argument |

The quote walker uses distinct `View` labels followed by an explicit decoding
pass. It is deliberately a partial candidate, **not** an implementation of the
requested representation-preserving reflection. The wiring observer handles
two specified input shapes, not arbitrary graph comparison. Their purpose is
to distinguish reachable topology from sealed topology and expose the exact
limits of plausible mechanisms.

Every actual same-kind rule used by these candidate systems passes the
input-swap check. With their linear interfaces and unique local rules, they
remain ordinary IN systems; adding them preserves the ordinary local-diamond
argument. Passing finite schedule checks alone is not the confluence proof.

### Reproduction

From the Netties root, with its existing dependencies installed:

```sh
npm run research:reflection
npm run research:reflection:check
```

The first prints the complete deterministic result record. The second checks
TypeScript, runs the research tests, and verifies that the generated record
matches [results.json](results.json). Exterior equality is checked using full
canonical strings; the record prints their SHA256 digests to keep it compact.
To intentionally refresh that record:

```sh
npm run research:reflection -- --write
```

The explorer enumerates reachable states up to isomorphism, with breadth-first
expansion depth 20 and a 20,000-state expansion threshold. It records both an
unexpanded frontier and cycles in the explored transition graph. Every
explored execution fixture in the result record has zero frontier, no
state-graph cycle, and one normal form with no active pairs. The recorded
interaction count is the shortest path to that normal form. This covers the finite fixtures; the universal conclusions use the
proofs above. Agent-free cyclic wires are not represented by this reducer;
the counterexamples contain cells and do not rely on those wires.

Files:

- [mechanisms.ts](mechanisms.ts): fixtures, sealed-set checker, bounded
  exploration, quote and run rules, native wiring observer, and copy rules.
- [experiments.test.ts](experiments.test.ts): independent assertions on the
  counterexamples, outputs, reconstruction, and nonidentity translation.
- [experiments.ts](experiments.ts): reproducible result generation.
- [sources.json](sources.json): primary-source locations, relevant sections,
  and provenance of downloaded source files.

## Justified next steps

With deadlocked native graphs included, searching for additional ordinary
IN agents cannot meet the target. The sealed-principal invariant remains
true for every such extension. Minimizing an agent basis or extending the
archived TC proofs would not address it.

The next design decision is whether to change the interaction model so that
an observer can obtain information through presently auxiliary-only
connections. Any proposal must specify a new enabled interaction in the
buried-cycle examples and establish confluence for the resulting overlapping
interactions. Naming a new agent without enabling such an interaction cannot
work. A host heap-reading hook would change the model too and would not be
an ordinary IN implementation of the operation.

A restricted domain of principal-accessible values, or an explicit graph-data
representation with execution defined on that representation, remains a
separate research direction. It would need a proof that reflection covers
its own executable programs and preserves sharing. Under the confirmed
requirement, neither restriction is a solution to this goal.

**Status:** feasibility is negative for the stated ordinary-IN assumptions.
The sealed-region argument is a mathematical proof with executable witnesses,
not a Lean formalization. No claim is made here that reflection is impossible
in every confluent graph-rewriting model. The previous TC formalization
remains archived in `../boom/src/archive/triage` and was not resumed.
