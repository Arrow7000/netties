# netties: where things stand

The running list between sessions. Newest decisions and open work first;
the reasoning behind past decisions lives in `design/brief.md` (interface)
and `design/brief-types.md` (directions and types, with its outcome at the
end). Prototypes are in `design/prototypes/` (open `index.html`).

## Next up

- **Steps shown as rule applications** (from the user's sketches, 2026-10-13).
  Pointing at an active pair highlights it and shows the rule's result,
  agents placed as in the rule editor (turned a half turn when that suits
  the pair better; never mirrored, which would reverse the aux ports), in a
  frame in free space next to it
  (`src/layout/replace.ts`). The preview fires the step on a copy of the
  net, keeps every other agent where it's drawn, and routes the wires as
  usual: each new wire is drawn from where it leaves its old wire, dashed
  outside the frame and solid inside. Firing starts from exactly that
  drawing, then the net settles; the camera waits until it has. Pointing at
  Step previews the next pair, Step all every pair (up to 24), and Run
  flashes each step's preview for 0.8 of a step's animation time first.
  Open:

  - Rules that only reconnect wires now use the same routed preview, with
    no frame, instead of straight lines (except on the translation screen).
  - Is the Run flash right at high speeds, where it's under 100 ms?
  - The translation screen still animates steps with the old morph.

- **"Create it for me" with an LLM** (low priority as of 2026-10-13; the
  backend is live, the UI waits). A
  visitor describes a computation; a cheap model writes the whole system
  (agents, directions and types, rules, net) in the text format; the engine
  parses, type-checks, runs and checks the result, feeding errors back for
  a few retries. "Describe/create" first, "explain this" second.

  - Step 1, done 2026-10-12: `eval/` (run with `npx vite-node eval/run.ts`;
    options in the file). 13 engine-checked tasks, 3 runs each, up to 3
    tries with netties' error messages fed back:

    | model               | pass@3          | first try | median time | worst      | $/success |
    | ------------------- | --------------- | --------- | ----------- | ---------- | --------- |
    | Haiku 5.5           | 38/39           | 37        | 27 s        | 1.7 min    | $0.0037   |
    | DeepSeek V4.1 Flash | 38/39           | 29        | 59 s        | 19 min     | $0.012    |
    | MiMo-V2.6-Pro       | 39/39           | 23        | 3.7 min     | 27 min     | $0.013    |
    | MiMo-V2.6-Flash     | 18/23 (stopped) | 9         | 5 min       | 35 min     | $0.012    |
    | Kimi K2.6           | 36/39           | 36        | 2.3 min     | over 5 min | $0.054    |
    | GLM-5.3-Flash       | 25/39           | 16        | 2.2 min     | over 5 min | $0.0013   |
    | Qwen3.8-Flash       | 7/39            | 6         | over 5 min  | over 5 min | $0.0032   |

    Haiku 5.5 is the pick: as accurate as the best, 2–8× faster, and the
    cheapest per success except GLM, which fails a third of the time. Kimi
    is accurate but 15× the cost and slow; Qwen3.8-Flash reasons for 12k+
    tokens at ~50 tokens/s, so most attempts hit the 5-minute cap (even one
    request at a time). Untried: lower reasoning effort for the slow ones. MiMo-V2.6-Flash often reasons until it runs out of
    tokens and writes nothing. The tasks are too easy to separate the top
    three on accuracy; add harder ones (fib, map, sorting, two-type systems)
    before relying on accuracy differences. Attempts now fail after 5 minutes
    and are saved as they finish.

  - Parse errors now give a column and name bracket mistakes (2026-10-13),
    after Haiku miscounted the brackets in a deeply nested S(S(...)) and
    resent the same document twice. Not re-run through the eval yet.
  - Step 2, live since 2026-10-12: `netlify/edge-functions/create.ts`
    (POST /api/create) with the logic in `netlify/lib/create.ts`; the browser
    side is `create()` in `src/create/client.ts`. Haiku 5.5 at medium effort,
    30 calls per visitor per hour (10 creates of up to 3 tries), $1 a day for
    everyone, counters in Netlify Blobs (approximate under heavy concurrency).
    No Turnstile yet; add it if bots show up. Test locally with
    `netlify dev --command "npx vite --port 5299 --strictPort" --target-port 5299 --port 8899`.
    The site's key is a separate Anthropic key with a monthly spend limit,
    set as ANTHROPIC_API_KEY in Netlify. Nothing in the UI calls it until step 3.
  - Step 3: a design round for the create/explain UI, as before (brief,
    clickable prototypes, user picks).
  - Research summary (2026-10-09): the cheap models all cost about $1–3 a
    day at 200 creates a day; free tiers can't carry a public site.

## The user's braindump, triaged (2026-10-13)

In order. One design round at a time ("things are overwhelming enough").

1. **Polish** (one session):
   - [x] Near-instant tooltips everywhere: `src/ui/Tooltip.tsx` takes over
         every `title` as `data-tip` (120 ms, instant when moving between).
   - [x] Undo/redo buttons flash when their shortcut is pressed.
   - [x] "Net" menu becomes "File" and moves left of Examples.
   - [x] The combinator translation toggle loses its spot at the top: it's
         in the File menu for now; the editors design round decides its home.
   - [x] Clicking outside an open panel closes it, except an editor with
         unsaved changes, which stays open (`src/ui/dismiss.ts`; the rule
         grid, agent editor and types sheet; pans and drags don't count).
         The full-screen editors wait for the design round.
   - [x] Re-collapse an opened component: it could only be done by
         double-clicking the 1 px dashed outline. The outline now has a wide
         hit band and a collapse button at its top right.
   - [x] Text view in monospace; parse errors give a column, brackets are
         checked first ("one ")" too many", "one "(" is never closed … it
         opens after S on line 3, column 9"), and Load puts the caret there.
2. **Editing basics**:
   - [x] ⌘C/⌘X/⌘V for the selection (`src/core/clip.ts`). The clipboard
         gets JSON for netties and the text format for anywhere else, so
         hand-written text pastes too. Pastes under the pointer, selected;
         wires to anything left behind become loose ends. Brings missing
         agent types, components, and rules for new types only. Not yet in
         the rule and component editors (design round).
   - [x] Drag selection picks up wires (both ends inside the box; a loose
         end counts where it's drawn). Deleting takes them too.
   - [x] Dropping a new agent from the palette over an agent, or near a
         port, plugs it into the nearest port that's empty or only leads to
         a loose end and fits (its principal port first), shown while
         dragging. Components dropped this way don't plug in yet.
3. **Design round: the editors**. The rule editor, combinator view and
   component editor become non-modal (click outside to dismiss) and get the
   main canvas's affordances (drag in from the palette, shortcuts). The
   combinator view needs to explain general vs restricted and why a step is
   sometimes unavailable, and to let you re-collapse. Absorbs "translation
   screen still animates with the old morph" and "only restyled".
   Brief: `design/brief-editors.md`; prototypes `design/prototypes/editors-a`
   to `-c` (2026-10-14). The user is reviewing the rule editor first; the
   combinator view gets its own review session later, from the same
   prototypes as they are now.
4. **Then**:
   - [ ] Profile large nets before deciding anything. Guess: layout,
         routing and SVG redraw dominate, not reduction, so WebAssembly
         would buy little; a worker for layout, or algorithmic fixes in
         `place.ts`/`route.ts`, more likely.
   - [ ] Long-press undo/redo for a history list, like the browser's back
         button. Needs a label on every history entry first.
   - [ ] Mobile, low priority: start view-only (pick examples, pinch-zoom,
         tap a pair to preview then fire, Step/Run). Editing eventually.
5. **Research**: linearity. Nets are already linear (each port has exactly
   one wire; copying and erasing only through explicit agents like δ and
   ε). A linear system has no copiers or erasers; affine allows erasers.
   "The net never grows" is checkable per rule (a result has at most 2
   agents; at most 1 means it always terminates); a possible teaching
   feature: mark rules shrink/same/grow. Read Lafont 1990, light/elementary
   linear logic, Asperti & Guerrini on optimal reduction first.
6. **Low priority**: the LLM create UI design round (step 3 above). The
   user, 2026-10-13: "not my main priority. in fact it's quite a low one".

### The braindump as the user wrote it

Word for word, as added on 2026-10-13 (it was wrongly replaced by the
triage above at the time, and restored on 2026-10-14). Progress is tracked
in the triaged list; these checkboxes are left as written.

- [ ] i don't think the combinator translation toggle needs to have pride of place right at the top
- [ ] the combinators view UX needs work. rn it's janky and you can't recollapse a thing after opening it and also it's not clear what general and restricted mean and why you can sometimes step one but not the other or sometimes neither. needs some love basically.
- [ ] the rule editor – and combinator view for that matter – should not be full-page modes, but popovers or smth. so that it should be possible to click outside of them to dismiss.
- [ ] the rule editor also needs some love. and actions inside it need to be undoable
- [ ] the rule editor has different affordances than the main canvas. can't drag an agent into the end state canvas from the panel at the top, but can only click them. the affordances and abstractions and shortcuts etc need to be supported here too, as much as possible
- [ ] let's make the global undo/redo buttons be able to show lists on long-press. so that we can navigate back several steps in one go. like the chrome back/forward buttons.
- [ ] when pressing the shortcuts for undo/redo, their corresponding buttons in the UI should flash up

- [ ] maybe look into supporting linearity? is there literature on that? what does that actually entail, that the number of agents needs to be maintained across reductions? is there an affine equivalent, that the number of agents can't increase?

## Rough edges in directions and types

- SVG export omits the direction arrows shown on the canvas, so a directed
  net loses its flow cues when exported.
- The agent editor covers the canvas, so the wires it would cut (marked
  red) are often hidden. The prototype slid the canvas aside.
- The combinator translation ignores types; for systems with directions it
  could target the directed combinators instead.
- The component editor doesn't check its interface ports' types (a
  collapsed box does take its port types from the ports inside).
- Nets loaded from text or a link that don't type-check open with the bad
  wires cut and an Undo toast. The user hasn't confirmed this choice.
- Rule and component editors keep their own draft undo history while open;
  saving is one step in the main history. Confirm that's what the user wants.

## Later

- Lafont's "execution" walk: a token travelling the net from a loose end,
  carrying a γ stack and a δ stack, ending where the net would connect that
  end once reduced. Only for γ/δ/ε, so it would live on the translation
  screen. Asked for by an early user (lane on Twitter); not designed yet.
- Rule editor, translation screen, component editor and text view were only
  restyled in the redesign, not redesigned.
- Extensions: native numbers, labelled duplicators, references, amb.
- Polymorphic port types (a duplicator for any one type).
- TikZ export.

## The second braindump, triaged (2026-10-14)

The user's list is "Others" below, kept as written apart from ticking off
what's done (at the user's request).

1. **Done** (2026-10-14):
   - [x] ⌘A selects every agent, box and wire (not the page's text).
   - [x] A clicked wire shows as selected at once (the hover style was
         winning while the pointer stayed on it).
   - [x] Wire highlights run on under the agents they meet, with flat
         ends, so the outline cuts them off: no rounded end beside a tip.
         Not under agents drawn see-through during a step preview, where
         they end flat at the port.
   - [x] Hover pills are sized to their measured text.
   - [x] The toast's Undo shows ⌘Z. Shortcuts are written the Mac way in
         the code and shown as Ctrl/Alt/Shift elsewhere (`shortcuts()` in
         `src/ui/keys.ts`; tooltips convert automatically).
   - [x] Drag-select, CAD-style (the user's pick): rightwards is a window
         (agents inside, wires with both ends inside, solid box); leftwards
         is a crossing (anything touched, dashed box).
   - [x] Share link button in the top bar, out of the File menu, with a
         copy icon; "Update link" (accent) once the net differs from the
         link in the address bar; a check and "Copied" for 0.9 s after.
2. **Next, small to medium**:
   - [ ] Shorter share links. They're already deflated JSON (600–1,650
         characters for the examples). fhm deflates its _source text_ with
         a preset dictionary (`../fhm/editors/web/src/share.mjs`, fflate).
         Deflating our text format instead is about half the length
         (measured on the examples: 1,647 → ~690 for the triage example);
         a dictionary of common words would cut more. The text format
         doesn't yet carry manual positions, components or groups, so
         those need adding or a JSON fallback. New links get a version
         prefix; `#n=` links keep decoding as now.
   - [ ] Shortcut chords light up: holding ⌘ brightens every button with a
         ⌘ shortcut, pressing the key shows its button pressed. The user's
         call: all such buttons, and larger labelled buttons show their
         chord (small icon buttons can skip it). Needs every shortcut
         registered in one place first; today each screen has its own
         keydown handler.
3. **Done** (2026-10-14): wires in manual mode, and in automatic mode too
   (the user: "even in auto mode sometimes the wires appear behind agents,
   or overlap with other wires"). Option 1, patching the router
   (`src/layout/route.ts`), was enough; option 2 (a full obstacle-avoiding
   router) isn't needed for now.
   - A wire whose drawing would run through an agent, or alongside another
     wire (closer than 0.7 of `G.wireGap` for more than 14 units), becomes
     a detour: out from each port as a short cap or cup, then along a lane
     of its own, at the x nearest its ports that's clear of agents and of
     other wires' vertical runs over the height it covers. Lanes that turn
     out badly once the runs settle are chosen again (up to 4 passes).
   - "Around" wires keep their whole-height gaps unless a gap is too narrow
     for its lanes (hand placement), when they become detours too.
   - Caps and cups now keep clear of each other, not just of their own
     kind. Where there's no room in front of a port for the full gap, runs
     squeeze to half a gap rather than letting a leg run through the agent
     in front.
   - In automatic mode, every example step draws exactly as before except
     where a step was broken (Copying a feedback loop, 3 × 2, Square of a
     sum, One number two calculations) and the steps after it. Wires ran
     behind agents there: a cap or cup whose ports sit at different
     heights ran its long leg straight through whatever was between, and
     two such legs could share a column. Directed cascade steps 2–3 also
     changed: nothing was broken, but the flip search in `place.ts` now
     lands on a different (also clean) arrangement, because some of the
     layouts it tries cost differently with detours.
   - Measured with `npx vite-node scripts/route-check.ts` (`--svg DIR` to
     draw the problem cases): examples went from 11 wires through agents
     and 3 overlapping pairs to none; 300 random hand-placed nets went from
     709 wires through agents and 268 close pairs to 0 through agents and
     41 pairs squeezed to half a gap where there was no room. New tests in
     `src/layout/layout.test.ts` hold both. Routing the largest example
     takes 0.1 ms; 318 agents laid out automatically 1.6 ms, then nudged
     by hand 4.3 ms (the old router took 0.4 ms for that).
   - Checked by eye in the app, manual mode, light and dark: agents dragged
     onto a wire and between a facing pair. Very tight spots (an agent
     jammed between two others) route round it closely but don't cross.
   - Follow-up the same day: the user found wires in manual mode still
     grazing agents (an `if` whose third port's wire ran down the corner of
     the S below it). Switching to manual keeps the automatic positions but
     drops the columns wires jog out to, and the check only asked whether a
     wire went _through_ an agent. Wires now keep 4 units clear of agents
     they don't connect to (`CLEARANCE`; they're drawn on a halo about that
     wide), and a detour whose lane is close to its port reaches it with
     the same S-curve as automatic layout's columns. A new test routes
     every example step without columns. This also fixed near misses in
     automatic mode (every step of Runs forever, Add two list lengths
     step 2).
   - Not covered: wires to rule-interface pins (`pin` jobs) don't detour
     yet, and agents placed overlapping each other can still leave a wire
     through one.
   - Layout gallery for checking by eye (2026-10-15, the user's idea):
     `/layouts.html` on the dev server (`src/dev/layouts.ts`, not in the
     production build). Every example step, plus generated nets of growing
     size (T: trees in pairs, R: tangles, H: placed by hand), each with a
     label to point at (E3.2, T39, …). Auto/Manual switch, zoom, theme,
     "only flagged"; drawings the checks fault are outlined, and clicking
     one opens it large with the faulty wires marked. First finding: T39
     in Auto has a long S-curve brushing a γ.
4. **Done** (2026-10-15), from the user's drawings:
   - [x] A direction on its own, as a looping animation
         (`src/ui/PolarityIcon.tsx`): giving is rings rippling out from a
         pebble, thinning and fading, inside a ring of 12 short straight
         rays (added 2026-10-16: standing still, it "just looks like
         circles"); taking is the rim itself, a perfect circle, creasing
         inward at five even points, valleys falling faster than tips,
         straight towards the middle into a star, like water down a drain.
         Each new rim fades in slowly, like a Shepard tone, so it feels
         ever-falling rather than pulsing outwards. Both are rotationally
         symmetric: the mess in the user's drawings wasn't intended. (A
         first version kept the rim fixed and turned the rings as they
         shrank: "a pretty flower", not draining.) Two moving rings for giving (three read as plain
         circles at icon size), three for taking. All on one clock so a re-rendered icon carries on instead of
         restarting (the hover panel re-renders on every pointer move, which
         is why the first version looked still). Still frames under reduced
         motion. Used wherever directions are talked about, so the pictures
         are familiar by the time they matter (the user's idea): the hover
         badge (24 px); the Gives/Takes switches (still until pointed at,
         since the directions sheet has one per port); the directions
         sheet's notes ("Every port ◎ gives or ◎ takes"); "Both give/take"
         refusals while dragging a wire and on "can never meet" rule-grid
         pairs (two of the same side by side); and the rule editor's empty
         interface ends, drawn as a red fount or drain instead of a ring and
         arrow. The user isn't sure about the rule editor yet ("let's try it
         out"). Arrows stay on ports, palette stubs and wires: clearer there,
         and less attention-grabbing.
   - [x] Pressing a wired port and letting go no longer unplugs its wire
         (or makes a loose end on an empty port); the gesture starts once
         the pointer moves 3 px.
   - [x] A carried loose end (dot and name) moves with the pointer instead
         of staying behind, and any wire drag shows a dot at its tip where
         letting go would leave a loose end. Let go over nothing, a carried
         loose end goes back (loose ends have no positions of their own).
   - [x] In the rule editor, a wire pulled off an interface end and let go
         over nothing comes out, as selecting and deleting it does. The
         interface end stays put, since it's fixed. The user also wondered
         about telling a wire's loose tip apart from an interface end there
         more generally; not designed yet.
5. **Design and research, one at a time**:
   - [ ] Reduction strategies. Worth knowing first: interaction nets are
         strongly confluent, so every order of firing reaches the same
         result in the same number of interactions. A strategy can't save
         work on a net that finishes; it changes which pairs fire first,
         so (a) a weak or outermost-first strategy (fire only pairs
         connected to a loose end, nearest first) can stop as soon as the
         answer shows at the loose ends and never touch disconnected
         garbage, and (b) on a net that runs forever it can still produce
         the visible part of the answer. The "β-optimal" claim is about
         λ-calculus encoded with sharing graphs (Lamping, Asperti &
         Guerrini), not about steps between nets. So the choice is really
         "everything" vs "only what reaches the loose ends"; Step (one
         pair) would use the second's order to pick the pair.
   - [ ] Fading parts of the net with no loose ends. Cheap to compute
         (connected components). Fits the strategy above: those parts are
         exactly what "only what reaches the loose ends" never fires.

## Others

- [x] cmd+A should select the entire net. currently it selects the whole page text.
- [ ] can we use a compression tool for share links? they're currently huge. let's look into what we use for `../fhm`'s web playground, bc that one seems really efficient
  - [ ] although would be good to maintain backwards compatibility to still accept the current links
- [x] maybe the copy share link button needs to be broken out of the file menu in its own top-level thing?
  - [x] and when the system diverges from what is decoded from the share link url it should change to say something like "update share link" or "update url" or something? to make it clear that this is not one of the editors whose url updates live on every keystroke, and that it's possible to get out of sync with the url.
  - [x] maybe this button should also show the copy icon to make it clear that we'll not only update the url but will also copy it to your clipboard?
  - [x] maybe once you press that button the clipboard should change to a check icon for half a sec or so to indicate success
- [x] the undo button in the toasts at the bottom of the canvas should display the undo shortcut alongside it – cmd+Z with the ⌘ symbol; although btw for every shortcut it's only cmd on macos, for windows and linux i think we should be using and displaying ctrl instead, right?
- [ ] app-wide: pressing the first key of a shortcut should highlight all buttons using that shortcut when the shortcut is visible. so e.g. if we have a button somewhere that says `⌘S` and one that says `⌘C`, pressing cmd down should make both buttons have a little extra brightness as long as you hold it down. and then when the user presses the S, the ⌘C button should revert to normal appearance, but the ⌘S button should appear in its fully depressed state, as if you had clicked it with your mouse.
  - i think this should work throughout the app. but i think maybe the first part – highlight buttons on the same first half of the shortcut – should only happen if the button actually displays the shortcut. otherwise it might be confusing why that button is highlighted when you don't know that it's a ⌘\_ action? hm.
  - ok no, on second thought i do think all such shortkeyed buttons should highlight. with a consistent enough affordance the user will quickly learn that the reason that button highlighted is bc it shares the ⌘\_ shortcut.
  - but: for this to be effective ideally most buttons with such actions would have the shortcut displayed. although we can omit this in the case of where buttons are small, like the undo/redo things in the top right. but when you have a larger button with a proper word label on it, then yes it should display the shortcut chord on it.
- [x] maybe instead of the symbols for taking and giving we could have a little wave animation thing moving inward for "taking" and outward for "giving" (i will draw something to explain what i mean)
- [x] when i click on a wire it doesn't look any different, it's only when i move my mouse away that i can see that its colour has changed into the selected mode. not sure why this is
- [x] when a wire is highlighted (either selected or active) you can see the rounding of the end as it goes into the agent's primary port. i don't like this. makes it look quite amateur svg ish.
- [x] i think manual mode should only affect agents, not wires. i think wires should still keep their automatic routing. atm when i switch to manual, the wires no longer avoid intersecting or going behind their agents. i don't think there's a reason for that to happen. seeing as wires can't themselves be moved, i don't think their behaviour should change in manual mode.
- [x] there's a big gap after the "click to fire" and "click to select the wire" text in their pills
- [x] when select-dragging i think we should include any touched wire, not only if we've included both its ends
  - there is also the more advanced mode which i vaguely remember from sketchup, which is that if you drag from left to right it selects everything touched, whereas if you drag from rtl it only selects things that are completely in the box. or the other way round. is this a common convention? do programs still do this? worth implementing or nah?
- [ ] different execution/prioritisation strategies! friend on twitter mentioned a "whnf" strategy, which for graphs translates to prioritising outer executions first – outer meaning closest to a loose/external port. apparently this is beta optimal.
  - this would affect all three run buttons, so maybe it should be like a little hover menu next to and encompassing all of them, where the strategy can be selected?
  - hm other than "fully parallel" and whnf is there anything else? worth having a selector for just two strategies? and for the single step, since it only does one thing at a time, what should we choose then, still prioritising external-first? does that mean the strategy only meaningfully affects the other 2, the multi-step buttons?
- [ ] maybe we should fade out nets that (have no empty ports but) are unconnected to any external ports? because that basically means that whatever computation results from that will be unobservable from the outside? like e.g. the leftovers of a non-chosen if branch, which would ordinarily just result in attaching an eliminator agent and nomnomming its way through whatever remained there. in that case, we may as well show that that subnet is no longer really relevant to us and thus whatever happens there will no longer affect anything else.
  - this would fit nicely with the whnf strategy, since in that strategy unconnected subnets will never be evaluated. basically i want to make it for that, to show that if a thing is isolated, we don't _need_ to evaluate it anymore, because we're going to get our computation anyway. but may not make so much sense to have this with the other strategies. unless the strats only affect prioritisation, and not exclusion altogether? ok idk, needs some thought.
- [x] clicking a port that has a wire plugged into it currently unplugs the wire. that shouldn't happen unless i actually drag the wire out
