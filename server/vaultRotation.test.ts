import { describe, expect, it } from "vitest";
import { nextVaultTerms } from "./vaultRotation";
import type { VaultRoundAccount } from "../src/client/vaultProgram";
const now = 18000, spot = 200_000_000n;
const round = (props: Partial<VaultRoundAccount>) => ({ assetId: 0, roundId: 1n, phase: "active", fundingClose: now - 100, ...props }) as VaultRoundAccount;
describe("bounded automatic vault publication", () => {
  it("freezes bounded terms with no seed instruction and stable restart identity", () => {
    const a = nextVaultTerms([], 0, now, spot)!;
    expect(a.id).toBe(nextVaultTerms([], 0, now + 60, spot)!.id);
    expect(a.terms).toMatchObject({ fundingClose: 86400, salesClose: 604800, latestExpiry: 691200,
      minStrike: 10_000n, maxStrike: 10_000_000_000n, maxQuantity: 5_000_000n, exposureCap: 10_000_000_000n });
  });
  it("does not duplicate a current funding window or same slot", () => {
    expect(nextVaultTerms([round({ phase: "funding", fundingClose: now + 100 })], 0, now, spot)).toBeNull();
    expect(nextVaultTerms([round({ roundId: nextVaultTerms([], 0, now, spot)!.id, phase: "redeemable" })], 0, now, spot)).toBeNull();
  });
  it("stops accumulating rounds if the keeper has a backlog", () => {
    expect(nextVaultTerms(Array.from({ length: 10 }, () => round({})), 0, now, spot)).toBeNull();
    expect(nextVaultTerms(Array.from({ length: 8 }, () => round({})), 0, now, spot)).not.toBeNull();
    expect(nextVaultTerms([round({}), round({ phase: "redeemable" }), round({ assetId: 1 })], 0, now, spot)).not.toBeNull();
  });
  it("does not publish unusably short funding windows or invalid terms", () => {
    expect(nextVaultTerms([], 0, 86300, spot)).toBeNull();
    expect(nextVaultTerms([], 2, now, spot)).toBeNull();
    expect(nextVaultTerms([], 0, now, 0n)).toBeNull();
  });
});
