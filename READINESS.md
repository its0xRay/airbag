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

- Build, lint, server type check and 103 unit/component tests pass.
- Browser reload restores an existing wallet; scenario holdings can differ from
  protected quantity and change the displayed arithmetic independently.
- Live read-only service check: references available, two floors per asset and
  duration, funded sponsorship and remaining cap headroom.
- Targeted scan of 344 Git-history blobs: no private QuickNode URL, GitHub token,
  private-key PEM or 64-byte key-array pattern matches. Not a comprehensive audit.

## Still requires completion

- Select the operational-alert destination and verify delivery.
- Verify hosted weekly rollover; an actual expiry receipt has been checked live.
- Finish two-tab submission/refresh testing, positive mainnet holdings import,
  sponsorship/network failure checks and physical mobile-browser testing.
- Complete social preview artwork and final accessibility/performance review.
- Review repository publication separately; visibility has not been changed.

Video and pitch materials are outside this checklist. No mainnet readiness claim.

## Set Grand1 presentation checks

- Category/hero copy, connected protocol sequence, price-floor boundary visual,
  shared checkout row and secondary disclosures implemented without changing
  pricing, reference policy, transaction submission or onchain programs.
- At 1280 × 800, the embedded primary workspace (asset/reference through purchase
  row) spans approximately 670px. No fixed-height clipping or internal scrolling.
  Browser checks at 375/768/1280px found no horizontal overflow. Keyboard floor
  preset and reference adjustment produced the expected contractual payout.
- Actual hosted Devnet purchase from the local frontend: contract #35,
  0.01 NVDAx, $225 floor, displayed 0.02 oUSD premium, 2.25 oUSD reserved.
  Signature `4oEy6ZBAvjpZ21m27tqAHtmhXUkZSZsA6UYohoiCDsrFSnHTQVvezKcSFBfNRxQJmkeEiVApeLwwKh3Av19NDL3z`.
  Receipt focus and exact-position handoff verified. A prior ANTHROPIC quote above
  the approved premium was correctly rejected, preserving the editable terms.
- Confirmed positions reuse the floor motif with actual reserve/reference data;
  no hypothetical reference or calculated payout is inserted into a receipt.

## Hosted activation and presentation checks

- Keeper `/data` volume and `KEEPER_STATE_PATH` activated. Controlled restart
  retained original observation timestamps; private health returned healthy with
  persistence enabled and fresh samples after restart.
- Railway restricted relay uses the existing QuickNode Devnet endpoint; Vercel
  production opts in through `VITE_USE_RPC_RELAY`. Verified Devnet genesis,
  rejected unsupported RPC, restored wallet/positions and loaded expiry receipt.
  Published JavaScript contained no QuickNode hostname.
- Refined hero, supported-asset categories, selected-term payoff illustration,
  progressive disclosure, proof links and confirmed-purchase position handoff.
  No pricing, reference policy or program changes.
- Local frontend against hosted Devnet: real NVDAx purchase of 0.01 units,
  contract #34, confirmed signature
  `4vvx3uqoJ6aFp4vMYXNkSQzAxRDrqYsku7C4XCjrdnkv4Axgj4iYGiKj3CkfP6afKcG4z4A6pQG6UatJKDL67rmJ`.
  Confirmation and exact-contract focus verified. Responsive browser checks do not
  replace physical mobile-device testing.
- Browser checks at 375, 768 and 1280px: no horizontal overflow, readable asset
  logos, responsive hero/controls, keyboard scenario adjustment and real position
  handoff. Reduced-motion handling inspected in CSS. Existing large-bundle build
  warning remains a performance follow-up.
