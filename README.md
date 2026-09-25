# Airbag

Cash-settled puts on tokenized equities, underwritten by isolated vaults on Solana.

Set a price floor for **NVDAx or Anthropic PreStocks** while keeping your tokens. Or fund an asset's vault to earn premiums and cover payouts.

[Try Airbag](https://www.airbag.fyi/) · [Architecture](docs/architecture.md) · [Deployment](DEPLOY.md)

Runs on **Devnet** with oUSD, a test token with no monetary value. Transactions execute onchain; vault deposits can lose value.

## Run locally

Requires Node.js 22 and npm. Uses the hosted Devnet services.

```bash
git clone https://github.com/its0xRay/airbag.git
cd airbag
npm ci
```

Create `.env.local`:

```dotenv
VITE_QUOTE_SVC=https://web-production-44d1a.up.railway.app
VITE_USE_RPC_RELAY=true
VITE_VAULTS_ENABLED=true
```

Run `npm run dev` and open the URL printed by Vite. `VITE_*` values are public: never include secrets or private RPC credentials.

## Checks

```bash
npm run check:secrets
npm test
npm run lint
npm run typecheck:server
npm run build
```

See [deployment and program testing](DEPLOY.md) for backend setup and Solana tooling.
