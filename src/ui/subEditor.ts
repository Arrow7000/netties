import { createSignal } from "solid-js";
import type { NetModel } from "../state/model";
import type { Camera } from "./Canvas";

/**
 * A panel with its own canvas open over the main one, such as the rule
 * editor. While one is open, the palette drops agents into it, the undo
 * buttons and paste act on it, and anything that would leave it asks first.
 */
export interface SubEditor {
  m: NetModel;
  camera: Camera;
  /** Where a click on a palette tile drops a new agent. */
  centre(): { x: number; y: number };
  /** False, after flashing the panel, while it has unsaved changes. */
  canLeave(): boolean;
}

const [current, setCurrent] = createSignal<SubEditor>();

export const subEditor = current;
export const setSubEditor = setCurrent;

/** Whether it's fine to leave whatever panel is open; flashes it if not. */
export const canLeave = () => current()?.canLeave() ?? true;
