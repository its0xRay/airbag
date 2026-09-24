import { describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { VaultClient } from "./vaultProgram";
import { loadVaultPortfolio, redemptionValue } from "./vaultPortfolio";
import type { VaultRoundAccount, VaultDepositAccount } from "./vaultProgram";
const round = { phase: "redeemable", totalShares: 1000n, finalBalance: 997n } as VaultRoundAccount;
const deposit = { shares: 400n, redeemed: false, redemptionAmount: 0n } as VaultDepositAccount;
it("uses owner-filtered reads and makes no global scans for an empty wallet", async () => {
  const getProgramAccounts = vi.fn(async () => []);
  const client = new VaultClient({ getProgramAccounts } as unknown as Connection);
  const result = await loadVaultPortfolio(client, PublicKey.default);
  expect(result).toEqual({ contracts: [], requests: [], vaultDeposits: [] });
  expect(getProgramAccounts).toHaveBeenCalledTimes(2);
  for (const call of getProgramAccounts.mock.calls as unknown as [unknown, { filters: unknown[] }][]) {
    expect(call[1].filters).toContainEqual({ memcmp: { offset: 40, bytes: PublicKey.default.toBase58() } });
  }
});
it("filters exercise requests by their position account", async () => {
  const getProgramAccounts = vi.fn(async () => []);
  await new VaultClient({ getProgramAccounts } as unknown as Connection).requestsForPosition(PublicKey.default);
  expect(getProgramAccounts).toHaveBeenCalledWith(expect.anything(), { filters: [expect.anything(), { memcmp: { offset: 8, bytes: PublicKey.default.toBase58() } }] });
});
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
