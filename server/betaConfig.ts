import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { MAINNET_GENESIS, USDC_MINT, readBetaPolicy } from "../src/client/betaProgram";
import { OPTKET_PROGRAM_ID } from "../src/client/optketProgram";
import { vaultPdasFor } from "../src/client/vaultProgram";

export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the private beta`);
  return value;
}
export function betaKey(name: string) {
  // No fallback to Devnet files or the user's CLI wallet.
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(required(name))));
}
export function betaConnection() {
  const endpoint = required("BETA_RPC_URL");
  if (new URL(endpoint).protocol !== "https:") throw new Error("Beta RPC must use HTTPS");
  return new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) });
}
export function betaProgram() {
  const p = new PublicKey(required("BETA_PROGRAM_ID"));
  if (p.equals(OPTKET_PROGRAM_ID)) throw new Error("Beta must use a separate program ID");
  return p;
}
export async function verifyBetaDeployment(conn: Connection, program: PublicKey) {
  if (await conn.getGenesisHash() !== MAINNET_GENESIS) throw new Error("Beta RPC is not mainnet");
  const [executable, config, mint, policy] = await Promise.all([
    conn.getAccountInfo(program), conn.getAccountInfo(vaultPdasFor(program).config()),
    conn.getAccountInfo(USDC_MINT), readBetaPolicy(conn, program),
  ]);
  if (!executable?.executable || !config?.owner.equals(program) || config.data.length < 137
    || !new PublicKey(config.data.subarray(104,136)).equals(USDC_MINT)
    || !mint || mint.data[44] !== 6 || !policy || policy.limit <= 0n) throw new Error("Beta deployment verification failed");
  return { policy, config };
}
