import { describe, expect, it } from "vitest";
import { combinedOutcome } from "../combinedOutcome";
import { toFixed } from "../fixed";
const scenario = (holdings: number, protectedQuantity: number, floor: number, reference: number, premium: number) => combinedOutcome(toFixed(holdings), toFixed(protectedQuantity), toFixed(floor), toFixed(reference), toFixed(premium));
describe("combined holdings and protection arithmetic", () => {
  it("adds actual formula payout and deducts premium once", () => {
    expect(scenario(1, 1, 215, 200, 5)).toEqual({ holdingsValue: toFixed(200), protectionPayout: toFixed(15), premium: toFixed(5), combinedModelValue: toFixed(210) });
  });
  it("preserves upside above the floor", () => {
    expect(scenario(1, 1, 215, 250, 5).combinedModelValue).toBe(toFixed(245));
  });
  it("supports fractional and partially protected holdings", () => {
    expect(scenario(0.5, 0.1, 1100, 1000, 2).combinedModelValue).toBe(toFixed(508));
  });
  it("does not create value for nonexistent holdings or coverage", () => {
    expect(scenario(0, 0, 215, 200, 0).combinedModelValue).toBe(0n);
    expect(() => scenario(-1, 1, 215, 200, 5)).toThrow();
  });
});
