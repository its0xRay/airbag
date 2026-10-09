# Airbag

Cash-settled puts on tokenized equities, underwritten by isolated vaults on Solana.

Airbag connects people who want to reduce downside with people willing to fund it. The goal is a market where holders choose the risk they keep and capital providers choose the risk they underwrite.

### How it works

- **Set a floor.** Choose a token, price floor and quantity. Pay one premium and keep your tokens. If the settlement reference is below your floor, the contract pays the difference for the covered quantity.
- **Fund a vault.** Supply capital to an asset's underwriting round. Premiums add to the vault; payouts reduce it. Withdraw your share after the round settles.
- **Verify onchain.** Each position's maximum payout is reserved at purchase. Purchases, exercise and settlement are recorded on Solana.

Currently supports **NVDAx and Anthropic PreStocks** on **Solana Devnet**, using **oUSD, a test token with no monetary value**.

[Try Airbag](https://www.airbag.fyi/) · [Architecture](docs/architecture.md) · [Deployment](DEPLOY.md)

### Why I built it

Read the thinking behind Airbag, how the product works, and where it could go: [I built a floor for tokenized stocks](https://coincept.substack.com/p/i-built-a-floor-for-tokenized-stocks).
