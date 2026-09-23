import { describe, expect, it } from "vitest";
import { closestTerms, premiumReferenceRatio, repeatPosition } from "./repeatPosition";
import type { ContractAcct } from "./optketProgram";

describe("Fresh comparable terms", () => {
  it("copies original quantity even after full settlement, without carrying a quote", () => {
    expect(repeatPosition({ assetId: 0, originalQuantity: 2_500_000n, remainingQuantity: 0n, strike: 215_000_000n, createdTs: 100, expiryTs: 200 } as ContractAcct))
      .toEqual({ assetId: 0, quantity: 2.5, strike: 215_000_000n, duration: 100 });
  });
  const short = { strike: 100n, expiryTs: 200, purchaseCutoffTs: 190 };
  const long = { strike: 105n, expiryTs: 1000, purchaseCutoffTs: 990 };
  it("matches duration and floor without reusing expired terms", () => {
    expect(closestTerms([short, long], { strike: 100n, duration: 900 }, 100)).toBe(long);
    expect(closestTerms([short], { strike: 100n, duration: 100 }, 200)).toBeUndefined();
  });
  it("excludes closed sales and leaves the input untouched", () => {
    const choices = [long, short];
    expect(closestTerms(choices, { strike: 100n, duration: 10 }, 195)).toBe(long);
    expect(choices).toEqual([long, short]);
    expect(closestTerms([], {}, 100)).toBeUndefined();
  });
  it("compares premium to quantity times current reference, not the floor", () => {
    expect(premiumReferenceRatio(8_000_000n, 2_000_000n, 100_000_000n)).toBe(0.04);
    expect(premiumReferenceRatio(0n, 1n, 1n)).toBe(0);
    expect(premiumReferenceRatio(1n, 0n, 1n)).toBeNull();
    expect(premiumReferenceRatio(1n, 1n, 0n)).toBeNull();
  });
});
