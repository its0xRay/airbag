import { useCallback, useEffect, useState } from "react";
import { VERIFIED_ASSETS } from "../data/assets";
import { fetchMarket, type Market } from "../data/marketData";
import { explorerUrl } from "../onchain/store";
import { OPTKET_PROGRAM_ID } from "../client/optketProgram";
import { fmtUsd } from "../format";

const NETWORK = /devnet/.test(import.meta.env.VITE_RPC_URL || "") ? "devnet" : "localnet";
const truncate = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;

type MarketState = Record<string, Market | null>;

/**
 * Home / landing view (PRD §13.1). Leads with the live, verified market data so
 * the first impression is "this is wired to real sources", then explains the
 * journey, the two coverage models, and the demo boundary.
 */
export default function Landing({ onLaunch }: { onLaunch: (tab: "onchain" | "protect" | "compare") => void }) {
  const [markets, setMarkets] = useState<MarketState>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const entries = await Promise.all(
        VERIFIED_ASSETS.map(async (a) => [a.key, await fetchMarket(a.mint).catch(() => null)] as const),
      );
      const next = Object.fromEntries(entries) as MarketState;
      setMarkets(next);
      setFailed(Object.values(next).every((m) => !m?.available));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="lp">
      {/* ---------------- hero ---------------- */}
      <section className="lp-hero">
        <span className="lp-eyebrow">
          <span className="lp-dot" aria-hidden="true" />
          Live on Solana {NETWORK}
        </span>

        <h1 className="lp-title">
          Hold your stocks.<br />
          <span className="soft">Cap your downside.</span>
        </h1>

        <p className="lp-sub">
          Optket is put-style downside protection for tokenized equities. Pick an asset, a
          quantity, and a strike — pay one premium and your tokens never leave your wallet.
          Protection settles onchain against live price references.
        </p>

        <div className="lp-cta-row">
          <button className="btn primary lg" onClick={() => onLaunch("onchain")}>
            Launch the demo <span className="arrow" aria-hidden="true">→</span>
          </button>
          <button className="btn lg" onClick={() => onLaunch("protect")}>
            Explore the simulator
          </button>
        </div>

        <div className="lp-meta">
          <span>
            Program{" "}
            <a
              className="mono"
              href={explorerUrl("address", OPTKET_PROGRAM_ID.toBase58())}
              target="_blank"
              rel="noreferrer"
            >
              {truncate(OPTKET_PROGRAM_ID.toBase58(), 6)} ↗
            </a>
          </span>
          <span>Demo tokens · no redemption promise</span>
          <span>No wallet extension needed</span>
        </div>
      </section>

      {/* ---------------- live market proof ---------------- */}
      <section className="lp-section">
        <div className="lp-section-head">
          <div className="lp-kicker">Verified assets</div>
          <h2 className="lp-h2">Real mints. Live prices.</h2>
          <p className="lp-lede">
            Both assets are verified Token-2022 mints on Solana mainnet, priced from the
            Jupiter Price API. These numbers are fetched live right now — not mocked.
          </p>
        </div>

        {failed && !loading ? (
          <div className="card">
            <div className="callout warn">
              Live prices are unavailable — the market service isn’t reachable from here.
              The rest of the demo still works.
            </div>
            <button className="btn sm" style={{ marginTop: 12 }} onClick={load}>
              Retry
            </button>
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
                    <div>
                      <div className="lp-sym">{a.symbol}</div>
                      <div className="lp-live-name">{a.name}</div>
                    </div>
                    <span className={"pill " + (ready ? "green" : "gray")}>
                      {ready ? "live" : loading ? "loading" : "unavailable"}
                    </span>
                  </div>

                  {ready ? (
                    <>
                      <div className="lp-price-row">
                        <span className="lp-price mono">{fmtUsd(token!)}</span>
                        {m?.priceChange24h != null && (
                          <span className={"lp-delta " + (m.priceChange24h >= 0 ? "pos" : "neg")}>
                            {m.priceChange24h >= 0 ? "+" : ""}
                            {m.priceChange24h.toFixed(2)}% 24h
                          </span>
                        )}
                      </div>
                      <div className="lp-live-rows">
                        <div className="kv">
                          <span className="k">{equity ? "NVDA stock benchmark" : "Issuer mark"}</span>
                          <span className="v mono">{bench != null ? fmtUsd(bench) : "—"}</span>
                        </div>
                        <div className="kv">
                          <span className="k">Token vs benchmark</span>
                          <span className={"v mono " + (basis != null && basis < 0 ? "neg" : "pos")}>
                            {basis != null ? `${basis >= 0 ? "+" : ""}${(basis * 100).toFixed(2)}%` : "—"}
                          </span>
                        </div>
                        <div className="kv">
                          <span className="k">Mint · {a.program}</span>
                          <span className="v mono" style={{ fontSize: 11.5 }}>
                            <a href={`https://solscan.io/token/${a.mint}`} target="_blank" rel="noreferrer">
                              {truncate(a.mint, 5)} ↗
                            </a>
                          </span>
                        </div>
                        <div className="kv">
                          <span className="k">Scaled-balance multiplier</span>
                          <span className="v mono">{(m?.scaledMultiplier ?? 1).toFixed(8)}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div aria-busy="true" aria-label={`Loading ${a.symbol} market data`}>
                      <div className="lp-skel price" />
                      <div className="lp-skel line" />
                      <div className="lp-skel line" />
                      <div className="lp-skel line short" />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <div className="lp-note">
          <p className="disclosure">
            Protection on the equity token references the <strong>underlying stock benchmark</strong>,
            so it excludes the token-market basis shown above.
          </p>
          <button className="btn ghost sm" onClick={() => onLaunch("compare")}>
            See the full comparison
          </button>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section className="lp-section">
        <div className="lp-section-head">
          <div className="lp-kicker">How it works</div>
          <h2 className="lp-h2">Four steps, start to settlement.</h2>
        </div>
        <div className="lp-grid four">
          {[
            ["Choose your cover", "Pick an asset, the quantity to protect, and one of two published strikes for the weekly expiry."],
            ["Buy protection", "The quote service signs your premium; the program verifies that signature onchain and reserves collateral before issuing the contract."],
            ["Hold or exercise", "Your tokens stay in your wallet. Exercise early in full or in part, any time before the cutoff."],
            ["Get settled", "A keeper settles against a live reference — Pyth for the stock benchmark, a Jupiter median for the token market — and pays intrinsic value."],
          ].map(([title, body], i) => (
            <article className="lp-step" key={title}>
              <div className="lp-step-n" aria-hidden="true">{i + 1}</div>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- coverage models ---------------- */}
      <section className="lp-section">
        <div className="lp-section-head">
          <div className="lp-kicker">Coverage models</div>
          <h2 className="lp-h2">Two assets, two different references.</h2>
          <p className="lp-lede">
            What a contract pays on is the most important thing to understand before you buy,
            so Optket states it up front on every screen.
          </p>
        </div>
        <div className="lp-grid two">
          <article className="lp-model">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>Public-equity token</h3>
              <span className="pill blue">NVDAx</span>
            </div>
            <p className="lp-model-ref">
              Protects against a fall in the <strong>underlying listed-stock benchmark</strong>,
              observed from an oracle — not an exchange closing print. Quantities use verified
              share-equivalents via the Token-2022 scaled-balance multiplier. Token-market
              discounts are excluded.
            </p>
          </article>
          <article className="lp-model">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>PreStocks token</h3>
              <span className="pill amber">ANTHROPIC</span>
            </div>
            <p className="lp-model-ref">
              Protects against a fall in a <strong>specified token-market reference</strong>:
              the median of qualifying Jupiter observations across a fixed window. This is an
              issuer mark for a private company — not an independent public benchmark, and not
              an executable price.
            </p>
          </article>
        </div>
      </section>

      {/* ---------------- what's real / what's demo ---------------- */}
      <section className="lp-section">
        <div className="lp-section-head">
          <div className="lp-kicker">Straight answers</div>
          <h2 className="lp-h2">What’s real, and what’s a demo.</h2>
        </div>
        <div className="lp-grid four">
          {[
            ["real", "Real assets", "Verified Token-2022 mints on mainnet, with live Jupiter prices and the real scaled-balance multiplier applied."],
            ["real", "Real onchain", `The program is deployed and executing on ${NETWORK}. Purchases, exercises and settlements are real transactions you can open in the explorer.`],
            ["demo", "Demo collateral", "Premiums and payouts use free demo tokens with no redemption promise. The program rejects real USDC by design."],
            ["demo", "No hedging", "Underwriting economics are modelled, not executed. Hedge access is disclosed as unavailable rather than assumed."],
          ].map(([kind, title, body]) => (
            <div className="lp-trust" key={title}>
              <h3>
                <span className={"lp-trust-dot " + kind} aria-hidden="true" />
                {title}
              </h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- closing cta ---------------- */}
      <section style={{ paddingTop: 44 }}>
        <div className="lp-close">
          <h2 className="lp-h2">Try the full lifecycle in about a minute.</h2>
          <p className="lp-lede">
            Connecting creates a throwaway burner wallet in your browser and funds it from a
            capped trial budget — no extension, no seed phrase, no real funds.
          </p>
          <div className="lp-cta-row">
            <button className="btn primary lg" onClick={() => onLaunch("onchain")}>
              Launch the demo <span className="arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
