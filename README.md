# Optket — downside protection for tokenized equities on Solana

Two-asset MVP implementing the Optket PRD (v1.0). Optket lets a holder pick an
asset, protected quantity, strike and expiry, then buy put-style protection
while keeping their tokens in their wallet.

> **Devnet deployment.** Collateral, premiums and payouts use `oUSD`, a real SPL
> token with **no monetary value** — as is true of every devnet asset. The
> mechanics are not simulated: every transfer, reservation and payout is
> executed and enforced by the deployed program. Real USDC is rejected by
> design, and hedging is modelled rather than executed.

**Deployed to devnet** (program `Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky`).
To host the public app (Vercel + Railway) so anyone can use it, see
**[DEPLOY.md](DEPLOY.md)**. The full lifecycle — signed-quote purchase → exercise
→ keeper settlement with **live Jupiter/Pyth references** → payout — runs on
public devnet, and the Compare tab shows **real live mainnet prices** for the
verified xStocks/PreStocks assets.

---

## What's in the box

| Layer | Path | Status |
|---|---|---|
| On-chain program (Anchor/Rust) | `programs/optket` | Complete source; build with the Solana/Anchor toolchain |
| Protection engine (TypeScript) | `src/engine` | **Test oracle** for the Rust — 21 passing tests (`npm test`). Not used by the app. |
| Web app — full protection journey | `src/App.tsx`, `src/components` | **Fully on-chain** (`npm run dev`) |
| On-chain client | `src/client/optketProgram.ts` | Account decoders + instruction builders used by the app |
| Quote service + sponsorship | `server/quoteService.ts` | **Runs** (`npm run quote-service`) — signs quotes, pays fees/rent (§19) |
| Anchor integration test | `tests/optket.ts` | Runs under `anchor test` |
| Keeper (settlement service) | `server/keeper.ts` | **Runs** (`npm run keeper`) — live references, no synthetic fallback |

**There is no simulated path.** Every tab reads and writes the deployed program:
Protect buys on-chain, Portfolio reads real contract accounts, History comes
from transaction signatures, and Underwriter reads the real pool. The
TypeScript engine is a faithful mirror of the program's arithmetic kept as the
**test oracle** — the vitest suite is an executable specification for the §22
acceptance criteria, not a second implementation of the product.

---

## Quick start (web demo)

```bash
cd optket
npm install
npm run dev        # http://localhost:5173
npm test           # 21 engine + accounting tests
npm run build      # production build
```

### Evidence

```bash
# Attack the DEPLOYED program and assert every rejection code (PRD §22).
# 30/30 passing against public devnet.
RPC_URL=https://api.devnet.solana.com npm run test:adversarial

# Re-publish the weekly series / top up pools (idempotent).
RPC_URL=https://api.devnet.solana.com npm run setup:devnet
```

`test:adversarial` covers quote integrity (expired, over-long TTL, rogue signer,
tampered payload, wrong buyer/strike, missing ed25519 instruction), the
real-USDC/wrong-mint guard, replay protection, exercise limits and
no-double-payout, the observation rules (historical, stale, duplicate slots, too
few, out-of-window), role checks, and pool obligations.

Connect the demo wallet → a burner wallet is created in your browser and given
demo `oUSD`. Fees and account rent are sponsored, so you never need SOL. Then
walk the journey: **select asset → choose quantity & strike → review scenarios →
buy on-chain → monitor → request exercise → keeper settles → expire/refund →
history.** Every step is a real devnet transaction with an explorer link; the
keeper runs as its own service and settles against live references.

---

## On-chain program

### Build & deploy

```bash
# one-time toolchain (versions per Anchor.toml):
#   Rust + Solana CLI + Anchor 0.30.1 (via avm)
anchor build
anchor keys sync          # writes the real program id into lib.rs + Anchor.toml
anchor test               # localnet integration test (tests/optket.ts)

solana config set --url devnet
anchor deploy --provider.cluster devnet
```

### Instructions → PRD mapping

| Instruction | PRD | Notes |
|---|---|---|
| `initialize_config` / `set_pause` / `set_roles` | §20 | admin, quote & publisher authorities, demo mint, pause, trial cap |
| `init_asset` / `set_asset_active` | §4, §12 | per-asset config + pool + vault; activation gate |
| `create_series` | §7 | strike, weekly expiry, purchase & exercise cutoffs, max size |
| `fund_pool` / `withdraw_pool` | §12 | withdrawals blocked below outstanding obligations |
| `purchase` | §8 | ed25519 quote verify, replay guard, exposure & collateral checks, premium transfer, contract creation — all atomic |
| `request_exercise` | §10 | full/partial; irrevocable; locks pending reserve |
| `settle_exercise_equity` / `settle_exercise_prestocks` | §9, §10 | next-observation-after-request / 5-min median window |
| `fail_exercise` | §10.4 | restores exact quantity once the window elapses (permissionless) |
| `settle_expiry_equity` / `settle_expiry_prestocks` | §11 | reference at/after expiry / 5-min window ending at expiry |
| `expire_refund` | §11.2 | disclosed demo refund of premium on unextinguished quantity |

### Accounts

`Config`, `AssetConfig`, `Pool` (+ SPL vault), `Series`, `Contract`,
`ExerciseRequest`, `QuoteMarker` (replay guard). See
`programs/optket/src/state.rs`.

### Fixed-point conventions (§6.3)

Prices/strikes and quantities are `u64` scaled by `1e6`; the demo token has 6
decimals. **Reserves round up, payouts round down**, all in `u128` intermediates
with overflow checks. `payout = qty·max(strike−ref,0)`, `liability = qty·strike`.
The identical rules live in `programs/optket/src/math.rs` and `src/engine/fixed.ts`.

---

## Reference & trust model (§9)

Each asset has its own adapter behind a common observation interface; **one
asset's reference failure never disables the other** (enforced by per-asset
pools and independent settlement paths — see the invariant test).

- **Public-equity (NVDAx):** a verified underlying-stock benchmark.
  Early exercise selects the earliest qualifying observation **strictly after**
  the request; expiry selects the earliest at/after the fixed expiry, within the
  allowed delay. The value is an oracle benchmark, **not** an exchange close.
- **PreStocks (Anthropic PreStocks):** **median** of ≥3 qualifying Jupiter-Price
  observations with distinct, strictly-increasing source slots, each ≤60s old at
  collection, inside the window.

**Trust limitation (§9.3):** an authorized publisher signature proves publisher
*identity*, not that the upstream feed actually returned the submitted value.
**Manipulation (§9.4):** a median does not eliminate the risk that a buyer
depresses a thin token market — multiple samples can reflect the same
manipulated market. This must be evaluated (depth, cost-to-move, max payout,
source concentration) before any real-money use.

**Activation gate (§4.3):** an asset only becomes available for live-reference
contracts after identity, reference, conversion rules and fallbacks are verified.
Otherwise it is either unavailable or clearly labelled synthetic — the program
**never silently substitutes synthetic prices**.

---

## Roles & operations (§20, §21)

| Action | Access |
|---|---|
| Browse, purchase, exercise, inspect history | Public |
| Trigger eligible settlement | Permissionless (recovery), reference data from publisher |
| Sign quotes | Quote authority |
| Publish observations | Publisher authority |
| Fund pool, create series, pause, trial budget | Admin/team |
| Real-USDC purchases & public underwriting | **Disabled** |

A purchase pause does **not** block exercise or settlement of existing
contracts. Keep quote signing, reference publishing and pool administration on
separate keys. `scripts/keeper.ts` documents the monitoring targets: reference
freshness, pending requests, unsettled expiries, reserve consistency, failures,
publisher activity, trial spend — with a two-minute settlement target.

---

## Security & acceptance criteria (§22)

Covered by the on-chain constraints and the vitest suite (`src/engine/__tests__`):

- Wrong mints can't fund protection; real USDC rejected (`demo_mint` gate).
- Invalid/altered/expired/replayed quotes fail (ed25519 verify + `QuoteMarker`).
- Insufficient reserves & aggregate-exposure limits block purchases.
- Invalid quantities / arithmetic overflow fail (`checked_*`, `overflow-checks`).
- Partial exercise preserves remaining quantity; pending can't be requested twice.
- Exercise and expiry can't duplicate payouts; failed requests restore quantity.
- Rounding preserves accounting invariants (`vault == available + reserved + refund`,
  `reserved == Σ contract reserves`), checked after every mutation.
- Historical/repeated/out-of-window observations can't qualify; missing data
  never becomes synthetic; one asset's outage doesn't disable the other.
- Withdrawals can't consume outstanding obligations; refunds stay funded.

---

## Decisions required before activation (§28)

Public-equity mint & benchmark, PreStocks asset & mint, live-data access,
reference thresholds/timeouts, weekly expiry & strikes, exposure limits, trial
SOL budget, corporate-action rules, publisher/admin controls, and a mainnet
acceptance pass. **Real-money release additionally requires** suitable
references, demonstrated paid demand, sustainable underwriting, committed
capital, executable hedge access where assumed, a security review, and
jurisdiction-specific legal clearance.

---

## Layout

```
optket/
├── programs/optket/src/      # Anchor program
│   ├── lib.rs                # #[program] entrypoints
│   ├── state.rs errors.rs constants.rs math.rs events.rs
│   ├── quote.rs references.rs
│   └── instructions/{admin,purchase,exercise,expiry}.rs
├── src/engine/               # TS mirror (runs + tested)
├── src/client/               # ed25519 quote bridge
├── src/{App.tsx,store.ts}    # web app
├── tests/optket.ts           # anchor integration test
├── scripts/keeper.ts         # keeper/monitoring reference
└── Anchor.toml Cargo.toml
```
