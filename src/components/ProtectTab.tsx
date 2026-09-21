import { useEffect, useMemo, useRef, useState } from "react";
import { useChain, explorerUrl, type SeriesInfo } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchQuoteReference, referenceSourceLabel, type QuoteReference } from "../data/marketData";
import { quotePremium, payout as intrinsic, toFixed, fromFixed, maxLiability } from "../engine";
import { fmtPrice, fmtUsd, fmtPct, fmtDuration, fmtClock, fmtAge, fmtOusd } from "../format";
import type { ProtectDraft } from "../App";
import { useNowSeconds } from "../useNowSeconds";

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
  onViewPositions,
}: {
  renewal?: { assetId: number; quantity: number } | null;
  onRenewalConsumed?: () => void;
  initialDraft?: ProtectDraft | null;
  onInitialDraftConsumed?: () => void;
  onViewPositions?: () => void;
} = {}) {
  const c = useChain();
  const [assetId, setAssetId] = useState(1);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [tenor, setTenor] = useState<"short" | "weekly">("short");
  const [qtyStr, setQtyStr] = useState("1");
  const [reference, setReference] = useState<QuoteReference | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [scenario, setScenario] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<{ symbol: string; quantity: number; strike: bigint; expiry: number; premium: number | null } | null>(null);
  const [isRenewal, setIsRenewal] = useState(false);
  const [referenceRetry, setReferenceRetry] = useState(0);
  const choseInitialAsset = useRef(false);
  const userChoseAsset = useRef(false);

  useEffect(() => {
    if (!initialDraft || renewal) return;
    choseInitialAsset.current = true;
    // Parent navigation supplies a one-shot draft that must hydrate local form state.
    // oxlint-disable-next-line react/set-state-in-effect
    setAssetId(initialDraft.assetId);
    setSeriesId(initialDraft.seriesId ?? null);
    const drafted = c.seriesList.find((s) => s.assetId === initialDraft.assetId && s.seriesId === initialDraft.seriesId);
    if (drafted) setTenor(drafted.shortDated ? "short" : "weekly");
    if (initialDraft.quantity && initialDraft.quantity > 0) setQtyStr(String(initialDraft.quantity));
    onInitialDraftConsumed?.();
  }, [c.seriesList, initialDraft, onInitialDraftConsumed, renewal]);

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
    // Renewal navigation intentionally replaces the editable form draft.
    // oxlint-disable-next-line react/set-state-in-effect
    setAssetId(renewal.assetId);
    setSeriesId(null);
    setTenor("short");
    setQtyStr(String(renewal.quantity));
    setIsRenewal(true);
    setDone(null);
    onRenewalConsumed?.();
  }, [renewal, onRenewalConsumed]);

  const asset = VERIFIED_ASSETS[assetId];

  useEffect(() => {
    let alive = true;
    // Clear the previous asset's quote while the new external reference loads.
    // oxlint-disable-next-line react/set-state-in-effect
    setReference(null);
    setMarketError(null);
    const load = () => fetchQuoteReference(assetId)
      .then((nextReference) => {
        if (!alive) return;
        setReference(nextReference);
        setMarketError(null);
      })
      .catch(() => {
        if (alive) { setReference(null); setMarketError("The reference service could not be reached."); }
      });
    void load();
    const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [assetId, referenceRetry]);

  const options = useMemo(
    () => c.seriesList.filter((s) => s.assetId === assetId),
    [c.seriesList, assetId],
  );
  const effectiveTenor = options.some((s) => s.shortDated === (tenor === "short")) ? tenor : tenor === "short" ? "weekly" : "short";
  const tenorOptions = options.filter((s) => s.shortDated === (effectiveTenor === "short"));
  const selected: SeriesInfo | undefined =
    options.find((s) => s.seriesId === seriesId) ?? tenorOptions[0] ?? options[0];

  const quantity = Number(qtyStr);
  const qty = Number.isFinite(quantity) && quantity > 0 && quantity <= 1e9 ? toFixed(quantity) : 0n;
  const spotReal = reference?.available ? reference.price : undefined;
  const referenceReady = reference?.available === true;
  const spot = spotReal != null ? toFixed(spotReal) : 0n;

  const now = useNowSeconds();
  const secsLeft = selected ? selected.expiryTs - now : 0;
  const est = selected && qty > 0n && spot > 0n
    ? quotePremium(assetId, qty, selected.strike, spot, Math.max(secsLeft, 60))
    : null;
  const notional = selected && qty > 0n ? maxLiability(qty, selected.strike) : 0n;
  const premiumPct = est && notional > 0n ? fromFixed(est.premium) / fromFixed(notional) : 0;
  const premiumPerUnit = est && qty > 0n ? fromFixed(est.premium) / fromFixed(qty) : 0;
  const breakeven = selected ? Math.max(0, fromFixed(selected.strike) - premiumPerUnit) : 0;
  const maxNet = est ? fromFixed(notional) - fromFixed(est.premium) : 0;
  const intrinsicNow = selected && qty > 0n && spot > 0n ? intrinsic(qty, selected.strike, spot) : 0n;
  const additionalPremium = est ? est.premium - intrinsicNow : 0n;
  const chartMin = spotReal != null ? Math.max(0, Math.min(spotReal * 0.65, breakeven * 0.9)) : 0;
  const chartMax = spotReal != null ? Math.max(spotReal * 1.18, selected ? tok(selected.strike) * 1.08 : 0) : 1;
  const payoffPoints = selected && est && qty > 0n
    ? Array.from({ length: 32 }, (_, index) => {
        const value = chartMin + ((chartMax - chartMin) * index) / 31;
        const net = intrinsic(qty, selected.strike, toFixed(value)) - est.premium;
        return { value, net: tok(net) };
      })
    : [];
  const payoffScale = Math.max(1, ...payoffPoints.map((point) => Math.abs(point.net)));
  const payoffPolyline = payoffPoints.map((point, index) => {
    const x = (index / Math.max(1, payoffPoints.length - 1)) * 100;
    const y = 29 - (point.net / payoffScale) * 24;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  const tooBig = !!selected && qty > selected.maxContractSize;
  const closed = !!selected && now > selected.purchaseCutoffTs;
  const affordable = !est || c.tokenBalance >= fromFixed(est.premium);
  const canBuy = !!selected && referenceReady && qty > 0n && !tooBig && !closed && affordable && !c.busy && c.connected;

  async function buy() {
    if (!selected) return;
    setDone(null);
    try {
      await c.buy(assetId, selected.seriesId, parseFloat(qtyStr));
      setReceipt({ symbol: asset.symbol, quantity, strike: selected.strike, expiry: selected.expiryTs, premium: useChain.getState().lastPurchasePremium });
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

  const scenarioPrice = Math.max(chartMin, Math.min(chartMax, scenario ?? spotReal ?? 0));
  const scenarioPayout = selected && est ? intrinsic(qty, selected.strike, toFixed(scenarioPrice)) : 0n;
  const chartX = (value: number) => Math.max(0, Math.min(100, (value - chartMin) / Math.max(0.01, chartMax - chartMin) * 100));
  const referenceStatus = referenceReady ? "Reference available" : reference?.status === "session_closed" ? "Equity session closed" : reference?.status === "stale" ? "Waiting for a fresh benchmark" : marketError ? "Reference unavailable" : reference ? "Reference unavailable" : "Checking reference…";

  const buyLabel = c.busy ? c.status || "Submitting…" : !referenceReady ? referenceStatus : tooBig ? "Above maximum size" : closed ? "Purchase closed" : !affordable ? "Insufficient oUSD" : "Buy protection";

  return (
    <div className="protect-workspace">
      <div className="app-page-head"><div><h1>Protect</h1><p>Choose your floor. Keep the upside.</p></div></div>
      {isRenewal && <div className="callout">Renew coverage with a new contract. Your previous position keeps its original terms.</div>}
      <div className="protect-market-head">
        <div className="protect-assets" role="group" aria-label="Protection asset">
          {VERIFIED_ASSETS.map((a, i) => <button key={a.key} className={"btn " + (assetId === i ? "primary" : "ghost")} aria-pressed={assetId === i} onClick={() => { userChoseAsset.current = true; setAssetId(i); setSeriesId(null); setTenor("short"); setScenario(null); setDone(null); }} disabled={c.busy}>{a.symbol}</button>)}
        </div>
        <div className="reference-inline"><strong className="mono">{spotReal != null ? fmtUsd(spotReal) : "—"}</strong><span>{referenceStatus}{reference?.available && reference.observedAt != null && <> · <span title={fmtClock(reference.observedAt)}>{fmtAge(reference.observedAt, now)}</span></>}</span><button className="text-action" onClick={() => setReferenceRetry((n) => n + 1)}>Check again</button></div>
      </div>
      <p className="coverage-scope">{asset.kind === "EquityToken" ? "NVIDIA stock benchmark protection. NVDAx token-market discounts are excluded." : "ANTHROPIC token-market protection, based on a 5-minute median. The private company valuation is not the reference."}</p>
      {reference && !reference.available && <p className="reference-explanation">{reference.reason} Purchases resume when a qualifying reference is available.</p>}
      {marketError && <p className="field-error" role="alert">{marketError}</p>}
      {done && receipt ? <section className="card protection-receipt" role="status">
        <span className="pill green">Confirmed onchain</span><h2>Protection active</h2><p>{receipt.quantity} {receipt.symbol} protected</p>
        <div className="receipt-metrics"><div><span>Floor</span><strong>{fmtPrice(receipt.strike)}</strong></div><div><span>Premium paid</span><strong>{receipt.premium != null ? fmtOusd(receipt.premium) : "See transaction"}</strong></div><div><span>Expires</span><strong>{fmtClock(receipt.expiry)}</strong></div></div>
        <div className="row"><button className="btn primary" onClick={onViewPositions}>View positions</button><a href={explorerUrl("tx", done)} target="_blank" rel="noreferrer">View transaction ↗</a><button className="btn ghost" onClick={() => setDone(null)}>Protect another position</button></div>
      </section> : <div className="protect-layout">
        <aside className="card protection-ticket" aria-label="Configure protection">
          <h2>Your protection</h2>
          <fieldset disabled={c.busy} className="ticket-fields">
          <label className="field" htmlFor="protected-quantity"><span className="lbl">Quantity · {asset.symbol}</span></label>
          <div className="quantity-control"><button type="button" aria-label="Decrease protected quantity" onClick={() => setQtyStr(String(Math.max(0.01, (quantity || 1) - 1)))}>−</button><input id="protected-quantity" className="input mono" inputMode="decimal" value={qtyStr} onChange={(e) => setQtyStr(e.target.value)} aria-invalid={qty <= 0n || tooBig} /><button type="button" aria-label="Increase protected quantity" onClick={() => setQtyStr(String(Math.min(selected ? tok(selected.maxContractSize) : 20, (quantity || 0) + 1)))}>+</button></div>
          <div className="field-help">{tooBig ? "Maximum " + (selected ? tok(selected.maxContractSize) : 0) + " units." : qty <= 0n ? "Enter a quantity above zero." : "Underlying stays in your wallet."}</div>
          {c.exposure[assetId] > 0 && <button className="text-action" onClick={() => setQtyStr(String(c.exposure[assetId]))}>Use my holdings</button>}
          <div className="ticket-label">Expiry</div><div className="tenor-switch" role="group" aria-label="Protection expiry">{(["short", "weekly"] as const).map((kind) => <button key={kind} disabled={!options.some((s) => s.shortDated === (kind === "short"))} aria-pressed={effectiveTenor === kind} className={effectiveTenor === kind ? "active" : ""} onClick={() => { setTenor(kind); setSeriesId(null); }}>{kind === "short" ? "Devnet short" : "Weekly"}</button>)}</div>
          <div className="ticket-label">Price floor</div>
          <div className="floor-list">{tenorOptions.map((s) => { const distance = spotReal ? (tok(s.strike) - spotReal) / spotReal : null; return <button key={s.seriesId} className={"strike-option" + (selected?.seriesId === s.seriesId ? " active" : "")} aria-pressed={selected?.seriesId === s.seriesId} onClick={() => setSeriesId(s.seriesId)}><strong className="mono">{fmtPrice(s.strike)}</strong><span className="floor-distance">{distance == null ? "Reference unavailable" : Math.abs(distance * 100).toFixed(1) + "% " + (distance >= 0 ? "above" : "below") + " reference"}</span></button>; })}</div>
          {!selected && <p className="empty">No published series is available.</p>}
          {selected && <div className="ticket-expiry"><div><span>Expires in {fmtDuration(selected.expiryTs - now)}</span><strong>{fmtClock(selected.expiryTs)}</strong></div><div><span>Early exercise closes</span><strong>{fmtClock(selected.exerciseCutoffTs)}</strong></div></div>}
          </fieldset>
          <div className="ticket-premium"><span>Estimated premium</span><strong className="mono">{est ? fmtOusd(tok(est.premium)) : "—"}</strong></div>
          <div className="ticket-balance">Balance {fmtOusd(c.tokenBalance, 0)} · demo</div>
          <div className="ticket-purchase"><button className="btn primary" disabled={!canBuy} aria-busy={c.busy} onClick={buy}>{buyLabel}</button></div>
          <p className="ticket-footnote">Buy requests a fresh signed quote and submits its premium. The estimate may change. Fees and rent are sponsored.</p>
          {c.error && <div className="field-error" role="alert">{c.error}</div>}
        </aside>
        <section className="protection-analysis" aria-label="Protection payout">
          <div className="card scenario-card"><div className="between"><div><h2>Explore the payout</h2><p>Move the settlement price to see the contract outcome.</p></div></div>
          {selected && est && qty > 0n ? <>
            <div className="scenario-results"><div><span>Payout</span><strong className="mono">{fmtOusd(tok(scenarioPayout))}</strong></div><div><span>Premium</span><strong className="mono">{fmtOusd(tok(est.premium))}</strong></div><div><span>Payout minus premium</span><strong className={"mono " + (scenarioPayout >= est.premium ? "pos" : "")}>{fmtOusd(tok(scenarioPayout - est.premium))}</strong></div></div>
            <div className="payoff-chart"><svg viewBox="0 0 100 58" role="img" aria-label="Payout minus premium across settlement prices"><title>Payout minus premium; protection pays more as the settlement price falls</title><line className="zero" x1="0" x2="100" y1="29" y2="29" /><line className="marker floor" x1={chartX(tok(selected.strike))} x2={chartX(tok(selected.strike))} y1="3" y2="55" /><line className="marker breakeven" x1={chartX(breakeven)} x2={chartX(breakeven)} y1="3" y2="55" /><polyline points={payoffPolyline} /><circle cx={chartX(scenarioPrice)} cy={29 - tok(scenarioPayout - est.premium) / payoffScale * 24} r="1.5" fill="var(--text)" /></svg><div className="payoff-chart-axis"><span>{fmtUsd(chartMin)}</span><span>{fmtUsd(chartMax)}</span></div></div>
            <div className="chart-thresholds"><span>Floor <strong>{fmtPrice(selected.strike)}</strong></span><span>Breakeven <strong>{fmtUsd(breakeven)}</strong></span></div>
            <label className="scenario-slider"><span>Hypothetical settlement price <strong className="mono">{fmtUsd(scenarioPrice)}</strong></span><input aria-label="Hypothetical settlement price" type="range" min={chartMin} max={chartMax} step="0.01" value={scenarioPrice} onChange={(e) => setScenario(Number(e.target.value))} /></label>
            <div className="scenario-presets">{[{ label: "Current", value: spotReal! }, { label: "Floor", value: tok(selected.strike) }, { label: "Breakeven", value: breakeven }, { label: "15% lower", value: spotReal! * 0.85 }].map((point) => <button key={point.label} className="btn ghost sm" onClick={() => setScenario(point.value)}>{point.label}</button>)}</div>
            <p className="scenario-note">Payout minus premium describes the protection contract only. It excludes changes in the value of your token holdings.</p>
          </> : <div className="empty"><strong>{qty <= 0n ? "Enter a valid quantity" : referenceStatus}</strong><p>The payout explorer needs a qualifying reference and a published series.</p></div>}
          </div>
          <details className="card protection-details"><summary>Coverage & settlement</summary><div className="kv"><span>Protection reference</span><strong>{asset.benchmarkLabel}</strong></div><div className="kv"><span>Source</span><strong>{reference?.available ? referenceSourceLabel(reference.source) : "Checking…"}</strong></div><p>{asset.kind === "EquityToken" ? "Early exercise uses the next qualifying stock-benchmark observation after the request." : "Early exercise uses a qualifying 5-minute token-market median."} The keeper settles remaining quantity at expiry under the contract’s reference rules. Failed references follow the contractual recovery or refund rules.</p><div className="kv"><span>Maximum payout</span><strong>{selected ? fmtOusd(tok(notional)) : "—"}</strong></div><p>Quantity × floor, reached if the settlement reference is zero. This amount is reserved onchain when protection is issued.</p></details>
          {est && <details className="card protection-details"><summary>Premium basis & economics</summary><div className="kv"><span>Intrinsic value</span><strong>{fmtOusd(tok(intrinsicNow))}</strong></div><div className="kv"><span>Additional protection cost</span><strong>{fmtOusd(tok(additionalPremium))}</strong></div><div className="kv"><span>Premium / maximum payout</span><strong>{fmtPct(premiumPct)}</strong></div><div className="kv"><span>Maximum payout minus premium</span><strong>{fmtOusd(maxNet)}</strong></div><p>The estimate uses the versioned pricing model. Components below are basis points of maximum contractual payout.</p><div className="premium-basis-grid">{Object.entries(est.components).map(([name, value]) => <div key={name}><span>{({volatility:"Modelled put value",jumpEvent:"Jump and event risk",earlyExercise:"Early exercise",hedge:"Hedge assumption",executionFunding:"Execution and funding",ops:"Operations",capitalCost:"Capital cost",riskAllowance:"Risk allowance"} as Record<string,string>)[name] ?? name}</span><strong>{Number(value).toFixed(1)} bps</strong></div>)}</div></details>}
        </section>
      </div>}
      {!done && <div className="mobile-buy-summary"><div><strong>{qty > 0n ? quantity : "—"} {asset.symbol} · {selected ? fmtPrice(selected.strike) + " floor" : "No series"}</strong><span>{selected ? "Expires " + fmtClock(selected.expiryTs) : ""} · Est. {est ? fmtOusd(tok(est.premium)) : "—"}</span></div><button className="btn primary" disabled={!canBuy} onClick={buy}>{buyLabel}</button></div>}
    </div>
  );
}
