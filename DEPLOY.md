# Deploy Airbag

Public website: [www.airbag.fyi](https://www.airbag.fyi/).

The application has three services. The Solana program and its accounts are managed separately.

| Service | Host | Command |
|---|---|---|
| Frontend | Vercel | `npm run build`; output `dist` |
| Quote service | Railway | `npm run quote-service` |
| Keeper | Railway | `npm run keeper` |

Connect each host to [its0xRay/airbag](https://github.com/its0xRay/airbag). Use `.env.example` for variable names; configure real secrets only in the host's secret settings.

## Railway

Both services need a Devnet `RPC_URL`. The configured `PROGRAM_ID` must match the deployed program.
Use a provisioned RPC for both services; the public endpoint can rate-limit keeper account scans. On Railway, the keeper can reference the web service's existing endpoint with `${{web.RPC_URL}}`.

| Service | Required configuration |
|---|---|
| Quote service | `QUOTE_AUTHORITY_SECRET`, `TRIAL_BUDGET_SECRET`, `ADMIN_SECRET`, `TRIAL_STATE_PATH` |
| Keeper | `PUBLISHER_SECRET`, `KEEPER_STATE_PATH` |

Secrets are JSON arrays of 64 bytes. Authorities must match the onchain configuration. Do not commit keypairs or local secret files.

Mount a **separate persistent volume** at `/data` for each service:

- Quote service: `TRIAL_STATE_PATH=/data/trial-budget-state.json`
- Keeper: `KEEPER_STATE_PATH=/data/keeper-observations.json`

Durable state preserves sponsorship caps and genuine observation history across restarts. A corrupt or mismatched keeper snapshot stops startup; do not bypass this check or fabricate missing samples.

Enable `RPC_PROXY_ENABLED=true` on the quote service to serve the restricted RPC relay. Keep private RPC credentials server-side. Railway supplies `PORT`; configure `/health` checks for both services.

## Vercel

Import the repository as a Vite project. Set:

```dotenv
VITE_QUOTE_SVC=https://YOUR-QUOTE-SERVICE.up.railway.app
VITE_USE_RPC_RELAY=true
```

Verify the quote service's `/rpc` endpoint before enabling the frontend relay. Without the relay, use a public Devnet `VITE_RPC_URL`. All `VITE_*` values are public build output.

Redeploy after changing build-time variables. Preserve the existing site address while introducing a new domain: browser demo-wallet storage does not transfer between domains.

## Vault release

Upgrade and verify the compatible Devnet program first. Set `VAULTS_ENABLED=true`
on both services, verify real-reference purchases and settlement for both assets,
then set `VITE_VAULTS_ENABLED=true` on Vercel and redeploy. Disabled clients continue
to receive legacy offers; vault discovery is opt-in.

With vaults enabled, the quote service publishes empty rounds on a 30-minute
cadence. Set `VAULT_ROUNDS_ENABLED=false` to stop publication without stopping
settlement. No tokens are minted, deposited or recycled by this job. Funding ends
at the next half-hour boundary; the active window lasts another 30 minutes.
It skips windows with under two minutes left and stops after three unresolved
rounds per asset, missing qualifying references, exhausted exposure capacity, a purchase pause, or an admin
balance below one Devnet SOL. This is a stop threshold, not a reserved balance.
Inspect `/health` → `vaultRotation` for operational errors.

Run only one quote-signing service replica. Pending quote exposure is reserved
in memory for 65 seconds, across both legacy and vault quotes; startup has a
65-second issuance drain period. Multi-replica signing requires shared atomic
reservations. The onchain asset exposure cap remains the hard execution limit.

The genesis-verified Devnet signing policy defaults to aggregate caps of 20,000
oUSD for NVDAx and 15,000 oUSD for Anthropic, including legacy liabilities and
pending quotes. Override with `DEVNET_NVDA_EXPOSURE_CAP_OUSD` and
`DEVNET_ANTHROPIC_EXPOSURE_CAP_OUSD` (whole oUSD, 1–50,000); invalid values fail
startup. These are test budgets, not production risk calibration. Jupiter
liquidity remains diagnostic; qualifying references and collateral checks remain
mandatory. `/availability?assetId=0` (or `1`) exposes timestamped admission
headroom, not an executable quote or funded vault balance. Round publication
results are separate per asset in `/health` → `vaultRotation.assets`.

Manual publication and administrator deposits remain available via
`scripts/publish-vault-round.ts` (preview by default; `--send` submits).
[Operator parameters](docs/vault-implementation.md#publishing-a-round) must be
explicit. No user deposit is automatically reinvested.

## Release verification

1. Run `npm run check:secrets`, `npm test`, `npm run lint`, `npm run typecheck:server` and `npm run build`.
2. Run `npm run check:devnet` for read-only service, series, reference and sponsorship checks. Override `QUOTE_SERVICE_URL` for another deployment.
3. Check the keeper's `/health` separately: recent ticks, qualifying samples, persistence enabled and no settlement failures.
4. Open a small Devnet position, inspect its confirmed transaction, then verify exercise or expiry settlement and its receipt.
5. Confirm references remain unavailable when data is missing; no price may be invented to keep a flow active.

## Operations

Enable the staged-file secret guard on new checkouts with
`git config core.hooksPath .githooks`. CI also scans reachable history.
These checks supplement manual review; never commit secrets, even on Devnet.

- Monitor quote-service and keeper health; configure an alert destination and test delivery.
- Maintain Devnet SOL for publisher and fee-sponsor accounts, and monitor durable sponsorship-cap headroom.
- Verify short and weekly series rotation. New series must not alter existing contracts.
- Keep quote, publisher and admin authorities separate. A purchase pause must not block existing-contract exercise or settlement.
- Program upgrades are separate from web deployments. Deploy compatible program changes before dependent services; never change IDs, account layouts or reference versions as part of a branding update.

For an isolated program deployment, use the Solana CLI and Anchor 0.30.1 with dedicated keys. Run `anchor build` and local-validator integration tests before deploying. Do not run adversarial scripts against the public service.
