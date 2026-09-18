//! Reference observation validation (PRD §9).
//!
//! Observations are submitted by the authorized `publisher_authority`. An
//! authorized signature proves publisher identity, NOT that the upstream feed
//! actually returned the value (PRD §9.3 trust limitation). The program's job
//! is to enforce window membership, freshness, distinct/increasing slots and
//! sample count, then compute a deterministic reference.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::OptketError;
use crate::math;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Observation {
    /// Source slot (Solana slot or feed sequence). Must strictly increase.
    pub slot: u64,
    /// Source/publish timestamp of the observed price.
    pub source_ts: i64,
    /// When the publisher collected it (used for the freshness check).
    pub collected_ts: i64,
    /// Price in PRICE_ONE fixed-point.
    pub price: u64,
}

/// Validate a single equity observation and return its price (PRD §9.1).
///
/// `lo` is the exclusive/inclusive lower bound (request_ts for early exercise,
/// expiry_ts for expiry); `strict_after` selects `>` vs `>=`. `hi` is the
/// latest acceptable source timestamp (lo + max delay).
pub fn validate_equity(
    obs: &Observation,
    lo: i64,
    hi: i64,
    strict_after: bool,
    max_age: i64,
) -> Result<u64> {
    if strict_after {
        require!(obs.source_ts > lo, OptketError::ObservationNotAfterRequest);
    } else {
        require!(obs.source_ts >= lo, OptketError::ReferenceBeforeExpiry);
    }
    require!(obs.source_ts <= hi, OptketError::ObservationOutsideWindow);
    require!(
        obs.collected_ts >= obs.source_ts && obs.collected_ts - obs.source_ts <= max_age,
        OptketError::ObservationStale
    );
    require!(obs.price > 0, OptketError::InvalidReference);
    Ok(obs.price)
}

/// Validate a PreStocks observation set and return the median (PRD §9.2).
///
/// Requirements enforced:
/// - at least `PRESTOCKS_MIN_SAMPLES` and at most `MAX_OBSERVATIONS`
/// - each source_ts within the window (strict-after lo for early exercise)
/// - freshness: `collected_ts - source_ts` in `[0, PRESTOCKS_MAX_SAMPLE_AGE]`
/// - source slots strictly increasing (distinct) and timestamps non-decreasing
/// - all prices positive
pub fn validate_prestocks_median(
    observations: &[Observation],
    lo: i64,
    hi: i64,
    strict_after: bool,
) -> Result<u64> {
    let n = observations.len();
    require!(n >= PRESTOCKS_MIN_SAMPLES, OptketError::InsufficientObservations);
    require!(n <= MAX_OBSERVATIONS, OptketError::InsufficientObservations);

    let mut prices: Vec<u64> = Vec::with_capacity(n);
    let mut prev_slot: Option<u64> = None;
    let mut prev_ts: Option<i64> = None;

    for obs in observations.iter() {
        // window membership
        if strict_after {
            require!(obs.source_ts > lo, OptketError::ObservationNotAfterRequest);
        } else {
            require!(obs.source_ts >= lo, OptketError::ObservationOutsideWindow);
        }
        require!(obs.source_ts <= hi, OptketError::ObservationOutsideWindow);

        // freshness
        require!(
            obs.collected_ts >= obs.source_ts
                && obs.collected_ts - obs.source_ts <= PRESTOCKS_MAX_SAMPLE_AGE_SECS,
            OptketError::ObservationStale
        );

        // distinct, strictly increasing slots; non-decreasing time
        if let Some(ps) = prev_slot {
            require!(obs.slot > ps, OptketError::NonIncreasingSlots);
        }
        if let Some(pt) = prev_ts {
            require!(obs.source_ts >= pt, OptketError::NonIncreasingSlots);
        }
        prev_slot = Some(obs.slot);
        prev_ts = Some(obs.source_ts);

        require!(obs.price > 0, OptketError::InvalidReference);
        prices.push(obs.price);
    }

    prices.sort_unstable();
    math::median(&prices).map_err(|e| e.into())
}
