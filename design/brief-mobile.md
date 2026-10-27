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

## The verdict (2026-10-27)

The user tried the three prototypes on their phone and picked A, with this
feedback, kept as written:

> am i right in thinking that the only difference between A/B/C is how we
> display and expand the panel on the main canvas? the rest seemed the same
> as far as i could tell?
>
> ok so: A is very much the winner. the non-committal drag handle is far
> clearer than the others with their "+" or "Edit" buttons. A is also more
> loyal to the desktop version, which i like.
>
> that said, i have a few small issues still.
>
> A-specific feedback:
> - im not sure it makes sense to unify the selection inspector panel with
>   the slide-out panel. truth is i could be convinced of it.. but then i
>   think the toggle selector label of that section needs to be consistent,
>   and always say "selection" or smth. not selection if an agent is selected
>   but wire/pair/whatever for other things. we could have a separate label
>   of what kind of thing is selected inside that section rather than the
>   toggle selector button itself being different
> - clicking on a cell in the grid view shouldn't select a rule and then go
>   to the selected view. that doesn't make sense. at the very least if we
>   did that we should then have a button to allow the user to actually edit
>   that rule. rn the user has to go back to rules and click full grid before
>   they can select a rule to edit. that's not obvious.
>   either: 1. we keep it so that clicking a cell selects that cell, and we
>   display the highlighting of the applicable rule category in the legend as
>   we do now. but then the content of the selection panel needs to go
>   underneath the grid/legend, and you can click an edit rule button from
>   there. or, 2. we do away with a cell selected mode altogether. but then
>   either clicking on a cell goes directly to edit mode, or there is only a
>   "full grid" button from where clicking cells to edit them is done. my
>   preference is 1.
> - the "tap a tile to add one [etc]" text needs to be right underneath the
>   agents/components section. rn it's under the directions/types button,
>   which is confusing what it applies to.
> - tapping on the canvas should shrink the panel slideout. either all the
>   way in or at least  to the half-state.
> - i think the entire width around the panel dragger pill should be
>   clickable/draggable. not just the pill itself
> - long-pressing an agent should push the slideout panel down so that it
>   becomes clear that you're now in dragging mode. it should not just be
>   considered as a regular click
> - long-pressing on the agent name can sometimes select the text. it should
>   work the same way as a long click on the icon
> - when the canvas is zoomed out quite far, sometimes a press on a wire
>   registers as a click on a port. do ports have higher priority? i feel
>   like they probably should have lower priority than wires?
> - after you've clicked on an active wire and it shows the active pair, if
>   you then click select wire instead, nothing seems to have changed. we
>   still show the rule preview, the only thing that changed is that select
>   wire has been replaced by a delete wire button? i feel like maybe we
>   should no longer show the firing preview then? not sure.
> - selecting an agent brings up lots of options. not all of these apply to
>   selected wires, but we should incorporate for wires the ones that do.
> - long-pressing one of the step/step all/run buttons should put the button
>   in selected mode, which then brings up the action information and preview
>   mode if applicable. pressing it (with a normal, quick tap) again should
>   actually execute the action. requiring the user to hold their finger
>   there as they read the description and figure out how to cancel the
>   action is cumbersome.
> - long-pressing the run button on its text selects the text
>
> rule editor:
> - the default view is zoomed out more than necessary for some reason
> - after making a wiring change it zooms back out again. even if this
>   wasn't very far out i don't think this should happen? probably just
>   leave it zoomed as is?
> - there's no selection panel here, or at least it's a much narrower one,
>   so you can't take all the actions as you can in the main canvas. e.g.
>   it's not clear how to delete a wire.
> - here the functionality for connecting wires by tapping one end and then
>   the one you want to connect it to doesn't work. all that does is select
>   one port after the other.
>
> ok whew that was a lot of feedback. lol. but excellent job dude!!!! this
> looks and feels so nice already, and you managed to get basically all the
> functionality in there?! incredible

### What gets built (decisions taken without asking, open to change)

A is built properly on `mobile`, replacing stage 1's bottom card and bar;
B, C and the `?proto` switch go.

- **The third face is always called Selection.** Inside it, a small label
  says what it holds (Agent, 2 agents, Wire, Active pair, Port, Loose end,
  Wiring, Step). It still appears only while something is tapped or
  selected.
- **Rule grid, option 1.** Tapping a cell selects it and lights its kind in
  the legend, as now, but the face stays on Rules: what the cell is shows
  under the grid and legend, with Edit rule (or Write rule) there.
- **The tiles' hint** sits right under the agent tiles.
- **A tap on the canvas lowers the sheet** from all the way up to its peek
  (not closed, so what was tapped still shows).
- **The whole row around the grabber** takes the drag and the tap, not just
  the pill.
- **Holding a tile lifts it:** the sheet drops out of the way at once, and
  the tile can be dragged anywhere onto the canvas; letting go without
  leaving the sheet puts it back. Holding no longer opens the agent editor
  (that was the "regular click"), so a selected agent gets **Edit agent**
  among its actions; New still makes a new type. Tile names, button labels
  and the rest of the phone chrome can't be text-selected.
- **Wires beat ports** under a finger: a press goes to a port only within
  its drawn size plus a little; past that, a wire under the finger wins.
- **Selecting a pair's wire ends its preview:** the pair is then just a
  selected wire, with Fire and Open rule among its actions.
- **A selected wire gets what applies of an agent's actions:** Delete,
  Select connected, Select all, its two agents, and Fire and Open rule for
  an active pair.
- **Step, Step all and Run: a hold arms the button** instead of firing on
  release. It stays pressed, the sheet says what it would do (and Step and
  Step all show their preview on the canvas); a quick tap on it then fires,
  and a tap anywhere else disarms it. A quick tap on an unarmed button fires
  straight away, as before.
- **Rule editor** (its phone redesign is still part 2; these are fixes):
  it opens zoomed to fit the rule, not further out; a change no longer
  refits it; selecting in it shows the same actions as on the net (so a
  wire can be deleted); and the tap-a-port-then-a-port wiring works there
  too.
