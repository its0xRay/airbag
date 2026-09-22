# Architecture

Airbag separates the frontend, quote service, settlement keeper and Solana program.

## Execution

1. The frontend loads available series and market references, then calculates an indicative premium and payoff.
2. The buyer reviews a maximum premium. The quote service signs a buyer-specific quote; the client rejects a quote above that maximum.
3. The program verifies the quote, expiry, mint, replay protection and available collateral. Premium transfer, contract creation and maximum-payout reservation are atomic.
4. The buyer can request partial or full early exercise before the cutoff. Requests are irreversible and settle against a future qualifying reference.
5. The keeper collects observations and submits exercise or expiry settlement. The program validates reference rules and calculates the payout.

Accounts include config, asset config, pool/vault, series, contract, exercise request and quote replay marker. See [account definitions](../programs/optket/src/state.rs).

## References

| Contract | Reference policy |
|---|---|
| NVDAx v2 | Jupiter token-market price; median of at least three distinct upstream updates in a five-minute window. Mainnet update timestamps must be at most 60 seconds old when collected. |
| Anthropic PreStocks v1 | Median of at least three Jupiter snapshots in the window, sequenced by confirmed Devnet collection slots. This policy does not independently validate last-trade age. |
| Legacy NVDAx v1 | NVIDIA stock benchmark with its original session and observation rules. |

For token-market contracts, exercise uses observations after the request; expiry uses the five-minute window ending at expiry. Legacy benchmark exercise uses the earliest qualifying observation strictly after the request; expiry uses the earliest at or after expiry within the allowed delay.

Asset and reference version determine the path. Existing contracts retain their terms. Missing observations do not become synthetic prices: failed exercise restores the requested quantity under the contract rules; invalid expiry follows the remaining-quantity premium-refund rule.

## Accounting

Prices and quantities use six-decimal fixed-point integers. Reserves round up; payouts round down, with checked arithmetic.

- Payout: quantity × max(floor − reference, 0).
- Maximum liability: quantity × floor.
- Withdrawals cannot consume outstanding obligations.
- Partial exercise preserves the unrequested quantity; settlement cannot pay the same obligation twice.

See [program arithmetic](../programs/optket/src/math.rs) and [frontend arithmetic](../src/engine/fixed.ts).

## Trust and access

The authorized publisher's signature establishes identity, not independent proof that an upstream API returned a price. Medians do not eliminate thin-market manipulation risk. Airbag does not execute an external hedge.

| Action | Authority |
|---|---|
| Browse, purchase, request exercise | User |
| Sign quotes | Quote authority |
| Submit reference-based settlement or invalid-expiry refund | Authorized publisher |
| Fail an elapsed exercise request | Permissionless, subject to program timing checks |
| Configure assets/series, fund pools, pause purchases | Admin |

The public deployment uses demo-token settlement only. oUSD has no monetary value, real-USDC purchases are rejected and public underwriting is disabled.

## Recovery and testing

Browser wallet and pending-transaction storage are preserved across reloads. An unresolved transaction is checked before another is submitted; browser tabs coordinate submission locks.

The keeper persists scoped observations with original timestamps and validates network, program and publisher on restart. It never restamps old observations.

Unit and component tests run with `npm test`. Anchor tests and adversarial transaction scripts require isolated deployments and dedicated test keys. Tests are not a security audit or a claim of mainnet readiness.
