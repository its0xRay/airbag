// Browser-side access to REAL market data, proxied through the quote service
// (which reads mainnet + the Jupiter Price API). PRD §4/§9/§13/§15.

import { fetchJson, normalizeServiceUrl } from "../serviceUrl";

const SVC = normalizeServiceUrl(import.meta.env.VITE_QUOTE_SVC);

export interface Market {
  mint: string;
  usdPrice: number | null;
  benchmark: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
  updatedAt: string | null;
  decimals: number | null;
  blockId: number | null;
  scaledMultiplier: number | null;
  available: boolean;
}

export async function fetchMarket(mint: string): Promise<Market> {
  return fetchJson<Market>(`${SVC}/market?mint=${encodeURIComponent(mint)}`);
}

export interface AvailableQuoteReference {
  assetId: number;
  price: number;
  source: string;
  observedAt?: number;
  available: true;
}

export interface UnavailableQuoteReference {
  assetId: number;
  available: false;
  status: "session_closed" | "stale" | "source_unavailable";
  reason: string;
  nextOpen?: number;
}

export type QuoteReference = AvailableQuoteReference | UnavailableQuoteReference;

export function referenceSourceLabel(source: string): string {
  if (source.startsWith("jupiter-stockdata:")) return "Jupiter xStocks benchmark";
  if (source.startsWith("jupiter:")) return "Jupiter Price API";
  if (source.startsWith("pyth:")) return "Pyth price feed";
  return source;
}

export async function fetchQuoteReference(assetId: number): Promise<QuoteReference> {
  return fetchJson<QuoteReference>(`${SVC}/reference?assetId=${encodeURIComponent(assetId)}`);
}

export interface Holdings { owner: string; mint: string; displayed: number; raw: number; scaledMultiplier: number; }
export async function fetchHoldings(owner: string, mint: string): Promise<Holdings> {
  return fetchJson<Holdings>(`${SVC}/holdings?owner=${encodeURIComponent(owner)}&mint=${encodeURIComponent(mint)}`);
}
