// Devnet environment setup for the deployed Optket program. IDEMPOTENT — safe
// to re-run; every step checks on-chain state first and skips what exists.
//
//   RPC_URL=https://api.devnet.solana.com node scripts/setup-devnet.mjs
//
// Creates/verifies: demo mint (oUSD) → config (quote+publisher roles) → both
// assets + pools + vaults → four series with REAL-ALIGNED strikes → pool
// funding → SOL for the publisher (keeper fees) and trial budget (§19).
//
// Strikes are aligned to real market levels (NVDA benchmark / Anthropic
// PreStocks token) so keeper settlements at live prices are meaningful.

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getMint, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
const conn = new Connection(RPC, "confirmed");

// ---- real-aligned market parameters (edit here to re-tune future series) ----
const WEEK = 7 * 24 * 3600;
const SERIES_PLAN = [
  // assetId, seriesId, strike($), maxContractSize(units)
  [0, 0, 215, 100], // NVDAx — NVDA benchmark ~$219
  [0, 1, 205, 100],
  [1, 0, 1000, 20], // ANTHROPIC — token market ~$1020
  [1, 1, 950, 20],
];

/**
 * Short-dated Devnet series (series id 9+). These are genuine, fully
 * collateralized contracts that make the complete lifecycle testable without
 * waiting a week. Re-run this script to roll fresh ones under a new id.
 */
const SHORT_SERIES_ID = 9;
const SHORT_MINUTES = Number(process.env.SHORT_SERIES_MINUTES || 20);
const FORCE_SHORT_SERIES = process.env.FORCE_SHORT_SERIES === "1";
const SHORT_PLAN = [
  [0, Number(process.env.SHORT_STRIKE_0 || 230), 100],
  [1, Number(process.env.SHORT_STRIKE_1 || 1100), 20],
];
// Real mainnet identities recorded on-chain (reference only — never escrowed).
const REAL_ASSET_MINTS = {
  0: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", // NVDAx (NVIDIA xStock)
  1: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", // Anthropic PreStocks
};
const POOL_FUNDING_TOKENS = 2_000_000; // per asset, demo oUSD
const AGGREGATE_EXPOSURE_TOKENS = 5_000_000;
const PUBLISHER_SOL = 0.3; // keeper fee wallet
const TRIAL_BUDGET_SOL = 2.0; // §19 fund (top up later at will)

// ---- helpers ----
const disc = (n) => createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const fx = (n) => BigInt(Math.round(n * 1e6)); // 6dp fixed point
const meta = (p, s, w) => ({ pubkey: p, isSigner: s, isWritable: w });
const S = (s) => Buffer.from(s);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

function loadKeyFile(path, generate = false) {
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  if (!generate) throw new Error(`missing key file: ${path}`);
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const admin = loadKeyFile(`${homedir()}/.config/solana/id.json`);
const dir = new URL("../server/", import.meta.url).pathname;
const quoteAuthority = loadKeyFile(`${dir}quote-authority.json`, true);
const publisher = loadKeyFile(`${dir}publisher-authority.json`, true);
const trialBudget = loadKeyFile(`${dir}trial-budget.json`, true);

const exists = async (pk) => !!(await conn.getAccountInfo(pk));

async function send(label, ixs, signers = [admin]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
      console.log(`  ✓ ${label} — ${sig.slice(0, 16)}…`);
      return sig;
    } catch (e) {
      if (attempt === 3) throw new Error(`${label} failed after 3 attempts: ${e.message}`);
      console.warn(`  … ${label} attempt ${attempt} failed (${String(e.message).slice(0, 90)}), retrying`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

// ---- persisted setup state (demo mint address survives re-runs) ----
const STATE_PATH = new URL("./devnet-state.json", import.meta.url).pathname;
const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
const saveState = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

async function main() {
  console.log(`Optket devnet setup`);
  console.log(`  RPC:     ${RPC}`);
  console.log(`  program: ${PROGRAM_ID.toBase58()}`);
  console.log(`  admin:   ${admin.publicKey.toBase58()}  (${(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL)`);

  const prog = await conn.getAccountInfo(PROGRAM_ID);
  if (!prog?.executable) throw new Error("program is not deployed/executable on this cluster");

  // 1) demo mint (oUSD).
  // The ON-CHAIN config is the source of truth: once it exists it permanently
  // pins the demo mint, so re-running from a fresh clone (no local state file)
  // must reuse that mint rather than minting an orphan the program won't accept.
  const config = pda([S("config")]);
  const configInfo = await conn.getAccountInfo(config);
  let demoMint;
  if (configInfo) {
    demoMint = new PublicKey(configInfo.data.subarray(104, 136)); // disc8+admin32+quote32+pub32
    console.log(`  demo mint (from on-chain config): ${demoMint.toBase58()}`);
  } else if (state.demoMint && (await exists(new PublicKey(state.demoMint)))) {
    demoMint = new PublicKey(state.demoMint);
    console.log(`  demo mint exists: ${demoMint.toBase58()}`);
  } else {
    demoMint = await createMint(conn, admin, admin.publicKey, null, 6);
    console.log(`  ✓ created demo mint ${demoMint.toBase58()}`);
  }
  state.demoMint = demoMint.toBase58();
  saveState();

  // 2) config
  if (configInfo) {
    console.log(`  config exists: ${config.toBase58()}`);
  } else {
    await send("initialize_config", [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(admin.publicKey, true, true), meta(config, false, true), meta(demoMint, false, false), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("initialize_config"), quoteAuthority.publicKey.toBuffer(), publisher.publicKey.toBuffer(), u64(0)]),
    })]);
  }

  // 3) assets + pools (asset 0 = EquityToken variant 0, asset 1 = PreStocks variant 1)
  for (const [assetId, kindVariant] of [[0, 0], [1, 1]]) {
    const asset = pda([S("asset"), Buffer.from([assetId])]);
    const realMint = new PublicKey(REAL_ASSET_MINTS[assetId]);
    if (await exists(asset)) {
      // Correct the recorded identity if it predates the real-mint change.
      const info = await conn.getAccountInfo(asset);
      const recorded = new PublicKey(info.data.subarray(10, 42)); // disc8 + asset_id1 + kind1
      if (!recorded.equals(realMint)) {
        await send(`set_asset_metadata ${assetId} -> ${realMint.toBase58().slice(0, 8)}…`, [new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [meta(admin.publicKey, true, false), meta(config, false, false), meta(asset, false, true)],
          data: Buffer.concat([disc("set_asset_metadata"), Buffer.from([assetId]),
            Buffer.from([1]), realMint.toBuffer(), Buffer.from([0]), Buffer.from([0])]),
        })]);
      } else {
        console.log(`  asset ${assetId} exists (mint ${realMint.toBase58().slice(0, 8)}…)`);
      }
      continue;
    }
    const pool = pda([S("pool"), Buffer.from([assetId])]);
    const vault = pda([S("vault"), Buffer.from([assetId])]);
    await send(`init_asset ${assetId}`, [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(admin.publicKey, true, true), meta(config, false, false), meta(asset, false, true),
        meta(pool, false, true), meta(vault, false, true), meta(demoMint, false, false),
        meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false),
      ],
      data: Buffer.concat([disc("init_asset"), Buffer.from([assetId]), Buffer.from([kindVariant]), realMint.toBuffer(), u32(1), u32(1), u64(fx(AGGREGATE_EXPOSURE_TOKENS)), Buffer.from([1])]),
    })]);
  }

  // 4) series with real-aligned strikes (shared weekly expiry per asset)
  const expiry = Math.floor(Date.now() / 1000) + WEEK;
  for (const [assetId, seriesId, strike, maxSize] of SERIES_PLAN) {
    const sid = u16(seriesId);
    const series = pda([S("series"), Buffer.from([assetId]), sid]);
    if (await exists(series)) {
      console.log(`  series ${assetId}:${seriesId} exists`);
      continue;
    }
    const asset = pda([S("asset"), Buffer.from([assetId])]);
    await send(`create_series ${assetId}:${seriesId} strike $${strike}`, [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [meta(admin.publicKey, true, true), meta(config, false, false), meta(asset, false, false), meta(series, false, true), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([disc("create_series"), Buffer.from([assetId]), sid, u64(fx(strike)), i64(expiry), i64(expiry - 900), i64(expiry - 300), u64(fx(maxSize))]),
    })]);
  }

  // 4b) short-dated Devnet series, rolled under a fresh id once the last expired
  {
    const t = Math.floor(Date.now() / 1000);
    let liveId = null;
    let freeId = null;
    const shortIds = Array.from({ length: 100 }, (_, i) => SHORT_SERIES_ID + i);
    const shortInfos = await conn.getMultipleAccountsInfo(shortIds.map((id) => pda([S("series"), Buffer.from([0]), u16(id)])));
    for (let index = 0; index < shortIds.length; index++) {
      const id = shortIds[index];
      const info = shortInfos[index];
      if (!info) { freeId = id; break; }
      const expiryTs = Number(info.data.readBigInt64LE(19)); // disc8+asset1+series2+strike8
      if (!FORCE_SHORT_SERIES && expiryTs > t + 180) { liveId = id; break; } // still usable
    }
    if (liveId !== null) {
      console.log(`  short-dated series ${liveId} still live — skipping`);
    } else if (freeId !== null) {
      const expiry = t + SHORT_MINUTES * 60;
      for (const [assetId, strike, maxSize] of SHORT_PLAN) {
        const series = pda([S("series"), Buffer.from([assetId]), u16(freeId)]);
        const asset = pda([S("asset"), Buffer.from([assetId])]);
        await send(`create short-dated series ${assetId}:${freeId} strike $${strike} (${SHORT_MINUTES}m)`, [new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [meta(admin.publicKey, true, true), meta(config, false, false), meta(asset, false, false), meta(series, false, true), meta(SystemProgram.programId, false, false)],
          // purchase cutoff 5m before expiry, exercise cutoff 3m before
          data: Buffer.concat([disc("create_series"), Buffer.from([assetId]), u16(freeId), u64(fx(strike)), i64(expiry), i64(expiry - 300), i64(expiry - 180), u64(fx(maxSize))]),
        })]);
      }
      state.shortSeriesId = freeId;
      saveState();
    } else {
      console.log("  ⚠ no free short-dated series id in range — widen SHORT_SERIES_ID window");
    }
  }

  // 5) mint demo tokens to admin + fund both pools
  const adminAta = await getOrCreateAssociatedTokenAccount(conn, admin, demoMint, admin.publicKey);
  const m = await getMint(conn, demoMint);
  const one = 10n ** BigInt(m.decimals);
  for (const assetId of [0, 1]) {
    const pool = pda([S("pool"), Buffer.from([assetId])]);
    const poolInfo = await conn.getAccountInfo(pool);
    if (!poolInfo) throw new Error(`pool ${assetId} missing`);
    const available = poolInfo.data.readBigUInt64LE(8 + 1 + 32); // disc+asset_id+vault
    if (available >= fx(POOL_FUNDING_TOKENS)) {
      console.log(`  pool ${assetId} already funded (${Number(available) / 1e6} oUSD)`);
      continue;
    }
    const need = fx(POOL_FUNDING_TOKENS) - available;
    await mintTo(conn, admin, demoMint, adminAta.address, admin, (need / 1_000_000n + 1n) * one);
    const vault = pda([S("vault"), Buffer.from([assetId])]);
    await send(`fund_pool ${assetId} (+${Number(need) / 1e6} oUSD)`, [new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        meta(admin.publicKey, true, true), meta(config, false, false), meta(pool, false, true),
        meta(vault, false, true), meta(adminAta.address, false, true), meta(demoMint, false, false), meta(TOKEN_PROGRAM_ID, false, false),
      ],
      data: Buffer.concat([disc("fund_pool"), Buffer.from([assetId]), u64(need)]),
    })]);
  }

  // 6) SOL for publisher (keeper fees) + trial budget (§19)
  for (const [label, dest, target] of [
    ["publisher", publisher.publicKey, PUBLISHER_SOL],
    ["trial budget", trialBudget.publicKey, TRIAL_BUDGET_SOL],
  ]) {
    const bal = (await conn.getBalance(dest)) / LAMPORTS_PER_SOL;
    if (bal >= target) {
      console.log(`  ${label} funded (${bal.toFixed(3)} SOL)`);
      continue;
    }
    const topUp = Math.ceil((target - bal) * LAMPORTS_PER_SOL);
    await send(`fund ${label} +${(topUp / LAMPORTS_PER_SOL).toFixed(2)} SOL`, [
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: dest, lamports: topUp }),
    ]);
  }

  console.log(`\nDEVNET SETUP COMPLETE ✅`);
  console.log(`  program:     ${PROGRAM_ID.toBase58()}`);
  console.log(`  demo mint:   ${demoMint.toBase58()}`);
  console.log(`  quote auth:  ${quoteAuthority.publicKey.toBase58()}`);
  console.log(`  publisher:   ${publisher.publicKey.toBase58()}`);
  console.log(`  trial fund:  ${trialBudget.publicKey.toBase58()}`);
  console.log(`  admin left:  ${((await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
}

main().catch((e) => { console.error("\nSETUP FAILED ❌", e.message || e); process.exit(1); });
