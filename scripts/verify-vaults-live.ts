/** Real Devnet release checks. Hosted quotes/keeper only; never publishes prices.
 * Commands: prepare, buy, status, redeem. Writes require --execute.
 * A browser depositor supplies the other 4,000 test oUSD per round during funding.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import assert from "node:assert/strict";
import { Connection, Transaction, Ed25519Program } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import nacl from "tweetnacl";
import { OptketClient, associatedTokenAddress } from "../src/client/optketProgram";
import { VaultClient, vaultPdas, vaultQuoteMessage } from "../src/client/vaultProgram";
import { loadAdmin } from "../server/keys";
import { vaultPolicyHash } from "../server/vaultQuotes";
const rpc = process.env.RPC_URL || readFileSync(`${homedir()}/.config/solana/cli/config.yml`, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1];
if (!rpc) throw new Error("RPC_URL required");
const conn = new Connection(rpc, "confirmed"), client = new VaultClient(conn);
const svc = process.env.QUOTE_SVC || "https://web-production-44d1a.up.railway.app";
const id = BigInt(process.env.VAULT_TEST_ROUND_ID || "2026092301");
const U = 1_000_000n;
async function json(path: string, body?: unknown) {
  const response = await fetch(svc + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function run() {
  assert.equal(await conn.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "Devnet only");
  const admin = loadAdmin(); if (!admin) throw new Error("Administrator key required");
  const config = await new OptketClient(conn).getConfig();
  assert(config && config.admin.equals(admin.publicKey) && !config.pausedPurchases);
  const command = process.argv[2] || "status";
  assert(["prepare", "buy", "status", "redeem"].includes(command), "Unknown command");
  if (command !== "status") assert(process.argv.includes("--execute"), "Writes require --execute");
  const send = async (tx: Transaction, label: string) => {
    tx.feePayer = admin.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(admin);
    const signature = await conn.sendRawTransaction(tx.serialize());
    console.log(label, signature);
    for (let i = 0; i < 40; i++) {
      const state = (await conn.getSignatureStatuses([signature])).value[0];
      assert(!state?.err, JSON.stringify(state?.err));
      if (state?.confirmationStatus === "confirmed" || state?.confirmationStatus === "finalized") return;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error("Confirmation uncertain; inspect the printed signature before retrying");
  };
  if (command === "prepare") {
    await json("/faucet", { address: admin.publicKey.toBase58() });
    const existing = await client.rounds();
    assert(!existing.some(r => r.phase !== "redeemable"), "Unresolved rounds exist; do not duplicate preparation");
    const refs = await Promise.all([0, 1].map(asset => json(`/reference?assetId=${asset}`)));
    assert(refs.every(r => r.available && Number.isFinite(r.price) && r.price > 0), "Fresh real references required");
    const now = await conn.getBlockTime(await conn.getSlot()); assert(now);
    for (const assetId of [0, 1]) {
      const address = vaultPdas.round(assetId, id); assert(!await client.getRound(address), "Diagnostic round already exists");
      const strike = BigInt(Math.ceil(refs[assetId].price * 1.03)) * U;
      const terms = { assetId, fundingClose: now + 300, salesClose: now + 600, latestExpiry: now + 900,
        depositCap: 10000n * U, exposureCap: 10000n * U, minStrike: strike, maxStrike: strike, maxQuantity: 2n * U };
      const tx = new Transaction().add(client.createIx(admin.publicKey, config.demoMint, id, terms, vaultPolicyHash(assetId)),
        client.depositIx({ address, custody: vaultPdas.custody(address), mint: config.demoMint }, admin.publicKey, admin.publicKey, 6000n * U));
      await send(tx, `asset ${assetId} prepare`);
      console.log(JSON.stringify({ assetId, round: address.toBase58(), floor: Number(strike) / 1e6, fundingClose: terms.fundingClose, expiry: terms.latestExpiry }));
    }
    return;
  }
  for (const asset of [0, 1]) {
    const round = await client.getRound(vaultPdas.round(asset, id)); assert(round, "Diagnostic round missing");
    let position = (await client.positions()).find(p => p.round.equals(round.address) && p.buyer.equals(admin.publicKey));
    if (command === "buy") {
      assert.equal(round.phase, "active", "Hosted keeper must activate the round");
      assert.equal(round.totalShares, 10000n * U, "Browser depositor must supply 4,000 test oUSD before funding closes");
      if (!position) {
        const q = await json("/vault/quote", { buyer: admin.publicKey.toBase58(), round: round.address.toBase58(), quantity: U.toString(), strike: round.minStrike.toString() });
        const payload = Buffer.from(q.payload, "base64"), message = vaultQuoteMessage(round.address, payload), signature = Buffer.from(q.signature, "base64");
        assert(Buffer.from(message).equals(Buffer.from(q.message, "base64")));
        assert(nacl.sign.detached.verify(message, signature, round.quoteAuthority.toBytes()));
        assert(BigInt(q.premium) <= 200n * U, "Diagnostic premium exceeds 200 test oUSD ceiling");
        await send(new Transaction().add(Ed25519Program.createInstructionWithPublicKey({ publicKey: round.quoteAuthority.toBytes(), message, signature }),
          client.purchaseIx(round, admin.publicKey, admin.publicKey, payload, BigInt(q.quoteId), 0, BigInt(q.premium))), `asset ${asset} purchase`);
        position = (await client.positions()).find(p => p.round.equals(round.address) && p.buyer.equals(admin.publicKey));
      }
      assert(position);
      if (position.nextNonce === 0) await send(new Transaction().add(client.requestIx(position, admin.publicKey, 400000n)), `asset ${asset} partial exercise`);
    }
    if (command === "redeem") {
      assert.equal(round.phase, "redeemable", "Hosted keeper must finalize");
      assert(position && position.remainingQuantity === 0n && position.refundedPremium === 0n, "Require actual settlement, not reference-failure refund");
      const request = (await client.requests()).find(r => r.position.equals(position.address));
      assert(request && request.status === 1, "Partial exercise must settle");
      const deposit = await client.getDeposit(round.address, admin.publicKey); assert(deposit);
      const expected = round.finalBalance * deposit.shares / round.totalShares;
      if (!deposit.redeemed) {
        const token = associatedTokenAddress(round.mint, admin.publicKey), before = (await getAccount(conn, token)).amount;
        await send(new Transaction().add(client.withdrawIx(round, admin.publicKey, "redeem")), `asset ${asset} admin redemption`);
        assert.equal((await getAccount(conn, token)).amount - before, expected);
      }
      console.log(`PASS asset ${asset}: actual reference settlement and proportional administrator redemption ${expected}`);
    }
    console.log(JSON.stringify({ asset, round: round.address.toBase58(), phase: round.phase, shares: round.totalShares,
      expiry: round.latestExpiry, premiums: round.premiums, payouts: round.payouts, refunds: round.refunds,
      open: round.openContracts, reserved: round.reserved, finalBalance: round.finalBalance,
      position: position && { address: position.address.toBase58(), remaining: position.remainingQuantity, pending: position.pendingQuantity, paid: position.totalPayout, refunded: position.refundedPremium } }, (_, v) => typeof v === "bigint" ? v.toString() : v));
  }
}
run().catch(e => { console.error(String(e?.message ?? e).replaceAll(rpc, "[RPC]")); process.exitCode = 1; });
