import { ACTIVE_REFERENCE_VERSION } from "../src/data/referencePolicy";

interface CurrentSeries { assetId: number; active: boolean; referenceVersion: number; purchaseCutoffTs: number; strike: bigint }
export function tierAvailable(series: CurrentSeries[], strikes: Record<number, number>, now: number, leadSeconds: number): boolean {
  return [0, 1].every(asset => series.some(s => s.assetId === asset && s.active
    && s.referenceVersion === ACTIVE_REFERENCE_VERSION[asset]
    && s.strike === BigInt(Math.round(strikes[asset] * 1e6)) && s.purchaseCutoffTs > now + leadSeconds));
}
