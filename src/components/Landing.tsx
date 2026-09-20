import { useCallback, useEffect, useMemo, useState } from "react";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchMarket, fetchQuoteReference, type Market, type QuoteReference } from "../data/marketData";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import { fetchJson, normalizeServiceUrl } from "../serviceUrl";
import { quotePremium, toFixed } from "../engine";
import { fmtClock, fmtDuration, fmtPrice, fmtUsd } from "../format";

const NETWORK = /devnet/.test(import.meta.env.VITE_RPC_URL || "") ? "devnet" : "localnet";
const SVC = normalizeServiceUrl(import.meta.env.VITE_QUOTE_SVC);
const truncate = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;
const tok = (v: bigint) => Number(v) / 1e6;

type MarketState = Record<string, Market | null>;
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

/** Public product orientation. Every price and contract term is loaded from the
 * same live services as the application; unavailable values remain unavailable. */
export default function Landing({ onLaunch }: { onLaunch: (tab: AppTab) => void }) {
  const [markets, setMarkets] = useState<MarketState>({});
  const [series, setSeries] = useState<PublicSeries[]>([]);
  const [nvdaReference, setNvdaReference] = useState<QuoteReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [entries, published, reference] = await Promise.all([
        Promise.all(
          VERIFIED_ASSETS.map(async (a) => [a.key, await fetchMarket(a.mint).catch(() => null)] as const),
        ),
        fetchPublicSeries().catch(() => []),
        fetchQuoteReference(0).catch(() => null),
      ]);
      const next = Object.fromEntries(entries) as MarketState;
      setMarkets(next);
      setSeries(published);
      setNvdaReference(reference);
      setFailed(Object.values(next).every((m) => !m?.available));
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

  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const heroSeries = useMemo(() => {
    const available = series
      .filter((s) => s.assetId === 0 && s.purchaseCutoffTs > now)
      .sort((a, b) => Number(a.shortDated) - Number(b.shortDated) || a.expiryTs - b.expiryTs);
    return available[0] ?? null;
  }, [series, now]);
  const heroPremium = heroSeries && nvdaReference
    ? quotePremium(0, toFixed(1), heroSeries.strike, toFixed(nvdaReference.price), Math.max(heroSeries.expiryTs - now, 60))
    : null;

  return (
    <main className="lp">
      <section className="lp-hero" id="product">
        <div className="lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-dot" aria-hidden="true" />
              Live on Solana {NETWORK}
            </span>

            <h1 className="lp-title">
              Protect the downside.<br />
              <span className="soft">Keep the upside.</span>
            </h1>

            <p className="lp-sub">
              Fixed-cost protection for tokenized stocks and pre-IPO assets. Choose a price
              floor, pay one premium, and keep your exposure.
            </p>

            <div className="lp-cta-row">
              <button className="btn primary lg" onClick={() => onLaunch("protect")}>
                Protect NVDAx <span className="arrow" aria-hidden="true">→</span>
              </button>
              <a className="btn lg" href="#how-it-works">See how it works</a>
            </div>

            <div className="lp-meta" aria-label="Demo status">
              <span>Solana {NETWORK}</span>
              <span>Live market references</span>
              <span className="demo-label">oUSD <small>demo · no real value</small></span>
            </div>
          </div>

          <aside className="lp-protection" aria-label="Live NVDAx protection preview">
            <div className="lp-protection-head">
              <div>
                <div className="lp-kicker">Live protection preview</div>
                <div className="lp-protection-asset">NVDAx</div>
                <div className="lp-live-name">NVIDIA xStock</div>
              </div>
              <span className={"pill " + (nvdaReference ? "green" : "amber")}>
                {nvdaReference ? "reference live" : loading ? "checking reference" : "reference unavailable"}
              </span>
            </div>

            <div className="lp-protection-price">
              <span className="stat-label">Protection reference</span>
              <strong className="mono">{nvdaReference ? fmtUsd(nvdaReference.price) : "—"}</strong>
              <span className="faint">
                {nvdaReference?.source || "A fresh qualifying benchmark is required for a quote."}
              </span>
            </div>

            <div className="lp-protection-terms">
              <div><span>Price floor</span><strong className="mono">{heroSeries ? fmtPrice(heroSeries.strike) : "—"}</strong></div>
              <div><span>Protected</span><strong className="mono">1 NVDAx</strong></div>
              <div><span>Expiry</span><strong className="mono">{heroSeries ? fmtClock(heroSeries.expiryTs) : "—"}</strong></div>
              <div><span>Est. premium</span><strong className="mono">{heroPremium ? `${tok(heroPremium.premium).toFixed(2)} oUSD` : "—"}</strong></div>
            </div>

            {heroSeries && (
              <div className="lp-protection-foot">
                <span>{heroSeries.shortDated ? "Short-dated demo series" : "Weekly series"}</span>
                <span className="mono">{fmtDuration(heroSeries.expiryTs - now)} remaining</span>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="lp-section" id="why-protect">
        <div className="lp-section-head">
          <div className="lp-kicker">Why protect?</div>
          <h2 className="lp-h2">Stay invested without leaving the downside open.</h2>
          <p className="lp-lede">
            Selling removes exposure. Shorting introduces margin and liquidation risk. Optket
            adds a defined price floor for one fixed upfront cost.
          </p>
        </div>
        <div className="lp-grid four">
          {[
            ["Keep your exposure", "Optket does not custody or escrow the underlying token."],
            ["Know the cost", "Pay one fixed premium upfront. The buyer has no ongoing margin."],
            ["Retain the upside", "Protection does not create an offsetting short position."],
            ["No buyer liquidation", "The protection buyer cannot be liquidated for market moves."],
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
            ["Exercise or settle", "A qualifying live reference determines the onchain payout."],
          ].map(([title, body], i) => (
            <article className="lp-step" key={title}>
              <div className="lp-step-n" aria-hidden="true">{i + 1}</div><h3>{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="onchain-proof">
        <div className="lp-section-head">
          <div className="lp-kicker">Built on Solana</div>
          <h2 className="lp-h2">The protection lifecycle is onchain.</h2>
          <p className="lp-lede">
            Purchase, collateral reservation, exercise, and settlement are recorded by the
            deployed program—not a local activity feed.
          </p>
        </div>
        <div className="lp-chain-flow" aria-label="Onchain protection lifecycle">
          {[
            ["01", "Signed quote"], ["02", "Onchain purchase"], ["03", "Protection contract"],
            ["04", "Exercise request"], ["05", "Keeper settlement"], ["06", "oUSD payout"],
          ].map(([number, label], i) => (
            <div className="lp-chain-step" key={label}>
              <span className="mono">{number}</span><strong>{label}</strong>
              {i < 5 && <span className="lp-chain-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div>
        <a className="lp-program-link" href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
          View deployed program <span className="mono">{truncate(OPTKET_PROGRAM_ID.toBase58(), 6)}</span> ↗
        </a>
      </section>

      <section className="lp-section" id="assets">
        <div className="lp-section-head">
          <div className="lp-kicker">Supported assets</div>
          <h2 className="lp-h2">Two markets. Two reference models.</h2>
          <p className="lp-lede">
            NVDAx protection follows the underlying listed-stock benchmark. ANTHROPIC follows
            its 24/7 PreStocks token market. The distinction is shown before purchase.
          </p>
        </div>

        {failed && !loading ? (
          <div className="card">
            <div className="callout warn" role="alert">
              Market data is temporarily unavailable. New purchases remain disabled until a fresh reference returns.
            </div>
            <button className="btn sm" style={{ marginTop: 12 }} onClick={load}>Retry market data</button>
          </div>
        ) : (
          <div className="lp-grid two">
            {VERIFIED_ASSETS.map((a) => {
              const m = markets[a.key];
              const ready = !!m?.available;
              const token = m?.usdPrice ?? null;
              const bench = m?.benchmark ?? null;
              const basis = token != null && bench ? (token - bench) / bench : null;
              const equity = a.kind === "EquityToken";
              return (
                <article className="lp-live" key={a.key}>
                  <div className="lp-live-head">
                    <div><div className="lp-sym">{a.symbol}</div><div className="lp-live-name">{a.name}</div></div>
                    <span className={"pill " + (ready ? "green" : "gray")}>
                      {ready ? "market live" : loading ? "loading" : "unavailable"}
                    </span>
                  </div>
                  {ready ? (
                    <>
                      <div className="lp-price-row">
                        <span className="lp-price mono">{fmtUsd(token!)}</span>
                        {m?.priceChange24h != null && (
                          <span className={"lp-delta " + (m.priceChange24h >= 0 ? "pos" : "neg")}>
                            {m.priceChange24h >= 0 ? "+" : ""}{m.priceChange24h.toFixed(2)}% 24h
                          </span>
                        )}
                      </div>
                      <div className="lp-live-rows">
                        <div className="kv"><span className="k">{equity ? "NVDA stock benchmark" : "Issuer mark"}</span><span className="v mono">{bench != null ? fmtUsd(bench) : "—"}</span></div>
                        <div className="kv"><span className="k">Token vs benchmark</span><span className={"v mono " + (basis != null && basis < 0 ? "neg" : "pos")}>{basis != null ? `${basis >= 0 ? "+" : ""}${(basis * 100).toFixed(2)}%` : "—"}</span></div>
                        <div className="kv"><span className="k">Protection references</span><span className="v">{equity ? "Underlying benchmark" : "Jupiter token median"}</span></div>
                        <div className="kv"><span className="k">Mint · {a.program}</span><span className="v mono"><a href={`https://solscan.io/token/${a.mint}`} target="_blank" rel="noreferrer">{truncate(a.mint, 5)} ↗</a></span></div>
                      </div>
                    </>
                  ) : (
                    <div aria-busy="true" aria-label={`Loading ${a.symbol} market data`}>
                      <div className="lp-skel price" /><div className="lp-skel line" />
                      <div className="lp-skel line" /><div className="lp-skel line short" />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <div className="lp-note">
          <p className="disclosure">
            NVDAx protection excludes token-market discounts because it references the underlying
            stock benchmark. ANTHROPIC protection follows the token market itself.
          </p>
          <button className="btn ghost sm" onClick={() => onLaunch("compare")}>Compare the references</button>
        </div>
      </section>

      <section className="lp-section" id="demo-boundary">
        <div className="lp-section-head">
          <div className="lp-kicker">Straight answers</div>
          <h2 className="lp-h2">What’s real, and what’s a demo.</h2>
        </div>
        <div className="lp-grid four">
          {[
            ["real", "Live references", "Market data and qualifying settlement observations come from external live sources."],
            ["real", "Real onchain actions", `The program executes purchases, exercises, and settlements on ${NETWORK}.`],
            ["demo", "Demo oUSD", "Premiums and payouts use a demo token with no redemption value. Real USDC is rejected."],
            ["demo", "No live hedging", "Underwriting economics are modelled, not executed as market hedges."],
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
            ["calculator", "Calculator", "Explore floors, premiums, and hypothetical payout scenarios."],
            ["underwriter", "Underwriter", "Inspect collateral, reserves, premiums, payouts, and modelled costs."],
            ["history", "History", "Open the real Solana signatures behind each contract lifecycle."],
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
          <h2 className="lp-h2">Try the full lifecycle in about a minute.</h2>
          <p className="lp-lede">
            A browser-only demo wallet receives demo oUSD. Fees and rent are sponsored—no
            extension, seed phrase, or SOL required.
          </p>
          <div className="lp-cta-row">
            <button className="btn primary lg" onClick={() => onLaunch("protect")}>
              Try the demo <span className="arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
