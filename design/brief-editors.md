# netties UX brief: the editors

The third design round. Round 1 (`brief.md`) set the look: direction A,
canvas-first with floating islands, is the real app. Round 2
(`brief-types.md`) added directions and types. This round redesigns the three
screens round 1 only restyled: the **rule editor**, the **component editor**
and the **combinator translation**.

Everything in `brief.md` still applies: the canvas explains itself, a tool
not a textbook, controls look like what they are, show the result before
it's committed. The user dislikes clutter and "textbook" chrome and wants
industrial-grade UX.

## What's there today

Screenshots: `assets/now-rule-editor.jpg`, `assets/now-translation.jpg`,
`assets/now-translation-opened.jpg`. Run the real app with
`npx vite --port 5301 --strictPort` from the repo root (any free port; not
5299, which is the user's) and click a cell of the rule grid, or open File →
Combinator translation.

All three take over the whole window. Each has a header bar (title on the
left; Undo, Redo, Delete, Cancel and Save buttons on the right), a strip of
small palette buttons below it, its own canvas or canvases, and a line of
help text at the bottom.

- **Rule editor** (click a cell of the rule grid). Left half: the pair,
  read-only, on a grey background. Right half: the result you build. The
  interface ends (x₁, x₂ along the top for the top agent's aux ports, y₁… along
  the bottom for the other's) stay fixed while you build. A status line says
  what's missing ("1 port still needs a wire", "Not symmetric…"). Agents can
  only be added by clicking a palette button; they land at a default spot.
- **Component editor** (click a component's tile in the palette). Name
  and symbol fields in the header, one canvas. The net's loose ends are the
  component's interface. Saving updates every instance on the canvas.
- **Combinator translation**. Left: your net. Right: the same net translated
  into Lafont's interaction combinators (γ, δ, ε), each of your agents drawn
  as a box like `[S]`. Double-click a box to see the combinators inside it.
  Step / Run step your net and the translation follows; "Step combinators" /
  "Step all combinators" step the right side alone. General / Restricted
  toggle at the top right.

## The user's words (braindump, 2026-10-13)

> the rule editor – and combinator view for that matter – should not be
> full-page modes, but popovers or smth. so that it should be possible to
> click outside of them to dismiss.

> the rule editor also needs some love. and actions inside it need to be
> undoable

(Undo inside the editor turned out to work already.)

> the rule editor has different affordances than the main canvas. can't drag
> an agent into the end state canvas from the panel at the top, but can only
> click them. the affordances and abstractions and shortcuts etc need to be
> supported here too, as much as possible

> the combinators view UX needs work. rn it's janky and you can't recollapse
> a thing after opening it and also it's not clear what general and
> restricted mean and why you can sometimes step one but not the other or
> sometimes neither. needs some love basically.

> i don't think the combinator translation toggle needs to have pride of
> place right at the top

(It has moved to the File menu for now. This round decides its real home.)

## Decisions already made (by the user, 2026-10-14)

1. **The editors are large floating panels** over the main canvas, not
   full-screen modes. The main canvas stays visible around them. Clicking
   outside a panel closes it.
2. **Unsaved changes keep a panel open.** Clicking outside a panel with
   unsaved changes doesn't close it. Instead its Save and Cancel buttons
   flash, to say "deal with this first". The small panels in the real app
   (the agent editor, the types sheet) already stay open this way
   (`src/ui/dismiss.ts`), but without the flash.
3. **Undo:** while a panel is open, undo and redo step through the edits
   made in it. Saving puts the whole change into the main history as one
   step, so one undo on the main canvas takes back the whole save.
4. **The combinator view is for teaching:** showing that any interaction
   system can be rebuilt from just γ, δ and ε. Small examples, plain
   explanations. Checking that big nets agree is secondary.
5. **Same affordances as the main canvas, as far as they make sense:**
   - drag agents in from a palette, dropping onto an agent to plug into its
     nearest fitting port;
   - drag selection that picks up wires;
   - ⌘C / ⌘X / ⌘V, including copying part of the main net and pasting it into
     a rule's result;
   - Delete, Escape and flip;
   - the same tooltips, hover panels and selection panel.
6. **An opened box can be closed again**, in the combinator view as on the
   main canvas (the main canvas now has a collapse button at the top right of
   an opened component's dashed outline).

## Concepts, in plain words

**Rule.** When two agents meet principal port to principal port (an active
pair), a rule says what replaces them. The pair disappears; the wires that
were plugged into its aux ports are left dangling, and the rule's result is
plugged into them. In the editor those dangling wires are the interface
ends: x₁, x₂… for the top agent's aux ports, y₁… for the bottom one's. A
result is finished when every port and every interface end has a wire. A
rule for an agent meeting its own kind must be symmetric (look the same
upside down), because nothing says which of the two is "on top".

**Component.** A named piece of net that can be placed like an agent and
collapsed into one box. Its loose ends are its interface. Components
dissolve when anything inside them interacts (the user's choice).

**The combinator translation.** Lafont (1997) showed that γ, δ and ε can
imitate any interaction system: each agent becomes a little net of
combinators (a "cell"), wired so that when two cells meet, the combinators
inside play out the rule and leave behind the cells of the rule's result.
One step in your net becomes many combinator steps. There are two versions:

- **Restricted** (Lafont §2.4): each cell holds just enough to perform the
  rules it can take part in. Small, but it only works when no agent can end
  up creating another of its own kind. In arithmetic, `+` meeting `S` makes a
  new `+`, so arithmetic doesn't qualify. Today the app just greys the
  button out, with a tooltip like "0 can lead to creating itself".
- **General** (Lafont §2.7): each cell carries a copy of the whole system's
  rules (Lafont calls it the genetic code), which δ trees copy and a decoder
  reads when two cells meet. It always works, but it's enormous.

How big, for the examples (agents in the net → combinators):

| example | agents | restricted | general |
|---|---|---|---|
| Commutation, Erasing a tree, etc. (already γ/δ/ε) | 2–5 | the same net | the same net |
| One token, no rules | 1 | 3 | 11 |
| Two annihilating tokens | 2 | 6 | 30 |
| Erasing without commutation | 4 | 90 | 810 |
| Directed commutation | 2 | not possible | 1,690 |
| 3 + 2 | 8 | not possible | 5,895 |
| Add two list lengths | 21 | not possible | 25,647 |

So nothing interesting fits on screen whole. Teaching has to happen one
agent and one rule at a time, with the code drawn as a labelled box rather
than as thousands of combinators. Opening a general-translation box today
fills the screen with an unreadable tangle (`assets/now-translation-opened.jpg`).

**Why a step button is greyed out**, today with no explanation:
- Step / Run (your net): nothing in your net can interact (no active pair
  with a rule), or the translation failed.
- Step combinators: no two combinators face each other. This happens when
  your net has no active pair, and also in the middle of a translated step.
- A pair with no rule is translated arbitrarily, as in the paper, so the
  combinators may still do something when your net can't.

## What the prototypes need to answer

### 1. The panel
- How big, and where: centred, or growing out of what opened it (a rule-grid
  cell, a component, an agent)? Can it be moved or resized? Does the main
  canvas dim behind it?
- What stays usable outside it? Ideally the main palette and the main
  canvas, so you can drag agents from the main palette into the panel and
  copy from the main net. Or does the panel carry its own palette? Either
  way, it should look and work like the main palette (drag, not just click).
- Where do the title and the Save, Cancel, Delete, Undo and Redo controls
  go, without today's heavy header bar? What do Escape and ⌘↵ do? How does
  the Save/Cancel flash look, and does Escape with unsaved changes flash too?
- Can you move to a neighbouring rule without closing (next or previous pair
  in the grid), or open a rule straight from an active pair on the canvas?

### 2. The rule editor
- Today the read-only pair takes half the space. How should "before" and
  "after" relate: side by side, the pair small or ghosted, or one canvas
  where the pair turns into the result? The step preview on the main canvas
  already draws a rule's result framed beside its pair (`TODO.md`, "Steps
  shown as rule applications"); the editor and the preview should feel like
  the same thing.
- A newcomer should understand from the editor alone what a rule is: that
  the pair disappears and its dangling wires are the interface ends, and why
  every end needs a wire.
- Status messages (ports still to wire, wires that don't fit the types, not
  symmetric) should appear where the problem is, not only in a status line.
- Typed systems: interface ends carry the type of the port they stood for;
  wiring them follows the same fit rules as the main canvas.

### 3. The component editor
Same shell as the rule editor. Name, symbol, the interface (its loose ends),
"saving updates every instance" (say how many there are), and Delete
component. Should it open in place over the instance you were looking at?

### 4. The combinator view (teaching)
- Where does it live? It's in the File menu for now. Candidates: a panel
  opened from an agent ("Show as combinators") or from a rule, a view of the
  whole net, or both.
- Explain restricted and general in a sentence or two each, and for this
  system say which applies and why, naming the cause ("`+` meeting `S` makes
  a new `+`, so cells would have to contain themselves").
- Show one agent's cell. In general mode, draw the code as a box you can
  name and point at, not as a tangle.
- Show one rule playing out in combinators, step by step or as a slowed-down
  run, ending in the cells of the result.
- Opened boxes can be closed again.
- Every greyed-out step button says why, in place.
- Steps should be shown as rule applications, like the main canvas (the
  translation screen still uses the old blended animation).

### 5. Keyboard and focus
While a panel is open, which keys go to it and which to the main canvas? (⌘Z
goes to the panel, per decision 3.) What do the global Undo and Redo buttons
at the top right do while a panel is open?

## Out of scope
- The "create it for me" LLM interface (a later round, low priority).
- The text view (File → Text view). Leave it as it is unless the panel shell
  obviously suits it too; then just say so.
- Translating typed systems into directed combinators.
- Lafont's "execution" walk (a token travelling the net with two stacks).
  Don't design it, but don't block it: it would live in the combinator view.

## Prototype notes
- Two or three directions, all built on the large floating panel, in
  `prototypes/editors-a/` and so on, plus a "Round 3" section at the top of
  `prototypes/index.html`. Like the earlier rounds, describe each direction
  in a paragraph of plain language, then its gains and costs, and end with a
  "Try in each" list.
- Start from the real app's look (`src/styles.css`; the round 2 prototypes
  in `prototypes/types-a2/` are close to it), light and dark.
- Use real engine layouts where possible (`assets/nets.json` and
  `prototypes/shared/netkit.js`; generate more from the engine with a small
  vite-node script if needed). Hand-drawn is fine for the combinator cells.
- The user isn't an expert in interaction nets, so explain terms in the
  interface, briefly.

## Outcome: the rule editor (2026-10-14)

The user chose **A**, revised twice (`prototypes/editors-a2/`, then
`editors-a3/`), and it's built into the app. The combinator view and the
component editor are reviewed later, from the same prototypes. Decisions:

- **Placement:** a panel between the net and the palette, movable and
  resizable. The palette stays live: drag agents in, or click a tile to drop
  one beside the result. ⌘C from the net and ⌘V into a rule works.
- **Before and after side by side,** at one zoom, so an agent is the same
  size on both sides. B (one canvas with a Before/After switch) "obscures
  way more than it helps"; C's dashed links between matching ends "aren't
  helpful", since that part is clear as it is.
- **What counts as a change:** wiring, agents and the description, compared
  by structure. Moving agents isn't a change (rules don't store positions),
  and undoing back to the start is no change. Save is disabled with no
  changes. The unsaved dot sits by the rule name, with a tooltip.
- **Unsaved changes:** a click outside, or Escape, keeps the panel open and
  gives Save and Cancel a brief amber glow (their colours don't change),
  with a toast in the usual place.
- **Saving:** the button and ⌘↵ save and close; ⌘S saves and stays open.
  Each save is one step on the net's history. Delete asks first, in a small
  popover by the button, which sits on the left of the bottom bar.
- **Header:** ‹ › to the left of the name (⌥← / ⌥→) step through pairs in
  grid order; a labelled description field with a pencil; undo and redo; an
  ⓘ explaining the editor. No combinators button (that view will be reached
  some other way). Tidy is a small button in the result's corner.
- **Interface ends:** hollow, wider than loose ends, with a dashed grey ring
  (red while unwired). They show the direction and type of the port they
  stand for: one type label per row when the row agrees, else one per end,
  with the ends spaced so labels don't collide. Hover rings scale with them.
- **Rule descriptions** are new: saved with the rule, shown when pointing at
  a pair or its grid cell, written in the text format as
  `A(x) >< B(y) "description" => …;`.
- While a rule is open the net's hover and selection panels hide; a
  selection in the rule shows in the editor's bottom bar.
