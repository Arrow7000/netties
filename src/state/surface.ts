import type { WireGesture } from "./model";

/**
 * The two kinds of canvas, which differ in what their free ports are.
 *
 * On the main canvas (and the component and translation views) a free port
 * is a loose end: scratch, made by letting a wire go over nothing, gone
 * when its wire goes, and joined to another wire when one is let go on it.
 *
 * In a rule's result a free port is part of the rule's interface: it stands
 * for a wire the pair held, so it's fixed. It's never made or removed, takes
 * exactly one wire, and stays where it's drawn.
 */
export type Surface = "main" | "rule";

/** What letting go of a held wire end over empty canvas does. */
export type DropOnNothing =
  /** The wire is left with a loose end there. */
  | "loose"
  /** The held loose end goes back where it was. */
  | "back"
  /** The wire comes out, as if deleted. */
  | "remove"
  /** Nothing: a new wire needs somewhere to go. */
  | "nothing";

/** How a kind of canvas treats its free ports. */
export interface FreePorts {
  surface: Surface;
  /** Whether a free port goes when its wire does, and new ones can be made. */
  scratch: boolean;
  dropOnNothing(g: WireGesture): DropOnNothing;
  /** Why a free port that has a wire can't take another, if it can't. Otherwise the two wires join into one. */
  occupied?: string;
}

export const FREE_PORTS: Record<Surface, FreePorts> = {
  main: {
    surface: "main",
    scratch: true,
    dropOnNothing: (g) => (g.kind === "carry" && g.moving.kind === "free" ? "back" : "loose"),
  },
  rule: {
    surface: "rule",
    scratch: false,
    dropOnNothing: (g) => (g.kind === "new" ? "nothing" : "remove"),
    occupied: "This interface port already has a wire.",
  },
};
