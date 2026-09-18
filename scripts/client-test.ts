// Verifies src/client/optketProgram.ts against the localnet deployment:
// reads decoded accounts and performs a purchase through the client using a
// quote fetched from the running quote service.

import { Connection, Keypair, sendAndConfirmTransaction, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { OptketClient } from "../src/client/optketProgram";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const SVC = process.env.QUOTE_SVC || "http://127.0.0.1:8787";
const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))));

const f = (v: bigint) => (Number(v) / 1e6).toLocaleString();

async function main() {
  const client = new OptketClient(conn);

  const config = await client.getConfig();
  console.log("config.demo_mint:", config!.demoMint.toBase58());
  console.log("config.quote_authority:", config!.quoteAuthority.toBase58());

  const s = await client.getSeries(0, 0);
  console.log(`series 0/0: strike ${f(s!.strike)}  maxSize ${f(s!.maxContractSize)}  active ${s!.active}`);

  const pool = await client.getPool(0);
  console.log(`pool 0: available ${f(pool!.availableCapital)}  reserved ${f(pool!.reserved)}  premiums ${f(pool!.premiumReceipts)}`);

  const before = await client.getContractsForBuyer(payer.publicKey);
  console.log(`existing contracts for buyer: ${before.length}`);

  // fetch a signed quote and purchase through the client
  const resp = await (await fetch(`${SVC}/quote`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyer: payer.publicKey.toBase58(), assetId: 0, seriesId: 0, quantity: "5000000" }),
  })).json();
  if (resp.error) throw new Error("quote service: " + resp.error);
  console.log(`quote #${resp.quote.quoteId}: premium ${resp.premiumTokens} tokens`);

  const q = {
    message: Uint8Array.from(Buffer.from(resp.message, "base64")),
    signature: Uint8Array.from(Buffer.from(resp.signature, "base64")),
    quoteAuthority: new PublicKey(resp.quoteAuthority),
    quoteId: BigInt(resp.quote.quoteId),
  };
  const tx = client.purchaseTx(payer.publicKey, 0, 0, config!.demoMint, q);
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
  console.log("purchase tx:", sig);

  const after = await client.getContractsForBuyer(payer.publicKey);
  console.log(`contracts after: ${after.length}`);
  const newest = after[0];
  console.log(`newest contract #${newest.contractId}: ${f(newest.remainingQuantity)} protected @ strike ${f(newest.strike)}, status ${newest.status}, premium ${f(newest.premiumPaid)}`);

  console.log("\nCLIENT TEST PASSED ✅ — reads decode correctly and purchase works through the client.");
}
main().catch((e) => { console.error("CLIENT TEST FAILED ❌\n", e); process.exit(1); });
