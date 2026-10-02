/** Explicit Devnet rollout. Reuses only the administrator's withdrawable test funds.
 * Dry-run by default. No minting, legacy pool transfer, or changed existing terms.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Transaction } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { OptketClient, associatedTokenAddress } from "../src/client/optketProgram";
import { VaultClient, vaultPdas } from "../src/client/vaultProgram";
import { loadAdmin } from "../server/keys";
import { vaultPolicyHash } from "../server/vaultQuotes";
import { ACTIVE_REFERENCE_VERSION } from "../src/data/referencePolicy";
const rpc = process.env.RPC_URL || readFileSync(`${homedir()}/.config/solana/cli/config.yml`, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1];
const U = 1_000_000n, seed = 10_000n * U;
const id = BigInt(process.env.VAULT_ROUND_ID || "2026092601");
async function run() {
  assert(rpc, "RPC required");
  const conn = new Connection(rpc, "confirmed"), client = new VaultClient(conn);
  assert.equal(await conn.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  const admin = loadAdmin(); assert(admin, "Administrator unavailable");
  const config = await new OptketClient(conn).getConfig();
  assert(config && config.admin.equals(admin.publicKey) && !config.pausedPurchases, "Configuration unavailable");
  const execute = process.argv.includes("--execute");
  const send = async (tx: Transaction, label: string) => {
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(admin);
    const simulation = await conn.simulateTransaction(tx);
    assert(!simulation.value.err, `Preflight failed: ${JSON.stringify(simulation.value.err)}`);
    const signature = await conn.sendRawTransaction(tx.serialize());
    console.log(label, signature);
    for (let n = 0; n < 40; n++) {
      const state = (await conn.getSignatureStatuses([signature])).value[0];
      assert(!state?.err, JSON.stringify(state?.err));
      if (state?.confirmationStatus === "confirmed" || state?.confirmationStatus === "finalized") return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Confirmation uncertain. Re-run dry-run before any retry.");
  };
  const rounds = await client.rounds();
  const missing = [0, 1].filter(asset => !rounds.some(r => r.address.equals(vaultPdas.round(asset, id))));
  const account = associatedTokenAddress(config.demoMint, admin.publicKey);
  let balance = (await getAccount(conn, account)).amount;
  const deposits = await client.depositsForOwner(admin.publicKey);
  const recoverable = rounds.flatMap(round => {
    const deposit = deposits.find(d => d.round.equals(round.address));
    return round.phase === "redeemable" && deposit && !deposit.redeemed && deposit.shares > 0n && round.totalShares > 0n
      ? [{ round, amount: deposit.shares * round.finalBalance / round.totalShares }] : [];
  }).filter(r => r.amount > 0n).sort((a, b) => a.amount > b.amount ? -1 : 1);
  const required = seed * BigInt(missing.length);
  assert(balance + recoverable.reduce((sum, r) => sum + r.amount, 0n) >= required, "Insufficient existing administrator test funds");
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", balance: String(balance), required: String(required), missingAssets: missing, recoverable: recoverable.map(r => ({ round: r.round.address.toBase58(), amount: String(r.amount) })) }));
  if (!execute) return;
  for (const item of recoverable) {
    if (balance >= required) break;
    await send(new Transaction().add(client.withdrawIx(item.round, admin.publicKey, "redeem")), "Administrator test-fund withdrawal");
    balance = (await getAccount(conn, account)).amount;
  }
  for (const assetId of missing) {
    const asset = await new OptketClient(conn).getAsset(assetId);
    assert(asset?.active && asset.referenceVersion === ACTIVE_REFERENCE_VERSION[assetId]);
    assert(rounds.filter(r => r.assetId === assetId && r.phase !== "redeemable").length < 10, "Round backlog");
    const now = await conn.getBlockTime(await conn.getSlot()); assert(now);
    const address = vaultPdas.round(assetId, id);
    const terms = { assetId, fundingClose: now + 300, salesClose: now + 300 + 6 * 86400,
      latestExpiry: now + 300 + 7 * 86400, depositCap: 20_000n * U, exposureCap: seed,
      minStrike: U / 100n, maxStrike: 10_000n * U, maxQuantity: 5n * U };
    const tx = new Transaction().add(client.createIx(admin.publicKey, config.demoMint, id, terms, vaultPolicyHash(assetId)),
      client.depositIx({ address, custody: vaultPdas.custody(address), mint: config.demoMint }, admin.publicKey, admin.publicKey, seed));
    await send(tx, `Weekly custom-floor round, asset ${assetId}`);
    console.log(JSON.stringify({ assetId, round: address.toBase58(), fundingClose: terms.fundingClose, expiry: terms.latestExpiry, seed: String(seed) }));
  }
}
run().catch(error => { console.error(String(error?.message ?? error).replaceAll(rpc || "[unset]", "[RPC]")); process.exitCode = 1; });
