# netties: where things stand

The running list between sessions, open work only. The reasoning behind past
decisions lives in `design/brief.md` (interface), `design/brief-types.md`
(directions and types), `design/brief-editors.md` (editors) and
`design/brief-mobile.md` (phones), each with its outcome at the end.
Prototypes are in `design/prototypes/` (open `index.html`); the phone
prototypes are on the branch `mobile-protos`. Your own lists are at the
bottom, as written.

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
3. **Mobile, the rest** (raised 2026-10-26; the canvas views done
   2026-10-27, see `design/brief-mobile.md`). The net and the rule editor
   work on a phone: the sheet along the bottom (agents, rules, selection),
   holds for what Shift, Alt and drag-select did, wires by drag and drop
   with tap-to-wire as the fallback, double tap to zoom. You, 2026-10-27:
   the other screens are "good enough for now [...] as long as you can
   scroll around to access everything". Not yet made for a phone:
   - The agent editor, and the directions and types sheet: they scroll,
     but aren't laid out for a narrow screen.
   - The component editor: none of the rule editor's phone fixes (a snug
     fit that stays put, the selection row with the net's actions,
     tap-to-wire).
   - The rule editor itself: fixed, not redesigned for a phone. A toast
     ("Loaded … Undo") can sit over its header.
   - The full rule grid, the text view and the combinator view: not
     looked at on a phone. The translation says left/right where its panes
     are stacked.
   - Small things: Copy link doesn't use the phone's share sheet; a wired
     port tapped on its own has no actions; going back to a link while the
     agent editor is open loses its unsaved draft; a tapped button may
     keep its hover colour (unchecked since stage 1); page pinch-zoom is
     blocked outside the canvas (an accessibility trade-off).
   - Tablets: they get the desktop layout, which hasn't been tried with
     fingers.
4. **The LLM create UI**, low priority (you, 2026-10-13: "not my main
   priority. in fact it's quite a low one"). The first backend, a capped proxy on our key at /api/create, is gone
   (you, 2026-11-05: "that's the netlify approach right? so yeah i think just
   delete that. unless... we want to keep it in case we want to do what cursor did
   for a while and be our own router for users..? ok if so let's deal with that
   then. delete for now."). It's in git at `942e7ca`, in `netlify/`, if that comes up.
   The round: brief, clickable prototypes, you pick. "Describe/create"
   first, "explain this" second. Add Turnstile if bots show up.
   - **A chat, not one-offs** (you, 2026-11-04: "a proper chat interface so
     that prompts are not one-offs into the ether which either succeed or
     don't, but where you can have a conversation and ask for something like
     'ok now make types required and add another agent type that does xyz'
     within the context of an existing conversation"). Built behind a switch,
     2026-11-04, on no design round: `VITE_CHAT=on` shows it, in the local `.env`
     and not in production, where `?chat=on` lets a browser in for good and
     `?chat=off` takes it back out (`src/ui/chatUnlock.ts`, 2026-11-05, so a friend
     can try it; you: "it's just a feature switch"). It adds about 15 kB compressed
     for everyone, which loading it only once unlocked would save. Logic in
     `src/create/chat.ts`, the panel in `src/ui/Chat.tsx`.
     - Bring your own model (you, 2026-11-05: "i think for now let's just allow
       people to bring their own models and providers... we can make requests
       right from the frontend! which also neatly gets rid of the whole netlify
       60s request timeout"). Built that day: `src/create/provider.ts`, settings
       in `src/ui/modelSettings.ts` and `src/ui/ModelSettingsForm.tsx`. Under `npm
       run dev`, "Pretend model" in the provider list answers from a script, for
       free (`scripts/fakeModel.ts`). Keys stay in localStorage, and are never
       saved with chats. `CHAT_MODEL` now only matters to `reading-eval`.
       - The API: Chat Completions is the standard, and Anthropic's Messages isn't
         the same thing. Its OpenAI-style endpoint ignores `reasoning_effort` and
         never returns thinking, so Anthropic goes through Messages.
       - Which providers take browser requests, checked 2026-11-05: the 14 cloud
         ones in the list, Qwen by preflight only and the others by a request with
         a fake key as well. OpenAI and Cerebras leave CORS headers off a 401 on chat requests,
         so a wrong key looks like a network failure; for OpenAI the models
         endpoint says what's wrong, and the app asks it. Success responses were
         only seen for OpenRouter and Anthropic, with real keys.
       - Local models, tested in Chrome 156 from the live site's origin: localhost
         and LAN addresses work once the visitor allows Chrome's permission prompt
         and the server allows the site. Stock Ollama answers 403 until
         `OLLAMA_ORIGINS` includes the site; the app says how. Not tried: Safari or
         Firefox, LM Studio, or a real local model's replies (Ollama here has none
         downloaded).
       - Models: no provider says which are popular, and OpenRouter's
         `?order=top-weekly` changes nothing. So the list is the provider's own
         `/models`, newest first, searchable, and any name can be typed, with each
         provider's format in the placeholder. A kept shortlist was looked into
         and dropped (you, 2026-11-05: "that might be plenty for what i need").
         If lists turn out too noisy: models.dev has what it takes, keyless, with
         release dates, and a weekly job could keep a small file from it.
       - Reasoning levels vary by model, even within a lab: DeepSeek, Moonshot
         and `glm-5.3` have low, high and max, with no medium. OpenRouter's
         `/models` says which (`reasoning.supported_efforts`) and so does
         Anthropic's (`capabilities.effort`), both seen on real lists; other
         providers get the usual levels, and one that's turned down is ruled out
         for that model until it's picked again. xhigh and max haven't been
         tried on a real reply.
       - Open: settings still does two jobs under one Save, connecting a provider
         and choosing the default, so adding a second provider makes it the
         default. Splitting them, or a "use for new chats" checkbox, waits until
         it's been used for a while.
     - Resume (you, 2026-11-05: "a resume button for when replies or reasoning gets
       cut off, so you can easily resume its response without explaining to the
       model what happened"). It works by a hidden message with how far it got,
       since newer models refuse a reply seeded with its start. A document has to
       come whole, so one cut off part way gets written again.
     - The tries (you, 2026-11-04): "the retry limit should be set per turn, not
       overall. so when i send a msg the model gets 3 tries to get a net through
       the checker but after i message it should get 3 more. actually tbh i think
       this whole 3 try limit should really be a suggestion rather than a hard
       limit. the user should always be able to interrupt the agent. maybe let's
       keep it for now just so we can get going but yeah." Per message and
       interruptible are done; `TRIES` is still a hard limit.
     - Chats last (you, 2026-11-04: "chats should always persist"): opening an
       example or a link, or reloading, keeps the conversation. Only deleting one
       from the list ends it, and that asks first.
     - The list of chats opens from the chat's name at the top of the panel:
       newest first, named after the first line of the first message. They're in
       IndexedDB (`src/ui/chatDb.ts`), and the one chat from localStorage moves
       there by itself. Going to one leaves the canvas alone (you, 2026-11-04: "me
       navigating around past chats shouldn't mess with what i have in the
       canvas"); a new reply still goes on the canvas straight away.
     - Replies carry on in the background (you, 2026-11-05: "it shouldn't stop. it
       should still stream in in the background. unless the user trashes the
       chat."). One that finishes while its chat isn't on the screen waits for its
       Load button rather than changing the canvas. They live in the tab, so
       reloading or closing it cuts them all off, each with Continue. Nothing says
       a reply has finished elsewhere yet, beyond the list and the Chat button.
     - Names: the model names a chat from its first message, with as little
       thinking as it allows. Until then, or if that fails, it goes by its first
       line. A chat without a name gets one when it's next added to: never on
       loading the page, which would spend the visitor's money unasked, and could
       bring up the browser's permission prompt for a local model.
     - Examples: the prompt lists every example's name and description (a test keeps
       that the same as the app's), and the model asks to see some with a block
       marked `examples`; netties answers through the same loop as its feedback.
       That's rather than API tool calls, since DeepSeek needs reasoning sent back
       with those, and this works on any model. Up to 3 looks a message, free of
       tries. On "combine the range(5) and prime sieve examples", after fixing how
       requests are recognised: 3 of 3 looked at the right two, 2 got working nets
       ([2, 3, 5, 7] from a count of candidates, and a stream giving the first 5
       primes), 1 hit the token limit.
     - Tabs: each is on a chat of its own choosing, and stays on it through a
       reload; a new tab starts on the chat last moved to. Tabs on the same chat
       follow each other (a reply going elsewhere shows in lumps every 2 s, with no
       Stop here), and speaking in one stops a reply going in another. A tab only
       saves what's new. The net is still each tab's own, and the last edit in any
       tab is what's saved.
     - Words: the chat prompt names netties' terms and asks for plain English
       otherwise, labels included. Over 18 tries each on 6 requests, words like
       "subtrahend" and "addend" went from 23 uses to 0, with nets no worse (10
       passed against 8). `SYSTEM`, which the eval uses, is untouched.
     - Reasoning: finished replies' reasoning doesn't go back to the model, only
       cut-off replies' does, as text. DeepSeek ignores reasoning sent back in a
       request without tools. Still to test: whether a retry does better for
       seeing the reasoning of the try that failed.
     - Thinking to the limit: sorting 3 numbers used all 32,000 tokens in 4 of 6
       tries, with no net at the end ("The reply was too long and got cut off").
       There's no such limit in the chat now, apart from 64,000 for Anthropic and
       DeepSeek, and a reply that hits one can be resumed.
     - A flaky test: "is really N times as fast" in `editor.test.ts` takes about
       3.8 s alone and about 5 s in the whole suite, against a 5 s timeout. On
       2026-11-05 it failed 4 of 5 whole runs on a clean checkout, on a busy
       machine. A property test in `layout.test.ts` also failed once.
     - After the desktop UX: the phone. Tap targets are under the app's 40 px; a
       sideways phone leaves the net about 70 px; Step and Run are behind the panel
       upright, and how to reach them is undecided (you, 2026-11-04: "not sure yet.
       let's come back to this after we fix desktop UX").
     - A name for a net, its agent types and its rules together (you, 2026-11-04:
       "ideally we should have a clear name to refer to a net+agent types+rules
       but ye good enough for now"). The chat says "Show as text" for now, and the
       code and the prompt say "document".
     - Before it can go live: a visual pass from you; a phone's real keyboard, which hasn't
       been tried; holding a reply while a rule with unsaved changes is open,
       which hasn't been run. The eval only has compute-an-answer tasks, so it
       needs follow-up and edit tasks too. On the one follow-up tried so far,
       DeepSeek 1017 took 4 s against 17 s for writing the system it edited, so
       edits may fit in 60 s where whole systems don't: worth measuring.
   - **Netlify ends the response 60 s in** (no longer a matter for the chat, which doesn't go through Netlify), even while data is flowing
     (tested on a draft deploy, 2026-11-04). That's about 12k tokens from
     Haiku, which often thinks for far longer on harder requests, so it gets
     5 to 10 of the 33 hard attempts right in time; Sonnet gets 26, Opus 27
     (`npx vite-node eval/run.ts -- --live`). Open: which model, or a
     background function and polling so a reply can take longer (up to 15
     minutes, included on Free).
   - Cheaper models, 2026-11-04, routed to OpenRouter's fastest provider (its
     default favours cheap ones, which can be 10× slower). DeepSeek V4.1 Flash
     1017 and Particle-1 solve the nine ordinary hard tasks with new inputs
     (25/25, 27/27) for $0.03 and $0.015 an attempt, against about $0.06 for
     Sonnet, but think about six times as long: 7 to 10 of 33 hard attempts
     fit in 60 s, with examples or low effort barely changing that. Neither
     has a real lambda or a general primes. Particle-1's weights aren't open.
     Not yet fairly tested: Beam 1.0, whose provider rejects every retry.
   - The prompt has to say netties checks each draft and that there are three
     tries. Without that, or if told it may decline, Haiku says it can't run
     netties and gives up, even on tasks it can do.

5. **Showing what a net means** (you, 2026-11-05: "instead of leaving it to the
   user to interpret a sequence of S's as a natural number, to provide some...
   like overlay or smth"). A working prototype is at `/meanings.html`, with the
   findings, suggested order and four questions for you in
   `design/brief-meanings.md`. Nothing is in the app yet.

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
- Skip to the end of a run: a button that works out the result without drawing
  the steps, for very big computations (you, 2026-11-05: "especially for very
  big computations where the user is only interested in the results. like e.g.
  to just run a test that their computation gets the right results"). Should be
  cheap, since most of a run's time goes on drawing. Just pencilled in.

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
