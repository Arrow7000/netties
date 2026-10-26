# netties UX brief: phones, part 1 (editing the net)

The fourth design round. Rounds 1 to 3 (`brief.md`, `brief-types.md`,
`brief-editors.md`) set the look and the editors on a desktop. This round
makes the main canvas fully usable on a phone: not just looking and
stepping, but building and changing nets. Part 2, a later round, does the
same for the editors that open over the net (the rule editor above all).

Everything in `brief.md` still applies: the canvas explains itself, a tool
not a textbook, controls look like what they are, show the result before
it's committed. The user dislikes clutter and "textbook" chrome and wants
industrial-grade UX.

## The user's words (2026-10-26)

> i think it's time to try and make a mobile version of this thing. [...]
> with as much functionality of the desktop version as possible.

> phone first. that's the main place where people come across this app.
> tablet we should also handle eventually but phone first definitely.

> yes editing on phone is a real goal now, yes.

> i think it would be nice if users could drag and drop to connect wires
> actually, not just tap to select and another tap to connect. maybe that
> can be a fallback, but the ideal case is drag and drop. if both ports are
> in view, that's for sure the nicer UX.

## What's there now (stage 1, built on the `mobile` branch)

Phones get a compact layout below 760px wide or 500px tall
(`src/ui/compact.ts`, the last block of `src/styles.css`):

- **Top:** the logo, File (with Copy link), Examples; undo and redo on the
  right.
- **Bottom:** Step, Step all, Run (with label); Reset example when it
  applies; Fit; a sliders button opening speed, Auto/Manual/Tidy, wire type
  labels and the theme.
- **The card:** what's tapped (the hover panel) or what's selected (the
  selection panel, with its actions) sits along the bottom above the bar,
  full width, at most 40% of the height. Sideways, bottom left, 580px wide.
- **Hidden:** the palette (agents, components, the rule grid thumbnail, the
  "Directions and types" link), the counters, zoom buttons.

Touch on the canvas (`src/ui/gesture.ts`, `src/ui/Canvas.tsx`):

- One finger on empty canvas pans; two pinch. Lifting one of two keeps
  panning.
- **A tap keeps the hover.** Tapping an active pair shows its preview (the
  rule's result framed beside the pair, as on desktop), and the camera
  brings it into view; tapping it again fires. Same for a pair with no rule
  (the second tap opens the rule editor). Tapping anything else shows it in
  the card; tapping empty canvas clears.
- Fingers reach ends (22px), wires (16px) and agents (8px past their
  outline) at any zoom, nearest first.
- **Wires by drag and drop:** press a port and drag; letting go snaps to
  the nearest end within 30px that the wire may plug into, and that end
  lights up beside the finger. Dropping on empty canvas makes a loose end,
  as on desktop. Dragging an agent moves it.
- **A second finger during a drag** pans the view (a third pinches) while
  the first keeps carrying the wire or agents, so a far-off port can be
  reached.

So on a phone today you can look, step, run, move agents and rewire. You
can't add agents, select more than one thing, copy or paste, or reach the
types sheet, the rule grid or the agent editor.

## Desktop gestures with no touch equivalent yet

| desktop | does | phone today |
|---|---|---|
| drag from the palette | adds an agent (dropped on a port, plugs in) | palette hidden |
| click a palette tile | opens the agent editor | hidden |
| "Directions and types" in the palette | opens the types sheet | hidden |
| rule grid thumbnail | opens the rule grid | hidden |
| drag on empty canvas | marquee: rightwards selects what's inside, leftwards what it touches | pans instead |
| Shift-click | adds to the selection | none |
| Alt-click a pair | selects its wire instead of firing | none (tap selects plain wires) |
| double-click | opens or closes a component | double-tap, exact hits only |
| ⌘C ⌘X ⌘V | copy, cut, paste (as JSON and as text) | no clipboard events without a keyboard |
| ⌘A, Delete, Escape, X | select all, delete, clear, flip | Delete and Flip in the selection card |
| S, A, R, F | step, step all, run, fit | buttons |
| hover Step / Step all | previews what they'd fire | none |
| hover a wire | shows its type label | the view menu's "type labels on every wire" |

## What the prototypes need to answer

### 1. Adding agents
Where the palette lives on a phone and how agents come out of it. Drag
and drop must work (drag a tile onto the canvas, onto a port to plug in).
A tap should do something useful too (on desktop a tap opens the agent
editor; on a phone, placing one in the middle of the view, or plugging it
into the selected port, may be better; the editor could then be a long
press or a button). It also needs room for components ("From selection")
and a way to make a new agent type.

### 2. The card
What's tapped and what's selected share the bottom. How tall is it, can it
be pulled up for more and flicked away, and does the net's fit leave room
for it (today it can cover the bottom of the net)? Where do actions go
(Delete, Flip, Make component, Expand, Change agent, Copy)? How does it
relate to the palette and to the run controls: one sheet with several
faces, or separate pieces?

### 3. Selecting several
Without Shift or a mouse drag. Candidates: long-press then drag for a
marquee (rightwards inside, leftwards touching, as on desktop), a select
mode where taps add, a "select connected" action, select all. Moving a
selection by dragging any agent in it already works.

### 4. Copy, cut, paste, duplicate
With buttons. The system clipboard can carry the text format (paste
already parses text); custom clipboard types don't work on phones. A
duplicate action (copy and paste beside, in one) may cover most uses.
Where does a paste land: in the middle of the view, or where you tap next?

### 5. The rest of the canvas
- Alt-click's job (select a pair's wire without firing): a long press?
- Step and Step all previews: press and hold the button?
- Opening the types sheet, the rule grid, the agent editor and a
  component: from where? They open full-screen today (redesigning them is
  part 2; this round only decides how you get to them).
- Wire drawing fallback for when the ends are far apart: tap a port, then
  tap another (the user wants drag and drop first; this is only the
  fallback). Does it need its own affordance, or does it come for free
  from the selection card ("Connect to…")?
- Sideways phones: the same design rotated, or a different arrangement
  (the bars eat most of the 390px height)?

## Out of scope
- The rule editor, component editor, agent editor, types sheet, rule grid,
  text view and combinator view on a phone (part 2). Only how they're
  reached.
- Tablets (later; they have room for the desktop layout).
- The LLM create UI.

## Prototype notes
- Unlike earlier rounds, these prototypes are built **into the real app**,
  on a throwaway branch (`mobile-protos`), because what matters here is how
  it feels under a finger with the real canvas, layout and touch handling.
  Each direction replaces the phone chrome (palette, card, bars) and is
  picked with `?proto=a`, `?proto=b`, `?proto=c`; a small switcher on the
  page moves between them. Desktop is untouched. The chosen direction is
  then built properly on `mobile`; the prototype branch is thrown away.
- Two or three directions. As in earlier rounds, `prototypes/index.html`
  gets a "Round 4" section: each direction in a paragraph of plain
  language, its gains and costs, and a "Try in each" list.
- The user tries them on their own phone over the local network.
