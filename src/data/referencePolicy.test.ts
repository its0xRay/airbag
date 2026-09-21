import { describe, it, expect } from "vitest";
import { effectiveMultiplier, referenceKind } from "./referencePolicy";

describe("immutable reference policies", () => {
  it("retains benchmark v1 and selects token median only for supported contracts", () => {
    expect(referenceKind(0, 1)).toBe("Equity");
    expect(referenceKind(0, 2)).toBe("PreStocks");
    expect(referenceKind(1, 1)).toBe("PreStocks");
    expect(() => referenceKind(0, 3)).toThrow();
    expect(() => referenceKind(1, 2)).toThrow();
  });
  it("uses scheduled scaled UI multiplier exactly when effective", () => {
    const state = { multiplier: "1.0009180758490996", newMultiplier: "1.001701196801074", newMultiplierEffectiveTimestamp: "100" };
    expect(effectiveMultiplier(state, 99)).toBe(1.0009180758490996);
    expect(effectiveMultiplier(state, 100)).toBe(1.001701196801074);
    expect(() => effectiveMultiplier({ multiplier: "NaN" }, 100)).toThrow();
  });
});
