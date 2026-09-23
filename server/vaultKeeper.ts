import { Transaction, sendAndConfirmTransaction, type Keypair } from "@solana/web3.js";
import { VaultClient } from "../src/client/vaultProgram";
import type { Observation } from "../src/client/optketProgram";

/** Uses the existing durable real-observation buffer. No synthetic references. */
export async function tickVaults(client: VaultClient, publisher: Keypair,
  samples: (asset: number, lo: number, hi: number) => Observation[]) {
  const [rounds, positions, requests] = await Promise.all([client.rounds(), client.positions(), client.requests()]);
  const now = Math.floor(Date.now() / 1000);
  const roundMap = new Map(rounds.map(r => [r.address.toBase58(), r]));
  const errors: string[] = [];
  const send = async (instruction: Parameters<Transaction["add"]>[0]) =>
    sendAndConfirmTransaction(client.conn, new Transaction().add(instruction), [publisher], { commitment: "confirmed" });
  for (const p of positions.filter(p => p.remainingQuantity > 0n)) {
    const round = roundMap.get(p.round.toBase58());
    if (!round || !round.publisherAuthority.equals(publisher.publicKey)) continue;
    try {
      if (p.pendingQuantity > 0n) {
        const request = requests.find(r => r.position.equals(p.address) && r.status === 0);
        if (!request || now < request.windowEnd) continue;
        const observations = samples(round.assetId, request.windowStart + 1, request.windowEnd);
        if (observations.length >= 3) await send(client.settleIx(round, p, observations, request));
        else if (now > request.windowEnd + 300) await send(client.failRequestIx(p, request, publisher.publicKey));
        continue; // re-fetch quantities on next tick before expiry settlement
      }
      if (now < p.expiryTs) continue;
      const observations = samples(round.assetId, p.expiryTs - 300, p.expiryTs);
      if (observations.length >= 3) await send(client.settleIx(round, p, observations));
      else if (now > p.expiryTs + 300) await send(client.settleIx(round, p, null));
    } catch { errors.push(`Vault position ${p.address.toBase58()} requires retry`); }
  }
  for (const previous of rounds.filter(r => r.phase !== "redeemable")) {
    // No transition is possible yet. Keep five-second discovery/settlement scans,
    // but avoid an extra account read for every idle round on every tick.
    if (now < previous.fundingClose || (previous.phase !== "funding" && now < previous.salesClose)) continue;
    try {
      // Re-fetch after settlements; never finalize using stale obligation totals.
      const r = await client.getRound(previous.address);
      if (!r) continue;
      if (now >= r.salesClose && r.openContracts === 0n && r.reserved === 0n) {
        await send(client.advanceIx(r, publisher.publicKey, "finalize"));
      } else if (r.phase === "funding" && now >= r.fundingClose && now < r.salesClose && r.totalShares > 0n) {
        await send(client.advanceIx(r, publisher.publicKey, "activate"));
      }
    } catch { errors.push(`Vault round ${previous.address.toBase58()} requires retry`); }
  }
  return errors;
}
