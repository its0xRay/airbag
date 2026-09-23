import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { ContractAcct, ExerciseRequestAcct } from "./optketProgram";
import { positionOutcome } from "./positionOutcome";

const k = { address: PublicKey.default.toBase58(), contractId: 1n, originalQuantity: 10n,
  remainingQuantity: 0n, pendingQuantity: 0n, nextRequestNonce: 0, status: "Expired" } as ContractAcct;
const receipt = { contractId: 1n, quantity: 10n, settlementReference: 100n, payout: 2n, refundedPremium: 0n, invalidReference: false, timestamp: 1 };
describe("Confirmed position outcomes", () => {
  it("never substitutes zero for missing expiry receipts", () => {
    expect(positionOutcome(k, [])).toBeNull();
    expect(positionOutcome(k, [], receipt)).toEqual({ payout: 2n, refund: 0n, closed: true });
  });
  it("reconciles partial exercise plus expiry without counting failed requests", () => {
    const request = { contract: PublicKey.default, nonce: 0, quantity: 4n, payout: 3n, status: "Settled" } as ExerciseRequestAcct;
    expect(positionOutcome({ ...k, nextRequestNonce: 1 }, [request], { ...receipt, quantity: 6n })).toEqual({ payout: 5n, refund: 0n, closed: true });
    expect(positionOutcome({ ...k, nextRequestNonce: 1 }, [], receipt)).toBeNull();
    expect(positionOutcome({ ...k, nextRequestNonce: 1 }, [request], receipt)).toBeNull();
  });
  it("uses vault cumulative totals rather than adding request receipts twice", () => {
    expect(positionOutcome({ ...k, vaultRound: "round", recordedPayout: 3n, recordedRefund: 1n }, [], receipt)).toEqual({ payout: 3n, refund: 1n, closed: true });
    expect(positionOutcome({ ...k, vaultRound: "round" }, [])).toBeNull();
  });
  it("distinguishes refunds from payouts and open activity from final results", () => {
    expect(positionOutcome(k, [], { ...receipt, payout: 0n, refundedPremium: 2n, invalidReference: true })?.refund).toBe(2n);
    expect(positionOutcome({ ...k, status: "Active", remainingQuantity: 10n }, [])?.closed).toBe(false);
  });
});
