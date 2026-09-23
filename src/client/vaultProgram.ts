import { Connection, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { OPTKET_PROGRAM_ID, TOKEN_PROGRAM_ID, pdas, associatedTokenAddress, type Observation } from "./optketProgram";

export const VAULT_IX = {
  create_vault_round: [98,47,87,44,138,236,161,130], deposit_vault: [126,224,21,255,228,53,117,33],
  cancel_vault_deposit: [58,225,5,220,170,38,88,85], redeem_vault: [132,70,193,151,97,115,180,195],
  activate_vault: [226,220,189,115,9,211,20,118], finalize_vault: [195,53,158,38,238,100,137,6],
  purchase_vault: [81,245,224,182,224,217,132,178], request_vault_exercise: [144,179,248,11,118,92,140,31],
  settle_vault_expiry: [17,167,157,189,21,10,37,130], refund_vault_expiry: [84,88,105,60,205,225,252,124],
  settle_vault_exercise: [4,139,80,213,149,235,163,136], fail_vault_exercise: [211,120,30,80,49,78,72,8],
} as const;
const VAULT_LABELS: Record<keyof typeof VAULT_IX, string> = {
  create_vault_round: "Vault round published", deposit_vault: "Vault deposit", cancel_vault_deposit: "Funding deposit withdrawn",
  redeem_vault: "Vault share redeemed", activate_vault: "Vault round activated", finalize_vault: "Vault round finalized",
  purchase_vault: "Vault-backed position opened", request_vault_exercise: "Vault exercise requested",
  settle_vault_expiry: "Vault expiry settled", refund_vault_expiry: "Vault premium refunded",
  settle_vault_exercise: "Vault exercise settled", fail_vault_exercise: "Vault exercise reference failed",
};
export function decodeVaultInstruction(data: string): string | null {
  let b: Uint8Array;
  try { b = bs58.decode(data); } catch { return null; }
  for (const name of Object.keys(VAULT_IX) as (keyof typeof VAULT_IX)[]) {
    if (VAULT_IX[name].every((v, i) => b[i] === v)) return VAULT_LABELS[name];
  }
  return null;
}
const ACCOUNT = { round: [241,182,175,3,89,158,50,209], deposit: [189,136,170,198,139,86,236,96],
  position: [122,109,193,63,69,148,90,237], request: [247,197,226,96,16,245,213,224] } as const;
const cat = (...parts: Uint8Array[]) => {
  const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { b.set(p, o); o += p.length; } return b;
};
const bytes = (s: string) => new TextEncoder().encode(s);
const u64 = (n: bigint) => {
  if (n < 0n || n > 18446744073709551615n) throw new Error("Amount is outside the supported range.");
  const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b;
};
const u32 = (n: number) => {
  if (!Number.isInteger(n) || n < 0 || n > 4294967295) throw new Error("Invalid request number.");
  const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b;
};
const i64 = (n: number) => { if (!Number.isSafeInteger(n)) throw new Error("Invalid timestamp."); const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const derive = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, OPTKET_PROGRAM_ID)[0];
export const vaultPdas = {
  round: (asset: number, id: bigint) => {
    if (asset !== 0 && asset !== 1) throw new Error("Unsupported vault asset.");
    return derive(bytes("underwriting-round"), Uint8Array.of(asset), u64(id));
  },
  custody: (r: PublicKey) => derive(bytes("round-custody"), r.toBytes()),
  deposit: (r: PublicKey, owner: PublicKey) => derive(bytes("round-deposit"), r.toBytes(), owner.toBytes()),
  position: (r: PublicKey, id: bigint) => derive(bytes("round-position"), r.toBytes(), u64(id)),
  request: (p: PublicKey, n: number) => derive(bytes("round-request"), p.toBytes(), u32(n)),
};
export interface VaultTerms { assetId: number; fundingClose: number; salesClose: number; latestExpiry: number;
  depositCap: bigint; exposureCap: bigint; minStrike: bigint; maxStrike: bigint; maxQuantity: bigint; }
export interface VaultRoundAccount extends VaultTerms {
  address: PublicKey; roundId: bigint; mint: PublicKey; custody: PublicKey; quoteAuthority: PublicKey;
  publisherAuthority: PublicKey; administrator: PublicKey; referenceVersion: number; pricingPolicy: Uint8Array;
  phase: "funding" | "active" | "redeemable"; totalShares: bigint; redeemedShares: bigint;
  principalAvailable: bigint; reserved: bigint; premiums: bigint; payouts: bigint; refunds: bigint;
  openContracts: bigint; finalBalance: bigint; redeemedAmount: bigint;
}
export interface VaultDepositAccount { address: PublicKey; round: PublicKey; owner: PublicKey; shares: bigint; redeemed: boolean; redemptionAmount: bigint; }
export interface VaultPositionAccount { address: PublicKey; round: PublicKey; buyer: PublicKey; quoteId: bigint;
  expiryTs: number; createdTs: number; originalQuantity: bigint; remainingQuantity: bigint; strike: bigint;
  premium: bigint; reserved: bigint; pendingQuantity: bigint; nextNonce: number; totalPayout: bigint; refundedPremium: bigint; }
export interface VaultRequestAccount { address: PublicKey; position: PublicKey; nonce: number; quantity: bigint;
  windowStart: number; windowEnd: number; status: number; reference: bigint; payout: bigint; }
class Reader {
  offset = 8;
  private b: Uint8Array;
  constructor(b: Uint8Array, kind: keyof typeof ACCOUNT) {
    this.b = b;
    if (!ACCOUNT[kind].every((v, i) => b[i] === v)) throw new Error("Unexpected vault account type.");
  }
  take(n: number) { if (this.offset + n > this.b.length) throw new Error("Incomplete vault account."); const x = this.b.slice(this.offset, this.offset + n); this.offset += n; return x; }
  key() { return new PublicKey(this.take(32)); }
  u8() { return this.take(1)[0]; }
  view(n: number) { const b = this.take(n); return new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u32() { return this.view(4).getUint32(0, true); }
  u64() { return this.view(8).getBigUint64(0, true); }
  time() { const n = Number(this.view(8).getBigInt64(0, true)); if (!Number.isSafeInteger(n)) throw new Error("Unsupported account timestamp."); return n; }
}
export function decodeVaultRound(address: PublicKey, data: Uint8Array): VaultRoundAccount {
  const r = new Reader(data, "round");
  const fixed = { address, roundId: r.u64(), mint: r.key(), custody: r.key(), quoteAuthority: r.key(),
    publisherAuthority: r.key(), administrator: r.key(), referenceVersion: r.u32(), pricingPolicy: r.take(32),
    assetId: r.u8(), fundingClose: r.time(), salesClose: r.time(), latestExpiry: r.time(), depositCap: r.u64(),
    exposureCap: r.u64(), minStrike: r.u64(), maxStrike: r.u64(), maxQuantity: r.u64() };
  const phase = (["funding", "active", "redeemable"] as const)[r.u8()];
  if (!phase || !vaultPdas.round(fixed.assetId, fixed.roundId).equals(address)) throw new Error("Invalid vault round.");
  return { ...fixed, phase, totalShares: r.u64(), redeemedShares: r.u64(), principalAvailable: r.u64(),
    reserved: r.u64(), premiums: r.u64(), payouts: r.u64(), refunds: r.u64(), openContracts: r.u64(), finalBalance: r.u64(), redeemedAmount: r.u64() };
}
export function decodeVaultDeposit(address: PublicKey, data: Uint8Array): VaultDepositAccount {
  const r = new Reader(data, "deposit");
  return { address, round: r.key(), owner: r.key(), shares: r.u64(), redeemed: r.u8() === 1, redemptionAmount: r.u64() };
}
export function decodeVaultPosition(address: PublicKey, data: Uint8Array): VaultPositionAccount {
  const r = new Reader(data, "position");
  return { address, round: r.key(), buyer: r.key(), quoteId: r.u64(), expiryTs: r.time(), createdTs: r.time(),
    originalQuantity: r.u64(), remainingQuantity: r.u64(), strike: r.u64(), premium: r.u64(), reserved: r.u64(),
    pendingQuantity: r.u64(), nextNonce: r.u32(), totalPayout: r.u64(), refundedPremium: r.u64() };
}
export function decodeVaultRequest(address: PublicKey, data: Uint8Array): VaultRequestAccount {
  const r = new Reader(data, "request");
  return { address, position: r.key(), nonce: r.u32(), quantity: r.u64(), windowStart: r.time(),
    windowEnd: r.time(), status: r.u8(), reference: r.u64(), payout: r.u64() };
}
const key = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
function ix(name: keyof typeof VAULT_IX, keys: ReturnType<typeof key>[], ...args: Uint8Array[]) {
  return new TransactionInstruction({ programId: OPTKET_PROGRAM_ID, keys, data: Buffer.from(cat(Uint8Array.from(VAULT_IX[name]), ...args)) });
}
export function vaultQuoteMessage(round: PublicKey, payload: Uint8Array) {
  if (payload.length !== 95) throw new Error("Invalid vault quote payload.");
  return cat(bytes("airbag-vault-quote-v1"), OPTKET_PROGRAM_ID.toBytes(), round.toBytes(), payload);
}
export function roundStage(r: VaultRoundAccount, now: number) {
  if (r.phase === "redeemable") return "Redeemable";
  if (now >= r.salesClose) return "Settling";
  if (r.phase === "funding") return now < r.fundingClose ? "Funding" : "Awaiting activation";
  return "Active";
}
export class VaultClient {
  readonly conn: Connection;
  constructor(conn: Connection) { this.conn = conn; }
  async getRound(address: PublicKey) {
    const a = await this.conn.getAccountInfo(address);
    if (!a) return null;
    if (!a.owner.equals(OPTKET_PROGRAM_ID)) throw new Error("Unexpected vault program owner.");
    return decodeVaultRound(address, a.data);
  }
  async getDeposit(round: PublicKey, owner: PublicKey) {
    const address = vaultPdas.deposit(round, owner), a = await this.conn.getAccountInfo(address);
    if (!a) return null;
    if (!a.owner.equals(OPTKET_PROGRAM_ID)) throw new Error("Unexpected deposit program owner.");
    return decodeVaultDeposit(address, a.data);
  }
  private async scan<T>(kind: keyof typeof ACCOUNT, decode: (a: PublicKey, d: Uint8Array) => T) {
    const accounts = await this.conn.getProgramAccounts(OPTKET_PROGRAM_ID, { filters: [
      { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(ACCOUNT[kind])) } }] });
    return accounts.map(a => decode(a.pubkey, a.account.data));
  }
  rounds() { return this.scan("round", decodeVaultRound); }
  positions() { return this.scan("position", decodeVaultPosition); }
  requests() { return this.scan("request", decodeVaultRequest); }
  createIx(admin: PublicKey, mint: PublicKey, id: bigint, t: VaultTerms, policy: Uint8Array) {
    if (policy.length !== 32 || policy.every(v => v === 0)) throw new Error("A pricing policy commitment is required.");
    const round = vaultPdas.round(t.assetId, id);
    return ix("create_vault_round", [key(admin, true, true), key(pdas.config()), key(pdas.asset(t.assetId)),
      key(round, true), key(vaultPdas.custody(round), true), key(mint), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId)],
      u64(id), Uint8Array.of(t.assetId), i64(t.fundingClose), i64(t.salesClose), i64(t.latestExpiry),
      ...[t.depositCap, t.exposureCap, t.minStrike, t.maxStrike, t.maxQuantity].map(u64), policy);
  }
  depositIx(r: Pick<VaultRoundAccount, "address" | "custody" | "mint">, owner: PublicKey, payer: PublicKey, amount: bigint) {
    return ix("deposit_vault", [key(owner, false, true), key(payer, true, true), key(pdas.config()), key(r.address, true),
      key(vaultPdas.deposit(r.address, owner), true), key(r.custody, true), key(associatedTokenAddress(r.mint, owner), true),
      key(r.mint), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId)], u64(amount));
  }
  withdrawIx(r: VaultRoundAccount, owner: PublicKey, action: "cancel" | "redeem", amount = 0n) {
    return ix(action === "cancel" ? "cancel_vault_deposit" : "redeem_vault", [key(owner, false, true), key(r.address, true),
      key(vaultPdas.deposit(r.address, owner), true), key(r.custody, true), key(associatedTokenAddress(r.mint, owner), true),
      key(r.mint), key(TOKEN_PROGRAM_ID)], ...(action === "cancel" ? [u64(amount)] : []));
  }
  advanceIx(r: VaultRoundAccount, cranker: PublicKey, action: "activate" | "finalize") {
    return ix(action === "activate" ? "activate_vault" : "finalize_vault", [key(cranker, false, true),
      key(pdas.config()), key(r.address, true), key(r.custody)]);
  }
  purchaseIx(r: VaultRoundAccount, buyer: PublicKey, payer: PublicKey, payload: Uint8Array, quoteId: bigint, edIndex: number, maxPremium: bigint) {
    if (payload.length !== 95 || !Number.isInteger(edIndex) || edIndex < 0 || edIndex > 255) throw new Error("Invalid quote.");
    return ix("purchase_vault", [key(buyer, false, true), key(payer, true, true), key(pdas.config()), key(r.address, true),
      key(pdas.asset(r.assetId), true), key(vaultPdas.position(r.address, quoteId), true), key(r.custody, true),
      key(associatedTokenAddress(r.mint, buyer), true), key(r.mint), key(SYSVAR_INSTRUCTIONS_PUBKEY), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId)],
      payload, Uint8Array.of(edIndex), u64(maxPremium));
  }
  requestIx(p: VaultPositionAccount, payer: PublicKey, quantity: bigint) {
    return ix("request_vault_exercise", [key(p.buyer, false, true), key(payer, true, true), key(p.address, true),
      key(vaultPdas.request(p.address, p.nextNonce), true), key(SystemProgram.programId)], u64(quantity));
  }
  settleIx(r: VaultRoundAccount, p: VaultPositionAccount, observations: Observation[] | null, request?: VaultRequestAccount) {
    const keys = [key(r.publisherAuthority, false, true), key(p.address, true), key(r.address, true), key(pdas.asset(r.assetId), true),
      key(r.custody, true), key(associatedTokenAddress(r.mint, p.buyer), true), key(r.mint), key(TOKEN_PROGRAM_ID)];
    if (request) keys.push(key(request.address, true));
    const encoded = observations ? [u32(observations.length), ...observations.map(o => cat(u64(o.slot), i64(o.sourceTs), i64(o.collectedTs), u64(o.price)))] : [];
    return ix(request ? "settle_vault_exercise" : observations ? "settle_vault_expiry" : "refund_vault_expiry", keys, ...encoded);
  }
  failRequestIx(p: VaultPositionAccount, request: VaultRequestAccount, cranker: PublicKey) {
    return ix("fail_vault_exercise", [key(cranker, false, true), key(p.address, true), key(request.address, true)]);
  }
}
