# Architecture

Netties uses a pragmatic version of The Elm Architecture. The durable editor
state has one owner, user intentions are named messages, and mutually exclusive
states are discriminated unions. The graph engine remains mutable where that is
materially simpler or faster.

## Boundaries

- `src/core/` owns interaction nets, systems, rules and reduction. Its mutable
  classes are the domain engine; UI code must not mutate them directly.
- `src/state/` owns durable application changes, undo, revision signalling and
  persistence snapshots. `EditorMsg` and `dispatch` are the application-level
  update boundary. `createNetModel` is the update boundary for an individual
  editable net, including the private nets in rule and component editors.
- `src/layout/`, `src/render/` and memos in the state layer derive views from
  the domain state. Derived data is not copied into the application model.
- `src/ui/` renders state and emits semantic intentions. Draft form fields may
  stay local until Save; a saved change goes through the editor boundary.

## Deliberate imperative islands

Raw pointer movement, pointer capture, hit testing, camera movement, DOM
measurement, animation frames and timers stay close to the UI or runtime that
owns them. They do not need global messages. Their durable result does: for
example, Canvas owns the live drag but `NetModel` owns the selection-move undo
checkpoint and position mutation.

Reduction may mutate a `Net` in place. Run/step/fire are still application
messages, while the tight reduction loop and animation machinery remain
imperative behind that boundary.

## Rules for changes

1. Prefer a discriminated union when states are mutually exclusive. Do not add
   parallel booleans for screens, modes or asynchronous workflow phases.
2. Add a semantic `EditorMsg` for a new durable action initiated by the main
   application UI. Keep high-frequency transient events local.
3. A durable edit is one transaction: one checkpoint, all related mutations,
   then the appropriate revision signal. Cross-system edits use
   `commitSystemEdit`; net-model operations own their own transaction.
4. Do not expose writable Maps to UI components. Add a named model operation or
   read-only query instead.
5. Test state transitions and undo boundaries independently of rendering.

