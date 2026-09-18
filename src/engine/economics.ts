// Underwriter economics (PRD §17). Separates REALIZED demo-contract outcomes
// (from the pool) from MODELED economics (from documented assumptions). Hedge
// access is explicitly flagged available vs assumed so costs and losses are
// never double-counted.

import { fromFixed } from "./fixed";
import type { OptketEngine } from "./engine";
import { ASSUMPTIONS } from "./pricing";

export interface UnderwriterEconomics {
  assetId: number;
  // realized (demo, actual)
  premiumReceipts: number;
  grossPayouts: number;
  refunds: number;
  realizedNet: number;
  // capital
  availableCapital: number;
  reservedCapital: number;
  utilization: number; // 0..1
  // modeled
  hedgeAvailable: boolean;
  modeledHedgeResult: number;
  executionFundingCost: number;
  operatingExpense: number;
  capitalOpportunityCost: number;
  riskAllowance: number;
  modeledNetUnhedged: number;
  modeledNetHedged: number | null; // null when no executable hedge
  // stress
  stressLossAtMinus20pct: number;
}

export function underwriterEconomics(engine: OptketEngine, assetId: number): UnderwriterEconomics {
  const p = engine.pool(assetId);
  const a = ASSUMPTIONS[assetId];

  const premiumReceipts = fromFixed(p.premiumReceipts);
  const grossPayouts = fromFixed(p.totalPayouts);
  const refunds = fromFixed(p.totalRefunds);
  const realizedNet = premiumReceipts - grossPayouts - refunds;

  const availableCapital = fromFixed(p.availableCapital);
  const reservedCapital = fromFixed(p.reserved);
  const totalCapital = availableCapital + reservedCapital;
  const utilization = totalCapital > 0 ? reservedCapital / totalCapital : 0;

  // Modeled costs are expressed against committed reserve (bps) plus premium.
  const executionFundingCost = (reservedCapital * a.executionFundingBps) / 10_000;
  const operatingExpense = (reservedCapital * a.opsBps) / 10_000;
  const capitalOpportunityCost = (reservedCapital * a.capitalCostBps) / 10_000;
  const riskAllowance = (reservedCapital * a.riskAllowanceBps) / 10_000;

  // Modeled hedge: only meaningful where a hedge is actually executable.
  const hedgeAvailable = a.hedgeAvailable;
  const modeledHedgeResult = hedgeAvailable ? (reservedCapital * a.hedgeCostBps) / 10_000 * -1 : 0;

  // Unhedged net = realized net minus modeled operating/capital/risk loadings.
  const modeledNetUnhedged =
    realizedNet - executionFundingCost - operatingExpense - capitalOpportunityCost - riskAllowance;

  // Hedged net adds the hedge P&L but must NOT double-count payout offset here;
  // the hedge cost is the only modeled hedge term (no executable payout offset
  // is claimed in the demo).
  const modeledNetHedged = hedgeAvailable ? modeledNetUnhedged + modeledHedgeResult : null;

  // Stress: reference falls 20% below strike across committed reserve.
  const stressLossAtMinus20pct = reservedCapital * 0.2;

  return {
    assetId,
    premiumReceipts,
    grossPayouts,
    refunds,
    realizedNet,
    availableCapital,
    reservedCapital,
    utilization,
    hedgeAvailable,
    modeledHedgeResult,
    executionFundingCost,
    operatingExpense,
    capitalOpportunityCost,
    riskAllowance,
    modeledNetUnhedged,
    modeledNetHedged,
    stressLossAtMinus20pct,
  };
}
