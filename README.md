# Airbag

Price floors for tokenized equities on Solana. Keep your tokens, or fund isolated vaults that underwrite payouts.

[Try Airbag](https://www.airbag.fyi/) · [Deployed program](https://explorer.solana.com/address/Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky?cluster=devnet) · [Architecture](docs/architecture.md) · [Deployment](DEPLOY.md)

## The product

- **Markets:** NVDAx and Anthropic PreStocks.
- **Positions:** signed-quote purchases, fully reserved maximum payouts, partial or full early exercise, and expiry settlement.
- **Vaults:** separate NVDAx and Anthropic rounds. Deposit during funding, back buyer payouts, then redeem your proportional share after settlement. Capital can lose value.
- **Transparency:** inspect references, pool reserves, contract accounts and confirmed transactions.

Payout = quantity × max(price floor − settlement reference, 0).

New positions follow token-market references, not guaranteed portfolio values. The underlying tokens stay in your wallet.

## Try the Devnet app

Choose an asset, quantity, floor and expiry. Start with a browser demo wallet, review the maximum premium, then open a position. Follow it in Positions.

To fund positions, choose **Fund a vault** and an asset. Deposits can be cancelled during funding; after activation they lock until every obligation settles. Your positions shows buyer contracts and vault deposits together. Administrator deposits have the same proportional rights. New empty funding rounds are published automatically when reference and operational checks pass; deposits are never automatically reinvested.

Purchases and settlements execute on Solana Devnet. Premiums and payouts use **oUSD, a test token with no monetary value**; transaction fees are sponsored. Payout previews are illustrative, not executable quotes.

Your demo wallet is stored in that browser on that domain. Clearing site data removes access.

## Run the frontend locally

Requires Node.js 22 and npm. This configuration uses the hosted Devnet services.

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

```bash
npm run dev
```

Open the URL printed by Vite. Never put private keys or credential-bearing RPC URLs in `VITE_*` variables.

## Checks

```bash
npm test
npm run lint
npm run typecheck:server
npm run build
```

Anchor integration tests require the Solana/Anchor toolchain and an isolated local validator. The adversarial transaction harness is for isolated test deployments only, not the public app.

## Source map

| Component | Location |
|---|---|
| React/Vite frontend | `src/components`, `src/App.tsx` |
| Pricing and payoff arithmetic | `src/engine` |
| Transaction client and account decoders | `src/client` |
| Anchor program | `programs/optket` |
| Signed quotes, RPC relay and fee sponsorship | `server/quoteService.ts`, `server/rpcRelay.ts` |
| Reference collection and settlement | `server/keeper.ts` |

Internal program paths retain their existing names for compatibility. Airbag does not execute external hedges. Reference publishing depends on an authorized publisher; market liquidity and manipulation risks remain. See [architecture and trust boundaries](docs/architecture.md).
