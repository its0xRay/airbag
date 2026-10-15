// Dry-run by default. --send uses the same bounded, idempotent campaign as the service.
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAccount, getMint, createMintToInstruction } from "@solana/spl-token";
import { loadAdmin } from "../server/keys";
import { DEVNET_FUNDING, devnetFundingPlan, publishFundedDevnetRounds } from "../server/devnetFunding";
import { PublicationSchedule } from "../server/publicationSchedule";
import { VaultClient } from "../src/client/vaultProgram";
import { OptketClient, associatedTokenAddress } from "../src/client/optketProgram";
async function main() {
  const conn = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  if (await conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Devnet only");
  const admin = loadAdmin();
  if (!admin) throw new Error("Administrator key unavailable");
  const protocol = new OptketClient(conn), client = new VaultClient(conn), config = await protocol.getConfig();
  if (!config || !config.admin.equals(admin.publicKey)) throw new Error("Administrator mismatch");
  const now = await conn.getBlockTime(await conn.getSlot("confirmed"));
  if (now == null) throw new Error("Chain time unavailable");
  const rounds = await client.rounds();
  const deposits = await client.depositsForOwner(admin.publicKey);
  const redeemable = deposits.filter(d => !d.redeemed).flatMap(d => {
    const r = rounds.find(r => r.address.equals(d.round) && r.phase === "redeemable" && r.totalShares > 0n);
    return r ? [{ round: r.address.toBase58(), testOusd: d.shares * r.finalBalance / r.totalShares }] : [];
  });
  console.log(JSON.stringify({ mode: process.argv.includes("--send") ? "submit" : "dry-run", admin: admin.publicKey.toBase58(),
    sol: (await conn.getBalance(admin.publicKey)) / 1e9,
    testOusd: (await getAccount(conn, associatedTokenAddress(config.demoMint, admin.publicKey))).amount,
    administratorRedeemable: redeemable, campaign: DEVNET_FUNDING, assets: [0, 1].map(assetId => ({ assetId, plan: devnetFundingPlan(now, assetId),
      unresolvedRounds: rounds.filter(r => r.assetId === assetId && r.phase !== "redeemable").length })) },
  (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
  if (process.argv.includes("--prepare-budget")) {
    if (!process.argv.includes("--send") || !devnetFundingPlan(now, 0)) throw new Error("Budget preparation requires --send during the approved campaign");
    const mint = await getMint(conn, config.demoMint);
    if (mint.decimals !== 6 || !mint.mintAuthority?.equals(admin.publicKey)) throw new Error("Expected administrator-controlled test mint");
    const seed = "airbag-devnet-oct26-budget";
    const marker = await PublicKey.createWithSeed(admin.publicKey, seed, SystemProgram.programId);
    if (!await conn.getAccountInfo(marker)) {
      // Marker creation and fixed test-token mint succeed/fail together. A retry
      // cannot mint again even if confirmation was lost. No service auto-mint.
      const tx = new Transaction().add(SystemProgram.createAccountWithSeed({ fromPubkey: admin.publicKey,
        basePubkey: admin.publicKey, seed, newAccountPubkey: marker, space: 0,
        lamports: await conn.getMinimumBalanceForRentExemption(0), programId: SystemProgram.programId }),
      createMintToInstruction(config.demoMint, associatedTokenAddress(config.demoMint, admin.publicKey), admin.publicKey, 280_000_000_000n));
      console.log("One-time test funding budget", await sendAndConfirmTransaction(conn, tx, [admin], { commitment: "confirmed" }));
    } else console.log("Test budget marker already exists; no additional mint");
  }
  if (process.argv.includes("--redeem-admin")) {
    if (!process.argv.includes("--send")) throw new Error("Redemption requires --send");
    // Only the two already-inspected administrator deposits, never user capital.
    const approved = new Set(["9H1gbZpjew1uBuXYLgLHTBFGBiHfjpccvPWjtmYsaNau", "4fT2dSMVmufXnLve9BnDCETbtbTGBsPjEQLBY8ger29m"]);
    for (const entry of redeemable.filter(r => approved.has(r.round))) {
      const round = rounds.find(r => r.address.toBase58() === entry.round)!;
      console.log("Administrator redemption", await sendAndConfirmTransaction(conn,
        new Transaction().add(client.withdrawIx(round, admin.publicKey, "redeem")), [admin], { commitment: "confirmed" }));
    }
  }
  if (process.argv.includes("--send")) console.log(await publishFundedDevnetRounds(client, admin, async assetId => {
    const r = await fetch(`https://web-production-44d1a.up.railway.app/reference?assetId=${assetId}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("Reference request failed");
    const value = await r.json();
    return { available: value.available === true, spot: value.available ? BigInt(Math.round(value.price * 1e6)) : undefined };
  }, new PublicationSchedule()));
}
main().catch(error => { console.error(String(error).replace(/https?:\/\/\S+/g, "[endpoint]")); process.exitCode = 1; });
