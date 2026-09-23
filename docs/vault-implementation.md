# Vault implementation work record

Status: deployed and verified on Solana Devnet, September 23, 2026.
Legacy administrator pools and buyer contract layouts remain unchanged.

## Release scope

Two asset-specific fixed-round vaults: NVDAx (asset 0) and Anthropic (asset 1).
Deposits and payouts use configured test oUSD only. No transferable shares,
leverage, external lending, automatic reinvestment, or manufactured returns.
Buyer demand and profitability are not Devnet release gates.

## Decisions

- One ownership unit per deposited base unit during funding.
- Deposits can be cancelled before the funding cutoff.
- Ownership freezes at activation. No mid-round entry or exit.
- No management/performance fee in the first version. No modelled costs are
  deducted as though actually paid. Existing zero-fee buyer quotes remain zero.
- All credited premiums remain separate from principal underwriting capacity.
- Released, unspent principal can back further contracts until sales close,
  within the original exposure and term limits. Realized losses reduce capacity.
- Each depositor redeems their full ownership record once. Redemptions use the
  original frozen denominator, not the remaining shares or current token balance.
- Dust stays in the round; no privileged dust sweep or last-redeemer windfall.
- No administrator withdrawal instruction may debit depositor-owned funds.
- Quotes and reference authorities, reference version, pricing-policy commitment,
  asset, term bounds, capacity, and all timing limits must be fixed before deposits.
  A pricing-policy hash documents a policy; it does not prove the quote service
  followed the model. Hard limits must be enforced onchain.
- Pauses can block funding/new sales, not valid settlement or redemption.

Round publishing uses five minutes of funding followed by a thirty-minute active
window. New positions stop five minutes before latest expiry. Delayed reference
resolution can extend the lock; the duration is not a withdrawal guarantee.
Both users and the disclosed administrator can deposit with identical ownership
and redemption rules. No legacy capital or historical results are imported.

Numerical capacity, strike/duration bounds, and reference caps must be specified
per asset before any round accepts deposits. They are configurable between rounds,
not permissions to increase risk after existing depositors lock.

## Accounting identity

All amounts use integer token base units. Reserve maximum payouts rounding up;
buyer payouts, refunds, and depositor redemptions round down.

Tracked balance = available principal + reserved principal + collected premiums
                  - paid premium refunds - completed depositor redemptions.

Equivalent identity = net funding + collected premiums - buyer payouts
                    - paid premium refunds - completed depositor redemptions.

Unsolicited token donations never mint ownership or increase underwriting capacity.
Actual custody balance must cover tracked balance; a deficit is an error.
Failed transactions contribute no receipts. Final balance freezes only after
sales close and every contract/request/refund obligation has resolved.

## Worked examples (not public activity)

### Loss and two depositors

A deposits 440 oUSD; B deposits 660 oUSD. Their shares are 40% and 60%.
One contract reserves 1,100 oUSD and pays an actual premium of 89.83 oUSD.
A qualifying settlement at 900 against a floor of 1,100 pays the buyer 200.
Final round balance is 989.83. A receives 395.932 and B receives 593.898.
Redemption order does not change either entitlement.

### Partial exercise then reference failure

Starting principal 1,000; quantity 10; floor 100; premium 90.
Exercise quantity 4 at reference 80 pays 80. Remaining quantity 6 later qualifies
for a reference-failure refund of 54 (90 × 6 / 10). No second payout for those 6.
Final depositor balance: 1,000 + 90 - 80 - 54 = 956 oUSD.

### No demand or missed activation

With no issued contracts, there are no premiums and no investment return.
After the sales deadline, a round with no obligations becomes redeemable at its
tracked principal balance even if an operator never activated it.

### Total principal loss

Zero final value must still permit a depositor to consume their claim once.
Do not require a positive token transfer to mark the ownership record redeemed.

## Implementation boundaries

Implemented:

- Isolated round custody, ownership, position, and exercise-request accounts.
- Deposit, funding cancellation, activation, purchase, partial exercise,
  expiry settlement, reference-failure refund, finalization, and redemption.
- Signed quotes bound to program, round, buyer, terms, and premium limit.
- Existing durable observation buffer supplies vault keeper settlement samples.
- Both-asset Vaults UI, review/confirmation, transaction recovery, buyer portfolio
  integration, backing-round links, and named onchain activity.
- Pricing commitments hash the pricing and fixed-math source plus asset assumptions.
  Old rounds fail closed after incompatible pricing code changes; do not change
  that code while rounds still need quotes without preserving their policy.
- Sponsorship rejects custom compute budgets and caps the RPC-calculated fee.

Verification includes 28 Rust unit tests, 129 TypeScript tests, and 34 actual
local-validator integration checks across both assets. Partial exercise paid
8 test oUSD, expiry paid the remaining 12, and administrator/user redemptions
were 594/396 from a 600/400 deposit split in each isolated fixture round.
Client deposit/purchase bytes and account ordering match the generated Anchor IDL.
Fixtures are confined to the local-only
test script. These checks are not proof of live reference availability or a
mainnet security audit.

The extended local-validator run passed 44 checks for both assets, including
paused deposits/purchases, cancellation while paused, future-window rejection,
partial exercise while paused, reference-failure grace periods, unauthorized
publishers, duplicate refunds, finalization, and one-time proportional redemption.
After 8 oUSD partial exercise and 6 oUSD remaining-premium refund, administrator
and user received 597.6/398.4 from their original 600/400 deposits. These are
isolated fixtures, not public activity. Build, server typecheck and lint pass.

## Devnet verification

The [program upgrade](https://explorer.solana.com/tx/7yynuKzUvEx4kJEYJLUeujhZDGpAKqEqyqh2tEg8vaTt2U8NLVhppkzhQHQaHnsrBZJM5GtPMQTjrQi6Zqr3jw8?cluster=devnet)
was finalized and the deployed bytes matched the tested binary. Both assets
completed real browser deposits, signed purchases, partial exercise, expiry
settlement, and proportional redemptions through the hosted services. Funding
cancellation and redeposit also passed. Settlement used actual market observations;
neither verification round needed a reference-failure refund.

Each round received 6,000 administrator and 4,000 browser-depositor test oUSD.
NVDAx collected 9.703376 and paid 7.651085; Anthropic collected 36.293062 and
paid 10.321879. Browser redemptions were
[4,000.820916 oUSD for NVDAx](https://explorer.solana.com/tx/4g66FN38Tvk3oAorhV1EDavQ3BBgaLrBhKmwD1UosdwRdUoFTZAdagfctstSLPVx2NJish4NkLFNt8QCyJWgSLHA?cluster=devnet)
and [4,010.388473 oUSD for Anthropic](https://explorer.solana.com/tx/3gMFVqmYs1saiBmPBCC1nVRDG3fk4vrxiHeXJ6zrRXkZzkKAcdFmqUzu78covdXoisAzLiibHc8Fh4CVSvZmDKzp?cluster=devnet).
These are test-token results, not expected returns or a mainnet audit.

Quote and keeper services use `VAULTS_ENABLED`; the frontend uses
`VITE_VAULTS_ENABLED`. All default to false for coordinated releases. The keeper
uses the existing private Devnet RPC for activation, settlement and finalization.
New rounds and administrator seed deposits still require an explicit operator
action. Automatic round publication and seed recycling are not implemented.

## Publishing a round

`scripts/publish-vault-round.ts` is Devnet-only and defaults to a read-only preview.
Use RPC_URL (or the local Solana CLI RPC) and existing ADMIN_SECRET (or the local Solana key). Supply
VAULT_ASSET_ID (0 or 1), VAULT_ROUND_ID, VAULT_ADMIN_DEPOSIT, VAULT_DEPOSIT_CAP,
VAULT_EXPOSURE_CAP, VAULT_MIN_STRIKE, VAULT_MAX_STRIKE, and VAULT_MAX_QUANTITY.
Amounts are decimal UI units, at most six decimal places. Zero administrator
deposit is allowed. The command never mints funds or withdraws legacy capital.

Run `npx tsx scripts/publish-vault-round.ts` to inspect terms. Add `--send` only
after reviewing them. Creation and administrator deposit are atomic. If a send
times out, inspect the same round ID before any retry; an existing round is
rejected to prevent a duplicate deposit. Later rounds require a separate explicit
operator action. Redeeming an administrator deposit follows ordinary owner rules.

The internal Active phase includes the settling period after sales close. UI must
derive "Settling" from onchain time and obligations, not assume Active means new
sales remain permitted. Expected redemption time is not a guaranteed unlock.
