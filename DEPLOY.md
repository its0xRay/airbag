# Airbag — Public Devnet Deployment Runbook

Airbag was previously named Optket. The public brand has changed; the repository,
current frontend URL (`https://optket.vercel.app/`), program ID, browser storage
keys and working service endpoints are unchanged. Keep the old storage keys so
existing demo wallets, reminders and pending transaction recovery remain usable.
A future domain change needs a separate browser-wallet continuity plan.

The program is **already deployed to devnet** and the devnet environment (config,
both assets, pools, four series, demo mint, funded trial budget) is **already set
up**. This guide hosts the three moving parts so anyone can use it from a URL:

- **Frontend** (static Vite build) → **Vercel**
- **Quote service** (signs premium quotes, faucet, market proxy) → **Railway** (web)
- **Keeper** (settles exercises/expiries with live references) → **Railway** (worker)

All secret values you need are in **`DEPLOY-SECRETS.local.md`** (generated
locally, gitignored — never commit it).

---

## 0. Prerequisites
- A GitHub repo (you push this code to it).
- Vercel account, Railway account.
- The program and devnet accounts already exist. When program source changes,
  upgrade the existing program ID before deploying dependent services.

## 1. Push to GitHub
```bash
cd optket
git init && git add . && git commit -m "Airbag"
git remote add origin <your-repo-url>
git push -u origin main
```
`.gitignore` already excludes every keypair and `DEPLOY-SECRETS.local.md`. Confirm
with `git status` that no `*.json` key files are staged.

## 2. Railway — two services from the same repo
Create a Railway **project** → **Deploy from GitHub repo** → select this repo.
Then add **two services** (New → GitHub Repo, same repo), and in each service's
**Settings → Deploy → Start Command**:

| Service | Start command | Type |
|---|---|---|
| `quote-service` | `npm run quote-service` | web (gets a public URL) |
| `keeper` | `npm run keeper` | worker |

For each service, **Variables** → paste the block from `DEPLOY-SECRETS.local.md`
(quote-service block into quote-service, keeper block into keeper). Railway sets
`PORT` automatically; the quote service reads it.

Railway **stages** variable edits — click **Deploy** (or "Apply N changes") after
pasting, or the new deployment starts without them. The minimum each service needs:

| Service | Required variables |
|---|---|
| `quote-service` | `RPC_URL`, `QUOTE_AUTHORITY_SECRET`, `TRIAL_BUDGET_SECRET`, `ADMIN_SECRET`, `TRIAL_STATE_PATH` |
| `keeper` | `RPC_URL`, `PUBLISHER_SECRET`, `KEEPER_STATE_PATH` (persistent recovery) |

`PROGRAM_ID` and `MAINNET_RPC` are optional (the defaults are correct).
Mount a Railway volume at `/data` and set
`TRIAL_STATE_PATH=/data/trial-budget-state.json`; the quote service refuses to
start on Railway without this durable state path so sponsorship caps cannot
reset during a redeploy.
Mount a separate volume on the keeper at `/data`, then set
`KEEPER_STATE_PATH=/data/keeper-observations.json`. Check `/health` reports
`persistenceEnabled: true` and a recent `lastPersistedAt`. A redeploy must retain
original sample times; it must not restamp observations. A mismatched/corrupt
snapshot stops startup rather than silently overwriting the evidence.
The keeper has no synthetic-reference switch: unavailable or non-qualifying
observations fail closed into the on-chain exercise-failure or expiry-refund
paths. Both services refuse to start on Railway with a missing key secret
rather than generating a throwaway one, and the keeper exits if its key is not
the on-chain publisher authority; the deploy log names the variable.

Deploy. Copy the **quote-service public URL** (e.g. `https://optket-quote.up.railway.app`).
Check `https://<that-url>/health` returns `{ ok: true, ... }` and that the keeper log
shows `keeper key Gy6NK4iSAQcsS3HWU4mh5uURshkf52Ekq5utDUNsTyfL` — any other key means
`PUBLISHER_SECRET` did not reach the service.

## 3. Vercel — frontend
Import the repo (Vercel auto-detects Vite via `vercel.json`). Set **Environment
Variables**:
```
VITE_RPC_URL   = https://api.devnet.solana.com
VITE_QUOTE_SVC = https://<your quote-service Railway URL>
```
For a private provider, keep its credential-bearing URL **only** in Railway's
`RPC_URL`. Enable `RPC_PROXY_ENABLED=true` on the quote service and verify
`POST /rpc` before setting `VITE_USE_RPC_RELAY=true` in Vercel and rebuilding.
The relay verifies Devnet, restricts methods and transaction programs, bounds
traffic, and strips provider error details. Do not use a private provider URL
in `VITE_RPC_URL`: Vite exposes it publicly in the JavaScript bundle.

Deploy. Open the Vercel URL → **Onchain** tab.

## 4. Verify the public flow
On the deployed site:
1. **Connect burner wallet** → receives demo oUSD up to a 20,000-token ceiling. SOL never touches the burner; the dedicated trial wallet sponsors approved fees and rent.
2. **Buy protection** (e.g. Anthropic / preSPX) → real devnet transaction; explorer link appears.
3. **Request exercise** → the keeper settles when enough qualifying live observations exist. New NVDAx and ANTHROPIC contracts use token-market medians; only legacy NVDAx v1 retains stock-session benchmark rules.
4. **Markets** shows real market references and their source/freshness. Missing observations remain unavailable.

## Operations
- **Fund wallets** (devnet SOL): admin/deployer, publisher (keeper fees), trial
  budget — addresses in `DEPLOY-SECRETS.local.md`. Top up via `solana transfer`
  or [faucet.solana.com](https://faucet.solana.com). The trial wallet sponsors
  allowlisted transactions and auto-shuts down at its durable cap
  (`TRIAL_CAP_SOL`).
- **Series availability**: the quote service rotates two short and two weekly
  floors per asset on Devnet. Weekly replacements are published before the last
  day of the current purchase window; existing contracts retain their terms.
  Short ids use 9–4095, new weekly ids use 4096–8191. Monitor `seriesRotation`
  in `/health`, and run `npm run check:devnet` before a judging session.
- **Private RPC**: use the relay configuration above. Frontend and keeper
  requests share the provider's account limits; verify plan headroom under load.
- **CI**: GitHub Actions runs build, lint, unit tests and server type checks.
  Anchor integration tests require the separate Solana/Anchor toolchain.

## Safety boundary
On-chain is **demo-token only** (real USDC is rejected by the program). The
trial budget hands out small capped devnet SOL for fees. No real funds move.
