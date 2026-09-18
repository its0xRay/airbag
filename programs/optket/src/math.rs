//! Overflow-safe, deterministic fixed-point arithmetic for Optket (PRD §6.3).
//!
//! All public helpers return `Result<u64, OptketError>` and use `u128`
//! intermediates. Reserve requirements round **up**; payouts round **down**.

use crate::constants::SCALE_DIVISOR;
use crate::errors::OptketError;

type MathResult = core::result::Result<u64, OptketError>;

#[inline]
fn to_u64(v: u128) -> MathResult {
    u64::try_from(v).map_err(|_| OptketError::MathOverflow)
}

/// Maximum liability for a quantity at a strike (PRD §6.2).
/// `Maximum liability = quantity * strike`, assuming a nonnegative reference.
/// Reserve requirements round **up** so the pool is never under-reserved.
pub fn max_liability(qty: u64, strike: u64) -> MathResult {
    let num = (qty as u128)
        .checked_mul(strike as u128)
        .ok_or(OptketError::MathOverflow)?;
    // Round up.
    let val = num
        .checked_add(SCALE_DIVISOR - 1)
        .ok_or(OptketError::MathOverflow)?
        / SCALE_DIVISOR;
    to_u64(val)
}

/// Intrinsic payout (PRD §6.1): `quantity * max(strike - settlement, 0)`.
/// Payouts round **down**.
pub fn payout(qty: u64, strike: u64, settlement: u64) -> MathResult {
    if settlement >= strike {
        return Ok(0);
    }
    let delta = (strike - settlement) as u128; // strike > settlement here
    let num = (qty as u128)
        .checked_mul(delta)
        .ok_or(OptketError::MathOverflow)?;
    // Round down.
    to_u64(num / SCALE_DIVISOR)
}

/// Premium attributable to a portion of the original quantity, used for
/// proportional demo refunds (PRD §11.2). Rounds **down** so the pool never
/// refunds more than it took in; the dust remainder stays with the pool.
///
/// `refund = premium_paid * portion_qty / original_qty`
pub fn proportional_premium(premium_paid: u64, portion_qty: u64, original_qty: u64) -> MathResult {
    if original_qty == 0 {
        return Err(OptketError::InvariantViolation);
    }
    if portion_qty == 0 {
        return Ok(0);
    }
    let num = (premium_paid as u128)
        .checked_mul(portion_qty as u128)
        .ok_or(OptketError::MathOverflow)?;
    to_u64(num / original_qty as u128)
}

/// Median of a slice of prices (already validated for window/slot rules).
/// For an even count, returns the lower-mean-free "lower median average"
/// computed with round-down to stay deterministic and integer-only.
pub fn median(sorted: &[u64]) -> MathResult {
    let n = sorted.len();
    if n == 0 {
        return Err(OptketError::InsufficientObservations);
    }
    if n % 2 == 1 {
        Ok(sorted[n / 2])
    } else {
        let a = sorted[n / 2 - 1] as u128;
        let b = sorted[n / 2] as u128;
        to_u64((a + b) / 2) // round down
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 1.0 unit = 1_000_000 in QTY/PRICE/TOKEN scale.
    const ONE: u64 = 1_000_000;

    #[test]
    fn liability_rounds_up() {
        // 3.5 qty * 172.50 strike = 603.75 -> 603_750_000 base units
        let l = max_liability(3_500_000, 172_500_000).unwrap();
        assert_eq!(l, 603_750_000);
    }

    #[test]
    fn liability_rounds_up_on_dust() {
        // qty=1 base unit (1e-6), strike=1 base unit -> 1e-12 -> rounds up to 1
        let l = max_liability(1, 1).unwrap();
        assert_eq!(l, 1);
    }

    #[test]
    fn payout_below_strike() {
        // 2 qty, strike 100, settlement 90 -> 2 * 10 = 20 tokens
        let p = payout(2 * ONE, 100 * ONE, 90 * ONE).unwrap();
        assert_eq!(p, 20 * ONE);
    }

    #[test]
    fn payout_at_or_above_strike_is_zero() {
        assert_eq!(payout(2 * ONE, 100 * ONE, 100 * ONE).unwrap(), 0);
        assert_eq!(payout(2 * ONE, 100 * ONE, 110 * ONE).unwrap(), 0);
    }

    #[test]
    fn payout_rounds_down() {
        // qty=1 base unit, delta=1 base unit -> 1e-12 -> rounds down to 0
        assert_eq!(payout(1, 100 * ONE, 100 * ONE - 1).unwrap(), 0);
    }

    #[test]
    fn payout_never_exceeds_liability() {
        // Worst case: settlement = 0 -> payout == qty*strike == max_liability.
        let qty = 7_333_333;
        let strike = 41_250_000;
        let l = max_liability(qty, strike).unwrap();
        let p = payout(qty, strike, 0).unwrap();
        assert!(p <= l, "payout {} must be <= liability {}", p, l);
    }

    #[test]
    fn proportional_premium_splits() {
        // premium 100, exercise half -> 50
        assert_eq!(proportional_premium(100, 5 * ONE, 10 * ONE).unwrap(), 50);
    }

    #[test]
    fn proportional_premium_rounds_down() {
        // premium 10, portion 1/3 -> 3.33 -> 3
        assert_eq!(proportional_premium(10, ONE, 3 * ONE).unwrap(), 3);
    }

    #[test]
    fn median_odd_and_even() {
        assert_eq!(median(&[1, 2, 3]).unwrap(), 2);
        assert_eq!(median(&[10, 20, 30, 40]).unwrap(), 25);
    }
}
