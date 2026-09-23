//! Fixed-round vault accounting used by instructions/vaults.rs.
//!
//! The instruction layer must bind this ledger to a round PDA, authenticate
//! owners, validate references, and perform token transfers atomically. These
//! functions deliberately do not read token balances as depositor ownership.
//! Existing Pool/Contract account layouts and instructions are unchanged.

use anchor_lang::prelude::*;
use crate::{errors::OptketError, math};

fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or_else(|| error!(OptketError::MathOverflow))
}
fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or_else(|| error!(OptketError::InvariantViolation))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum RoundPhase { Funding, Active, Redeemable }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct RoundTerms {
    pub asset_id: u8,
    pub funding_close: i64,
    pub sales_close: i64,
    pub latest_expiry: i64,
    pub deposit_cap: u64,
    pub exposure_cap: u64,
    pub min_strike: u64,
    pub max_strike: u64,
    pub max_quantity: u64,
}

impl RoundTerms {
    pub fn validate(&self, now: i64) -> Result<()> {
        require!(self.asset_id <= 1, OptketError::InvalidVaultTerms);
        require!(now < self.funding_close && self.funding_close < self.sales_close
            && self.sales_close < self.latest_expiry, OptketError::InvalidVaultTerms);
        require!(self.deposit_cap > 0 && self.exposure_cap > 0
            && self.exposure_cap <= self.deposit_cap, OptketError::InvalidVaultTerms);
        require!(self.min_strike > 0 && self.max_strike >= self.min_strike
            && self.max_quantity > 0, OptketError::InvalidVaultTerms);
        Ok(())
    }
}

/// One base unit deposited creates one ownership unit before activation.
/// `total_shares` freezes at activation, including during redemptions.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct RoundLedger {
    pub terms: RoundTerms,
    pub phase: RoundPhase,
    pub total_shares: u64,
    pub redeemed_shares: u64,
    pub principal_available: u64,
    pub reserved: u64,
    pub premiums: u64,
    pub payouts: u64,
    pub refunds: u64,
    pub open_contracts: u64,
    pub final_balance: u64,
    pub redeemed_amount: u64,
}

impl RoundLedger {
    pub fn new(terms: RoundTerms, now: i64) -> Result<Self> {
        terms.validate(now)?;
        Ok(Self { terms, phase: RoundPhase::Funding, total_shares: 0,
            redeemed_shares: 0, principal_available: 0, reserved: 0,
            premiums: 0, payouts: 0, refunds: 0, open_contracts: 0,
            final_balance: 0, redeemed_amount: 0 })
    }

    pub fn deposit(&mut self, amount: u64, now: i64) -> Result<()> {
        require!(self.phase == RoundPhase::Funding && now < self.terms.funding_close,
            OptketError::VaultFundingClosed);
        require!(amount > 0, OptketError::ZeroQuantity);
        let shares = add(self.total_shares, amount)?;
        require!(shares <= self.terms.deposit_cap, OptketError::VaultCapacityExceeded);
        let principal = add(self.principal_available, amount)?;
        self.total_shares = shares;
        self.principal_available = principal;
        Ok(())
    }

    /// Caller must also debit the authenticated depositor's ownership record.
    pub fn cancel_deposit(&mut self, amount: u64, now: i64) -> Result<()> {
        require!(self.phase == RoundPhase::Funding && now < self.terms.funding_close,
            OptketError::VaultFundingClosed);
        require!(amount > 0, OptketError::ZeroQuantity);
        let shares = sub(self.total_shares, amount)?;
        let principal = sub(self.principal_available, amount)?;
        self.total_shares = shares;
        self.principal_available = principal;
        Ok(())
    }

    pub fn activate(&mut self, now: i64) -> Result<()> {
        require!(self.phase == RoundPhase::Funding && now >= self.terms.funding_close
            && now < self.terms.sales_close, OptketError::InvalidVaultPhase);
        require!(self.total_shares > 0, OptketError::InsufficientCollateral);
        self.phase = RoundPhase::Active;
        Ok(())
    }

    /// Premiums never increase principal underwriting capacity. Released
    /// principal may be reused, within the frozen mandate and sales window.
    /// Call only after signature/quote verification; premium is actually paid.
    pub fn issue(&mut self, asset_id: u8, quantity: u64, strike: u64,
        expiry: i64, premium: u64, now: i64) -> Result<ContractLedger> {
        require!(self.phase == RoundPhase::Active && now < self.terms.sales_close,
            OptketError::InvalidVaultPhase);
        require!(asset_id == self.terms.asset_id && quantity > 0
            && quantity <= self.terms.max_quantity && strike >= self.terms.min_strike
            && strike <= self.terms.max_strike && expiry > now
            && expiry <= self.terms.latest_expiry, OptketError::InvalidVaultTerms);
        let reserve = math::max_liability(quantity, strike)?;
        require!(reserve <= self.principal_available, OptketError::InsufficientCollateral);
        let reserved = add(self.reserved, reserve)?;
        require!(reserved <= self.terms.exposure_cap, OptketError::VaultCapacityExceeded);
        let premiums = add(self.premiums, premium)?;
        let open_contracts = add(self.open_contracts, 1)?;
        // Reject a token balance that would exceed u64 before mutating state.
        add(self.tracked_balance()?, premium)?;
        self.principal_available = sub(self.principal_available, reserve)?;
        self.reserved = reserved;
        self.premiums = premiums;
        self.open_contracts = open_contracts;
        Ok(ContractLedger { original_quantity: quantity, remaining_quantity: quantity,
            strike, premium, reserved: reserve })
    }

    /// Accounting only. The instruction layer must bind `contract` to this
    /// round, resolve pending requests, and validate the settlement reference.
    pub fn settle(&mut self, contract: &mut ContractLedger, quantity: u64,
        reference: u64) -> Result<u64> {
        require!(self.phase == RoundPhase::Active, OptketError::InvalidVaultPhase);
        require!(quantity > 0 && quantity <= contract.remaining_quantity,
            OptketError::ExceedsRemaining);
        let remaining = sub(contract.remaining_quantity, quantity)?;
        let reserve_after = math::max_liability(remaining, contract.strike)?;
        let released = sub(contract.reserved, reserve_after)?;
        let payout = math::payout(quantity, contract.strike, reference)?;
        let residual = sub(released, payout)?;
        let principal = add(self.principal_available, residual)?;
        let reserved = sub(self.reserved, released)?;
        let payouts = add(self.payouts, payout)?;
        let open_contracts = if remaining == 0 { sub(self.open_contracts, 1)? }
            else { self.open_contracts };
        self.principal_available = principal;
        self.reserved = reserved;
        self.payouts = payouts;
        self.open_contracts = open_contracts;
        contract.remaining_quantity = remaining;
        contract.reserved = reserve_after;
        Ok(payout)
    }

    /// Refund the premium for the unextinguished quantity exactly once. The
    /// separate premium balance means refunds never depend on free principal.
    pub fn refund(&mut self, contract: &mut ContractLedger) -> Result<u64> {
        require!(self.phase == RoundPhase::Active, OptketError::InvalidVaultPhase);
        require!(contract.remaining_quantity > 0, OptketError::ContractNotActive);
        let refund = math::proportional_premium(contract.premium,
            contract.remaining_quantity, contract.original_quantity)?;
        let refunds = add(self.refunds, refund)?;
        require!(refunds <= self.premiums, OptketError::InvariantViolation);
        let reserved = sub(self.reserved, contract.reserved)?;
        let principal = add(self.principal_available, contract.reserved)?;
        let open_contracts = sub(self.open_contracts, 1)?;
        self.refunds = refunds;
        self.reserved = reserved;
        self.principal_available = principal;
        self.open_contracts = open_contracts;
        contract.remaining_quantity = 0;
        contract.reserved = 0;
        Ok(refund)
    }

    /// Also releases a missed activation after its sales window closes.
    /// Pending requests must keep their parent contract open in the adapter.
    pub fn finalize(&mut self, now: i64) -> Result<()> {
        require!(self.phase != RoundPhase::Redeemable && now >= self.terms.sales_close,
            OptketError::InvalidVaultPhase);
        require!(self.open_contracts == 0 && self.reserved == 0,
            OptketError::VaultObligationsOutstanding);
        let balance = self.tracked_balance()?;
        self.final_balance = balance;
        self.phase = RoundPhase::Redeemable;
        Ok(())
    }

    /// Fixed numerator/denominator: redemption order cannot change entitlements.
    /// Caller consumes a depositor's entire record once, even for a zero payout.
    /// Rounding dust stays in the round; it is not assigned to the last caller.
    pub fn redeem(&mut self, shares: u64) -> Result<u64> {
        require!(self.phase == RoundPhase::Redeemable, OptketError::InvalidVaultPhase);
        require!(shares > 0 && self.total_shares > 0, OptketError::ZeroQuantity);
        let redeemed_shares = add(self.redeemed_shares, shares)?;
        require!(redeemed_shares <= self.total_shares, OptketError::InvariantViolation);
        let amount = u64::try_from((shares as u128).checked_mul(self.final_balance as u128)
            .ok_or(OptketError::MathOverflow)? / self.total_shares as u128)
            .map_err(|_| error!(OptketError::MathOverflow))?;
        let redeemed_amount = add(self.redeemed_amount, amount)?;
        require!(redeemed_amount <= self.final_balance, OptketError::InvariantViolation);
        self.redeemed_shares = redeemed_shares;
        self.redeemed_amount = redeemed_amount;
        Ok(amount)
    }

    /// Excludes donations. Token adapter must check actual balance >= tracked.
    pub fn tracked_balance(&self) -> Result<u64> {
        let premium_balance = sub(self.premiums, self.refunds)?;
        sub(add(add(self.principal_available, self.reserved)?, premium_balance)?,
            self.redeemed_amount)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct ContractLedger {
    pub original_quantity: u64,
    pub remaining_quantity: u64,
    pub strike: u64,
    pub premium: u64,
    pub reserved: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    const U: u64 = 1_000_000;
    fn terms(asset_id: u8) -> RoundTerms {
        RoundTerms { asset_id, funding_close: 100, sales_close: 200, latest_expiry: 300,
            deposit_cap: 10_000 * U, exposure_cap: 10_000 * U,
            min_strike: U, max_strike: 2_000 * U, max_quantity: 100 * U }
    }
    fn funded(asset: u8, amount: u64) -> RoundLedger {
        let mut r = RoundLedger::new(terms(asset), 0).unwrap();
        r.deposit(amount, 1).unwrap();
        r.activate(100).unwrap();
        r
    }
    fn invariant(r: &RoundLedger) {
        assert_eq!(r.tracked_balance().unwrap() as u128,
            r.total_shares as u128 + r.premiums as u128 - r.payouts as u128
            - r.refunds as u128 - r.redeemed_amount as u128);
        assert!(r.reserved <= r.terms.exposure_cap);
    }
    #[test]
    fn validates_asset_times_and_caps() {
        assert!(RoundLedger::new(terms(2), 0).is_err());
        assert!(RoundLedger::new(terms(0), 100).is_err());
        let mut t = terms(0); t.sales_close = 100;
        assert!(RoundLedger::new(t, 0).is_err());
        t = terms(0); t.exposure_cap = t.deposit_cap + 1;
        assert!(RoundLedger::new(t, 0).is_err());
    }
    #[test]
    fn funding_boundaries_and_cancellation() {
        let mut r = RoundLedger::new(terms(0), 0).unwrap();
        assert!(r.deposit(0, 1).is_err());
        assert!(r.deposit(10_001 * U, 1).is_err());
        r.deposit(100 * U, 99).unwrap();
        r.cancel_deposit(25 * U, 99).unwrap();
        assert_eq!(r.total_shares, 75 * U);
        assert!(r.activate(99).is_err());
        assert!(r.deposit(U, 100).is_err());
        assert!(r.cancel_deposit(U, 100).is_err());
        r.activate(100).unwrap();
        assert!(r.activate(101).is_err());
        assert!(r.redeem(U).is_err());
        invariant(&r);
    }
    #[test]
    fn assets_do_not_mix() {
        for asset in [0, 1] {
            let mut r = funded(asset, 1_100 * U);
            let before = r.clone();
            assert!(r.issue(1 - asset, U, 1_100 * U, 250, 90 * U, 110).is_err());
            assert_eq!(r, before);
            assert!(r.issue(asset, U, 1_100 * U, 250, 90 * U, 110).is_ok());
        }
    }
    #[test]
    fn premium_cannot_fund_more_liability() {
        let mut r = funded(0, 100 * U);
        r.issue(0, U, 100 * U, 250, 50 * U, 110).unwrap();
        assert_eq!(r.principal_available, 0);
        let before = r.clone();
        assert!(r.issue(0, U, 10 * U, 250, U, 111).is_err());
        assert_eq!(r, before);
        invariant(&r);
    }
    #[test]
    fn mandatory_terms_and_sales_cutoff() {
        let mut r = funded(0, 1_000 * U);
        for (qty, strike, expiry, now) in [(0, U, 250, 110),
            (101 * U, U, 250, 110), (U, 0, 250, 110),
            (U, 2_001 * U, 250, 110), (U, U, 301, 110),
            (U, U, 110, 110), (U, U, 250, 200)] {
            let before = r.clone();
            assert!(r.issue(0, qty, strike, expiry, U, now).is_err());
            assert_eq!(r, before);
        }
    }
    #[test]
    fn proportional_loss_and_order_independent_redemption() {
        let mut r = funded(1, 1_100 * U);
        let mut c = r.issue(1, U, 1_100 * U, 250, 89_830_000, 110).unwrap();
        assert!(r.finalize(300).is_err());
        assert_eq!(r.settle(&mut c, U, 900 * U).unwrap(), 200 * U);
        r.finalize(300).unwrap();
        assert_eq!(r.final_balance, 989_830_000);
        let mut reverse = r.clone();
        let a = r.redeem(440 * U).unwrap();
        let b = r.redeem(660 * U).unwrap();
        assert_eq!(reverse.redeem(660 * U).unwrap(), b);
        assert_eq!(reverse.redeem(440 * U).unwrap(), a);
        assert_eq!(a + b, r.final_balance);
        assert!(r.redeem(1).is_err());
        invariant(&r);
    }
    #[test]
    fn partial_settlement_then_refund_is_not_double_counted() {
        let mut r = funded(0, 1_000 * U);
        let mut c = r.issue(0, 10 * U, 100 * U, 250, 90 * U, 110).unwrap();
        assert_eq!(r.settle(&mut c, 4 * U, 80 * U).unwrap(), 80 * U);
        assert_eq!(r.refund(&mut c).unwrap(), 54 * U);
        assert!(r.refund(&mut c).is_err());
        assert!(r.settle(&mut c, U, 0).is_err());
        r.finalize(300).unwrap();
        assert_eq!(r.redeem(1_000 * U).unwrap(), 956 * U);
        invariant(&r);
    }
    #[test]
    fn zero_demand_and_missed_activation_return_capital() {
        for activate in [true, false] {
            let mut r = RoundLedger::new(terms(0), 0).unwrap();
            r.deposit(100 * U, 1).unwrap();
            if activate { r.activate(100).unwrap(); }
            assert!(r.finalize(199).is_err());
            r.finalize(200).unwrap();
            assert_eq!(r.redeem(100 * U).unwrap(), 100 * U);
            assert!(r.finalize(201).is_err());
        }
    }
    #[test]
    fn complete_loss_still_allows_ownership_to_be_redeemed() {
        let mut r = funded(0, 100 * U);
        let mut c = r.issue(0, U, 100 * U, 250, 0, 110).unwrap();
        r.settle(&mut c, U, 0).unwrap();
        r.finalize(300).unwrap();
        assert_eq!(r.redeem(100 * U).unwrap(), 0);
        assert_eq!(r.redeemed_shares, r.total_shares);
        invariant(&r);
    }
    #[test]
    fn premature_finalization_and_repeat_settlement_fail() {
        let mut r = funded(0, 100 * U);
        let mut c = r.issue(0, U, 100 * U, 250, U, 110).unwrap();
        assert!(r.finalize(10_000).is_err());
        r.settle(&mut c, U, 100 * U).unwrap();
        assert!(r.settle(&mut c, U, 100 * U).is_err());
        r.finalize(10_001).unwrap();
        assert!(r.issue(0, U, U, 10_100, U, 110).is_err());
    }
    #[test]
    fn rounding_and_conservation_across_partial_settlements() {
        for quantity in 1..40 {
            for price in [1, U - 1, U + 1, 1_100 * U + 3] {
                let mut t = terms(1);
                t.min_strike = 1;
                let mut r = RoundLedger::new(t, 0).unwrap();
                r.deposit(1_000 * U, 1).unwrap();
                r.activate(100).unwrap();
                let mut c = r.issue(1, quantity, price, 250, 13, 110).unwrap();
                for _ in 0..quantity {
                    r.settle(&mut c, 1, price / 2).unwrap();
                    invariant(&r);
                }
                assert_eq!(r.reserved, 0);
                assert_eq!(r.open_contracts, 0);
                r.finalize(300).unwrap();
                r.redeem(333 * U).unwrap();
                r.redeem(667 * U).unwrap();
                assert!(r.tracked_balance().unwrap() <= 1);
                invariant(&r);
            }
        }
    }
    #[test]
    fn overflow_rejects_without_mutation() {
        let mut t = terms(0); t.deposit_cap = u64::MAX; t.exposure_cap = u64::MAX;
        let mut r = RoundLedger::new(t, 0).unwrap();
        r.deposit(u64::MAX, 1).unwrap();
        let before = r.clone();
        assert!(r.deposit(1, 1).is_err());
        assert_eq!(r, before);
        r.activate(100).unwrap();
        let before = r.clone();
        assert!(r.issue(0, 1, U, 250, 1, 110).is_err());
        assert_eq!(r, before);
    }

    #[test]
    fn aggregate_cap_applies_across_contracts() {
        let mut t = terms(0);
        t.exposure_cap = 100 * U;
        let mut r = RoundLedger::new(t, 0).unwrap();
        r.deposit(1_000 * U, 1).unwrap();
        r.activate(100).unwrap();
        let mut c = r.issue(0, U, 60 * U, 250, 10 * U, 110).unwrap();
        let before = r.clone();
        assert!(r.issue(0, U, 50 * U, 250, U, 111).is_err());
        assert_eq!(r, before);
        r.settle(&mut c, U, 60 * U).unwrap();
        r.issue(0, U, 100 * U, 250, U, 112).unwrap();
        invariant(&r);
    }

    #[test]
    fn released_principal_reusable_but_premium_is_not() {
        let mut r = funded(0, 100 * U);
        let mut c = r.issue(0, U, 100 * U, 250, 50 * U, 110).unwrap();
        r.settle(&mut c, U, 80 * U).unwrap();
        assert_eq!(r.principal_available, 80 * U);
        assert_eq!(r.tracked_balance().unwrap(), 130 * U);
        assert!(r.issue(0, U, 81 * U, 250, 0, 111).is_err());
        r.issue(0, U, 80 * U, 250, 0, 111).unwrap();
        invariant(&r);
    }

    #[test]
    fn complete_cancellation_can_finalize_an_empty_round() {
        let mut r = RoundLedger::new(terms(0), 0).unwrap();
        r.deposit(10 * U, 1).unwrap();
        r.deposit(20 * U, 2).unwrap();
        r.cancel_deposit(20 * U, 3).unwrap();
        r.cancel_deposit(10 * U, 4).unwrap();
        assert!(r.activate(100).is_err());
        r.finalize(200).unwrap();
        assert_eq!(r.final_balance, 0);
        assert!(r.redeem(1).is_err());
        invariant(&r);
    }

    #[test]
    fn failed_operations_leave_both_ledgers_unchanged() {
        let mut r = funded(0, 100 * U);
        let mut c = r.issue(0, U, 100 * U, 250, U, 110).unwrap();
        let before = (r.clone(), c.clone());
        assert!(r.settle(&mut c, U + 1, 0).is_err());
        assert_eq!((r.clone(), c.clone()), before);
        assert!(r.redeem(U).is_err());
        assert_eq!((r.clone(), c.clone()), before);
        r.refund(&mut c).unwrap();
        let before = (r.clone(), c.clone());
        assert!(r.refund(&mut c).is_err());
        assert_eq!((r.clone(), c.clone()), before);
        r.finalize(300).unwrap();
        let before = r.clone();
        assert!(r.redeem(101 * U).is_err());
        assert_eq!(r, before);
    }

    #[test]
    fn partial_settlements_with_changing_references_conserve_capital() {
        let mut r = funded(1, 100 * U);
        let mut c = r.issue(1, U, 100 * U, 250, 10 * U, 110).unwrap();
        assert_eq!(r.settle(&mut c, U / 4, 0).unwrap(), 25 * U);
        assert_eq!(r.settle(&mut c, U / 4, 110 * U).unwrap(), 0);
        assert_eq!(r.settle(&mut c, U / 2, 50 * U).unwrap(), 25 * U);
        r.finalize(300).unwrap();
        assert_eq!(r.redeem(100 * U).unwrap(), 60 * U);
        invariant(&r);
    }
}
