// Premium model (PRD §8.3). Prices are SIMULATED and based on documented,
// versioned assumptions — separate per asset. This runs off-chain (the quote
// service); the program never recomputes premium, it only verifies the signed
// quote. An unavailable hedge is modeled as a cost loading, never as executable.

import { maxLiability, fromFixed } from "./fixed";

const SECONDS_PER_WEEK = 7 * 24 * 3600;

/** Documented, versioned pricing assumptions for one asset (PRD §8.3). */
export interface AssumptionSet {
  version: number;
  /** 1-week at-the-money volatility, in basis points of the reference. */
  weeklyVolBps: number;
  /** Jump / event-risk loading (bps of notional). */
  jumpEventBps: number;
  /** Early-exercise value loading (bps). */
  earlyExerciseBps: number;
  /** Assumed hedge cost; for assets with no executable hedge this is the cost
   *  of NOT hedging (adverse-selection allowance), never modeled as executable. */
  hedgeCostBps: number;
  hedgeAvailable: boolean;
  /** Execution + funding costs (bps). */
  executionFundingBps: number;
  /** Operating expenses (bps). */
  opsBps: number;
  /** Capital opportunity cost (bps of committed reserve). */
  capitalCostBps: number;
  /** Residual risk allowance / margin (bps). */
  riskAllowanceBps: number;
}

export const ASSUMPTIONS: Record<number, AssumptionSet> = {
  // asset 0 — public-equity token (lower vol, hedge investigable)
  0: {
    version: 1,
    weeklyVolBps: 320,
    jumpEventBps: 25,
    earlyExerciseBps: 15,
    hedgeCostBps: 20,
    hedgeAvailable: true,
    executionFundingBps: 10,
    opsBps: 8,
    capitalCostBps: 12,
    riskAllowanceBps: 30,
  },
  // asset 1 — PreStocks token (higher vol, no executable hedge)
  1: {
    version: 1,
    weeklyVolBps: 650,
    jumpEventBps: 90,
    earlyExerciseBps: 25,
    hedgeCostBps: 0,
    hedgeAvailable: false,
    executionFundingBps: 15,
    opsBps: 8,
    capitalCostBps: 18,
    riskAllowanceBps: 120,
  },
};

/** ATM put approximation factor: put ≈ 0.4 * vol * sqrt(T) for near-the-money. */
const ATM_PUT_FACTOR = 0.4;

export interface PremiumBreakdown {
  premium: bigint;
  notional: bigint;
  rateBps: number;
  components: {
    volatility: number;
    jumpEvent: number;
    earlyExercise: number;
    hedge: number;
    executionFunding: number;
    ops: number;
    capitalCost: number;
    riskAllowance: number;
  };
}

/**
 * Quote a premium (token base units) for `qty` at `strike`, with `spot` the
 * current reference, `secondsToExpiry` remaining. Deterministic.
 */
export function quotePremium(
  assetId: number,
  qty: bigint,
  strike: bigint,
  spot: bigint,
  secondsToExpiry: number,
): PremiumBreakdown {
  const a = ASSUMPTIONS[assetId];
  if (!a) throw new Error(`no assumptions for asset ${assetId}`);

  const notional = maxLiability(qty, strike); // committed reserve == notional
  const t = Math.max(secondsToExpiry, 0) / SECONDS_PER_WEEK;
  const timeFactor = Math.sqrt(t);

  // Moneyness: puts get cheaper out-of-the-money (strike below spot), dearer
  // in-the-money. Clamp to a sane multiplier band.
  const spotN = fromFixed(spot);
  const strikeN = fromFixed(strike);
  const moneyness = spotN > 0 ? strikeN / spotN : 1; // >1 = ITM put
  const moneynessMult = Math.min(2.5, Math.max(0.15, 0.5 + moneyness));

  const volatility = a.weeklyVolBps * ATM_PUT_FACTOR * timeFactor * moneynessMult;

  const components = {
    volatility,
    jumpEvent: a.jumpEventBps * timeFactor,
    earlyExercise: a.earlyExerciseBps,
    hedge: a.hedgeCostBps,
    executionFunding: a.executionFundingBps,
    ops: a.opsBps,
    capitalCost: a.capitalCostBps * timeFactor,
    riskAllowance: a.riskAllowanceBps,
  };

  const rateBps =
    components.volatility +
    components.jumpEvent +
    components.earlyExercise +
    components.hedge +
    components.executionFunding +
    components.ops +
    components.capitalCost +
    components.riskAllowance;

  // premium = notional * rate/10000, rounded to base units.
  const premium = (notional * BigInt(Math.round(rateBps * 100))) / 1_000_000n;

  return { premium, notional, rateBps, components };
}
