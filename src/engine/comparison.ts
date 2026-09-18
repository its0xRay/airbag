// Token-versus-stock basis comparison (PRD §15).
//
// Available for the public-equity asset only when BOTH sources are verified.
// Shows the underlying stock benchmark vs the token-market price, the
// normalized quantity conversion, the percentage difference, source timestamps
// and session/freshness status. The comparison is hidden / marked unavailable
// when sources are stale or not comparable. For PreStocks, a token-vs-issuer
// mark is shown ONLY if the issuer mark is verified and clearly labelled — it
// must never be presented as an executable price or an independent public
// benchmark.

import { DEMO_SPOT, DEMO_TOKEN_MARKET } from "./fixtures";
import { ASSETS } from "./fixtures";

export interface BasisComparison {
  assetId: number;
  available: boolean;
  /** Why the comparison is unavailable, when it is. */
  reason?: string;
  kind: "stock-benchmark" | "issuer-mark";
  stockBenchmark: number;
  tokenMarket: number;
  /** Token units per one benchmark share-equivalent (conversion, PRD §4.1). */
  conversionFactor: number;
  /** (token − benchmark) / benchmark. Negative = token at a discount. */
  pctDiff: number;
  benchmarkTs: number;
  tokenTs: number;
  session: "open" | "closed" | "holiday";
  fresh: boolean;
  label: string;
}

const MAX_AGE_SECS = 90; // freshness bound for comparability (demo)

/**
 * Build the basis comparison snapshot for an asset at time `now`.
 * `overrides` lets the demo simulate stale/closed states.
 */
export function basisComparison(
  assetId: number,
  now: number,
  overrides?: { benchmarkAge?: number; tokenAge?: number; session?: BasisComparison["session"] },
): BasisComparison {
  const asset = ASSETS[assetId];
  const stockBenchmark = DEMO_SPOT[assetId];
  const tokenMarket = DEMO_TOKEN_MARKET[assetId];
  const benchmarkAge = overrides?.benchmarkAge ?? 4;
  const tokenAge = overrides?.tokenAge ?? 3;
  const session = overrides?.session ?? "open";
  const benchmarkTs = now - benchmarkAge;
  const tokenTs = now - tokenAge;
  const fresh = benchmarkAge <= MAX_AGE_SECS && tokenAge <= MAX_AGE_SECS;
  const pctDiff = stockBenchmark > 0 ? (tokenMarket - stockBenchmark) / stockBenchmark : 0;

  if (asset.kind === "EquityToken") {
    // Available only when both sources are verified, session supported, fresh.
    const comparable = asset.active && session === "open" && fresh;
    return {
      assetId,
      available: comparable,
      reason: comparable
        ? undefined
        : !asset.active
          ? "Asset not verified for live reference"
          : session !== "open"
            ? `Stock session ${session} — comparison paused`
            : "A source is stale — comparison not reliable",
      kind: "stock-benchmark",
      stockBenchmark,
      tokenMarket,
      conversionFactor: 1.0, // demo 1:1 share-equivalent; real xStocks use scaled balances
      pctDiff,
      benchmarkTs,
      tokenTs,
      session,
      fresh,
      label: "Underlying stock benchmark vs NVDAx token market",
    };
  }

  // PreStocks: token-vs-issuer-mark only if the issuer mark is verified.
  // It is NOT in this demo, so the comparison is unavailable and labelled.
  return {
    assetId,
    available: false,
    reason: "Issuer mark not verified — token-vs-issuer comparison unavailable",
    kind: "issuer-mark",
    stockBenchmark,
    tokenMarket,
    conversionFactor: 1.0,
    pctDiff,
    benchmarkTs,
    tokenTs,
    session,
    fresh,
    label: "PreStocks token market (no verified issuer mark or public benchmark)",
  };
}
