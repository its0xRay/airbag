import { PublicKey, Transaction } from "@solana/web3.js";

export interface ExternalWallet {
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
}
export function installedWallets() {
  const w = window as unknown as { phantom?: { solana?: ExternalWallet }; solflare?: ExternalWallet };
  return [ { name:"Phantom", provider:w.phantom?.solana }, { name:"Solflare",provider:w.solflare } ]
    .filter((item): item is { name:string; provider:ExternalWallet } => !!item.provider);
}
