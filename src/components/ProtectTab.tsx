import { useEffect, useMemo, useState } from "react";
import { useChain, explorerUrl, type SeriesInfo } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchMarket, type Market } from "../data/marketData";
import { quotePremium, payout as intrinsic, toFixed, fromFixed, maxLiability } from "../engine";
import { fmtPrice, fmtUsd, fmtPct, fmtDuration, fmtClock } from "../format";

const tok = (v: bigint) => Number(v) / 1e6;

/**
 * Buy protection — entirely on-chain (PRD §13.3/§13.4). Series come from the
 * deployed program; the premium shown is an estimate from the same versioned
 * model the quote service uses, and the binding signed quote is fetched and
 * verified on-chain at purchase time (§8).
 */
export default function ProtectTab({ renewal, onRenewalConsumed }: { renewal?: { assetId: number; quantity: number } | null; onRenewalConsumed?: () => void } = {}) {
  const c = useChain();
  const [assetId, setAssetId] = useState(0);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [qtyStr, setQtyStr] = useState("1");
  const [market, setMarket] = useState<Market | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);

  useEffect(() => {
    if (!renewal) return;
    setAssetId(renewal.assetId);
    setSeriesId(null);
    setQtyStr(String(renewal.quantity));
    setIsRenewal(true);
    setDone(null);
    onRenewalConsumed?.();
  }, [renewal, onRenewalConsumed]);

  const asset = VERIFIED_ASSETS[assetId];

  useEffect(() => {
    let alive = true;
    setMarket(null);
    fetchMarket(asset.mint).then((m) => alive && setMarket(m)).catch(() => {});
    return () => { alive = false; };
  }, [assetId, asset.mint]);

  const options = useMemo(
    () => c.seriesList.filter((s) => s.assetId === assetId),
    [c.seriesList, assetId],
  );
  const selected: SeriesInfo | undefined =
    options.find((s) => s.seriesId === seriesId) ?? options[0];

  const qty = parseFloat(qtyStr) > 0 ? toFixed(parseFloat(qtyStr)) : 0n;
  const spotReal = asset.kind === "EquityToken" ? (market?.benchmark ?? market?.usdPrice) : market?.usdPrice;
  const spot = spotReal != null ? toFixed(spotReal) : selected?.strike ?? 0n;

  const now = Math.floor(Date.now() / 1000);
  const secsLeft = selected ? selected.expiryTs - now : 0;
  const est = selected && qty > 0n && spot > 0n
    ? quotePremium(assetId, qty, selected.strike, spot, Math.max(secsLeft, 60))
    : null;
  const notional = selected && qty > 0n ? maxLiability(qty, selected.strike) : 0n;
  const premiumPct = est && notional > 0n ? fromFixed(est.premium) / fromFixed(notional) : 0;

  const tooBig = !!selected && qty > selected.maxContractSize;
  const closed = !!selected && now > selected.purchaseCutoffTs;
  const affordable = !est || c.tokenBalance >= fromFixed(est.premium);
  const canBuy = !!selected && qty > 0n && !tooBig && !closed && affordable && !c.busy && c.connected;

  async function buy() {
    if (!selected) return;
    setDone(null);
    try {
      await c.buy(assetId, selected.seriesId, parseFloat(qtyStr));
      setDone(useChain.getState().lastTx);
    } catch { /* surfaced via c.error */ }
  }

  if (!c.connected) {
    return (
      <div className="card empty">
        Connect the demo wallet to buy protection — it takes one click and needs no SOL.
      </div>
    );
  }

  return (
    <>
      {isRenewal && (
        <div className="callout" style={{ marginBottom: 16 }}>
          🔄 Renewing coverage — this is a <strong>fresh quote</strong>. Quantity is prefilled;
          strike, premium, expiry and reference are all re-quoted, and your previous contract keeps
          its own terms.
        </div>
      )}
      <div className="card-title">1 · Select asset</div>
      <div className="grid cols-2">
        {VERIFIED_ASSETS.map((a, i) => (
          <button
            key={a.key}
            className={"asset-tile" + (i === assetId ? " active" : "")}
            onClick={() => { setAssetId(i); setSeriesId(null); setDone(null); }}
            aria-pressed={i === assetId}
          >
            <div className={"asset-icon " + (a.kind === "EquityToken" ? "eq" : "pre")}>{a.symbol.slice(0, 3)}</div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{a.symbol}</strong>
                <span className="pill green">verified</span>
              </div>
              <div className="faint" style={{ fontSize: 12 }}>{a.name}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Protects: {a.benchmarkLabel}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="callout" style={{ marginTop: 14 }}>
        {asset.kind === "EquityToken"
          ? "Coverage references the underlying listed-stock benchmark — an oracle observation, not an exchange close. Token-market discounts are excluded."
          : "Coverage references a specified token-market median (Jupiter). This is an issuer mark for a private company, not an independently observed public benchmark."}
      </div>

      <div style={{ height: 18 }} />
      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">2 · Quantity</div>
          <label className="field">
            <span className="lbl">
              Protected quantity ({asset.symbol} {asset.kind === "EquityToken" ? "share-equivalents" : "token units"})
            </span>
            <input className="input" value={qtyStr} onChange={(e) => { setQtyStr(e.target.value); setDone(null); }} inputMode="decimal" />
          </label>
          {c.exposure[assetId] > 0 && (
            <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setQtyStr(String(c.exposure[assetId]))}>
              Use my holdings ({c.exposure[assetId].toLocaleString(undefined, { maximumFractionDigits: 4 })})
            </button>
          )}
          <div className="kv" style={{ marginTop: 12 }}>
            <span className="k">Max contract size</span>
            <span className="v mono">{selected ? tok(selected.maxContractSize).toLocaleString() : "—"}</span>
          </div>
          <div className="kv">
            <span className="k">Live {asset.kind === "EquityToken" ? "benchmark" : "token market"}</span>
            <span className="v mono">{spotReal != null ? fmtUsd(spotReal) : "loading…"}</span>
          </div>
          <div className="kv">
            <span className="k">Your demo balance</span>
            <span className="v mono">{c.tokenBalance.toLocaleString()} oUSD</span>
          </div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            Buying protection never moves or escrows your tokens.
          </div>
        </div>

        <div className="card">
          <div className="card-title">3 · Strike & expiry</div>
          {options.length === 0 ? (
            <div className="empty">No live series for {asset.symbol}. The operator publishes new ones weekly.</div>
          ) : (
            <div className="grid cols-2">
              {options.map((s) => {
                const active = selected?.seriesId === s.seriesId;
                const q = qty > 0n && spot > 0n
                  ? quotePremium(assetId, qty, s.strike, spot, Math.max(s.expiryTs - now, 60)) : null;
                return (
                  <button
                    key={s.seriesId}
                    className={"strike-option" + (active ? " active" : "")}
                    onClick={() => { setSeriesId(s.seriesId); setDone(null); }}
                    aria-pressed={active}
                  >
                    <div className="between">
                      <strong className="mono">{fmtPrice(s.strike)}</strong>
                      {s.shortDated
                        ? <span className="pill amber">demo · {fmtDuration(s.expiryTs - now)}</span>
                        : <span className="pill gray">weekly</span>}
                    </div>
                    <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Est. premium</div>
                    <div className="stat-value sm mono">{q ? tok(q.premium).toFixed(2) : "—"}</div>
                  </button>
                );
              })}
            </div>
          )}
          {selected && (
            <>
              <div className="kv" style={{ marginTop: 14 }}><span className="k">Expiry</span><span className="v mono">{fmtClock(selected.expiryTs)}</span></div>
              <div className="kv"><span className="k">Remaining</span><span className="v mono">{fmtDuration(secsLeft)}</span></div>
              <div className="kv"><span className="k">Exercise cutoff</span><span className="v mono">{fmtClock(selected.exerciseCutoffTs)}</span></div>
              {selected.shortDated && (
                <div className="callout warn" style={{ marginTop: 10 }}>
                  Short-dated demo series — exists so the expiry and refund paths can be seen without waiting a week.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ height: 18 }} />
      <div className="card">
        <div className="card-title">4 · Review & buy on-chain</div>
        <div className="grid cols-3">
          <div>
            <div className="stat-label">Protected notional</div>
            <div className="stat-value sm mono">{tok(notional).toLocaleString(undefined, { maximumFractionDigits: 2 })} oUSD</div>
          </div>
          <div>
            <div className="stat-label">Estimated premium</div>
            <div className="stat-value sm mono">{est ? tok(est.premium).toFixed(2) + " oUSD" : "—"}</div>
          </div>
          <div>
            <div className="stat-label">Premium / notional</div>
            <div className="stat-value sm mono">{est ? fmtPct(premiumPct) : "—"}</div>
          </div>
        </div>
        <div className="hr" />
        <div className="grid cols-2">
          <div>
            <div className="kv"><span className="k">Reference</span><span className="v">{asset.benchmarkLabel}</span></div>
            <div className="kv"><span className="k">Settlement</span><span className="v">{asset.kind === "EquityToken" ? "next qualifying observation after request" : "5-min Jupiter median"}</span></div>
            <div className="kv"><span className="k">Collateral</span><span className="v">reserved on-chain before issue</span></div>
            <div className="kv"><span className="k">Outage fallback</span><span className="v">disclosed demo refund</span></div>
          </div>
          <div className="card" style={{ background: "var(--bg)", margin: 0 }}>
            <div className="card-title">If it settles at…</div>
            {selected && est && qty > 0n ? (
              <table className="log">
                <thead><tr><th>Reference</th><th>Payout</th><th>Net</th></tr></thead>
                <tbody>
                  {[1.05, 1.0, 0.85, 0.7].map((m) => {
                    const ref = toFixed((spotReal ?? tok(selected.strike)) * m);
                    const p = intrinsic(qty, selected.strike, ref);
                    const net = p - est.premium;
                    return (
                      <tr key={m}>
                        <td className="mono">{fmtUsd(fromFixed(ref))}</td>
                        <td className="mono">{tok(p).toFixed(2)}</td>
                        <td className={"mono " + (net >= 0n ? "pos" : "neg")}>{net >= 0n ? "+" : ""}{tok(net).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="empty">Enter a quantity.</div>}
          </div>
        </div>
        <div className="hr" />
        <div className="between">
          <div className="disclosure">
            The binding premium is signed by the quote service at purchase (60s validity) and verified on-chain.
            Fees and rent are sponsored — you need no SOL.
          </div>
          <button className="btn primary" disabled={!canBuy} onClick={buy}>
            {c.busy ? c.status || "Working…" : tooBig ? "Above max size" : closed ? "Purchase closed" : !affordable ? "Insufficient oUSD" : "Buy protection"}
          </button>
        </div>
        {c.error && <div className="callout warn" style={{ marginTop: 12 }}>{c.error}</div>}
        {done && (
          <div className="callout" style={{ marginTop: 12 }}>
            ✓ Confirmed on-chain —{" "}
            <a className="mono" href={explorerUrl("tx", done)} target="_blank" rel="noreferrer">{done.slice(0, 24)}… ↗</a>
            {" "}· see it in Portfolio.
          </div>
        )}
      </div>
    </>
  );
}
