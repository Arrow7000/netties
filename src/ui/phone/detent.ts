/**
 * How far up the phone's sheet is (./Sheet.tsx), as a state machine in the
 * style of ./tile.ts: each thing that moves it is a message, and
 * `updateDetent` says where it goes.
 *
 * What clearly dismisses the sheet (a tap on empty canvas, or on the
 * grabber while it's up) closes it all the way; a tap on the grabber while
 * it's closed brings it back to its peek. A drag settles wherever it was let
 * go. A tap on something on the canvas shows it at the peek, lowering the
 * sheet from all the way up or raising it from closed; a selection that
 * raised it puts it back down when it goes.
 */
export type Detent = "closed" | "peek" | "open";

export interface SheetAt {
  detent: Detent;
  /** Where the sheet was before something selected raised it, to go back to when it goes. */
  raisedFrom?: Detent;
  /** Where it was before a tile was lifted out of it, to come back to after. */
  before?: Detent;
}

export type DetentMsg =
  /** A tap on the canvas: on nothing (`empty`), or on something; `focus`, whether the Selection face has anything to show after it. */
  | { kind: "tap-canvas"; empty: boolean; focus: boolean }
  | { kind: "tap-grabber" }
  /** A drag of the sheet let go, settling on `to`. */
  | { kind: "settle"; to: Detent }
  /** Something came to be selected or tapped (`on`), or stopped being. */
  | { kind: "focus"; on: boolean }
  /** A face picked by its tab. */
  | { kind: "pick" }
  /** More, for the rest of the actions: all the way up. */
  | { kind: "more" }
  /** A tile lifted out of the sheet (`on`), or let go. */
  | { kind: "lift"; on: boolean };

export function updateDetent(s: SheetAt, msg: DetentMsg): SheetAt {
  switch (msg.kind) {
    case "tap-canvas":
      if (msg.empty) return { ...s, detent: "closed", raisedFrom: undefined };
      if (!msg.focus || s.detent === "peek") return s;
      return { ...s, detent: "peek", raisedFrom: s.detent === "closed" ? (s.raisedFrom ?? "closed") : s.raisedFrom };
    case "tap-grabber":
      return { ...s, detent: s.detent === "closed" ? "peek" : "closed", raisedFrom: undefined };
    case "settle":
      return { ...s, detent: msg.to, raisedFrom: undefined };
    case "focus":
      if (msg.on) return s.detent === "closed" ? { ...s, detent: "peek", raisedFrom: "closed" } : s;
      return s.raisedFrom ? { ...s, detent: s.raisedFrom, raisedFrom: undefined } : s;
    case "pick":
      return { ...s, detent: s.detent === "closed" ? "peek" : s.detent, raisedFrom: undefined };
    case "more":
      return { ...s, detent: "open" };
    case "lift":
      if (msg.on) return { ...s, detent: "closed", before: s.detent };
      return s.before ? { ...s, detent: s.before, before: undefined } : s;
  }
}
