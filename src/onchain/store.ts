import { create } from "zustand";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  OptketClient, associatedTokenAddress,
  type ContractAcct, type PoolAcct, type SeriesAcct,
} from "../client/optketProgram";

// Hosted deployment: set VITE_RPC_URL (devnet RPC) and VITE_QUOTE_SVC (Railway
// quote-service URL) in Vercel. Local dev falls back to localnet defaults.
const DEFAULT_RPC = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8899";
const DEFAULT_SVC = import.meta.env.VITE_QUOTE_SVC || "http://127.0.0.1:8787";
const BURNER_KEY = "optket.burner.sk";

/** A purchasable series as published on-chain. */
export interface SeriesInfo {
  assetId: number;
  seriesId: number;
  strike: bigint;
  expiryTs: number;
  purchaseCutoffTs: number;
  exerciseCutoffTs: number;
  maxContractSize: bigint;
  referenceVersion: number;
  shortDated: boolean;
}

/** One confirmed transaction touching a contract the user owns (§13.7). */
export interface HistoryEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  contractId: bigint;
  assetId: number;
  err: boolean;
}

async function loadSeries(svcUrl: string): Promise<SeriesInfo[]> {
  const r = await fetch(`${svcUrl}/series/all`);
  if (!r.ok) throw new Error(`series ${r.status}`);
  const raw = (await r.json()) as Array<Record<string, unknown>>;
  return raw
    .map((s) => ({
      assetId: Number(s.assetId),
      seriesId: Number(s.seriesId),
      strike: BigInt(String(s.strike)),
      expiryTs: Number(s.expiryTs),
      purchaseCutoffTs: Number(s.purchaseCutoffTs),
      exerciseCutoffTs: Number(s.exerciseCutoffTs),
      maxContractSize: BigInt(String(s.maxContractSize)),
      referenceVersion: Number(s.referenceVersion),
      shortDated: !!s.shortDated,
    }))
    .sort((a, b) => a.assetId - b.assetId || a.expiryTs - b.expiryTs || Number(b.strike - a.strike));
}

/** Explorer link for a tx/address on the active cluster. */
export function explorerUrl(kind: "tx" | "address", id: string): string {
  const cluster = /devnet/.test(DEFAULT_RPC) ? "?cluster=devnet"
    : /127\.0\.0\.1|localhost/.test(DEFAULT_RPC) ? `?cluster=custom&customUrl=${encodeURIComponent(DEFAULT_RPC)}`
    : "";
  return `https://explorer.solana.com/${kind}/${id}${cluster}`;
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
/** Encode without Buffer — chunked so large transactions don't blow the stack. */
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const seriesKey = (a: number, s: number) => `${a}:${s}`;

/**
 * Send a transaction with the trial budget as fee payer (PRD §19), so a user
 * never needs SOL. `rentLamports` is an exact top-up for any account the
 * instruction creates — the service caps it and refuses anything that isn't a
 * transfer to this buyer. Falls back to self-paying if sponsorship is refused.
 */
async function sendSponsored(
  conn: Connection,
  svcUrl: string,
  /** Rebuilt per attempt: receives the rent-funding prefix (empty when
   *  self-paying) and who pays account rent, because instruction indexes and
   *  the rent payer are both baked into the instruction data. */
  build: (prefix: TransactionInstruction[], rentPayer: PublicKey) => Transaction,
  burner: Keypair,
  sponsor: PublicKey | null,
  rentLamports = 0,
): Promise<string> {
  if (sponsor) {
    try {
      const prefix = rentLamports > 0
        ? [SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: burner.publicKey, lamports: rentLamports })]
        : [];
      const tx = build(prefix, sponsor);
      tx.feePayer = sponsor;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      const unsigned = bytesToB64(Uint8Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })));
      const r = await fetch(`${svcUrl}/sponsor`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx: unsigned, buyer: burner.publicKey.toBase58() }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const signed = Transaction.from(b64ToBytes(j.tx));
      signed.partialSign(burner);
      return await conn.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" })
        .then(async (sig) => { await conn.confirmTransaction(sig, "confirmed"); return sig; });
    } catch (e) {
      // Sponsorship unavailable (cap reached, service down) — fall through and
      // let the burner pay from its own trial grant if it has one.
      console.warn("[sponsorship unavailable]", (e as Error).message);
    }
  }
  const self = build([], burner.publicKey);
  self.feePayer = burner.publicKey;
  self.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return sendAndConfirmTransaction(conn, self, [burner], { commitment: "confirmed" });
}

function loadBurner(): Keypair {
  const saved = localStorage.getItem(BURNER_KEY);
  if (saved) {
    try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))); } catch { /* regenerate */ }
  }
  const kp = Keypair.generate();
  localStorage.setItem(BURNER_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

interface ChainState {
  rpcUrl: string;
  svcUrl: string;
  conn: Connection;
  client: OptketClient;
  burner: Keypair | null;
  address: string | null;
  connected: boolean;
  busy: boolean;
  status: string;
  error: string | null;
  demoMint: PublicKey | null;
  quoteAuthority: string | null;
  /** Trial-budget wallet that co-signs as fee payer (§19). */
  sponsor: PublicKey | null;
  pools: Record<number, PoolAcct | null>;
  series: Record<string, SeriesAcct | null>;
  /** Every live purchasable series (weekly + short-dated), from the service. */
  seriesList: SeriesInfo[];
  contracts: ContractAcct[];
  history: HistoryEntry[];
  /** Real mainnet holdings (share-equivalents) imported by the user, per asset.
   *  Read-only context for the coverage tracker (§16) — never changes a contract. */
  exposure: Record<number, number>;
  setExposure: (assetId: number, shareEquiv: number) => void;
  solBalance: number;
  tokenBalance: number;
  trial: { remainingSol: number; capSol: number; spentSol: number; active: boolean; grants: number; budgetWallet: string } | null;
  /** Most recent confirmed transaction signature (explorer link in the UI). */
  lastTx: string | null;

  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  buy: (assetId: number, seriesId: number, quantityUnits: number) => Promise<void>;
  requestExercise: (contractAddr: string, assetId: number, nonce: number, quantityUnits: number) => Promise<void>;
}

const conn = new Connection(DEFAULT_RPC, "confirmed");

export const useChain = create<ChainState>((set, get) => ({
  rpcUrl: DEFAULT_RPC,
  svcUrl: DEFAULT_SVC,
  conn,
  client: new OptketClient(conn),
  burner: null,
  address: null,
  connected: false,
  busy: false,
  status: "",
  error: null,
  demoMint: null,
  quoteAuthority: null,
  sponsor: null,
  pools: {},
  series: {},
  seriesList: [],
  contracts: [],
  history: [],
  exposure: { 0: 0, 1: 0 },
  setExposure: (assetId, shareEquiv) =>
    set((s) => ({ exposure: { ...s.exposure, [assetId]: shareEquiv } })),
  solBalance: 0,
  tokenBalance: 0,
  trial: null,
  lastTx: null,

  connect: async () => {
    set({ busy: true, error: null, status: "connecting…" });
    try {
      const burner = loadBurner();
      const cfg = await (await fetch(`${get().svcUrl}/config`)).json();
      const demoMint = new PublicKey(cfg.demoMint);
      // Fees and account rent are sponsored (§19), so the burner needs no SOL —
      // the faucet only mints the demo tokens used to pay premiums.
      set({ status: "claiming demo tokens…" });
      await fetch(`${get().svcUrl}/faucet`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: burner.publicKey.toBase58() }),
      });
      const trial = await (await fetch(`${get().svcUrl}/trial/status`)).json().catch(() => null);
      set({
        burner, address: burner.publicKey.toBase58(), connected: true, demoMint,
        quoteAuthority: cfg.quoteAuthority,
        sponsor: trial?.budgetWallet ? new PublicKey(trial.budgetWallet) : null,
      });
      await get().refresh();
      set({ status: "" });
    } catch (e) {
      set({ error: friendly(e), status: "" });
    } finally {
      set({ busy: false });
    }
  },

  refresh: async () => {
    const { client, conn, burner, demoMint, svcUrl } = get();
    if (!burner || !demoMint) return;
    const [pool0, pool1, s00, s01, s10, s11, contracts, seriesList] = await Promise.all([
      client.getPool(0), client.getPool(1),
      client.getSeries(0, 0), client.getSeries(0, 1), client.getSeries(1, 0), client.getSeries(1, 1),
      client.getContractsForBuyer(burner.publicKey),
      loadSeries(svcUrl).catch(() => get().seriesList),
    ]);

    // Real transaction history: every signature that touched a contract the
    // user owns (§13.7) — no local log, straight from the chain.
    const history: HistoryEntry[] = [];
    await Promise.all(
      contracts.slice(0, 12).map(async (c) => {
        try {
          const sigs = await conn.getSignaturesForAddress(new PublicKey(c.address), { limit: 12 });
          for (const s of sigs) {
            history.push({
              signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null,
              contractId: c.contractId, assetId: c.assetId, err: !!s.err,
            });
          }
        } catch { /* rpc hiccup — keep what we have */ }
      }),
    );
    history.sort((a, b) => (b.blockTime ?? b.slot) - (a.blockTime ?? a.slot));
    const sol = await conn.getBalance(burner.publicKey);
    let tokens = 0;
    try {
      const bal = await conn.getTokenAccountBalance(associatedTokenAddress(demoMint, burner.publicKey));
      tokens = bal.value.uiAmount || 0;
    } catch { /* no ata yet */ }
    let trial = get().trial;
    try { trial = await (await fetch(`${get().svcUrl}/trial/status`)).json(); } catch { /* service down */ }
    set({
      pools: { 0: pool0, 1: pool1 },
      series: { [seriesKey(0, 0)]: s00, [seriesKey(0, 1)]: s01, [seriesKey(1, 0)]: s10, [seriesKey(1, 1)]: s11 },
      seriesList,
      contracts,
      history,
      solBalance: sol / 1e9,
      tokenBalance: tokens,
      trial,
    });
  },

  buy: async (assetId, seriesId, quantityUnits) => {
    const { client, conn, burner, demoMint, svcUrl, sponsor } = get();
    if (!burner || !demoMint) throw new Error("not connected");
    set({ busy: true, error: null, status: "requesting signed quote…" });
    try {
      const quantity = BigInt(Math.round(quantityUnits * 1e6));
      const resp = await (await fetch(`${svcUrl}/quote`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ buyer: burner.publicKey.toBase58(), assetId, seriesId, quantity: quantity.toString() }),
      })).json();
      if (resp.error) throw new Error(resp.error);
      set({ status: `signing & sending purchase (premium ${resp.premiumTokens} oUSD)…` });
      const signedQuote = {
        message: b64ToBytes(resp.message),
        signature: b64ToBytes(resp.signature),
        quoteAuthority: new PublicKey(resp.quoteAuthority),
        quoteId: BigInt(resp.quote.quoteId),
      };
      // purchase creates the contract + quote-marker PDAs, whose rent the
      // program charges to the buyer — so the sponsor tops that up exactly.
      const sig = await sendSponsored(
        conn, svcUrl,
        (prefix) => client.purchaseTx(burner.publicKey, assetId, seriesId, demoMint, signedQuote, prefix),
        burner, sponsor, 6_000_000,
      );
      await get().refresh();
      set({ status: "", lastTx: sig });
    } catch (e) {
      set({ error: friendly(e), status: "" });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  requestExercise: async (contractAddr, assetId, nonce, quantityUnits) => {
    const { client, conn, burner, svcUrl, sponsor } = get();
    if (!burner) throw new Error("not connected");
    set({ busy: true, error: null, status: "submitting exercise request…" });
    try {
      const quantity = BigInt(Math.round(quantityUnits * 1e6));
      // the program takes a separate rent payer here, so the sponsor pays directly
      const sig = await sendSponsored(
        conn, svcUrl,
        (prefix, rentPayer) => new Transaction().add(
          ...prefix,
          client.requestExerciseIx(burner.publicKey, new PublicKey(contractAddr), assetId, nonce, quantity, rentPayer),
        ),
        burner, sponsor, 0,
      );
      await get().refresh();
      set({ status: "", lastTx: sig });
    } catch (e) {
      set({ error: friendly(e), status: "" });
      throw e;
    } finally {
      set({ busy: false });
    }
  },
}));

// map raw program errors to readable text (best-effort)
// Verified against programs/optket/src/errors.rs (anchor: 6000 + enum index).
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "Not authorized for this action.",
  6001: "New purchases are paused.",
  6002: "Asset is not active for live-reference contracts.",
  6003: "Series is not active.",
  6004: "Wrong token mint — only the demo mint is accepted (real USDC is rejected).",
  6005: "Pool has insufficient collateral for this purchase.",
  6007: "Quote signature verification failed.",
  6008: "Quote was signed by an unauthorized key.",
  6009: "Quote expired — request a fresh quote and retry.",
  6011: "Quote terms don't match the on-chain series.",
  6012: "Quote buyer doesn't match the connected wallet.",
  6014: "This quote id was already used (replay). Request a fresh quote.",
  6015: "Purchase window has closed for this series.",
  6016: "Quantity exceeds the maximum contract size.",
  6017: "Purchase would exceed the aggregate exposure limit.",
  6018: "Quantity must be greater than zero.",
  6020: "Contract is not active.",
  6021: "Requested quantity exceeds remaining coverage.",
  6022: "Exercise cutoff has passed.",
  6023: "Request is not pending.",
};
function friendly(e: unknown): string {
  const s = String((e as Error)?.message || e);
  if (/fetch|Failed to fetch|ECONNREFUSED|NetworkError|aborted/i.test(s)) {
    return "Can't reach the RPC or quote service. Check your connection and that the services are up.";
  }
  if (/blockhash|block height exceeded/i.test(s)) return "Transaction expired before confirming (network congestion) — try again.";
  if (/insufficient lamports|insufficient funds for rent/i.test(s)) return "Burner wallet is out of SOL for fees — use Refresh / reconnect to request another trial grant.";
  const m = s.match(/custom program error: (0x[0-9a-fA-F]+)/);
  if (m) {
    const code = parseInt(m[1], 16);
    return PROGRAM_ERRORS[code] || `Program rejected the transaction (${m[1]}).`;
  }
  return s;
}

export { seriesKey };
