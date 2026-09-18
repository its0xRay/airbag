use anchor_lang::prelude::*;

use crate::constants::{AssetKind, ReferenceKind};
use crate::errors::OptketError;

/// Global program configuration and role registry (PRD §20).
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// ed25519 public key authorized to sign premium quotes (PRD §8.2).
    pub quote_authority: Pubkey,
    /// Authority allowed to publish reference observations (PRD §9.3).
    pub publisher_authority: Pubkey,
    /// The ONLY token mint accepted as demo collateral/premium. Any other mint
    /// (e.g. real USDC) is rejected, satisfying "Real USDC is rejected" (§22).
    pub demo_mint: Pubkey,
    /// When true, new purchases are blocked but exercise/settlement continue
    /// (PRD §20: "A purchase pause must not block valid exercise or settlement").
    pub paused_purchases: bool,
    /// Monotonic id source for contracts.
    pub next_contract_id: u64,
    /// Trial fee-support budget accounting (PRD §19).
    pub trial_cap: u64,
    pub trial_spent: u64,
    pub bump: u8,
}

/// Per-asset configuration and exposure accounting (PRD §4, §12).
#[account]
#[derive(InitSpace)]
pub struct AssetConfig {
    pub asset_id: u8,
    pub kind: AssetKind,
    /// Underlying token mint (informational only — never escrowed).
    pub mint: Pubkey,
    pub reference_version: u32,
    pub conversion_version: u32,
    /// Max aggregate maximum-liability across all live contracts for this asset.
    pub max_aggregate_exposure: u64,
    pub outstanding_exposure: u64,
    /// Whether the asset is verified for live-reference contracts (PRD §4.3).
    pub active: bool,
    pub bump: u8,
}

/// Per-asset collateral pool accounting (PRD §12). Balances are in demo-token
/// base units. Invariant, enforced after every mutation:
///   vault_balance == available_capital + reserved + refund_obligations
/// with `pending_exercise <= reserved`.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub asset_id: u8,
    pub vault: Pubkey,
    pub available_capital: u64,
    /// Outstanding payout reserves backing active coverage (max-liability).
    pub reserved: u64,
    /// Portion of `reserved` locked against pending exercise requests.
    pub pending_exercise: u64,
    /// Premium owed back to buyers on demo refunds not yet paid out.
    pub refund_obligations: u64,
    // ---- lifetime tallies (monitoring only) ----
    pub premium_receipts: u64,
    pub total_payouts: u64,
    pub total_refunds: u64,
    pub released: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Pool {
    /// Reserve maximum liability before a purchase (PRD §12: "Reserve maximum
    /// liability before purchase"). Moves capital available -> reserved.
    pub fn reserve(&mut self, amount: u64) -> Result<()> {
        require!(self.available_capital >= amount, OptketError::InsufficientCollateral);
        self.available_capital -= amount;
        self.reserved = self
            .reserved
            .checked_add(amount)
            .ok_or(OptketError::MathOverflow)?;
        Ok(())
    }

    /// Release reserve back to available (on payout residual, refund, or expiry
    /// close). Releases proportionally at the call site.
    pub fn release(&mut self, amount: u64) -> Result<()> {
        require!(self.reserved >= amount, OptketError::InvariantViolation);
        self.reserved -= amount;
        self.available_capital = self
            .available_capital
            .checked_add(amount)
            .ok_or(OptketError::MathOverflow)?;
        self.released = self.released.saturating_add(amount);
        Ok(())
    }

    /// Record a premium receipt into available capital.
    pub fn take_premium(&mut self, amount: u64) -> Result<()> {
        self.available_capital = self
            .available_capital
            .checked_add(amount)
            .ok_or(OptketError::MathOverflow)?;
        self.premium_receipts = self.premium_receipts.saturating_add(amount);
        Ok(())
    }

    /// Lock part of the reserve against a pending exercise request.
    pub fn lock_pending(&mut self, amount: u64) -> Result<()> {
        require!(self.reserved >= self.pending_exercise + amount, OptketError::InvariantViolation);
        self.pending_exercise = self
            .pending_exercise
            .checked_add(amount)
            .ok_or(OptketError::MathOverflow)?;
        Ok(())
    }

    /// Unlock a pending amount (request settled or failed).
    pub fn unlock_pending(&mut self, amount: u64) -> Result<()> {
        require!(self.pending_exercise >= amount, OptketError::InvariantViolation);
        self.pending_exercise -= amount;
        Ok(())
    }

    /// Pay a settled amount out of the reserve (vault -> buyer done by caller).
    /// Reduces both reserved and pending; the difference between reserved
    /// portion and paid amount is released back to available at the call site.
    pub fn account_payout(&mut self, paid: u64) -> Result<()> {
        require!(self.reserved >= paid, OptketError::InvariantViolation);
        self.reserved -= paid;
        self.total_payouts = self.total_payouts.saturating_add(paid);
        Ok(())
    }

    /// Total outstanding obligations that capital must never drop below.
    pub fn obligations(&self) -> u64 {
        self.reserved.saturating_add(self.refund_obligations)
    }
}

/// A published protection series (PRD §7).
#[account]
#[derive(InitSpace)]
pub struct Series {
    pub asset_id: u8,
    pub series_id: u16,
    pub strike: u64,
    pub expiry_ts: i64,
    pub purchase_cutoff_ts: i64,
    pub exercise_cutoff_ts: i64,
    pub max_contract_size: u64,
    pub reference_version: u32,
    pub active: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ContractStatus {
    Active,
    PartiallySettled,
    Exercised,
    Expired,
    Refunded,
    Cancelled,
}

/// A purchased protection contract (PRD §6). Terms are immutable after
/// creation; only the mutable lifecycle counters change.
#[account]
#[derive(InitSpace)]
pub struct Contract {
    pub contract_id: u64,
    pub buyer: Pubkey,
    pub asset_id: u8,
    pub series_id: u16,
    /// Asset mint the contract references (from AssetConfig at purchase time).
    pub mint: Pubkey,
    pub conversion_version: u32,
    pub reference_version: u32,
    // ---- immutable economic terms ----
    pub original_quantity: u64,
    pub strike: u64,
    pub expiry_ts: i64,
    pub exercise_cutoff_ts: i64,
    pub premium_paid: u64,
    pub fees_paid: u64,
    // ---- mutable lifecycle counters ----
    pub remaining_quantity: u64,
    pub pending_quantity: u64,
    /// Current outstanding collateral reservation = max-liability of remaining.
    pub reserved_collateral: u64,
    pub status: ContractStatus,
    pub created_ts: i64,
    pub next_request_nonce: u32,
    pub bump: u8,
}

impl Contract {
    pub fn is_open(&self) -> bool {
        matches!(self.status, ContractStatus::Active | ContractStatus::PartiallySettled)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RequestStatus {
    Pending,
    Settled,
    Failed,
}

/// An irrevocable early-exercise request (PRD §10.2).
#[account]
#[derive(InitSpace)]
pub struct ExerciseRequest {
    pub contract: Pubkey,
    pub request_nonce: u32,
    pub quantity: u64,
    pub request_ts: i64,
    /// Observation window bounds derived at request time (PRD §9.1/§9.2).
    pub window_start: i64,
    pub window_end: i64,
    pub kind: ReferenceKind,
    pub status: RequestStatus,
    /// Reserve amount locked for this request at request time. Stored so
    /// settle/fail release exactly what was locked (no rounding drift).
    pub reserved_locked: u64,
    pub settlement_reference: u64,
    pub payout: u64,
    pub bump: u8,
}

/// Replay guard for signed quotes (PRD §8.2). A PDA seeded by `quote_id`;
/// `init` fails if it already exists, preventing quote reuse.
#[account]
#[derive(InitSpace)]
pub struct QuoteMarker {
    pub quote_id: u64,
    pub used_at: i64,
    pub bump: u8,
}
