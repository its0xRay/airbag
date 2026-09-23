import { describe, expect, it } from "vitest";
import { redemptionValue } from "./vaultPortfolio";
import type { VaultRoundAccount, VaultDepositAccount } from "./vaultProgram";
const round = { phase: "redeemable", totalShares: 1000n, finalBalance: 997n } as VaultRoundAccount;
const deposit = { shares: 400n, redeemed: false, redemptionAmount: 0n } as VaultDepositAccount;
describe("depositor results", () => {
  it("uses the original frozen denominator with conservative rounding", () => {
    expect(redemptionValue(round, deposit)).toBe(398n);
    expect(redemptionValue({ ...round, redeemedShares: 600n, redeemedAmount: 598n }, deposit)).toBe(398n);
  });
  it("never displays an unsettled balance as a final result", () => {
    expect(redemptionValue({ ...round, phase: "active" }, deposit)).toBeNull();
    expect(redemptionValue({ ...round, totalShares: 0n }, deposit)).toBeNull();
  });
  it("retains confirmed redemptions and zero-value losses", () => {
    expect(redemptionValue(round, { ...deposit, redeemed: true, redemptionAmount: 399n })).toBe(399n);
    expect(redemptionValue({ ...round, finalBalance: 0n }, deposit)).toBe(0n);
  });
});
