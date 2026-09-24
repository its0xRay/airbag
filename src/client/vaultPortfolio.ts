import { PublicKey } from "@solana/web3.js";
import { VaultClient, type VaultDepositAccount, type VaultPositionAccount, type VaultRoundAccount } from "./vaultProgram";
import type { ContractAcct, ExerciseRequestAcct } from "./optketProgram";
import { VERIFIED_ASSETS } from "../data/assets";

export function asPortfolioContract(p: VaultPositionAccount, r: VaultRoundAccount): ContractAcct {
  return { address: p.address.toBase58(), contractId: p.quoteId, buyer: p.buyer, assetId: r.assetId, seriesId: -1,
    mint: new PublicKey(VERIFIED_ASSETS[r.assetId].mint), conversionVersion: 1, referenceVersion: r.referenceVersion,
    originalQuantity: p.originalQuantity, strike: p.strike, expiryTs: p.expiryTs, exerciseCutoffTs: p.expiryTs - 300,
    premiumPaid: p.premium, feesPaid: 0n, remainingQuantity: p.remainingQuantity - p.pendingQuantity,
    pendingQuantity: p.pendingQuantity, reservedCollateral: p.reserved, createdTs: p.createdTs, nextRequestNonce: p.nextNonce,
    status: p.remainingQuantity === 0n ? (p.refundedPremium > 0n ? "Refunded" : "Settled")
      : p.remainingQuantity < p.originalQuantity ? "PartiallySettled" : "Active",
    vaultRound: r.address.toBase58(), recordedPayout: p.totalPayout, recordedRefund: p.refundedPremium };
}
export async function loadVaultPortfolio(client: VaultClient, buyer: PublicKey) {
  const [mine, deposits] = await Promise.all([client.positionsForBuyer(buyer), client.depositsForOwner(buyer)]);
  const addresses = [...new Set([...mine, ...deposits].map(p => p.round.toBase58()))];
  // Bound fan-out for older wallets without scanning other users' positions.
  const rounds: VaultRoundAccount[] = [];
  for (let i = 0; i < addresses.length; i += 4) {
    const batch = await Promise.all(addresses.slice(i, i + 4).map(a => client.getRound(new PublicKey(a))));
    rounds.push(...batch.filter((r): r is VaultRoundAccount => r !== null));
  }
  const allRequests = [];
  const requested = mine.filter(p => p.nextNonce > 0);
  for (let i = 0; i < requested.length; i += 4) {
    allRequests.push(...(await Promise.all(requested.slice(i, i + 4).map(p => client.requestsForPosition(p.address)))).flat());
  }
  const contracts = mine.map(p => {
    const round = rounds.find(r => r.address.equals(p.round));
    if (!round) throw new Error("A position's backing round could not be loaded.");
    return asPortfolioContract(p, round);
  });
  const requests: ExerciseRequestAcct[] = allRequests.filter(r => mine.some(p => p.address.equals(r.position))).map(r => ({
    address: r.address.toBase58(), contract: r.position, nonce: r.nonce, quantity: r.quantity,
    requestTs: r.windowStart, windowStart: r.windowStart, windowEnd: r.windowEnd, kind: "PreStocks",
    status: (["Pending", "Settled", "Failed"] as const)[r.status], reservedLocked: null,
    settlementReference: r.reference, payout: r.payout,
  }));
  const vaultDeposits: OwnedVaultDeposit[] = deposits.filter(d => d.shares > 0n).map(deposit => {
    const round = rounds.find(r => r.address.equals(deposit.round));
    if (!round) throw new Error("A deposit's round could not be loaded.");
    return { round, deposit };
  });
  return { contracts, requests, vaultDeposits };
}

export interface OwnedVaultDeposit { round: VaultRoundAccount; deposit: VaultDepositAccount }
export function redemptionValue(round: VaultRoundAccount, deposit: VaultDepositAccount): bigint | null {
  if (deposit.redeemed) return deposit.redemptionAmount;
  if (round.phase !== "redeemable" || round.totalShares === 0n) return null;
  return deposit.shares * round.finalBalance / round.totalShares;
}
