// Premium model. Prices are MODELLED from documented, versioned assumptions —
// separate per asset. This runs off-chain (the quote
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
    version: 2,
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
    version: 2,
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

/** Stable normal CDF approximation for the zero-rate Black-Scholes put. */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

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

  // A zero-rate Black-Scholes put makes floor selection economically legible:
  // lower out-of-the-money floors get materially cheaper, while an in-the-money
  // floor can never be priced below its intrinsic value.
  const spotN = fromFixed(spot);
  const strikeN = fromFixed(strike);
  const sigmaT = (a.weeklyVolBps / 10_000) * timeFactor;
  let putPerUnit = Math.max(strikeN - spotN, 0);
  if (spotN > 0 && strikeN > 0 && sigmaT > 1e-8) {
    const d1 = (Math.log(spotN / strikeN) + 0.5 * sigmaT * sigmaT) / sigmaT;
    const d2 = d1 - sigmaT;
    putPerUnit = Math.max(putPerUnit, strikeN * normalCdf(-d2) - spotN * normalCdf(-d1));
  }
  const volatility = strikeN > 0 ? Math.min(10_000, (putPerUnit / strikeN) * 10_000) : 0;

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
