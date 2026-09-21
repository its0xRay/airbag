//! Global constants and fixed-point conventions for Optket.
//!
//! Fixed-point conventions (see PRD §6.3):
//! - Prices and strikes are stored as unsigned integers scaled by `PRICE_ONE`
//!   (6 decimals). e.g. a strike of 172.50 is stored as 172_500_000.
//! - Protected quantities are stored scaled by `QTY_ONE` (6 decimals).
//!   e.g. 3.5 share-equivalents is stored as 3_500_000.
//! - The demo collateral token uses `TOKEN_DECIMALS` (6). Premiums, reserves,
//!   payouts and refunds are all expressed in that token's base units.
//!
//! Payout math combines a quantity (QTY_ONE-scaled) and a price delta
//! (PRICE_ONE-scaled) and must land in token base units:
//!   payout_base = qty * price_delta / SCALE_DIVISOR
//! where SCALE_DIVISOR = QTY_ONE * PRICE_ONE / TOKEN_ONE = 1_000_000.

use anchor_lang::prelude::*;

/// PDA seeds.
pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SERIES_SEED: &[u8] = b"series";
pub const CONTRACT_SEED: &[u8] = b"contract";
pub const EXERCISE_SEED: &[u8] = b"exercise";
pub const QUOTE_SEED: &[u8] = b"quote";

/// Fixed-point scales.
pub const PRICE_DECIMALS: u8 = 6;
pub const QTY_DECIMALS: u8 = 6;
pub const TOKEN_DECIMALS: u8 = 6;

pub const PRICE_ONE: u128 = 1_000_000; // 10^PRICE_DECIMALS
pub const QTY_ONE: u128 = 1_000_000; // 10^QTY_DECIMALS
pub const TOKEN_ONE: u128 = 1_000_000; // 10^TOKEN_DECIMALS

/// qty(1e6) * price(1e6) / SCALE_DIVISOR(1e6) => token base units (1e6).
pub const SCALE_DIVISOR: u128 = (QTY_ONE * PRICE_ONE) / TOKEN_ONE; // = 1_000_000

/// Maximum quote lifetime the program will honor, in seconds (PRD §8.1).
/// The quote itself carries an explicit expiry; this is a defensive upper
/// bound so an over-long quote_expiry cannot be signed by mistake.
pub const MAX_QUOTE_TTL_SECS: i64 = 300;

/// PreStocks median reference window (PRD §9.2).
pub const PRESTOCKS_MIN_SAMPLES: usize = 3;
pub const PRESTOCKS_MAX_SAMPLE_AGE_SECS: i64 = 60;
pub const PRESTOCKS_WINDOW_SECS: i64 = 300; // 5 minutes

/// Public-equity reference window (PRD §9.1). The demo uses a team-published
/// oracle benchmark observation; these bound acceptable timing.
pub const EQUITY_MAX_DELAY_SECS: i64 = 300; // qualifying obs must arrive within
pub const EQUITY_MAX_SAMPLE_AGE_SECS: i64 = 120; // freshness at collection

/// Maximum observations accepted in a single settlement call. Bounds compute
/// units and account size for the median calculation.
pub const MAX_OBSERVATIONS: usize = 16;

/// Asset kinds.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetKind {
    /// Public-equity token: reference is an underlying listed-stock feed.
    EquityToken,
    /// PreStocks token: reference is a specified token-market median.
    PreStocks,
}

/// Which settlement-timing rules a request/expiry uses.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ReferenceKind {
    Equity,
    PreStocks,
}

/// Immutable contract version selects the reference, never mutable asset metadata.
/// PreStocks is the existing wire name for the token-market median path.
pub fn contract_reference_kind(asset_id: u8, version: u32) -> Result<ReferenceKind> {
    match (asset_id, version) {
        (0, 1) => Ok(ReferenceKind::Equity),
        (0, 2) | (1, 1) => Ok(ReferenceKind::PreStocks),
        _ => err!(crate::errors::OptketError::WrongReferencePath),
    }
}

#[cfg(test)]
mod reference_version_tests {
    use super::*;
    #[test]
    fn immutable_reference_routes() {
        assert_eq!(contract_reference_kind(0, 1).unwrap(), ReferenceKind::Equity);
        assert_eq!(contract_reference_kind(0, 2).unwrap(), ReferenceKind::PreStocks);
        assert_eq!(contract_reference_kind(1, 1).unwrap(), ReferenceKind::PreStocks);
        assert!(contract_reference_kind(0, 3).is_err());
        assert!(contract_reference_kind(1, 2).is_err());
    }
}
