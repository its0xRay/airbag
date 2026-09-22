import { describe, expect, it } from "vitest";
import { tierAvailable } from "./seriesRotation";
const strikes = { 0: 215, 1: 1000 };
const series = [
  { assetId: 0, active: true, referenceVersion: 2, purchaseCutoffTs: 200000, strike: 215000000n },
  { assetId: 1, active: true, referenceVersion: 1, purchaseCutoffTs: 200000, strike: 1000000000n },
];
describe("series rollover eligibility", () => {
  it("keeps both valid weekly floors and replaces before the last day", () => {
    expect(tierAvailable(series, strikes, 100000, 86400)).toBe(true);
    expect(tierAvailable(series, strikes, 113600, 86400)).toBe(false);
    expect(series[0].purchaseCutoffTs).toBe(200000);
  });
  it("does not treat one asset, an old reference or a wrong floor as complete", () => {
    expect(tierAvailable(series.slice(0, 1), strikes, 100000, 150)).toBe(false);
    expect(tierAvailable([{ ...series[0], referenceVersion: 1 }, series[1]], strikes, 100000, 150)).toBe(false);
    expect(tierAvailable(series, { ...strikes, 1: 1100 }, 100000, 150)).toBe(false);
    expect(tierAvailable([series[0], { ...series[1], active: false }], strikes, 100000, 150)).toBe(false);
  });
});
