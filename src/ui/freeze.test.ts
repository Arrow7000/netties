import { expect, test, vi } from "vitest";
import { installFreeze } from "./freeze";

function keyboard(type: string, props: Partial<KeyboardEvent>) {
  const e = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(props)) Object.defineProperty(e, key, { value });
  return e;
}

test("Shift+F freezes pointer release and modifier updates until Escape, without swallowing OS shortcuts", () => {
  const host = new EventTarget();
  const thaw = vi.fn();
  const dispose = installFreeze(host as Window, thaw);
  const delivered = vi.fn();
  for (const type of ["pointermove", "pointerup", "pointercancel", "keyup", "blur", "keydown", "click"])
    host.addEventListener(type, delivered);

  host.dispatchEvent(keyboard("keydown", { code: "KeyF", key: "F", shiftKey: true }));
  for (const type of ["pointermove", "pointerup", "pointercancel", "keyup", "blur", "click"])
    host.dispatchEvent(new Event(type, { cancelable: true }));
  const screenshot = keyboard("keydown", { code: "Digit4", metaKey: true, shiftKey: true });
  host.dispatchEvent(screenshot);
  expect(screenshot.defaultPrevented).toBe(false);
  expect(delivered).not.toHaveBeenCalled();
  expect(thaw).not.toHaveBeenCalled();

  host.dispatchEvent(keyboard("keydown", { key: "Escape" }));
  expect(thaw).toHaveBeenCalledOnce();
  expect(delivered).not.toHaveBeenCalled();
  host.dispatchEvent(new Event("pointermove"));
  expect(delivered).toHaveBeenCalledOnce();
  dispose();
});

test("Shift+F toggles once per press and disposal restores event delivery", () => {
  const host = new EventTarget();
  const thaw = vi.fn();
  const changed = vi.fn();
  const dispose = installFreeze(host as Window, thaw, changed);
  const toggle = { code: "KeyF", shiftKey: true };
  host.dispatchEvent(keyboard("keydown", toggle));
  host.dispatchEvent(keyboard("keydown", { ...toggle, repeat: true }));
  expect(thaw).not.toHaveBeenCalled();
  expect(changed.mock.calls).toEqual([[true]]);
  host.dispatchEvent(keyboard("keydown", toggle));
  expect(thaw).toHaveBeenCalledOnce();
  host.dispatchEvent(keyboard("keydown", toggle));
  dispose();
  expect(thaw).toHaveBeenCalledTimes(2);
  expect(changed.mock.calls).toEqual([[true], [false], [true], [false]]);
  const delivered = vi.fn();
  host.addEventListener("pointerup", delivered);
  host.dispatchEvent(new Event("pointerup"));
  expect(delivered).toHaveBeenCalledOnce();
});

test("Shift+F leaves text editing and Cmd/Ctrl shortcuts alone", () => {
  const host = Object.assign(new EventTarget(), { closest: (): object | null => ({}) });
  const dispose = installFreeze(host as unknown as Window, vi.fn());
  const delivered = vi.fn();
  host.addEventListener("keydown", delivered);
  host.dispatchEvent(keyboard("keydown", { code: "KeyF", shiftKey: true }));
  expect(delivered).toHaveBeenCalledOnce();
  host.closest = () => null;
  host.dispatchEvent(keyboard("keydown", { code: "KeyF", metaKey: true }));
  host.dispatchEvent(keyboard("keydown", { code: "KeyF", shiftKey: true, ctrlKey: true }));
  host.dispatchEvent(keyboard("keydown", { code: "KeyF", shiftKey: true, metaKey: true }));
  host.dispatchEvent(keyboard("keydown", { code: "KeyF", altKey: true }));
  expect(delivered).toHaveBeenCalledTimes(5);
  dispose();
});
