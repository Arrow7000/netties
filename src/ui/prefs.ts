import { createRoot, createSignal } from "solid-js";

/** Display preferences: per viewer, kept in this browser, never part of the net. */
export const prefs = createRoot(() => {
  const KEY = "netties:wire-types";
  const read = () => {
    try {
      return localStorage.getItem(KEY) === "always";
    } catch {
      return false;
    }
  };
  const [wireTypes, setWireTypesSignal] = createSignal(read());
  /** Show the type of every wire, rather than only the ones under the pointer. */
  const setWireTypes = (on: boolean) => {
    setWireTypesSignal(on);
    try {
      localStorage.setItem(KEY, on ? "always" : "hover");
    } catch {
      // ignore
    }
  };
  return { wireTypes, setWireTypes };
});
