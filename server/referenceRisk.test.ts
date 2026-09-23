import { describe, expect, it } from "vitest";
import { referenceRiskLimit, checkReferenceExposure, QuoteExposureBudget, devnetExposureCaps } from "./referenceRisk";
import type { AssetAcct } from "../src/client/optketProgram";
const asset = { assetId: 0, active: true, maxAggregateExposure: 1_000_000_000_000n, outstandingExposure: 400_000_000n } as AssetAcct;
describe("market exposure admission", () => {
  it("reserves simultaneous quotes and drains old signatures on restart", () => {
    const budget = new QuoteExposureBudget(0);
    expect(() => budget.admit(asset, 1n, 500_000_000n, 10)).toThrow("reconciling");
    budget.admit(asset, 60_000_000n, 500_000_000n, 100);
    expect(() => budget.admit(asset, 60_000_000n, 500_000_000n, 100)).toThrow("limit");
    expect(() => budget.admit(asset, 60_000_000n, 500_000_000n, 166)).not.toThrow();
  });
  it("counts existing liabilities under explicit Devnet and onchain caps", () => {
    const a = { ...asset, assetId: 1, outstandingExposure: 9_000_000_000n };
    const cap = referenceRiskLimit(a, devnetExposureCaps({}));
    expect(cap).toBe(15_000_000_000n);
    expect(() => checkReferenceExposure(a, 6_000_000_000n, cap)).not.toThrow();
    expect(() => checkReferenceExposure(a, 6_000_000_001n, cap)).toThrow("limit");
    expect(referenceRiskLimit({ ...asset, maxAggregateExposure: 10n }, devnetExposureCaps({}))).toBe(10n);
    expect(referenceRiskLimit(asset, devnetExposureCaps({}))).toBe(20_000_000_000n);
  });
  it("retains a quote that expires while a serialized snapshot read is pending", () => {
    const budget = new QuoteExposureBudget(0);
    budget.admit(asset, 60_000_000n, 500_000_000n, 100);
    expect(() => budget.admit(asset, 60_000_000n, 500_000_000n, 170, 160)).toThrow("limit");
  });
  it.each(["", "-1", "0", "50001", "NaN", "1.5"])("rejects invalid configured caps %s", value => {
    expect(() => devnetExposureCaps({ DEVNET_NVDA_EXPOSURE_CAP_OUSD: value })).toThrow("Invalid");
  });
  it("rejects unknown/inactive assets and includes pending quotes in displayed headroom", () => {
    expect(() => referenceRiskLimit({ ...asset, assetId: 2 }, devnetExposureCaps({}))).toThrow("Unsupported");
    expect(() => referenceRiskLimit({ ...asset, active: false }, devnetExposureCaps({}))).toThrow("not accepting");
    const budget = new QuoteExposureBudget(0);
    budget.admit(asset, 60_000_000n, 500_000_000n, 100);
    expect(budget.remaining(asset, 500_000_000n, 100).remaining).toBe(40_000_000n);
    expect(budget.remaining(asset, 1n, 100).remaining).toBe(0n);
  });
});
