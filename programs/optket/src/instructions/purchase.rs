use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::errors::OptketError;
use crate::events::PurchaseEvent;
use crate::math;
use crate::quote::{verify_ed25519, QuotePayload};
use crate::state::*;

#[derive(Accounts)]
#[instruction(quote: QuotePayload)]
pub struct Purchase<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [ASSET_SEED, &[quote.asset_id]],
        bump = asset.bump,
        constraint = asset.active @ OptketError::AssetInactive
    )]
    pub asset: Account<'info, AssetConfig>,

    #[account(
        seeds = [SERIES_SEED, &[quote.asset_id], &quote.series_id.to_le_bytes()],
        bump = series.bump,
        constraint = series.active @ OptketError::SeriesInactive
    )]
    pub series: Account<'info, Series>,

    #[account(mut, seeds = [POOL_SEED, &[quote.asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(mut, seeds = [VAULT_SEED, &[quote.asset_id]], bump = pool.vault_bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Buyer's premium source. Constrained to the demo mint — this is what
    /// makes "real USDC is rejected" true (PRD §22).
    #[account(
        mut,
        token::mint = demo_mint,
        token::authority = buyer
    )]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub demo_mint: InterfaceAccount<'info, Mint>,

    /// Replay guard: `init` fails if this quote_id was already used (PRD §8.2).
    #[account(
        init,
        payer = buyer,
        space = 8 + QuoteMarker::INIT_SPACE,
        seeds = [QUOTE_SEED, &quote.quote_id.to_le_bytes()],
        bump
    )]
    pub quote_marker: Account<'info, QuoteMarker>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Contract::INIT_SPACE,
        seeds = [CONTRACT_SEED, &quote.quote_id.to_le_bytes()],
        bump
    )]
    pub contract: Account<'info, Contract>,

    /// CHECK: validated by address; read via the instructions sysvar loader.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn purchase(ctx: Context<Purchase>, quote: QuotePayload, ed25519_ix_index: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &mut ctx.accounts.config;
    let series = &ctx.accounts.series;

    // ---- gating & window (PRD §8.2, §20) ----
    require!(!config.paused_purchases, OptketError::PurchasesPaused);
    require!(now <= series.purchase_cutoff_ts, OptketError::PurchaseCutoffPassed);

    // ---- quote freshness (PRD §8.1: 60s validity, bounded here) ----
    require!(now <= quote.quote_expiry_ts, OptketError::QuoteExpired);
    require!(
        quote
            .quote_expiry_ts
            .checked_sub(now)
            .ok_or(OptketError::MathOverflow)?
            <= MAX_QUOTE_TTL_SECS,
        OptketError::QuoteTtlTooLong
    );

    // ---- terms must match the on-chain series exactly (PRD §8.2) ----
    require_keys_eq!(quote.buyer, ctx.accounts.buyer.key(), OptketError::QuoteBuyerMismatch);
    require!(quote.asset_id == series.asset_id, OptketError::QuoteTermsMismatch);
    require!(quote.series_id == series.series_id, OptketError::QuoteTermsMismatch);
    require!(quote.strike == series.strike, OptketError::QuoteTermsMismatch);
    require!(quote.expiry_ts == series.expiry_ts, OptketError::QuoteTermsMismatch);
    require!(
        quote.reference_version == series.reference_version,
        OptketError::QuoteTermsMismatch
    );

    // ---- basic validity (PRD §6.3, §11.2) ----
    require!(quote.quantity > 0, OptketError::ZeroQuantity);
    require!(quote.fees == 0, OptketError::NonZeroFees); // demo: fees are zero
    require!(
        quote.quantity <= series.max_contract_size,
        OptketError::ContractSizeExceeded
    );

    // ---- signature (PRD §8.2) ----
    verify_ed25519(
        &ctx.accounts.instructions_sysvar,
        ed25519_ix_index,
        &config.quote_authority,
        &quote.message_bytes(),
    )?;

    // ---- exposure + collateral (PRD §12) ----
    let liability = math::max_liability(quote.quantity, quote.strike)?;
    let asset = &mut ctx.accounts.asset;
    let new_exposure = asset
        .outstanding_exposure
        .checked_add(liability)
        .ok_or(OptketError::MathOverflow)?;
    require!(
        new_exposure <= asset.max_aggregate_exposure,
        OptketError::AggregateExposureExceeded
    );

    let pool = &mut ctx.accounts.pool;
    pool.reserve(liability)?; // checks available capital

    // ---- premium transfer: buyer -> vault (PRD §8.2 atomic) ----
    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.buyer_token.to_account_info(),
            mint: ctx.accounts.demo_mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi, quote.premium, ctx.accounts.demo_mint.decimals)?;
    pool.take_premium(quote.premium)?;
    asset.outstanding_exposure = new_exposure;

    // ---- create contract (PRD §6) ----
    let contract_id = config.next_contract_id;
    config.next_contract_id = config
        .next_contract_id
        .checked_add(1)
        .ok_or(OptketError::MathOverflow)?;

    let c = &mut ctx.accounts.contract;
    c.contract_id = contract_id;
    c.buyer = ctx.accounts.buyer.key();
    c.asset_id = quote.asset_id;
    c.series_id = quote.series_id;
    c.mint = asset.mint;
    c.conversion_version = asset.conversion_version;
    c.reference_version = quote.reference_version;
    c.original_quantity = quote.quantity;
    c.strike = quote.strike;
    c.expiry_ts = quote.expiry_ts;
    c.exercise_cutoff_ts = series.exercise_cutoff_ts;
    c.premium_paid = quote.premium;
    c.fees_paid = quote.fees;
    c.remaining_quantity = quote.quantity;
    c.pending_quantity = 0;
    c.reserved_collateral = liability;
    c.status = ContractStatus::Active;
    c.created_ts = now;
    c.next_request_nonce = 0;
    c.bump = ctx.bumps.contract;

    // ---- replay marker ----
    let m = &mut ctx.accounts.quote_marker;
    m.quote_id = quote.quote_id;
    m.used_at = now;
    m.bump = ctx.bumps.quote_marker;

    emit!(PurchaseEvent {
        contract_id,
        buyer: c.buyer,
        asset_id: c.asset_id,
        series_id: c.series_id,
        quantity: c.original_quantity,
        strike: c.strike,
        premium: c.premium_paid,
        liability,
        ts: now,
    });
    Ok(())
}
