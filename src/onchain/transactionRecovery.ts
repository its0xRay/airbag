import type { Connection } from "@solana/web3.js";

export interface TrackedTransaction {
  destination?: "portfolio" | "vaults";
  signature: string;
  buyer: string;
  rpc: string;
  genesisHash?: string;
  blockhash: string;
  lastValidBlockHeight: number;
  state: "checking" | "confirmed" | "failed" | "expired";
}
const KEY = "optket.transaction.v1";
const endpointChains = new Map<string, string>();
export function registerEndpointChain(endpoint: string, genesisHash: string) {
  endpointChains.set(endpoint, genesisHash);
}
export function matchesTransactionChain(tx: TrackedTransaction, endpoint: string): boolean {
  const genesis = endpointChains.get(endpoint);
  // Migrate the previous public-Devnet journal only after the replacement
  // provider proves it serves the same chain. Unknown legacy endpoints do not migrate.
  if (!tx.genesisHash && tx.rpc === rpcScope("https://api.devnet.solana.com")
    && genesis === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") return true;
  return tx.genesisHash && genesis ? tx.genesisHash === genesis : tx.rpc === rpcScope(endpoint);
}
// Opaque endpoint identity: never persist an RPC URL containing an API key.
export function rpcScope(endpoint: string) {
  let hash = 2166136261;
  for (let i = 0; i < endpoint.length; i++) hash = Math.imul(hash ^ endpoint.charCodeAt(i), 16777619);
  return `rpc-${(hash >>> 0).toString(16)}`;
}
export function pendingTransaction(tx: TrackedTransaction | null, rpc: string, buyer?: string | null) {
  return tx?.state === "checking" && matchesTransactionChain(tx, rpc) && (!buyer || tx.buyer === buyer);
}
export function loadTransaction(): TrackedTransaction | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return value && typeof value.signature === "string" && typeof value.buyer === "string" && typeof value.rpc === "string" && typeof value.blockhash === "string" && Number.isSafeInteger(value.lastValidBlockHeight) && value.lastValidBlockHeight >= 0 && ["checking", "confirmed", "failed", "expired"].includes(value.state) ? value : null;
  } catch { return null; }
}
export function saveTransaction(value: TrackedTransaction) {
  // A journal contains public identifiers only, never a key or signed payload.
  // If persistence is unavailable, stop before broadcasting an untrackable tx.
  localStorage.setItem(KEY, JSON.stringify(value));
}
export async function reconcileTransaction(conn: Connection, tx: TrackedTransaction): Promise<TrackedTransaction> {
  const check = async () => (await conn.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0];
  const status = await check();
  if (status?.err) return { ...tx, state: "failed" };
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return { ...tx, state: "confirmed" };
  if (!status && await conn.getBlockHeight("finalized") > tx.lastValidBlockHeight) {
    const final = await check();
    if (final?.err) return { ...tx, state: "failed" };
    if (final?.confirmationStatus === "confirmed" || final?.confirmationStatus === "finalized") return { ...tx, state: "confirmed" };
    if (!final) return { ...tx, state: "expired" };
  }
  return { ...tx, state: "checking" };
}
