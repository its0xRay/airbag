import type { AssetAcct } from "../src/client/optketProgram";

/** Quote-service admission limit, not an oracle guarantee or a change to settlement. */
export function devnetExposureCaps(env: Record<string, string | undefined> = process.env): readonly bigint[] {
  return ["NVDA", "ANTHROPIC"].map((name, i) => {
    const text = env[`DEVNET_${name}_EXPOSURE_CAP_OUSD`] ?? (i === 0 ? "20000" : "15000");
    if (!/^\d+$/.test(text) || BigInt(text) <= 0n || BigInt(text) > 50_000n) throw new Error(`Invalid Devnet ${name} exposure cap (whole oUSD, 1–50000).`);
    return BigInt(text) * 1_000_000n;
  });
}
export function referenceRiskLimit(asset: AssetAcct, caps: readonly bigint[]) {
  if (!asset.active) throw new Error("This asset is not accepting new positions.");
  const cap = caps[asset.assetId];
  if (cap == null || cap <= 0n) throw new Error("Unsupported asset exposure policy.");
  return cap < asset.maxAggregateExposure ? cap : asset.maxAggregateExposure;
}
export function checkReferenceExposure(asset: AssetAcct, additional: bigint, limit: bigint) {
  if (additional < 0n || asset.outstandingExposure + additional > limit) {
    throw new Error("This asset’s Devnet exposure limit is reached. Try a smaller quantity or wait for positions to settle.");
  }
}

/** Single signing-service instance. Hold quotes through expiry even if executed
 * (temporary double counting is intentional). A restart drains old signatures
 * before new issuance. Multi-replica signers require a shared reservation store. */
export class QuoteExposureBudget {
  private pending: { assetId: number; amount: bigint; until: number }[] = [];
  constructor(private startedAt = Math.floor(Date.now() / 1000)) {}
  remaining(asset: AssetAcct, limit: bigint, now: number, snapshotStartedAt = now) {
    const reserved = this.pending.filter(p => p.assetId === asset.assetId && p.until > snapshotStartedAt).reduce((sum, p) => sum + p.amount, 0n);
    const remaining = limit - asset.outstandingExposure - reserved;
    return { remaining: remaining > 0n ? remaining : 0n, reconciling: now < this.startedAt + 65 };
  }
  admit(asset: AssetAcct, additional: bigint, limit: bigint, now: number, snapshotStartedAt = now) {
    if (additional > 0n && now < this.startedAt + 65) throw new Error("Quote service is reconciling outstanding quotes. Retry shortly.");
    this.pending = this.pending.filter(p => p.until > snapshotStartedAt);
    const reserved = this.pending.filter(p => p.assetId === asset.assetId).reduce((sum, p) => sum + p.amount, 0n);
    checkReferenceExposure(asset, additional + reserved, limit);
    if (additional > 0n) this.pending.push({ assetId: asset.assetId, amount: additional, until: now + 65 });
  }
}
