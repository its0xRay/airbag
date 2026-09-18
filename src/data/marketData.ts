// Browser-side access to REAL market data, proxied through the quote service
// (which reads mainnet + the Jupiter Price API). PRD §4/§9/§13/§15.

const SVC = import.meta.env.VITE_QUOTE_SVC || "http://127.0.0.1:8787";

export interface Market {
  mint: string;
  usdPrice: number | null;
  benchmark: number | null;
  liquidity: number | null;
  priceChange24h: number | null;
  updatedAt: string | null;
  decimals: number | null;
  blockId: number | null;
  scaledMultiplier: number;
  available: boolean;
}

export async function fetchMarket(mint: string): Promise<Market> {
  const r = await fetch(`${SVC}/market?mint=${mint}`);
  if (!r.ok) throw new Error(`market ${r.status}`);
  return r.json();
}

export interface Holdings { owner: string; mint: string; displayed: number; raw: number; scaledMultiplier: number; }
export async function fetchHoldings(owner: string, mint: string): Promise<Holdings> {
  const r = await fetch(`${SVC}/holdings?owner=${owner}&mint=${mint}`);
  if (!r.ok) throw new Error(`holdings ${r.status}`);
  return r.json();
}
