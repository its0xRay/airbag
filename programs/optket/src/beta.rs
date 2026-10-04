//! Mainnet-only participation policy. No withdrawal or settlement instruction
//! depends on access remaining enabled. Counters are lifetime and never reset.
use anchor_lang::prelude::*;
use crate::{constants::CONFIG_SEED, errors::OptketError, state::Config};

pub const POLICY_SEED: &[u8] = b"beta-policy";
pub const ACCESS_SEED: &[u8] = b"beta-access";
pub const WALLET_LIMIT: u64 = 10_000_000;
pub const TESTER_LIMIT: u64 = 20_000_000;
pub const SEED_LIMIT: u64 = 25_000_000;
pub const USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[account]
#[derive(InitSpace)]
pub struct BetaPolicy {
    pub access_authority: Pubkey,
    pub total_limit: u64,
    pub total_used: u64,
    pub seed_used: u64,
}
#[account]
#[derive(InitSpace)]
pub struct BetaAccess {
    pub owner: Pubkey,
    pub used: u64,
    pub enabled: bool,
}
#[derive(Accounts)]
pub struct InitializeBetaPolicy<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + BetaPolicy::INIT_SPACE, seeds = [POLICY_SEED], bump)]
    pub policy: Account<'info, BetaPolicy>,
    pub system_program: Program<'info, System>,
}
pub fn initialize(ctx: Context<InitializeBetaPolicy>, authority: Pubkey, total_limit: u64) -> Result<()> {
    require!(cfg!(feature = "mainnet-beta"), OptketError::Unauthorized);
    require!(total_limit > 0 && total_limit <= TESTER_LIMIT && authority != Pubkey::default(), OptketError::InvalidVaultTerms);
    require_keys_eq!(ctx.accounts.config.demo_mint, USDC, OptketError::WrongMint);
    ctx.accounts.policy.access_authority = authority;
    ctx.accounts.policy.total_limit = total_limit;
    ctx.accounts.policy.total_used = 0;
    ctx.accounts.policy.seed_used = 0;
    Ok(())
}
#[derive(Accounts)]
pub struct SetBetaAccess<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(seeds = [POLICY_SEED], bump, constraint = policy.access_authority == authority.key() @ OptketError::Unauthorized)]
    pub policy: Account<'info, BetaPolicy>,
    /// CHECK: owner identity only; proof of wallet ownership is checked by the invite service.
    pub owner: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = authority, space = 8 + BetaAccess::INIT_SPACE,
        seeds = [ACCESS_SEED, owner.key().as_ref()], bump)]
    pub access: Account<'info, BetaAccess>,
    pub system_program: Program<'info, System>,
}
pub fn set_access(ctx: Context<SetBetaAccess>, enabled: bool) -> Result<()> {
    require!(cfg!(feature = "mainnet-beta"), OptketError::Unauthorized);
    ctx.accounts.access.owner = ctx.accounts.owner.key();
    ctx.accounts.access.enabled = enabled;
    // Never reset used on revocation/reactivation, never close this PDA.
    Ok(())
}

pub fn next_usage(used: u64, amount: u64, limit: u64) -> Result<u64> {
    let next = used.checked_add(amount).ok_or(OptketError::MathOverflow)?;
    require!(amount > 0 && next <= limit, OptketError::InsufficientCollateral);
    Ok(next)
}

/// Remaining accounts preserve the deployed Devnet instruction layouts. The
/// mainnet build unconditionally requires the canonical writable policy/access
/// PDAs for every purchase and deposit, including admin deposits.
pub fn charge(accounts: &[AccountInfo], owner: Pubkey, amount: u64) -> Result<()> {
    if !cfg!(feature = "mainnet-beta") { return Ok(()); }
    let (mut policy, mut access) = checked_accounts(accounts, owner)?;
    access.used = next_usage(access.used, amount, WALLET_LIMIT)?;
    policy.total_used = next_usage(policy.total_used, amount, policy.total_limit)?;
    access.try_serialize(&mut &mut accounts[1].try_borrow_mut_data()?[..])?;
    policy.try_serialize(&mut &mut accounts[0].try_borrow_mut_data()?[..])?;
    Ok(())
}

/// Only the configured administrator may supply seed capital. It receives normal
/// vault shares and withdrawal rights, but cannot reuse the lifetime seed budget.
/// This path does not change either tester counter or exempt admin purchases.
pub fn charge_seed(accounts: &[AccountInfo], owner: Pubkey, admin: Pubkey, amount: u64) -> Result<()> {
    require!(cfg!(feature = "mainnet-beta"), OptketError::Unauthorized);
    require_keys_eq!(owner, admin, OptketError::Unauthorized);
    let (mut policy, _) = checked_accounts(accounts, owner)?;
    policy.seed_used = next_usage(policy.seed_used, amount, SEED_LIMIT)?;
    policy.try_serialize(&mut &mut accounts[0].try_borrow_mut_data()?[..])?;
    Ok(())
}

fn checked_accounts(accounts: &[AccountInfo], owner: Pubkey) -> Result<(BetaPolicy, BetaAccess)> {
    require!(accounts.len() == 2, OptketError::Unauthorized);
    let policy_info = &accounts[0]; let access_info = &accounts[1];
    require_keys_eq!(policy_info.key(), Pubkey::find_program_address(&[POLICY_SEED], &crate::ID).0, OptketError::Unauthorized);
    require_keys_eq!(access_info.key(), Pubkey::find_program_address(&[ACCESS_SEED, owner.as_ref()], &crate::ID).0, OptketError::Unauthorized);
    for info in [policy_info, access_info] {
        require!(info.is_writable && info.owner == &crate::ID, OptketError::Unauthorized);
    }
    let policy = BetaPolicy::try_deserialize(&mut &policy_info.try_borrow_data()?[..])?;
    let access = BetaAccess::try_deserialize(&mut &access_info.try_borrow_data()?[..])?;
    require!(access.enabled && access.owner == owner, OptketError::Unauthorized);
    Ok((policy, access))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn cumulative_limit_is_exact() {
        let used = next_usage(0, 6_000_000, WALLET_LIMIT).unwrap();
        let used = next_usage(used, 2_000_000, WALLET_LIMIT).unwrap();
        assert_eq!(next_usage(used, 2_000_000, WALLET_LIMIT).unwrap(), WALLET_LIMIT);
        assert!(next_usage(used, 2_000_001, WALLET_LIMIT).is_err());
        assert!(next_usage(used, 0, WALLET_LIMIT).is_err());
        assert!(next_usage(u64::MAX, 1, u64::MAX).is_err());
    }
    #[cfg(feature = "mainnet-beta")]
    #[test] fn enforcement_rejects_missing_and_tampered_accounts() {
        let owner = Pubkey::new_unique();
        assert!(charge(&[], owner, 1).is_err());
        let policy_key = Pubkey::find_program_address(&[POLICY_SEED], &crate::ID).0;
        let access_key = Pubkey::find_program_address(&[ACCESS_SEED, owner.as_ref()], &crate::ID).0;
        let mut p = vec![0; 64]; let mut a = vec![0; 49];
        BetaPolicy { access_authority: Pubkey::new_unique(), total_limit: TESTER_LIMIT, total_used: 0, seed_used: 0 }.try_serialize(&mut &mut p[..]).unwrap();
        BetaAccess { owner, used: 0, enabled: true }.try_serialize(&mut &mut a[..]).unwrap();
        let mut pl = 1; let mut al = 1;
        let policy_info = AccountInfo::new(&policy_key, false, true, &mut pl, &mut p, &crate::ID, false, 0);
        let access_info = AccountInfo::new(&access_key, false, true, &mut al, &mut a, &crate::ID, false, 0);
        let accounts = [policy_info.clone(), access_info.clone()];
        assert!(charge_seed(&accounts, owner, Pubkey::new_unique(), 1).is_err());
        charge_seed(&accounts, owner, owner, 12_500_000).unwrap();
        charge_seed(&accounts, owner, owner, 12_500_000).unwrap();
        assert!(charge_seed(&accounts, owner, owner, 1).is_err());
        let seeded = BetaPolicy::try_deserialize(&mut &policy_info.try_borrow_data().unwrap()[..]).unwrap();
        assert_eq!(seeded.seed_used, SEED_LIMIT);
        assert_eq!(seeded.total_used, 0);
        assert_eq!(BetaAccess::try_deserialize(&mut &access_info.try_borrow_data().unwrap()[..]).unwrap().used, 0);
        charge(&accounts, owner, 6_000_000).unwrap();
        charge(&accounts, owner, 4_000_000).unwrap();
        assert!(charge(&accounts, owner, 1).is_err());
        let stored = BetaAccess::try_deserialize(&mut &access_info.try_borrow_data().unwrap()[..]).unwrap();
        assert_eq!(stored.used, WALLET_LIMIT);
        assert!(charge(&accounts, Pubkey::new_unique(), 1).is_err());
        let mut readonly = access_info.clone(); readonly.is_writable = false;
        assert!(charge(&[policy_info.clone(), readonly], owner, 1).is_err());
        let wrong_program = Pubkey::new_unique();
        let mut foreign = access_info.clone(); foreign.owner = &wrong_program;
        assert!(charge(&[policy_info.clone(), foreign], owner, 1).is_err());
        BetaAccess { owner, used: 0, enabled: false }.try_serialize(&mut &mut access_info.try_borrow_mut_data().unwrap()[..]).unwrap();
        assert!(charge(&accounts, owner, 1).is_err());
        BetaAccess { owner, used: 0, enabled: true }.try_serialize(&mut &mut access_info.try_borrow_mut_data().unwrap()[..]).unwrap();
        BetaPolicy { access_authority: Pubkey::new_unique(), total_limit: 1, total_used: 1, seed_used: SEED_LIMIT }.try_serialize(&mut &mut policy_info.try_borrow_mut_data().unwrap()[..]).unwrap();
        assert!(charge(&accounts, owner, 1).is_err());
        assert_eq!(BetaAccess::try_deserialize(&mut &access_info.try_borrow_data().unwrap()[..]).unwrap().used, 0);
    }
}
