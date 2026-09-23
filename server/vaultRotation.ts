import { Transaction, type Keypair } from "@solana/web3.js";
import { OptketClient } from "../src/client/optketProgram";
import { VaultClient, vaultPdas, type VaultRoundAccount, type VaultTerms } from "../src/client/vaultProgram";
import { ACTIVE_REFERENCE_VERSION } from "../src/data/referencePolicy";
import { vaultPolicyHash } from "./vaultQuotes";

export const ROUND_CADENCE = 1800;
const U = 1_000_000n;
/** Stable time-slot IDs survive restarts and concurrent replicas. No deposits or recycling. */
export function nextVaultTerms(rounds: VaultRoundAccount[], assetId: number, now: number, spot: bigint) {
  if (!Number.isSafeInteger(now) || now <= 0 || ![0, 1].includes(assetId) || spot <= 0n) return null;
  const mine = rounds.filter(r => r.assetId === assetId);
  if (mine.some(r => r.phase === "funding" && r.fundingClose > now)) return null;
  // A stuck keeper must not accumulate an unbounded backlog of locked rounds.
  if (mine.filter(r => r.phase !== "redeemable").length >= 3) return null;
  const id = 9_000_000_000n + BigInt(Math.floor(now / ROUND_CADENCE));
  if (mine.some(r => r.roundId === id)) return null;
  const fundingClose = (Math.floor(now / ROUND_CADENCE) + 1) * ROUND_CADENCE;
  if (fundingClose - now < 120) return null;
  const minStrike = spot * 95n / 100n;
  const maxStrike = (spot * 105n + 99n) / 100n;
  const terms: VaultTerms = { assetId, fundingClose, salesClose: fundingClose + 1500,
    latestExpiry: fundingClose + 1800, depositCap: 20_000n * U, exposureCap: 10_000n * U,
    minStrike, maxStrike, maxQuantity: 5n * U };
  return { id, terms };
}

export async function publishAvailableVaultRounds(client: VaultClient, admin: Keypair,
  reference: (asset: number) => Promise<{ available: boolean; spot?: bigint }>) {
  if (await client.conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Automatic rounds are Devnet-only.");
  const protocol = new OptketClient(client.conn), config = await protocol.getConfig();
  if (!config || !config.admin.equals(admin.publicKey) || config.pausedPurchases) throw new Error("Round publication paused or unauthorized.");
  // Stop threshold, not a reserved balance: concurrent duties may also spend SOL.
  // Never buy or mint SOL. At most two bounded creates per cadence.
  if (await client.conn.getBalance(admin.publicKey) < 1_000_000_000) throw new Error("Round publication paused: Devnet fee reserve is low.");
  const rounds = await client.rounds();
  const now = await client.conn.getBlockTime(await client.conn.getSlot("confirmed"));
  if (now == null) throw new Error("Confirmed chain time unavailable.");
  const results: Record<number, string> = {};
  for (const assetId of [0, 1]) {
    try {
      const asset = await protocol.getAsset(assetId);
      if (!asset?.active || asset.referenceVersion !== ACTIVE_REFERENCE_VERSION[assetId]) { results[assetId] = "Asset unavailable"; continue; }
      const ref = await reference(assetId);
      if (!ref.available || !ref.spot) { results[assetId] = "Reference temporarily unavailable"; continue; }
      const next = nextVaultTerms(rounds, assetId, now, ref.spot);
      if (!next) { results[assetId] = "No new round due"; continue; }
      if (await client.conn.getBalance(admin.publicKey) < 1_000_000_000) throw new Error("Devnet publication balance below stop threshold.");
      const tx = new Transaction().add(client.createIx(admin.publicKey, config.demoMint, next.id, next.terms, vaultPolicyHash(assetId)));
      tx.feePayer = admin.publicKey; tx.recentBlockhash = (await client.conn.getLatestBlockhash()).blockhash; tx.sign(admin);
      const signature = await client.conn.sendRawTransaction(tx.serialize());
      results[assetId] = "Publication submitted; awaiting onchain confirmation";
      // The next tick reconciles the deterministic PDA after any uncertain send.
      console.log(`[vault rounds] submitted asset ${assetId}: ${signature}; round ${vaultPdas.round(assetId, next.id).toBase58()}`);
    } catch { results[assetId] = "Publication paused; capacity or network check requires retry"; }
  }
  return results;
}
