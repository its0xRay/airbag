use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::errors::OptketError;
use crate::events::*;
use crate::math;
use crate::references::{validate_equity, validate_prestocks_median, Observation};
use crate::state::*;

// -------------------------------------------------------- request exercise ---

#[derive(Accounts)]
pub struct RequestExercise<'info> {
    pub buyer: Signer<'info>,

    #[account(
        mut,
        has_one = buyer @ OptketError::Unauthorized,
        constraint = contract.is_open() @ OptketError::ContractNotActive
    )]
    pub contract: Account<'info, Contract>,

    #[account(seeds = [ASSET_SEED, &[contract.asset_id]], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,

    #[account(mut, seeds = [POOL_SEED, &[contract.asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = payer,
        space = 8 + ExerciseRequest::INIT_SPACE,
        seeds = [EXERCISE_SEED, contract.key().as_ref(), &contract.next_request_nonce.to_le_bytes()],
        bump
    )]
    pub request: Account<'info, ExerciseRequest>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn request_exercise(ctx: Context<RequestExercise>, quantity: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let contract = &mut ctx.accounts.contract;

    require!(now <= contract.exercise_cutoff_ts, OptketError::ExerciseCutoffPassed);
    require!(quantity > 0, OptketError::ZeroQuantity);
    require!(quantity <= contract.remaining_quantity, OptketError::ExceedsRemaining);

    // Derive the observation window at request time (irrevocable — PRD §10.2).
    let (window_start, window_end, kind) = match ctx.accounts.asset.kind {
        AssetKind::EquityToken => (now, now + EQUITY_MAX_DELAY_SECS, ReferenceKind::Equity),
        AssetKind::PreStocks => (now, now + PRESTOCKS_WINDOW_SECS, ReferenceKind::PreStocks),
    };

    // Lock the requested quantity: move remaining -> pending.
    contract.remaining_quantity -= quantity;
    contract.pending_quantity = contract
        .pending_quantity
        .checked_add(quantity)
        .ok_or(OptketError::MathOverflow)?;

    // Mark the reserve as pending (collateral stays reserved). Lock exactly the
    // proportional share so settle/fail release the same amount (no drift).
    let lock_amt = proportional_release(
        contract.reserved_collateral,
        contract.original_quantity,
        contract.strike,
        quantity,
        false,
    )?;
    ctx.accounts.pool.lock_pending(lock_amt)?;

    let nonce = contract.next_request_nonce;
    contract.next_request_nonce = nonce.checked_add(1).ok_or(OptketError::MathOverflow)?;

    let r = &mut ctx.accounts.request;
    r.contract = contract.key();
    r.request_nonce = nonce;
    r.quantity = quantity;
    r.request_ts = now;
    r.window_start = window_start;
    r.window_end = window_end;
    r.kind = kind;
    r.status = RequestStatus::Pending;
    r.reserved_locked = lock_amt;
    r.settlement_reference = 0;
    r.payout = 0;
    r.bump = ctx.bumps.request;

    emit!(ExerciseRequestedEvent {
        contract_id: contract.contract_id,
        request_nonce: nonce,
        quantity,
        window_start,
        window_end,
        ts: now,
    });
    Ok(())
}

// ------------------------------------------------------------- settlement ----

#[derive(Accounts)]
pub struct SettleExercise<'info> {
    /// Reference data is submitted by the authorized publisher (PRD §9.3).
    /// (Triggering is otherwise permissionless — see keeper notes in README.)
    #[account(constraint = publisher.key() == config.publisher_authority @ OptketError::Unauthorized)]
    pub publisher: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        constraint = contract.is_open() @ OptketError::ContractNotActive
    )]
    pub contract: Account<'info, Contract>,

    #[account(
        mut,
        seeds = [ASSET_SEED, &[contract.asset_id]],
        bump = asset.bump
    )]
    pub asset: Account<'info, AssetConfig>,

    #[account(mut, seeds = [POOL_SEED, &[contract.asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[contract.asset_id]],
        bump = pool.vault_bump
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = request.contract == contract.key() @ OptketError::WrongReferencePath,
        constraint = request.status == RequestStatus::Pending @ OptketError::RequestNotPending
    )]
    pub request: Account<'info, ExerciseRequest>,

    /// Buyer's payout destination (demo mint).
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

pub fn settle_exercise_equity(
    ctx: Context<SettleExercise>,
    observation: Observation,
) -> Result<()> {
    require!(ctx.accounts.request.kind == ReferenceKind::Equity, OptketError::WrongReferencePath);
    let r = &ctx.accounts.request;
    let settlement = validate_equity(
        &observation,
        r.window_start,
        r.window_end,
        true, // strictly after the request
        EQUITY_MAX_SAMPLE_AGE_SECS,
    )?;
    apply_exercise_settlement(ctx, settlement)
}

pub fn settle_exercise_prestocks(
    ctx: Context<SettleExercise>,
    observations: Vec<Observation>,
) -> Result<()> {
    require!(ctx.accounts.request.kind == ReferenceKind::PreStocks, OptketError::WrongReferencePath);
    let r = &ctx.accounts.request;
    let settlement = validate_prestocks_median(
        &observations,
        r.window_start,
        r.window_end,
        true, // window is strictly after the request
    )?;
    apply_exercise_settlement(ctx, settlement)
}

/// Shared settlement tail: pay intrinsic value, extinguish the settled
/// quantity, release its reserve, and update all accounting (PRD §10, §12).
fn apply_exercise_settlement(ctx: Context<SettleExercise>, settlement: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let quantity = ctx.accounts.request.quantity;
    let strike = ctx.accounts.contract.strike;
    let locked = ctx.accounts.request.reserved_locked;

    // Is this the final open quantity? (pending includes this request's qty)
    let is_final = ctx.accounts.contract.remaining_quantity == 0
        && ctx.accounts.contract.pending_quantity == quantity;

    // On the final extinguishment release the entire remaining reservation
    // (absorbs floor-rounding dust); otherwise release exactly what was locked.
    let release_amt = if is_final {
        ctx.accounts.contract.reserved_collateral
    } else {
        locked
    };
    let payout = math::payout(quantity, strike, settlement)?;
    require!(payout <= release_amt, OptketError::InvariantViolation);
    let residual = release_amt - payout;

    // ---- pay intrinsic value: vault -> buyer (pool PDA signer) ----
    if payout > 0 {
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
        token_interface::transfer_checked(cpi, payout, ctx.accounts.demo_mint.decimals)?;
    }

    // ---- pool accounting ----
    let pool = &mut ctx.accounts.pool;
    pool.unlock_pending(locked)?;
    pool.account_payout(payout)?; // reserved -= payout
    if residual > 0 {
        pool.release(residual)?; // reserved -= residual, available += residual
    }

    // ---- contract accounting: extinguish settled quantity ----
    let contract = &mut ctx.accounts.contract;
    contract.pending_quantity -= quantity;
    contract.reserved_collateral = contract
        .reserved_collateral
        .checked_sub(release_amt)
        .ok_or(OptketError::InvariantViolation)?;
    if contract.remaining_quantity == 0 && contract.pending_quantity == 0 {
        contract.status = ContractStatus::Exercised;
    } else {
        contract.status = ContractStatus::PartiallySettled;
    }

    // ---- asset exposure ----
    let asset = &mut ctx.accounts.asset;
    asset.outstanding_exposure = asset.outstanding_exposure.saturating_sub(release_amt);

    // ---- request record ----
    let contract_id = contract.contract_id;
    let nonce = ctx.accounts.request.request_nonce;
    let r = &mut ctx.accounts.request;
    r.status = RequestStatus::Settled;
    r.settlement_reference = settlement;
    r.payout = payout;

    emit!(ExerciseSettledEvent {
        contract_id,
        request_nonce: nonce,
        quantity,
        settlement_reference: settlement,
        payout,
        ts: now,
    });
    Ok(())
}

// ------------------------------------------------------------- fail request --

#[derive(Accounts)]
pub struct FailExercise<'info> {
    /// Permissionless once the window has elapsed (PRD §10.4 recovery).
    pub cranker: Signer<'info>,

    #[account(mut, constraint = contract.is_open() @ OptketError::ContractNotActive)]
    pub contract: Account<'info, Contract>,

    #[account(mut, seeds = [POOL_SEED, &[contract.asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        constraint = request.contract == contract.key() @ OptketError::WrongReferencePath,
        constraint = request.status == RequestStatus::Pending @ OptketError::RequestNotPending
    )]
    pub request: Account<'info, ExerciseRequest>,
}

/// Return locked quantity to active coverage when no qualifying reference could
/// be established (PRD §10.4). Callable once the request window has elapsed.
pub fn fail_exercise(ctx: Context<FailExercise>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now > ctx.accounts.request.window_end, OptketError::ReferenceWindowFailed);

    let quantity = ctx.accounts.request.quantity;
    let locked = ctx.accounts.request.reserved_locked;

    // Restore quantity to active coverage; reserve stays reserved (just moves
    // from pending back to plain reserved).
    let contract = &mut ctx.accounts.contract;
    contract.pending_quantity -= quantity;
    contract.remaining_quantity = contract
        .remaining_quantity
        .checked_add(quantity)
        .ok_or(OptketError::MathOverflow)?;

    ctx.accounts.pool.unlock_pending(locked)?;

    let contract_id = contract.contract_id;
    let nonce = ctx.accounts.request.request_nonce;
    let r = &mut ctx.accounts.request;
    r.status = RequestStatus::Failed;

    emit!(ExerciseFailedEvent {
        contract_id,
        request_nonce: nonce,
        quantity_restored: quantity,
        ts: now,
    });
    Ok(())
}

/// Reserve to release for extinguishing `q` of a contract. On the final
/// extinguishment, release the entire remaining reservation so no dust is left
/// stranded; otherwise release proportional to the original quantity, floored,
/// and capped at the remaining reservation. Guarantees `payout <= release_amt`.
pub(crate) fn proportional_release(
    reserved_collateral: u64,
    original_quantity: u64,
    strike: u64,
    q: u64,
    is_final: bool,
) -> Result<u64> {
    if is_final {
        return Ok(reserved_collateral);
    }
    let l0 = math::max_liability(original_quantity, strike)?; // original reservation
    let prop = (l0 as u128)
        .checked_mul(q as u128)
        .ok_or(OptketError::MathOverflow)?
        / original_quantity as u128;
    let prop = u64::try_from(prop).map_err(|_| OptketError::MathOverflow)?;
    Ok(prop.min(reserved_collateral))
}
