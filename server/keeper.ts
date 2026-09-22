import { ACTIVE_REFERENCE_VERSION, referenceKind } from "../src/data/referencePolicy";
import { loadObservations, saveObservations, pruneObservations, type ObservationScope } from "./observationStore";
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
// Env:  RPC_URL, PROGRAM_ID, POLL_MS, EXPIRY_REFUND_GRACE_SECS
//
// On localnet the keeper self-configures: if config.publisher_authority isn't
// its key, it repoints it using the admin/payer key (id.json).

import {
  Connection, PublicKey, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createServer } from "node:http";
import { loadKey, loadAdmin } from "./keys";
import {
  OptketClient, pdas, associatedTokenAddress, type Observation,
} from "../src/client/optketProgram";
import { PythEquityAdapter, JupiterPreStocksAdapter, createNvdaTokenReference } from "./references";
// window rules come from the engine, which mirrors the on-chain constants
import {
  PRESTOCKS_WINDOW_SECS,
  EQUITY_MAX_DELAY_SECS,
  EQUITY_MAX_SAMPLE_AGE_SECS,
} from "../src/engine/references";

// Devnet is the deployment target, so that is the default: an unset RPC_URL in
// a hosted environment used to silently point at a local validator that does
// not exist there, and the process died on `fetch failed`. Local-validator work
// sets RPC_URL explicitly.
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const POLL_MS = Number(process.env.POLL_MS || 5000);
const KEEPER_KEYPAIR = new URL("./publisher-authority.json", import.meta.url).pathname;
/**
 * Rolling buffer of real observations per asset.
 *
 * PreStocks expiry needs a median over the five minutes ENDING at expiry
 * (§9.2), so those samples must already have been collected when expiry
 * arrives — you cannot go back and fetch them. The keeper therefore samples
 * continuously and keeps a short history.
 */
const EXPIRY_REFUND_GRACE_SECS = Number(process.env.EXPIRY_REFUND_GRACE_SECS || 300);
const STATE_PATH = process.env.KEEPER_STATE_PATH;
let observationScope: ObservationScope | null = null;
let sampleBuffer: Record<number, Observation[]> = { 0: [], 1: [] };
const keeperStatus = {
  ready: false,
  lastTickAt: 0,
  lastSuccessfulTickAt: 0,
  lastError: null as string | null,
  pendingRequests: 0,
  dueExpiries: 0,
  persistenceEnabled: Boolean(STATE_PATH),
  lastPersistedAt: 0,
  settlementErrors: 0,
  lastSettlement: null as null | { signature: string; action: string; at: number },
};

async function collectSamples() {
  await Promise.allSettled([ (async () => {
    const [token] = await nvdaToken.observe(1);
    if (token?.available) sampleBuffer[0].push({
      slot: token.slot, sourceTs: token.sourceTs, collectedTs: nowSec(), price: token.price,
    });
  })(), (async () => {
    const [jup] = await jupiter.observe(1);
    if (jup?.available) {
      // Jupiter's blockId identifies the last upstream price update, so it can
      // remain unchanged across several honest snapshots when the market is
      // quiet.  The program accepts a Solana slot as the observation sequence;
      // bind each real API snapshot to the confirmed slot at which the keeper
      // observed it.  This preserves strict ordering without fabricating a
      // price or pretending that Jupiter published a new update.
      const observedSlot = BigInt(await conn.getSlot("confirmed"));
      sampleBuffer[1].push({ slot: observedSlot, sourceTs: jup.sourceTs, collectedTs: nowSec(), price: jup.price });
    }
  })() ]);
  sampleBuffer = pruneObservations(sampleBuffer, nowSec());
  if (STATE_PATH && observationScope) {
    saveObservations(STATE_PATH, observationScope, sampleBuffer, nowSec());
    keeperStatus.lastPersistedAt = nowSec();
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
const nvdaToken = createNvdaTokenReference();

const conn = new Connection(RPC, "confirmed");
const client = new OptketClient(conn);

// env secret in production (Railway: PUBLISHER_SECRET), gitignored file locally
const publisher = loadKey("PUBLISHER_SECRET", KEEPER_KEYPAIR);

const nowSec = () => Math.floor(Date.now() / 1000);
const f = (v: bigint) => (Number(v) / 1e6).toFixed(4);

interface Resolved { equity: boolean; single?: Observation; many?: Observation[]; source: string; }

/** Resolve an EXERCISE reference (window is strictly after the request). §9 */
async function resolveExercise(assetId: number, version: number, windowStart: number, windowEnd: number): Promise<Resolved | null> {
  if (referenceKind(assetId, version) === "Equity") {
    const ro = await pyth.observe();
    const collectedTs = nowSec();
    if (ro.available && ro.sourceTs > windowStart && ro.sourceTs <= windowEnd
      && collectedTs >= ro.sourceTs && collectedTs - ro.sourceTs <= EQUITY_MAX_SAMPLE_AGE_SECS) {
      return { equity: true, single: { slot: ro.slot, sourceTs: ro.sourceTs, collectedTs, price: ro.price }, source: `${ro.sourceId} live $${f(ro.price)}` };
    }
    return null;
  }
  // Use snapshots accumulated by the polling loop. Calling observe(3) here
  // required three distinct upstream blockIds inside one short request, which
  // unnecessarily stalled settlement whenever a valid price stayed flat.
  // Buffered snapshots are still real Jupiter responses and are sequenced by
  // their confirmed Solana observation slots.
  const ros = windowSamples(assetId, windowStart + 1, windowEnd);
  if (ros.length >= 3) return { equity: false, many: ros, source: `Jupiter observed median (${ros.length} snapshots)` };
  return null;
}

/**
 * Resolve an EXPIRY reference (§9). Equity takes the first qualifying print at
 * or after expiry; PreStocks takes the median of buffered samples from the five
 * minutes ENDING at expiry. If neither qualifies we return null and the caller
 * applies the program's disclosed refund — we never invent a price.
 */
async function resolveExpiry(assetId: number, version: number, expiryTs: number): Promise<Resolved | null> {
  if (referenceKind(assetId, version) === "Equity") {
    const ro = await pyth.observe();
    const collectedTs = nowSec();
    if (ro.available && ro.sourceTs >= expiryTs
      && ro.sourceTs <= expiryTs + EQUITY_MAX_DELAY_SECS
      && collectedTs >= ro.sourceTs && collectedTs - ro.sourceTs <= EQUITY_MAX_SAMPLE_AGE_SECS) {
        return {
          equity: true,
          single: { slot: ro.slot, sourceTs: ro.sourceTs, collectedTs, price: ro.price },
          source: `${ro.sourceId} live $${f(ro.price)}`,
        };
    }
    return null;
  }
  const buffered = windowSamples(assetId, expiryTs - PRESTOCKS_WINDOW_SECS, expiryTs);
  if (buffered.length >= 3) {
    return { equity: false, many: buffered, source: `Jupiter buffered median (${buffered.length} samples in window)` };
  }
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
  keeperStatus.pendingRequests = requests.length;
  for (const req of requests) {
    try {
      const contract = await client.getContractByAddress(req.contract);
      if (!contract) continue;
      const ref = await resolveExercise(contract.assetId, contract.referenceVersion, req.windowStart, req.windowEnd);
      if (!ref) {
        // §10.4: once the window has elapsed with no qualifying reference, fail
        // the request so the quantity returns to active coverage.
        if (nowSec() > req.windowEnd) {
          const ix = client.failExerciseIx(publisher.publicKey, req.contract, contract.assetId, req.nonce);
          const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [publisher], { commitment: "confirmed" });
          keeperStatus.lastSettlement = { signature: sig, action: "exercise reference failed", at: nowSec() };
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
      keeperStatus.lastSettlement = { signature: sig, action: "exercise settled", at: nowSec() };
      console.log(`✓ settled exercise: contract #${contract.contractId} req #${req.nonce} qty ${Number(req.quantity) / 1e6} via ${ref.source} — ${sig.slice(0, 12)}…`);
    } catch (e) {
      keeperStatus.settlementErrors++;
      console.warn(`× exercise settle failed (contract ${req.contract.toBase58().slice(0, 8)} req ${req.nonce}): ${(e as Error).message}`);
    }
  }
}

async function settleExpiries() {
  const now = nowSec();
  const open = await client.getOpenContracts();
  keeperStatus.dueExpiries = open.filter((c) => c.expiryTs <= now && c.pendingQuantity === 0n && c.remainingQuantity > 0n).length;
  for (const c of open) {
    if (c.expiryTs > now || c.pendingQuantity !== 0n || c.remainingQuantity === 0n) continue;
    try {
      const buyerToken = associatedTokenAddress(demoMint, c.buyer);
      const ref = await resolveExpiry(c.assetId, c.referenceVersion, c.expiryTs);
      if (!ref) {
        // §11.1/§11.2: an invalid expiry reference means the disclosed demo
        // refund, not a made-up settlement. Allow a grace period first in case
        // a qualifying observation still arrives.
        if (now > c.expiryTs + EXPIRY_REFUND_GRACE_SECS) {
          const ix = client.expireRefundIx(publisher.publicKey, new PublicKey(c.address), c.assetId, buyerToken, demoMint);
          const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [publisher], { commitment: "confirmed" });
          keeperStatus.lastSettlement = { signature: sig, action: "expiry refunded", at: nowSec() };
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
      keeperStatus.lastSettlement = { signature: sig, action: "expiry settled", at: nowSec() };
      console.log(`✓ settled expiry: contract #${c.contractId} qty ${Number(c.remainingQuantity) / 1e6} via ${ref.source} — ${sig.slice(0, 12)}…`);
    } catch (e) {
      keeperStatus.settlementErrors++;
      console.warn(`× expiry settle failed (contract #${c.contractId}): ${(e as Error).message}`);
    }
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  keeperStatus.lastTickAt = nowSec();
  keeperStatus.settlementErrors = 0;
  try {
    await collectSamples();   // keep the expiry window populated with real data
    await settleRequests();
    await settleExpiries();
    keeperStatus.lastSuccessfulTickAt = nowSec();
    keeperStatus.lastError = keeperStatus.settlementErrors ? "Some settlements failed; retrying" : null;
  } catch (error) {
    keeperStatus.lastError = "Keeper tick failed; inspect service logs";
    console.warn("keeper tick error:", String(error).replace(/https?:\/\/\S+/g, "[endpoint]"));
  } finally {
    ticking = false;
  }
}

function startHealthServer() {
  const port = Number(process.env.PORT || 8080);
  createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    const age = keeperStatus.lastSuccessfulTickAt ? nowSec() - keeperStatus.lastSuccessfulTickAt : null;
    const referenceAges = [0, 1].map(asset => sampleBuffer[asset].length
      ? nowSec() - Math.max(...sampleBuffer[asset].map(o => o.sourceTs)) : null);
    const healthy = keeperStatus.ready && !keeperStatus.lastError && age !== null
      && age <= Math.max(60, Math.ceil(POLL_MS / 1000) * 4)
      && referenceAges.every(age => age !== null && age <= 60);
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({
      ok: healthy,
      ...keeperStatus,
      lastSuccessfulTickAgeSeconds: age,
      samples: { nvdaToken: sampleBuffer[0].length, prestocks: sampleBuffer[1].length },
      referenceAgeSeconds: { nvdaToken: referenceAges[0], prestocks: referenceAges[1] },
      publisher: publisher.publicKey.toBase58(),
    }));
  }).listen(port, () => console.log(`  health:    :${port}/health`));
}

async function main() {
  console.log("Optket keeper");
  console.log(`  RPC host:  ${new URL(RPC).hostname}`);
  console.log(`  keeper key ${publisher.publicKey.toBase58()}`);
  console.log("  references live (Pyth session + Jupiter); no synthetic reference path");
  startHealthServer();
  if (!STATE_PATH) console.warn("KEEPER_STATE_PATH unset: observations will not survive a restart. Mount a persistent volume before enabling restart recovery.");
  // keeper needs a little SOL for fees on localnet
  try { const bal = await conn.getBalance(publisher.publicKey); if (bal < 1e8) { await conn.confirmTransaction(await conn.requestAirdrop(publisher.publicKey, 1e9), "confirmed"); } } catch { /* devnet: fund manually */ }
  // A hosted keeper must survive an RPC blip at boot rather than exiting: the
  // tick loop already tolerates transient errors, so startup should too.
  for (let attempt = 1; ; attempt++) {
    try {
      await ensurePublisherRole();
      observationScope = { genesisHash: await conn.getGenesisHash(), program: client.programId.toBase58(),
        publisher: publisher.publicKey.toBase58(), versions: ACTIVE_REFERENCE_VERSION };
      if (STATE_PATH) {
        try { sampleBuffer = loadObservations(STATE_PATH, observationScope, nowSec()); }
        catch { throw new ConfigError("Cannot restore keeper observations. Inspect the persisted snapshot and its network/reference scope; original file has not been changed."); }
      }
      break;
    } catch (e) {
      if (e instanceof ConfigError || attempt >= 10) throw e;
      const wait = Math.min(30_000, 2_000 * attempt);
      console.warn(`startup attempt ${attempt} failed (${(e as Error).message}); retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  console.log(`  polling every ${POLL_MS}ms — settling pending requests & due expiries…\n`);
  keeperStatus.ready = true;
  await tick();
  setInterval(tick, POLL_MS);
}
main().catch((e) => { console.error("keeper fatal:", e); process.exit(1); });
