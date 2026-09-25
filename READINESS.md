# Devnet verification

Checked 25 September 2026 against the hosted Airbag services. This is a release
check, not a security audit or a mainnet-readiness claim.

## Build and setup

- 204 tests across 40 files pass, along with frontend build, server type check
  and lint.
- A clean checkout installs with `npm ci` and builds successfully.
- Local links in README, deployment and architecture documentation resolve.
- The deployed Solana program matches the local binary:
  `4249a1860b27633d2b37fa408f015f171d14f60a462fc48096416beb5ff8c4b5`.

## Hosted services

- Both token-market references are available, with two short and two weekly
  floors per asset. Purchases are not paused.
- Keeper private health is healthy, persistence is enabled, and both observation
  buffers contain fresh samples. Both Railway services have separate volumes.
- Series and vault-round rotation are enabled. Availability remains conditional
  on real references, capital and operational checks; it is not guaranteed.
- Fee sponsorship has funded SOL and spending-cap headroom. Balance snapshots
  are not a guarantee of capacity throughout judging; continue checking health.

## Transaction evidence

- A fresh zero-SOL wallet deposited and cancelled 1 test oUSD in each asset's
  funding round. Exact token balances were restored.
- New 0.01-token positions were purchased for both assets and 0.004-token partial
  exercise requests settled through the hosted keeper using real observations.
  Both subsequently expired with zero remaining quantity and zero reserves,
  without the reference-failure refund path. The test wallet remained at zero SOL:
  [NVDAx contract](https://explorer.solana.com/address/3ssrwuFEXp9AkzoF7gdZWFZHNWdtK5isqH6iw77PFfGn?cluster=devnet),
  [Anthropic contract](https://explorer.solana.com/address/CS6UkFBD4PdojEZgywnCHY5MeaBoFPGZj2GSc4jUEMSD?cluster=devnet).
- Existing completed vault rounds for both assets have onchain premium receipts,
  payouts, proportional redemptions, zero refunds and no remaining obligations.
  See [vault lifecycle evidence](docs/vault-implementation.md).
- A browser withdrawal returned 100 test oUSD to the connected wallet. The
  withdrawn state and balance survived reload:
  [confirmed withdrawal](https://explorer.solana.com/tx/25MFnkKKg5rqjkNFF8mW8gaMxvJr4iLmoF5tdhq5DcwHJ31poYokGRwkyM4CXRML76BKW7VZqpNyQYUfzErLThyR?cluster=devnet).

## Limits of this check

- Invalid quantity and review cancellation were checked in the live browser.
  RPC outage, transaction reconciliation and stale-reference behavior have
  automated test coverage; this does not replace full browser fault injection.
- Responsive desktop/tablet/mobile checks do not replace physical iOS/Android
  testing. A full fresh vault round was not repeated during this check; completed
  rounds were inspected, alongside new deposit/cancel and withdrawal transactions.
- A targeted scan of 614 historical text blobs found no GitHub-token,
  private-key-PEM or credential-bearing QuickNode URL pattern matches. This is
  not a comprehensive secret audit.
- Dependency audit: 14 affected packages (6 high, 8 moderate, no critical),
  including transitive Solana libraries and optional Anchor/Mocha tools.
  No breaking automatic dependency upgrades were applied. Runtime reachability
  and compatible remediation need a dedicated dependency review.
- Operational alert delivery and physical-device testing remain to be verified.
