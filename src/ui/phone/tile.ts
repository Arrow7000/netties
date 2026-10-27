import type { Pt } from "../../layout/geometry";

/**
 * A finger (or the mouse) on a tile in the phone's sheet, as a state
 * machine in the canvas's style (src/ui/gesture.ts): each pointer event is
 * a message, and `update` says what state follows and what should happen.
 *
 * A tap selects the tile, or plugs a new agent into the end a tap started a
 * wire from. A drag out of the tiles' row, across the way it scrolls, lifts
 * the tile out at once; so does a hold, after which the finger can go any
 * way. Lifted, the sheet gets out of the way and the tile is carried above
 * the finger; letting go adds one there (onto a port, plugged in), or, back
 * over the sheet or without having moved, puts it back.
 *
 *   idle ──down──▶ press ──up──▶ idle (a tap)
 *   press ──moves across──▶ carry
 *   press ──moves along──▶ idle (the row scrolls)
 *   press ──hold──▶ lifted ──moves──▶ carry ──up──▶ idle (dropped)
 *   lifted ──up──▶ idle (put back)
 *   any ──cancel──▶ idle (put back)
 */
export type TilePress =
  /** Down, not yet moved or held. `axis` is the way the tiles scroll, which the browser keeps for itself. */
  | { kind: "press"; pointer: number; start: Pt; axis: "x" | "y"; lift: number }
  /** Held: out of the sheet and above the finger, which hasn't moved since. */
  | { kind: "lifted"; pointer: number; start: Pt; lift: number }
  /** Carried by the finger, which is at `at`; the tile is drawn `lift` pixels above it. */
  | { kind: "carry"; pointer: number; at: Pt; lift: number };

/** Positions are in client pixels. `lift` is how far above the pointer a carried tile is drawn. */
export type TileMsg =
  | { kind: "down"; pointer: number; at: Pt; axis: "x" | "y"; lift: number }
  | { kind: "move"; pointer: number; at: Pt }
  | { kind: "hold"; pointer: number }
  | { kind: "up"; pointer: number; at: Pt }
  | { kind: "cancel" };

export type TileEffect =
  /** Send a `hold` for this pointer after a while, unless it has lifted or moved. */
  | { kind: "await-hold"; pointer: number }
  /** A tap: select the tile, or plug one into the end waiting for a wire. */
  | { kind: "tap" }
  /** Out of the sheet: the sheet gets out of the way. `held`: by a hold, so a buzz says so. */
  | { kind: "lift"; held: boolean }
  /** The carried tile is drawn at `at`. */
  | { kind: "carry"; at: Pt }
  /** Let go at `at`, where the tile was drawn: one is added there, unless that's over the sheet. */
  | { kind: "drop"; at: Pt }
  /** Let go without adding one: the sheet comes back. */
  | { kind: "put-back" };

/** How far a pointer moves, in pixels, before a press on a tile is a drag. */
export const TILE_SLOP = 8;

type Out = [TilePress | undefined, TileEffect[]];

export function updateTile(s: TilePress | undefined, msg: TileMsg): Out {
  if (msg.kind === "down") return s ? [s, []] : [{ kind: "press", pointer: msg.pointer, start: msg.at, axis: msg.axis, lift: msg.lift }, [{ kind: "await-hold", pointer: msg.pointer }]];
  if (!s) return [s, []];
  if (msg.kind === "cancel") return [undefined, s.kind === "press" ? [] : [{ kind: "put-back" }]];
  if (msg.pointer !== s.pointer) return [s, []];
  const above = (at: Pt): Pt => ({ x: at.x, y: at.y - s.lift });
  switch (msg.kind) {
    case "hold":
      if (s.kind !== "press") return [s, []];
      return [{ kind: "lifted", pointer: s.pointer, start: s.start, lift: s.lift }, [{ kind: "lift", held: true }, { kind: "carry", at: above(s.start) }]];
    case "move": {
      if (s.kind === "carry" || s.kind === "lifted") return [{ kind: "carry", pointer: s.pointer, at: msg.at, lift: s.lift }, [{ kind: "carry", at: above(msg.at) }]];
      const dx = msg.at.x - s.start.x;
      const dy = msg.at.y - s.start.y;
      if (Math.hypot(dx, dy) <= TILE_SLOP) return [s, []];
      // Along the way the tiles scroll is the browser's; across it lifts the tile out.
      const across = s.axis === "x" ? Math.abs(dy) > Math.abs(dx) : Math.abs(dx) > Math.abs(dy);
      if (!across) return [undefined, []];
      return [{ kind: "carry", pointer: s.pointer, at: msg.at, lift: s.lift }, [{ kind: "lift", held: false }, { kind: "carry", at: above(msg.at) }]];
    }
    case "up":
      switch (s.kind) {
        case "press":
          return [undefined, [{ kind: "tap" }]];
        case "lifted":
          return [undefined, [{ kind: "put-back" }]];
        case "carry":
          return [undefined, [{ kind: "drop", at: above(msg.at) }]];
      }
  }
}
