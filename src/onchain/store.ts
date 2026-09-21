import { create } from "zustand";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  OptketClient, OPTKET_PROGRAM_ID, associatedTokenAddress, decodeOptketInstruction,
  type ContractAcct, type ExerciseRequestAcct, type PoolAcct, type SeriesAcct,
} from "../client/optketProgram";
import { fetchJson, normalizeServiceUrl } from "../serviceUrl";

// Hosted deployment: set VITE_RPC_URL (devnet RPC) and VITE_QUOTE_SVC (Railway
// quote-service URL) in Vercel. Local dev falls back to localnet defaults.
const DEFAULT_RPC = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8899";
const DEFAULT_SVC = normalizeServiceUrl(import.meta.env.VITE_QUOTE_SVC);
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
  action: string;
}

/** One confirmed transaction that invoked the deployed Optket program. */
export interface ProgramHistoryEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: boolean;
  action: string;
}

export interface RequestTransaction {
  signature: string;
  blockTime: number | null;
  err: boolean;
  action: string;
}

async function decodeTransactionActions(connection: Connection, signatures: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(signatures)].slice(0, 100);
  const actions = new Map<string, string>();
  if (unique.length === 0) return actions;
  // Public RPC providers commonly cap or throttle parsed-transaction batches.
  // Decode small batches independently so one rejected batch does not erase
  // labels for every otherwise-readable transaction.
  for (let offset = 0; offset < unique.length; offset += 10) {
    const batch = unique.slice(offset, offset + 10);
    try {
      const transactions = await connection.getParsedTransactions(batch, { maxSupportedTransactionVersion: 0 });
      transactions.forEach((transaction, index) => {
        if (!transaction) return;
        const labels = transaction.transaction.message.instructions.flatMap((instruction) => {
          if (!("programId" in instruction) || !instruction.programId.equals(OPTKET_PROGRAM_ID) || !("data" in instruction)) return [];
          const label = decodeOptketInstruction(instruction.data);
          return label ? [label] : [];
        });
        if (labels.length > 0) actions.set(batch[index], [...new Set(labels)].join(" + "));
      });
    } catch { /* RPC may restrict transaction history; retain honest generic labels for this batch */ }
  }
  return actions;
}

async function loadSeries(svcUrl: string): Promise<SeriesInfo[]> {
  const raw = await fetchJson<Array<Record<string, unknown>>>(`${svcUrl}/series/all`);
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
      const j = await fetchJson<{ tx: string }>(`${svcUrl}/sponsor`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx: unsigned, buyer: burner.publicKey.toBase58() }),
      });
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
  requests: ExerciseRequestAcct[];
  requestTransactions: Record<string, RequestTransaction[]>;
  history: HistoryEntry[];
  programHistory: ProgramHistoryEntry[];
  /** Real mainnet holdings (share-equivalents) imported by the user, per asset.
   *  Read-only context for the coverage tracker (§16) — never changes a contract. */
  exposure: Record<number, number>;
  setExposure: (assetId: number, shareEquiv: number) => void;
  solBalance: number;
  tokenBalance: number;
  trial: { remainingSol: number; capSol: number; spentSol: number; active: boolean; grants: number; budgetWallet: string } | null;
  /** Most recent confirmed transaction signature (explorer link in the UI). */
  lastTx: string | null;
  /** Binding premium returned by the quote service for the latest purchase. */
  lastPurchasePremium: number | null;
  clearError: () => void;

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
  requests: [],
  requestTransactions: {},
  history: [],
  programHistory: [],
  exposure: { 0: 0, 1: 0 },
  setExposure: (assetId, shareEquiv) =>
    set((s) => ({ exposure: { ...s.exposure, [assetId]: shareEquiv } })),
  solBalance: 0,
  tokenBalance: 0,
  trial: null,
  lastTx: null,
  lastPurchasePremium: null,
  clearError: () => set({ error: null }),

  connect: async () => {
    set({ busy: true, error: null, status: "connecting…" });
    try {
      const burner = loadBurner();
      const cfg = await fetchJson<{ demoMint: string; quoteAuthority: string }>(`${get().svcUrl}/config`);
      const demoMint = new PublicKey(cfg.demoMint);
      // Fees and account rent are sponsored (§19), so the burner needs no SOL —
      // the faucet only mints the demo tokens used to pay premiums.
      set({ status: "claiming demo tokens…" });
      const faucet = await fetchJson<{ tokenBalance?: number }>(`${get().svcUrl}/faucet`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: burner.publicKey.toBase58() }),
      });
      const trial = await fetchJson<ChainState["trial"]>(`${get().svcUrl}/trial/status`).catch(() => null);
      set({
        burner, address: burner.publicKey.toBase58(), connected: true, demoMint,
        quoteAuthority: cfg.quoteAuthority,
        sponsor: trial?.budgetWallet ? new PublicKey(trial.budgetWallet) : null,
        tokenBalance: faucet.tokenBalance ?? 0,
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
    const current = get();
    const [pool0, pool1, contracts, seriesList] = await Promise.all([
      client.getPool(0).catch(() => current.pools[0] ?? null), client.getPool(1).catch(() => current.pools[1] ?? null),
      client.getContractsForBuyer(burner.publicKey).catch(() => current.contracts),
      loadSeries(svcUrl).catch(() => current.seriesList),
    ]);

    const requests = await client.getRequestsForContracts(contracts.map((contract) => new PublicKey(contract.address))).catch(() => current.requests);

    // Real transaction history: every signature that touched a contract the
    // user owns (§13.7) — no local log, straight from the chain.
    const history: HistoryEntry[] = [];
    const programHistory: ProgramHistoryEntry[] = [];
    const previousActions = new Map([
      ...get().history.map((entry) => [entry.signature, entry.action] as const),
      ...get().programHistory.map((entry) => [entry.signature, entry.action] as const),
      ...Object.values(get().requestTransactions).flat().map((entry) => [entry.signature, entry.action] as const),
    ]);
    const requestTransactions: Record<string, RequestTransaction[]> = { ...get().requestTransactions };
    await Promise.all([
      ...contracts.slice(0, 12).map(async (c) => {
        try {
          const sigs = await conn.getSignaturesForAddress(new PublicKey(c.address), { limit: 12 });
          for (const s of sigs) {
            history.push({
              signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null,
              contractId: c.contractId, assetId: c.assetId, err: !!s.err,
              action: previousActions.get(s.signature) ?? "Contract instruction",
            });
          }
        } catch { /* rpc hiccup — keep what we have */ }
      }),
      (async () => {
        try {
          const sigs = await conn.getSignaturesForAddress(OPTKET_PROGRAM_ID, { limit: 30 });
          for (const s of sigs) {
            programHistory.push({
              signature: s.signature,
              slot: s.slot,
              blockTime: s.blockTime ?? null,
              err: !!s.err,
              action: previousActions.get(s.signature) ?? "Program instruction",
            });
          }
        } catch { /* rpc hiccup — keep the wallet-scoped data */ }
      })(),
      ...requests.slice(0, 20).map(async (request) => {
        const cached = requestTransactions[request.address];
        const finalActionPresent = cached?.some((entry) => entry.action.includes("settled") || entry.action.includes("failed"));
        if (request.status !== "Pending" && finalActionPresent) return;
        try {
          const sigs = await conn.getSignaturesForAddress(new PublicKey(request.address), { limit: 4 });
          requestTransactions[request.address] = sigs.map((s) => ({
            signature: s.signature,
            blockTime: s.blockTime ?? null,
            err: !!s.err,
            action: previousActions.get(s.signature) ?? "Exercise instruction",
          }));
        } catch { /* account remains valid proof if history lookup is unavailable */ }
      }),
    ]);
    const allSignatures = [
      ...history.filter((entry) => entry.action === "Contract instruction").map((entry) => entry.signature),
      ...programHistory.filter((entry) => entry.action === "Program instruction").map((entry) => entry.signature),
      ...Object.values(requestTransactions).flat().filter((entry) => entry.action === "Exercise instruction").map((entry) => entry.signature),
    ];
    const actionBySignature = await decodeTransactionActions(conn, allSignatures);
    for (const entry of history) entry.action = actionBySignature.get(entry.signature) ?? entry.action;
    for (const entry of programHistory) entry.action = actionBySignature.get(entry.signature) ?? entry.action;
    for (const entries of Object.values(requestTransactions)) {
      for (const entry of entries) entry.action = actionBySignature.get(entry.signature) ?? entry.action;
    }
    history.sort((a, b) => (b.blockTime ?? b.slot) - (a.blockTime ?? a.slot));
    programHistory.sort((a, b) => (b.blockTime ?? b.slot) - (a.blockTime ?? a.slot));
    let sol = current.solBalance;
    try { sol = (await conn.getBalance(burner.publicKey)) / 1e9; } catch { /* preserve last confirmed balance */ }
    let tokens = current.tokenBalance;
    try {
      const bal = await conn.getTokenAccountBalance(associatedTokenAddress(demoMint, burner.publicKey));
      tokens = bal.value.uiAmount || 0;
    } catch { /* no ata yet */ }
    let trial = get().trial;
    try { trial = await fetchJson<ChainState["trial"]>(`${get().svcUrl}/trial/status`); } catch { /* service down */ }
    set({
      pools: { 0: pool0, 1: pool1 },
      seriesList,
      contracts,
      requests,
      requestTransactions,
      history: history.length > 0 ? history : current.history,
      programHistory: programHistory.length > 0 ? programHistory : current.programHistory,
      solBalance: sol,
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
      const resp = await fetchJson<{
        premiumTokens: number;
        message: string;
        signature: string;
        quoteAuthority: string;
        quote: { quoteId: string };
      }>(`${svcUrl}/quote`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ buyer: burner.publicKey.toBase58(), assetId, seriesId, quantity: quantity.toString() }),
      });
      set({ status: `signing & sending purchase (premium ${resp.premiumTokens} oUSD)…` });
      const signedQuote = {
        message: b64ToBytes(resp.message),
        signature: b64ToBytes(resp.signature),
        quoteAuthority: new PublicKey(resp.quoteAuthority),
        quoteId: BigInt(resp.quote.quoteId),
      };
      // The program takes a separate rent payer, so the sponsor funds the
      // contract + quote-marker accounts directly — no SOL ever touches the
      // burner and no top-up transfer is needed.
      const sig = await sendSponsored(
        conn, svcUrl,
        (prefix, rentPayer) =>
          client.purchaseTx(burner.publicKey, assetId, seriesId, demoMint, signedQuote, prefix, rentPayer),
        burner, sponsor, 0,
      );
      await get().refresh();
      set({ status: "", lastTx: sig, lastPurchasePremium: resp.premiumTokens });
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
  if (/fetch|Failed to fetch|ECONNREFUSED|NetworkError|aborted|non-JSON response/i.test(s)) {
    return "Can't reach the RPC or quote service. Check your connection and that the services are up.";
  }
  if (/reference unavailable/i.test(s)) return "The live settlement reference is unavailable. Purchases are paused until a fresh price returns.";
  if (/blockhash|block height exceeded/i.test(s)) return "Transaction expired before confirming (network congestion) — try again.";
  if (/insufficient lamports|insufficient funds for rent/i.test(s)) return "Fee sponsorship is temporarily unavailable. Try again shortly.";
  const m = s.match(/custom program error: (0x[0-9a-fA-F]+)/);
  if (m) {
    const code = parseInt(m[1], 16);
    return PROGRAM_ERRORS[code] || `Program rejected the transaction (${m[1]}).`;
  }
  return s;
}

export { seriesKey };
