//! Optket — downside protection for tokenized equities on Solana (two-asset MVP).
//!
//! This program implements the shared protection engine described in the Optket
//! PRD: a signed-quote purchase flow, per-asset collateral pools, full/partial
//! early exercise, deterministic expiry settlement, and a disclosed demo-refund
//! fallback. It is a DEMO configuration — only a configured demo mint is
//! accepted, real USDC is rejected, and payouts carry no redemption promise.
//!
//! Section references (e.g. "PRD §8") point at the product spec.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod math;
pub mod quote;
pub mod references;
pub mod state;
pub mod vault_accounting;
pub mod vault_state;

pub mod instructions;
use instructions::*;

pub use constants::{AssetKind, ReferenceKind};
pub use quote::QuotePayload;
pub use references::Observation;
pub use vault_accounting::RoundTerms;

// Placeholder program id. After `anchor build`, run `anchor keys sync`.
declare_id!("Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky");

#[program]
pub mod optket {
    use super::*;

    pub fn create_vault_round(ctx: Context<CreateVaultRound>, round_id: u64,
        terms: RoundTerms, pricing_policy: [u8; 32]) -> Result<()> {
        instructions::vaults::create_vault_round(ctx, round_id, terms, pricing_policy)
    }
    pub fn deposit_vault(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
        instructions::vaults::deposit_vault(ctx, amount)
    }
    pub fn cancel_vault_deposit(ctx: Context<WithdrawVault>, amount: u64) -> Result<()> {
        instructions::vaults::cancel_vault_deposit(ctx, amount)
    }
    pub fn redeem_vault(ctx: Context<WithdrawVault>) -> Result<()> {
        instructions::vaults::redeem_vault(ctx)
    }
    pub fn activate_vault(ctx: Context<AdvanceVault>) -> Result<()> {
        instructions::vaults::activate_vault(ctx)
    }
    pub fn finalize_vault(ctx: Context<AdvanceVault>) -> Result<()> {
        instructions::vaults::finalize_vault(ctx)
    }
    pub fn purchase_vault(ctx: Context<PurchaseVault>, quote: QuotePayload,
        ed25519_ix_index: u8, max_premium: u64) -> Result<()> {
        instructions::vaults::purchase_vault(ctx, quote, ed25519_ix_index, max_premium)
    }
    pub fn request_vault_exercise(ctx: Context<RequestVaultExercise>, quantity: u64) -> Result<()> {
        instructions::vaults::request_vault_exercise(ctx, quantity)
    }
    pub fn settle_vault_expiry(ctx: Context<SettleVault>, observations: Vec<Observation>) -> Result<()> {
        instructions::vaults::settle_vault_expiry(ctx, observations)
    }
    pub fn refund_vault_expiry(ctx: Context<SettleVault>) -> Result<()> {
        instructions::vaults::refund_vault_expiry(ctx)
    }
    pub fn settle_vault_exercise(ctx: Context<SettleVaultExercise>, observations: Vec<Observation>) -> Result<()> {
        instructions::vaults::settle_vault_exercise(ctx, observations)
    }
    pub fn fail_vault_exercise(ctx: Context<FailVaultExercise>) -> Result<()> {
        instructions::vaults::fail_vault_exercise(ctx)
    }

    // ---- config / roles (PRD §20) ----
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        quote_authority: Pubkey,
        publisher_authority: Pubkey,
        trial_cap: u64,
    ) -> Result<()> {
        instructions::admin::initialize_config(ctx, quote_authority, publisher_authority, trial_cap)
    }

    pub fn set_pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_pause(ctx, paused)
    }

    pub fn set_roles(
        ctx: Context<AdminOnly>,
        quote_authority: Option<Pubkey>,
        publisher_authority: Option<Pubkey>,
        trial_cap: Option<u64>,
    ) -> Result<()> {
        instructions::admin::set_roles(ctx, quote_authority, publisher_authority, trial_cap)
    }

    // ---- assets & series (PRD §4, §7) ----
    #[allow(clippy::too_many_arguments)]
    pub fn init_asset(
        ctx: Context<InitAsset>,
        asset_id: u8,
        kind: AssetKind,
        asset_mint: Pubkey,
        reference_version: u32,
        conversion_version: u32,
        max_aggregate_exposure: u64,
        active: bool,
    ) -> Result<()> {
        instructions::admin::init_asset(
            ctx,
            asset_id,
            kind,
            asset_mint,
            reference_version,
            conversion_version,
            max_aggregate_exposure,
            active,
        )
    }

    /// Correct an asset's recorded identity/versions (reference-only, §4).
    pub fn set_asset_metadata(
        ctx: Context<SetAssetActive>,
        asset_id: u8,
        asset_mint: Option<Pubkey>,
        reference_version: Option<u32>,
        conversion_version: Option<u32>,
    ) -> Result<()> {
        instructions::admin::set_asset_metadata(ctx, asset_id, asset_mint, reference_version, conversion_version)
    }

    pub fn set_asset_active(ctx: Context<SetAssetActive>, asset_id: u8, active: bool) -> Result<()> {
        instructions::admin::set_asset_active(ctx, asset_id, active)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_series(
        ctx: Context<CreateSeries>,
        asset_id: u8,
        series_id: u16,
        strike: u64,
        expiry_ts: i64,
        purchase_cutoff_ts: i64,
        exercise_cutoff_ts: i64,
        max_contract_size: u64,
    ) -> Result<()> {
        instructions::admin::create_series(
            ctx,
            asset_id,
            series_id,
            strike,
            expiry_ts,
            purchase_cutoff_ts,
            exercise_cutoff_ts,
            max_contract_size,
        )
    }

    // ---- collateral pool (PRD §12) ----
    pub fn fund_pool(ctx: Context<FundPool>, asset_id: u8, amount: u64) -> Result<()> {
        instructions::admin::fund_pool(ctx, asset_id, amount)
    }

    pub fn withdraw_pool(ctx: Context<WithdrawPool>, asset_id: u8, amount: u64) -> Result<()> {
        instructions::admin::withdraw_pool(ctx, asset_id, amount)
    }

    // ---- purchase (PRD §8) ----
    pub fn purchase(ctx: Context<Purchase>, quote: QuotePayload, ed25519_ix_index: u8) -> Result<()> {
        instructions::purchase::purchase(ctx, quote, ed25519_ix_index)
    }

    // ---- exercise (PRD §10) ----
    pub fn request_exercise(ctx: Context<RequestExercise>, quantity: u64) -> Result<()> {
        instructions::exercise::request_exercise(ctx, quantity)
    }

    pub fn settle_exercise_equity(ctx: Context<SettleExercise>, observation: Observation) -> Result<()> {
        instructions::exercise::settle_exercise_equity(ctx, observation)
    }

    pub fn settle_exercise_prestocks(
        ctx: Context<SettleExercise>,
        observations: Vec<Observation>,
    ) -> Result<()> {
        instructions::exercise::settle_exercise_prestocks(ctx, observations)
    }

    pub fn fail_exercise(ctx: Context<FailExercise>) -> Result<()> {
        instructions::exercise::fail_exercise(ctx)
    }

    // ---- expiry & refunds (PRD §11) ----
    pub fn settle_expiry_equity(ctx: Context<SettleExpiry>, observation: Observation) -> Result<()> {
        instructions::expiry::settle_expiry_equity(ctx, observation)
    }

    pub fn settle_expiry_prestocks(
        ctx: Context<SettleExpiry>,
        observations: Vec<Observation>,
    ) -> Result<()> {
        instructions::expiry::settle_expiry_prestocks(ctx, observations)
    }

    pub fn expire_refund(ctx: Context<SettleExpiry>) -> Result<()> {
        instructions::expiry::expire_refund(ctx)
    }
}
