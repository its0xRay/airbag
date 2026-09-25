import AssetSelector from "./AssetSelector";
import { defaultFloor } from "../client/defaultFloor";
import ProtectionMechanism from "./ProtectionMechanism";
import ProtectionBoundary from "./ProtectionBoundary";
import HoldingsCard from "./HoldingsCard";
import { combinedOutcome } from "../engine/combinedOutcome";
import { pendingTransaction } from "../onchain/transactionRecovery";
import { ACTIVE_REFERENCE_VERSION } from "../data/referencePolicy";
import { useEffect, useMemo, useRef, useState } from "react";
import { visiblePolling } from "../visiblePolling";
import { useChain, explorerUrl, loadSeries, type SeriesInfo } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchQuoteReference, referenceSourceLabel, type QuoteReference } from "../data/marketData";
import { quotePremium, payout as intrinsic, toFixed, fromFixed, maxLiability } from "../engine";
import { fmtPrice, fmtUsd, fmtPct, fmtDuration, fmtClock, fmtAge, fmtOusd } from "../format";
import type { ProtectDraft } from "../App";
import type { WalkthroughExample } from "./ProtectionWalkthrough";
import { useNowSeconds } from "../useNowSeconds";
import { useAssetAvailability } from "../data/useAssetAvailability";
import { closestTerms, premiumReferenceRatio, type RepeatPosition } from "../client/repeatPosition";

const tok = (v: bigint) => Number(v) / 1e6;

/**
 * Buy protection — entirely on-chain (PRD §13.3/§13.4). Series come from the
 * deployed program; the premium shown is an estimate from the same versioned
 * model the quote service uses, and the binding signed quote is fetched and
 * verified on-chain at purchase time (§8).
 */
export default function ProtectTab({
  embedded = false,
  hero = false,
  renewal,
  onRenewalConsumed,
  initialDraft,
  onInitialDraftConsumed,
  onViewPositions,
  onConnected,
  onDraftChange,
  onExampleChange,
  onCheckoutChange,
}: {
  embedded?: boolean;
  hero?: boolean;
  renewal?: RepeatPosition | null;
  onRenewalConsumed?: () => void;
  initialDraft?: ProtectDraft | null;
  onInitialDraftConsumed?: () => void;
  onViewPositions?: (assetId: number, address?: string) => void;
  onConnected?: (draft: ProtectDraft) => void;
  onDraftChange?: (draft: ProtectDraft) => void;
  onExampleChange?: (example: WalkthroughExample | null) => void;
  onCheckoutChange?: (open: boolean) => void;
} = {}) {
  const c = useChain();
  const [publicSeries, setPublicSeries] = useState<SeriesInfo[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState(false);
  const [seriesRetry, setSeriesRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => loadSeries(c.svcUrl).then((next) => {
      if (alive) { setPublicSeries(next); setSeriesError(false); setSeriesLoading(false); }
    }).catch(() => {
      if (alive) { setSeriesError(true); setSeriesLoading(false); }
    });
    const stop = visiblePolling(load, 30000);
  return () => { alive = false; stop(); };
  }, [c.svcUrl, seriesRetry]);
  const [assetId, setAssetId] = useState(1);
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [tenor, setTenor] = useState<"short" | "weekly">("weekly");
  const [qtyStr, setQtyStr] = useState("1");
  const [holdingsInputs, setHoldingsInputs] = useState<Record<number, string>>({});
  const [reference, setReference] = useState<QuoteReference | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [scenario, setScenario] = useState<number | null>(null);
  const [scenarioPreset, setScenarioPreset] = useState<string | null>("15% lower");
  const [scenarioText, setScenarioText] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ key: string; maxPremium: bigint } | null>(null);
  const purchaseButton = useRef<HTMLButtonElement>(null);
  const cancelReview = () => { setApproval(null); purchaseButton.current?.focus(); };
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => { if (approval) { reviewRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); reviewRef.current?.focus({ preventScroll: true }); } }, [approval]);
  const [receipt, setReceipt] = useState<{ assetId: number; address: string | null; symbol: string; quantity: number; strike: bigint; expiry: number; premium: number | null } | null>(null);
  const receiptRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (done) { receiptRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); receiptRef.current?.focus({ preventScroll: true }); }
  }, [done]);
  const [isRenewal, setIsRenewal] = useState(false);
  const [similarDraft, setSimilarDraft] = useState<RepeatPosition | null>(null);
  const [referenceRetry, setReferenceRetry] = useState(0);
  const choseInitialAsset = useRef(false);
  const userChoseAsset = useRef(false);
  const appliedDraft = useRef<ProtectDraft | null>(null);
  const [explorePayout, setExplorePayout] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(!embedded || !!renewal);
  const compact = embedded && !hero && !checkoutOpen;
  useEffect(() => { onCheckoutChange?.(checkoutOpen); }, [checkoutOpen, onCheckoutChange]);
  const quantityInput = useRef<HTMLInputElement>(null);
  const expandCheckout = () => { setCheckoutOpen(true); requestAnimationFrame(() => quantityInput.current?.focus()); };

  useEffect(() => {
    if (!initialDraft || renewal || appliedDraft.current === initialDraft) return;
    appliedDraft.current = initialDraft;
    choseInitialAsset.current = true;
    // Parent navigation supplies a one-shot draft that must hydrate local form state.
    // oxlint-disable-next-line react/set-state-in-effect
    setAssetId(initialDraft.assetId);
    setSeriesId(initialDraft.seriesId ?? null);
    const drafted = c.seriesList.find((s) => s.assetId === initialDraft.assetId && s.seriesId === initialDraft.seriesId);
    // Restore the explicit duration along with the parent-supplied form draft.
    // oxlint-disable-next-line react/set-state-in-effect
    if (initialDraft.tenor) setTenor(initialDraft.tenor);
    else if (drafted) setTenor(drafted.shortDated ? "short" : "weekly");
    if (initialDraft.quantityText !== undefined) setQtyStr(initialDraft.quantityText);
    else if (initialDraft.quantity && initialDraft.quantity > 0) setQtyStr(String(initialDraft.quantity));
    onInitialDraftConsumed?.();
  }, [c.seriesList, initialDraft, onInitialDraftConsumed, renewal]);

  useEffect(() => {
    onDraftChange?.({ assetId, seriesId: seriesId ?? undefined, quantityText: qtyStr, tenor });
  }, [assetId, seriesId, qtyStr, tenor, onDraftChange]);

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
    setSimilarDraft(renewal);
    setApproval(null);
    setDone(null);
    onRenewalConsumed?.();
  }, [renewal, onRenewalConsumed]);

  const asset = VERIFIED_ASSETS[assetId];
  const assetLabel = assetId === 1 ? asset.name : asset.symbol;

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
        if (alive) { setReference(null); setMarketError("Couldn’t load the market reference. Retry to check current pricing. Your terms are unchanged."); }
      });
    const stop = visiblePolling(load, 15000);
    return () => { alive = false; stop(); };
  }, [assetId, referenceRetry]);

  const options = useMemo(
    () => publicSeries.filter((s) => s.assetId === assetId && s.referenceVersion === ACTIVE_REFERENCE_VERSION[assetId]),
    [publicSeries, assetId],
  );
  useEffect(() => {
    if (!similarDraft || seriesLoading || assetId !== similarDraft.assetId) return;
    const match = closestTerms(options, similarDraft, Math.floor(Date.now() / 1000));
    // A one-shot draft selects only an available series, never an old quote.
    // oxlint-disable-next-line react/set-state-in-effect
    setSeriesId(match?.seriesId ?? null);
    if (match) setTenor(match.shortDated ? "short" : "weekly");
    setSimilarDraft(null);
  }, [similarDraft, seriesLoading, assetId, options]);
  const effectiveTenor = !options.length ? tenor : options.some((s) => s.shortDated === (tenor === "short")) ? tenor : tenor === "short" ? "weekly" : "short";
  const tenorOptions = options.filter((s) => s.shortDated === (effectiveTenor === "short"));
  const selected: SeriesInfo | undefined =
    options.find((s) => s.seriesId === seriesId) ?? defaultFloor(tenorOptions, reference?.available && reference.assetId === assetId ? toFixed(reference.price) : undefined);

  useEffect(() => {
    if (similarDraft || renewal || (initialDraft && appliedDraft.current !== initialDraft) || !reference?.available || reference.assetId !== assetId || !selected || options.some(s => s.seriesId === seriesId)) return;
    // Freeze the initial floor once a real reference arrives; polling must not change it.
    // oxlint-disable-next-line react/set-state-in-effect
    setSeriesId(selected.seriesId);
  }, [assetId, initialDraft, options, reference, renewal, selected, seriesId, similarDraft]);

  const quantity = Number(qtyStr);
  const qty = Number.isFinite(quantity) && quantity > 0 && quantity <= 1e9 ? toFixed(quantity) : 0n;
  const spotReal = reference?.available && reference.assetId === assetId ? reference.price : undefined;
  const referenceReady = reference?.available === true && reference.assetId === assetId;
  const spot = spotReal != null ? toFixed(spotReal) : 0n;

  const now = useNowSeconds();
  const secsLeft = selected ? selected.expiryTs - now : 0;
  const est = selected && qty > 0n && spot > 0n
    ? quotePremium(assetId, qty, selected.strike, spot, Math.max(secsLeft, 60))
    : null;
  const notional = selected && qty > 0n ? maxLiability(qty, selected.strike) : 0n;
  const premiumPct = est && notional > 0n ? fromFixed(est.premium) / fromFixed(notional) : 0;
  const referenceRatio = est && secsLeft > 0 ? premiumReferenceRatio(est.premium, qty, spot) : null;
  const premiumPerUnit = est && qty > 0n ? fromFixed(est.premium) / fromFixed(qty) : 0;
  const breakeven = selected ? Math.max(0, fromFixed(selected.strike) - premiumPerUnit) : 0;
  const maxNet = est ? fromFixed(notional) - fromFixed(est.premium) : 0;
  const intrinsicNow = selected && qty > 0n && spot > 0n ? intrinsic(qty, selected.strike, spot) : 0n;
  const additionalPremium = est ? est.premium - intrinsicNow : 0n;
  const chartMin = 0;
  const chartMax = spotReal != null ? Math.max(spotReal * 1.18, selected ? tok(selected.strike) * 1.08 : 0) : 1;

  const availability = useAssetAvailability(assetId, c.svcUrl);
  const capacityReached = !!selected && !!availability.data && maxLiability(qty, selected.strike) > BigInt(availability.data.availableExposure);
  const admissionReady = availability.data?.canQuote === true && !capacityReached;
  const tooBig = !!selected && qty > selected.maxContractSize;
  const closed = !!selected && now > selected.purchaseCutoffTs;
  const affordable = !est || c.tokenBalance >= fromFixed(est.premium);
  const canBuy = !!selected && referenceReady && admissionReady && qty > 0n && !tooBig && !closed && affordable && !c.busy && !pendingTransaction(c.transaction, c.conn.rpcEndpoint, c.address) && c.connected;
  const approvalKey = `${assetId}:${selected?.seriesId}:${selected?.vaultRound ?? "legacy"}:${selected?.expiryTs}:${selected?.strike}:${qtyStr}`;
  const approved = approval?.key === approvalKey ? approval : null;

  async function buy() {
    if (!selected || !approved || !canBuy) return;
    setDone(null);
    try {
      await c.buy(assetId, selected.seriesId, parseFloat(qtyStr), approved.maxPremium, selected);
      setReceipt({ assetId, address: useChain.getState().lastPurchaseAddress, symbol: assetLabel, quantity, strike: selected.strike, expiry: selected.expiryTs, premium: useChain.getState().lastPurchasePremium });
      setDone(useChain.getState().lastTx);
    } catch { /* surfaced via c.error */ }
    finally { setApproval(null); }
  }

  const presetValue = scenarioPreset === "Current" ? spotReal : scenarioPreset === "Floor" ? selected && tok(selected.strike) : scenarioPreset === "Breakeven" ? breakeven : scenarioPreset === "15% lower" ? spotReal && spotReal * 0.85 : scenario;
  const scenarioPrice = Math.max(chartMin, Math.min(chartMax, presetValue ?? spotReal ?? 0));
  const examplePremium = est?.premium;
  useEffect(() => {
    onExampleChange?.(selected && examplePremium != null && referenceReady ? { assetId, quantity: qty, floor: selected.strike, expiry: selected.expiryTs, premium: examplePremium, reference: toFixed(scenarioPrice) } : null);
  }, [assetId, qty, selected, examplePremium, referenceReady, scenarioPrice, onExampleChange]);
  const holdingsText = holdingsInputs[assetId] ?? String(c.exposure[assetId] || quantity);
  const holdingsQuantity = Number(holdingsText);
  const holdingsValid = holdingsText.trim() !== "" && Number.isFinite(holdingsQuantity) && holdingsQuantity >= 0 && holdingsQuantity <= 1e9;
  const outcome = selected && est && holdingsValid ? combinedOutcome(toFixed(holdingsQuantity), qty, selected.strike, toFixed(scenarioPrice), est.premium) : null;
  const referenceStatus = referenceReady ? "Reference available" : reference?.available === false && reference.status === "session_closed" ? "Equity session closed" : reference?.available === false && reference.status === "stale" ? "Waiting for a fresh reference" : marketError ? "Reference unavailable" : reference ? "Reference unavailable" : "Checking reference…";

  const buyLabel = c.busy ? c.status || "Submitting…" : !c.connected ? "Start with a demo wallet" : !referenceReady ? referenceStatus : !admissionReady ? capacityReached ? "Above available capacity" : availability.label ?? "Capacity reached" : tooBig ? "Above maximum size" : closed ? "Purchase closed" : !affordable ? "Insufficient oUSD" : approved ? "Open position" : "Review position";

  const primaryAction = async () => {
    if (c.connected) {
      if (approved) return buy();
      if (est && canBuy) { c.clearError(); setApproval({ key: approvalKey, maxPremium: ((est.premium + 9999n) / 10000n) * 10000n }); }
      return;
    }
    const draft = { assetId, seriesId: selected?.seriesId, quantityText: qtyStr, tenor };
    await c.connect();
    if (useChain.getState().connected && !useChain.getState().error) onConnected?.(draft);
  };
  const primaryDisabled = c.connected ? !canBuy : c.busy;

  const checkout = (<div className="protection-checkout" hidden={compact}>
          {!hero && <p className="disclosure">Maximum contractual payout is reserved onchain when you buy.</p>}
          {approved && <section ref={reviewRef} tabIndex={-1} className="purchase-review" aria-label="Review purchase" onKeyDown={e => { if (e.key === "Escape" && !c.busy) cancelReview(); }}><h3>Review position</h3><dl className="review-terms"><div><dt>Quantity</dt><dd>{quantity} {assetLabel}</dd></div><div><dt>Price floor</dt><dd className="mono">{selected && fmtPrice(selected.strike)}</dd></div><div><dt>Expires</dt><dd>{selected && fmtClock(selected.expiryTs)}</dd></div><div><dt>Early exercise closes</dt><dd>{selected && fmtClock(selected.exerciseCutoffTs)}</dd></div><div><dt>Maximum premium</dt><dd className="mono">{fmtOusd(tok(approved.maxPremium))}</dd></div></dl><p>You won’t pay above this premium limit.</p>{selected?.vaultRound && <p>Funded by the {assetLabel} vault. <a href={explorerUrl("address", selected.vaultRound)} target="_blank" rel="noreferrer">Inspect backing round ↗</a></p>}<button className="btn ghost sm" disabled={c.busy} onClick={cancelReview}>Cancel review</button></section>}
          <div className="checkout-row"><div>{c.connected && <div className="ticket-balance">Balance {fmtOusd(c.tokenBalance, 0)}</div>}</div>
          <div className="ticket-purchase"><button ref={purchaseButton} className="btn primary" disabled={primaryDisabled} aria-busy={c.busy} onClick={primaryAction}>{buyLabel}</button></div></div>
          <p className="ticket-footnote">{hero && <>oUSD · test token, no monetary value. </>}{c.connected ? "Network fees sponsored." : "No wallet extension or SOL needed. Wallet saved in this browser. Clearing site data removes access."}</p>
          {c.error && <div className="field-error" role="alert">{c.error}</div>}
        </div>);
  return (
    <div className={"protect-workspace" + (embedded ? " protect-embedded" : "") + (compact ? " protect-compact" : "") + (hero ? " protect-hero" : "")}>
      {!embedded && <div className="app-page-head"><div><h1>Open position</h1><p>Choose your floor. Keep the upside.</p></div></div>}
      {isRenewal && <div className="callout">Quantity copied. Review the available floor and expiry, then confirm a fresh quote. This opens a separate position, not continuous coverage. Your previous position is unchanged.</div>}
      <div className="protect-market-head">
        <AssetSelector value={assetId} disabled={c.busy} onChange={i => { userChoseAsset.current = true; setAssetId(i); setSeriesId(null); setScenario(null); setScenarioPreset("15% lower"); setScenarioText(null); setApproval(null); setDone(null); }} />
        <div className="reference-inline"><span>Reference price</span><strong className="mono">{spotReal != null ? fmtUsd(spotReal) : "—"}</strong><span>{reference?.available ? reference.observedAt != null ? <span title={fmtClock(reference.observedAt)}>{fmtAge(reference.observedAt, now).replace(/^updated/, "Updated")}</span> : "Timestamp unavailable" : referenceStatus}</span><button className="text-action" onClick={() => setReferenceRetry((n) => n + 1)}>{marketError ? "Retry" : "Refresh"}</button></div>
      </div>
      <p className="coverage-scope">Reference: token-market price</p>
      {(!admissionReady && referenceReady) && <p className="disclosure" role="status">{capacityReached ? "This quantity exceeds the asset’s remaining Devnet capacity. Reduce the quantity or wait for positions to settle." : availability.label} <button className="text-action" onClick={availability.refresh}>Refresh availability</button></p>}
      {reference && !reference.available && <p className="reference-explanation"><span aria-hidden="true">⚠ </span>{reference.reason}</p>}
      {marketError && <p className="field-error" role="alert">{marketError}</p>}
      {done && receipt ? <section ref={receiptRef} tabIndex={-1} className="card protection-receipt" aria-label="Purchase confirmation">
        <span className="receipt-check" aria-hidden="true">✓</span><span className="pill green">Confirmed onchain · Devnet</span><h2>{now < receipt.expiry ? "Your position is open." : "Your purchase is confirmed."}</h2><p className="receipt-quantity mono">{receipt.quantity} {receipt.symbol} protected</p>
        <p>Your tokens stay yours. Follow this contract in Positions{now >= receipt.expiry ? " for its settlement status" : " or exercise before the cutoff"}.</p>
        <ProtectionBoundary floor={receipt.strike} compact />
        <div className="receipt-metrics"><div><span>Maximum payout at purchase</span><strong>{fmtOusd(tok(maxLiability(toFixed(receipt.quantity), receipt.strike)))}</strong></div><div><span>Premium paid</span><strong>{receipt.premium != null ? fmtOusd(receipt.premium) : "See transaction"}</strong></div><div><span>Expires</span><strong>{fmtClock(receipt.expiry)}</strong></div></div>
        <p className="disclosure">Maximum payout reserved at issuance. Current reserve, reference terms and settlement receipts are in your position.</p>
        <div className="receipt-actions"><button className="btn primary" onClick={() => onViewPositions?.(receipt.assetId, receipt.address ?? undefined)}>View position</button><button className="btn ghost" onClick={() => setDone(null)}>Open another</button><a className="lp-text-link" href={explorerUrl("tx", done)} target="_blank" rel="noreferrer">Verify transaction ↗</a></div>
      </section> : <div className="protect-layout">
        <aside className="card protection-ticket" aria-label="Set your floor">
          <fieldset disabled={c.busy} className="ticket-fields" onClick={() => { if (approval) setApproval(null); }}><legend className="sr-only">Contract terms</legend>
          {!hero && <p className="floor-explanation">If the settlement reference falls below your floor, receive the difference.</p>}
          {compact && <p className="compact-terms">{quantity} {assetLabel} · {selected ? <>Expires {new Date(selected.expiryTs * 1000).toLocaleDateString(undefined, {day: "numeric", month: "short"})} · {fmtDuration(secsLeft)} left</> : "Loading expiry…"}</p>}
          <div hidden={compact} className="buyer-term-row"><div className="buyer-quantity">
          <label className="field" htmlFor="protected-quantity"><span className="lbl">{hero ? "Quantity" : <>Quantity · {assetLabel}</>}</span></label>
          <div className="quantity-control"><button type="button" disabled={quantity <= 0.01} aria-label="Decrease protected quantity by one" onClick={() => setQtyStr(String(Math.max(0.01, (quantity || 1) - 1)))}>−</button><input ref={quantityInput} id="protected-quantity" className="input mono" inputMode="decimal" autoComplete="off" value={qtyStr} onChange={(e) => { setQtyStr(e.target.value); setApproval(null); }} aria-describedby="quantity-help" aria-invalid={qty <= 0n || tooBig} /><button type="button" disabled={!!selected && qty >= selected.maxContractSize} aria-label="Increase protected quantity by one" onClick={() => setQtyStr(String(Math.min(selected ? tok(selected.maxContractSize) : 20, (quantity || 0) + 1)))}>+</button></div>
          <div className="field-help" id="quantity-help">{qty <= 0n ? "Enter a quantity above zero." : selected ? `${hero ? "Max" : "Maximum per position:"} ${tok(selected.maxContractSize)} tokens` : ""}</div>
          {c.exposure[assetId] > 0 && <button className="text-action" onClick={() => setQtyStr(String(c.exposure[assetId]))}>Use reference holdings</button>}
          </div><div className="buyer-expiry"><div className="ticket-label">Expiry</div><div className="tenor-switch" role="group" aria-label="Protection expiry">{(["short", "weekly"] as const).map((kind) => { const option = options.find(s => s.shortDated === (kind === "short")); return <button key={kind} disabled={!option} aria-pressed={effectiveTenor === kind} className={effectiveTenor === kind ? "active" : ""} onClick={() => { setTenor(kind); setSeriesId(null); setApproval(null); }}>{option ? new Date(option.expiryTs * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : kind === "short" ? "Near expiry" : "Later expiry"}<span>{option ? (kind === "short" ? (hero ? "Devnet · " : "Quick Devnet expiry · ") : "") + fmtDuration(option.expiryTs - now) + " left" : "Unavailable"}</span></button>; })}</div>
          {effectiveTenor === "short" && <p className="disclosure">Try the settlement lifecycle sooner.</p>}
          </div></div>
          <div className="ticket-label floor-label"><span>Price floor</span>{hero && <span>Est. premium per token</span>}</div>
          <div className="floor-list">{tenorOptions.map((s) => { const distance = spotReal ? (tok(s.strike) - spotReal) / spotReal : null; const floorEstimate = hero && referenceReady && spot > 0n && qty > 0n ? quotePremium(assetId, qty, s.strike, spot, Math.max(s.expiryTs - now, 60)) : null; return <button key={s.seriesId} className={"strike-option" + (selected?.seriesId === s.seriesId ? " active" : "")} aria-pressed={selected?.seriesId === s.seriesId} onClick={() => setSeriesId(s.seriesId)}><strong className="mono">{fmtPrice(s.strike)}</strong><span className="floor-distance">{distance == null ? "Reference unavailable" : Math.abs(distance * 100).toFixed(1) + "% " + (distance >= 0 ? "above" : "below") + " reference"}</span>{floorEstimate && <span className="floor-premium mono">{fmtOusd(tok(floorEstimate.premium) / quantity)}</span>}</button>; })}</div>
          {!selected && <div className="empty terms-loading" role="status" aria-busy={seriesLoading}>{seriesLoading ? <><span className="loading-shape" aria-hidden="true" /><span className="loading-shape" aria-hidden="true" />Loading contract terms…</> : seriesError ? "Couldn’t load contract terms. Try again." : "No expiry is open for purchase. Check again shortly."}{!seriesLoading && <button className="text-action" onClick={() => { setSeriesLoading(true); setSeriesRetry((n) => n + 1); }}>Try again</button>}</div>}
          {selected && seriesError && <p className="field-error">Terms could not refresh. Buying checks availability again.</p>}
          {!hero && <>          <div className="ticket-premium"><span>{hero ? "Total estimated premium" : "Estimated premium"}</span><strong className="mono">{est ? fmtOusd(tok(est.premium)) : "—"}</strong></div>{!hero && referenceRatio != null && <p className="disclosure">{fmtPct(referenceRatio)} of reference value</p>}
          <p className="disclosure">oUSD · Devnet test token, no monetary value</p></>}

          </fieldset>
        {!hero && checkout}
        </aside>
        <section className="protection-analysis" aria-label="Protection payout">
          <div className="mobile-payout-overview"><span>Maximum contract payout</span><strong className="mono">{selected && qty > 0n ? fmtOusd(tok(notional)) : "—"}</strong><p>Settlement reference below your floor: difference × covered quantity. At or above: zero.</p><button className="text-action" aria-expanded={explorePayout} aria-controls="payout-exploration" onClick={() => setExplorePayout(value => !value)}>{explorePayout ? "Close payout explorer −" : "Explore payouts +"}</button></div>
          <div id="payout-exploration" className={"card scenario-card payout-exploration" + (explorePayout || hero ? " is-expanded" : "")}><h2>{hero ? "Scenario · not a quote" : "Explore your payout"}</h2><p className="scenario-context">{scenarioPreset === "15% lower" ? "15% drop scenario" : "Hypothetical settlement scenario"}</p>
          {selected && est && qty > 0n ? <>
            {!hero && <div className="scenario-price-row"><label htmlFor="scenario-price">Price at settlement</label><input id="scenario-price" className="input mono" inputMode="decimal" autoComplete="off" aria-label="Scenario price in USD" value={scenarioText ?? scenarioPrice.toFixed(2)} onChange={e => setScenarioText(e.target.value)} onBlur={() => { const value = Number(scenarioText); if (scenarioText !== null && scenarioText.trim() && Number.isFinite(value)) { setScenario(Math.max(chartMin, Math.min(chartMax, value))); setScenarioPreset(null); } setScenarioText(null); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /><span className="faint">USD</span></div>}

            <div className="scenario-adjustment"><label className="scenario-slider"><span className="sr-only">Price at settlement</span><input aria-label="Price at settlement (illustrative scenario)" aria-valuetext={fmtUsd(scenarioPrice)} type="range" min={chartMin} max={chartMax} step="0.01" value={scenarioPrice} onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setScenario(Math.max(chartMin, Math.min(chartMax, scenarioPrice + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1)))); setScenarioPreset(null); setScenarioText(null); } }} onChange={(e) => { setScenario(Number(e.target.value)); setScenarioPreset(null); setScenarioText(null); }} /></label>
            <div className="scenario-presets">{["15% lower", "Current", "Floor", "Breakeven"].map(label => <button key={label} className="btn ghost sm" disabled={label === "Breakeven" && maxNet < 0} aria-pressed={scenarioPreset === label} onClick={() => { setScenarioPreset(label); setScenarioText(null); }}>{label === "Current" ? (hero ? "Now" : "Current reference") : label === "15% lower" ? (hero ? "−15%" : "15% drop") : label === "Breakeven" ? "Break-even" : label === "Floor" ? (hero ? "Floor" : "At floor") : label}</button>)}</div>
            </div>
            <ProtectionMechanism narrative={hero} hidePremium symbol={assetLabel} quantity={qty} floor={selected.strike} reference={toFixed(scenarioPrice)} premium={est.premium} />
          </> : <div className="empty"><strong>{qty <= 0n ? "Enter a valid quantity" : referenceStatus}</strong><p>Waiting for current pricing and contract terms.</p></div>}
          {hero && <div className="hero-total"><span>Total est. premium <strong className="mono">{est ? fmtOusd(tok(est.premium)) : "—"}</strong></span><span>Max payout <strong className="mono">{selected && qty > 0n ? fmtOusd(tok(notional)) : "—"}</strong></span></div>}
          </div>
        </section>
        {hero && checkout}
        <button className="mobile-position-details text-action" aria-expanded={showDetails} aria-controls="position-details" onClick={() => setShowDetails(value => !value)}>{showDetails ? "Close position details −" : "Position details +"}</button>
        {compact && <button className="btn primary compact-continue" disabled={!selected || !referenceReady || c.busy} aria-expanded={false} onClick={expandCheckout}>Continue</button>}
        <section id="position-details" hidden={compact} className={"protection-secondary" + (showDetails ? " is-expanded" : "")} aria-label="Additional protection details">
          {hero && <details className="hero-custom-price"><summary>Custom price</summary><div className="scenario-price-row"><label htmlFor="scenario-price">Price at settlement</label><input id="scenario-price" className="input mono" inputMode="decimal" autoComplete="off" aria-label="Scenario price in USD" value={scenarioText ?? scenarioPrice.toFixed(2)} onChange={e => setScenarioText(e.target.value)} onBlur={() => { const value = Number(scenarioText); if (scenarioText !== null && scenarioText.trim() && Number.isFinite(value)) { setScenario(Math.max(chartMin, Math.min(chartMax, value))); setScenarioPreset(null); } setScenarioText(null); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /><span className="faint">USD</span></div></details>}
          <details className="card protection-details"><summary>Holdings</summary><h3>Check your token holdings</h3><p>Token ownership is not required to open a position.</p><HoldingsCard onProtect={(id, amount) => { setAssetId(id); setQtyStr(String(amount)); setSeriesId(null); setApproval(null); }} />
          {selected && est && qty > 0n && <><h3>Holdings + payout scenario</h3>
              <label htmlFor="scenario-holdings">Holdings in this scenario · {assetLabel}</label>
              <input id="scenario-holdings" className="input mono" inputMode="decimal" autoComplete="off" value={holdingsText} aria-invalid={!holdingsValid} aria-describedby="holdings-scenario-help" onChange={e => setHoldingsInputs(current => ({ ...current, [assetId]: e.target.value }))} />
              <p id="holdings-scenario-help" className="disclosure">{holdingsValid ? `Separate from the ${quantity} units being protected. Assumes the token price equals the hypothetical settlement reference.` : "Enter a holdings quantity of zero or more."}</p>
              {c.exposure[assetId] > 0 && <button className="text-action" onClick={() => setHoldingsInputs(current => ({ ...current, [assetId]: String(c.exposure[assetId]) }))}>Use imported holdings</button>}
              <div className="kv"><span>Holdings value</span><strong className="mono">{outcome ? fmtUsd(tok(outcome.holdingsValue)) : "—"}</strong></div>
              <div className="kv"><span>Combined model value, after premium</span><strong className="mono">{outcome ? fmtUsd(tok(outcome.combinedModelValue)) : "—"}</strong></div>
              <p className="disclosure">Illustrative total: holdings + payout − premium, assuming 1 oUSD = $1. Not redeemable value.</p>
          </>}
          </details>
          <details className="card protection-details"><summary>Payout formula</summary><p>Quantity × max(floor − settlement reference, 0).</p><p>The chart shows contract payout minus premium only. It excludes changes in your token holdings.</p></details>
          <details className="card protection-details"><summary>Pricing & settlement</summary><p>{assetId === 0 ? "NVDAx token-market reference, not NVIDIA shares." : "Anthropic PreStocks token-market reference, not company valuation."}</p>{selected && <p>Expires {fmtClock(selected.expiryTs)}</p>}<h3>Settlement rules</h3>{selected && <div className="kv"><span>Early exercise closes</span><strong>{fmtClock(selected.exerciseCutoffTs)}</strong></div>}<div className="kv"><span>Protection reference</span><strong>{asset.benchmarkLabel}</strong></div><div className="kv"><span>Source</span><strong>{reference?.available ? referenceSourceLabel(reference.source) : "Checking…"}</strong></div><p>Early exercise uses a median of qualifying observations after your request. At expiry, the keeper uses the final 5-minute window. Missing references trigger the contract’s recovery or refund rules.</p><div className="kv"><span>Maximum payout</span><strong>{selected ? fmtOusd(tok(notional)) : "—"}</strong></div><p>Quantity × floor, reached if the settlement reference is zero. This amount is reserved onchain when protection is issued.</p>
          {est && <><h3>How pricing works</h3><p>Premium comparison assumes 1 oUSD = $1.</p><div className="kv"><span>Intrinsic value</span><strong>{fmtOusd(tok(intrinsicNow))}</strong></div><div className="kv"><span>Additional protection cost</span><strong>{fmtOusd(tok(additionalPremium))}</strong></div><div className="kv"><span>Premium / maximum payout</span><strong>{fmtPct(premiumPct)}</strong></div><div className="kv"><span>Maximum payout minus premium</span><strong>{fmtOusd(maxNet)}</strong></div><p>Some risk and operating components do not shrink with duration, so short expiries can cost proportionally more. Components below are basis points of maximum contractual payout.</p><div className="premium-basis-grid">{Object.entries(est.components).map(([name, value]) => <div key={name}><span>{({volatility:"Modelled put value",jumpEvent:"Jump and event risk",earlyExercise:"Early exercise",hedge:"Hedge assumption",executionFunding:"Execution and funding",ops:"Operations",capitalCost:"Capital cost",riskAllowance:"Risk allowance"} as Record<string,string>)[name] ?? name}</span><strong>{Number(value).toFixed(1)} bps</strong></div>)}</div></>}
          </details>
        </section>
      </div>}
      {!done && !embedded && <div className="mobile-buy-summary"><div><strong>{qty > 0n ? quantity : "—"} {assetLabel} · {selected ? fmtPrice(selected.strike) + " floor" : "No series"}</strong><span>{approved ? `Maximum premium ${fmtOusd(tok(approved.maxPremium))}` : `Estimated cost ${est ? fmtOusd(tok(est.premium)) : "—"}`}</span></div><button className="btn primary" disabled={primaryDisabled} aria-busy={c.busy} onClick={primaryAction}>{buyLabel}</button></div>}
    </div>
  );
}
