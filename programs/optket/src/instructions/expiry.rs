use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::errors::OptketError;
use crate::events::ExpirySettledEvent;
use crate::math;
use crate::references::{validate_equity, validate_prestocks_median, Observation};
use crate::state::*;

#[derive(Accounts)]
pub struct SettleExpiry<'info> {
    /// Reference data / invalid determination comes from the authorized
    /// publisher (PRD §9.3, §11).
    #[account(constraint = publisher.key() == config.publisher_authority @ OptketError::Unauthorized)]
    pub publisher: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, constraint = contract.is_open() @ OptketError::ContractNotActive)]
    pub contract: Account<'info, Contract>,

    #[account(mut, seeds = [ASSET_SEED, &[contract.asset_id]], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,

    #[account(mut, seeds = [POOL_SEED, &[contract.asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(mut, seeds = [VAULT_SEED, &[contract.asset_id]], bump = pool.vault_bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = demo_mint,
        constraint = buyer_token.owner == contract.buyer @ OptketError::Unauthorized
    )]
    pub buyer_token: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub demo_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn settle_expiry_equity(ctx: Context<SettleExpiry>, observation: Observation) -> Result<()> {
    let expiry = ctx.accounts.contract.expiry_ts;
    let settlement = validate_equity(
        &observation,
        expiry,
        expiry + EQUITY_MAX_DELAY_SECS,
        false, // at or after expiry
        EQUITY_MAX_SAMPLE_AGE_SECS,
    )?;
    apply_expiry_settlement(ctx, settlement)
}

pub fn settle_expiry_prestocks(ctx: Context<SettleExpiry>, observations: Vec<Observation>) -> Result<()> {
    let expiry = ctx.accounts.contract.expiry_ts;
    let settlement = validate_prestocks_median(
        &observations,
        expiry - PRESTOCKS_WINDOW_SECS, // 5-minute window ending at expiry
        expiry,
        false,
    )?;
    apply_expiry_settlement(ctx, settlement)
}

fn apply_expiry_settlement(ctx: Context<SettleExpiry>, settlement: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.contract.expiry_ts, OptketError::ExpiryNotReached);
    require!(
        ctx.accounts.contract.pending_quantity == 0,
        OptketError::PendingRequestsOutstanding
    );

    let q = ctx.accounts.contract.remaining_quantity;
    require!(q > 0, OptketError::ExceedsRemaining);

    let strike = ctx.accounts.contract.strike;
    let release_amt = ctx.accounts.contract.reserved_collateral; // final: release all
    let payout = math::payout(q, strike, settlement)?;
    require!(payout <= release_amt, OptketError::InvariantViolation);
    let residual = release_amt - payout;

    if payout > 0 {
        transfer_from_vault(&ctx, payout)?;
    }

    let pool = &mut ctx.accounts.pool;
    pool.account_payout(payout)?;
    if residual > 0 {
        pool.release(residual)?;
    }

    let contract = &mut ctx.accounts.contract;
    contract.remaining_quantity = 0;
    contract.reserved_collateral = 0;
    contract.status = ContractStatus::Expired;

    let asset = &mut ctx.accounts.asset;
    asset.outstanding_exposure = asset.outstanding_exposure.saturating_sub(release_amt);

    emit!(ExpirySettledEvent {
        contract_id: contract.contract_id,
        quantity: q,
        settlement_reference: settlement,
        payout,
        refunded_premium: 0,
        invalid_reference: false,
        ts: now,
    });
    Ok(())
}

/// Demo refund procedure for an invalid expiry reference (PRD §11.2). Refunds
/// the premium attributable to unextinguished quantity and releases its
/// reserves. Already-finalized payouts remain final.
pub fn expire_refund(ctx: Context<SettleExpiry>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.contract.expiry_ts, OptketError::ExpiryNotReached);
    require!(
        ctx.accounts.contract.pending_quantity == 0,
        OptketError::PendingRequestsOutstanding
    );

    let q = ctx.accounts.contract.remaining_quantity;
    require!(q > 0, OptketError::ExceedsRemaining);

    let refund = math::proportional_premium(
        ctx.accounts.contract.premium_paid,
        q,
        ctx.accounts.contract.original_quantity,
    )?;
    let release_amt = ctx.accounts.contract.reserved_collateral;

    // Release the whole reservation back to available first, then pay the
    // refund out of available capital.
    let pool = &mut ctx.accounts.pool;
    pool.release(release_amt)?;
    require!(pool.available_capital >= refund, OptketError::InsufficientCollateral);
    pool.available_capital -= refund;
    pool.total_refunds = pool.total_refunds.saturating_add(refund);
    if refund > 0 {
        transfer_from_vault(&ctx, refund)?;
    }

    let contract = &mut ctx.accounts.contract;
    contract.remaining_quantity = 0;
    contract.reserved_collateral = 0;
    contract.status = ContractStatus::Refunded;

    let asset = &mut ctx.accounts.asset;
    asset.outstanding_exposure = asset.outstanding_exposure.saturating_sub(release_amt);

    emit!(ExpirySettledEvent {
        contract_id: contract.contract_id,
        quantity: q,
        settlement_reference: 0,
        payout: 0,
        refunded_premium: refund,
        invalid_reference: true,
        ts: now,
    });
    Ok(())
}

fn transfer_from_vault(ctx: &Context<SettleExpiry>, amount: u64) -> Result<()> {
    let asset_id = ctx.accounts.contract.asset_id;
    let bump = ctx.accounts.pool.bump;
    let seeds: &[&[u8]] = &[POOL_SEED, &[asset_id], &[bump]];
    let signer = &[seeds];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.demo_mint.to_account_info(),
            to: ctx.accounts.buyer_token.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer,
    );
    token_interface::transfer_checked(cpi, amount, ctx.accounts.demo_mint.decimals)?;
    Ok(())
}
