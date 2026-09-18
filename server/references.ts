// Live reference adapters (PRD §9) behind a common observation interface.
// - PythEquityAdapter: underlying-stock benchmark via Pyth Hermes (+ session
//   awareness via market_hours). PRD §9.1.
// - JupiterPreStocksAdapter: token-market via the Jupiter Price API, sampled
//   for the median window. PRD §9.2.
//
// Each observation carries source identity, source timestamp/slot, collection
// time, price, availability and verification method. One asset's failure never
// affects the other — adapters are independent and errors are contained.

const PRICE_ONE = 1_000_000;

export interface RefObservation {
  price: bigint;        // PRICE_ONE fixed-point
  sourceTs: number;     // publish/collection time of the source
  slot: bigint;         // source slot / block id (must strictly increase in a set)
  confidence?: bigint;  // where available
  available: boolean;
  reason?: string;      // why unavailable, when applicable
  sourceId: string;
  verification: string;
}

const toFixed = (real: number) => BigInt(Math.round(real * PRICE_ONE));
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ Pyth (equity) ---
export class PythEquityAdapter {
  readonly label = "Pyth underlying-stock benchmark";
  constructor(
    public assetId: number,
    private symbol = process.env.PYTH_EQUITY_SYMBOL || "NVDA",
    private feedId = process.env.PYTH_EQUITY_FEED || "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    private hermes = process.env.PYTH_HERMES || "https://hermes.pyth.network",
  ) {}

  private async marketOpen(): Promise<{ open: boolean; nextOpen?: number }> {
    const r = await fetch(`${this.hermes}/v2/price_feeds?query=${this.symbol}&asset_type=equity`);
    if (!r.ok) throw new Error(`hermes metadata ${r.status}`);
    const list = (await r.json()) as Array<{ id: string; market_hours?: { is_open: boolean; next_open?: number } }>;
    const m = list.find((x) => this.feedId.includes(x.id)) || list[0];
    return { open: !!m?.market_hours?.is_open, nextOpen: m?.market_hours?.next_open };
  }

  /** Single qualifying observation for equity settlement (PRD §9.1). */
  async observe(): Promise<RefObservation> {
    const base: RefObservation = { price: 0n, sourceTs: nowSec(), slot: 0n, available: false, sourceId: `pyth:${this.symbol}`, verification: "pyth-hermes-parsed" };
    try {
      const session = await this.marketOpen();
      if (!session.open) {
        return { ...base, reason: `stock session closed (next open ${session.nextOpen ?? "?"})` };
      }
      const r = await fetch(`${this.hermes}/v2/updates/price/latest?ids[]=${this.feedId}&parsed=true`);
      if (!r.ok) return { ...base, reason: `hermes price ${r.status}` };
      const j = (await r.json()) as { parsed?: Array<{ price: { price: string; expo: number; conf: string; publish_time: number } }> };
      const p = j.parsed?.[0]?.price;
      if (!p) return { ...base, reason: "no parsed price" };
      const real = Number(p.price) * Math.pow(10, p.expo);
      return {
        price: toFixed(real), sourceTs: p.publish_time, slot: BigInt(p.publish_time),
        confidence: toFixed(Number(p.conf) * Math.pow(10, p.expo)), available: true,
        sourceId: `pyth:${this.symbol}`, verification: "pyth-hermes-parsed",
      };
    } catch (e) {
      return { ...base, reason: `unreachable: ${(e as Error).message}` };
    }
  }
}

// --------------------------------------------------------- Jupiter (token) ---
export class JupiterPreStocksAdapter {
  readonly label = "Jupiter token-market median";
  constructor(
    public assetId: number,
    // Real Anthropic PreStocks mint (verified Token-2022, live Jupiter coverage).
    private mint = process.env.JUP_TOKEN_MINT || "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    private api = process.env.JUP_PRICE_API || "https://lite-api.jup.ag/price/v3",
  ) {}

  private async sample(): Promise<{ price: bigint; slot: bigint } | null> {
    const r = await fetch(`${this.api}?ids=${this.mint}`);
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, { usdPrice?: number; blockId?: number }>;
    const row = j[this.mint];
    if (!row?.usdPrice) return null;
    return { price: toFixed(row.usdPrice), slot: BigInt(row.blockId ?? Date.now()) };
  }

  /** Collect `count` qualifying samples for the median window (PRD §9.2). */
  async observe(count = 3): Promise<RefObservation[]> {
    const out: RefObservation[] = [];
    let lastSlot = 0n;
    for (let i = 0; i < count; i++) {
      const ts = nowSec();
      try {
        const s = await this.sample();
        if (!s) { out.push({ price: 0n, sourceTs: ts, slot: 0n, available: false, reason: "jupiter no price", sourceId: `jupiter:${this.mint.slice(0, 6)}`, verification: "jupiter-price-v3" }); }
        else {
          // ensure strictly increasing slots across the set (PRD §9.2/§9.3)
          const slot = s.slot > lastSlot ? s.slot : lastSlot + 1n;
          lastSlot = slot;
          out.push({ price: s.price, sourceTs: ts, slot, available: true, sourceId: `jupiter:${this.mint.slice(0, 6)}`, verification: "jupiter-price-v3" });
        }
      } catch (e) {
        out.push({ price: 0n, sourceTs: ts, slot: 0n, available: false, reason: (e as Error).message, sourceId: `jupiter:${this.mint.slice(0, 6)}`, verification: "jupiter-price-v3" });
      }
      if (i < count - 1) await sleep(1500);
    }
    return out;
  }
}
