import { describe, expect, it } from "vitest";
import { referenceRiskLimit, checkReferenceExposure, QuoteExposureBudget } from "./referenceRisk";
import type { AssetAcct } from "../src/client/optketProgram";
const asset = { active: true, maxAggregateExposure: 1_000_000_000_000n, outstandingExposure: 400_000_000n } as AssetAcct;
describe("market exposure admission", () => {
  it("reserves simultaneous quotes and drains old signatures on restart", () => {
    const budget = new QuoteExposureBudget(0);
    expect(() => budget.admit(asset, 1n, 500_000_000n, 10)).toThrow("reconciling");
    budget.admit(asset, 60_000_000n, 500_000_000n, 100);
    expect(() => budget.admit(asset, 60_000_000n, 500_000_000n, 100)).toThrow("limit");
    expect(() => budget.admit(asset, 60_000_000n, 500_000_000n, 166)).not.toThrow();
  });
  it("bounds all legacy and vault exposure by liquidity and the onchain ceiling", () => {
    const cap = referenceRiskLimit(asset, 100_000, 995, 1000);
    expect(cap).toBe(500_000_000n);
    expect(() => checkReferenceExposure(asset, 100_000_000n, cap)).not.toThrow();
    expect(() => checkReferenceExposure(asset, 100_000_001n, cap)).toThrow("limit");
    expect(referenceRiskLimit({ ...asset, maxAggregateExposure: 10n }, 1e12, 995, 1000)).toBe(10n);
    expect(referenceRiskLimit(asset, 1e12, 995, 1000)).toBe(50_000_000_000n);
  });
  it("retains a quote that expires while a serialized snapshot read is pending", () => {
    const budget = new QuoteExposureBudget(0);
    budget.admit(asset, 60_000_000n, 500_000_000n, 100);
    expect(() => budget.admit(asset, 60_000_000n, 500_000_000n, 170, 160)).toThrow("limit");
  });
  it.each([null, undefined, NaN, Infinity, -1, 0, "10000"])("fails closed on invalid liquidity %s", value => {
    expect(() => referenceRiskLimit(asset, value, 995, 1000)).toThrow("liquidity");
  });
  it.each([null, 939, 1001, NaN])("fails closed on invalid observation time %s", time => {
    expect(() => referenceRiskLimit(asset, 10000, time, 1000)).toThrow("liquidity");
  });
});
