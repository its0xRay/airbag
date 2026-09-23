//! Isolated accounts for depositor-backed contracts. Legacy layouts stay intact.
use anchor_lang::prelude::*;
use crate::vault_accounting::{ContractLedger, RoundLedger};

pub const ROUND_SEED: &[u8] = b"underwriting-round";
pub const CUSTODY_SEED: &[u8] = b"round-custody";
pub const DEPOSIT_SEED: &[u8] = b"round-deposit";
pub const POSITION_SEED: &[u8] = b"round-position";
pub const REQUEST_SEED: &[u8] = b"round-request";

#[account]
#[derive(InitSpace)]
pub struct VaultRound {
    pub round_id: u64,
    pub mint: Pubkey,
    pub custody: Pubkey,
    pub quote_authority: Pubkey,
    pub publisher_authority: Pubkey,
    /// Administrative depositor identity, not a withdrawal authority.
    pub administrator: Pubkey,
    pub reference_version: u32,
    /// Commitment to published pricing rules; not an onchain model proof.
    pub pricing_policy: [u8; 32],
    pub ledger: RoundLedger,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct VaultDeposit {
    pub round: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    pub redeemed: bool,
    pub redemption_amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct VaultPosition {
    pub round: Pubkey,
    pub buyer: Pubkey,
    pub quote_id: u64,
    pub expiry_ts: i64,
    pub created_ts: i64,
    pub ledger: ContractLedger,
    /// One pending request at a time. Quantity remains reserved in the ledger.
    pub pending_quantity: u64,
    pub next_nonce: u32,
    pub total_payout: u64,
    pub refunded_premium: u64,
}

#[account]
#[derive(InitSpace)]
pub struct VaultRequest {
    pub position: Pubkey,
    pub nonce: u32,
    pub quantity: u64,
    pub window_start: i64,
    pub window_end: i64,
    /// 0 pending, 1 settled, 2 failed. Never close/reinitialize these records.
    pub status: u8,
    pub reference: u64,
    pub payout: u64,
}

#[event]
pub struct VaultActivity {
    pub round: Pubkey,
    pub actor: Pubkey,
    /// 0 created, 1 deposited, 2 cancelled, 3 activated, 4 finalized,
    /// 5 redeemed, 6 purchased, 7 exercise requested, 8 exercise settled,
    /// 9 request failed, 10 expiry settled, 11 premium refunded.
    pub action: u8,
    pub amount: u64,
    pub ts: i64,
}
