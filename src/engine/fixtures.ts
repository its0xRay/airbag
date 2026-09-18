// The two-asset MVP fixture (PRD §2, §7): two assets, one weekly expiry each,
// two strikes each = four active series. Demo values; the real mints/feeds are
// gated behind verification (PRD §4, §28) before any live-reference use.

import { toFixed } from "./fixed";
import { OptketEngine, type EngineConfig } from "./engine";
import type { AssetConfig, Series } from "./types";

export const WEEK = 7 * 24 * 3600;

export const DEMO_BUYER = "BuyerDemoWa11et1111111111111111111111111111";
export const QUOTE_AUTHORITY = "QuoteAuth1111111111111111111111111111111111";
export const PUBLISHER_AUTHORITY = "Pub1isher111111111111111111111111111111111";
export const ADMIN = "Admin111111111111111111111111111111111111111";

export const ASSETS: AssetConfig[] = [
  {
    assetId: 0,
    kind: "EquityToken",
    symbol: "NVDAx",
    name: "NVIDIA (tokenized equity, demo)",
    referenceLabel: "Underlying NVDA stock benchmark (oracle observation)",
    referenceVersion: 1,
    conversionVersion: 1,
    active: true,
    maxAggregateExposure: toFixed(5_000_000), // 5,000,000 demo tokens
  },
  {
    assetId: 1,
    kind: "PreStocks",
    symbol: "preSPX",
    name: "PreStocks reference token (demo)",
    referenceLabel: "Specified token-market median (Jupiter Price API, demo)",
    referenceVersion: 1,
    conversionVersion: 1,
    active: true,
    maxAggregateExposure: toFixed(2_000_000),
  },
];

/** Build the four series (two per asset) around a shared weekly expiry. */
export function buildSeries(nowTs: number): Series[] {
  const expiry = nowTs + WEEK;
  const purchaseCutoff = expiry - 15 * 60; // stop purchases 15m before expiry
  const equityExerciseCutoff = expiry - 5 * 60;
  const prestocksExerciseCutoff = expiry - 5 * 60; // PRD §10.3

  const mk = (
    assetId: number,
    seriesId: number,
    strike: number,
    maxSize: number,
    exerciseCutoff: number,
  ): Series => ({
    assetId,
    seriesId,
    strike: toFixed(strike),
    expiryTs: expiry,
    purchaseCutoffTs: purchaseCutoff,
    exerciseCutoffTs: exerciseCutoff,
    maxContractSize: toFixed(maxSize),
    referenceVersion: 1,
  });

  return [
    // NVDAx — two strikes
    mk(0, 0, 170, 500, equityExerciseCutoff),
    mk(0, 1, 160, 500, equityExerciseCutoff),
    // preSPX — two strikes
    mk(1, 0, 24, 2000, prestocksExerciseCutoff),
    mk(1, 1, 22, 2000, prestocksExerciseCutoff),
  ];
}

/** Spot reference prices used by the pricing model / calculator (demo). */
export const DEMO_SPOT: Record<number, number> = {
  0: 172.5, // NVDAx underlying benchmark
  1: 25.0, // preSPX token-market
};

/** Token-market prices (what the token itself trades at) — distinct from the
 *  protected reference. xStocks typically trade at a discount/premium to the
 *  underlying; this is what the §15 comparison surfaces. Demo values. */
export const DEMO_TOKEN_MARKET: Record<number, number> = {
  0: 170.1, // NVDAx token trades slightly below its stock benchmark
  1: 24.6, // preSPX token-market (also the contract reference for PreStocks)
};

export function defaultConfig(): EngineConfig {
  return {
    quoteAuthority: QUOTE_AUTHORITY,
    publisherAuthority: PUBLISHER_AUTHORITY,
    admin: ADMIN,
    pausedPurchases: false,
    trialCap: toFixed(50), // 50 demo SOL-equivalent trial cap
    trialSpent: 0n,
  };
}

/** A fully-seeded, funded engine ready for the demo/tests. */
export function makeDemoEngine(nowTs: number): OptketEngine {
  const engine = new OptketEngine(defaultConfig(), nowTs);
  for (const a of ASSETS) engine.addAsset(a);
  for (const s of buildSeries(nowTs)) engine.addSeries(s);
  engine.fundPool(0, toFixed(5_000_000));
  engine.fundPool(1, toFixed(2_000_000));
  return engine;
}
