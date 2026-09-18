// End-to-end proof of the quote service (PRD §8): point the on-chain
// quote_authority at the running service's key, fetch a signed quote from the
// service over HTTP, and purchase on-chain with it — proving the program
// verifies and accepts an externally-signed quote.
//
// Prereqs: local validator with the program deployed + config/asset/series set
// up (scripts/smoke.mjs), and the quote service running (npm run quote-service).

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import nacl from "tweetnacl";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const SVC = process.env.QUOTE_SVC || "http://127.0.0.1:8787";
const PROGRAM_ID = new PublicKey("Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
const conn = new Connection(RPC, "confirmed");

const disc = (n) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const meta = (p, s, w) => ({ pubkey: p, isSigner: s, isWritable: w });
const S = (s) => Buffer.from(s);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`))));

async function main() {
  const config = pda([S("config")]);
  const cfg = await conn.getAccountInfo(config);
  if (!cfg) throw new Error("config not found — run scripts/smoke.mjs first");
  const demoMint = new PublicKey(cfg.data.subarray(104, 136)); // admin32+quote32+pub32 after disc8
  console.log("demo mint:", demoMint.toBase58());

  // 1) fetch a signed quote from the running service
  const health = await (await fetch(`${SVC}/health`)).json();
  const svcAuthority = new PublicKey(health.quoteAuthority);
  console.log("service quote authority:", svcAuthority.toBase58());

  // 2) point on-chain quote_authority at the service key (set_roles; admin = payer)
  const setRoles = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(payer.publicKey, true, false), meta(config, false, true)],
    // args: Option<Pubkey> quote, Option<Pubkey> publisher, Option<u64> trial_cap
    data: Buffer.concat([disc("set_roles"), Buffer.from([1]), svcAuthority.toBuffer(), Buffer.from([0]), Buffer.from([0])]),
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(setRoles), [payer], { commitment: "confirmed" });
  console.log("✓ set on-chain quote_authority = service key");

  // 3) request a signed quote from the service
  const resp = await (await fetch(`${SVC}/quote`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyer: payer.publicKey.toBase58(), assetId: 0, seriesId: 0, quantity: "10000000" }),
  })).json();
  if (resp.error) throw new Error("service error: " + resp.error);
  console.log(`✓ service issued quote #${resp.quote.quoteId}, premium ${resp.premiumTokens} tokens`);

  const message = Buffer.from(resp.message, "base64");
  const signature = Buffer.from(resp.signature, "base64");
  // verify the service signature locally before spending
  if (!nacl.sign.detached.verify(message, signature, svcAuthority.toBytes())) throw new Error("bad service signature");
  console.log("✓ service signature verifies (ed25519)");

  // 4) purchase on-chain with the service-signed quote
  const edIx = Ed25519Program.createInstructionWithPublicKey({ publicKey: svcAuthority.toBytes(), message, signature });
  const quoteIdBuf = Buffer.alloc(8); quoteIdBuf.writeBigUInt64LE(BigInt(resp.quote.quoteId));
  const asset = pda([S("asset"), Buffer.from([0])]);
  const series = pda([S("series"), Buffer.from([0]), Buffer.from([0, 0])]);
  const pool = pda([S("pool"), Buffer.from([0])]);
  const vault = pda([S("vault"), Buffer.from([0])]);
  const buyerAta = getAssociatedTokenAddressSync(demoMint, payer.publicKey);
  const quoteMarker = pda([S("quote"), quoteIdBuf]);
  const contract = pda([S("contract"), quoteIdBuf]);

  const purchaseData = Buffer.concat([disc("purchase"), message, Buffer.from([0])]); // edIx at index 0
  const purchaseIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(payer.publicKey, true, true), meta(config, false, true), meta(asset, false, true),
      meta(series, false, false), meta(pool, false, true), meta(vault, false, true),
      meta(buyerAta, false, true), meta(demoMint, false, false), meta(quoteMarker, false, true),
      meta(contract, false, true), meta(SYSVAR_INSTRUCTIONS_PUBKEY, false, false),
      meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false),
    ],
    data: purchaseData,
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(edIx, purchaseIx), [payer], { commitment: "confirmed" });
  console.log("✓ on-chain purchase accepted the service quote, tx:", sig);

  const info = await conn.getAccountInfo(contract);
  if (!info) throw new Error("contract not created");
  console.log("✓ contract account created, size:", info.data.length, "bytes");
  console.log("\nQUOTE-SERVICE E2E PASSED ✅  — service signs, program verifies & accepts.");
}
main().catch((e) => { console.error("E2E FAILED ❌\n", e); process.exit(1); });
