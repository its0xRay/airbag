import { useEffect, useMemo, useState } from "react";
import { useChain } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchMarket, type Market } from "../data/marketData";
import { quotePremium, payout as intrinsic, toFixed, fromFixed } from "../engine";
import { fmtPrice, fmtUsd } from "../format";
import { useNowSeconds } from "../useNowSeconds";

const tok = (v: bigint) => Number(v) / 1e6;

/**
 * Scenario calculator (PRD §14). Hypothetical by design — it answers "what if
 * the reference settles at X". It uses the real published series and the live
 * spot, and the SAME payout arithmetic the program enforces, so the numbers
 * reconcile with an actual contract.
 */
export default function CalculatorTab() {
  const c = useChain();
  const [assetId, setAssetId] = useState(0);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [qtyStr, setQtyStr] = useState("1");
  const [refStr, setRefStr] = useState("");
  const [market, setMarket] = useState<Market | null>(null);
  const asset = VERIFIED_ASSETS[assetId];

  useEffect(() => {
    let alive = true;
    fetchMarket(asset.mint).then((m) => {
      if (!alive) return;
      setMarket(m);
      const px = asset.kind === "EquityToken" ? (m.benchmark ?? m.usdPrice) : m.usdPrice;
      if (px) setRefStr(px.toFixed(2));
    }).catch(() => {});
    return () => { alive = false; };
  }, [assetId, asset.mint, asset.kind]);

  const options = useMemo(() => c.seriesList.filter((s) => s.assetId === assetId), [c.seriesList, assetId]);
  const selected = options.find((s) => s.seriesId === seriesId) ?? options[0];

  const spotReal = asset.kind === "EquityToken" ? (market?.benchmark ?? market?.usdPrice) : market?.usdPrice;
  const qty = parseFloat(qtyStr) > 0 ? toFixed(parseFloat(qtyStr)) : 0n;
  const ref = parseFloat(refStr) > 0 ? toFixed(parseFloat(refStr)) : 0n;
  const now = useNowSeconds();

  const est = selected && qty > 0n && spotReal
    ? quotePremium(assetId, qty, selected.strike, toFixed(spotReal), Math.max(selected.expiryTs - now, 60))
    : null;
  const payoutV = selected && qty > 0n ? intrinsic(qty, selected.strike, ref) : 0n;
  const net = est ? payoutV - est.premium : 0n;

  if (options.length === 0) {
    return <div className="card empty">Loading published series from the program…</div>;
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        {VERIFIED_ASSETS.map((a, i) => (
          <button key={a.key} className={"btn sm " + (i === assetId ? "primary" : "ghost")} onClick={() => { setAssetId(i); setSeriesId(null); }}>
            {a.symbol}
          </button>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title">Scenario inputs</div>
          <label className="field">
            <span className="lbl">Protected quantity</span>
            <input className="input" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} inputMode="decimal" />
          </label>
          <div style={{ height: 12 }} />
          <label className="field">
            <span className="lbl">Series (published onchain)</span>
            <select className="input" value={selected?.seriesId ?? ""} onChange={(e) => setSeriesId(Number(e.target.value))}>
              {options.map((s) => (
                <option key={s.seriesId} value={s.seriesId}>
                  {fmtPrice(s.strike)} · {s.shortDated ? "short-dated Devnet" : "weekly"}
                </option>
              ))}
            </select>
          </label>
          <div style={{ height: 12 }} />
          <label className="field">
            <span className="lbl">
              Hypothetical settlement reference {asset.kind === "EquityToken" ? "(stock benchmark)" : "(token market)"}
            </span>
            <input className="input" value={refStr} onChange={(e) => setRefStr(e.target.value)} inputMode="decimal" />
          </label>
          {spotReal && (
            <input
              type="range" min={spotReal * 0.4} max={spotReal * 1.3} step={spotReal / 200}
              value={parseFloat(refStr) || spotReal}
              onChange={(e) => setRefStr(parseFloat(e.target.value).toFixed(2))}
              style={{ width: "100%", marginTop: 12 }}
              aria-label="Hypothetical settlement reference"
            />
          )}
          <div className="disclosure" style={{ marginTop: 10 }}>
            Hypothetical — not a prediction of the settlement value. Live {asset.kind === "EquityToken" ? "benchmark" : "market"} is{" "}
            <strong>{spotReal ? fmtUsd(spotReal) : "…"}</strong>.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Result</div>
          <div className="grid cols-2">
            <div><div className="stat-label">Gross payout</div><div className={"stat-value sm mono " + (payoutV > 0n ? "pos" : "")}>{tok(payoutV).toFixed(2)} oUSD</div></div>
            <div><div className="stat-label">Premium (est.)</div><div className="stat-value sm mono">{est ? tok(est.premium).toFixed(2) + " oUSD" : "—"}</div></div>
          </div>
          <div className="hr" />
          <div className="stat-label">Net protection payoff</div>
          <div className={"stat-value mono " + (net >= 0n ? "pos" : "neg")}>{net >= 0n ? "+" : ""}{tok(net).toFixed(2)} oUSD</div>
          <div className="hr" />
          <div className="kv">
            <span className="k">Outcome vs strike</span>
            <span className="v">
              {!selected ? "—" : ref < selected.strike ? "below — pays intrinsic" : ref === selected.strike ? "at strike — zero" : "above — zero payout"}
            </span>
          </div>
          <div className="kv"><span className="k">Strike</span><span className="v mono">{selected ? fmtPrice(selected.strike) : "—"}</span></div>
          <div className="kv"><span className="k">Remaining token exposure</span><span className="v mono">{fromFixed(qty).toLocaleString(undefined, { maximumFractionDigits: 4 })} {asset.symbol}</span></div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            Your {asset.symbol} stays exposed to the market after exercised protection ends.
            {asset.kind === "EquityToken" && " A stock-benchmark contract excludes any token-market discount."}
          </div>
        </div>
      </div>
    </>
  );
}
