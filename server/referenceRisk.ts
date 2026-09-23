import type { AssetAcct } from "../src/client/optketProgram";

/** Quote-service admission limit, not an oracle guarantee or a change to settlement. */
export function referenceRiskLimit(asset: AssetAcct, liquidity: unknown, priceAt: number | null, now: number) {
  if (!asset.active) throw new Error("This asset is not accepting new positions.");
  if (typeof liquidity !== "number" || !Number.isFinite(liquidity) || liquidity <= 0
    || priceAt == null || !Number.isFinite(priceAt) || priceAt > now || now - priceAt > 60) {
    throw new Error("Fresh market liquidity data is unavailable. New quotes are paused; existing settlement is unchanged.");
  }
  // Conservative Devnet guardrail: 0.5% of reported liquidity, additionally
  // bounded by a 50k test-oUSD service ceiling and the existing onchain limit.
  const liquidityCap = BigInt(Math.floor(Math.min(liquidity * 0.005, 50_000) * 1e6));
  return liquidityCap < asset.maxAggregateExposure ? liquidityCap : asset.maxAggregateExposure;
}
export function checkReferenceExposure(asset: AssetAcct, additional: bigint, limit: bigint) {
  if (additional < 0n || asset.outstandingExposure + additional > limit) {
    throw new Error("This asset’s market-liquidity exposure limit is reached. Try a smaller quantity or wait for positions to settle.");
  }
}

/** Single signing-service instance. Hold quotes through expiry even if executed
 * (temporary double counting is intentional). A restart drains old signatures
 * before new issuance. Multi-replica signers require a shared reservation store. */
export class QuoteExposureBudget {
  private pending: { assetId: number; amount: bigint; until: number }[] = [];
  constructor(private startedAt = Math.floor(Date.now() / 1000)) {}
  admit(asset: AssetAcct, additional: bigint, limit: bigint, now: number, snapshotStartedAt = now) {
    if (additional > 0n && now < this.startedAt + 65) throw new Error("Quote service is reconciling outstanding quotes. Retry shortly.");
    this.pending = this.pending.filter(p => p.until > snapshotStartedAt);
    const reserved = this.pending.filter(p => p.assetId === asset.assetId).reduce((sum, p) => sum + p.amount, 0n);
    checkReferenceExposure(asset, additional + reserved, limit);
    if (additional > 0n) this.pending.push({ assetId: asset.assetId, amount: additional, until: now + 65 });
  }
}
