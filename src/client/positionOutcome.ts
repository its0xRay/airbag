import type { ContractAcct, ExerciseRequestAcct } from "./optketProgram";
import type { ExpiryEvent } from "./expiryEvent";

/** Account totals for vaults; reconciled confirmed receipts for legacy positions. */
export function positionOutcome(k: ContractAcct, requests: ExerciseRequestAcct[], expiry?: ExpiryEvent) {
  const closed = !["Active", "PartiallySettled"].includes(k.status);
  if (k.vaultRound) {
    if (k.recordedPayout == null || k.recordedRefund == null) return null;
    return { payout: k.recordedPayout, refund: k.recordedRefund, closed };
  }
  const mine = requests.filter(r => r.contract.toBase58() === k.address);
  if (new Set(mine.map(r => r.nonce)).size !== k.nextRequestNonce || mine.length !== k.nextRequestNonce) return null;
  if (mine.some(r => r.nonce < 0 || r.nonce >= k.nextRequestNonce)) return null;
  if (expiry && expiry.contractId !== k.contractId) return null;
  if (["Expired", "Refunded"].includes(k.status) && !expiry) return null;
  if (k.status === "Cancelled") return null;
  const settled = mine.filter(r => r.status === "Settled");
  const accounted = settled.reduce((sum, r) => sum + r.quantity, 0n) + (expiry?.quantity ?? 0n) + k.remainingQuantity + k.pendingQuantity;
  if (accounted !== k.originalQuantity) return null;
  return { payout: settled.reduce((sum, r) => sum + r.payout, 0n) + (expiry?.payout ?? 0n), refund: expiry?.refundedPremium ?? 0n, closed };
}
