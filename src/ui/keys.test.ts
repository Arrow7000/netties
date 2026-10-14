import { expect, test, vi } from "vitest";

test("shortcuts are written with Ctrl, Alt and Shift off a Mac", async () => {
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "" });
  vi.resetModules();
  const { shortcuts } = await import("./keys");
  expect(shortcuts("Redo (⇧⌘Z)")).toBe("Redo (Ctrl+Shift+Z)");
  expect(shortcuts("Save and close (⌘↵). ⌘S saves")).toBe("Save and close (Ctrl+Enter). Ctrl+S saves");
  expect(shortcuts("Next rule (⌥→)")).toBe("Next rule (Alt+→)");
  vi.unstubAllGlobals();
});
