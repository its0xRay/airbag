// On-chain smoke test against the deployed Optket program (localnet or devnet).
// Drives: create demo mint -> initialize_config -> init_asset -> fund_pool ->
// create_series -> purchase (with a signed ed25519 quote). Validates the
// deployed program executes, PDAs initialize, the token CPI works, and the
// ed25519 quote verification accepts a valid signed quote.
//
// Usage: RPC_URL=http://127.0.0.1:8899 node scripts/smoke.mjs

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey("Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
const conn = new Connection(RPC, "confirmed");

const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

function loadPayer() {
  const raw = JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const S = (s) => Buffer.from(s);

async function send(ixs, signers) {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  return sig;
}

function serializeQuote(q) {
  return Buffer.concat([
    q.buyer.toBuffer(), Buffer.from([q.assetId]), u16(q.seriesId), u64(q.quantity),
    u64(q.strike), i64(q.expiryTs), u32(q.referenceVersion), u64(q.premium),
    u64(q.fees), u64(q.quoteId), i64(q.quoteExpiryTs),
  ]);
}

async function main() {
  const payer = loadPayer();
  console.log("payer:", payer.publicKey.toBase58(), "balance:", (await conn.getBalance(payer.publicKey)) / 1e9, "SOL");

  const quoteAuthority = Keypair.generate();
  const publisher = Keypair.generate();
  const assetId = 0, seriesId = 0;

  // demo mint (6 decimals) + buyer token account with balance
  const demoMint = await createMint(conn, payer, payer.publicKey, null, 6);
  const buyerAta = await getOrCreateAssociatedTokenAccount(conn, payer, demoMint, payer.publicKey);
  await mintTo(conn, payer, demoMint, buyerAta.address, payer, 1_000_000_000_000n);
  console.log("demo mint:", demoMint.toBase58());

  const config = pda([S("config")]);
  const asset = pda([S("asset"), Buffer.from([assetId])]);
  const pool = pda([S("pool"), Buffer.from([assetId])]);
  const vault = pda([S("vault"), Buffer.from([assetId])]);
  const series = pda([S("series"), Buffer.from([assetId]), u16(seriesId)]);

  // 1) initialize_config
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(payer.publicKey, true, true), meta(config, false, true), meta(demoMint, false, false), meta(SystemProgram.programId, false, false)],
    data: Buffer.concat([disc("initialize_config"), quoteAuthority.publicKey.toBuffer(), publisher.publicKey.toBuffer(), u64(0)]),
  })], [payer]);
  console.log("✓ initialize_config");

  // 2) init_asset (EquityToken = variant 0)
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(payer.publicKey, true, true), meta(config, false, false), meta(asset, false, true),
      meta(pool, false, true), meta(vault, false, true), meta(demoMint, false, false),
      meta(demoMint, false, false), meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.concat([disc("init_asset"), Buffer.from([assetId]), Buffer.from([0]), u32(1), u32(1), u64(5_000_000_000_000n), Buffer.from([1])]),
  })], [payer]);
  console.log("✓ init_asset");

  // 3) fund_pool
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(payer.publicKey, true, true), meta(config, false, false), meta(pool, false, true),
      meta(vault, false, true), meta(buyerAta.address, false, true), meta(demoMint, false, false), meta(TOKEN_PROGRAM_ID, false, false),
    ],
    data: Buffer.concat([disc("fund_pool"), Buffer.from([assetId]), u64(500_000_000_000n)]),
  })], [payer]);
  console.log("✓ fund_pool (500,000 tokens)");

  // 4) create_series
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 7 * 24 * 3600;
  await send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(payer.publicKey, true, true), meta(config, false, false), meta(asset, false, false), meta(series, false, true), meta(SystemProgram.programId, false, false)],
    data: Buffer.concat([disc("create_series"), Buffer.from([assetId]), u16(seriesId), u64(170_000_000), i64(expiry), i64(expiry - 900), i64(expiry - 300), u64(500_000_000)]),
  })], [payer]);
  console.log("✓ create_series (strike $170)");

  // 5) purchase with a signed ed25519 quote
  const quote = {
    buyer: payer.publicKey, assetId, seriesId, quantity: 10_000_000n, strike: 170_000_000n,
    expiryTs: expiry, referenceVersion: 1, premium: 50_000_000n, fees: 0n,
    quoteId: 1n, quoteExpiryTs: now + 60,
  };
  const message = serializeQuote(quote);
  const edIx = Ed25519Program.createInstructionWithPrivateKey({ privateKey: quoteAuthority.secretKey, message });

  const quoteIdBuf = u64(1);
  const quoteMarker = pda([S("quote"), quoteIdBuf]);
  const contract = pda([S("contract"), quoteIdBuf]);
  const purchaseData = Buffer.concat([disc("purchase"), message, Buffer.from([0])]); // ed25519 ix at index 0

  const purchaseIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(payer.publicKey, true, true), meta(config, false, true), meta(asset, false, true),
      meta(series, false, false), meta(pool, false, true), meta(vault, false, true),
      meta(buyerAta.address, false, true), meta(demoMint, false, false), meta(quoteMarker, false, true),
      meta(contract, false, true), meta(SYSVAR_INSTRUCTIONS_PUBKEY, false, false),
      meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false),
    ],
    data: purchaseData,
  });
  await send([edIx, purchaseIx], [payer]);
  console.log("✓ purchase with signed ed25519 quote");

  // verify the contract account exists and holds data
  const info = await conn.getAccountInfo(contract);
  if (!info || info.data.length < 8) throw new Error("contract account missing");
  // remaining_quantity sits after the 8-byte discriminator + contract_id(8) + buyer(32) + asset_id(1) + series_id(2)
  // + mint(32) + conversion_version(4) + reference_version(4) + original_quantity(8) + strike(8) + expiry(8)
  // + exercise_cutoff(8) + premium_paid(8) + fees_paid(8) => then remaining_quantity(8)
  console.log("✓ contract account created, size:", info.data.length, "bytes, owner:", info.owner.toBase58());
  console.log("\nSMOKE TEST PASSED ✅  — deployed program executes the full admin + signed-purchase flow.");
}

main().catch((e) => { console.error("SMOKE TEST FAILED ❌\n", e); process.exit(1); });
