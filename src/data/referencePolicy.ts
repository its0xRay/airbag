/** Wire-compatible versions. Existing contracts never inherit registry changes. */
export const ACTIVE_REFERENCE_VERSION: Record<number, number> = { 0: 2, 1: 1 };

export function referenceKind(assetId: number, version: number): "Equity" | "PreStocks" {
  if (assetId === 0 && version === 1) return "Equity";
  if ((assetId === 0 && version === 2) || (assetId === 1 && version === 1)) return "PreStocks";
  throw new Error(`Unsupported reference version ${assetId}:${version}`);
}

export function contractReferenceLabel(assetId: number, version: number): string {
  return referenceKind(assetId, version) === "Equity"
    ? "NVIDIA stock benchmark · legacy v1"
    : "Token-market median";
}

/** Token-2022 scheduled multiplier, selected at the current timestamp. */
export function effectiveMultiplier(state: { multiplier: string | number; newMultiplier?: string | number; newMultiplierEffectiveTimestamp?: string | number }, now: number): number {
  const effectiveAt = Number(state.newMultiplierEffectiveTimestamp);
  const multiplier = Number(state.newMultiplier != null && Number.isFinite(effectiveAt) && now >= effectiveAt
    ? state.newMultiplier : state.multiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("Invalid scaled token multiplier");
  return multiplier;
}
