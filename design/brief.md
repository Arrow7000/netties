# netties UX brief

The brief for redesigning the interface. The engine, layout, routing and
animation stay as they are; this is about everything you see and touch.

## Who it's for and what it's for

A playground for interaction nets that teaches as you play. The main user is
someone curious, often a developer, who has **not** read the literature. They
should be able to work out what things mean, and why something doesn't work,
from the screen alone. A second user designs their own systems (agent types,
rules, components) and wants to see how they translate into combinators.

The core loop is: build a net, poke it, watch what happens, change something,
poke it again. Anything that interrupts that loop is a bug.

## Principles

1. **Gestures do what you'd expect.** Direct manipulation everywhere. A
   gesture never quietly does something destructive. Everything can be
   undone.
2. **The canvas explains itself.** Meaning is shown where it happens, at the
   moment you need it: what is active, what a click will do, which ports fit
   together and why the others don't, and what a step is about to do.
   Explanations live in hovers, empty states and inline hints, not in
   paragraphs of sidebar text.
3. **A tool, not a textbook.** The nets keep Lafont's drawing style, which is
   the visual language of the subject. The chrome around them should feel
   like a solid professional tool, not an academic page. Clarity beats charm.
4. **Controls look like what they are.** Buttons look like buttons, toggles
   like toggles, mode switches like mode switches. Controls are grouped by
   what kind of thing they act on, not lined up in one row.
5. **Show the result before it's committed.** Hover, drag and drop targets,
   and the marquee all show live what will happen if you let go now.
6. **Time is under your control.** You can slow a step down, and possibly
   scrub through it, to see how the rewiring happens.

## Features, by how often they're used

This order is my guess and needs checking. It decides what gets prime space
and what sits behind a menu.

**Constantly**
- Placing agents (drag them in from a palette)
- Drawing, rewiring and deleting wires between ports
- Firing an active pair (click it)
- Stepping (one pair, or every pair in parallel), running, stopping
- Undo and redo
- Pan, zoom, fit to view
- Selecting (marquee, click, add to selection) and moving or deleting the
  selection

**Often**
- Animation speed and slow motion
- Switching between auto layout and manual placement, and Tidy
- Defining and editing agent types: symbol, name, number of aux ports, fill,
  shape
- Opening a rule to see or redraw it (from the rule list, or from a stuck
  pair on the canvas)
- Loading examples and presets
- Stats for the current run

**Sometimes**
- Making a component from a selection; placing, expanding and collapsing
  instances; breaking one apart; editing a component's definition
- The combinator translation explorer: general or restricted mode, stepping
  the source, stepping the combinators, cost per rule
- The text view: editing, loading, opening and saving files
- Sharing a link, exporting SVG, clearing the net, switching theme

**Coming later, but the design should leave room for it**
- Typed ports and polarities (see below)
- Extensions: native numbers, labelled duplicators, references, amb
- TikZ export

## Feedback on the current version

This is what the user reported. Each item is a requirement unless it's marked
as an idea.

### Wires
What a drag means depends on where it starts, so you can always tell what's
going to happen:
- **From an empty port:** you're drawing a new wire. Drop it on another
  empty port to connect the two, or on a loose end to join it to that wire.
- **From a port with a wire in it:** you're unplugging that end of the wire
  and carrying it. The real wire follows the cursor, rather than a new dashed
  one appearing, and the port is left empty. Drop it on an empty port to plug
  it in there, or on a loose end to join the two wires.
- **Loose ends are the net's free ports.** A wire end that isn't plugged into
  anything is exactly what interaction nets call a free port: the net's
  connection to the outside. Dropping a carried end on empty canvas leaves it
  loose. In auto layout, a loose end then moves to the top or bottom edge.
  That's a chance to teach the concept.
- *Proposal:* a port that already has a wire isn't a drop target. Hovering
  over it says why: each port takes exactly one wire. That teaches another
  rule of the formalism.
- Re-laying out after an edit is animated, the same way steps are, so you can
  keep track of what moved. (Done in the current version.)
- The dashed preview wire must be routed exactly like the real wire would be.
- While you're dragging a wire, highlight both the port you started from and,
  above all, the port you're over: "let go now and it goes here".
- When ports have types, dragging from a port greys out the ports it can't
  connect to. They should still read clearly as ports, and you should be able
  to find out why each one won't fit.

### Canvas
- Left-dragging on empty canvas draws a selection box, without needing shift.
  Middle- or right-dragging pans.
- While the selection box is being dragged, highlight what it will select.
- The selection outline must follow the agent's shape exactly. At the moment
  it only roughly follows the triangle.
- Hovering over an active pair should make it obvious that clicking it fires
  it. There should also be some way to select that wire rather than fire it,
  which isn't possible today. The thick border on active wires is a good
  start.
- *Idea:* preview a step before it happens. While two agents face each other
  principal to principal, the wires could run faintly into the agents, with
  each stump pointing toward the wire it will join, or ending in a small × if
  it's going to be erased. That works for rules that only reconnect wires;
  rules that create new agents need another approach (perhaps a faint
  overlay of the result).

### Controls
- The toolbar puts very different kinds of thing in one row, all looking the
  same: running, history, layout mode (a toggle), view, destructive actions,
  and switching to another screen. Split them up by kind and make each one
  look like what it is.
- Things that are actions must look like buttons, not links ("New agent
  type", "New component").
- Bring back a speed control. Slow motion is needed.

### Sidebar and agent types
- It reads like paragraphs from a textbook. Replace the explanatory text with
  affordances and hints at the point of need.
- Clicking an agent type should open its editor, not drop an agent at a
  random spot. Agents are placed by dragging them from the palette.
- The new-type form is bleak: three text inputs and a checkbox. It should be
  a proper editor, with a live preview, where you also choose the shape. Any
  type can be a circle, not only built-in ones.
- It isn't clear whether an agent's symbol and colour mean anything. They
  don't; they're drawing conventions. The interface should make that obvious
  (see below).

### Not reviewed yet
- The rule editor
- The translation explorer (the user likes it a lot)
- Components, the text view, sharing

## Concepts the interface has to teach

- **Principal and aux ports.** Each agent has one principal port and some aux
  ports. Two agents interact only when their principal ports are wired
  together: an active pair.
- **Rules.** For each pair of agent types there is at most one rule, saying
  what the pair is replaced by. A pair of agents with no rule is stuck.
- **Symbols, fills and shapes are just names.** Lafont draws the constructor
  γ filled and the duplicator δ hollow so you can tell them apart, and draws
  the eraser ε, which has no aux ports, as a circle. Only the rules give an
  agent its meaning.
- **Types (coming later).** In plain interaction nets any port can be wired to
  any other. Typed nets give each port a type and a direction, input or
  output. A wire must join an output to an input of the same type. This
  guarantees that two agents with no rule between them can never meet, which
  is why arithmetic currently lists rules like "+ ⋈ ×" as missing even though
  those pairs can never actually come up.
- **Free ports.** These are the net's connections to the outside world, drawn
  dangling off the top or bottom edge of the canvas.
- **Components.** A component bundles a piece of net into a single box.
  Editing its definition updates every instance. An instance dissolves as
  soon as anything inside it interacts.

## Decisions

- **Dropping onto a port that's already wired is refused.** Hovering over it
  explains why.
- **Trackpad:** two-finger scroll pans and pinch zooms, as in Figma. With a
  mouse: left-drag draws a selection box, middle- or right-drag pans, and the
  wheel zooms.
- **Components sit with the agent types,** in the same palette or right
  below it. It should be clear which are components, but both are things you
  drag in and edit, so they belong in the same place.
- **Rules stay visible in a list,** and it must be obvious that they can be
  edited, so nobody mistakes them for fixed. The current version gets this
  right.
- **Examples move to the top bar,** perhaps as a dropdown, not the sidebar.
  Loading one replaces the whole net, and the UI should say so rather than
  treating it as just another bit of functionality.
