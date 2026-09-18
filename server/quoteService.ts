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
//   GET  /holdings?owner=&mint=   real mainnet holdings (scaled)
//   GET  /series?assetId=&seriesId=   on-chain series terms
//   GET  /trial/status     trial budget status (§19)
//   POST /quote            signed premium quote (60s validity, replay-protected)
//   POST /faucet           SOL grant (trial budget) + demo tokens

import { createServer, type ServerResponse } from "node:http";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo, getMint } from "@solana/spl-token";
import nacl from "tweetnacl";
import { serializeQuotePayload, QUOTE_VALIDITY_SECS } from "../src/engine/quote";
import { quotePremium } from "../src/engine/pricing";
import { toFixed, fromFixed } from "../src/engine/fixed";
import type { QuotePayload } from "../src/engine/types";
import { TrialBudget, trialConfigFromEnv } from "./trialBudget";
import { VERIFIED_ASSETS } from "../src/data/assets";
import { loadKey, loadAdmin } from "./keys";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
const PORT = Number(process.env.PORT || 8787);
const MAINNET_RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const JUP_API = process.env.JUP_PRICE_API || "https://lite-api.jup.ag/price/v3";

const conn = new Connection(RPC_URL, "confirmed");
const mainnet = new Connection(MAINNET_RPC, "confirmed");

// ---- keys (env secrets in production, gitignored files locally) ----
const dir = new URL(".", import.meta.url).pathname;
const quoteAuthority = loadKey("QUOTE_AUTHORITY_SECRET", `${dir}quote-authority.json`);
const payer: Keypair | null = loadAdmin(); // demo-mint authority; funds token faucet
const trialBudget = new TrialBudget(conn, trialConfigFromEnv(), `${dir}trial-budget.json`);

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

/** Live spot for premium pricing (§8.3): equity uses the stock benchmark,
 *  PreStocks uses the token market. Falls back to at-the-money (spot=strike)
 *  when the live source is unavailable — disclosed in the quote response. */
async function liveSpot(assetId: number, strike: bigint): Promise<{ spot: bigint; source: string }> {
  const asset = VERIFIED_ASSETS[assetId];
  if (asset) {
    try {
      const m = await marketData(asset.mint);
      const px = asset.kind === "EquityToken" ? (m.benchmark ?? m.usdPrice) : m.usdPrice;
      if (px != null && px > 0) {
        return { spot: toFixed(px), source: asset.kind === "EquityToken" ? "live stock benchmark (Jupiter)" : "live token market (Jupiter)" };
      }
    } catch { /* fall through */ }
  }
  return { spot: strike, source: "ATM fallback (live spot unavailable)" };
}

// ---- signed quotes (§8) ----
async function buildSignedQuote(buyer: string, assetId: number, seriesId: number, quantity: bigint) {
  const s = await fetchSeries(assetId, seriesId);
  if (!s.active) throw new Error("series is not active");
  if (quantity <= 0n) throw new Error("quantity must be positive");
  if (quantity > s.maxContractSize) throw new Error("quantity exceeds max contract size");

  const now = nowSec();
  if (now > s.purchaseCutoffTs) throw new Error("purchase window has closed");

  const { spot, source } = await liveSpot(assetId, s.strike);
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

// ---- faucet (§19): SOL via trial budget, demo tokens via mint authority ----
async function faucet(address: string) {
  const dest = new PublicKey(address); // throws on bad input → 400
  const g = await trialBudget.grant(address);

  let tokens = 0;
  let tokenError: string | undefined;
  if (payer) {
    try {
      const mint = await demoMint();
      const m = await getMint(conn, mint);
      const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, dest);
      await mintTo(conn, payer, mint, ata.address, payer, 20_000n * 10n ** BigInt(m.decimals));
      tokens = 20_000;
    } catch (e) {
      tokenError = `token mint failed: ${(e as Error).message}`;
    }
  } else {
    tokenError = "token faucet unavailable (no ADMIN_SECRET)";
  }

  let sol = 0;
  try { sol = (await conn.getBalance(dest)) / 1e9; } catch { /* balance read is best-effort */ }
  return { granted: g.ok, grantedSol: g.grantedSol, sol, remainingSol: g.remainingSol, reason: g.reason, tokens, tokenError };
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
    return json(res, 400, { error: String((e as Error).message || e) });
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
});
