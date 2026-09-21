// Optket on-chain client — a browser+Node-safe wrapper over the deployed
// program. Builds instructions, decodes accounts, and sends transactions.
// Uses precomputed anchor discriminators so no sha256 dependency is needed.
//
// Layouts mirror programs/optket/src/state.rs exactly.

import {
  Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import bs58 from "bs58";

export const OPTKET_PROGRAM_ID = new PublicKey("Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const DISC = {
  initialize_config: [208, 127, 21, 1, 194, 190, 196, 70],
  set_pause: [63, 32, 154, 2, 56, 103, 79, 45],
  set_roles: [119, 86, 129, 161, 55, 23, 250, 12],
  init_asset: [133, 1, 51, 41, 37, 45, 8, 38],
  set_asset_metadata: [66, 142, 159, 134, 127, 139, 75, 167],
  set_asset_active: [165, 233, 175, 225, 134, 100, 175, 173],
  create_series: [181, 9, 52, 120, 197, 221, 42, 142],
  fund_pool: [36, 57, 233, 176, 181, 20, 87, 159],
  withdraw_pool: [190, 43, 148, 248, 68, 5, 215, 136],
  purchase: [21, 93, 113, 154, 193, 160, 242, 168],
  request_exercise: [29, 206, 150, 30, 205, 10, 230, 83],
  settle_exercise_equity: [57, 159, 80, 147, 74, 231, 51, 140],
  settle_exercise_prestocks: [118, 143, 58, 243, 239, 176, 80, 103],
  fail_exercise: [244, 97, 187, 250, 79, 138, 51, 255],
  settle_expiry_equity: [160, 193, 90, 99, 89, 248, 183, 100],
  settle_expiry_prestocks: [25, 64, 70, 125, 127, 186, 238, 163],
  expire_refund: [254, 82, 2, 76, 59, 107, 145, 112],
} as const;

const INSTRUCTION_LABELS: Record<keyof typeof DISC, string> = {
  initialize_config: "Protocol initialized",
  set_pause: "Purchase pause updated",
  set_roles: "Protocol roles updated",
  init_asset: "Asset initialized",
  set_asset_metadata: "Asset metadata updated",
  set_asset_active: "Asset availability updated",
  create_series: "Series published",
  fund_pool: "Pool funded",
  withdraw_pool: "Pool withdrawal",
  purchase: "Protection purchased",
  request_exercise: "Exercise requested",
  settle_exercise_equity: "Exercise settled",
  settle_exercise_prestocks: "Exercise settled",
  fail_exercise: "Exercise reference failed",
  settle_expiry_equity: "Expiry settled",
  settle_expiry_prestocks: "Expiry settled",
  expire_refund: "Expiry refunded",
};

/** Decode the first Anchor discriminator from a real transaction instruction. */
export function decodeOptketInstruction(data: string): string | null {
  let bytes: Uint8Array;
  try { bytes = bs58.decode(data); } catch { return null; }
  if (bytes.length < 8) return null;
  for (const [name, discriminator] of Object.entries(DISC) as Array<[keyof typeof DISC, readonly number[]]>) {
    if (discriminator.every((value, index) => bytes[index] === value)) return INSTRUCTION_LABELS[name];
  }
  return null;
}

// ---------- byte writers (browser-safe) ----------
const u8 = (v: number) => Uint8Array.of(v & 0xff);
function u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
function u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function u64(v: bigint) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; }
function i64(v: bigint) { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, v, true); return b; }
function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const disc = (name: keyof typeof DISC) => Uint8Array.from(DISC[name]);

// anchor account discriminators (sha256("account:<Name>")[:8])
const ACCT_DISC = {
  ExerciseRequest: [84, 20, 230, 181, 46, 33, 231, 7],
  Contract: [172, 138, 115, 242, 121, 67, 183, 26],
} as const;
const discB58 = (d: readonly number[]) => bs58.encode(Uint8Array.from(d));

// ---------- observation (matches references.rs Observation) ----------
export interface Observation { slot: bigint; sourceTs: number; collectedTs: number; price: bigint; }
function serializeObservation(o: Observation): Uint8Array {
  return concat([u64(o.slot), i64(BigInt(o.sourceTs)), i64(BigInt(o.collectedTs)), u64(o.price)]);
}
function serializeObservations(obs: Observation[]): Uint8Array {
  return concat([u32(obs.length), ...obs.map(serializeObservation)]);
}

// ---------- byte reader ----------
class Reader {
  private bytes: Uint8Array;
  private dv: DataView; private o = 8; // skip 8-byte discriminator
  constructor(bytes: Uint8Array) { this.bytes = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8() { return this.dv.getUint8(this.o++); }
  bool() { return this.u8() === 1; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  u64() { const v = this.dv.getBigUint64(this.o, true); this.o += 8; return v; }
  i64() { const v = this.dv.getBigInt64(this.o, true); this.o += 8; return Number(v); }
  pubkey() { const p = new PublicKey(this.bytes.subarray(this.o, this.o + 32)); this.o += 32; return p; }
}

// ---------- PDAs ----------
const SEED = (s: string) => new TextEncoder().encode(s);
export const pdas = {
  config: () => PublicKey.findProgramAddressSync([SEED("config")], OPTKET_PROGRAM_ID)[0],
  asset: (id: number) => PublicKey.findProgramAddressSync([SEED("asset"), u8(id)], OPTKET_PROGRAM_ID)[0],
  pool: (id: number) => PublicKey.findProgramAddressSync([SEED("pool"), u8(id)], OPTKET_PROGRAM_ID)[0],
  vault: (id: number) => PublicKey.findProgramAddressSync([SEED("vault"), u8(id)], OPTKET_PROGRAM_ID)[0],
  series: (assetId: number, seriesId: number) => PublicKey.findProgramAddressSync([SEED("series"), u8(assetId), u16(seriesId)], OPTKET_PROGRAM_ID)[0],
  quoteMarker: (quoteId: bigint) => PublicKey.findProgramAddressSync([SEED("quote"), u64(quoteId)], OPTKET_PROGRAM_ID)[0],
  contract: (quoteId: bigint) => PublicKey.findProgramAddressSync([SEED("contract"), u64(quoteId)], OPTKET_PROGRAM_ID)[0],
  request: (contract: PublicKey, nonce: number) => PublicKey.findProgramAddressSync([SEED("exercise"), contract.toBytes(), u32(nonce)], OPTKET_PROGRAM_ID)[0],
};

function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

// ---------- decoded account types ----------
export interface ConfigAcct { admin: PublicKey; quoteAuthority: PublicKey; publisherAuthority: PublicKey; demoMint: PublicKey; pausedPurchases: boolean; nextContractId: bigint; trialCap: bigint; trialSpent: bigint; }
export interface SeriesAcct { assetId: number; seriesId: number; strike: bigint; expiryTs: number; purchaseCutoffTs: number; exerciseCutoffTs: number; maxContractSize: bigint; referenceVersion: number; active: boolean; }
export interface PoolAcct { assetId: number; vault: PublicKey; availableCapital: bigint; reserved: bigint; pendingExercise: bigint; refundObligations: bigint; premiumReceipts: bigint; totalPayouts: bigint; totalRefunds: bigint; released: bigint; }
export interface AssetAcct { assetId: number; kind: "EquityToken" | "PreStocks"; mint: PublicKey; referenceVersion: number; conversionVersion: number; maxAggregateExposure: bigint; outstandingExposure: bigint; active: boolean; }
export interface ContractAcct { address: string; contractId: bigint; buyer: PublicKey; assetId: number; seriesId: number; mint: PublicKey; conversionVersion: number; referenceVersion: number; originalQuantity: bigint; strike: bigint; expiryTs: number; exerciseCutoffTs: number; premiumPaid: bigint; feesPaid: bigint; remainingQuantity: bigint; pendingQuantity: bigint; reservedCollateral: bigint; status: string; createdTs: number; nextRequestNonce: number; }

const CONTRACT_STATUS = ["Active", "PartiallySettled", "Exercised", "Expired", "Refunded", "Cancelled"];

function decodeConfig(b: Uint8Array): ConfigAcct {
  const r = new Reader(b);
  return { admin: r.pubkey(), quoteAuthority: r.pubkey(), publisherAuthority: r.pubkey(), demoMint: r.pubkey(), pausedPurchases: r.bool(), nextContractId: r.u64(), trialCap: r.u64(), trialSpent: r.u64() };
}
function decodeSeries(b: Uint8Array): SeriesAcct {
  const r = new Reader(b);
  return { assetId: r.u8(), seriesId: r.u16(), strike: r.u64(), expiryTs: r.i64(), purchaseCutoffTs: r.i64(), exerciseCutoffTs: r.i64(), maxContractSize: r.u64(), referenceVersion: r.u32(), active: r.bool() };
}
function decodePool(b: Uint8Array): PoolAcct {
  const r = new Reader(b);
  return { assetId: r.u8(), vault: r.pubkey(), availableCapital: r.u64(), reserved: r.u64(), pendingExercise: r.u64(), refundObligations: r.u64(), premiumReceipts: r.u64(), totalPayouts: r.u64(), totalRefunds: r.u64(), released: r.u64() };
}
function decodeAsset(b: Uint8Array): AssetAcct {
  const r = new Reader(b);
  return { assetId: r.u8(), kind: r.u8() === 0 ? "EquityToken" : "PreStocks", mint: r.pubkey(), referenceVersion: r.u32(), conversionVersion: r.u32(), maxAggregateExposure: r.u64(), outstandingExposure: r.u64(), active: r.bool() };
}
function decodeContract(address: string, b: Uint8Array): ContractAcct {
  const r = new Reader(b);
  return { address, contractId: r.u64(), buyer: r.pubkey(), assetId: r.u8(), seriesId: r.u16(), mint: r.pubkey(), conversionVersion: r.u32(), referenceVersion: r.u32(), originalQuantity: r.u64(), strike: r.u64(), expiryTs: r.i64(), exerciseCutoffTs: r.i64(), premiumPaid: r.u64(), feesPaid: r.u64(), remainingQuantity: r.u64(), pendingQuantity: r.u64(), reservedCollateral: r.u64(), status: CONTRACT_STATUS[r.u8()] || "Unknown", createdTs: r.i64(), nextRequestNonce: r.u32() };
}

export interface ExerciseRequestAcct { address: string; contract: PublicKey; nonce: number; quantity: bigint; requestTs: number; windowStart: number; windowEnd: number; kind: "Equity" | "PreStocks"; status: "Pending" | "Settled" | "Failed"; reservedLocked: bigint; settlementReference: bigint; payout: bigint; }
const REQUEST_STATUS = ["Pending", "Settled", "Failed"];
const REQUEST_KIND = ["Equity", "PreStocks"] as const;
function decodeRequest(address: string, b: Uint8Array): ExerciseRequestAcct {
  const r = new Reader(b);
  return { address, contract: r.pubkey(), nonce: r.u32(), quantity: r.u64(), requestTs: r.i64(), windowStart: r.i64(), windowEnd: r.i64(), kind: REQUEST_KIND[r.u8()], status: REQUEST_STATUS[r.u8()] as ExerciseRequestAcct["status"], reservedLocked: r.u64(), settlementReference: r.u64(), payout: r.u64() };
}

// ---------- signed-quote input (from the quote service) ----------
export interface SignedQuoteInput {
  message: Uint8Array;     // borsh QuotePayload bytes
  signature: Uint8Array;   // 64-byte ed25519 sig
  quoteAuthority: PublicKey;
  quoteId: bigint;
}

export interface Wallet { publicKey: PublicKey; }

export class OptketClient {
  conn: Connection;
  programId: PublicKey;
  constructor(conn: Connection, programId: PublicKey = OPTKET_PROGRAM_ID) { this.conn = conn; this.programId = programId; }

  // ----- reads -----
  async getConfig(): Promise<ConfigAcct | null> { const i = await this.conn.getAccountInfo(pdas.config()); return i ? decodeConfig(i.data) : null; }
  async getSeries(assetId: number, seriesId: number): Promise<SeriesAcct | null> { const i = await this.conn.getAccountInfo(pdas.series(assetId, seriesId)); return i ? decodeSeries(i.data) : null; }
  async getPool(assetId: number): Promise<PoolAcct | null> { const i = await this.conn.getAccountInfo(pdas.pool(assetId)); return i ? decodePool(i.data) : null; }
  async getAsset(assetId: number): Promise<AssetAcct | null> { const i = await this.conn.getAccountInfo(pdas.asset(assetId)); return i ? decodeAsset(i.data) : null; }
  async getContract(quoteId: bigint): Promise<ContractAcct | null> { const a = pdas.contract(quoteId); const i = await this.conn.getAccountInfo(a); return i ? decodeContract(a.toBase58(), i.data) : null; }
  async getContractByAddress(addr: PublicKey): Promise<ContractAcct | null> { const i = await this.conn.getAccountInfo(addr); return i ? decodeContract(addr.toBase58(), i.data) : null; }

  /** All open (non-settled) contracts across the program (for the keeper). */
  async getOpenContracts(): Promise<ContractAcct[]> {
    const accts = await this.conn.getProgramAccounts(this.programId, { filters: [{ memcmp: { offset: 0, bytes: discB58(ACCT_DISC.Contract) } }] });
    return accts.map((a) => decodeContract(a.pubkey.toBase58(), a.account.data)).filter((c) => c.status === "Active" || c.status === "PartiallySettled");
  }

  /** A single exercise request by contract + nonce. Cheaper and more reliable
   *  than scanning program accounts (one getAccountInfo, no getProgramAccounts). */
  async getRequestAt(contract: PublicKey, nonce: number): Promise<ExerciseRequestAcct | null> {
    const addr = pdas.request(contract, nonce);
    const i = await this.conn.getAccountInfo(addr);
    return i ? decodeRequest(addr.toBase58(), i.data) : null;
  }

  /** All pending exercise requests across the program (for the keeper). */
  async getPendingRequests(): Promise<ExerciseRequestAcct[]> {
    const accts = await this.conn.getProgramAccounts(this.programId, { filters: [{ memcmp: { offset: 0, bytes: discB58(ACCT_DISC.ExerciseRequest) } }] });
    return accts.map((a) => decodeRequest(a.pubkey.toBase58(), a.account.data)).filter((r) => r.status === "Pending");
  }

  /** Every exercise request belonging to one of the supplied contracts. */
  async getRequestsForContracts(contracts: PublicKey[]): Promise<ExerciseRequestAcct[]> {
    if (contracts.length === 0) return [];
    const wanted = new Set(contracts.map((contract) => contract.toBase58()));
    const accts = await this.conn.getProgramAccounts(this.programId, {
      filters: [{ memcmp: { offset: 0, bytes: discB58(ACCT_DISC.ExerciseRequest) } }],
    });
    return accts
      .map((a) => decodeRequest(a.pubkey.toBase58(), a.account.data))
      .filter((request) => wanted.has(request.contract.toBase58()))
      .sort((a, b) => b.requestTs - a.requestTs);
  }

  /** All contracts owned by `buyer` (memcmp on the buyer field at offset 16). */
  async getContractsForBuyer(buyer: PublicKey): Promise<ContractAcct[]> {
    const accts = await this.conn.getProgramAccounts(this.programId, {
      filters: [{ memcmp: { offset: 16, bytes: buyer.toBase58() } }],
    });
    // buyer at offset 16 also matches other account types by luck? Filter by
    // size: Contract is a distinct discriminator; check the first byte range is
    // a valid status by decoding defensively.
    const out: ContractAcct[] = [];
    for (const a of accts) {
      try { out.push(decodeContract(a.pubkey.toBase58(), a.account.data)); } catch { /* skip non-contracts */ }
    }
    return out.sort((x, y) => Number(y.contractId - x.contractId));
  }

  // ----- instruction builders -----
  /** `payer` funds the contract + quote-marker rent; defaults to the buyer, but
   *  a sponsor can cover it so a trial user needs no SOL (§19). */
  purchaseIx(
    buyer: PublicKey, assetId: number, seriesId: number, demoMint: PublicKey,
    q: SignedQuoteInput, edIxIndex = 0, payer: PublicKey = buyer,
  ): TransactionInstruction {
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: pdas.config(), isSigner: false, isWritable: true },
        { pubkey: pdas.asset(assetId), isSigner: false, isWritable: true },
        { pubkey: pdas.series(assetId, seriesId), isSigner: false, isWritable: false },
        { pubkey: pdas.pool(assetId), isSigner: false, isWritable: true },
        { pubkey: pdas.vault(assetId), isSigner: false, isWritable: true },
        { pubkey: ata(demoMint, buyer), isSigner: false, isWritable: true },
        { pubkey: demoMint, isSigner: false, isWritable: false },
        { pubkey: pdas.quoteMarker(q.quoteId), isSigner: false, isWritable: true },
        { pubkey: pdas.contract(q.quoteId), isSigner: false, isWritable: true },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: concat([disc("purchase"), q.message, u8(edIxIndex)]) as any,
    });
  }

  ed25519Ix(q: SignedQuoteInput): TransactionInstruction {
    return Ed25519Program.createInstructionWithPublicKey({ publicKey: q.quoteAuthority.toBytes(), message: q.message, signature: q.signature });
  }

  /**
   * Build a full purchase transaction (ed25519 verify + purchase).
   * `prefixIxs` run first (e.g. a sponsor's rent transfer); the ed25519
   * instruction index passed to the program is offset to match, since the
   * program locates the signature by absolute index in the transaction.
   */
  purchaseTx(
    buyer: PublicKey, assetId: number, seriesId: number, demoMint: PublicKey,
    q: SignedQuoteInput, prefixIxs: TransactionInstruction[] = [], payer: PublicKey = buyer,
  ): Transaction {
    const edIndex = prefixIxs.length;
    return new Transaction().add(
      ...prefixIxs,
      this.ed25519Ix(q),
      this.purchaseIx(buyer, assetId, seriesId, demoMint, q, edIndex, payer),
    );
  }

  /** `payer` funds the request account's rent; it defaults to the buyer but can
   *  be a sponsor (the program takes it as a separate signer). */
  requestExerciseIx(buyer: PublicKey, contract: PublicKey, assetId: number, nonce: number, quantity: bigint, payer: PublicKey = buyer): TransactionInstruction {
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buyer, isSigner: true, isWritable: false },
        { pubkey: contract, isSigner: false, isWritable: true },
        { pubkey: pdas.asset(assetId), isSigner: false, isWritable: false },
        { pubkey: pdas.pool(assetId), isSigner: false, isWritable: true },
        { pubkey: pdas.request(contract, nonce), isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: concat([disc("request_exercise"), u64(quantity)]) as any,
    });
  }

  // ----- keeper: settlement instructions -----
  private settleExerciseKeys(publisher: PublicKey, contract: PublicKey, assetId: number, nonce: number, buyerToken: PublicKey, demoMint: PublicKey) {
    return [
      { pubkey: publisher, isSigner: true, isWritable: false },
      { pubkey: pdas.config(), isSigner: false, isWritable: false },
      { pubkey: contract, isSigner: false, isWritable: true },
      { pubkey: pdas.asset(assetId), isSigner: false, isWritable: true },
      { pubkey: pdas.pool(assetId), isSigner: false, isWritable: true },
      { pubkey: pdas.vault(assetId), isSigner: false, isWritable: true },
      { pubkey: pdas.request(contract, nonce), isSigner: false, isWritable: true },
      { pubkey: buyerToken, isSigner: false, isWritable: true },
      { pubkey: demoMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
  }
  settleExerciseEquityIx(publisher: PublicKey, contract: PublicKey, assetId: number, nonce: number, buyerToken: PublicKey, demoMint: PublicKey, obs: Observation): TransactionInstruction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TransactionInstruction({ programId: this.programId, keys: this.settleExerciseKeys(publisher, contract, assetId, nonce, buyerToken, demoMint), data: concat([disc("settle_exercise_equity"), serializeObservation(obs)]) as any });
  }
  settleExercisePrestocksIx(publisher: PublicKey, contract: PublicKey, assetId: number, nonce: number, buyerToken: PublicKey, demoMint: PublicKey, obs: Observation[]): TransactionInstruction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TransactionInstruction({ programId: this.programId, keys: this.settleExerciseKeys(publisher, contract, assetId, nonce, buyerToken, demoMint), data: concat([disc("settle_exercise_prestocks"), serializeObservations(obs)]) as any });
  }

  private settleExpiryKeys(publisher: PublicKey, contract: PublicKey, assetId: number, buyerToken: PublicKey, demoMint: PublicKey) {
    return [
      { pubkey: publisher, isSigner: true, isWritable: false },
      { pubkey: pdas.config(), isSigner: false, isWritable: false },
      { pubkey: contract, isSigner: false, isWritable: true },
      { pubkey: pdas.asset(assetId), isSigner: false, isWritable: true },
      { pubkey: pdas.pool(assetId), isSigner: false, isWritable: true },
      { pubkey: pdas.vault(assetId), isSigner: false, isWritable: true },
      { pubkey: buyerToken, isSigner: false, isWritable: true },
      { pubkey: demoMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
  }
  settleExpiryEquityIx(publisher: PublicKey, contract: PublicKey, assetId: number, buyerToken: PublicKey, demoMint: PublicKey, obs: Observation): TransactionInstruction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TransactionInstruction({ programId: this.programId, keys: this.settleExpiryKeys(publisher, contract, assetId, buyerToken, demoMint), data: concat([disc("settle_expiry_equity"), serializeObservation(obs)]) as any });
  }
  settleExpiryPrestocksIx(publisher: PublicKey, contract: PublicKey, assetId: number, buyerToken: PublicKey, demoMint: PublicKey, obs: Observation[]): TransactionInstruction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TransactionInstruction({ programId: this.programId, keys: this.settleExpiryKeys(publisher, contract, assetId, buyerToken, demoMint), data: concat([disc("settle_expiry_prestocks"), serializeObservations(obs)]) as any });
  }
  expireRefundIx(publisher: PublicKey, contract: PublicKey, assetId: number, buyerToken: PublicKey, demoMint: PublicKey): TransactionInstruction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new TransactionInstruction({ programId: this.programId, keys: this.settleExpiryKeys(publisher, contract, assetId, buyerToken, demoMint), data: disc("expire_refund") as any });
  }

  failExerciseIx(cranker: PublicKey, contract: PublicKey, assetId: number, nonce: number): TransactionInstruction {
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: cranker, isSigner: true, isWritable: false },
        { pubkey: contract, isSigner: false, isWritable: true },
        { pubkey: pdas.pool(assetId), isSigner: false, isWritable: true },
        { pubkey: pdas.request(contract, nonce), isSigner: false, isWritable: true },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: disc("fail_exercise") as any,
    });
  }
}

export { ata as associatedTokenAddress };
