# netties: where things stand

The running list between sessions. Newest decisions and open work first;
the reasoning behind past decisions lives in `design/brief.md` (interface)
and `design/brief-types.md` (directions and types, with its outcome at the
end). Prototypes are in `design/prototypes/` (open `index.html`).

## Next up

- **"Create it for me" with an LLM** (the user's top feature request). A
  visitor describes a computation; a cheap model writes the whole system
  (agents, directions and types, rules, net) in the text format; the engine
  parses, type-checks, runs and checks the result, feeding errors back for
  a few retries. "Describe/create" first, "explain this" second.
  - Step 1, done 2026-10-12: `eval/` (run with `npx vite-node eval/run.ts`;
    options in the file). 13 engine-checked tasks, 3 runs each, up to 3
    tries with netties' error messages fed back:

    | model | pass@3 | first try | median time | worst | $/success |
    |---|---|---|---|---|---|
    | Haiku 5.5 | 38/39 | 37 | 27 s | 1.7 min | $0.0037 |
    | DeepSeek V4.1 Flash | 38/39 | 29 | 59 s | 19 min | $0.012 |
    | MiMo-V2.6-Pro | 39/39 | 23 | 3.7 min | 27 min | $0.013 |
    | MiMo-V2.6-Flash | 18/23 (stopped) | 9 | 5 min | 35 min | $0.012 |

    Haiku 5.5 is the pick: as accurate, 2–8× faster, about a third of the
    cost per success. MiMo-V2.6-Flash often reasons until it runs out of
    tokens and writes nothing. The tasks are too easy to separate the top
    three on accuracy; add harder ones (fib, map, sorting, two-type systems)
    before relying on accuracy differences. Attempts now fail after 5 minutes
    and are saved as they finish.
  - Step 2: a capped proxy. Netlify regular functions bill wall-clock time,
    and running out of free credits pauses every project, so use a Netlify
    Edge Function (stream the response) or a Cloudflare Worker with
    Turnstile. Per-visitor and daily caps, plus a hard spend limit on the key.
  - Step 3: a design round for the create/explain UI, as before (brief,
    clickable prototypes, user picks).
  - Research summary (2026-10-09): the cheap models all cost about $1–3 a
    day at 200 creates a day; free tiers can't carry a public site.

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
