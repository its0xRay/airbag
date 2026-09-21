import { useEffect, useState } from "react";
import { VERIFIED_ASSETS, assetByKey } from "../data/assets";
import { fetchMarket, type Market } from "../data/marketData";
import { fmtAge, fmtUsd, fmtPct } from "../format";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={"stat-value sm mono " + (tone || "")}>{value}</div>
    </div>
  );
}

// ------------------------------------------------------------- Compare tab ---
export default function CompareTab() {
  const [assetKey, setAssetKey] = useState(VERIFIED_ASSETS[0].key);
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const asset = assetByKey(assetKey)!;

  useEffect(() => {
    let alive = true;
    const load = () => fetchMarket(asset.mint)
      .then((m) => { if (alive) { setMarket(m); setLoading(false); } })
      .catch((e) => { if (alive) { setErr(String(e.message || e)); setLoading(false); } });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [assetKey, asset.mint, refreshKey]);

  const equity = asset.kind === "EquityToken";
  const token = market?.usdPrice ?? null;
  const bench = market?.benchmark ?? null;
  const basis = token != null && bench ? (token - bench) / bench : null;
  const mult = market?.scaledMultiplier ?? asset.scaledMultiplier;
  const solscan = `https://solscan.io/token/${asset.mint}`;

  return (
    <>
      <div className="app-page-head">
        <div><div className="card-title">Reference architecture</div><h1>Markets</h1><p>Separate the Devnet protection contract from the live mainnet identity and market data it references.</p></div>
      </div>
      <div className="environment-strip" style={{ marginBottom: 16 }}>
        <span><strong>Contract</strong> Solana Devnet</span>
        <span><strong>Market data</strong> Live mainnet</span>
        <span title="Optket verified the mint identity, token program, decimals and conversion configuration."><strong>Token identity verified</strong> {asset.verifiedAt}</span>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        {VERIFIED_ASSETS.map((a) => (
          <button key={a.key} className={"btn sm " + (a.key === assetKey ? "primary" : "ghost")} onClick={() => { setAssetKey(a.key); setLoading(true); setErr(null); setMarket(null); }}>{a.symbol}</button>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="between" style={{ marginBottom: 4 }}>
            <div className="card-title" style={{ margin: 0 }}>{equity ? "Token vs stock benchmark" : "Token protection reference"} — {asset.symbol}</div>
            {market?.available ? <span className="pill green">live</span> : <span className="pill amber">{loading ? "loading…" : "unavailable"}</span>}
          </div>
          <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>{asset.name} · {asset.benchmarkLabel}</div>

          {err && <div className="callout warn" role="alert">Live market data is unavailable. <button className="text-action" onClick={() => { setLoading(true); setErr(null); setRefreshKey((value) => value + 1); }}>Try again</button></div>}
          {loading && !market && <div className="empty">Fetching live mainnet data…</div>}
          {market?.available && (
            <>
              <div className="grid cols-3">
                <Stat label={equity ? "Stock benchmark" : "Token reference"} value={(equity ? bench : token) != null ? fmtUsd((equity ? bench : token)!) : "—"} />
                <Stat label="Token market" value={token != null ? fmtUsd(token) : "—"} />
                <Stat label="Token vs benchmark" value={basis != null ? `${Math.abs(basis * 100).toFixed(1)}% ${basis < 0 ? "below" : "above"}` : "—"} tone={basis != null && basis < 0 ? "neg" : "pos"} />
              </div>
              <div className="hr" />
              <div className="kv"><span className="k">24h token change</span><span className={"v mono " + ((market.priceChange24h ?? 0) >= 0 ? "pos" : "neg")}>{market.priceChange24h != null ? (market.priceChange24h >= 0 ? "+" : "") + market.priceChange24h.toFixed(2) + "%" : "—"}</span></div>
              <div className="kv"><span className="k">Jupiter liquidity</span><span className="v mono">{market.liquidity != null ? fmtUsd(market.liquidity, 0) : "—"}</span></div>
              <div className="kv"><span className="k">Freshness</span><span className="v mono" title={market.updatedAt ? new Date(market.updatedAt).toLocaleString() : undefined}>{market.updatedAt ? fmtAge(Math.floor(new Date(market.updatedAt).getTime() / 1000)) : "—"}</span></div>
              <div className="callout" style={{ marginTop: 14 }}>
                {equity
                  ? <>A stock-benchmark contract references the underlying NVDA stock and <strong>excludes the token-market basis</strong> shown here ({basis != null ? fmtPct(Math.abs(basis)) : "—"} right now).</>
                  : <>Protection settles against the <strong>ANTHROPIC token market price</strong> using a Jupiter 5-minute median. It does not track the private company’s valuation.</>}
              </div>
            </>
          )}
        </div>

        <details className="card token-details">
          <summary><span><strong>Token details</strong><small>Mint, decimals and conversion configuration</small></span><span aria-hidden="true">+</span></summary>
          <div className="token-details-body">
          <div className="card-title">Token verification — {asset.symbol}</div>
          <div className="kv"><span className="k">Mint (mainnet)</span><span className="v mono" style={{ fontSize: 11 }}><a href={solscan} target="_blank" rel="noreferrer">{asset.mint.slice(0, 6)}…{asset.mint.slice(-4)}</a></span></div>
          <div className="kv"><span className="k">Token program</span><span className="v">{asset.program} <span className="pill green">verified</span></span></div>
          <div className="kv"><span className="k">Decimals</span><span className="v mono">{asset.decimals}</span></div>
          <div className="kv"><span className="k">Scaled multiplier (live)</span><span className="v mono">{mult.toFixed(10)}</span></div>
          <div className="kv"><span className="k">1 raw token equals</span><span className="v mono">{mult.toFixed(6)} share-equiv</span></div>
          <div className="kv"><span className="k">Underlying</span><span className="v">{asset.underlying}</span></div>
          <div className="kv"><span className="k">Jupiter coverage</span><span className="v">{asset.jupiter ? <span className="pill green">yes</span> : "no"}</span></div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            The scaled factor converts raw Token-2022 balances into the share-equivalent amount shown in holdings.
          </div>
          </div>
        </details>
      </div>
    </>
  );
}
