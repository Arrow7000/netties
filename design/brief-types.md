# netties UX brief: polarity and typed ports

The second design round. The first round (`brief.md`, prototypes a–c) set the
look and feel: direction A, canvas-first with floating islands, is now the
real app. This round is about one feature: giving ports a **direction** and a
**type**, so the playground can show which connections make sense, refuse the
ones that don't, and say why.

Everything in `brief.md` still applies. In particular: the canvas explains
itself, a tool not a textbook, controls look like what they are, show the
result before it's committed.

## The concepts, in plain words

**Polarity.** Every port either *gives* something or *takes* something. A
wire must join a giver to a taker, so every wire has a direction: from the
port that gives to the port that takes. Think of functions: a parameter takes
a value, a return value gives one.

In unary arithmetic:

| agent | principal port | aux 1 | aux 2 |
|---|---|---|---|
| `0` zero | gives a number | | |
| `S` successor | gives a number | takes a number (the one before) | |
| `+` add | takes a number (first argument) | gives a number (result) | takes a number (second argument) |
| `×` multiply | same as `+` | | |
| `δ` duplicator | takes a number | gives a copy | gives a copy |
| `ε` eraser | takes a number | | |

An active pair is two principal ports wired together, so in a polarised
system it is always a giver meeting a taker: a value arriving at the thing
that consumes it. Constructors (`0`, `S`) give on their principal port;
functions (`+`, `×`, `δ`, `ε`) take on theirs.

**Types.** A type is a polarity plus, optionally, a name: "gives a number",
"takes a list". A wire must join a giver and a taker *of the same name*. A
port with a polarity but no name is fine; it fits any name. Polarity on its
own is the simplest type system there is.

**Principal versus aux is a separate question.** Either kind of port can
have either polarity, as the table shows.

**The payoff.** Two principal ports can only meet if one gives and the other
takes, with matching names. So in typed arithmetic, `+` can never meet `×`
(both take), and `0` can never meet `S` (both give). The rule grid today
lists those pairs as "no rule", as if something were missing. With types,
every pair that *can* meet has a rule, and the rest are shown as "can never
meet". This is the guarantee typed interaction nets give: a well-typed net
never gets stuck on a missing rule.

**Consequence: no agent type can meet itself in a polarised system** (its
principal port would have to both give and take). Lafont's combinators
γ, δ, ε all meet themselves, so they can't be polarised as they are. His
*directed combinators* split each one in two: γ and γ*, δ and δ*, ε and ε*.
Unstarred ones give on their principal port and take on their aux ports;
starred ones are the reverse. There are nine rules, and no symbol meets
itself. This system is already in the app as the examples "Directed
commutation" and "Directed erasing" (currently untyped: the prototypes
should show it as it would look with polarities).

**Free ports (loose ends)** take the opposite side of the port they're
attached to. A loose end on `×`'s result wire is the net *giving* a number to
the outside world. Joining two loose ends must also respect types.

## Decisions already made (by the user)

1. **Ill-typed connections are forbidden, full stop.** Not drawn as errors,
   not allowed and flagged: refused. Dragging a wire end over a port it
   doesn't fit refuses the drop and says why ("both ports give a number",
   "this port takes a list, that one gives a number"). While dragging, every
   port the wire can't go to is visibly greyed out but still reads as a port.
   Nets loaded from text or a share link that don't type-check need a
   decision: see the open questions.
2. **Rules must respect the types.** The rule editor checks a rule's
   right-hand side and won't save one that's ill-typed. Pairs that can never
   meet aren't offered a rule at all.
3. **Typing has three strictness levels, chosen per system** (the user's
   idea, by analogy with TypeScript's strict flags):
   - **Untyped.** No type UI anywhere. You can't add types. This is what the
     plain combinators use, and the app must look exactly as it does today.
   - **Optional.** You *can* give ports types, but don't have to. Typed ports
     are checked; untyped ports accept anything. Useful for agents that work
     on anything, like a duplicator that copies whatever it's given.
   - **Required.** Every port of every agent type must have a polarity (a
     name is still optional). Types become mandatory fields.
4. **Examples:** arithmetic becomes typed (every port gives or takes a
   number); the plain combinators stay untyped; the directed combinators are
   polarised (no names).
5. **Typed and polarised systems are not separate features.** Polarity is a
   type with no name.

## The central UX problem

Avoid a playground that feels like "a mess of toggles and switches and
different screens" (the user's words). The proposed principle, to test in
the prototypes:

> **The system decides what the interface shows.** Types aren't a mode of the
> interface, they're part of the agent types you're playing with. An untyped
> system shows no type UI at all. As soon as types exist, the canvas starts
> showing directions, refusing mismatches and greying out ports that won't
> fit. The strictness level is a property of the system, saved with it, not
> a global UI toggle.

## What the prototypes need to answer

### 1. How is direction shown on the canvas?
This is the hardest visual question. Node editors (Unreal Blueprints,
Blender's shader nodes, Houdini, Max/MSP) solved typed ports long ago: a
colour per type, a socket shape per kind of value, incompatible sockets
dimmed while you drag. But they show direction by *side*: inputs on the
left, outputs on the right. We can't: Lafont's drawing style puts the
principal port at the tip of the triangle and the aux ports along the base,
and the auto layout decides which way agents face. So direction needs
another encoding. Candidates (explore, combine, or reject):
- arrowheads on wires, mid-wire or near the taking end;
- marks on the ports themselves (a notch, a small arrow, an open versus
  closed socket). Careful: filled versus hollow already means something for
  agents (it's just a name, but it's there);
- +/− labels, as Lafont writes them on free ports;
- something that only appears on hover, drag or selection, versus always
  shown.
It must stay faithful to Lafont's style (thin black ink, bridge gaps at
crossings) and stay readable when a net is dense. Colour is scarce: accent
blue is selection and targets, amber is active pairs, red is stuck. If type
names get colours, the prototypes must show how that coexists.

### 2. How are type names shown?
Most nets will have one or two names ("number", "list"). Always show them,
only on hover, only when there's more than one? Where does a name live: on
the port, on the wire, in the hover panel?

### 3. Where are types edited?
Probably in the type editor (the popup with the live preview, ports marked
and numbered), by clicking a port in the preview and choosing gives or takes
and a name. Where do you create, rename and delete names? What happens when
you change a port's type while agents of that type are already on the
canvas, wired in ways that become ill-typed? (Forbidding ill-typed things
"altogether" means something has to give: refuse the change, offer to
disconnect the offending wires, or something better.)

### 4. Where does the strictness level live, and what happens when it changes?
It belongs to the system, not the global toolbar. Candidates: in the palette
header, near the rule grid, in a "system" popover. Switching up to Required
when some ports are untyped: what shows what's missing, and how do you fill
the gaps quickly? Switching down to Untyped throws types away: that must be
clearly destructive and undoable. Untyped must look exactly like today's app.

### 5. Gestures and feedback
- Dragging from a port: compatible ports highlight, incompatible ones grey
  out, each with a reason on hover.
- Dropping on empty canvas still leaves a loose end; the loose end shows its
  direction.
- Merging a carried end into a loose end must also respect types.
- Placing an agent from the palette: is there any type hint before it's
  wired?
- The hover panel explains a port's type in a plain sentence ("Takes a
  number. Wire it to a port that gives one").

### 6. The rule grid
It gains a "can never meet" state, distinct from "no rule yet". It should
read as a feature (the types rule this out) rather than a gap. With
polarities, the grid of a polarised system is really givers × takers, which
might suggest a different arrangement (a rectangle instead of a triangle).
Worth exploring.

### 7. The rule editor
Not redesigned yet, but it now needs to show the interface ports' types and
refuse ill-typed right-hand sides with a reason. Show just enough of this to
make the idea clear; a full rule editor redesign is not this round.

## What's out of scope
- Polymorphic types (a duplicator that's "number in, number out" in one place
  and "list in, list out" in another). Optional mode covers the simple case:
  untyped ports accept anything. Mention it if a design leaves room for it.
- Lafont's "execution" walk (a token travelling the net with two stacks).
  Planned for later; don't design it now, but don't block it.
- Redesigning the translation screen, component editor, text view.

## Open questions for the prototypes to propose answers to
- A net loaded from text or a link that doesn't type-check: refuse to load,
  load with the bad wires disconnected into loose ends, or load the system
  untyped? (Remember: the user wants ill-typed things forbidden.)
- Do components need anything? A component's free ports have types too.
- How does the combinator translation screen behave for a typed system? (Not
  a design ask; just flag it if it gets in the way.)
