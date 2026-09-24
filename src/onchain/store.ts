import { create } from "zustand";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, Ed25519Program,
} from "@solana/web3.js";
import {
  OptketClient, OPTKET_PROGRAM_ID, associatedTokenAddress, decodeOptketInstruction, pdas,
  type ContractAcct, type ExerciseRequestAcct, type PoolAcct, type SeriesAcct,
} from "../client/optketProgram";
import { fetchJson, normalizeServiceUrl } from "../serviceUrl";
import { checkPurchaseLimit } from "../engine/quote";
import bs58 from "bs58";
import { VaultClient, vaultPdas, vaultQuoteMessage, decodeVaultInstruction, type VaultRoundAccount } from "../client/vaultProgram";
import { loadVaultPortfolio, type OwnedVaultDeposit } from "../client/vaultPortfolio";
import { decodeExpiryEvents, type ExpiryEvent } from "../client/expiryEvent";
import { loadTransaction, saveTransaction, reconcileTransaction, pendingTransaction, rpcScope, registerEndpointChain, matchesTransactionChain, type TrackedTransaction } from "./transactionRecovery";

// Hosted deployment: set VITE_RPC_URL (devnet RPC) and VITE_QUOTE_SVC (Railway
// quote-service URL) in Vercel. Local dev falls back to localnet defaults.
const DEFAULT_SVC = normalizeServiceUrl(import.meta.env.VITE_QUOTE_SVC);
const USE_RELAY = import.meta.env.VITE_USE_RPC_RELAY === "true";
const DEFAULT_RPC = USE_RELAY ? `${DEFAULT_SVC}/rpc` : import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8899";
export const NETWORK = USE_RELAY || /devnet/.test(DEFAULT_RPC) ? "devnet" : "localnet";
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
  vaultRound?: string;
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

async function decodeTransactionActions(connection: Connection, signatures: string[], onExpiry?: (event: ExpiryEvent, signature: string) => void): Promise<Map<string, string>> {
  const unique = [...new Set(signatures)].slice(0, 30);
  const actions = new Map<string, string>();
  if (unique.length === 0) return actions;
  // Some public RPCs reject JSON-RPC batches even when individual reads work.
  // Bound concurrent requests and preserve successful reads independently.
  for (let offset = 0; offset < unique.length; offset += 2) {
    const batch = unique.slice(offset, offset + 2);
    try {
      const transactions = await Promise.all(batch.map((signature) => connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 }).catch(() => null)));
      transactions.forEach((transaction, index) => {
        if (!transaction) return;
        if (transaction.meta) {
          for (const event of decodeExpiryEvents(transaction.meta.logMessages ?? [], OPTKET_PROGRAM_ID.toBase58(), transaction.meta.err !== null)) {
            onExpiry?.(event, batch[index]);
          }
        }
        const labels = transaction.transaction.message.instructions.flatMap((instruction) => {
          if (!("programId" in instruction) || !instruction.programId.equals(OPTKET_PROGRAM_ID) || !("data" in instruction)) return [];
          const label = decodeOptketInstruction(instruction.data) ?? decodeVaultInstruction(instruction.data);
          return label ? [label] : [];
        });
        if (labels.length > 0) actions.set(batch[index], [...new Set(labels)].join(" + "));
      });
    } catch { /* RPC may restrict transaction history; retain honest generic labels for this batch */ }
  }
  return actions;
}

export async function loadSeries(svcUrl: string): Promise<SeriesInfo[]> {
  const vaultQuery = import.meta.env.VITE_VAULTS_ENABLED === "true" ? "?includeVaults=true" : "";
  const raw = await fetchJson<Array<Record<string, unknown>>>(`${svcUrl}/series/all${vaultQuery}`);
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
      vaultRound: typeof s.vaultRound === "string" ? s.vaultRound : undefined,
    }))
    .sort((a, b) => a.assetId - b.assetId || a.expiryTs - b.expiryTs || Number(b.strike - a.strike));
}

/** Explorer link for a tx/address on the active cluster. */
export function explorerUrl(kind: "tx" | "address", id: string): string {
  const cluster = NETWORK === "devnet" ? "?cluster=devnet"
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
 * transfer to this buyer. A failed sponsored submission is never replaced.
 */
async function sendSponsored(...args: Parameters<typeof sendSponsoredUnlocked>): Promise<string> {
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate demo-wallet transactions. Use a current browser over HTTPS.");
  return navigator.locks.request("optket-demo-wallet-transaction", { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("A transaction is in progress in another tab. Check that tab before continuing.");
    useChain.setState({ transaction: loadTransaction() });
    return sendSponsoredUnlocked(...args);
  });
}

async function sendSponsoredUnlocked(
  conn: Connection,
  svcUrl: string,
  /** Rebuilt per attempt: receives the rent-funding prefix (empty when
   *  self-paying) and who pays account rent, because instruction indexes and
   *  the rent payer are both baked into the instruction data. */
  build: (prefix: TransactionInstruction[], rentPayer: PublicKey) => Transaction,
  burner: Keypair,
  sponsor: PublicKey | null,
  rentLamports = 0,
  destination: "portfolio" | "vaults" = "portfolio",
): Promise<string> {
  const prior = useChain.getState().transaction;
  if (pendingTransaction(prior, conn.rpcEndpoint, burner.publicKey.toBase58())) throw new Error("Check the pending transaction before submitting another.");
  const lifetime = await conn.getLatestBlockhash("confirmed");
  const genesisHash = await conn.getGenesisHash();
  registerEndpointChain(conn.rpcEndpoint, genesisHash);
  let signed: Transaction;
  if (sponsor) {
      const prefix = rentLamports > 0
        ? [SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: burner.publicKey, lamports: rentLamports })]
        : [];
      const tx = build(prefix, sponsor);
      tx.feePayer = sponsor;
      tx.recentBlockhash = lifetime.blockhash;
      const unsigned = bytesToB64(Uint8Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })));
      const j = await fetchJson<{ tx: string }>(`${svcUrl}/sponsor`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx: unsigned, buyer: burner.publicKey.toBase58() }),
      });
      signed = Transaction.from(b64ToBytes(j.tx));
      if (!signed.serializeMessage().equals(tx.serializeMessage())) throw new Error("Sponsor changed transaction terms.");
      signed.partialSign(burner);
  } else {
    signed = build([], burner.publicKey);
    signed.feePayer = burner.publicKey;
    signed.recentBlockhash = lifetime.blockhash;
    signed.sign(burner);
  }
  const bytes = signed.serialize();
  if (!signed.signature) throw new Error("Transaction signature is missing.");
  const signature = bs58.encode(signed.signature);
  const tracked: TrackedTransaction = { ...lifetime, destination, genesisHash, signature, buyer: burner.publicKey.toBase58(), rpc: rpcScope(conn.rpcEndpoint), state: "checking" };
  saveTransaction(tracked);
  useChain.setState({ transaction: tracked, status: "Submitting transaction…" });
  try {
    await conn.sendRawTransaction(bytes, { preflightCommitment: "confirmed", maxRetries: 3 });
    useChain.setState({ status: "Confirming onchain…" });
    // HTTP status checks work with HTTP-only RPC endpoints as well as after
    // refresh. A timeout is uncertainty, never permission to submit again.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const next = await reconcileTransaction(conn, tracked);
      saveTransaction(next);
      useChain.setState({ transaction: next });
      if (next.state === "confirmed") return signature;
      if (next.state === "failed") throw new Error("Transaction failed onchain. Inspect the transaction for details.");
      if (next.state === "expired") throw new Error("Transaction expired without confirmation. Review your position before submitting again.");
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    throw new Error("Confirmation is taking longer than expected. Your original signature is saved; check its status before submitting again.");
  } catch (error) {
    try {
      const next = await reconcileTransaction(conn, tracked);
      saveTransaction(next);
      useChain.setState({ transaction: next });
      if (next.state === "confirmed") return signature;
    } catch { /* Keep the original saved signature if recovery is unavailable. */ }
    throw error;
  }
}

function loadBurner(): Keypair {
  const saved = localStorage.getItem(BURNER_KEY);
  if (saved) {
    try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))); }
    catch { throw new Error("The saved demo wallet could not be read. Its stored data has been preserved; do not clear site data if you need its positions."); }
  }
  const kp = Keypair.generate();
  localStorage.setItem(BURNER_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

interface ChainState {
  transaction: TrackedTransaction | null;
  recovering: boolean;
  refreshing: boolean;
  recoverTransaction: () => Promise<void>;
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
  vaultDeposits: OwnedVaultDeposit[];
  requests: ExerciseRequestAcct[];
  requestTransactions: Record<string, RequestTransaction[]>;
  history: HistoryEntry[];
  expiryReceipts: Record<string, ExpiryEvent & { signature: string }>;
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
  lastPurchaseAddress: string | null;
  clearError: () => void;

  connect: (restoreOnly?: boolean) => Promise<void>;
  refresh: (options?: { history?: boolean }) => Promise<void>;
  publicLoading: boolean;
  publicError: string | null;
  refreshPublic: () => Promise<void>;
  buy: (assetId: number, seriesId: number, quantityUnits: number, maxPremium: bigint, selected?: SeriesInfo) => Promise<void>;
  vaultAction: (round: VaultRoundAccount, action: "deposit" | "cancel" | "redeem", amount: bigint) => Promise<string>;
  requestExercise: (contractAddr: string, assetId: number, nonce: number, quantityUnits: number) => Promise<void>;
}

const conn = new Connection(DEFAULT_RPC, "confirmed");

export const useChain = create<ChainState>((set, get) => ({
  transaction: loadTransaction(),
  recovering: false,
  refreshing: false,
  recoverTransaction: async () => {
    const tx = get().transaction;
    if (!tx || get().recovering) return;
    set({ recovering: true });
    try {
      registerEndpointChain(get().conn.rpcEndpoint, await get().conn.getGenesisHash());
      if (!matchesTransactionChain(tx, get().conn.rpcEndpoint)) return;
      const next = await reconcileTransaction(get().conn, tx);
      const persist = () => {
        if (get().transaction?.signature !== tx.signature || loadTransaction()?.signature !== tx.signature) return;
        saveTransaction(next);
        set({ transaction: next, ...(next.state === "confirmed" ? { lastTx: next.signature, error: null } : {}) });
        if (next.state === "confirmed") void get().refresh().catch(() => {});
      };
      if (navigator.locks) await navigator.locks.request("optket-demo-wallet-transaction", { ifAvailable: true }, lock => { if (lock) persist(); });
      else persist();
    } catch { /* An RPC error must never turn an unknown outcome into failure. */ }
    finally { set({ recovering: false }); }
  },
  publicLoading: false,
  publicError: null,
  refreshPublic: async () => {
    if (get().publicLoading) return;
    set({ publicLoading: true, publicError: null });
    try {
      const { conn, client } = get();
      const [pool0, pool1, signatures] = await Promise.all([
        client.getPool(0), client.getPool(1),
        conn.getSignaturesForAddress(OPTKET_PROGRAM_ID, { limit: 30 }),
      ]);
      const prior = new Map(get().programHistory.map(h => [h.signature, h.action]));
      set({ pools: { 0: pool0, 1: pool1 }, programHistory: signatures.map(s => ({
        signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null,
        err: !!s.err, action: prior.get(s.signature) ?? "Program instruction",
      })) });
      const actions = await decodeTransactionActions(conn, signatures.filter(s => !prior.has(s.signature) || prior.get(s.signature) === "Program instruction").map(s => s.signature));
      set(state => ({ programHistory: state.programHistory.map(entry => ({ ...entry, action: actions.get(entry.signature) ?? entry.action })) }));
    } catch { set({ publicError: "Could not refresh public Devnet data. Please retry." }); }
    finally { set({ publicLoading: false }); }
  },
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
  vaultDeposits: [],
  requests: [],
  requestTransactions: {},
  history: [],
  expiryReceipts: {},
  programHistory: [],
  exposure: { 0: 0, 1: 0 },
  setExposure: (assetId, shareEquiv) =>
    set((s) => ({ exposure: { ...s.exposure, [assetId]: shareEquiv } })),
  solBalance: 0,
  tokenBalance: 0,
  trial: null,
  lastTx: null,
  lastPurchasePremium: null,
  lastPurchaseAddress: null,
  clearError: () => set({ error: null }),

  connect: async (restoreOnly = false) => {
    if (get().busy) return;
    set({ busy: true, error: null, status: "Connecting wallet…" });
    try {
      if (restoreOnly && !localStorage.getItem(BURNER_KEY)) return;
      const burner = loadBurner();
      const cfg = await fetchJson<{ programId: string; demoMint: string; quoteAuthority: string }>(`${get().svcUrl}/config`);
      if (cfg.programId !== OPTKET_PROGRAM_ID.toBase58()) throw new Error("Quote service program does not match this app.");
      const genesis = await get().conn.getGenesisHash();
      if (NETWORK === "devnet" && genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("RPC is not connected to Solana Devnet.");
      registerEndpointChain(get().conn.rpcEndpoint, genesis);
      const demoMint = new PublicKey(cfg.demoMint);
      // Fees and account rent are sponsored (§19), so the burner needs no SOL —
      // the faucet only mints the demo tokens used to pay premiums.
      const account = associatedTokenAddress(demoMint, burner.publicKey);
      const exists = await get().conn.getAccountInfo(account);
      let tokenBalance = exists ? Number((await get().conn.getTokenAccountBalance(account)).value.uiAmountString) : 0;
      if (!restoreOnly && tokenBalance === 0) {
        set({ status: "claiming demo tokens…" });
        const faucet = await fetchJson<{ tokenBalance?: number }>(`${get().svcUrl}/faucet`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: burner.publicKey.toBase58() }),
        });
        tokenBalance = faucet.tokenBalance ?? 0;
      }
      const trial = await fetchJson<ChainState["trial"]>(`${get().svcUrl}/trial/status`).catch(() => null);
      set({
        burner, address: burner.publicKey.toBase58(), connected: true, demoMint,
        quoteAuthority: cfg.quoteAuthority,
        sponsor: trial?.budgetWallet ? new PublicKey(trial.budgetWallet) : null,
        tokenBalance,
        status: "Loading positions…",
      });
      await get().refresh();
      set({ status: "" });
    } catch (e) {
      set({ error: friendly(e), status: "" });
    } finally {
      set({ busy: false, status: "" });
    }
  },

  refresh: async (options = {}) => {
    const { client, conn, burner, demoMint, svcUrl } = get();
    if (!burner || !demoMint || get().refreshing) return;
    set({ refreshing: true });
    try {
    const current = get();
    const [pool0, pool1, legacyContracts, seriesList] = await Promise.all([
      client.getPool(0).catch(() => current.pools[0] ?? null), client.getPool(1).catch(() => current.pools[1] ?? null),
      client.getContractsForBuyer(burner.publicKey).catch(() => current.contracts.filter(c => !c.vaultRound)),
      loadSeries(svcUrl).catch(() => current.seriesList),
    ]);

    const vaultPortfolio = import.meta.env.VITE_VAULTS_ENABLED === "true"
      ? await loadVaultPortfolio(new VaultClient(conn), burner.publicKey)
      : { contracts: [], requests: [], vaultDeposits: [] };
    const contracts = [...legacyContracts, ...vaultPortfolio.contracts];
    const legacyRequests = await client.getRequestsForContracts(legacyContracts.map((contract) => new PublicKey(contract.address)))
      .catch(() => current.requests.filter(r => legacyContracts.some(c => c.address === r.contract.toBase58())));
    const requests = [...legacyRequests, ...vaultPortfolio.requests];
    // Coverage is useful before slower history and balance reads finish.
    set({ contracts, requests, vaultDeposits: vaultPortfolio.vaultDeposits, pools: { 0: pool0, 1: pool1 }, seriesList });

    // Real transaction history: every signature that touched a contract the
    // user owns (§13.7) — no local log, straight from the chain.
    const history: HistoryEntry[] = [];
    const previousActions = new Map([
      ...get().history.map((entry) => [entry.signature, entry.action] as const),
      ...get().programHistory.map((entry) => [entry.signature, entry.action] as const),
      ...Object.values(get().requestTransactions).flat().map((entry) => [entry.signature, entry.action] as const),
    ]);
    const requestTransactions: Record<string, RequestTransaction[]> = { ...get().requestTransactions };
    if (options.history !== false) await Promise.all([
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
    const allSignatures = options.history === false ? [] : [
      ...history.filter((entry) => entry.action === "Contract instruction").map((entry) => entry.signature),
      ...Object.values(requestTransactions).flat().filter((entry) => entry.action === "Exercise instruction").map((entry) => entry.signature),
    ];
    history.sort((a, b) => (b.blockTime ?? b.slot) - (a.blockTime ?? a.slot));
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
      solBalance: sol,
      tokenBalance: tokens,
      trial,
    });
    // Labels enrich confirmed history; RPC throttling must not block wallet
    // readiness or a completed purchase from reaching its success state.
    void decodeTransactionActions(conn, allSignatures, (event, signature) => {
      if (get().burner !== burner || get().conn !== conn) return;
      set(latest => ({ expiryReceipts: { ...latest.expiryReceipts, [event.contractId.toString()]: { ...event, signature } } }));
    }).then((actions) => {
      if (get().burner !== burner || get().conn !== conn || actions.size === 0) return;
      const label = <T extends { signature: string; action: string }>(entry: T): T => ({ ...entry, action: actions.get(entry.signature) ?? entry.action });
      set((latest) => ({
        history: latest.history.map(label),
        programHistory: latest.programHistory.map(label),
        requestTransactions: Object.fromEntries(Object.entries(latest.requestTransactions).map(([address, entries]) => [address, entries.map(label)])),
      }));
    });
    } finally { set({ refreshing: false }); }
  },

  vaultAction: async (round, action, amount) => {
    const { conn, burner, svcUrl, sponsor } = get();
    if (!burner) throw new Error("Connect the demo wallet first.");
    if (get().busy || pendingTransaction(get().transaction, conn.rpcEndpoint, get().address)) throw new Error("Resolve the pending transaction first.");
    set({ busy: true, error: null, status: action === "deposit" ? "Submitting deposit…" : "Submitting withdrawal…" });
    try {
      const client = new VaultClient(conn);
      const signature = await sendSponsored(conn, svcUrl, (prefix, payer) => new Transaction().add(...prefix,
        action === "deposit" ? client.depositIx(round, burner.publicKey, payer, amount)
          : client.withdrawIx(round, burner.publicKey, action, amount)), burner, sponsor, 0, "vaults");
      set({ lastTx: signature, status: "" });
      void get().refresh().catch(() => {});
      return signature;
    } catch (e) { set({ error: friendly(e), status: "" }); throw e; }
    finally { set({ busy: false }); }
  },

  buy: async (assetId, seriesId, quantityUnits, maxPremium, selected) => {
    if (get().busy || pendingTransaction(get().transaction, get().conn.rpcEndpoint, get().address)) throw new Error("Resolve the pending operation before buying protection.");
    const { client, conn, burner, demoMint, svcUrl, sponsor } = get();
    if (!burner || !demoMint) throw new Error("not connected");
    set({ busy: true, error: null, status: "requesting signed quote…" });
    try {
      const quantity = BigInt(Math.round(quantityUnits * 1e6));
      if (selected?.vaultRound) {
        const vault = new VaultClient(conn);
        const round = await vault.getRound(new PublicKey(selected.vaultRound));
        if (!round || round.assetId !== assetId) throw new Error("The selected vault round is unavailable.");
        const resp = await fetchJson<{ payload: string; signature: string; quoteAuthority: string; quoteId: string }>(`${svcUrl}/vault/quote`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buyer: burner.publicKey.toBase58(),
            round: selected.vaultRound, quantity: quantity.toString(), strike: selected.strike.toString() }),
        });
        const payload = b64ToBytes(resp.payload);
        const approvedPremium = checkPurchaseLimit(payload, maxPremium);
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        if (!new PublicKey(payload.slice(0, 32)).equals(burner.publicKey) || payload[32] !== assetId
          || view.getBigUint64(35, true) !== quantity || view.getBigUint64(43, true) !== selected.strike
          || view.getBigInt64(51, true) !== BigInt(selected.expiryTs) || view.getUint32(59, true) !== selected.referenceVersion
          || !new PublicKey(resp.quoteAuthority).equals(round.quoteAuthority)) throw new Error("Quote does not match the reviewed position.");
        const quoteId = view.getBigUint64(79, true);
        const sig = await sendSponsored(conn, svcUrl, (prefix, payer) => new Transaction().add(...prefix,
          Ed25519Program.createInstructionWithPublicKey({ publicKey: round.quoteAuthority.toBytes(),
            message: vaultQuoteMessage(round.address, payload), signature: b64ToBytes(resp.signature) }),
          vault.purchaseIx(round, burner.publicKey, payer, payload, quoteId, prefix.length, maxPremium)), burner, sponsor);
        set({ status: "", lastTx: sig, lastPurchasePremium: Number(approvedPremium) / 1e6,
          lastPurchaseAddress: vaultPdas.position(round.address, quoteId).toBase58() });
        void get().refresh().catch(() => {});
        return;
      }
      if (seriesId < 0) throw new Error("Refresh the selected vault position before submitting.");
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
      const message = b64ToBytes(resp.message);
      const approvedPremium = checkPurchaseLimit(message, maxPremium);
      set({ status: "Submitting purchase…" });
      const signedQuote = {
        message,
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
      set({ status: "", lastTx: sig, lastPurchasePremium: Number(approvedPremium) / 1e6, lastPurchaseAddress: pdas.contract(signedQuote.quoteId).toBase58() });
      void get().refresh().catch(() => {});
    } catch (e) {
      set({ error: friendly(e), status: "" });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  requestExercise: async (contractAddr, assetId, nonce, quantityUnits) => {
    if (get().busy || pendingTransaction(get().transaction, get().conn.rpcEndpoint, get().address)) throw new Error("Resolve the pending operation before requesting exercise.");
    const { client, conn, burner, svcUrl, sponsor } = get();
    if (!burner) throw new Error("not connected");
    set({ busy: true, error: null, status: "submitting exercise request…" });
    try {
      const quantity = BigInt(Math.round(quantityUnits * 1e6));
      if (get().contracts.find(c => c.address === contractAddr)?.vaultRound) {
        const vault = new VaultClient(conn);
        const position = (await vault.positions()).find(p => p.address.toBase58() === contractAddr && p.buyer.equals(burner.publicKey));
        if (!position) throw new Error("Vault position is unavailable.");
        const sig = await sendSponsored(conn, svcUrl, (prefix, payer) => new Transaction().add(...prefix,
          vault.requestIx(position, payer, quantity)), burner, sponsor);
        set({ status: "", lastTx: sig });
        void get().refresh().catch(() => {});
        return;
      }
      // the program takes a separate rent payer here, so the sponsor pays directly
      const sig = await sendSponsored(
        conn, svcUrl,
        (prefix, rentPayer) => new Transaction().add(
          ...prefix,
          client.requestExerciseIx(burner.publicKey, new PublicKey(contractAddr), assetId, nonce, quantity, rentPayer),
        ),
        burner, sponsor, 0,
      );
      set({ status: "", lastTx: sig });
      void get().refresh().catch(() => {});
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
  6004: "Wrong token mint. Only the test mint is accepted; real USDC is rejected.",
  6005: "Pool has insufficient collateral for this purchase.",
  6007: "Quote signature verification failed.",
  6008: "Quote was signed by an unauthorized key.",
  6009: "Quote expired. Request a fresh quote and retry.",
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
  if (/429|too many requests/i.test(s)) return "The RPC is rate-limited. Wait briefly, then check transaction status before retrying.";
  if (/fetch|Failed to fetch|ECONNREFUSED|NetworkError|aborted|non-JSON response/i.test(s)) {
    return "Can't reach the RPC or quote service. Check your connection and that the services are up.";
  }
  if (/reference unavailable/i.test(s)) return "The live settlement reference is unavailable. Purchases are paused until a fresh price returns.";
  if (/blockhash|block height exceeded/i.test(s)) return "Confirmation did not complete. Check Positions and onchain activity before retrying.";
  if (/insufficient lamports|insufficient funds for rent/i.test(s)) return "Fee sponsorship is temporarily unavailable. Try again shortly.";
  const m = s.match(/custom program error: (0x[0-9a-fA-F]+)/);
  if (m) {
    const code = parseInt(m[1], 16);
    return PROGRAM_ERRORS[code] || `Program rejected the transaction (${m[1]}).`;
  }
  return s;
}

export { seriesKey };
