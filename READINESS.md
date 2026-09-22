# Devnet release checks — 22 September 2026

## Implemented

- Keeper observation snapshots, original timestamps and reference-version scope;
  network/program/publisher validation, expiry pruning and non-overlapping ticks.
- Restricted, paced RPC relay behind `RPC_PROXY_ENABLED`; frontend opt-in through
  `VITE_USE_RPC_RELAY`. Private endpoints remain server-side.
- Weekly and short series rollover; existing contracts remain unchanged.
- Read-only `npm run check:devnet` and more detailed health responses.
- Separate scenario holdings/protected quantities; confirmed expiry-event receipts.
- Read-only demo-wallet restoration, cross-tab submission lock and journal sync;
  chain-bound transaction recovery across provider changes.
- Durable trial-cap increase handling without resetting spend or wallet limits.
- GitHub Actions checks, updated setup/deployment notes and page metadata.

## Verified locally

- Build, lint, server type check and 91 unit/component tests pass.
- Browser reload restores an existing wallet; scenario holdings can differ from
  protected quantity and change the displayed arithmetic independently.
- Live read-only service check: references available, two floors per asset and
  duration, funded sponsorship and remaining cap headroom.
- Targeted scan of 344 Git-history blobs: no private QuickNode URL, GitHub token,
  private-key PEM or 64-byte key-array pattern matches. Not a comprehensive audit.

## Still requires completion

- Approve and attach a separate keeper volume, set `KEEPER_STATE_PATH`, then
  verify real observation recovery through a controlled hosted restart.
- Configure/enable the private RPC relay on Railway, integration-test it, enable
  the frontend flag on Vercel, and verify the published bundle has no credentials.
- Select the operational-alert destination and verify delivery.
- Verify hosted weekly rollover and expiry receipts after deployment.
- Finish two-tab submission/refresh testing, positive mainnet holdings import,
  sponsorship/network failure checks and physical mobile-browser testing.
- Complete social preview artwork and final accessibility/performance review.
- Review repository publication separately; visibility has not been changed.

Video and pitch materials are outside this checklist. No mainnet readiness claim.
