import { useCallback, useEffect, useMemo, useState } from "react";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchMarket, fetchQuoteReference, referenceSourceLabel, type Market, type QuoteReference } from "../data/marketData";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import { fetchJson, normalizeServiceUrl } from "../serviceUrl";
import { payout, quotePremium, toFixed } from "../engine";
import { fmtAge, fmtClock, fmtPrice, fmtUsd } from "../format";
import type { ProtectDraft } from "../App";

const NETWORK = /devnet/.test(import.meta.env.VITE_RPC_URL || "") ? "devnet" : "localnet";
const SVC = normalizeServiceUrl(import.meta.env.VITE_QUOTE_SVC);
const truncate = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;
const tok = (v: bigint) => Number(v) / 1e6;

type MarketState = Record<string, Market | null>;
type ReferenceState = Record<number, QuoteReference | null>;
type AppTab = "protect" | "portfolio" | "compare" | "underwriter" | "history";
const LANDING_ASSET_ORDER = [1, 0] as const;

interface PublicSeries {
  assetId: number;
  seriesId: number;
  strike: bigint;
  expiryTs: number;
  purchaseCutoffTs: number;
  shortDated: boolean;
}

async function fetchPublicSeries(): Promise<PublicSeries[]> {
  const raw = await fetchJson<Array<Record<string, unknown>>>(`${SVC}/series/all`);
  return raw.map((s) => ({
    assetId: Number(s.assetId),
    seriesId: Number(s.seriesId),
    strike: BigInt(String(s.strike)),
    expiryTs: Number(s.expiryTs),
    purchaseCutoffTs: Number(s.purchaseCutoffTs),
    shortDated: !!s.shortDated,
  }));
}

function statusLabel(reference: QuoteReference | null, loading: boolean): string {
  if (!reference) return loading ? "Checking" : "Service unavailable";
  if (reference.available) return "Executable now";
  if (reference.status === "session_closed") return "Equity session closed";
  if (reference.status === "stale") return "Reference stale";
  return "Source unavailable";
}

/** Public product orientation. Executable values come from the same services
 * as the app; the payout card explains contract math and is never presented as
 * a current quote. */
export default function Landing({
  onLaunch,
  launching = false,
  launchStatus = "",
}: {
  onLaunch: (tab: AppTab, draft?: ProtectDraft) => void | Promise<void>;
  launching?: boolean;
  launchStatus?: string;
}) {
  const [markets, setMarkets] = useState<MarketState>({});
  const [references, setReferences] = useState<ReferenceState>({});
  const [series, setSeries] = useState<PublicSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [heroAssetId, setHeroAssetId] = useState(1);
  const [heroSeriesId, setHeroSeriesId] = useState<number | null>(null);
  const [heroQty, setHeroQty] = useState("1");
  const [heroSettlement, setHeroSettlement] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [entries, published, referenceEntries] = await Promise.all([
        Promise.all(
          VERIFIED_ASSETS.map(async (a) => [a.key, await fetchMarket(a.mint).catch(() => null)] as const),
        ),
        fetchPublicSeries().catch(() => []),
        Promise.all(
          VERIFIED_ASSETS.map(async (_, assetId) => [assetId, await fetchQuoteReference(assetId).catch(() => null)] as const),
        ),
      ]);
      const nextMarkets = Object.fromEntries(entries) as MarketState;
      setMarkets(nextMarkets);
      setSeries(published);
      setReferences(Object.fromEntries(referenceEntries) as ReferenceState);
      setFailed(Object.values(nextMarkets).every((m) => !m?.available));
      setNow(Math.floor(Date.now() / 1000));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    const t = setInterval(load, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [load]);

  const seriesByAsset = useMemo(() => {
    const out: Record<number, PublicSeries | null> = {};
    for (const assetId of VERIFIED_ASSETS.map((_, i) => i)) {
      out[assetId] = series
        .filter((s) => s.assetId === assetId && s.purchaseCutoffTs > now)
        .sort((a, b) => a.expiryTs - b.expiryTs || (b.strike > a.strike ? 1 : -1))[0] ?? null;
    }
    return out;
  }, [series, now]);

  const heroAsset = VERIFIED_ASSETS[heroAssetId];
  const heroReference = references[heroAssetId] ?? null;
  const heroOptions = series
    .filter((s) => s.assetId === heroAssetId && s.purchaseCutoffTs > now)
    .sort((a, b) => a.expiryTs - b.expiryTs || (b.strike > a.strike ? 1 : -1));
  const heroSeries = heroOptions.find((s) => s.seriesId === heroSeriesId) ?? heroOptions[0] ?? null;
  const heroQtyN = Number(heroQty) > 0 ? Number(heroQty) : 0;
  const heroSpot = heroReference?.available ? heroReference.price : null;
  const heroEstimate = heroSeries && heroSpot && heroQtyN > 0
    ? quotePremium(heroAssetId, toFixed(heroQtyN), heroSeries.strike, toFixed(heroSpot), Math.max(heroSeries.expiryTs - now, 60))
    : null;
  const heroSettlementN = Number(heroSettlement) > 0
    ? Number(heroSettlement)
    : heroSpot ?? (heroSeries ? tok(heroSeries.strike) : 0);
  const heroPayout = heroSeries && heroQtyN > 0
    ? payout(toFixed(heroQtyN), heroSeries.strike, toFixed(heroSettlementN))
    : 0n;
  const heroPremiumN = heroEstimate ? tok(heroEstimate.premium) : 0;
  const heroNet = tok(heroPayout) - heroPremiumN;
  const heroBreakeven = heroSeries && heroQtyN > 0
    ? Math.max(0, tok(heroSeries.strike) - heroPremiumN / heroQtyN)
    : 0;
  const chartSpot = heroSpot ?? (heroSeries ? tok(heroSeries.strike) : 1);
  const chartMin = Math.max(0, chartSpot * 0.6);
  const chartMax = chartSpot * 1.2;
  const chartPoints = heroSeries && heroEstimate && heroQtyN > 0
    ? Array.from({ length: 25 }, (_, i) => {
        const reference = chartMin + ((chartMax - chartMin) * i) / 24;
        const value = tok(payout(toFixed(heroQtyN), heroSeries.strike, toFixed(reference))) - heroPremiumN;
        return { reference, value };
      })
    : [];
  const chartMaxAbs = Math.max(1, ...chartPoints.map((p) => Math.abs(p.value)));
  const chartPolyline = chartPoints.map((p, i) => {
    const x = (i / Math.max(1, chartPoints.length - 1)) * 100;
    const y = 50 - (p.value / chartMaxAbs) * 42;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const chartX = (value: number) => Math.max(0, Math.min(100, ((value - chartMin) / Math.max(0.01, chartMax - chartMin)) * 100));
  const heroUnavailableLabel = heroReference && !heroReference.available
    ? heroReference.status === "session_closed" ? "Equity session closed" : heroReference.status === "stale" ? "Waiting for a fresh benchmark" : "Reference unavailable"
    : "Reference unavailable";

  return (
    <main className="lp">
      <section className="lp-hero" id="product">
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-dot" aria-hidden="true" />
              Built on Solana {NETWORK}
            </span>

            <h1 className="lp-title">
              Protect the downside.<br />
              <span className="soft">Keep the upside.</span>
            </h1>

            <p className="lp-sub">
              Downside protection for tokenized stocks and PreStocks—including assets without
              a traditional listed-options market. Choose a floor, pay one premium, and keep the token.
            </p>

            <div className="lp-cta-row">
              <button className="btn primary lg" disabled={launching} onClick={() => onLaunch("protect", { assetId: 1 })}>
                {launching ? launchStatus || "Preparing Devnet…" : "Start on Devnet"} <span className="arrow" aria-hidden="true">→</span>
              </button>
              <a className="btn lg" href="#how-it-works">How it works</a>
            </div>

            <div className="lp-meta" aria-label="Demo status">
              <span className="demo-label">oUSD <small>demo · no real value</small></span>
              <span>Fees and rent sponsored</span>
            </div>
          </div>

          <aside className="lp-payoff lp-builder" id="payout" aria-label="Interactive protection calculator">
            <div className="lp-builder-head">
              <div><div className="lp-kicker">Explore protection</div><h2>Set a floor. See the payoff.</h2></div>
            </div>

            <div className="lp-segmented" aria-label="Asset">
              {LANDING_ASSET_ORDER.map((id) => <button key={id} className={heroAssetId === id ? "active" : ""} onClick={() => { setHeroAssetId(id); setHeroSeriesId(null); setHeroSettlement(""); }}>{VERIFIED_ASSETS[id].symbol}</button>)}
            </div>

            <div className="lp-builder-inputs">
              <label className="field"><span className="lbl">Protected quantity</span><input className="input" type="text" inputMode="decimal" value={heroQty} onChange={(e) => setHeroQty(e.target.value)} /></label>
              <label className="field"><span className="lbl">Price floor</span><select className="input" value={heroSeries?.seriesId ?? ""} onChange={(e) => setHeroSeriesId(Number(e.target.value))}>{heroOptions.map((s) => <option key={s.seriesId} value={s.seriesId}>{fmtPrice(s.strike)} · {s.shortDated ? "short-dated Devnet" : "weekly"}</option>)}</select></label>
            </div>

            {loading && !heroSeries ? <div className="lp-builder-loading" aria-busy="true"><div className="lp-skel line" /><div className="lp-skel line short" /></div> : !heroSeries ? <div className="lp-reference-state"><strong>No purchasable series.</strong><p>The operator must publish a fresh series before protection can be quoted.</p></div> : (
              <>
                <label className="field lp-settlement"><span className="lbl">Hypothetical settlement reference</span><div className="lp-range-row"><input type="range" min={chartMin} max={chartMax} step={Math.max(0.01, chartSpot / 200)} value={heroSettlementN} onChange={(e) => setHeroSettlement(Number(e.target.value).toFixed(2))} /><input className="input mono" type="text" inputMode="decimal" value={heroSettlement || heroSettlementN.toFixed(2)} onChange={(e) => setHeroSettlement(e.target.value)} /></div></label>
                <div className="lp-mini-chart" aria-label="Payout minus premium across settlement prices">
                  {heroEstimate ? <svg viewBox="0 0 100 100" role="img"><title>Payout minus premium curve</title><line className="zero" x1="0" x2="100" y1="50" y2="50" /><line className="marker current" x1={chartX(chartSpot)} x2={chartX(chartSpot)} y1="6" y2="94" /><line className="marker floor" x1={chartX(tok(heroSeries.strike))} x2={chartX(tok(heroSeries.strike))} y1="6" y2="94" /><line className="marker breakeven" x1={chartX(heroBreakeven)} x2={chartX(heroBreakeven)} y1="6" y2="94" /><polyline points={chartPolyline} /></svg> : <div className="lp-chart-unavailable"><strong>{heroUnavailableLabel}</strong><span>A qualifying reference is needed to estimate the premium.</span></div>}
                  <span>Lower reference</span><span>Higher reference</span>
                </div>
                {heroEstimate && <div className="lp-chart-legend"><span className="current">Current</span><span className="floor">Floor</span><span className="breakeven">Breakeven</span></div>}
                <div className="lp-builder-results">
                  <div><span>Estimated premium</span><strong className="mono">{heroEstimate ? `${heroPremiumN.toFixed(2)} oUSD` : "Unavailable"}</strong></div>
                  <div><span>Payout at selected price</span><strong className="mono">{tok(heroPayout).toFixed(2)} oUSD</strong></div>
                  <div><span>Payout minus premium</span><strong className={"mono " + (heroNet >= 0 ? "pos" : "neg")}>{heroEstimate ? `${heroNet >= 0 ? "+" : ""}${heroNet.toFixed(2)} oUSD` : "—"}</strong></div>
                  <div><span>Breakeven reference</span><strong className="mono">{heroEstimate ? fmtUsd(heroBreakeven) : "—"}</strong></div>
                </div>
                <p className="lp-payoff-note">Estimated premium · binding quote locked for 60 seconds at purchase.</p>
                <button className="btn primary lp-card-action" disabled={launching || !heroEstimate || heroQtyN <= 0} onClick={() => onLaunch("protect", { assetId: heroAssetId, seriesId: heroSeries.seriesId, quantity: heroQtyN })}>{launching ? launchStatus || "Preparing Devnet…" : heroEstimate ? "Protect this position" : heroUnavailableLabel} {heroEstimate && <span className="arrow" aria-hidden="true">→</span>}</button>
                <div className="lp-builder-source"><span>{heroAsset.kind === "PreStocks" ? "Jupiter 5-minute token median" : "NVIDIA stock benchmark"}</span><span className="mono">{heroSpot ? fmtUsd(heroSpot) : statusLabel(heroReference, loading)}</span></div>
              </>
            )}
          </aside>
        </div>
      </section>

      <section className="lp-section lp-thesis" id="why-protect">
        <div className="lp-thesis-copy">
          <div className="lp-kicker">Why Optket</div>
          <h2 className="lp-display">Tokenized stocks are onchain. Their protection should be too.</h2>
          <p className="lp-lede">
            Protection settles beside the asset instead of inside a brokerage account.
          </p>
        </div>
        <div className="lp-thesis-points" aria-label="Why Optket belongs on Solana">
          {[
            ["Keep the token", "The protected asset stays in your wallet and keeps its upside."],
            ["Fixed cost", "Pay one premium upfront. There is no buyer margin or liquidation."],
            ["Solana-native lifecycle", "Purchase, collateral reservation, exercise, and payout are recorded onchain."],
          ].map(([title, body]) => (
            <article className="lp-thesis-point" key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="availability">
        <div className="lp-section-head">
          <div className="lp-kicker">Available protection</div>
          <h2 className="lp-h2">Choose the reference that represents the risk.</h2>
          <p className="lp-lede">
            ANTHROPIC protection follows its 24/7 token market. NVDAx follows the NVIDIA stock
            benchmark during supported equity sessions. A qualifying reference is a fresh external
            observation that satisfies the contract’s source, timing, and validation rules.
          </p>
        </div>
        <div className="lp-grid two">
          {LANDING_ASSET_ORDER.map((assetId) => {
            const asset = VERIFIED_ASSETS[assetId];
            const reference = references[assetId] ?? null;
            const activeSeries = seriesByAsset[assetId];
            const premium = reference?.available && activeSeries
              ? quotePremium(assetId, toFixed(1), activeSeries.strike, toFixed(reference.price), Math.max(activeSeries.expiryTs - now, 60))
              : null;
            const baseLoadingBps = premium
              ? premium.components.earlyExercise
                + premium.components.hedge
                + premium.components.executionFunding
                + premium.components.ops
                + premium.components.riskAllowance
              : 0;
            const isClosed = reference && !reference.available && reference.status === "session_closed";
            const market = markets[asset.key];
            const readOnlyBenchmark = asset.kind === "EquityToken" ? market?.benchmark : market?.usdPrice;

            return (
              <article className="lp-availability" key={asset.key}>
                <div className="lp-live-head">
                  <div><div className="lp-sym">{asset.symbol}</div><div className="lp-live-name">{asset.name}</div></div>
                  <span className={"pill " + (reference?.available ? "green" : isClosed ? "gray" : "amber")}>
                    {statusLabel(reference, loading)}
                  </span>
                </div>

                {reference?.available ? (
                  <>
                    <div className="lp-price-row">
                      <span className="lp-price mono">{fmtUsd(reference.price)}</span>
                      <span className="faint">{asset.kind === "PreStocks" ? "Executable token reference" : "Executable stock benchmark"}</span>
                    </div>
                    <div className="lp-live-rows">
                      <div className="kv"><span className="k">Price floor</span><span className="v mono">{activeSeries ? fmtPrice(activeSeries.strike) : "No active series"}</span></div>
                      <div className="kv"><span className="k">Estimated premium · 1 token</span><span className="v mono">{premium ? `${tok(premium.premium).toFixed(2)} oUSD` : "—"}</span></div>
                      <div className="kv"><span className="k">Expiry · your local time</span><span className="v mono">{activeSeries ? fmtClock(activeSeries.expiryTs) : "—"}</span></div>
                      <div className="kv"><span className="k">Source</span><span className="v">{referenceSourceLabel(reference.source)}</span></div>
                      {reference.observedAt != null && <div className="kv"><span className="k">Freshness</span><span className="v mono" title={new Date(reference.observedAt * 1000).toLocaleString()}>{fmtAge(reference.observedAt, now)}</span></div>}
                    </div>
                    <details className="lp-premium-basis">
                      <summary>See premium basis</summary>
                      <p>
                        The estimate combines option value and time-scaled costs with {Math.round(baseLoadingBps)} bps
                        of duration-independent operating and risk loadings. No separate minimum fee is applied.
                      </p>
                    </details>
                    <button className="btn primary lp-card-action" disabled={launching} onClick={() => onLaunch("protect", { assetId })}>
                      {launching ? launchStatus || "Preparing Devnet…" : `Protect ${asset.symbol}`} <span className="arrow" aria-hidden="true">→</span>
                    </button>
                  </>
                ) : reference ? (
                  <div className="lp-reference-state">
                    <strong>{isClosed ? "The underlying equity session is closed." : reference.reason}</strong>
                    {readOnlyBenchmark != null && (
                      <div className="kv"><span className="k">Latest stock benchmark · read-only</span><span className="v mono">{fmtUsd(readOnlyBenchmark)}</span></div>
                    )}
                    {isClosed && reference.nextOpen && (
                      <div className="kv"><span className="k">Quotes resume · your local time</span><span className="v mono">{fmtClock(reference.nextOpen)}</span></div>
                    )}
                    <p>Purchases resume with the next qualifying reference.</p>
                  </div>
                ) : loading ? (
                  <div aria-busy="true" aria-label={`Checking ${asset.symbol} quote availability`}>
                    <div className="lp-skel price" /><div className="lp-skel line" /><div className="lp-skel line short" />
                  </div>
                ) : (
                  <div className="lp-reference-state"><strong>Reference service unavailable.</strong><p>Try again before opening a new position.</p></div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="lp-section" id="how-it-works">
        <div className="lp-section-head">
          <div className="lp-kicker">How it works</div>
          <h2 className="lp-h2">Choose, pay, hold, settle.</h2>
        </div>
        <div className="lp-grid four">
          {[
            ["Choose your floor", "Select the asset, protected quantity, price floor, and expiry."],
            ["Pay one premium", "Review the exact cost before the signed quote is submitted."],
            ["Keep holding", "The underlying token never enters an Optket vault."],
            ["Exercise or settle", "The agreed market reference determines the onchain payout."],
          ].map(([title, body], i) => (
            <article className="lp-step" key={title}>
              <div className="lp-step-n" aria-hidden="true">{i + 1}</div><h3>{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="assets">
        <div className="lp-section-head">
          <div className="lp-kicker">What determines the payout?</div>
          <h2 className="lp-h2">Two assets. Two distinct market references.</h2>
          <p className="lp-lede">
            Each contract states which market it follows before you buy. That choice determines
            exactly which downside the protection covers.
          </p>
        </div>

        {failed && !loading ? (
          <div className="card">
            <div className="callout warn" role="alert">Market data could not be loaded.</div>
            <button className="btn sm lp-retry" onClick={load}>Retry market data</button>
          </div>
        ) : (
          <div className="lp-reference-cards">
            <article className="lp-reference-card">
              <div className="lp-reference-card-head">
                <div><span className="lp-reference-kind">PreStocks</span><h3>ANTHROPIC</h3></div>
                <span className="pill green">24/7 token market</span>
              </div>
              <p className="lp-reference-summary">Covers movements in the tradable token’s own market price.</p>
              <dl>
                <div><dt>Token market</dt><dd className="mono">{markets.anthropic?.usdPrice != null ? fmtUsd(markets.anthropic.usdPrice) : loading ? "Checking…" : "Unavailable"}</dd></div>
                <div><dt>Payout reference</dt><dd>Jupiter token observations</dd></div>
                <div><dt>Token-price downside</dt><dd>Covered</dd></div>
                <div><dt>Quote status</dt><dd>{statusLabel(references[1] ?? null, loading)}</dd></div>
              </dl>
            </article>
            <article className="lp-reference-card">
              <div className="lp-reference-card-head">
                <div><span className="lp-reference-kind">xStock</span><h3>NVDAx</h3></div>
                <span className="pill gray">Equity sessions</span>
              </div>
              <p className="lp-reference-summary">Covers the NVIDIA stock benchmark, not a discount in the xStock token market.</p>
              <dl>
                <div><dt>Token market</dt><dd className="mono">{markets.nvdax?.usdPrice != null ? fmtUsd(markets.nvdax.usdPrice) : loading ? "Checking…" : "Unavailable"}</dd></div>
                <div><dt>Stock benchmark</dt><dd className="mono">{markets.nvdax?.benchmark != null ? fmtUsd(markets.nvdax.benchmark) : loading ? "Checking…" : "Unavailable"}</dd></div>
                <div><dt>Payout reference</dt><dd>Pyth NVIDIA benchmark; stock-benchmark fallback only</dd></div>
                <div><dt>Quote status</dt><dd>{statusLabel(references[0] ?? null, loading)}</dd></div>
              </dl>
            </article>
          </div>
        )}
        <div className="lp-note">
          <p className="disclosure">The contract reference—not the token label—defines the protected risk.</p>
          <button className="btn ghost sm" onClick={() => onLaunch("compare")}>Compare current references</button>
        </div>
      </section>

      <section className="lp-section" id="onchain-proof">
        <div className="lp-section-head">
          <div className="lp-kicker">Built for the full lifecycle</div>
          <h2 className="lp-h2">Protection from purchase to payout.</h2>
          <p className="lp-lede">Underwriters supply per-asset collateral pools and earn premiums. Optket reserves each contract’s maximum payout before issuing protection.</p>
        </div>
        <div className="lp-proof-layout">
          <div className="lp-proof-list">
            {[
              ["Onchain program", `Deployed on Solana ${NETWORK}.`],
              ["Fully reserved", "The maximum contractual payout is locked against the position."],
              ["Flexible exercise", "Exercise all or part of the protected quantity before the cutoff."],
              ["Automated settlement", "A publisher-authorized reference keeper completes eligible exercises and expiries."],
            ].map(([title, body]) => (
              <article className="lp-proof-row" key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
          <div className="lp-faq" aria-label="Settlement questions">
            <div className="lp-kicker">Settlement, plainly</div>
            <details>
              <summary>Can I exercise before expiry?</summary>
              <p>Yes. Full and partial exercise are available before the exercise cutoff.</p>
            </details>
            <details>
              <summary>What is a qualifying reference?</summary>
              <p>A fresh external observation that satisfies the contract’s source, timing, and validation rules.</p>
            </details>
            <details>
              <summary>What if no valid reference exists?</summary>
              <p>The contract applies its disclosed failed-reference refund rule rather than inventing a settlement price. NVDAx does not promise weekend settlement.</p>
            </details>
            <details>
              <summary>What is oUSD?</summary>
              <p>oUSD is Optket’s Devnet settlement token. It has no redemption promise or real monetary value.</p>
            </details>
            <details>
              <summary>What if I sell the token?</summary>
              <p>The protection contract remains in your Devnet wallet because Optket never escrows or checks ownership of the underlying token.</p>
            </details>
            <details>
              <summary>Do I need to act at expiry?</summary>
              <p>No. The keeper settles remaining protected quantity automatically when a qualifying reference is available.</p>
            </details>
            <details>
              <summary>Who pays the payout?</summary>
              <p>The asset’s onchain pool pays from collateral reserved when the protection position was issued.</p>
            </details>
          </div>
        </div>
        <div className="lp-proof-actions">
          <a className="lp-program-link" href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            View deployed program <span className="mono">{truncate(OPTKET_PROGRAM_ID.toBase58(), 6)}</span> ↗
          </a>
          <button className="btn ghost sm" onClick={() => onLaunch("history")}>Open transaction history</button>
          <button className="btn ghost sm" onClick={() => onLaunch("underwriter")}>View underwriter economics</button>
        </div>
      </section>

      <section className="lp-section" id="demo-boundary">
        <div className="lp-section-head">
          <div className="lp-kicker">Devnet scope</div>
          <h2 className="lp-h2">Production flow. Test value.</h2>
        </div>
        <div className="lp-grid three">
          {[
            ["real", "Onchain lifecycle", `Purchases, collateral reservations, exercises, and settlements execute on ${NETWORK}.`],
            ["demo", "Demo oUSD", "Premiums and payouts use a test token with no redemption value."],
            ["demo", "Modelled pricing", "Pricing assumptions are disclosed; external hedges are not executed on Devnet."],
          ].map(([kind, title, body]) => (
            <article className="lp-trust" key={title}>
              <h3><span className={"lp-trust-dot " + kind} aria-hidden="true" />{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="product-depth">
        <div className="lp-section-head">
          <div className="lp-kicker">Explore Optket</div>
          <h2 className="lp-h2">Follow every position from quote to settlement.</h2>
        </div>
        <div className="lp-grid three">
          {[
            ["portfolio", "Positions", "Track active protection, pending exercises, holdings, and renewals."],
            ["compare", "Markets", "See token prices, stock benchmarks, and exactly what each contract covers."],
            ["underwriter", "Pools", "Inspect collateral, reserves, premiums, payouts, and modelled costs."],
            ["history", "Onchain", "Open the Solana signatures behind each contract lifecycle."],
          ].map(([tab, title, body], index) => (
            <button className={"lp-depth" + (index === 0 ? " feature" : "")} key={tab} onClick={() => onLaunch(tab as AppTab)}>
              <span><strong>{title}</strong><small>{body}</small></span>
              <span className="arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-close">
          <h2 className="lp-h2">Open a protection position in under a minute.</h2>
          <p className="lp-lede">The browser-only demo wallet receives demo oUSD. Fees and rent are sponsored—no extension, seed phrase, or SOL required.</p>
          <div className="lp-cta-row">
            <button className="btn primary lg" disabled={launching} onClick={() => onLaunch("protect", { assetId: 1 })}>
              {launching ? launchStatus || "Preparing Devnet…" : "Start on Devnet"} <span className="arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
