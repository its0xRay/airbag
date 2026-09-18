import { create } from "zustand";
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
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

/** Explorer link for a tx/address on the active cluster. */
export function explorerUrl(kind: "tx" | "address", id: string): string {
  const cluster = /devnet/.test(DEFAULT_RPC) ? "?cluster=devnet"
    : /127\.0\.0\.1|localhost/.test(DEFAULT_RPC) ? `?cluster=custom&customUrl=${encodeURIComponent(DEFAULT_RPC)}`
    : "";
  return `https://explorer.solana.com/${kind}/${id}${cluster}`;
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const seriesKey = (a: number, s: number) => `${a}:${s}`;

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
  pools: Record<number, PoolAcct | null>;
  series: Record<string, SeriesAcct | null>;
  contracts: ContractAcct[];
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
  pools: {},
  series: {},
  contracts: [],
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
      set({ status: "funding burner from faucet…" });
      await fetch(`${get().svcUrl}/faucet`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: burner.publicKey.toBase58() }),
      });
      set({ burner, address: burner.publicKey.toBase58(), connected: true, demoMint, quoteAuthority: cfg.quoteAuthority });
      await get().refresh();
      set({ status: "" });
    } catch (e) {
      set({ error: friendly(e), status: "" });
    } finally {
      set({ busy: false });
    }
  },

  refresh: async () => {
    const { client, conn, burner, demoMint } = get();
    if (!burner || !demoMint) return;
    const [pool0, pool1, s00, s01, s10, s11, contracts] = await Promise.all([
      client.getPool(0), client.getPool(1),
      client.getSeries(0, 0), client.getSeries(0, 1), client.getSeries(1, 0), client.getSeries(1, 1),
      client.getContractsForBuyer(burner.publicKey),
    ]);
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
      contracts,
      solBalance: sol / 1e9,
      tokenBalance: tokens,
      trial,
    });
  },

  buy: async (assetId, seriesId, quantityUnits) => {
    const { client, conn, burner, demoMint, svcUrl } = get();
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
      const tx = client.purchaseTx(burner.publicKey, assetId, seriesId, demoMint, {
        message: b64ToBytes(resp.message),
        signature: b64ToBytes(resp.signature),
        quoteAuthority: new PublicKey(resp.quoteAuthority),
        quoteId: BigInt(resp.quote.quoteId),
      });
      const sig = await sendAndConfirmTransaction(conn, tx, [burner], { commitment: "confirmed" });
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
    const { client, conn, burner } = get();
    if (!burner) throw new Error("not connected");
    set({ busy: true, error: null, status: "submitting exercise request…" });
    try {
      const quantity = BigInt(Math.round(quantityUnits * 1e6));
      const ix = client.requestExerciseIx(burner.publicKey, new PublicKey(contractAddr), assetId, nonce, quantity);
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [burner], { commitment: "confirmed" });
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
