// Fixed-point integer arithmetic — a faithful TypeScript mirror of the on-chain
// `math.rs` module (PRD §6.3). All values are BigInt base units. Reserve
// requirements round UP; payouts round DOWN.
//
// Conventions (must match programs/optket/src/constants.rs):
//   PRICE_ONE = QTY_ONE = TOKEN_ONE = 1e6
//   SCALE_DIVISOR = QTY_ONE * PRICE_ONE / TOKEN_ONE = 1e6

export const PRICE_DECIMALS = 6;
export const QTY_DECIMALS = 6;
export const TOKEN_DECIMALS = 6;

export const PRICE_ONE = 1_000_000n;
export const QTY_ONE = 1_000_000n;
export const TOKEN_ONE = 1_000_000n;
export const SCALE_DIVISOR = (QTY_ONE * PRICE_ONE) / TOKEN_ONE; // 1_000_000n

/** Convert a human decimal (e.g. 172.5) to fixed-point base units. */
export function toFixed(value: number, decimals = 6): bigint {
  // Avoid float drift by string-splitting.
  const neg = value < 0;
  const s = Math.abs(value).toFixed(decimals);
  const [int, frac = ""] = s.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const out = BigInt(int) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return neg ? -out : out;
}

/** Convert fixed-point base units back to a JS number for display only. */
export function fromFixed(value: bigint, decimals = 6): number {
  return Number(value) / 10 ** decimals;
}

/** Maximum liability = quantity * strike, rounded UP (PRD §6.2). */
export function maxLiability(qty: bigint, strike: bigint): bigint {
  const num = qty * strike;
  return (num + (SCALE_DIVISOR - 1n)) / SCALE_DIVISOR;
}

/** Intrinsic payout = quantity * max(strike - settlement, 0), rounded DOWN (§6.1). */
export function payout(qty: bigint, strike: bigint, settlement: bigint): bigint {
  if (settlement >= strike) return 0n;
  const delta = strike - settlement;
  return (qty * delta) / SCALE_DIVISOR;
}

/** Premium attributable to a portion of the original quantity, rounded DOWN (§11.2). */
export function proportionalPremium(
  premiumPaid: bigint,
  portionQty: bigint,
  originalQty: bigint,
): bigint {
  if (originalQty === 0n) throw new Error("original quantity is zero");
  if (portionQty === 0n) return 0n;
  return (premiumPaid * portionQty) / originalQty;
}

/** Proportional reserve release for a quantity (mirrors exercise.rs). */
export function proportionalRelease(
  reservedCollateral: bigint,
  originalQty: bigint,
  strike: bigint,
  q: bigint,
  isFinal: boolean,
): bigint {
  if (isFinal) return reservedCollateral;
  const l0 = maxLiability(originalQty, strike);
  const prop = (l0 * q) / originalQty;
  return prop < reservedCollateral ? prop : reservedCollateral;
}

/** Median of prices (input need not be sorted); even count averages, rounds DOWN. */
export function median(values: bigint[]): bigint {
  if (values.length === 0) throw new Error("no observations");
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  const a = sorted[n / 2 - 1];
  const b = sorted[n / 2];
  return (a + b) / 2n;
}
