import { useCallback, useEffect, useMemo, useState } from "react";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchMarket, fetchQuoteReference, type Market, type QuoteReference } from "../data/marketData";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import { fetchJson, normalizeServiceUrl } from "../serviceUrl";
import { quotePremium, toFixed } from "../engine";
import { fmtClock, fmtPrice, fmtUsd } from "../format";

const NETWORK = /devnet/.test(import.meta.env.VITE_RPC_URL || "") ? "devnet" : "localnet";
const SVC = normalizeServiceUrl(import.meta.env.VITE_QUOTE_SVC);
const truncate = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;
const tok = (v: bigint) => Number(v) / 1e6;

type MarketState = Record<string, Market | null>;
type ReferenceState = Record<number, QuoteReference | null>;
type AppTab = "protect" | "portfolio" | "compare" | "calculator" | "underwriter" | "history";

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
}: {
  onLaunch: (tab: AppTab, assetId?: number) => void;
}) {
  const [markets, setMarkets] = useState<MarketState>({});
  const [references, setReferences] = useState<ReferenceState>({});
  const [series, setSeries] = useState<PublicSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

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
        .sort((a, b) => Number(a.shortDated) - Number(b.shortDated) || a.expiryTs - b.expiryTs)[0] ?? null;
    }
    return out;
  }, [series, now]);

  const preferredAssetId = references[0]?.available ? 0 : references[1]?.available ? 1 : undefined;

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
              Fixed-cost downside protection for tokenized stocks and PreStocks. Choose a floor,
              pay one premium, and keep the asset.
            </p>

            <div className="lp-cta-row">
              <button className="btn primary lg" onClick={() => onLaunch("protect", preferredAssetId)}>
                Try the demo <span className="arrow" aria-hidden="true">→</span>
              </button>
              <a className="btn lg" href="#payout">How protection pays</a>
            </div>

            <div className="lp-meta" aria-label="Demo status">
              <span>Solana {NETWORK}</span>
              <span>External market references</span>
              <span className="demo-label">oUSD <small>demo · no real value</small></span>
            </div>
          </div>

          <aside className="lp-payoff" id="payout" aria-label="Contract payout formula">
            <div className="lp-kicker">Contract payout formula</div>
            <h2>Know the downside before you buy.</h2>
            <p>If the settlement reference finishes below your floor, Optket pays the difference.</p>

            <div className="lp-payoff-terms">
              <div><span>Protected</span><strong className="mono">1 NVDAx</strong></div>
              <div><span>Price floor</span><strong className="mono">$215.00</strong></div>
              <div><span>Settlement reference</span><strong className="mono">$200.00</strong></div>
            </div>
            <div className="lp-payoff-equation mono">($215 − $200) × 1</div>
            <div className="lp-payoff-result">
              <span>Payout</span>
              <strong className="mono">15.00 <small>demo oUSD</small></strong>
            </div>
            <div className="lp-payoff-foot">
              <span>Maximum payout</span><strong className="mono">215.00 demo oUSD</strong>
            </div>
            <p className="lp-payoff-note">Example values explain the contract formula. Current quote terms appear in the demo.</p>
          </aside>
        </div>
      </section>

      <section className="lp-section" id="availability">
        <div className="lp-section-head">
          <div className="lp-kicker">Available protection</div>
          <h2 className="lp-h2">Only fresh references produce executable quotes.</h2>
          <p className="lp-lede">
            NVDAx follows supported equity sessions. ANTHROPIC follows its 24/7 token market.
            Closed or stale references pause new purchases instead of reusing an old price.
          </p>
        </div>
        <div className="lp-grid two">
          {VERIFIED_ASSETS.map((asset, assetId) => {
            const reference = references[assetId] ?? null;
            const activeSeries = seriesByAsset[assetId];
            const premium = reference?.available && activeSeries
              ? quotePremium(assetId, toFixed(1), activeSeries.strike, toFixed(reference.price), Math.max(activeSeries.expiryTs - now, 60))
              : null;
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
                      <span className="faint">Executable reference</span>
                    </div>
                    <div className="lp-live-rows">
                      <div className="kv"><span className="k">Price floor</span><span className="v mono">{activeSeries ? fmtPrice(activeSeries.strike) : "No active series"}</span></div>
                      <div className="kv"><span className="k">Est. premium · 1 token</span><span className="v mono">{premium ? `${tok(premium.premium).toFixed(2)} oUSD` : "—"}</span></div>
                      <div className="kv"><span className="k">Expiry</span><span className="v mono">{activeSeries ? fmtClock(activeSeries.expiryTs) : "—"}</span></div>
                      <div className="kv"><span className="k">Source</span><span className="v mono">{reference.source}</span></div>
                    </div>
                    <button className="btn primary lp-card-action" onClick={() => onLaunch("protect", assetId)}>
                      Protect {asset.symbol} <span className="arrow" aria-hidden="true">→</span>
                    </button>
                  </>
                ) : reference ? (
                  <div className="lp-reference-state">
                    <strong>{isClosed ? "The underlying equity session is closed." : reference.reason}</strong>
                    {readOnlyBenchmark != null && (
                      <div className="kv"><span className="k">Latest market benchmark · read-only</span><span className="v mono">{fmtUsd(readOnlyBenchmark)}</span></div>
                    )}
                    {isClosed && reference.nextOpen && (
                      <div className="kv"><span className="k">Quotes resume</span><span className="v mono">{fmtClock(reference.nextOpen)}</span></div>
                    )}
                    <p>New purchases remain paused until a qualifying reference is available.</p>
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

      <section className="lp-section" id="why-protect">
        <div className="lp-section-head">
          <div className="lp-kicker">Why protect?</div>
          <h2 className="lp-h2">Stay invested without leaving the downside open.</h2>
        </div>
        <div className="lp-grid three">
          {[
            ["Fixed cost", "Pay one premium upfront. The buyer has no ongoing margin."],
            ["No buyer liquidation", "Market moves cannot liquidate the protection buyer."],
            ["Keep the token", "The underlying remains in your wallet and retains its upside."],
          ].map(([title, body]) => (
            <article className="lp-benefit" key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
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
            ["Exercise or settle", "A qualifying reference determines the onchain payout."],
          ].map(([title, body], i) => (
            <article className="lp-step" key={title}>
              <div className="lp-step-n" aria-hidden="true">{i + 1}</div><h3>{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="assets">
        <div className="lp-section-head">
          <div className="lp-kicker">What exactly is protected?</div>
          <h2 className="lp-h2">One protection primitive. Two reference models.</h2>
          <p className="lp-lede">
            The reference determines the risk the contract covers. Optket makes that distinction
            explicit before purchase.
          </p>
        </div>

        {failed && !loading ? (
          <div className="card">
            <div className="callout warn" role="alert">Market data could not be loaded.</div>
            <button className="btn sm lp-retry" onClick={load}>Retry market data</button>
          </div>
        ) : (
          <div className="lp-reference-table-wrap">
            <table className="lp-reference-table">
              <thead><tr><th scope="col">Protection detail</th><th scope="col">NVDAx</th><th scope="col">ANTHROPIC</th></tr></thead>
              <tbody>
                <tr><th scope="row">Token</th><td>NVIDIA xStock</td><td>Anthropic PreStocks</td></tr>
                <tr>
                  <th scope="row">Current token market</th>
                  <td className="mono">{markets.nvdax?.usdPrice != null ? fmtUsd(markets.nvdax.usdPrice) : loading ? "Checking…" : "Unavailable"}</td>
                  <td className="mono">{markets.anthropic?.usdPrice != null ? fmtUsd(markets.anthropic.usdPrice) : loading ? "Checking…" : "Unavailable"}</td>
                </tr>
                <tr><th scope="row">Protection reference</th><td>NVIDIA stock benchmark</td><td>Tradable ANTHROPIC token price</td></tr>
                <tr><th scope="row">Quote availability</th><td>{statusLabel(references[0] ?? null, loading)}</td><td>{statusLabel(references[1] ?? null, loading)}</td></tr>
                <tr><th scope="row">Market hours</th><td>Supported equity sessions</td><td>24/7 token market</td></tr>
                <tr><th scope="row">Data path</th><td>Pyth benchmark with disclosed real fallback</td><td>Jupiter token observations</td></tr>
                <tr><th scope="row">Token depeg covered?</th><td>No</td><td>Yes, subject to reference rules</td></tr>
                <tr>
                  <th scope="row">Verified mint</th>
                  <td><a className="mono" href={`https://solscan.io/token/${VERIFIED_ASSETS[0].mint}`} target="_blank" rel="noreferrer">{truncate(VERIFIED_ASSETS[0].mint, 5)} ↗</a></td>
                  <td><a className="mono" href={`https://solscan.io/token/${VERIFIED_ASSETS[1].mint}`} target="_blank" rel="noreferrer">{truncate(VERIFIED_ASSETS[1].mint, 5)} ↗</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="lp-note">
          <p className="disclosure">NVDAx token-market discounts are excluded. ANTHROPIC protection follows the token market itself.</p>
          <button className="btn ghost sm" onClick={() => onLaunch("compare")}>Compare current references</button>
        </div>
      </section>

      <section className="lp-section" id="onchain-proof">
        <div className="lp-section-head">
          <div className="lp-kicker">Protocol proof</div>
          <h2 className="lp-h2">The lifecycle is enforced, not simulated.</h2>
          <p className="lp-lede">Program state, collateral reservations, exercise requests, and settlements are recorded on Solana devnet.</p>
        </div>
        <div className="lp-grid four">
          {[
            ["Onchain program", `Deployed on Solana ${NETWORK}.`],
            ["Collateral", "Maximum contractual payout is reserved when protection is issued."],
            ["Settlement", "A fresh qualifying reference is required before payout."],
            ["Exercise", "Partial or full exercise is recorded onchain."],
          ].map(([title, body]) => (
            <article className="lp-proof" key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
        <div className="lp-proof-actions">
          <a className="lp-program-link" href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            View deployed program <span className="mono">{truncate(OPTKET_PROGRAM_ID.toBase58(), 6)}</span> ↗
          </a>
          <button className="btn ghost sm" onClick={() => onLaunch("history")}>Open transaction history</button>
        </div>
      </section>

      <section className="lp-section" id="demo-boundary">
        <div className="lp-section-head">
          <div className="lp-kicker">Straight answers</div>
          <h2 className="lp-h2">What’s real, and what’s a demo.</h2>
        </div>
        <div className="lp-grid four">
          {[
            ["real", "External references", "Market data and qualifying settlement observations come from external sources."],
            ["real", "Real onchain actions", `Purchases, exercises, and settlements execute on ${NETWORK}.`],
            ["demo", "Demo oUSD", "Premiums and payouts use a demo token with no redemption value. Real USDC is rejected."],
            ["demo", "No executed hedging", "Underwriting costs are modelled; market hedges are not executed."],
          ].map(([kind, title, body]) => (
            <article className="lp-trust" key={title}>
              <h3><span className={"lp-trust-dot " + kind} aria-hidden="true" />{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="product-depth">
        <div className="lp-section-head">
          <div className="lp-kicker">Product depth</div>
          <h2 className="lp-h2">Protection is the front door. The full workflow is already here.</h2>
        </div>
        <div className="lp-grid three">
          {[
            ["portfolio", "Portfolio", "Track active protection, pending exercises, holdings, and renewals."],
            ["compare", "Compare", "See token prices, benchmark basis, and exactly what each contract covers."],
            ["calculator", "Calculator", "Explore floors, premiums, and payout scenarios."],
            ["underwriter", "Underwriter", "Inspect collateral, reserves, premiums, payouts, and modelled costs."],
            ["history", "History", "Open the Solana signatures behind each contract lifecycle."],
          ].map(([tab, title, body]) => (
            <button className="lp-depth" key={tab} onClick={() => onLaunch(tab as AppTab)}>
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
            <button className="btn primary lg" onClick={() => onLaunch("protect", preferredAssetId)}>
              Try the demo <span className="arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
