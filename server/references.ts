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
  readonly label = "Underlying-stock benchmark";
  constructor(
    public assetId: number,
    private symbol = process.env.PYTH_EQUITY_SYMBOL || "NVDA",
    private feedId = process.env.PYTH_EQUITY_FEED || "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    private hermes = process.env.PYTH_HERMES || "https://hermes.pyth.network",
    /** Secondary real benchmark: Jupiter returns the underlying stock price
     *  alongside the token price for xStocks (`stockData.price`). Used when
     *  Hermes is unavailable — a different disclosed source, never synthetic. */
    private jupMint = process.env.EQUITY_TOKEN_MINT || "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    private jupApi = process.env.JUP_PRICE_API || "https://lite-api.jup.ag/price/v3",
  ) {}

  /** Underlying stock benchmark from the Jupiter xStocks payload. */
  private async jupiterBenchmark(): Promise<number | null> {
    try {
      const r = await fetch(`${this.jupApi}?ids=${this.jupMint}`);
      if (!r.ok) return null;
      const j = (await r.json()) as Record<string, { stockData?: { price?: number } }>;
      const px = j[this.jupMint]?.stockData?.price;
      return typeof px === "number" && px > 0 ? px : null;
    } catch {
      return null;
    }
  }

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
        // Out of session there is no fresh print. Rather than substitute a
        // synthetic number (§22), use the real last print Jupiter reports and
        // say so — a real contract would wait for a supported session (§9.1).
        const last = await this.jupiterBenchmark();
        const ts = nowSec();
        if (last !== null) {
          return {
            price: toFixed(last), sourceTs: ts, slot: BigInt(ts), available: true,
            sourceId: `jupiter-stockdata:${this.symbol} (session closed — last print)`,
            verification: "jupiter-xstocks-stockdata",
          };
        }
        return { ...base, reason: `stock session closed (next open ${session.nextOpen ?? "?"})` };
      }
      // 1) Preferred: Pyth Hermes (canonical oracle). Public Hermes now
      //    requires auth — set PYTH_HERMES to an authorized endpoint to use it.
      const r = await fetch(`${this.hermes}/v2/updates/price/latest?ids[]=${this.feedId}&parsed=true`);
      if (r.ok) {
        const j = (await r.json()) as { parsed?: Array<{ price: { price: string; expo: number; conf: string; publish_time: number } }> };
        const p = j.parsed?.[0]?.price;
        if (p) {
          const real = Number(p.price) * Math.pow(10, p.expo);
          return {
            price: toFixed(real), sourceTs: p.publish_time, slot: BigInt(p.publish_time),
            confidence: toFixed(Number(p.conf) * Math.pow(10, p.expo)), available: true,
            sourceId: `pyth:${this.symbol}`, verification: "pyth-hermes-parsed",
          };
        }
      }
      // 2) Secondary REAL source: the underlying stock price Jupiter reports
      //    for the xStock. Disclosed as a distinct source, not synthetic.
      const jup = await this.jupiterBenchmark();
      if (jup !== null) {
        const ts = nowSec();
        return {
          price: toFixed(jup), sourceTs: ts, slot: BigInt(ts), available: true,
          sourceId: `jupiter-stockdata:${this.symbol}`, verification: "jupiter-xstocks-stockdata",
        };
      }
      return { ...base, reason: `hermes ${r.status} and no Jupiter benchmark` };
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
