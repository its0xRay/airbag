import { payout, maxLiability } from "./fixed";

/** Comparison in six-decimal model units, NOT a USD valuation of oUSD.
 * Assumes the token market price equals the hypothetical reference. */
export function combinedOutcome(holdings: bigint, protectedQuantity: bigint, floor: bigint, reference: bigint, premium: bigint) {
  if ([holdings, protectedQuantity, floor, reference, premium].some(v => v < 0n)) throw new Error("Scenario inputs must be non-negative.");
  const holdingsValue = maxLiability(holdings, reference);
  const protectionPayout = payout(protectedQuantity, floor, reference);
  return { holdingsValue, protectionPayout, premium, combinedModelValue: holdingsValue + protectionPayout - premium };
}
