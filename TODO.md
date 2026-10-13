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

- [ ] drag selection should select wires too, not just agents
- [ ] cmd+c/cmd+x should copy/cut the selection! and cmd+v should paste it! atm there's no way to do this other than temporarily making a component or something
- [ ] dragging an agent into the canvas onto an already existing agent should do something cleverer than just dumping it on the canvas unconnected. maybe we can have some logic where if there is only one port of matching polarity and type to the existing agent's ports, we initialise the new agent already wired up to that port? if more than one match is possible maybe we.. just choose one at random? not sure. but i constantly find myself wanting to drag new agents onto existing ones to connect them
- [ ] would be good to benchmark what's actually taking up perf in large nets. and would it make sense to outsource that algorithm to a wasm worker or something? how much work would that be, how brittle, and how much perf are we likely to gain for ourselves there
- [ ] it should be possible to recollapse an opened component, atm doesn't look like it is?

- [ ] i don't think the combinator translation toggle needs to have pride of place right at the top
- [ ] the combinators view UX needs work. rn it's janky and you can't recollapse a thing after opening it and also it's not clear what general and restricted mean and why you can sometimes step one but not the other or sometimes neither. needs some love basically.
- [ ] we the button with the share and text view dropdown should probably not be called the nondescriptive "Net". it should probably also go to the left of the examples dropdown. it's more like the "File" toolbar item.
- [ ] when hovering over the step or run buttons it takes like a full second for the tooltip to appear, let's make it near-instant
- [ ] generally clicking outside of an opened panel should collapse it
- [ ] the rule editor – and combinator view for that matter – should not be full-page modes, but popovers or smth. so that it should be possible to click outside of them to dismiss.
- [ ] the rule editor also needs some love. and actions inside it need to be undoable
- [ ] the rule editor has different affordances than the main canvas. can't drag an agent into the end state canvas from the panel at the top, but can only click them. the affordances and abstractions and shortcuts etc need to be supported here too, as much as possible
- [ ] let's make the global undo/redo buttons be able to show lists on long-press. so that we can navigate back several steps in one go. like the chrome back/forward buttons.
- [ ] when pressing the shortcuts for undo/redo, their corresponding buttons in the UI should flash up

- [ ] maybe look into supporting linearity? is there literature on that? what does that actually entail, that the number of agents needs to be maintained across reductions? is there an affine equivalent, that the number of agents can't increase?
- [ ] maybe look into how we could have a responsive mobile mode? i feel like that's going to be a lot of work tho.. will it?

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
