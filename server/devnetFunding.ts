import { Transaction, type Keypair } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import { OptketClient, OPTKET_PROGRAM_ID, associatedTokenAddress } from "../src/client/optketProgram";
import { VaultClient, type VaultTerms } from "../src/client/vaultProgram";
import { ACTIVE_REFERENCE_VERSION } from "../src/data/referencePolicy";
import { vaultPolicyHash } from "./vaultQuotes";
import type { PublicationSchedule } from "./publicationSchedule";

// Explicit, finite Devnet campaign authorized by the operator. No minting,
// withdrawals, reinvestment, user-deposit movement or mainnet fallback.
export const DEVNET_FUNDING = {
  start: Date.parse("2026-10-15T00:00:00Z") / 1000,
  stop: Date.parse("2026-10-29T23:59:59+05:30") / 1000,
  perAssetRound: 10_000_000_000n,
  maxRoundsPerAsset: 15,
} as const;
const DAY = 86400;
export function devnetFundingPlan(now: number, assetId: number) {
  if (!Number.isSafeInteger(now) || ![0, 1].includes(assetId)
    || now < DEVNET_FUNDING.start || now >= DEVNET_FUNDING.stop) return null;
  const day = Math.floor(now / DAY), firstDay = Math.floor(DEVNET_FUNDING.start / DAY);
  if (day - firstDay >= DEVNET_FUNDING.maxRoundsPerAsset) return null;
  // Only the restoration round has a short funding window. Subsequent daily
  // cohorts retain a full-day deposit window while earlier cohorts serve buyers.
  const fundingClose = day === firstDay ? now + 300 : (day + 1) * DAY;
  if (fundingClose - now < 120) return null;
  const terms: VaultTerms = { assetId, fundingClose, salesClose: fundingClose + 6 * DAY,
    latestExpiry: fundingClose + 7 * DAY, depositCap: 20_000_000_000n, exposureCap: 10_000_000_000n,
    minStrike: 10_000n, maxStrike: 10_000_000_000n, maxQuantity: 5_000_000n };
  return { id: 20_000_000_000n + BigInt(day), terms, seed: DEVNET_FUNDING.perAssetRound };
}

export async function publishFundedDevnetRounds(client: VaultClient, admin: Keypair,
  reference: (asset: number) => Promise<{ available: boolean; spot?: bigint }>, schedule: PublicationSchedule) {
  if (!schedule.due()) return { 0: "Funding check scheduled", 1: "Funding check scheduled" };
  schedule.clear();
  if (!client.programId.equals(OPTKET_PROGRAM_ID)
    || await client.conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Test funding is restricted to the Airbag Devnet deployment.");
  const now = await client.conn.getBlockTime(await client.conn.getSlot("confirmed"));
  if (now == null) throw new Error("Confirmed chain time unavailable.");
  if (!devnetFundingPlan(now, 0)) {
    schedule.defer(300);
    return { 0: "Automatic test funding stopped", 1: "Automatic test funding stopped" };
  }
  const results: Record<number, string> = {};
  const failed: number[] = [];
  for (const assetId of [0, 1]) {
    try {
    const plan = devnetFundingPlan(now, assetId)!;
    const address = client.pdas.round(assetId, plan.id);
    // Create + deposit is atomic. A confirmed round is the durable retry guard,
    // even after withdrawals, restarts, concurrent replicas or uncertain sends.
    if (await client.getRound(address)) { results[assetId] = "Today's seeded round already published"; continue; }
    const protocol = new OptketClient(client.conn);
    const config = await protocol.getConfig(), asset = await protocol.getAsset(assetId);
    if (!config || config.pausedPurchases || !config.admin.equals(admin.publicKey)) throw new Error("Test funding paused or unauthorized.");
    if (!asset?.active || asset.referenceVersion !== ACTIVE_REFERENCE_VERSION[assetId]) throw new Error("Active token-market asset required.");
    if ((await client.rounds()).filter(r => r.assetId === assetId && r.phase !== "redeemable").length >= 10) throw new Error("Resolve the vault backlog before funding new rounds.");
    const ref = await reference(assetId);
    if (!ref.available || !ref.spot || ref.spot <= 0n) throw new Error("Fresh reference required before publishing.");
    const mint = await getMint(client.conn, config.demoMint);
    if (mint.decimals !== 6 || !mint.mintAuthority?.equals(admin.publicKey)) throw new Error("Expected administrator-controlled test oUSD.");
    if ((await getAccount(client.conn, associatedTokenAddress(config.demoMint, admin.publicKey))).amount < plan.seed) throw new Error("Administrator test oUSD needs replenishment; automatic minting is disabled.");
    if (await client.conn.getBalance(admin.publicKey) < 1_000_000_000) throw new Error("Devnet fee reserve below 1 SOL.");
    const sendTime = await client.conn.getBlockTime(await client.conn.getSlot("confirmed"));
    if (sendTime == null || !devnetFundingPlan(sendTime, assetId)
      || devnetFundingPlan(sendTime, assetId)!.id !== plan.id || sendTime >= plan.terms.fundingClose - 30) {
      throw new Error("Funding deadline changed; reconcile before retrying.");
    }
    const tx = new Transaction().add(client.createIx(admin.publicKey, config.demoMint, plan.id, plan.terms, vaultPolicyHash(assetId)),
      client.depositIx({ address, custody: client.pdas.custody(address), mint: config.demoMint }, admin.publicKey, admin.publicKey, plan.seed));
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await client.conn.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const signature = await client.conn.sendRawTransaction(tx.serialize());
    results[assetId] = "Seeded round submitted; awaiting confirmation";
    console.log(`[devnet funding] asset ${assetId}, round ${address.toBase58()}, test oUSD 10000, signature ${signature}`);
    } catch {
      // One unavailable asset must not prevent the other from being funded.
      // Do not log RPC URLs, signing material or untrusted exception strings.
      failed.push(assetId);
    }
  }
  if (failed.length) throw new Error(`Devnet test funding checks or submission need retry for asset(s): ${failed.join(", ")}.`);
  schedule.defer(Math.min(300, (Math.floor(now / DAY) + 1) * DAY - now, DEVNET_FUNDING.stop - now));
  return results;
}
