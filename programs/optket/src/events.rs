use anchor_lang::prelude::*;

/// Lifecycle events for off-chain indexing / history (PRD §13.7).

#[event]
pub struct PurchaseEvent {
    pub contract_id: u64,
    pub buyer: Pubkey,
    pub asset_id: u8,
    pub series_id: u16,
    pub quantity: u64,
    pub strike: u64,
    pub premium: u64,
    pub liability: u64,
    pub ts: i64,
}

#[event]
pub struct ExerciseRequestedEvent {
    pub contract_id: u64,
    pub request_nonce: u32,
    pub quantity: u64,
    pub window_start: i64,
    pub window_end: i64,
    pub ts: i64,
}

#[event]
pub struct ExerciseSettledEvent {
    pub contract_id: u64,
    pub request_nonce: u32,
    pub quantity: u64,
    pub settlement_reference: u64,
    pub payout: u64,
    pub ts: i64,
}

#[event]
pub struct ExerciseFailedEvent {
    pub contract_id: u64,
    pub request_nonce: u32,
    pub quantity_restored: u64,
    pub ts: i64,
}

#[event]
pub struct ExpirySettledEvent {
    pub contract_id: u64,
    pub quantity: u64,
    pub settlement_reference: u64,
    pub payout: u64,
    pub refunded_premium: u64,
    pub invalid_reference: bool,
    pub ts: i64,
}
