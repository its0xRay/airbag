import type { ContractAcct } from "./optketProgram";

export type SimilarTerms = { strike: bigint; duration: number };
export type RepeatPosition = { assetId: number; quantity: number } & Partial<SimilarTerms>;

export function repeatPosition(k: ContractAcct): RepeatPosition {
  return { assetId: k.assetId, quantity: Number(k.originalQuantity) / 1e6,
    strike: k.strike, duration: Math.max(0, k.expiryTs - k.createdTs) };
}

/** Select from currently offered terms, never reuse an expired contract or quote. */
export function closestTerms<T extends { strike: bigint; expiryTs: number; purchaseCutoffTs: number }>(options: T[], terms: Partial<SimilarTerms>, now: number): T | undefined {
  const available = options.filter(s => s.expiryTs > now && s.purchaseCutoffTs > now);
  const distance = (s: T) => Math.abs(Number(s.strike - (terms.strike ?? s.strike))) / Math.max(1, Number(terms.strike ?? s.strike))
    + Math.abs(s.expiryTs - now - (terms.duration ?? s.expiryTs - now)) / Math.max(60, terms.duration ?? s.expiryTs - now);
  return available.sort((a, b) => distance(a) - distance(b))[0];
}

export function premiumReferenceRatio(premium: bigint, quantity: bigint, reference: bigint): number | null {
  if (premium < 0n || quantity <= 0n || reference <= 0n) return null;
  return Number(premium * 1_000_000n) / Number(quantity * reference);
}
