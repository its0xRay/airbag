/** Real Devnet quote/purchase check. --execute buys 0.01 units per asset using
 * administrator test oUSD, then requests full early exercise. No price fixtures.
 * Re-running reconciles the existing diagnostic position instead of buying again.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Ed25519Program, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { VaultClient, vaultQuoteMessage } from "../src/client/vaultProgram";
import { loadAdmin } from "../server/keys";
const rpc = process.env.RPC_URL || readFileSync(`${homedir()}/.config/solana/cli/config.yml`, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1];
const service = process.env.QUOTE_SVC || "https://web-production-44d1a.up.railway.app";
async function read(path: string, body?: unknown) {
  const response = await fetch(service + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const value = await response.json(); assert(response.ok, value.error); return value;
}
async function run() {
  assert(rpc); const conn = new Connection(rpc, "confirmed"), client = new VaultClient(conn);
  assert.equal(await conn.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  const admin = loadAdmin(); assert(admin);
  const series = await read("/series/all?includeVaults=true&customFloors=true");
  const rounds = await client.rounds();
  const send = async (tx: Transaction, label: string) => {
    tx.feePayer = admin.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(admin);
    const signature = await conn.sendRawTransaction(tx.serialize()); console.log(label, signature);
    for (let n = 0; n < 40; n++) {
      const state = (await conn.getSignatureStatuses([signature])).value[0]; assert(!state?.err, JSON.stringify(state?.err));
      if (state?.confirmationStatus === "confirmed" || state?.confirmationStatus === "finalized") return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Uncertain confirmation: inspect the signature before retrying");
  };
  for (const assetId of [0, 1]) {
    const terms = series.find((s: { assetId: number }) => s.assetId === assetId);
    assert(terms?.vaultRound && terms.minStrike && terms.maxStrike && !terms.shortDated, "Custom terms unavailable");
    const round = rounds.find(r => r.address.toBase58() === terms.vaultRound); assert(round);
    const strike = assetId === 0 ? 225_123456n : 850_123456n, quantity = 10_000n;
    const q = await read("/vault/quote", { buyer: admin.publicKey.toBase58(), round: terms.vaultRound, quantity: quantity.toString(), strike: strike.toString() });
    const payload = Buffer.from(q.payload, "base64"), message = vaultQuoteMessage(round.address, payload), signature = Buffer.from(q.signature, "base64");
    assert.equal(payload.readBigUInt64LE(43), strike);
    assert.equal(payload.readBigUInt64LE(35), quantity);
    assert.equal(q.expiryTs, round.latestExpiry);
    assert(Buffer.from(message).equals(Buffer.from(q.message, "base64")));
    assert(nacl.sign.detached.verify(message, signature, round.quoteAuthority.toBytes()));
    assert(BigInt(q.premium) > 0n && BigInt(q.premium) < 10_000_000n, "Premium over 10 test oUSD limit");
    console.log(JSON.stringify({ assetId, floor: String(strike), quantity: String(quantity), premium: q.premium, expiry: q.expiryTs, quoteVerified: true }));
    let position = (await client.positions()).find(p => p.round.equals(round.address) && p.buyer.equals(admin.publicKey) && p.strike === strike && p.originalQuantity === quantity);
    if (process.argv.includes("--execute")) {
      if (!position) {
        await send(new Transaction().add(Ed25519Program.createInstructionWithPublicKey({ publicKey: round.quoteAuthority.toBytes(), message, signature }), client.purchaseIx(round, admin.publicKey, admin.publicKey, payload, BigInt(q.quoteId), 0, BigInt(q.premium))), `Custom floor purchase ${assetId}`);
        position = (await client.positions()).find(p => p.round.equals(round.address) && p.buyer.equals(admin.publicKey) && p.strike === strike && p.originalQuantity === quantity);
      }
      assert(position && position.strike === strike && position.expiryTs === round.latestExpiry);
      if (position.nextNonce === 0 && position.remainingQuantity > 0n) await send(new Transaction().add(client.requestIx(position, admin.publicKey, position.remainingQuantity)), `Early exercise ${assetId}`);
    }
    if (position) console.log(JSON.stringify({ assetId, position: position.address.toBase58(), remaining: String(position.remainingQuantity), pending: String(position.pendingQuantity), paid: String(position.totalPayout), refunded: String(position.refundedPremium) }));
  }
}
run().catch(error => { console.error(String(error?.message ?? error).replaceAll(rpc || "[unset]", "[RPC]")); process.exitCode = 1; });
