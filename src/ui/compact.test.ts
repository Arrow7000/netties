import { describe, expect, it } from "vitest";
import { restingHeight } from "./compact";

describe("restingHeight", () => {
  const upright = { width: 412, height: 780 };

  it("doesn't take the keyboard shrinking the page for a shorter screen", () => {
    expect(restingHeight(upright, 412, 440, true)).toBe(780);
  });

  it("goes by the tallest it has been, as a browser's bar comes and goes", () => {
    expect(restingHeight(upright, 412, 836, true)).toBe(836);
  });

  it("starts again when the phone turns", () => {
    expect(restingHeight(upright, 780, 412, true)).toBe(412);
  });

  it("believes a window being made shorter with a mouse", () => {
    expect(restingHeight({ width: 1280, height: 800 }, 1280, 400, false)).toBe(400);
  });
});
