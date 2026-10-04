# Private mainnet beta

The Devnet demo remains unchanged. The mainnet workspace is `/?beta=1`.
Mainnet is **not activated by deploying the frontend**. Until the separate
deployment is configured, that route reports that the beta is closed.

## Limits and access

- 10 USDC lifetime total per wallet, shared across premiums and vault deposits.
- No allowance reset on cancellation, redemption, payout, refund or reactivation.
- Tester participation is capped at 20 USDC in total across both assets.
- The configured administrator can supply a separate 25 USDC lifetime seed
  budget, combined across both vaults, through `seed_vault`. An enabled invite
  access record is still required. Ordinary admin purchases and deposits keep
  the normal tester limits; this is not a general admin exemption.
- Neither seed cancellations nor seed redemptions restore the seed budget.
- A lower tester cap may be selected at initialization; above 20 USDC is rejected.
- Limits apply to accepted participation, not wallet balances or unsolicited transfers.
- Invite codes use 192 random bits. Only hashes are stored. One redemption binds
  each code to a wallet after a nonce-bound, origin-bound signature.
- Once the deployment is active, a valid invite grants access automatically.
  There is no separate per-tester approval or service-level admission switch.
  The onchain emergency pause and reference-health checks remain in place.
- Revocation blocks new participation onchain. Existing withdrawals and settlement
  remain accessible, including through the authenticated workspace.
- The access authority can grant wallets; the publisher and quote signer remain
  trust assumptions. Upgrade authority can change the program. Do not advertise
  this beta as audited or trustless.

## Separate deployment

Do not upgrade the judging Devnet program. Create dedicated mainnet program and
admin keys using an approved wallet/key-management workflow. Never reuse demo keys.
Pin public keys with `AIRBAG_MAINNET_PROGRAM_ID` and `AIRBAG_MAINNET_ADMIN` when
building `optket` with the `mainnet-beta` feature. The build rejects the Devnet
program ID; initialization is restricted to the pinned admin and canonical USDC.
The mainnet build starts paused. Its legacy purchase and pool-funding paths reject
calls; vault purchase/deposit/seed instructions require the canonical policy/access PDAs.
This is the predeployment 64-byte beta policy layout, including the seed counter.
It must not be installed over an earlier policy layout without a reviewed migration.

Before activation: verify reproducible SBF build and deployment, authority custody,
program bytecode, account layouts, USDC mint, both asset mandates, and a real
end-to-end lifecycle on an isolated validator. Host Rust tests are not a substitute
for that transaction-level test or a security review.

## Service configuration

Use a separate service and persistent volume, one replica. Start with
`npm run beta:service`; no faucet or sponsorship endpoints exist in this service.
Use Node 22.13 or newer for its built-in SQLite API.

Required when enabled:

```
BETA_ENABLED=false
BETA_ORIGIN=https://www.airbag.fyi
BETA_RPC_URL=<private HTTPS mainnet RPC>
BETA_PROGRAM_ID=<dedicated program public key>
BETA_DB_PATH=/data/beta.sqlite
BETA_OBSERVATIONS_PATH=/data/beta-observations.json
BETA_ACCESS_SECRET=<dedicated access-authority keypair>
BETA_QUOTE_SECRET=<dedicated quote-authority keypair>
BETA_PUBLISHER_SECRET=<dedicated publisher keypair>
MAINNET_RPC=<private mainnet RPC for reference block times>
```

Keep secrets in the hosting secret manager. `VITE_BETA_SERVICE` is the public
HTTPS beta-service URL only, never a provider credential. No paid plan is changed
by this code. Existing references and vault-settlement rules are reused; no prices
or transactions are fabricated. The embedded keeper persists real observations.

## Operator steps

`npm run beta:admin -- <command>` uses injected environment variables. Chain
commands simulate by default and send only with `--execute`:

1. `config`: initialize paused config using `BETA_ADMIN_SECRET`,
   `BETA_QUOTE_PUBLIC_KEY`, `BETA_PUBLISHER_PUBLIC_KEY`.
2. `policy`: supply `BETA_ACCESS_PUBLIC_KEY`. The tester cap defaults to the agreed
   20 USDC. Optional `BETA_TOTAL_LIMIT_BASE_UNITS` can lower it, never raise it.
   Units are millionths of USDC. Seed capital has its own fixed 25 USDC cap.
3. `asset 0` and `asset 1`: supply explicit `BETA_ASSET_EXPOSURE_BASE_UNITS`.
4. `check`: verify chain, executable, mint, config and beta policy.
5. `unpause`, then `round`: publish reviewed mandates with `BETA_ROUND_ID` and
   JSON `BETA_ROUND_TERMS` (the `VaultTerms` fields, integer token base units).
6. Start the service with `BETA_ENABLED=true` after deployment verification.
   Valid invitations grant access without a further approval step. New purchases
   still require keeper health, available collateral and qualifying references.
   Use the onchain `pause` command if inflows must be stopped in an emergency.

Vault capital is not created automatically. After redeeming an invite with the
configured admin wallet, the workspace shows **Seed vault**. Select the asset,
funding round and amount, review the deposit, and sign in the external wallet.
This path uses the separate seed budget. Both assets share 25 USDC; no allocation
is transferred automatically. The program checks the admin signer and budget,
not just whether the UI displays the action. Funds receive normal vault shares
and use the normal cancellation, lock-up and redemption rules. Payouts can reduce
their value. Seed capital cannot be replenished after using the lifetime budget.

Create the funding/admin wallet yourself and keep its seed/private key private.
The seed UI never asks for it. The operator CLI is for operator-controlled signing
environments; do not send its secret environment values in chat. Deployment and
service operating SOL are additional to the USDC budgets.

An unfunded vault cannot issue quotes. Use fractional token quantities consistent
with this small fully reserved beta; 25 USDC cannot reserve a full high-price token.

## Invitations

Run the CLI against the service's persistent database and exact origin/program.

- `invites 10 <ISO expiry> --execute` prints ten codes once. Do not run until
  invitations are wanted; do not put output in Git, logs or a public document.
- `list` lists hashes, expiry, bound wallets and revocation state, not codes.
- `revoke-code <hash> --execute` invalidates an unused invitation.
- `revoke-wallet <public key> --execute` revokes onchain first, then local access.

Send a single code privately to each tester. Do not publish codes or generate
them in the browser. No invitations are generated by startup or frontend builds.
After redemption, returning wallets sign a fresh ownership challenge without a
new invitation. Sessions last one hour and are held in browser memory only.
The access screen asks testers to verify access before loading up to 10 USDC,
plus SOL for transaction fees. This is a funding instruction, not a claim that
Airbag can restrict transfers into a user's external wallet. The program enforces
the separate 10 USDC lifetime participation limit.

## Release boundary

This implementation does not deploy a mainnet program, fund a wallet, publish
vault rounds, issue invitations or change a hosting plan. Those are separate
operator actions requiring reviewed configuration and transaction fees.

## Local transaction tests

Use the installed Solana/Agave `cargo-build-sbf` with platform-tools v1.54 or newer.
For the **disposable test binary only**, build the mainnet feature with:

```
AIRBAG_MAINNET_PROGRAM_ID=Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGvG95yGLr
AIRBAG_MAINNET_ADMIN=92CudvFbL7Tyw2RkWC7NU1ehdNBSjy8FEG1TsJaN8wgz
```

These test identities must never be used for a real deployment. Set
`BETA_TEST_BINARY` to that binary and `SOLANA_TEST_VALIDATOR` to the installed
validator, then run `node --import tsx scripts/test-beta-validator.ts`.
The script starts an isolated localhost validator with disposable keys and a
canonical-address test mint. It tests initialization restrictions, denied access,
cross-asset caps, cancellations, revocation/reactivation, signed purchases,
replay protection, atomic rollback and partial exercise after revocation. It also
tests unauthorized/forged seed requests, the 25 USDC cross-asset seed cap,
separation from tester counters, cancellation without reset, failed-deposit rollback,
and the 20 USDC combined tester cap with individual allowance remaining.
It cannot target a remote RPC. The production services do not contain these fixtures.
