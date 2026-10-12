# netties: where things stand

The running list between sessions. Newest decisions and open work first;
the reasoning behind past decisions lives in `design/brief.md` (interface)
and `design/brief-types.md` (directions and types, with its outcome at the
end). Prototypes are in `design/prototypes/` (open `index.html`).

## Next up

- **Grouped examples menu.** Bring over the prototypes' Examples dropdown:
  groups (Typed / Directions only / Untyped), a thumbnail of each net, and
  a subtitle saying what it shows (see `design/prototypes/types-a2/`). The
  current menu is a flat list.
- **"Create it for me" with an LLM** (the user's top feature request). A
  visitor describes a computation; a cheap model writes the whole system
  (agents, directions and types, rules, net) in the text format; the engine
  parses, type-checks, runs and checks the result, feeding errors back for
  a few retries. "Describe/create" first, "explain this" second.
  - Step 1: an eval of about a dozen engine-checked tasks (3 × 4, a list of
    ints, length, append, booleans and not, ...) against Haiku 5.5,
    MiMo-V2.6-Flash, DeepSeek V4.1 Flash and MiMo-V2.6-Pro. Measure success
    within 3 tries, real token use, time, cost per success. Keys are in
    `.env` (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`; gitignored).
  - Step 2: a capped proxy. Netlify regular functions bill wall-clock time,
    and running out of free credits pauses every project, so use a Netlify
    Edge Function (stream the response) or a Cloudflare Worker with
    Turnstile. Per-visitor and daily caps, plus a hard spend limit on the key.
  - Step 3: a design round for the create/explain UI, as before (brief,
    clickable prototypes, user picks).
  - Research summary (2026-10-09): the cheap models all cost about $1–3 a
    day at 200 creates a day; free tiers can't carry a public site.

## Rough edges in directions and types

- The agent editor covers the canvas, so the wires it would cut (marked
  red) are often hidden. The prototype slid the canvas aside.
- The combinator translation ignores types; for systems with directions it
  could target the directed combinators instead.
- The component editor doesn't check its interface ports' types (a
  collapsed box does take its port types from the ports inside).
- Nets loaded from text or a link that don't type-check open with the bad
  wires cut and an Undo toast. The user hasn't confirmed this choice.
- The text view isn't in a monospace font.
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
