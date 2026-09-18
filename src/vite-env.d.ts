/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Devnet/localnet RPC the on-chain tab talks to (Vercel: set to your devnet RPC). */
  readonly VITE_RPC_URL?: string;
  /** Quote-service base URL (Vercel: set to your Railway service URL). */
  readonly VITE_QUOTE_SVC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
