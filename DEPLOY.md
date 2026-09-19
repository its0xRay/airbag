# Optket — Public Devnet Deployment Runbook

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
git init && git add . && git commit -m "Optket"
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
| `keeper` | `RPC_URL`, `PUBLISHER_SECRET` |

`PROGRAM_ID` and `MAINNET_RPC` are optional (the defaults are correct).
Mount a Railway volume at `/data` and set
`TRIAL_STATE_PATH=/data/trial-budget-state.json`; the quote service refuses to
start on Railway without this durable state path so sponsorship caps cannot
reset during a redeploy.
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
Deploy. Open the Vercel URL → **On-chain** tab.

## 4. Verify the public flow
On the deployed site, On-chain tab:
1. **Connect burner wallet** → receives demo oUSD up to a 20,000-token ceiling. SOL never touches the burner; the dedicated trial wallet sponsors approved fees and rent.
2. **Buy protection** (e.g. Anthropic / preSPX) → real devnet transaction; explorer link appears.
3. **Request exercise** → the keeper settles it within a few polls when a qualifying live reference exists. Equity requests wait through closed stock-market sessions; no last print is re-stamped as current.
4. **Compare** tab shows live mainnet prices (real NVDAx vs NVDA, Anthropic issuer mark).

## Operations
- **Fund wallets** (devnet SOL): admin/deployer, publisher (keeper fees), trial
  budget — addresses in `DEPLOY-SECRETS.local.md`. Top up via `solana transfer`
  or [faucet.solana.com](https://faucet.solana.com). The trial wallet sponsors
  allowlisted transactions and auto-shuts down at its durable cap
  (`TRIAL_CAP_SOL`).
- **Re-run devnet setup** (idempotent — e.g. after the weekly series expire):
  `RPC_URL=https://api.devnet.solana.com node scripts/setup-devnet.mjs`
- **New series** each week: edit `SERIES_PLAN` strikes in `scripts/setup-devnet.mjs`
  and re-run (existing contracts keep their terms; only future series change).
- **Faster/steadier RPC**: set `RPC_URL` (Railway) and `VITE_RPC_URL` (Vercel) to
  a paid QuickNode/Helius devnet endpoint.

## Safety boundary
On-chain is **demo-token only** (real USDC is rejected by the program). The
trial budget hands out small capped devnet SOL for fees. No real funds move.
