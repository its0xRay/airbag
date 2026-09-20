import { useEffect, useMemo, useRef, useState } from "react";
import { useChain, explorerUrl, type SeriesInfo } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchQuoteReference, type QuoteReference } from "../data/marketData";
import { quotePremium, payout as intrinsic, toFixed, fromFixed, maxLiability } from "../engine";
import { fmtPrice, fmtUsd, fmtPct, fmtDuration, fmtClock } from "../format";
import type { ProtectDraft } from "../App";

const tok = (v: bigint) => Number(v) / 1e6;

/**
 * Buy protection — entirely on-chain (PRD §13.3/§13.4). Series come from the
 * deployed program; the premium shown is an estimate from the same versioned
 * model the quote service uses, and the binding signed quote is fetched and
 * verified on-chain at purchase time (§8).
 */
export default function ProtectTab({
  renewal,
  onRenewalConsumed,
  initialDraft,
  onInitialDraftConsumed,
}: {
  renewal?: { assetId: number; quantity: number } | null;
  onRenewalConsumed?: () => void;
  initialDraft?: ProtectDraft | null;
  onInitialDraftConsumed?: () => void;
} = {}) {
  const c = useChain();
  const [assetId, setAssetId] = useState(0);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [qtyStr, setQtyStr] = useState("1");
  const [reference, setReference] = useState<QuoteReference | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);
  const choseInitialAsset = useRef(false);
  const userChoseAsset = useRef(false);

  useEffect(() => {
    if (!initialDraft || renewal) return;
    choseInitialAsset.current = true;
    setAssetId(initialDraft.assetId);
    setSeriesId(initialDraft.seriesId ?? null);
    if (initialDraft.quantity && initialDraft.quantity > 0) setQtyStr(String(initialDraft.quantity));
    onInitialDraftConsumed?.();
  }, [initialDraft, onInitialDraftConsumed, renewal]);

  // Open the demo on an executable market when one is available. This only
  // chooses the initial asset; a user's explicit asset selection is preserved.
  useEffect(() => {
    if (renewal || choseInitialAsset.current) return;
    choseInitialAsset.current = true;
    let alive = true;
    Promise.all([fetchQuoteReference(0), fetchQuoteReference(1)])
      .then(([equity, prestock]) => {
        if (alive && !userChoseAsset.current && !equity.available && prestock.available) setAssetId(1);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [renewal]);

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
    setReference(null);
    setMarketError(null);
    fetchQuoteReference(assetId)
      .then((nextReference) => {
        if (!alive) return;
        setReference(nextReference);
      })
      .catch(() => {
        if (alive) setMarketError("The reference service could not be reached.");
      });
    return () => { alive = false; };
  }, [assetId]);

  const options = useMemo(
    () => c.seriesList.filter((s) => s.assetId === assetId),
    [c.seriesList, assetId],
  );
  const selected: SeriesInfo | undefined =
    options.find((s) => s.seriesId === seriesId) ?? options[0];

  const qty = parseFloat(qtyStr) > 0 ? toFixed(parseFloat(qtyStr)) : 0n;
  const spotReal = reference?.available ? reference.price : undefined;
  const referenceReady = reference?.available === true;
  const spot = spotReal != null ? toFixed(spotReal) : 0n;

  const now = Math.floor(Date.now() / 1000);
  const secsLeft = selected ? selected.expiryTs - now : 0;
  const est = selected && qty > 0n && spot > 0n
    ? quotePremium(assetId, qty, selected.strike, spot, Math.max(secsLeft, 60))
    : null;
  const notional = selected && qty > 0n ? maxLiability(qty, selected.strike) : 0n;
  const premiumPct = est && notional > 0n ? fromFixed(est.premium) / fromFixed(notional) : 0;
  const premiumPerUnit = est && qty > 0n ? fromFixed(est.premium) / fromFixed(qty) : 0;
  const breakeven = selected ? Math.max(0, fromFixed(selected.strike) - premiumPerUnit) : 0;
  const maxNet = est ? fromFixed(notional) - fromFixed(est.premium) : 0;

  const tooBig = !!selected && qty > selected.maxContractSize;
  const closed = !!selected && now > selected.purchaseCutoffTs;
  const affordable = !est || c.tokenBalance >= fromFixed(est.premium);
  const canBuy = !!selected && referenceReady && qty > 0n && !tooBig && !closed && affordable && !c.busy && c.connected;

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
      <div className="app-page-head">
        <div><div className="card-title">Buy downside protection</div><h1>Protect</h1><p>Choose a published floor, review the estimated economics, then submit a fresh signed quote to the Devnet program.</p></div>
      </div>
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
            onClick={() => {
              userChoseAsset.current = true;
              setAssetId(i);
              setSeriesId(null);
              setDone(null);
            }}
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
          : "Coverage follows the ANTHROPIC token market price using a Jupiter 5-minute median. It does not track the private company’s valuation."}
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
            <span className="k">Executable {asset.kind === "EquityToken" ? "benchmark" : "token reference"}</span>
            <span className="v mono">
              {spotReal != null ? fmtUsd(spotReal) : reference ? "Not quoting" : marketError ? "Unavailable" : "Checking…"}
            </span>
          </div>
          {reference?.available && (
            <div className="kv">
              <span className="k">Reference source</span>
              <span className="v mono">{reference.source}</span>
            </div>
          )}
          <div className="kv">
            <span className="k">Your demo balance</span>
            <span className="v mono">{c.tokenBalance.toLocaleString()} oUSD</span>
          </div>
          <div className="disclosure" style={{ marginTop: 10 }}>
            You do not need to deposit or prove ownership of the underlying token. Holdings are optional context; Optket never moves or escrows them.
          </div>
          {marketError && (
            <div className="callout warn" role="alert" style={{ marginTop: 10 }}>
              {marketError} New quotes are disabled until a fresh reference returns.
            </div>
          )}
          {reference && !reference.available && (
            <div
              className={"callout" + (reference.status === "session_closed" ? "" : " warn")}
              role={reference.status === "session_closed" ? "status" : "alert"}
              style={{ marginTop: 10 }}
            >
              {reference.status === "session_closed"
                ? `The supported equity session is closed.${reference.nextOpen ? ` Quotes resume ${fmtClock(reference.nextOpen)}.` : ""}`
                : reference.reason}
            </div>
          )}
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
                        ? <span className="pill blue">Devnet · {fmtDuration(s.expiryTs - now)}</span>
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
                <div className="callout" style={{ marginTop: 10 }}>
                  Short-dated Devnet series — a genuine onchain contract with the same collateral and settlement rules as the weekly series.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{ height: 18 }} />
      <div className="card">
        <div className="card-title">4 · Review & buy onchain</div>
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
        <div className="protection-summary" aria-label="Protection economics">
          <div><span>Breakeven reference</span><strong className="mono">{est ? fmtUsd(breakeven) : "—"}</strong></div>
          <div><span>Maximum payout</span><strong className="mono">{est ? `${tok(notional).toFixed(2)} oUSD` : "—"}</strong></div>
          <div><span>Maximum net payoff</span><strong className="mono">{est ? `${maxNet.toFixed(2)} oUSD` : "—"}</strong></div>
        </div>
        <div className="hr" />
        <div className="grid cols-2">
          <div>
            <div className="kv"><span className="k">Reference</span><span className="v">{asset.benchmarkLabel}</span></div>
            <div className="kv"><span className="k">Settlement</span><span className="v">{asset.kind === "EquityToken" ? "next qualifying observation after request" : "5-min Jupiter median"}</span></div>
            <div className="kv"><span className="k">Collateral</span><span className="v">reserved onchain before issue</span></div>
            <div className="kv"><span className="k">Reference failure</span><span className="v">contractual refund rule</span></div>
          </div>
          <div className="card" style={{ background: "var(--bg)", margin: 0 }}>
            <div className="card-title">If it settles at…</div>
            {selected && est && qty > 0n ? (
              <>
              <p className="payoff-explainer">Below the floor, each $1 fall in the settlement reference pays $1 per protected unit, up to the contractual maximum.</p>
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
              </>
            ) : <div className="empty">Enter a quantity.</div>}
          </div>
        </div>
        <div className="hr" />
        <div className="between">
          <div className="disclosure">
            This preview is an estimate. Buy requests a fresh signed quote, then submits that locked premium onchain within its 60-second validity. Fees and rent are sponsored — you need no SOL.
          </div>
          <button className="btn primary" disabled={!canBuy} onClick={buy}>
            {c.busy
              ? c.status || "Working…"
              : reference && !reference.available && reference.status === "session_closed"
                ? "Equity session closed"
                : !referenceReady
                  ? "Reference unavailable"
                  : tooBig ? "Above max size" : closed ? "Purchase closed" : !affordable ? "Insufficient oUSD" : "Buy protection"}
          </button>
        </div>
        {c.error && <div className="callout warn" style={{ marginTop: 12 }}>{c.error}</div>}
        {done && (
          <div className="callout" style={{ marginTop: 12 }}>
            ✓ Confirmed onchain{c.lastPurchasePremium != null ? ` at ${c.lastPurchasePremium.toFixed(2)} oUSD` : ""} —{" "}
            <a className="mono" href={explorerUrl("tx", done)} target="_blank" rel="noreferrer">{done.slice(0, 24)}… ↗</a>
            {" "}· see it in Positions.
          </div>
        )}
      </div>
    </>
  );
}
