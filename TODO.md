# netties: where things stand

The running list between sessions, open work only. The reasoning behind past
decisions lives in `design/brief.md` (interface), `design/brief-types.md`
(directions and types) and `design/brief-editors.md` (editors), each with
its outcome at the end. Prototypes are in `design/prototypes/` (open
`index.html`). Your own lists are at the bottom, as written.

Tidied 2026-10-26: finished work was taken out. Its notes (measurements,
alternatives tried and rejected, your quotes) are in this file as of commit
18a12f9 (`git show 18a12f9:TODO.md`) and in the commit messages.

## Quick: needs only your answer

Choices made along the way that you haven't confirmed yet:

- Nets loaded from text or a link that don't type-check open with the bad
  wires cut and an Undo toast.
- The rule and component editors keep their own undo history while open;
  saving is one step in the main history.
- Should a rule's interface ends show the flipped direction in their hover
  badge (they're ports to the outside), unlike loose ends on the canvas?
  The rule editor has no hover panel yet. Also not designed: telling a
  wire's loose tip apart from an interface end in the rule editor.
- Never checked by eye: the full let-go animation, and how a rule editor
  preview compares with the wire once you let go.

## Quick to small

- Run flashes each step's preview for 0.8 of a step's animation time. At
  high speeds that's under 100 ms: check whether it reads, or skip it there.
- Parse errors gained columns and bracket messages (2026-10-13); the eval
  (`npx vite-node eval/run.ts`) hasn't been re-run since.
- Wires to a rule's interface ends (`pin` jobs in `route.ts`) don't detour
  round agents yet.
- Step previews route a rule's new agents without their columns, though the
  rule editor now draws them with columns. Rare: only matters when an agent
  has a subtree under one aux port and a loose wire on another.
- Dropping from the palette doesn't plug in for a component, or for a new
  agent onto a rule's empty interface end.
- The component editor doesn't check its interface ports' types (a
  collapsed box does take its port types from the ports inside).
- The agent editor covers the canvas, so the wires it would cut (marked
  red) are often hidden. The prototype slid the canvas aside.

## Medium, not started

- **Shorter share links.** They're already deflated JSON (600–1,650
  characters for the examples). fhm deflates its _source text_ with a
  preset dictionary (`../fhm/editors/web/src/share.mjs`, fflate). Deflating
  our text format instead is about half the length (measured on the
  examples: 1,647 → ~690 for the triage example); a dictionary of common
  words would cut more. The text format doesn't yet carry manual positions,
  components or groups, so those need adding or a JSON fallback. New links
  get a version prefix; `#n=` links keep decoding as now.
- **Shortcut chords light up.** Holding ⌘ brightens every button with a ⌘
  shortcut; pressing the key shows its button pressed. Your call: all such
  buttons, and larger labelled buttons show their chord (small icon buttons
  can skip it). Needs every shortcut registered in one place first; today
  each screen has its own keydown handler.
- **Long-press undo/redo for a history list**, like the browser's back
  button. Needs a label on every history entry first.
- **Charge detours in the flip search.** It counts crossings, wires going
  round the side and length, not wires that detour round agents or other
  wires in their way, so it can pick boxy drawings (One number, two
  calculations step 4). A `detours` count in `Routed` and 600 each fixed
  that step and turned units in 19 other example steps (Add two list
  lengths from its first drawing, 3 × 2, Square of a sum, Directed cascade,
  Copying a feedback loop); review those by eye before keeping it. 300
  wasn't enough for that step. Runs forever has one detour every step
  whatever the charge. Picture:
  `design/research/layout-detours/one-number-step-4.svg`.
- **Layout isn't stable yet.** Laying a drawing out again from itself still
  moves things in 30 of 176 example steps (mostly the flip search choosing
  differently from a different previous drawing), so an edit elsewhere can
  still redraw a net.
- **Profile large nets** before deciding anything. Guess: layout, routing
  and SVG redraw dominate, not reduction, so WebAssembly would buy little; a
  worker for layout, or algorithmic fixes in `place.ts`/`route.ts`, more
  likely. (300 agents in many nets lay out in ~15 ms today.)

## Design rounds, one at a time

1. **The rest of the editors round.** The rule editor is built (from A3,
   2026-10-14; outcome in `design/brief-editors.md`). Still to review, from
   the same prototypes (`design/prototypes/editors-a` to `-c`):
   - The combinator view: non-modal, re-collapsing, and explaining general
     vs restricted and why a step is sometimes unavailable. It still
     animates steps with the old morph.
   - The component editor: non-modal, the main canvas's affordances,
     ⌘C/⌘V (the rule editor has them; the component editor doesn't).
   - The text view was only restyled, not redesigned (out of scope for the
     round unless the panel shell suits it).
2. **Reduction strategies, and fading what can't be seen.** Worth knowing
   first: interaction nets are strongly confluent, so every order of firing
   reaches the same result in the same number of interactions. A strategy
   can't save work on a net that finishes; it changes which pairs fire
   first, so (a) a weak or outermost-first strategy (fire only pairs
   connected to a loose end, nearest first) can stop as soon as the answer
   shows at the loose ends and never touch disconnected garbage, and (b) on
   a net that runs forever it can still produce the visible part of the
   answer. The "β-optimal" claim is about λ-calculus encoded with sharing
   graphs (Lamping, Asperti & Guerrini), not about steps between nets. So
   the choice is really "everything" vs "only what reaches the loose ends";
   Step (one pair) would use the second's order to pick the pair. Fading
   parts of the net with no loose ends is cheap (connected components) and
   fits: those parts are exactly what "only what reaches the loose ends"
   never fires.
3. **Mobile** (raised 2026-10-26): the same app made responsive for
   phones, with touch handled properly. Phone first (where most people
   find the app), tablets later. Editing on a phone is a real goal.
   Decided: on touch, a tap keeps the hover, so an active pair shows its
   preview on the first tap and fires on the second. Wires are drawn by
   dragging from port to port, as on desktop; tapping one port and then
   another is only a fallback. Planned stages: (1) fits the screen and
   works with fingers (compact bars, pinch and pan, minimum on-screen tap
   targets, fit padding for the bars actually shown); (2) reading by touch
   (bottom sheet for what's tapped, long-press for Alt-click, sheets for
   the other screens); (3) editing (palette drawer, wire snapping,
   multi-select without Shift, clipboard buttons, rule editor on a narrow
   screen). Stages 2 and 3 need a design round.
   Stage 1 is built on the `mobile` branch (2026-10-26), not yet tried on
   a real phone. Left over from it: on a phone the palette is hidden, so
   agents can't be added and the types sheet, rule grid and agent editor
   can't be opened; the fit ignores the card along the bottom, so it can
   cover the net's lowest part; the "Tap again to fire" pill can run off
   the right edge; the rule editor draws both halves small upright; the
   translation says left/right where the panes are stacked; Copy link
   doesn't use the phone's share sheet; a tapped button can keep its hover
   colour; double-tap into components only hits exactly; page pinch-zoom
   is blocked outside the canvas (an accessibility trade-off).
4. **The LLM create UI**, low priority (you, 2026-10-13: "not my main
   priority. in fact it's quite a low one"). The backend is live at POST
   /api/create (`netlify/edge-functions/create.ts`, logic in
   `netlify/lib/create.ts`, browser side `create()` in
   `src/create/client.ts`; Haiku 5.5, 30 calls per visitor per hour, $1 a day for everyone; test
   locally with `netlify dev --command "npx vite --port 5299 --strictPort"
   --target-port 5299 --port 8899`).
   The round: brief, clickable prototypes, you pick. "Describe/create"
   first, "explain this" second. Before relying on the eval to compare
   models, add harder tasks (fib, map, sorting, two-type systems); add
   Turnstile if bots show up.

## Research

- **Linearity.** Nets are already linear (each port has exactly one wire;
  copying and erasing only through explicit agents like δ and ε). A linear
  system has no copiers or erasers; affine allows erasers. "The net never
  grows" is checkable per rule (a result has at most 2 agents; at most 1
  means it always terminates); a possible teaching feature: mark rules
  shrink/same/grow. Read Lafont 1990, light/elementary linear logic,
  Asperti & Guerrini on optimal reduction first.
- **The text format and Inpla** (your question, 2026-10-27). The text view's
  format is Inpla's core (`A(x, y) >< B(z) => x ~ …;` rules, `s ~ t` nets,
  upper-case agents), itself from Fernández & Mackie's interaction calculus,
  plus our own extras: `agent` declarations, `directions`/`types` and port
  specs like `+number`, quoted descriptions, `_` for an empty port, `--`
  comments, lower-case or Unicode agent names. Never checked against Inpla
  itself; we don't read Inpla's integers, built-ins, `if`, `where` or
  commands. To think about: whether to make it fully Inpla-compatible (or
  just an export that drops our extras and uses ASCII names); whether to
  publish an official spec/grammar and a migration guide to and from Inpla;
  whether the text panel should say what language it is. Ties in with
  shorter share links, which would extend the format with positions,
  components and groups.

## Later

- Lafont's "execution" walk: a token travelling the net from a loose end,
  carrying a γ stack and a δ stack, ending where the net would connect that
  end once reduced. Only for γ/δ/ε, so it would live on the translation
  screen. Asked for by an early user (lane on Twitter); not designed yet.
- Two kinds of loose end (your framing, 2026-10-16): usually scratch
  ("leave a loose wire loose where it is"), sometimes a deliberate
  interface to the whole net. Idea: a separate external rail for the
  deliberate kind (an old version had rails at the top and bottom of the
  canvas that wires were dragged into; that only served the deliberate
  case).
- The combinator translation ignores types; for systems with directions it
  could target the directed combinators instead.
- Extensions: native numbers, labelled duplicators, references, amb.
- Polymorphic port types (a duplicator for any one type).
- TikZ export.

## Your lists, as written

### The first braindump (2026-10-13)

Word for word (it was wrongly replaced by a triage at the time, and
restored on 2026-10-14). These checkboxes are left as written; what's done
was ticked off in the triage (see commit 18a12f9). Of these, still open: the combinator view, the
long-press history lists and linearity.

- [ ] i don't think the combinator translation toggle needs to have pride of place right at the top
- [ ] the combinators view UX needs work. rn it's janky and you can't recollapse a thing after opening it and also it's not clear what general and restricted mean and why you can sometimes step one but not the other or sometimes neither. needs some love basically.
- [ ] the rule editor – and combinator view for that matter – should not be full-page modes, but popovers or smth. so that it should be possible to click outside of them to dismiss.
- [ ] the rule editor also needs some love. and actions inside it need to be undoable
- [ ] the rule editor has different affordances than the main canvas. can't drag an agent into the end state canvas from the panel at the top, but can only click them. the affordances and abstractions and shortcuts etc need to be supported here too, as much as possible
- [ ] let's make the global undo/redo buttons be able to show lists on long-press. so that we can navigate back several steps in one go. like the chrome back/forward buttons.
- [ ] when pressing the shortcuts for undo/redo, their corresponding buttons in the UI should flash up

- [ ] maybe look into supporting linearity? is there literature on that? what does that actually entail, that the number of agents needs to be maintained across reductions? is there an affine equivalent, that the number of agents can't increase?

### Others (2026-10-14 to 10-16)

Kept as written apart from ticking off what's done (at your request).

- [ ] can we use a compression tool for share links? they're currently huge. let's look into what we use for `../fhm`'s web playground, bc that one seems really efficient
  - [ ] although would be good to maintain backwards compatibility to still accept the current links
- [ ] app-wide: pressing the first key of a shortcut should highlight all buttons using that shortcut when the shortcut is visible. so e.g. if we have a button somewhere that says `⌘S` and one that says `⌘C`, pressing cmd down should make both buttons have a little extra brightness as long as you hold it down. and then when the user presses the S, the ⌘C button should revert to normal appearance, but the ⌘S button should appear in its fully depressed state, as if you had clicked it with your mouse.
  - i think this should work throughout the app. but i think maybe the first part – highlight buttons on the same first half of the shortcut – should only happen if the button actually displays the shortcut. otherwise it might be confusing why that button is highlighted when you don't know that it's a ⌘\_ action? hm.
  - ok no, on second thought i do think all such shortkeyed buttons should highlight. with a consistent enough affordance the user will quickly learn that the reason that button highlighted is bc it shares the ⌘\_ shortcut.
  - but: for this to be effective ideally most buttons with such actions would have the shortcut displayed. although we can omit this in the case of where buttons are small, like the undo/redo things in the top right. but when you have a larger button with a proper word label on it, then yes it should display the shortcut chord on it.
- [x] i think manual mode should only affect agents, not wires. i think wires should still keep their automatic routing. atm when i switch to manual, the wires no longer avoid intersecting or going behind their agents. i don't think there's a reason for that to happen. seeing as wires can't themselves be moved, i don't think their behaviour should change in manual mode.
  - [x] ok this is not actually fully fixed, see the wire change shape question below
- [x] there's a big gap after the "click to fire" and "click to select the wire" text in their pills
- [x] when select-dragging i think we should include any touched wire, not only if we've included both its ends
  - there is also the more advanced mode which i vaguely remember from sketchup, which is that if you drag from left to right it selects everything touched, whereas if you drag from rtl it only selects things that are completely in the box. or the other way round. is this a common convention? do programs still do this? worth implementing or nah?
- [ ] different execution/prioritisation strategies! friend on twitter mentioned a "whnf" strategy, which for graphs translates to prioritising outer executions first – outer meaning closest to a loose/external port. apparently this is beta optimal.
  - this would affect all three run buttons, so maybe it should be like a little hover menu next to and encompassing all of them, where the strategy can be selected?
  - hm other than "fully parallel" and whnf is there anything else? worth having a selector for just two strategies? and for the single step, since it only does one thing at a time, what should we choose then, still prioritising external-first? does that mean the strategy only meaningfully affects the other 2, the multi-step buttons?
- [ ] maybe we should fade out nets that (have no empty ports but) are unconnected to any external ports? because that basically means that whatever computation results from that will be unobservable from the outside? like e.g. the leftovers of a non-chosen if branch, which would ordinarily just result in attaching an eliminator agent and nomnomming its way through whatever remained there. in that case, we may as well show that that subnet is no longer really relevant to us and thus whatever happens there will no longer affect anything else.
  - this would fit nicely with the whnf strategy, since in that strategy unconnected subnets will never be evaluated. basically i want to make it for that, to show that if a thing is isolated, we don't _need_ to evaluate it anymore, because we're going to get our computation anyway. but may not make so much sense to have this with the other strategies. unless the strats only affect prioritisation, and not exclusion altogether? ok idk, needs some thought.
- [x] when i disconnect a wire, the end seems to jump to its final destination immediately, while the rest of the wire still morphs gradually. this results in an awkward and unnatural looking wire animation. im fairly sure this is a regression, that the whole wire including the end used to move more naturally
- [x] pressing escape while dragging should cancel the drag
- [x] when i drag a wire over a compatible wire's end, the preview line jumps to looking as it would after the two wires are unified. but that means it's no longer showing me the preview where my pointer is. nor does it change anything about the destination wire, so now my pointer and the destination wire both look isolated. see here, im dragging from the S to the if and my pointer is over the `a` end: `~/Desktop/Screenshot 2026-10-16 at 11.16.10.png`
- [x] why do the wires change shape while im dragging an agent, like i'd switched into manual layout? for that matter, why do the wires look different in manual mode to auto mode in the first place? i still don't get that.
- [x] the rule editor appears to be a bit buggy. here im hovering over x₃ and still the wire preview appears to be connected to x₂. when i let go, the ends seem to move over horizontally, so maybe that logic is to blame. in any case i feel like the rule editor's logic for shifting things around is a bit temperamental. is there a way we can fix this at the root, perhaps by making a clearer distinction between regular canvas and rule editor and clearly switching logic based on that. think more state machine, pattern matching on state, and availing yourself of atomic functions in both states, but wiring them together differently based on state. not one path with isolated checks inside functions that change things locally. think more elm than javascript.
  - /Users/aron/Desktop/Screenshot 2026-10-16 at 11.25.22.png
- [x] i don't really understand the logic behind this positioning? is it possible that here too we are using the rule editor logic that ensures that loose ends always appear either above or below all nets? im not sure we want that on the main canvas. but even if we do, why are the two identical nets flipped upside down relative to each other? what's the logic there?
  - /Users/aron/Desktop/Screenshot 2026-10-16 at 11.30.54.png
- [x] escape should also close the expanded rule grid, as it should all panels (unless they have unsaved state)
- [x] when you connect two wires and then undo it, the animation is a bit awkward, because the destination wire recedes all the way from the port it's no longer connected to. instead i think it'll look better if we just split the wire in two from its halfway point. then the two wires should spring back naturally
- [x] when you change the type or polarity of an agent's port, we don't properly update the applicable rules for that agent in the agent view. the rules grid updates, but the rules on the agent panel itself don't update. not even after closing and reopening the panel, or editing a different agent. and even after a page refresh. clearly we persist the rules somewhere without refreshing them when the types/polarity updates, even though the grid does display the correct interactability.
- [x] at some point we used to highlight in the rule editor the same external interface port when hovering over them. e.g. if you hover over x₁ in the after view, it would also highlight that port in the before view, and vice versa. it doesn't seem to do this anymore.
