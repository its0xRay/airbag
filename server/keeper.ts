// Optket keeper (PRD §21). Settles ready exercise requests, processes expiries
// and eligible refunds — independently per asset, idempotently.
//
// References are REAL (§9): a session-aware stock benchmark for the equity
// asset and a Jupiter median for the token asset. Samples are buffered
// continuously because the PreStocks expiry window ENDS at expiry and cannot be
// reconstructed after the fact. When no qualifying reference exists the keeper
// uses the program's own disclosed fallbacks — fail_exercise (§10.4) or
// expire_refund (§11.2) — and never substitutes a synthetic price (§22).
//
// Run:  npm run keeper
// Env:  RPC_URL, PROGRAM_ID, POLL_MS, EXPIRY_REFUND_GRACE_SECS,
//       KEEPER_DEMO_FALLBACK=1 (offline dev only; off by default)
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
// window rules come from the engine, which mirrors the on-chain constants
import { PRESTOCKS_WINDOW_SECS, EQUITY_MAX_DELAY_SECS } from "../src/engine/references";

// Devnet is the deployment target, so that is the default: an unset RPC_URL in
// a hosted environment used to silently point at a local validator that does
// not exist there, and the process died on `fetch failed`. Local-validator work
// sets RPC_URL explicitly.
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const POLL_MS = Number(process.env.POLL_MS || 5000);
const KEEPER_KEYPAIR = new URL("./publisher-authority.json", import.meta.url).pathname;
// Synthetic references are OFF by default. When no qualifying reference exists
// the keeper uses the program's OWN disclosed fallbacks — fail_exercise (§10.4)
// or expire_refund (§11.2) — rather than inventing a price (§22). Set
// KEEPER_DEMO_FALLBACK=1 only for offline development.
const DEMO_FALLBACK = process.env.KEEPER_DEMO_FALLBACK === "1";
const DEMO_REF: Record<number, number> = {
  0: Number(process.env.KEEPER_REF_0 || 150),
  1: Number(process.env.KEEPER_REF_1 || 20),
};
const price = (n: number) => BigInt(Math.round(n * 1e6));

/**
 * Rolling buffer of real observations per asset.
 *
 * PreStocks expiry needs a median over the five minutes ENDING at expiry
 * (§9.2), so those samples must already have been collected when expiry
 * arrives — you cannot go back and fetch them. The keeper therefore samples
 * continuously and keeps a short history.
 */
const EXPIRY_REFUND_GRACE_SECS = Number(process.env.EXPIRY_REFUND_GRACE_SECS || 300);
const SAMPLE_RETENTION_SECS = 900;
const sampleBuffer: Record<number, Observation[]> = { 0: [], 1: [] };

async function collectSamples() {
  const t = nowSec();
  try {
    const eq = await pyth.observe();
    if (eq.available) {
      sampleBuffer[0].push({ slot: eq.slot || BigInt(t), sourceTs: eq.sourceTs, collectedTs: t, price: eq.price });
    }
  } catch { /* transient */ }
  try {
    const [jup] = await jupiter.observe(1);
    if (jup?.available) {
      sampleBuffer[1].push({ slot: jup.slot, sourceTs: jup.sourceTs, collectedTs: t, price: jup.price });
    }
  } catch { /* transient */ }
  for (const k of [0, 1]) {
    sampleBuffer[k] = sampleBuffer[k].filter((o) => t - o.sourceTs <= SAMPLE_RETENTION_SECS);
  }
}

/** Buffered samples inside [lo, hi], de-duplicated and strictly slot-ordered. */
function windowSamples(assetId: number, lo: number, hi: number): Observation[] {
  const inWindow = sampleBuffer[assetId]
    .filter((o) => o.sourceTs >= lo && o.sourceTs <= hi && o.collectedTs - o.sourceTs <= 60)
    .sort((a, b) => a.sourceTs - b.sourceTs || Number(a.slot - b.slot));
  const out: Observation[] = [];
  let prevSlot = -1n;
  for (const o of inWindow) {
    if (o.slot <= prevSlot) continue; // slots must strictly increase (§9.2)
    out.push(o);
    prevSlot = o.slot;
  }
  return out.slice(0, 8);
}

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

/**
 * Resolve an EXPIRY reference (§9). Equity takes the first qualifying print at
 * or after expiry; PreStocks takes the median of buffered samples from the five
 * minutes ENDING at expiry. If neither qualifies we return null and the caller
 * applies the program's disclosed refund — we never invent a price.
 */
async function resolveExpiry(assetId: number, expiryTs: number): Promise<Resolved | null> {
  if (assetId === 0) {
    const ro = await pyth.observe();
    if (ro.available) {
      const st = Math.max(ro.sourceTs, expiryTs); // must be at/after expiry
      if (st <= expiryTs + EQUITY_MAX_DELAY_SECS) {
        return {
          equity: true,
          single: { slot: ro.slot || BigInt(st), sourceTs: st, collectedTs: nowSec(), price: ro.price },
          source: `${ro.sourceId} live $${f(ro.price)}`,
        };
      }
    }
    if (DEMO_FALLBACK) return { equity: true, single: { slot: BigInt(Date.now()), sourceTs: expiryTs + 30, collectedTs: expiryTs + 35, price: price(DEMO_REF[assetId]) }, source: `DEMO fallback (${ro.reason || "late"})` };
    return null;
  }
  const buffered = windowSamples(1, expiryTs - PRESTOCKS_WINDOW_SECS, expiryTs);
  if (buffered.length >= 3) {
    return { equity: false, many: buffered, source: `Jupiter buffered median (${buffered.length} samples in window)` };
  }
  if (DEMO_FALLBACK) return { equity: false, many: demoPrestocks(expiryTs - 200, assetId), source: "DEMO fallback (insufficient buffered samples)" };
  return null;
}

let demoMint: PublicKey;

/** A misconfiguration no amount of retrying will fix — fail fast, don't poll. */
class ConfigError extends Error {}

async function ensurePublisherRole() {
  const cfg = await client.getConfig();
  if (!cfg) throw new ConfigError("config not found — deploy + initialize the program first");
  demoMint = cfg.demoMint;
  if (cfg.publisherAuthority.equals(publisher.publicKey)) return;
  const admin = loadAdmin();
  if (!admin || !cfg.admin.equals(admin.publicKey)) {
    // Every settlement this process could attempt would be rejected by the
    // program, so staying up would only look healthy while doing nothing.
    throw new ConfigError(
      `keeper key ${publisher.publicKey.toBase58()} is not the on-chain publisher ` +
      `authority (${cfg.publisherAuthority.toBase58()}) and there is no admin key to ` +
      `repoint it. Set PUBLISHER_SECRET to the publisher keypair from ` +
      `DEPLOY-SECRETS.local.md, or have an admin run set_roles.`,
    );
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
      const buyerToken = associatedTokenAddress(demoMint, c.buyer);
      const ref = await resolveExpiry(c.assetId, c.expiryTs);
      if (!ref) {
        // §11.1/§11.2: an invalid expiry reference means the disclosed demo
        // refund, not a made-up settlement. Allow a grace period first in case
        // a qualifying observation still arrives.
        if (now > c.expiryTs + EXPIRY_REFUND_GRACE_SECS) {
          const ix = client.expireRefundIx(publisher.publicKey, new PublicKey(c.address), c.assetId, buyerToken, demoMint);
          const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [publisher], { commitment: "confirmed" });
          console.log(`✓ refunded contract #${c.contractId} — no qualifying expiry reference (§11.2) — ${sig.slice(0, 12)}…`);
        } else {
          console.log(`… expiry reference not yet available for contract #${c.contractId} — waiting before refund`);
        }
        continue;
      }
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
    await collectSamples();   // keep the expiry window populated with real data
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
  console.log(`  references live (Pyth session + Jupiter); synthetic fallback ${DEMO_FALLBACK ? "ENABLED (dev only)" : "disabled"}`);
  // keeper needs a little SOL for fees on localnet
  try { const bal = await conn.getBalance(publisher.publicKey); if (bal < 1e8) { await conn.confirmTransaction(await conn.requestAirdrop(publisher.publicKey, 1e9), "confirmed"); } } catch { /* devnet: fund manually */ }
  // A hosted keeper must survive an RPC blip at boot rather than exiting: the
  // tick loop already tolerates transient errors, so startup should too.
  for (let attempt = 1; ; attempt++) {
    try {
      await ensurePublisherRole();
      break;
    } catch (e) {
      if (e instanceof ConfigError || attempt >= 10) throw e;
      const wait = Math.min(30_000, 2_000 * attempt);
      console.warn(`startup attempt ${attempt} failed (${(e as Error).message}); retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  console.log(`  polling every ${POLL_MS}ms — settling pending requests & due expiries…\n`);
  await tick();
  setInterval(tick, POLL_MS);
}
main().catch((e) => { console.error("keeper fatal:", e); process.exit(1); });
