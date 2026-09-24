import { describe, expect, it } from "vitest";
import { walkthroughStep } from "./walkthroughStep";

describe("scroll-led walkthrough", () => {
  it("follows forward scroll, reverse scroll, and anchor jumps", () => {
    expect(walkthroughStep([300, 600, 900, 1200], 800)).toBe(0);
    expect(walkthroughStep([-700, -400, -100, 200], 800)).toBe(3);
    expect(walkthroughStep([-100, 200, 500, 800], 800)).toBe(1);
  });
  it("uses the shorter depositor sequence and short windows without stale steps", () => {
    expect(walkthroughStep([-400, -100, 200], 600)).toBe(2);
    expect(walkthroughStep([250, 550, 850], 600)).toBe(0);
    expect(walkthroughStep([], 600)).toBe(0);
  });
});
