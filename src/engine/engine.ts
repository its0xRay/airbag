// Optket protection engine — a deterministic, pure-TypeScript mirror of the
// on-chain program (programs/optket/src). Same arithmetic, same accounting
// invariants, same lifecycle. It is an executable specification used by the
// vitest suite; the web app does not use it as a runtime fallback.

import {
  maxLiability,
  payout as intrinsicPayout,
  proportionalPremium,
  proportionalRelease,
} from "./fixed";
import {
  EQUITY_MAX_DELAY_SECS,
  EQUITY_MAX_SAMPLE_AGE_SECS,
  PRESTOCKS_WINDOW_SECS,
  validateEquity,
  validatePrestocksMedian,
} from "./references";
import { MAX_QUOTE_TTL_SECS } from "./quote";
import type {
  AssetConfig,
  Contract,
  ExerciseRequest,
  Observation,
  Pool,
  QuotePayload,
  Series,
} from "./types";

export class EngineError extends Error {}

function req(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new EngineError(msg);
}

export interface EngineConfig {
  quoteAuthority: string;
  publisherAuthority: string;
  admin: string;
  pausedPurchases: boolean;
  trialCap: bigint;
  trialSpent: bigint;
}

const seriesKey = (assetId: number, seriesId: number) => `${assetId}:${seriesId}`;

export class OptketEngine {
  config: EngineConfig;
  assets = new Map<number, AssetConfig>();
  series = new Map<string, Series>();
  pools = new Map<number, Pool>();
  contracts = new Map<string, Contract>();
  usedQuoteIds = new Set<string>();
  private nextContractId = 1n;
  private clock: number;

  constructor(config: EngineConfig, startTs: number) {
    this.config = config;
    this.clock = startTs;
  }

  now(): number {
    return this.clock;
  }
  setNow(ts: number) {
    this.clock = ts;
  }
  advance(secs: number) {
    this.clock += secs;
  }

  // ---- admin / setup ----
  addAsset(a: AssetConfig) {
    this.assets.set(a.assetId, a);
    if (!this.pools.has(a.assetId)) {
      this.pools.set(a.assetId, {
        assetId: a.assetId,
        vaultBalance: 0n,
        availableCapital: 0n,
        reserved: 0n,
        pendingExercise: 0n,
        refundObligations: 0n,
        premiumReceipts: 0n,
        totalPayouts: 0n,
        totalRefunds: 0n,
        released: 0n,
      });
    }
  }
  addSeries(s: Series) {
    this.series.set(seriesKey(s.assetId, s.seriesId), s);
  }
  fundPool(assetId: number, amount: bigint) {
    const p = this.pool(assetId);
    p.availableCapital += amount;
    p.vaultBalance += amount;
  }
  withdrawPool(assetId: number, amount: bigint) {
    const p = this.pool(assetId);
    // Cannot withdraw below outstanding obligations (PRD §12).
    req(p.availableCapital >= amount, "withdrawal below obligations");
    p.availableCapital -= amount;
    p.vaultBalance -= amount;
  }
  setPaused(paused: boolean) {
    this.config.pausedPurchases = paused;
  }

  pool(assetId: number): Pool {
    const p = this.pools.get(assetId);
    if (!p) throw new EngineError(`no pool for asset ${assetId}`);
    return p;
  }
  getSeries(assetId: number, seriesId: number): Series {
    const s = this.series.get(seriesKey(assetId, seriesId));
    if (!s) throw new EngineError(`no series ${assetId}:${seriesId}`);
    return s;
  }
  contract(id: bigint): Contract {
    const c = this.contracts.get(id.toString());
    if (!c) throw new EngineError(`no contract ${id}`);
    return c;
  }

  // ---- purchase (PRD §8) ----
  purchase(quote: QuotePayload): Contract {
    const now = this.now();
    req(!this.config.pausedPurchases, "purchases paused");
    const asset = this.assets.get(quote.assetId);
    req(!!asset, "unknown asset");
    req(asset!.active, "asset inactive");
    const series = this.getSeries(quote.assetId, quote.seriesId);

    req(now <= series.purchaseCutoffTs, "purchase cutoff passed");
    req(now <= quote.quoteExpiryTs, "quote expired");
    req(quote.quoteExpiryTs - now <= MAX_QUOTE_TTL_SECS, "quote ttl too long");

    req(quote.strike === series.strike, "quote terms mismatch: strike");
    req(quote.expiryTs === series.expiryTs, "quote terms mismatch: expiry");
    req(quote.referenceVersion === series.referenceVersion, "quote terms mismatch: refversion");

    req(quote.quantity > 0n, "zero quantity");
    req(quote.fees === 0n, "fees must be zero");
    req(quote.quantity <= series.maxContractSize, "contract size exceeded");

    req(!this.usedQuoteIds.has(quote.quoteId.toString()), "quote replay");

    const liability = maxLiability(quote.quantity, quote.strike);
    const pool = this.pool(quote.assetId);
    // pool.reserved is numerically the asset outstanding exposure.
    req(pool.reserved + liability <= asset!.maxAggregateExposure, "aggregate exposure exceeded");
    req(pool.availableCapital >= liability, "insufficient collateral");

    // reserve + take premium (atomic on-chain)
    pool.availableCapital -= liability;
    pool.reserved += liability;
    pool.availableCapital += quote.premium;
    pool.vaultBalance += quote.premium;
    pool.premiumReceipts += quote.premium;

    const contractId = this.nextContractId++;
    const contract: Contract = {
      contractId,
      buyer: quote.buyer,
      assetId: quote.assetId,
      seriesId: quote.seriesId,
      conversionVersion: asset!.conversionVersion,
      referenceVersion: quote.referenceVersion,
      originalQuantity: quote.quantity,
      strike: quote.strike,
      expiryTs: quote.expiryTs,
      exerciseCutoffTs: series.exerciseCutoffTs,
      premiumPaid: quote.premium,
      feesPaid: quote.fees,
      remainingQuantity: quote.quantity,
      pendingQuantity: 0n,
      reservedCollateral: liability,
      status: "Active",
      createdTs: now,
      nextRequestNonce: 0,
      requests: [],
    };
    this.contracts.set(contractId.toString(), contract);
    this.usedQuoteIds.add(quote.quoteId.toString());
    this.checkInvariants(quote.assetId);
    return contract;
  }

  // ---- request exercise (PRD §10) ----
  requestExercise(contractId: bigint, quantity: bigint): ExerciseRequest {
    const now = this.now();
    const c = this.contract(contractId);
    req(c.status === "Active" || c.status === "PartiallySettled", "contract not active");
    req(now <= c.exerciseCutoffTs, "exercise cutoff passed");
    req(quantity > 0n, "zero quantity");
    req(quantity <= c.remainingQuantity, "exceeds remaining");

    const asset = this.assets.get(c.assetId)!;
    const kind = asset.kind === "EquityToken" ? "Equity" : "PreStocks";
    const windowStart = now;
    const windowEnd =
      asset.kind === "EquityToken" ? now + EQUITY_MAX_DELAY_SECS : now + PRESTOCKS_WINDOW_SECS;

    const locked = proportionalRelease(c.reservedCollateral, c.originalQuantity, c.strike, quantity, false);
    const pool = this.pool(c.assetId);
    req(pool.reserved >= pool.pendingExercise + locked, "pending exceeds reserved");
    pool.pendingExercise += locked;

    c.remainingQuantity -= quantity;
    c.pendingQuantity += quantity;

    const request: ExerciseRequest = {
      contractId,
      nonce: c.nextRequestNonce++,
      quantity,
      requestTs: now,
      windowStart,
      windowEnd,
      kind: kind as ExerciseRequest["kind"],
      status: "Pending",
      reservedLocked: locked,
      settlementReference: 0n,
      payout: 0n,
    };
    c.requests.push(request);
    this.checkInvariants(c.assetId);
    return request;
  }

  private findRequest(c: Contract, nonce: number): ExerciseRequest {
    const r = c.requests.find((x) => x.nonce === nonce);
    if (!r) throw new EngineError(`no request ${nonce}`);
    return r;
  }

  private applyExerciseSettlement(c: Contract, r: ExerciseRequest, settlement: bigint): bigint {
    req(r.status === "Pending", "request not pending");
    const pool = this.pool(c.assetId);
    const isFinal = c.remainingQuantity === 0n && c.pendingQuantity === r.quantity;
    const releaseAmt = isFinal ? c.reservedCollateral : r.reservedLocked;
    const payout = intrinsicPayout(r.quantity, c.strike, settlement);
    req(payout <= releaseAmt, "payout exceeds release (invariant)");
    const residual = releaseAmt - payout;

    // pool accounting
    pool.pendingExercise -= r.reservedLocked;
    pool.reserved -= payout;
    pool.totalPayouts += payout;
    pool.vaultBalance -= payout;
    if (residual > 0n) {
      pool.reserved -= residual;
      pool.availableCapital += residual;
      pool.released += residual;
    }

    // contract accounting — extinguish settled quantity
    c.pendingQuantity -= r.quantity;
    c.reservedCollateral -= releaseAmt;
    c.status = c.remainingQuantity === 0n && c.pendingQuantity === 0n ? "Exercised" : "PartiallySettled";

    r.status = "Settled";
    r.settlementReference = settlement;
    r.payout = payout;
    this.checkInvariants(c.assetId);
    return payout;
  }

  settleExerciseEquity(contractId: bigint, nonce: number, obs: Observation): bigint {
    const c = this.contract(contractId);
    const r = this.findRequest(c, nonce);
    req(r.kind === "Equity", "wrong reference path");
    const settlement = validateEquity(obs, r.windowStart, r.windowEnd, true, EQUITY_MAX_SAMPLE_AGE_SECS);
    return this.applyExerciseSettlement(c, r, settlement);
  }

  settleExercisePrestocks(contractId: bigint, nonce: number, observations: Observation[]): bigint {
    const c = this.contract(contractId);
    const r = this.findRequest(c, nonce);
    req(r.kind === "PreStocks", "wrong reference path");
    const settlement = validatePrestocksMedian(observations, r.windowStart, r.windowEnd, true);
    return this.applyExerciseSettlement(c, r, settlement);
  }

  failExercise(contractId: bigint, nonce: number) {
    const now = this.now();
    const c = this.contract(contractId);
    const r = this.findRequest(c, nonce);
    req(r.status === "Pending", "request not pending");
    req(now > r.windowEnd, "reference window not elapsed");

    c.pendingQuantity -= r.quantity;
    c.remainingQuantity += r.quantity;
    this.pool(c.assetId).pendingExercise -= r.reservedLocked;
    r.status = "Failed";
    this.checkInvariants(c.assetId);
  }

  // ---- expiry & refunds (PRD §11) ----
  private applyExpirySettlement(c: Contract, settlement: bigint): bigint {
    const now = this.now();
    req(now >= c.expiryTs, "expiry not reached");
    req(c.pendingQuantity === 0n, "pending requests outstanding");
    const q = c.remainingQuantity;
    req(q > 0n, "nothing remaining");

    const pool = this.pool(c.assetId);
    const releaseAmt = c.reservedCollateral;
    const payout = intrinsicPayout(q, c.strike, settlement);
    req(payout <= releaseAmt, "payout exceeds release (invariant)");
    const residual = releaseAmt - payout;

    pool.reserved -= payout;
    pool.totalPayouts += payout;
    pool.vaultBalance -= payout;
    if (residual > 0n) {
      pool.reserved -= residual;
      pool.availableCapital += residual;
      pool.released += residual;
    }

    c.remainingQuantity = 0n;
    c.reservedCollateral = 0n;
    c.status = "Expired";
    this.checkInvariants(c.assetId);
    return payout;
  }

  settleExpiryEquity(contractId: bigint, obs: Observation): bigint {
    const c = this.contract(contractId);
    const settlement = validateEquity(
      obs,
      c.expiryTs,
      c.expiryTs + EQUITY_MAX_DELAY_SECS,
      false,
      EQUITY_MAX_SAMPLE_AGE_SECS,
    );
    return this.applyExpirySettlement(c, settlement);
  }

  settleExpiryPrestocks(contractId: bigint, observations: Observation[]): bigint {
    const c = this.contract(contractId);
    const settlement = validatePrestocksMedian(
      observations,
      c.expiryTs - PRESTOCKS_WINDOW_SECS,
      c.expiryTs,
      false,
    );
    return this.applyExpirySettlement(c, settlement);
  }

  /** Demo refund for an invalid expiry reference (PRD §11.2). */
  expireRefund(contractId: bigint): bigint {
    const now = this.now();
    const c = this.contract(contractId);
    req(now >= c.expiryTs, "expiry not reached");
    req(c.pendingQuantity === 0n, "pending requests outstanding");
    const q = c.remainingQuantity;
    req(q > 0n, "nothing remaining");

    const refund = proportionalPremium(c.premiumPaid, q, c.originalQuantity);
    const releaseAmt = c.reservedCollateral;
    const pool = this.pool(c.assetId);

    pool.reserved -= releaseAmt;
    pool.availableCapital += releaseAmt;
    pool.released += releaseAmt;
    req(pool.availableCapital >= refund, "insufficient capital for refund");
    pool.availableCapital -= refund;
    pool.vaultBalance -= refund;
    pool.totalRefunds += refund;

    c.remainingQuantity = 0n;
    c.reservedCollateral = 0n;
    c.status = "Refunded";
    this.checkInvariants(c.assetId);
    return refund;
  }

  // ---- invariants (PRD §12, §22) ----
  checkInvariants(assetId: number) {
    const p = this.pool(assetId);
    // vault balance must equal available + reserved + refund obligations.
    const sum = p.availableCapital + p.reserved + p.refundObligations;
    req(p.vaultBalance === sum, `vault invariant: ${p.vaultBalance} != ${sum}`);
    req(p.pendingExercise <= p.reserved, "pending exceeds reserved");
    req(p.availableCapital >= 0n && p.reserved >= 0n, "negative pool balance");

    // reserved must equal the sum of open contracts' reserved_collateral.
    let sumReserved = 0n;
    for (const c of this.contracts.values()) {
      if (c.assetId !== assetId) continue;
      sumReserved += c.reservedCollateral;
    }
    req(p.reserved === sumReserved, `reserved mismatch: ${p.reserved} != ${sumReserved}`);
  }
}
