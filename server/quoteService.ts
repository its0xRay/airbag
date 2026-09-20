// Optket quote-signing service (PRD §8) + real market-data proxy (§4/§13/§15)
// + trial-budget faucet (§19).
//
// Hosted deployment (Railway/Render): all keys come from env secrets, the RPC
// from RPC_URL, and the port from PORT. Locally it falls back to gitignored
// key files and localnet defaults. Endpoints:
//   GET  /health           service + config status
//   GET  /config           program id, demo mint, quote authority
//   GET  /assets           verified real asset registry (§4)
//   GET  /market?mint=     live Jupiter price + benchmark + scaled multiplier
//   GET  /reference?assetId= qualifying live price used for quote issuance
//   GET  /holdings?owner=&mint=   real mainnet holdings (scaled)
//   GET  /series?assetId=&seriesId=   on-chain series terms
//   GET  /trial/status     trial budget status (§19)
//   POST /quote            signed premium quote (60s validity, replay-protected)
//   POST /faucet           idempotent demo-token top-up (fees stay sponsored)

import { createServer, type ServerResponse } from "node:http";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { getOrCreateAssociatedTokenAccount, mintTo, getMint } from "@solana/spl-token";
import nacl from "tweetnacl";
import { serializeQuotePayload, QUOTE_VALIDITY_SECS } from "../src/engine/quote";
import { quotePremium } from "../src/engine/pricing";
import { fromFixed } from "../src/engine/fixed";
import { EQUITY_MAX_SAMPLE_AGE_SECS } from "../src/engine/references";
import type { QuotePayload } from "../src/engine/types";
import { TrialBudget, trialConfigFromEnv } from "./trialBudget";
import { VERIFIED_ASSETS } from "../src/data/assets";
import { loadKey, loadAdmin } from "./keys";
import { JupiterPreStocksAdapter, PythEquityAdapter } from "./references";

// See the note in keeper.ts: devnet is the default so an unset RPC_URL in a
// hosted environment cannot point the service at a nonexistent local validator.
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
const PORT = Number(process.env.PORT || 8787);
const MAINNET_RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const JUP_API = process.env.JUP_PRICE_API || "https://lite-api.jup.ag/price/v3";

const conn = new Connection(RPC_URL, "confirmed");
const mainnet = new Connection(MAINNET_RPC, "confirmed");
const equityReference = new PythEquityAdapter(0);
const prestocksReference = new JupiterPreStocksAdapter(1);

// ---- keys (env secrets in production, gitignored files locally) ----
const dir = new URL(".", import.meta.url).pathname;
const quoteAuthority = loadKey("QUOTE_AUTHORITY_SECRET", `${dir}quote-authority.json`);
const payer: Keypair | null = loadAdmin(); // demo-mint authority; funds token faucet
const trialStatePath = process.env.TRIAL_STATE_PATH || `${dir}trial-budget-state.json`;
if (process.env.RAILWAY_ENVIRONMENT && !process.env.TRIAL_STATE_PATH) {
  throw new Error("TRIAL_STATE_PATH must point to a Railway volume so sponsorship limits survive restarts");
}
const trialBudget = new TrialBudget(conn, trialConfigFromEnv(), `${dir}trial-budget.json`, trialStatePath);

// ---- replay guard: quote ids unique across restarts ----
const usedQuoteIds = new Set<string>();
let quoteCounter = BigInt(Date.now());

// ---- small utils ----
const nowSec = () => Math.floor(Date.now() / 1000);

/** fetch with a hard timeout so a dead upstream can't hang requests. */
async function fetchT(url: string, ms = 8000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- on-chain reads ----
const CONFIG_PDA = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];

async function demoMint(): Promise<PublicKey> {
  const info = await conn.getAccountInfo(CONFIG_PDA);
  if (!info) throw new Error("program config not found on-chain — run the setup script first");
  return new PublicKey((info.data as Buffer).subarray(104, 136)); // disc8+admin32+quote32+pub32
}

const seriesPda = (assetId: number, seriesId: number) => {
  const sid = Buffer.alloc(2);
  sid.writeUInt16LE(seriesId);
  return PublicKey.findProgramAddressSync([Buffer.from("series"), Buffer.from([assetId]), sid], PROGRAM_ID)[0];
};

interface SeriesTerms {
  assetId: number; seriesId: number; strike: bigint; expiryTs: number;
  purchaseCutoffTs: number; exerciseCutoffTs: number; maxContractSize: bigint;
  referenceVersion: number; active: boolean;
}

function decodeSeries(data: Buffer): SeriesTerms {
  let o = 8;
  const assetId = data.readUInt8(o); o += 1;
  const seriesId = data.readUInt16LE(o); o += 2;
  const strike = data.readBigUInt64LE(o); o += 8;
  const expiryTs = Number(data.readBigInt64LE(o)); o += 8;
  const purchaseCutoffTs = Number(data.readBigInt64LE(o)); o += 8;
  const exerciseCutoffTs = Number(data.readBigInt64LE(o)); o += 8;
  const maxContractSize = data.readBigUInt64LE(o); o += 8;
  const referenceVersion = data.readUInt32LE(o); o += 4;
  const active = data.readUInt8(o) === 1;
  return { assetId, seriesId, strike, expiryTs, purchaseCutoffTs, exerciseCutoffTs, maxContractSize, referenceVersion, active };
}

async function fetchSeries(assetId: number, seriesId: number): Promise<SeriesTerms> {
  const info = await conn.getAccountInfo(seriesPda(assetId, seriesId));
  if (!info) throw new Error(`series ${assetId}:${seriesId} not found on-chain`);
  return decodeSeries(info.data as Buffer);
}

// ---- real market data (§4/§15) ----
async function scaledMultiplier(mint: string): Promise<number> {
  try {
    const info = await mainnet.getParsedAccountInfo(new PublicKey(mint));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exts = (info.value?.data as any)?.parsed?.info?.extensions || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = exts.find((e: any) => e.extension === "scaledUiAmountConfig");
    return s ? Number(s.state.multiplier) : 1;
  } catch {
    return 1; // degraded, not fatal — multiplier snapshot exists in the registry
  }
}

async function marketData(mint: string) {
  let row: Record<string, unknown> | null = null;
  try {
    const r = await fetchT(`${JUP_API}?ids=${mint}`);
    if (r.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      row = ((await r.json()) as Record<string, any>)[mint] ?? null;
    }
  } catch { /* upstream down — report unavailable below */ }
  const multiplier = await scaledMultiplier(mint);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRow = row as any;
  return {
    mint,
    usdPrice: anyRow?.usdPrice ?? null,
    benchmark: anyRow?.stockData?.price ?? null,
    liquidity: anyRow?.liquidity ?? null,
    priceChange24h: anyRow?.priceChange24h ?? null,
    updatedAt: anyRow?.stockData?.updatedAt ?? anyRow?.createdAt ?? null,
    decimals: anyRow?.decimals ?? null,
    blockId: anyRow?.blockId ?? null,
    scaledMultiplier: multiplier,
    available: anyRow?.usdPrice != null,
  };
}

class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) { super(message); }
}

/** Live spot for premium pricing (§8.3): equity uses the stock benchmark,
 *  PreStocks uses the token market. Quote issuance fails closed when the live
 *  reference is unavailable. */
type ReferenceStatus =
  | { available: true; assetId: number; spot: bigint; source: string }
  | {
      available: false;
      assetId: number;
      status: "session_closed" | "stale" | "source_unavailable";
      reason: string;
      nextOpen?: number;
    };

async function referenceStatus(assetId: number): Promise<ReferenceStatus> {
  const asset = VERIFIED_ASSETS[assetId];
  if (!asset) throw new ServiceError("unknown asset", 404);

  if (asset.kind === "EquityToken") {
    const observation = await equityReference.observe();
    const collectedTs = nowSec();
    if (observation.available && observation.price > 0n
      && observation.sourceTs <= collectedTs
      && collectedTs - observation.sourceTs <= EQUITY_MAX_SAMPLE_AGE_SECS) {
      return { available: true, assetId, spot: observation.price, source: observation.sourceId };
    }
    if (observation.reason?.startsWith("stock session closed")) {
      return {
        available: false,
        assetId,
        status: "session_closed",
        reason: "The supported equity session is closed.",
        nextOpen: observation.nextOpen,
      };
    }
    if (observation.available) {
      return {
        available: false,
        assetId,
        status: "stale",
        reason: "The latest benchmark observation is too old for an executable quote.",
      };
    }
  } else {
    const observation = (await prestocksReference.observe(1))[0];
    if (observation?.available && observation.price > 0n) {
      return { available: true, assetId, spot: observation.price, source: observation.sourceId };
    }
  }
  return {
    available: false,
    assetId,
    status: "source_unavailable",
    reason: "No fresh qualifying reference is available. New quotes are paused.",
  };
}

// ---- signed quotes (§8) ----
async function buildSignedQuote(buyer: string, assetId: number, seriesId: number, quantity: bigint) {
  const s = await fetchSeries(assetId, seriesId);
  if (!s.active) throw new Error("series is not active");
  if (quantity <= 0n) throw new Error("quantity must be positive");
  if (quantity > s.maxContractSize) throw new Error("quantity exceeds max contract size");

  const now = nowSec();
  if (now > s.purchaseCutoffTs) throw new Error("purchase window has closed");

  const reference = await referenceStatus(assetId);
  if (!reference.available) {
    throw new ServiceError(
      reference.reason,
      503,
      reference.status,
      reference.nextOpen ? { nextOpen: reference.nextOpen } : undefined,
    );
  }
  const { spot, source } = reference;
  const { premium } = quotePremium(assetId, quantity, s.strike, spot, s.expiryTs - now);

  const quoteId = quoteCounter++;
  const quote: QuotePayload = {
    buyer, assetId, seriesId, quantity, strike: s.strike, expiryTs: s.expiryTs,
    referenceVersion: s.referenceVersion, premium, fees: 0n, quoteId,
    quoteExpiryTs: now + QUOTE_VALIDITY_SECS,
  };

  const message = serializeQuotePayload(quote, new PublicKey(buyer).toBytes());
  const signature = nacl.sign.detached(message, quoteAuthority.secretKey);
  usedQuoteIds.add(quoteId.toString());

  return {
    quote: {
      buyer, assetId, seriesId, quantity: quantity.toString(), strike: s.strike.toString(),
      expiryTs: s.expiryTs, referenceVersion: s.referenceVersion, premium: premium.toString(),
      fees: "0", quoteId: quoteId.toString(), quoteExpiryTs: quote.quoteExpiryTs,
    },
    message: Buffer.from(message).toString("base64"),
    signature: Buffer.from(signature).toString("base64"),
    quoteAuthority: quoteAuthority.publicKey.toBase58(),
    premiumTokens: fromFixed(premium),
    spot: fromFixed(spot),
    spotSource: source,
  };
}

// ---- faucet (§19): idempotent demo-token top-up; SOL stays sponsor-owned ----
async function faucet(address: string) {
  const dest = new PublicKey(address); // throws on bad input → 400

  let tokensMinted = 0;
  let tokenBalance = 0;
  let tokenError: string | undefined;
  if (payer) {
    try {
      const mint = await demoMint();
      const m = await getMint(conn, mint);
      const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, dest);
      const scale = 10n ** BigInt(m.decimals);
      const target = 20_000n * scale;
      const current = ata.amount;
      const delta = current < target ? target - current : 0n;
      if (delta > 0n) await mintTo(conn, payer, mint, ata.address, payer, delta);
      tokensMinted = Number(delta) / Number(scale);
      tokenBalance = Number(current + delta) / Number(scale);
    } catch (e) {
      tokenError = `token mint failed: ${(e as Error).message}`;
    }
  } else {
    tokenError = "token faucet unavailable (no ADMIN_SECRET)";
  }

  return { grantedSol: 0, reason: "fees and rent are sponsored", tokensMinted, tokenBalance, tokenError };
}

// ---- short-dated Devnet series rotation ----
// Keep one genuine, fully collateralized short-dated series per asset alive so
// the complete lifecycle can be exercised without waiting a week. These use the
// same quote, purchase and settlement paths as every other series.
const SHORT_ID_MIN = 9;
const SHORT_ID_MAX = 108;
const SHORT_MINUTES = Number(process.env.SHORT_SERIES_MINUTES || 45);
const SHORT_STRIKES: Record<number, { strike: number; maxSize: number }> = {
  0: { strike: Number(process.env.SHORT_STRIKE_0 || 230), maxSize: 100 },
  1: { strike: Number(process.env.SHORT_STRIKE_1 || 1050), maxSize: 20 },
};
const fx = (n: number) => BigInt(Math.round(n * 1e6));

function createSeriesIx(assetId: number, seriesId: number, strike: number, maxSize: number, expiry: number) {
  const d = createHash("sha256").update("global:create_series").digest().subarray(0, 8);
  const u16b = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u64b = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
  const i64b = (v: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
  const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
  const asset = PublicKey.findProgramAddressSync([Buffer.from("asset"), Buffer.from([assetId])], PROGRAM_ID)[0];
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(payer!.publicKey, true, true), meta(CONFIG_PDA, false, false), meta(asset, false, false),
      meta(seriesPda(assetId, seriesId), false, true), meta(SystemProgram.programId, false, false)],
    data: Buffer.concat([d, Buffer.from([assetId]), u16b(seriesId), u64b(fx(strike)), i64b(expiry),
      i64b(expiry - 300), i64b(expiry - 180), u64b(fx(maxSize))]),
  });
}

async function rotateShortSeries() {
  if (!payer) return;
  try {
    const t = nowSec();
    const ids = Array.from({ length: SHORT_ID_MAX - SHORT_ID_MIN + 1 }, (_, i) => SHORT_ID_MIN + i);
    // one batch at a time (getMultipleAccounts caps at 100 keys)
    let liveId: number | null = null;
    let freeId: number | null = null;
    for (let i = 0; i < ids.length && liveId === null && freeId === null; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const infos = await conn.getMultipleAccountsInfo(chunk.map((id) => seriesPda(0, id)));
      for (let k = 0; k < chunk.length; k++) {
        const info = infos[k];
        if (!info) { freeId = chunk[k]; break; }
        const expiryTs = Number((info.data as Buffer).readBigInt64LE(19));
        if (expiryTs > t + 240) { liveId = chunk[k]; break; } // still usable
      }
    }
    if (liveId !== null || freeId === null) return;
    const expiry = t + SHORT_MINUTES * 60;
    for (const assetId of [0, 1]) {
      const cfgS = SHORT_STRIKES[assetId];
      const tx = new Transaction().add(createSeriesIx(assetId, freeId, cfgS.strike, cfgS.maxSize, expiry));
      await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
    }
    console.log(`[rotate] published short-dated series id ${freeId} (${SHORT_MINUTES}m) for both assets`);
  } catch (e) {
    console.warn("[rotate] failed:", (e as Error).message);
  }
}

// ---- fee sponsorship (§19) ----
// The budget wallet co-signs as fee payer and funds the exact rent a new
// account needs, so a trial user never has to hold SOL. A co-signer that signs
// anything is a blank cheque on that wallet, so every instruction is checked
// against an allowlist and the only sponsor-debiting instruction permitted is a
// capped System transfer to the buyer itself.
const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();
const MAX_SPONSOR_RENT_LAMPORTS = Number(process.env.MAX_SPONSOR_RENT_LAMPORTS || 12_000_000); // 0.012 SOL
const SPONSOR_FEE_ALLOWANCE = 20_000; // generous per-tx fee headroom, for accounting
// Conservative rent estimate charged against the budget when the sponsor is the
// rent payer inside an Optket instruction (contract + quote-marker ≈ 0.0037 SOL).
const ACCOUNT_RENT_ESTIMATE_LAMPORTS = 5_000_000;

function sponsorReject(reason: string): never {
  throw new Error(`sponsorship refused: ${reason}`);
}

async function sponsor(txBase64: string, buyer: string) {
  const buyerKey = new PublicKey(buyer);
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));

  // 1) we must be the fee payer, and nothing else
  if (!tx.feePayer?.equals(trialBudget.address)) sponsorReject("fee payer is not the sponsor");

  // 2) the buyer must actually be signing this transaction
  const buyerSigns = tx.signatures.some((s) => s.publicKey.equals(buyerKey));
  if (!buyerSigns) sponsorReject("buyer is not a signer of this transaction");

  // 3) every instruction must be on the allowlist
  let subsidy = 0;
  let touchesOptket = false;
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    if (pid === PROGRAM_ID.toBase58()) {
      touchesOptket = true;
      // The sponsor can be named as the rent payer inside the instruction, so
      // account for that outflow too — otherwise rent would escape the cap.
      if (ix.keys.some((k) => k.pubkey.equals(trialBudget.address) && k.isWritable)) {
        subsidy += ACCOUNT_RENT_ESTIMATE_LAMPORTS;
      }
      continue;
    }
    if (pid === ED25519_PROGRAM || pid === COMPUTE_BUDGET) continue;
    if (pid === SYSTEM_PROGRAM) {
      // only a transfer from the sponsor to the buyer, to cover account rent
      const isTransfer = ix.data.length === 12 && ix.data.readUInt32LE(0) === 2;
      if (!isTransfer) sponsorReject("only System transfers are allowed");
      const from = ix.keys[0]?.pubkey, to = ix.keys[1]?.pubkey;
      if (!from?.equals(trialBudget.address)) sponsorReject("transfer must originate from the sponsor");
      if (!to?.equals(buyerKey)) sponsorReject("transfer must be to the buyer");
      subsidy += Number(ix.data.readBigUInt64LE(4));
      continue;
    }
    sponsorReject(`disallowed program ${pid}`);
  }
  if (!touchesOptket) sponsorReject("transaction does not call the Optket program");
  if (subsidy > MAX_SPONSOR_RENT_LAMPORTS) sponsorReject("rent subsidy above the per-request cap");

  // 4) budget controls (hard cap, per-wallet ceiling, rate limit)
  const auth = trialBudget.authorizeSponsorship(buyer, subsidy + SPONSOR_FEE_ALLOWANCE);
  if (!auth.ok) sponsorReject(auth.reason || "not authorized");

  trialBudget.signAsFeePayer(tx);
  return {
    tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    sponsor: trialBudget.address.toBase58(),
    subsidyLamports: subsidy,
    remainingSol: auth.remainingSol,
  };
}

// ---- http plumbing ----
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/health") {
      let chain = "unreachable";
      try { chain = String(await conn.getSlot()); } catch { /* keep unreachable */ }
      return json(res, 200, {
        ok: true, rpc: RPC_URL, slot: chain, programId: PROGRAM_ID.toBase58(),
        quoteAuthority: quoteAuthority.publicKey.toBase58(), issued: usedQuoteIds.size,
      });
    }
    if (req.method === "GET" && url.pathname === "/config") {
      const mint = await demoMint();
      return json(res, 200, { programId: PROGRAM_ID.toBase58(), demoMint: mint.toBase58(), quoteAuthority: quoteAuthority.publicKey.toBase58() });
    }
    if (req.method === "GET" && url.pathname === "/assets") return json(res, 200, VERIFIED_ASSETS);
    if (req.method === "GET" && url.pathname === "/market") {
      const mint = url.searchParams.get("mint");
      if (!mint) return json(res, 400, { error: "mint required" });
      return json(res, 200, await marketData(mint));
    }
    if (req.method === "GET" && url.pathname === "/reference") {
      const assetId = Number(url.searchParams.get("assetId"));
      if (!Number.isInteger(assetId)) return json(res, 400, { error: "valid assetId required" });
      const reference = await referenceStatus(assetId);
      return reference.available
        ? json(res, 200, { assetId, price: fromFixed(reference.spot), source: reference.source, available: true })
        : json(res, 200, reference);
    }
    if (req.method === "GET" && url.pathname === "/holdings") {
      const owner = url.searchParams.get("owner");
      const mint = url.searchParams.get("mint");
      if (!owner || !mint) return json(res, 400, { error: "owner and mint required" });
      const accs = await mainnet.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
      let displayed = 0;
      for (const a of accs.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        displayed += ((a.account.data as any).parsed.info.tokenAmount.uiAmount as number) || 0;
      }
      return json(res, 200, { owner, mint, displayed, scaledMultiplier: await scaledMultiplier(mint) });
    }
    if (req.method === "GET" && url.pathname === "/series") {
      const s = await fetchSeries(Number(url.searchParams.get("assetId") ?? 0), Number(url.searchParams.get("seriesId") ?? 0));
      return json(res, 200, { ...s, strike: s.strike.toString(), maxContractSize: s.maxContractSize.toString() });
    }
    if (req.method === "GET" && url.pathname === "/trial/status") return json(res, 200, await trialBudget.status());
    if (req.method === "POST" && url.pathname === "/sponsor") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { tx, buyer } = JSON.parse(body || "{}");
      if (!tx || !buyer) return json(res, 400, { error: "tx and buyer required" });
      return json(res, 200, await sponsor(String(tx), String(buyer)));
    }
    /** Every live series across both assets in bounded RPC batches, including
     *  all rotating short-dated Devnet ids. */
    if (req.method === "GET" && url.pathname === "/series/all") {
      const ids: Array<{ assetId: number; seriesId: number }> = [];
      for (const assetId of [0, 1]) for (const seriesId of [0, 1, ...Array.from({ length: SHORT_ID_MAX - SHORT_ID_MIN + 1 }, (_, i) => SHORT_ID_MIN + i)]) ids.push({ assetId, seriesId });
      const infos = [];
      for (let i = 0; i < ids.length; i += 100) {
        infos.push(...await conn.getMultipleAccountsInfo(ids.slice(i, i + 100).map((k) => seriesPda(k.assetId, k.seriesId))));
      }
      const now = nowSec();
      const out = infos
        .map((info, i) => (info ? { ...decodeSeries(info.data as Buffer), ...ids[i] } : null))
        .filter((s): s is SeriesTerms & { assetId: number; seriesId: number } => !!s && s.active && s.expiryTs > now)
        .map((s) => ({
          ...s,
          strike: s.strike.toString(),
          maxContractSize: s.maxContractSize.toString(),
          shortDated: s.seriesId >= SHORT_ID_MIN,
        }));
      return json(res, 200, out);
    }
    if (req.method === "POST" && url.pathname === "/faucet") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { address } = JSON.parse(body || "{}");
      if (!address) return json(res, 400, { error: "address required" });
      return json(res, 200, await faucet(String(address)));
    }
    if (req.method === "POST" && url.pathname === "/quote") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { buyer, assetId, seriesId, quantity } = JSON.parse(body || "{}");
      if (!buyer || assetId == null || seriesId == null || quantity == null) {
        return json(res, 400, { error: "buyer, assetId, seriesId, quantity required" });
      }
      return json(res, 200, await buildSignedQuote(String(buyer), Number(assetId), Number(seriesId), BigInt(quantity)));
    }
    return json(res, 404, { error: "not found" });
  } catch (e) {
    const serviceError = e instanceof ServiceError ? e : null;
    return json(res, serviceError?.status ?? 400, {
      error: String((e as Error).message || e),
      ...(serviceError?.code ? { code: serviceError.code } : {}),
      ...(serviceError?.details ?? {}),
    });
  }
});

// never die on a stray rejection in a hosted environment
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

server.listen(PORT, async () => {
  console.log(`Optket quote service on :${PORT}`);
  console.log(`  RPC:            ${RPC_URL}`);
  console.log(`  program:        ${PROGRAM_ID.toBase58()}`);
  console.log(`  quote authority ${quoteAuthority.publicKey.toBase58()}`);
  console.log(`  admin/payer:    ${payer ? payer.publicKey.toBase58() : "MISSING (token faucet disabled)"}`);
  try {
    await trialBudget.ensureFunded();
    const s = await trialBudget.status();
    console.log(`  trial budget    ${s.budgetWallet}  cap ${s.capSol} SOL, ${s.perGrantSol}/grant, wallet ${s.walletBalanceSol.toFixed(3)} SOL`);
  } catch (e) {
    console.warn("  trial budget status unavailable:", (e as Error).message);
  }
  // keep a short lifecycle series permanently available
  await rotateShortSeries();
  setInterval(rotateShortSeries, 120_000);
});
