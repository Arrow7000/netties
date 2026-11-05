# netties brief: showing what a net means

Your question, 2026-11-05: "instead of leaving it to the user to interpret a
sequence of S's as a natural number, to provide some... like overlay or smth to
help interpret the semantic meaning of the net that they're looking at".

Prototype: `npm run dev`, then
[localhost:5173/meanings.html](http://localhost:5173/meanings.html). Everything
on it is real: the examples, reduction, layout and routing are the app's. The
code is `src/dev/reading.ts` (tested) and `src/dev/meanings.ts`. Nothing in the
app has changed. `←` `→` step, `1` `2` `3` switch views, and the address always
holds the current view, so you can send me one.

## The idea

**The model writes the interpreter, not the interpretation.** If the chat's model
labelled what's on the canvas, every label would be an unchecked guess, would go
stale at the next step, and would cost an API call. Instead it writes a few lines
once for a system, and the engine applies them at every step, for free, on any
net of that system, even at 16×:

```
show number S 0                  chains of S ending in 0 are numbers
show list ∷ []                   chains of ∷ ending in [] are lists
show Add "{1} + {2}"             what an agent stands for
show Fib "F({0})" on 1           what an agent gives on another port
```

It's text, not code, so a reading in a share link can't do anything but label.
And nothing here needs a model in the first place: the lines can also be guessed
from port directions and types, so most systems read well with nothing written.

## What the engine can then say

| What | Example | Needs |
| --- | --- | --- |
| **What data is** | three S and a 0 → `3`; unfinished: `2 + ·`, `[0, 1, …]` | a reading |
| **What a loose end is, as a formula** | `3 × 2` → `(2 × 2) + 2` → … → `6` | a reading, and directions on ports |
| **What it comes to** | `out → 8`, from the very first step | a reading, to say it as `8` |
| **How far along** | `16 of 65 interactions` | nothing |
| **What a wire carries** | point at a wire: `Carries 3` | a reading |

The last few cost nothing because nets are confluent: a copy run ahead reaches the
same result in the same number of interactions, whatever order anything fires in.

The line-by-line trail is what surprised me most. It turns a run into algebra:
each rule firing is one line of working, and copying leaves the line unchanged.

## How to draw it: the choice for you

- **Plain**: today's drawing.
- **Labels**: the drawing doesn't move. A tint over each piece of data, with what
  it means beside it. No layout cost. Best on small nets; on a long list the tint
  becomes one huge blob (Find the primes, step 0).
- **Folded**: each piece of data becomes a single agent, keeping your rule that
  it's a circle if and only if it has no aux ports: a finished `3` is a circle,
  `[4, 5, 6, 7]` a stretched one, and something unfinished a box with a port where
  it's still waiting. An agent in an active pair stays out, so a step still shows
  what it really uses. Best on big nets. Same primes net: 50 agents → 15 on
  average, and it reads.

## What I measured

- **Guessed readings, all 25 examples, 802 drawings**: folding shows 52% of the
  agents overall: 31% on primes, and no change on plain combinators, which have
  nothing to fold. The final answer held at every step checked, the first 80 of
  each example. 90 tests in `src/dev/reading.test.ts`.
- **Can the chat's model write these?** `scripts/reading-eval.ts`, DeepSeek V4.1
  Flash 1017, 14 systems, 2 runs each: **27 of 28 passed, 25 on the first try**,
  $0.48 in all. Three of the systems had every name stripped out, so it had only
  the rules to go on, and it still wrote `fib`, `sort` and `insert ... into ...`.
- **The one failure**: Triage. It ran out of tokens thinking on most tries, even at
  the chat's 32,000 limit: one run got there on its third try, with a reading that
  covers only some agents, and the other never did. The guess is what's left then.
- **A wrong reading can be caught**, when it's arithmetic: a rule can't change what
  a net means, so a formula's value can't change as it runs. Say + means − and
  netties answers "at step 0, out reads as 3 - 2, which comes to 1, but the net ends
  with 5", in words it can send back to the model.

## What's weak or unknown

- **"Passed" doesn't prove meaning.** The value check only covers plain arithmetic.
  Nothing can check that a word like "sort" is true. Of the readings I read they
  were right, but I read one run of most systems, not all 28.
- **Formulas get long mid-run.** The start and end read beautifully; the middle of
  Sort or primes can be two lines of `min(1, min(1 + 1, 0))`. Bigger nets need
  something like showing only the part that changed.
- **Plain combinators have no reading.** γ, δ and ε stand for nothing by themselves,
  so all it offers is the drawing they end as, or "a is wired to d". Reading them
  as λ-terms or Church numerals would be a project of its own.
- **Folding needs layout work.** `shape()` only knows an agent's width from its aux
  ports, so the prototype pushes things apart afterwards. A real version teaches
  layout about widths. The routing checks found nothing on all 802 drawings, but
  they ran before that pushing, so wide labels have only had my eye.
- **Layout history shows.** Fibonacci step 10 has nothing folded, yet Folded draws it
  much worse than Plain (156×904 against 236×434, with wires meeting in a pinch),
  only because it got there through different drawings. All 7 such steps differ. It's
  the "Layout isn't stable yet" item in `TODO.md`, and the checks don't catch the
  pinch. Anything that changes a drawing's history will run into this.
- **Not tried**: a step's animation (the prototype jumps), a real phone (only
  headless Chrome at phone size), the `show` lines in the text format, or the chat
  writing them for real: the eval asks for them on their own.

## Suggested order, one at a time

1. **Labels, the `→` answer at loose ends, and pointing at a wire**, from guessed
   readings. No model, so every visitor gets it, and no layout work.
2. **`show` lines in the document**, so the chat writes them and they survive share
   links, with the checks above in the chat's feedback loop.
3. **Folded**, once layout knows about widths.

Other ideas this opens up, none built: selecting agents to ask the chat about them;
each rule shown as its equation (`(1 + a) × b = (a × b) + b`); trying a net on many
inputs to tabulate what it does; telling the chat's model what `out` came to, since
"it ran to the end" doesn't mean it's right.

## Questions for you

1. Labels or Folded, or Labels for small and Folded for big?
2. Should the answer show from the first step? `out → 8` before you've run anything
   is the point of the invariant, but it may spoil the fun of watching it compute.
3. Is the side panel too much for a canvas-first app? The trail needs somewhere to
   live, but you dislike clutter.
4. `·` for "not yet", and `++` for "followed by": fine, or too much like notation?
