import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { VaultClient } from "./vaultProgram";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const BETA_WALLET_LIMIT = 10_000_000n;
export const BETA_TESTER_LIMIT = 20_000_000n;
export const BETA_SEED_LIMIT = 25_000_000n;
const ACCESS_DISC = [135,32,115,79,43,227,204,122];
const POLICY_DISC = [8,136,151,20,70,236,17,160];
const seed = (s: string) => new TextEncoder().encode(s);
export const betaPdas = (program: PublicKey) => ({
  policy: PublicKey.findProgramAddressSync([seed("beta-policy")], program)[0],
  access: (owner: PublicKey) => PublicKey.findProgramAddressSync([seed("beta-access"), owner.toBytes()], program)[0],
});
export function withBetaAccounts(ix: TransactionInstruction, owner: PublicKey) {
  const p = betaPdas(ix.programId);
  ix.keys.push({ pubkey: p.policy, isSigner: false, isWritable: true }, { pubkey: p.access(owner), isSigner: false, isWritable: true });
  return ix;
}
export function seedVaultIx(client: VaultClient, round: Parameters<VaultClient["depositIx"]>[0], admin: PublicKey, amount: bigint) {
  if (amount <= 0n || amount > BETA_SEED_LIMIT) throw new Error("Seed amount must be above zero and at most 25 USDC.");
  const ix = client.depositIx(round, admin, admin, amount);
  ix.data.set([181,183,221,107,162,110,142,222], 0);
  return withBetaAccounts(ix, admin);
}
async function account(conn: Connection, program: PublicKey, address: PublicKey, disc: number[], length: number) {
  const info = await conn.getAccountInfo(address);
  if (!info) return null;
  if (!info.owner.equals(program) || info.data.length !== length || !disc.every((v, i) => info.data[i] === v)) throw new Error("Invalid beta policy account.");
  return info.data;
}
export async function readBetaPolicy(conn: Connection, program: PublicKey) {
  const b = await account(conn, program, betaPdas(program).policy, POLICY_DISC, 64);
  if (!b) return null;
  const limit = BigInt(b.readBigUInt64LE(40).toString()), used = BigInt(b.readBigUInt64LE(48).toString()), seedUsed = BigInt(b.readBigUInt64LE(56).toString());
  if (limit <= 0n || limit > BETA_TESTER_LIMIT || used > limit || seedUsed > BETA_SEED_LIMIT) throw new Error("Invalid beta limits.");
  return { authority: new PublicKey(b.subarray(8,40)), limit, used, seedUsed, seedLimit: BETA_SEED_LIMIT };
}
export async function readBetaAccess(conn: Connection, program: PublicKey, owner: PublicKey) {
  const b = await account(conn, program, betaPdas(program).access(owner), ACCESS_DISC, 49);
  if (!b) return null;
  if (!new PublicKey(b.subarray(8,40)).equals(owner) || b[48] > 1) throw new Error("Invalid beta wallet account.");
  return { used: b.readBigUInt64LE(40), enabled: b[48] === 1 };
}
export function setBetaAccessIx(program: PublicKey, authority: PublicKey, owner: PublicKey, enabled: boolean) {
  const p = betaPdas(program);
  return new TransactionInstruction({ programId: program, keys: [
    { pubkey: authority, isSigner: true, isWritable: true }, { pubkey: p.policy, isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: p.access(owner), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.from([153,141,241,39,28,122,186,152,Number(enabled)]) });
}
export function initializeBetaPolicyIx(program: PublicKey, admin: PublicKey, authority: PublicKey, total: bigint) {
  if (total <= 0n || total > BETA_TESTER_LIMIT) throw new Error("Explicit beta cap between zero and 20 USDC required (exclusive of zero).");
  const data = Buffer.alloc(48); data.set([117,126,88,28,175,22,46,63]); data.set(authority.toBytes(),8); new DataView(data.buffer,data.byteOffset,data.byteLength).setBigUint64(40,total,true);
  return new TransactionInstruction({ programId: program, data, keys: [
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: PublicKey.findProgramAddressSync([seed("config")], program)[0], isSigner: false, isWritable: false },
    { pubkey: betaPdas(program).policy, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ] });
}
