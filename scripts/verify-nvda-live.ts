/** Real Devnet lifecycle proof. Uses hosted quotes and hosted keeper; never
 * publishes prices. Creates a small, seven-minute diagnostic series outside
 * the user-facing series range, buys one displayed NVDAx and exercises 0.4. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { OptketClient, pdas, OPTKET_PROGRAM_ID } from "../src/client/optketProgram";

const rpc = process.env.RPC_URL || readFileSync(`${homedir()}/.config/solana/cli/config.yml`, "utf8").match(/^json_rpc_url: (.+)$/m)?.[1];
if (!rpc) throw new Error("RPC_URL required");
const conn = new Connection(rpc, "confirmed");
if (await conn.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Devnet only");
if (!process.argv.includes("--execute")) throw new Error("Pass --execute to create real Devnet test transactions");
const buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));
const client = new OptketClient(conn);
const config = await client.getConfig();
if (!config?.admin.equals(buyer.publicKey) || (await client.getAsset(0))?.referenceVersion !== 2) throw new Error("Migration/admin check failed");
const svc = process.env.QUOTE_SVC || "https://web-production-44d1a.up.railway.app";
async function json(path: string, body?: unknown) {
  const response = await fetch(svc + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) } : { signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
const reference = await json("/reference?assetId=0");
if (!reference.available || !reference.source.startsWith("jupiter:")) throw new Error("Fresh token reference unavailable");
const id = Number(process.env.LIVE_TEST_SERIES || 60000);
if (id < 60000 || id > 65535) throw new Error("Diagnostic series must be outside automatic rotation range");
if (await client.getSeries(0, id)) throw new Error("Diagnostic series exists; choose a new LIVE_TEST_SERIES");
const expiry = Math.floor(Date.now() / 1000) + 420;
const floor = Math.ceil(reference.price * 1.03);
const d = createHash("sha256").update("global:create_series").digest().subarray(0, 8);
const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const sid = Buffer.alloc(2); sid.writeUInt16LE(id);
const meta = (pubkey: PublicKey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const create = new TransactionInstruction({ programId: OPTKET_PROGRAM_ID,
  keys: [meta(buyer.publicKey, true, true), meta(pdas.config()), meta(pdas.asset(0)), meta(pdas.series(0, id), false, true), meta(SystemProgram.programId)],
  data: Buffer.concat([d, Buffer.from([0]), sid, u64(floor * 1e6), u64(expiry), u64(expiry - 300), u64(expiry - 180), u64(1e6)]),
});
console.log("series", await sendAndConfirmTransaction(conn, new Transaction().add(create), [buyer]));
await json("/faucet", { address: buyer.publicKey.toBase58() });
const result = await json("/quote", { buyer: buyer.publicKey.toBase58(), assetId: 0, seriesId: id, quantity: "1000000" });
if (result.quote.referenceVersion !== 2) throw new Error("Wrong reference version");
const signed = { message: Buffer.from(result.message, "base64"), signature: Buffer.from(result.signature, "base64"), quoteId: BigInt(result.quote.quoteId), quoteAuthority: config.quoteAuthority };
if (!nacl.sign.detached.verify(signed.message, signed.signature, signed.quoteAuthority.toBytes())) throw new Error("Invalid quote signature");
console.log("purchase", await sendAndConfirmTransaction(conn, client.purchaseTx(buyer.publicKey, 0, id, config.demoMint, signed), [buyer]));
const contract = pdas.contract(signed.quoteId);
console.log("contract", contract.toBase58(), "expiry", new Date(expiry * 1000).toISOString(), "premium", result.premiumTokens, "reference", result.spot);
console.log("exercise-request", await sendAndConfirmTransaction(conn, new Transaction().add(client.requestExerciseIx(buyer.publicKey, contract, 0, 0, 400000n)), [buyer]));
let last = "";
while (Date.now() / 1000 < expiry + 400) {
  const [c, request] = await Promise.all([client.getContract(signed.quoteId), client.getRequestAt(contract, 0)]);
  const state = JSON.stringify({ contract: c?.status, exercise: request?.status, payout: request?.payout.toString(), remaining: c?.remainingQuantity.toString(), reserved: c?.reservedCollateral.toString() });
  if (state !== last) { console.log(state); last = state; }
  if (c?.status === "Expired" || c?.status === "Refunded") {
    const txs = await conn.getSignaturesForAddress(contract, { limit: 8 });
    console.log("transactions", JSON.stringify(txs.map((t) => ({ signature: t.signature, err: t.err }))));
    if (request?.status !== "Settled" || c.status !== "Expired" || c.reservedCollateral !== 0n) throw new Error("Lifecycle used failure/refund path; investigate reference availability");
    console.log("LIVE NVDAx V2 LIFECYCLE PASSED");
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
throw new Error("Keeper settlement timed out; inspect the contract, do not replace the reference");
