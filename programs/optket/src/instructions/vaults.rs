use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as IX_SYSVAR;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use crate::{constants::*, errors::OptketError, quote::{QuotePayload, verify_ed25519},
    references::{Observation, validate_prestocks_median}, state::{Config, AssetConfig},
    vault_accounting::{RoundLedger, RoundTerms}, vault_state::*};

fn activity(round: Pubkey, actor: Pubkey, action: u8, amount: u64) -> Result<()> {
    emit!(VaultActivity { round, actor, action, amount, ts: Clock::get()?.unix_timestamp });
    Ok(())
}

#[derive(Accounts)]
#[instruction(round_id: u64, terms: RoundTerms)]
pub struct CreateVaultRound<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(seeds = [ASSET_SEED, &[terms.asset_id]], bump = asset.bump,
        constraint = asset.active @ OptketError::AssetInactive)]
    pub asset: Account<'info, AssetConfig>,
    #[account(init, payer = admin, space = 8 + VaultRound::INIT_SPACE,
        seeds = [ROUND_SEED, &[terms.asset_id], &round_id.to_le_bytes()], bump)]
    pub round: Box<Account<'info, VaultRound>>,
    #[account(init, payer = admin, seeds = [CUSTODY_SEED, round.key().as_ref()], bump,
        token::mint = mint, token::authority = round)]
    pub custody: Account<'info, TokenAccount>,
    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_vault_round(ctx: Context<CreateVaultRound>, round_id: u64,
    terms: RoundTerms, pricing_policy: [u8; 32]) -> Result<()> {
    require!(!ctx.accounts.config.paused_purchases, OptketError::PurchasesPaused);
    require!(pricing_policy != [0; 32], OptketError::InvalidVaultTerms);
    require!(contract_reference_kind(terms.asset_id, ctx.accounts.asset.reference_version)?
        == ReferenceKind::PreStocks, OptketError::WrongReferencePath);
    let round = &mut ctx.accounts.round;
    round.round_id = round_id;
    round.mint = ctx.accounts.mint.key();
    round.custody = ctx.accounts.custody.key();
    round.quote_authority = ctx.accounts.config.quote_authority;
    round.publisher_authority = ctx.accounts.config.publisher_authority;
    round.administrator = ctx.accounts.admin.key();
    round.reference_version = ctx.accounts.asset.reference_version;
    round.pricing_policy = pricing_policy;
    round.ledger = RoundLedger::new(terms, Clock::get()?.unix_timestamp)?;
    round.bump = ctx.bumps.round;
    activity(round.key(), ctx.accounts.admin.key(), 0, 0)
}

#[derive(Accounts)]
pub struct DepositVault<'info> {
    pub owner: Signer<'info>,
    #[account(mut)] pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = custody, has_one = mint)]
    pub round: Box<Account<'info, VaultRound>>,
    #[account(init_if_needed, payer = payer, space = 8 + VaultDeposit::INIT_SPACE,
        seeds = [DEPOSIT_SEED, round.key().as_ref(), owner.key().as_ref()], bump)]
    pub deposit: Account<'info, VaultDeposit>,
    #[account(mut, token::mint = mint, token::authority = round)]
    pub custody: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_vault(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
    crate::beta::charge(ctx.remaining_accounts, ctx.accounts.owner.key(), amount)?;
    record_deposit(ctx, amount)
}

pub fn seed_vault(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
    crate::beta::charge_seed(ctx.remaining_accounts, ctx.accounts.owner.key(), ctx.accounts.config.admin, amount)?;
    record_deposit(ctx, amount)
}

fn record_deposit(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused_purchases, OptketError::PurchasesPaused);
    require!(!ctx.accounts.deposit.redeemed, OptketError::InvalidVaultPhase);
    let round = &mut ctx.accounts.round;
    require!(ctx.accounts.custody.amount >= round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    round.ledger.deposit(amount, Clock::get()?.unix_timestamp)?;
    let record = &mut ctx.accounts.deposit;
    record.round = round.key();
    record.owner = ctx.accounts.owner.key();
    record.shares = record.shares.checked_add(amount).ok_or(OptketError::MathOverflow)?;
    token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(),
        TransferChecked { from: ctx.accounts.owner_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.custody.to_account_info(),
            authority: ctx.accounts.owner.to_account_info() }), amount, ctx.accounts.mint.decimals)?;
    activity(round.key(), ctx.accounts.owner.key(), 1, amount)
}

#[derive(Accounts)]
pub struct WithdrawVault<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = custody, has_one = mint)]
    pub round: Box<Account<'info, VaultRound>>,
    #[account(mut, seeds = [DEPOSIT_SEED, round.key().as_ref(), owner.key().as_ref()], bump,
        has_one = owner, has_one = round, constraint = !deposit.redeemed @ OptketError::InvalidVaultPhase)]
    pub deposit: Account<'info, VaultDeposit>,
    #[account(mut, token::mint = mint, token::authority = round)]
    pub custody: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn cancel_vault_deposit(ctx: Context<WithdrawVault>, amount: u64) -> Result<()> {
    require!(amount <= ctx.accounts.deposit.shares, OptketError::InsufficientCollateral);
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    ctx.accounts.round.ledger.cancel_deposit(amount, Clock::get()?.unix_timestamp)?;
    ctx.accounts.deposit.shares = ctx.accounts.deposit.shares.checked_sub(amount).ok_or(OptketError::MathOverflow)?;
    transfer(&ctx.accounts.round, &ctx.accounts.custody, &ctx.accounts.owner_token,
        &ctx.accounts.mint, &ctx.accounts.token_program, amount)?;
    activity(ctx.accounts.round.key(), ctx.accounts.owner.key(), 2, amount)
}

pub fn redeem_vault(ctx: Context<WithdrawVault>) -> Result<()> {
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    let amount = ctx.accounts.round.ledger.redeem(ctx.accounts.deposit.shares)?;
    ctx.accounts.deposit.redeemed = true;
    ctx.accounts.deposit.redemption_amount = amount;
    transfer(&ctx.accounts.round, &ctx.accounts.custody, &ctx.accounts.owner_token,
        &ctx.accounts.mint, &ctx.accounts.token_program, amount)?;
    activity(ctx.accounts.round.key(), ctx.accounts.owner.key(), 5, amount)
}

#[derive(Accounts)]
pub struct AdvanceVault<'info> {
    pub cranker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, has_one = custody)] pub round: Box<Account<'info, VaultRound>>,
    #[account(token::authority = round, constraint = custody.mint == round.mint)]
    pub custody: Account<'info, TokenAccount>,
}
pub fn activate_vault(ctx: Context<AdvanceVault>) -> Result<()> {
    require!(!ctx.accounts.config.paused_purchases, OptketError::PurchasesPaused);
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    ctx.accounts.round.ledger.activate(Clock::get()?.unix_timestamp)?;
    activity(ctx.accounts.round.key(), ctx.accounts.cranker.key(), 3, 0)
}
pub fn finalize_vault(ctx: Context<AdvanceVault>) -> Result<()> {
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    ctx.accounts.round.ledger.finalize(Clock::get()?.unix_timestamp)?;
    activity(ctx.accounts.round.key(), ctx.accounts.cranker.key(), 4, ctx.accounts.round.ledger.final_balance)
}

/// Domain separates these quotes from legacy purchases and binds the exact round.
pub fn vault_quote_message(round: &Pubkey, quote: &QuotePayload) -> Vec<u8> {
    let mut bytes = b"airbag-vault-quote-v1".to_vec();
    bytes.extend_from_slice(crate::ID.as_ref());
    bytes.extend_from_slice(round.as_ref());
    bytes.extend_from_slice(&quote.message_bytes());
    bytes
}

#[derive(Accounts)]
#[instruction(quote: QuotePayload)]
pub struct PurchaseVault<'info> {
    pub buyer: Signer<'info>,
    #[account(mut)] pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(mut, has_one = custody, has_one = mint)] pub round: Box<Account<'info, VaultRound>>,
    #[account(mut, seeds = [ASSET_SEED, &[quote.asset_id]], bump = asset.bump,
        constraint = asset.active @ OptketError::AssetInactive)]
    pub asset: Account<'info, AssetConfig>,
    #[account(init, payer = payer, space = 8 + VaultPosition::INIT_SPACE,
        seeds = [POSITION_SEED, round.key().as_ref(), &quote.quote_id.to_le_bytes()], bump)]
    pub position: Box<Account<'info, VaultPosition>>,
    #[account(mut, token::mint = mint, token::authority = round)] pub custody: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)] pub buyer_token: Account<'info, TokenAccount>,
    #[account(address = config.demo_mint @ OptketError::WrongMint)] pub mint: Account<'info, Mint>,
    /// CHECK: native instructions sysvar for exact signed message verification.
    #[account(address = IX_SYSVAR)] pub instructions_sysvar: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn purchase_vault(ctx: Context<PurchaseVault>, quote: QuotePayload,
    ed25519_ix_index: u8, max_premium: u64) -> Result<()> {
    crate::beta::charge(ctx.remaining_accounts, ctx.accounts.buyer.key(), quote.premium)?;
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.config.paused_purchases, OptketError::PurchasesPaused);
    require_keys_eq!(quote.buyer, ctx.accounts.buyer.key(), OptketError::QuoteBuyerMismatch);
    require!(quote.fees == 0, OptketError::NonZeroFees);
    require!(quote.premium <= max_premium, OptketError::QuoteTermsMismatch);
    require!(quote.reference_version == ctx.accounts.round.reference_version, OptketError::QuoteTermsMismatch);
    require!(quote.series_id == 0, OptketError::QuoteTermsMismatch); // round mandate, not legacy series
    require!(now <= quote.quote_expiry_ts, OptketError::QuoteExpired);
    require!(quote.quote_expiry_ts.checked_sub(now).ok_or(OptketError::MathOverflow)? <= MAX_QUOTE_TTL_SECS,
        OptketError::QuoteTtlTooLong);
    // Every contract has a full future median window; quotes cannot issue expiry in the past.
    require!(quote.expiry_ts.checked_sub(now).ok_or(OptketError::MathOverflow)? >= PRESTOCKS_WINDOW_SECS,
        OptketError::InvalidVaultTerms);
    verify_ed25519(&ctx.accounts.instructions_sysvar, ed25519_ix_index,
        &ctx.accounts.round.quote_authority, &vault_quote_message(&ctx.accounts.round.key(), &quote))?;
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    let liability = crate::math::max_liability(quote.quantity, quote.strike)?;
    let exposure = ctx.accounts.asset.outstanding_exposure.checked_add(liability).ok_or(OptketError::MathOverflow)?;
    require!(exposure <= ctx.accounts.asset.max_aggregate_exposure, OptketError::AggregateExposureExceeded);
    let ledger = ctx.accounts.round.ledger.issue(quote.asset_id, quote.quantity,
        quote.strike, quote.expiry_ts, quote.premium, now)?;
    ctx.accounts.asset.outstanding_exposure = exposure;
    let p = &mut ctx.accounts.position;
    p.round = ctx.accounts.round.key(); p.buyer = ctx.accounts.buyer.key();
    p.quote_id = quote.quote_id; p.expiry_ts = quote.expiry_ts; p.created_ts = now;
    p.ledger = ledger; p.pending_quantity = 0; p.next_nonce = 0;
    p.total_payout = 0; p.refunded_premium = 0;
    token::transfer_checked(CpiContext::new(ctx.accounts.token_program.to_account_info(),
        TransferChecked { from: ctx.accounts.buyer_token.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.custody.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info() }), quote.premium, ctx.accounts.mint.decimals)?;
    activity(ctx.accounts.round.key(), ctx.accounts.buyer.key(), 6, quote.premium)
}

#[derive(Accounts)]
pub struct RequestVaultExercise<'info> {
    pub buyer: Signer<'info>,
    #[account(mut)] pub payer: Signer<'info>,
    #[account(mut, has_one = buyer)] pub position: Account<'info, VaultPosition>,
    #[account(init, payer = payer, space = 8 + VaultRequest::INIT_SPACE,
        seeds = [REQUEST_SEED, position.key().as_ref(), &position.next_nonce.to_le_bytes()], bump)]
    pub request: Account<'info, VaultRequest>,
    pub system_program: Program<'info, System>,
}
pub fn request_vault_exercise(ctx: Context<RequestVaultExercise>, quantity: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let end = now.checked_add(PRESTOCKS_WINDOW_SECS).ok_or(OptketError::MathOverflow)?;
    let p = &mut ctx.accounts.position;
    require!(end <= p.expiry_ts, OptketError::ExerciseCutoffPassed);
    require!(quantity > 0 && quantity <= p.ledger.remaining_quantity, OptketError::ExceedsRemaining);
    require!(p.pending_quantity == 0, OptketError::PendingRequestsOutstanding);
    let r = &mut ctx.accounts.request;
    r.position = p.key(); r.nonce = p.next_nonce; r.quantity = quantity;
    r.window_start = now; r.window_end = end; r.status = 0;
    r.reference = 0; r.payout = 0;
    p.pending_quantity = quantity;
    p.next_nonce = p.next_nonce.checked_add(1).ok_or(OptketError::MathOverflow)?;
    activity(p.round, ctx.accounts.buyer.key(), 7, quantity)
}

#[derive(Accounts)]
pub struct SettleVault<'info> {
    #[account(address = round.publisher_authority @ OptketError::Unauthorized)] pub publisher: Signer<'info>,
    #[account(mut, has_one = round)] pub position: Box<Account<'info, VaultPosition>>,
    #[account(mut, has_one = custody, has_one = mint)] pub round: Box<Account<'info, VaultRound>>,
    #[account(mut, seeds = [ASSET_SEED, &[round.ledger.terms.asset_id]], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,
    #[account(mut, token::mint = mint, token::authority = round)] pub custody: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, constraint = buyer_token.owner == position.buyer @ OptketError::Unauthorized)]
    pub buyer_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

fn checked_reference(observations: &[Observation], lo: i64, hi: i64,
    strict: bool, now: i64) -> Result<u64> {
    // Do not accept observations claimed to have been collected in the future.
    require!(observations.iter().all(|o| o.collected_ts <= now), OptketError::ObservationOutsideWindow);
    validate_prestocks_median(observations, lo, hi, strict)
}

pub fn settle_vault_expiry(ctx: Context<SettleVault>, observations: Vec<Observation>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &ctx.accounts.position;
    require!(now >= p.expiry_ts, OptketError::ExpiryNotReached);
    require!(p.pending_quantity == 0, OptketError::PendingRequestsOutstanding);
    let lo = p.expiry_ts.checked_sub(PRESTOCKS_WINDOW_SECS).ok_or(OptketError::MathOverflow)?;
    let reference = checked_reference(&observations, lo, p.expiry_ts, false, now)?;
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    let quantity = ctx.accounts.position.ledger.remaining_quantity;
    let released = ctx.accounts.position.ledger.reserved;
    let amount = ctx.accounts.round.ledger.settle(&mut ctx.accounts.position.ledger, quantity, reference)?;
    ctx.accounts.asset.outstanding_exposure = ctx.accounts.asset.outstanding_exposure
        .checked_sub(released).ok_or(OptketError::InvariantViolation)?;
    ctx.accounts.position.total_payout = ctx.accounts.position.total_payout.checked_add(amount).ok_or(OptketError::MathOverflow)?;
    transfer(&ctx.accounts.round, &ctx.accounts.custody, &ctx.accounts.buyer_token,
        &ctx.accounts.mint, &ctx.accounts.token_program, amount)?;
    activity(ctx.accounts.round.key(), ctx.accounts.position.buyer, 10, amount)
}

pub fn refund_vault_expiry(ctx: Context<SettleVault>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &ctx.accounts.position;
    // Publisher attests window failure. Grace time allows delayed valid observations.
    require!(now > p.expiry_ts.checked_add(PRESTOCKS_WINDOW_SECS).ok_or(OptketError::MathOverflow)?, OptketError::ExpiryNotReached);
    require!(p.pending_quantity == 0, OptketError::PendingRequestsOutstanding);
    require!(ctx.accounts.custody.amount >= ctx.accounts.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    let released = ctx.accounts.position.ledger.reserved;
    let amount = ctx.accounts.round.ledger.refund(&mut ctx.accounts.position.ledger)?;
    ctx.accounts.asset.outstanding_exposure = ctx.accounts.asset.outstanding_exposure
        .checked_sub(released).ok_or(OptketError::InvariantViolation)?;
    ctx.accounts.position.refunded_premium = amount;
    transfer(&ctx.accounts.round, &ctx.accounts.custody, &ctx.accounts.buyer_token,
        &ctx.accounts.mint, &ctx.accounts.token_program, amount)?;
    activity(ctx.accounts.round.key(), ctx.accounts.position.buyer, 11, amount)
}

#[derive(Accounts)]
pub struct SettleVaultExercise<'info> {
    pub settlement: SettleVault<'info>,
    #[account(mut, constraint = request.position == settlement.position.key(),
        constraint = request.status == 0 @ OptketError::RequestNotPending)]
    pub request: Account<'info, VaultRequest>,
}
pub fn settle_vault_exercise(ctx: Context<SettleVaultExercise>, observations: Vec<Observation>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let r = &ctx.accounts.request;
    require!(now >= r.window_end, OptketError::ObservationOutsideWindow);
    let reference = checked_reference(&observations, r.window_start, r.window_end, true, now)?;
    let a = &mut ctx.accounts.settlement;
    require!(a.position.pending_quantity == r.quantity, OptketError::InvariantViolation);
    require!(a.custody.amount >= a.round.ledger.tracked_balance()?, OptketError::InvariantViolation);
    let before = a.position.ledger.reserved;
    let amount = a.round.ledger.settle(&mut a.position.ledger, r.quantity, reference)?;
    let released = before.checked_sub(a.position.ledger.reserved).ok_or(OptketError::InvariantViolation)?;
    a.asset.outstanding_exposure = a.asset.outstanding_exposure.checked_sub(released).ok_or(OptketError::InvariantViolation)?;
    a.position.pending_quantity = 0;
    a.position.total_payout = a.position.total_payout.checked_add(amount).ok_or(OptketError::MathOverflow)?;
    ctx.accounts.request.status = 1;
    ctx.accounts.request.reference = reference;
    ctx.accounts.request.payout = amount;
    transfer(&a.round, &a.custody, &a.buyer_token, &a.mint, &a.token_program, amount)?;
    activity(a.round.key(), a.position.buyer, 8, amount)
}

#[derive(Accounts)]
pub struct FailVaultExercise<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)] pub position: Account<'info, VaultPosition>,
    #[account(mut, has_one = position, constraint = request.status == 0 @ OptketError::RequestNotPending)]
    pub request: Account<'info, VaultRequest>,
}
pub fn fail_vault_exercise(ctx: Context<FailVaultExercise>) -> Result<()> {
    require!(Clock::get()?.unix_timestamp > ctx.accounts.request.window_end
        .checked_add(PRESTOCKS_WINDOW_SECS).ok_or(OptketError::MathOverflow)?, OptketError::ReferenceWindowFailed);
    require!(ctx.accounts.position.pending_quantity == ctx.accounts.request.quantity, OptketError::InvariantViolation);
    ctx.accounts.position.pending_quantity = 0;
    ctx.accounts.request.status = 2;
    activity(ctx.accounts.position.round, ctx.accounts.cranker.key(), 9, ctx.accounts.request.quantity)
}

fn transfer<'info>(round: &Account<'info, VaultRound>, custody: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>, mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    let id = round.round_id.to_le_bytes();
    let asset = [round.ledger.terms.asset_id];
    let bump = [round.bump];
    let seeds: &[&[u8]] = &[ROUND_SEED, &asset, &id, &bump];
    token::transfer_checked(CpiContext::new_with_signer(token_program.to_account_info(),
        TransferChecked { from: custody.to_account_info(), to: destination.to_account_info(),
            mint: mint.to_account_info(), authority: round.to_account_info() }, &[seeds]),
        amount, mint.decimals)
}
