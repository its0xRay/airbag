use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::errors::OptketError;
use crate::state::*;

// ------------------------------------------------------------------ config ---

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Box<Account<'info, Config>>,

    /// The demo mint — the only token accepted for premium/collateral.
    pub demo_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    quote_authority: Pubkey,
    publisher_authority: Pubkey,
    trial_cap: u64,
) -> Result<()> {
    if cfg!(feature = "mainnet-beta") {
        require_keys_eq!(ctx.accounts.admin.key(), crate::BETA_BOOTSTRAP_ADMIN, OptketError::Unauthorized);
        require_keys_eq!(ctx.accounts.demo_mint.key(), crate::beta::USDC, OptketError::WrongMint);
        require!(ctx.accounts.demo_mint.decimals == 6, OptketError::WrongMint);
    } else {
        require!(ctx.accounts.demo_mint.key() != crate::beta::USDC, OptketError::WrongMint);
    }
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.quote_authority = quote_authority;
    c.publisher_authority = publisher_authority;
    c.demo_mint = ctx.accounts.demo_mint.key();
    c.paused_purchases = cfg!(feature = "mainnet-beta");
    c.next_contract_id = 1;
    c.trial_cap = trial_cap;
    c.trial_spent = 0;
    c.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ OptketError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

pub fn set_pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused_purchases = paused;
    Ok(())
}

/// Rotate a role key or the trial cap (roles kept separable — PRD §20).
pub fn set_roles(
    ctx: Context<AdminOnly>,
    quote_authority: Option<Pubkey>,
    publisher_authority: Option<Pubkey>,
    trial_cap: Option<u64>,
) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if let Some(q) = quote_authority {
        c.quote_authority = q;
    }
    if let Some(p) = publisher_authority {
        c.publisher_authority = p;
    }
    if let Some(t) = trial_cap {
        c.trial_cap = t;
    }
    Ok(())
}

// ------------------------------------------------------------------- asset ---

#[derive(Accounts)]
#[instruction(asset_id: u8)]
pub struct InitAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ OptketError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = 8 + AssetConfig::INIT_SPACE,
        seeds = [ASSET_SEED, &[asset_id]],
        bump
    )]
    pub asset: Box<Account<'info, AssetConfig>>,

    #[account(
        init,
        payer = admin,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, &[asset_id]],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// Per-asset collateral vault, authority = pool PDA.
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, &[asset_id]],
        bump,
        token::mint = demo_mint,
        token::authority = pool,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub demo_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// `asset_mint` is a plain argument, not an account: it identifies the real
/// underlying token (e.g. an xStock on mainnet) and is recorded for reference
/// only — the program never reads or escrows it. Requiring it as an account
/// would force the asset to exist on whatever cluster this runs on, which is
/// why a devnet deployment could not name its real mainnet mint (PRD §4.1).
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
    let a = &mut ctx.accounts.asset;
    a.asset_id = asset_id;
    a.kind = kind;
    a.mint = asset_mint;
    a.reference_version = reference_version;
    a.conversion_version = conversion_version;
    a.max_aggregate_exposure = max_aggregate_exposure;
    a.outstanding_exposure = 0;
    a.active = active;
    a.bump = ctx.bumps.asset;

    let p = &mut ctx.accounts.pool;
    p.asset_id = asset_id;
    p.vault = ctx.accounts.vault.key();
    p.available_capital = 0;
    p.reserved = 0;
    p.pending_exercise = 0;
    p.refund_obligations = 0;
    p.premium_receipts = 0;
    p.total_payouts = 0;
    p.total_refunds = 0;
    p.released = 0;
    p.bump = ctx.bumps.pool;
    p.vault_bump = ctx.bumps.vault;
    Ok(())
}

/// Toggle an asset's live-reference availability (PRD §4.3).
#[derive(Accounts)]
#[instruction(asset_id: u8)]
pub struct SetAssetActive<'info> {
    pub admin: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ OptketError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [ASSET_SEED, &[asset_id]], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,
}

pub fn set_asset_active(ctx: Context<SetAssetActive>, _asset_id: u8, active: bool) -> Result<()> {
    ctx.accounts.asset.active = active;
    Ok(())
}

/// Correct an asset's recorded identity/versions after creation (PRD §4).
/// Reference-only metadata: it never affects existing contracts, whose terms
/// are immutable, and never touches collateral.
pub fn set_asset_metadata(
    ctx: Context<SetAssetActive>,
    _asset_id: u8,
    asset_mint: Option<Pubkey>,
    reference_version: Option<u32>,
    conversion_version: Option<u32>,
) -> Result<()> {
    let a = &mut ctx.accounts.asset;
    if let Some(m) = asset_mint {
        a.mint = m;
    }
    if let Some(v) = reference_version {
        a.reference_version = v;
    }
    if let Some(v) = conversion_version {
        a.conversion_version = v;
    }
    Ok(())
}

// ------------------------------------------------------------------ series ---

#[derive(Accounts)]
#[instruction(asset_id: u8, series_id: u16)]
pub struct CreateSeries<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ OptketError::Unauthorized
    )]
    pub config: Account<'info, Config>,

    #[account(seeds = [ASSET_SEED, &[asset_id]], bump = asset.bump)]
    pub asset: Account<'info, AssetConfig>,

    #[account(
        init,
        payer = admin,
        space = 8 + Series::INIT_SPACE,
        seeds = [SERIES_SEED, &[asset_id], &series_id.to_le_bytes()],
        bump
    )]
    pub series: Account<'info, Series>,

    pub system_program: Program<'info, System>,
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
    require!(purchase_cutoff_ts <= expiry_ts, OptketError::QuoteTermsMismatch);
    require!(exercise_cutoff_ts <= expiry_ts, OptketError::QuoteTermsMismatch);

    let s = &mut ctx.accounts.series;
    s.asset_id = asset_id;
    s.series_id = series_id;
    s.strike = strike;
    s.expiry_ts = expiry_ts;
    s.purchase_cutoff_ts = purchase_cutoff_ts;
    s.exercise_cutoff_ts = exercise_cutoff_ts;
    s.max_contract_size = max_contract_size;
    s.reference_version = ctx.accounts.asset.reference_version;
    s.active = true;
    s.bump = ctx.bumps.series;
    Ok(())
}

// -------------------------------------------------------------- pool funds ---

#[derive(Accounts)]
#[instruction(asset_id: u8)]
pub struct FundPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ OptketError::Unauthorized
    )]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED, &[asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[asset_id]],
        bump = pool.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = demo_mint, token::authority = admin)]
    pub admin_token: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub demo_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn fund_pool(ctx: Context<FundPool>, _asset_id: u8, amount: u64) -> Result<()> {
    require!(!cfg!(feature = "mainnet-beta"), OptketError::Unauthorized);
    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.admin_token.to_account_info(),
            mint: ctx.accounts.demo_mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        },
    );
    token_interface::transfer_checked(cpi, amount, ctx.accounts.demo_mint.decimals)?;

    let p = &mut ctx.accounts.pool;
    p.available_capital = p
        .available_capital
        .checked_add(amount)
        .ok_or(OptketError::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(asset_id: u8)]
pub struct WithdrawPool<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ OptketError::Unauthorized
    )]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [POOL_SEED, &[asset_id]], bump = pool.bump)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[asset_id]],
        bump = pool.vault_bump,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = demo_mint)]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    #[account(address = config.demo_mint @ OptketError::WrongMint)]
    pub demo_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_pool(ctx: Context<WithdrawPool>, asset_id: u8, amount: u64) -> Result<()> {
    let p = &mut ctx.accounts.pool;
    // Cannot withdraw below outstanding obligations (PRD §12).
    require!(p.available_capital >= amount, OptketError::WithdrawalBelowObligations);
    p.available_capital -= amount;

    let bump = p.bump;
    let seeds: &[&[u8]] = &[POOL_SEED, &[asset_id], &[bump]];
    let signer = &[seeds];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.demo_mint.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        },
        signer,
    );
    token_interface::transfer_checked(cpi, amount, ctx.accounts.demo_mint.decimals)?;
    Ok(())
}
