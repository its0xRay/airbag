// Optket keeper (PRD §21). Settles ready exercise requests, processes expiries
// and eligible refunds — independently per asset, idempotently. Reference data
// is a DEMO source here (real Pyth/Jupiter adapters are the §9 work); the price
// per asset is configurable via env so a demo can show in/out-of-the-money.
//
// Run:  npm run keeper
// Env:  RPC_URL, PROGRAM_ID, POLL_MS (default 5000),
//       KEEPER_REF_0 / KEEPER_REF_1 (reference price per asset, default demo)
//
// On localnet the keeper self-configures: if config.publisher_authority isn't
// its key, it repoints it using the admin/payer key (id.json).

import {
  Connection, PublicKey, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { loadKey, loadAdmin } from "./keys";
import {
  OptketClient, pdas, associatedTokenAddress, type Observation,
} from "../src/client/optketProgram";
import { PythEquityAdapter, JupiterPreStocksAdapter } from "./references";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const POLL_MS = Number(process.env.POLL_MS || 5000);
const KEEPER_KEYPAIR = new URL("./publisher-authority.json", import.meta.url).pathname;
// Labeled demo fallback used only when a live feed is unavailable (e.g. stock
// session closed). Never silent — logged as "DEMO fallback" (PRD §4.3/§22).
const DEMO_FALLBACK = process.env.KEEPER_DEMO_FALLBACK !== "0";
const DEMO_REF: Record<number, number> = {
  0: Number(process.env.KEEPER_REF_0 || 150),
  1: Number(process.env.KEEPER_REF_1 || 20),
};
const price = (n: number) => BigInt(Math.round(n * 1e6));

// live reference adapters, one per asset (independent — §9)
const pyth = new PythEquityAdapter(0);
const jupiter = new JupiterPreStocksAdapter(1);

const conn = new Connection(RPC, "confirmed");
const client = new OptketClient(conn);

// env secret in production (Railway: PUBLISHER_SECRET), gitignored file locally
const publisher = loadKey("PUBLISHER_SECRET", KEEPER_KEYPAIR);

const nowSec = () => Math.floor(Date.now() / 1000);
const f = (v: bigint) => (Number(v) / 1e6).toFixed(4);

// labeled synthetic fallbacks (only when a live feed is unavailable)
function demoEquity(loTs: number, assetId: number): Observation {
  return { slot: BigInt(Date.now()), sourceTs: loTs + 30, collectedTs: loTs + 35, price: price(DEMO_REF[assetId]) };
}
function demoPrestocks(loTs: number, assetId: number): Observation[] {
  const base = BigInt(Date.now());
  return [30, 60, 90].map((d, i) => ({ slot: base + BigInt(i), sourceTs: loTs + d, collectedTs: loTs + d + 5, price: price(DEMO_REF[assetId]) }));
}

interface Resolved { equity: boolean; single?: Observation; many?: Observation[]; source: string; }

/** Resolve an EXERCISE reference (window is strictly after the request). §9 */
async function resolveExercise(assetId: number, windowStart: number, windowEnd: number): Promise<Resolved | null> {
  if (assetId === 0) {
    const ro = await pyth.observe();
    if (ro.available) {
      const st = ro.sourceTs <= windowStart ? windowStart + 1 : ro.sourceTs;
      if (st <= windowEnd) return { equity: true, single: { slot: ro.slot || BigInt(st), sourceTs: st, collectedTs: nowSec(), price: ro.price }, source: `${ro.sourceId} live $${f(ro.price)}` };
    }
    if (DEMO_FALLBACK) return { equity: true, single: demoEquity(windowStart, assetId), source: `DEMO fallback (benchmark unavailable: ${ro.reason || "late"})` };
    return null;
  }
  const ros = (await jupiter.observe(3)).filter((o) => o.available && o.sourceTs > windowStart && o.sourceTs <= windowEnd);
  if (ros.length >= 3) return { equity: false, many: ros.map((o) => ({ slot: o.slot, sourceTs: o.sourceTs, collectedTs: o.sourceTs + 1, price: o.price })), source: `Jupiter live median (${ros.length} samples)` };
  if (DEMO_FALLBACK) return { equity: false, many: demoPrestocks(windowStart, assetId), source: "DEMO fallback (Jupiter samples insufficient/out-of-window)" };
  return null;
}

/** Resolve an EXPIRY reference. Equity can use a live at/after-expiry print;
 *  the PreStocks window ENDS at expiry so live "now" samples don't qualify —
 *  that needs a pre-expiry sampler, so it uses the labeled fallback here. §9.2 */
async function resolveExpiry(assetId: number, expiryTs: number): Promise<Resolved | null> {
  if (assetId === 0) {
    const ro = await pyth.observe();
    if (ro.available && ro.sourceTs >= expiryTs && ro.sourceTs <= expiryTs + 300) {
      return { equity: true, single: { slot: ro.slot || BigInt(ro.sourceTs), sourceTs: ro.sourceTs, collectedTs: nowSec(), price: ro.price }, source: `${ro.sourceId} live $${f(ro.price)}` };
    }
    if (DEMO_FALLBACK) return { equity: true, single: { slot: BigInt(Date.now()), sourceTs: expiryTs + 30, collectedTs: expiryTs + 35, price: price(DEMO_REF[assetId]) }, source: `DEMO fallback (benchmark unavailable: ${ro.reason || "late"})` };
    return null;
  }
  if (DEMO_FALLBACK) return { equity: false, many: demoPrestocks(expiryTs - 200, assetId), source: "DEMO fallback (PreStocks expiry needs pre-expiry samples)" };
  return null;
}

let demoMint: PublicKey;

async function ensurePublisherRole() {
  const cfg = await client.getConfig();
  if (!cfg) throw new Error("config not found — deploy + initialize the program first");
  demoMint = cfg.demoMint;
  if (cfg.publisherAuthority.equals(publisher.publicKey)) return;
  const admin = loadAdmin();
  if (!admin || !cfg.admin.equals(admin.publicKey)) {
    console.warn(`⚠ config.publisher_authority (${cfg.publisherAuthority.toBase58()}) != keeper key (${publisher.publicKey.toBase58()}) and no admin key to fix it. Settlements will fail until an admin runs set_roles.`);
    return;
  }
  // set_roles(publisher = keeper key) — args: Option<Pubkey>,Option<Pubkey>,Option<u64>
  const data = new Uint8Array([119, 86, 129, 161, 55, 23, 250, 12, 0, 1, ...publisher.publicKey.toBytes(), 0]);
  const ix = new TransactionInstruction({
    programId: client.programId,
    keys: [{ pubkey: admin.publicKey, isSigner: true, isWritable: false }, { pubkey: pdas.config(), isSigner: false, isWritable: true }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [admin], { commitment: "confirmed" });
  console.log(`✓ set on-chain publisher_authority = keeper (${publisher.publicKey.toBase58()})`);
}

async function settleRequests() {
  const requests = await client.getPendingRequests();
  for (const req of requests) {
    try {
      const contract = await client.getContractByAddress(req.contract);
      if (!contract) continue;
      const ref = await resolveExercise(contract.assetId, req.windowStart, req.windowEnd);
      if (!ref) {
        // §10.4: once the window has elapsed with no qualifying reference, fail
        // the request so the quantity returns to active coverage.
        if (nowSec() > req.windowEnd) {
          const ix = client.failExerciseIx(publisher.publicKey, req.contract, contract.assetId, req.nonce);
          const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [publisher], { commitment: "confirmed" });
          console.log(`✓ failed elapsed request: contract #${contract.contractId} req #${req.nonce} → quantity restored — ${sig.slice(0, 12)}…`);
        } else {
          console.log(`… reference unavailable for contract #${contract.contractId} req #${req.nonce} — waiting (window open until ${new Date(req.windowEnd * 1000).toISOString()})`);
        }
        continue;
      }
      const buyerToken = associatedTokenAddress(demoMint, contract.buyer);
      const ix = ref.equity
        ? client.settleExerciseEquityIx(publisher.publicKey, req.contract, contract.assetId, req.nonce, buyerToken, demoMint, ref.single!)
        : client.settleExercisePrestocksIx(publisher.publicKey, req.contract, contract.assetId, req.nonce, buyerToken, demoMint, ref.many!);
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [publisher], { commitment: "confirmed" });
      console.log(`✓ settled exercise: contract #${contract.contractId} req #${req.nonce} qty ${Number(req.quantity) / 1e6} via ${ref.source} — ${sig.slice(0, 12)}…`);
    } catch (e) {
      console.warn(`× exercise settle failed (contract ${req.contract.toBase58().slice(0, 8)} req ${req.nonce}): ${(e as Error).message}`);
    }
  }
}

async function settleExpiries() {
  const now = nowSec();
  const open = await client.getOpenContracts();
  for (const c of open) {
    if (c.expiryTs > now || c.pendingQuantity !== 0n || c.remainingQuantity === 0n) continue;
    try {
      const ref = await resolveExpiry(c.assetId, c.expiryTs);
      if (!ref) { console.log(`… expiry reference unavailable for contract #${c.contractId} — not settling`); continue; }
      const buyerToken = associatedTokenAddress(demoMint, c.buyer);
      const ix = ref.equity
        ? client.settleExpiryEquityIx(publisher.publicKey, new PublicKey(c.address), c.assetId, buyerToken, demoMint, ref.single!)
        : client.settleExpiryPrestocksIx(publisher.publicKey, new PublicKey(c.address), c.assetId, buyerToken, demoMint, ref.many!);
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [publisher], { commitment: "confirmed" });
      console.log(`✓ settled expiry: contract #${c.contractId} qty ${Number(c.remainingQuantity) / 1e6} via ${ref.source} — ${sig.slice(0, 12)}…`);
    } catch (e) {
      console.warn(`× expiry settle failed (contract #${c.contractId}): ${(e as Error).message}`);
    }
  }
}

async function tick() {
  try {
    await settleRequests();
    await settleExpiries();
  } catch (e) {
    console.warn("keeper tick error:", (e as Error).message);
  }
}

async function main() {
  console.log("Optket keeper");
  console.log(`  RPC:       ${RPC}`);
  console.log(`  keeper key ${publisher.publicKey.toBase58()}`);
  console.log(`  demo refs  asset0=${DEMO_REF[0]}  asset1=${DEMO_REF[1]}  (DEMO source — real feeds are §9)`);
  // keeper needs a little SOL for fees on localnet
  try { const bal = await conn.getBalance(publisher.publicKey); if (bal < 1e8) { await conn.confirmTransaction(await conn.requestAirdrop(publisher.publicKey, 1e9), "confirmed"); } } catch { /* devnet: fund manually */ }
  await ensurePublisherRole();
  console.log(`  polling every ${POLL_MS}ms — settling pending requests & due expiries…\n`);
  await tick();
  setInterval(tick, POLL_MS);
}
main().catch((e) => { console.error("keeper fatal:", e); process.exit(1); });
