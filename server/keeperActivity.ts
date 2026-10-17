import type { KeeperSnapshot } from "./keeperSnapshot";

/** Unknown/failed discovery is never evidence that sampling may stop. Keep
 * discovery at its normal cadence; only suppress observations for idle assets.
 * Pending requests conservatively keep both adapters running. */
export function samplingAssets(snapshot: KeeperSnapshot | null): number[] {
  if (!snapshot || snapshot.requests.length || snapshot.vaults.requests.length) return [0, 1];
  const assets = new Set<number>();
  for (const contract of snapshot.contracts) assets.add(contract.assetId);
  const rounds = new Map(snapshot.vaults.rounds.map(round => [round.address.toBase58(), round]));
  for (const position of snapshot.vaults.positions) {
    const round = rounds.get(position.round.toBase58());
    if (!round) return [0, 1];
    assets.add(round.assetId);
  }
  if ([...assets].some(asset => asset !== 0 && asset !== 1)) return [0, 1];
  return [...assets].sort();
}
