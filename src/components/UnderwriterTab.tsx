import { useChain } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { ASSUMPTIONS } from "../engine";
import { fmtUsd, fmtPct } from "../format";

const tok = (v: bigint) => Number(v) / 1e6;

/** Onchain pool solvency first; modelled operating economics second. */
export default function UnderwriterTab() {
  const c = useChain();
  const loading = !c.pools[0] && !c.pools[1];

  return (
    <>
      <div className="app-page-head">
        <div><div className="card-title">Protocol solvency</div><h1>Risk</h1><p>Collateral and realized activity come from Devnet pool accounts. Cost assumptions are modelled and are never presented as executed hedges.</p></div>
      </div>

      {loading && <div className="card empty">Reading pool accounts…</div>}

      <div className="risk-list">
        {VERIFIED_ASSETS.map((a, assetId) => {
          const p = c.pools[assetId];
          if (!p) return null;
          const m = ASSUMPTIONS[assetId];

          const premiums = tok(p.premiumReceipts);
          const payouts = tok(p.totalPayouts);
          const refunds = tok(p.totalRefunds);
          const realized = premiums - payouts - refunds;

          const available = tok(p.availableCapital);
          const reserved = tok(p.reserved);
          const total = available + reserved;
          const utilization = total > 0 ? reserved / total : 0;

          // modelled loadings against committed reserve
          const exec = (reserved * m.executionFundingBps) / 10_000;
          const ops = (reserved * m.opsBps) / 10_000;
          const capital = (reserved * m.capitalCostBps) / 10_000;
          const risk = (reserved * m.riskAllowanceBps) / 10_000;
          const hedgeCost = m.hedgeAvailable ? (reserved * m.hedgeCostBps) / 10_000 : 0;
          const modelledNet = realized - exec - ops - capital - risk - hedgeCost;

          return (
            <section className="risk-section" key={a.key}>
              <div className="risk-head">
                <div><span className="lp-reference-kind">{a.kind === "PreStocks" ? "PreStocks" : "xStock"}</span><h2>{a.symbol}</h2></div>
                <span className={"pill " + (m.hedgeAvailable ? "blue" : "gray")}>
                  {m.hedgeAvailable ? "external hedge path identified" : "no executable external hedge"}
                </span>
              </div>

              <div className="risk-metrics">
                <div><span>Available capital</span><strong className="mono">{fmtUsd(available, 0)}</strong></div>
                <div><span>Reserved collateral</span><strong className="mono">{fmtUsd(reserved, 0)}</strong></div>
                <div><span>Utilization</span><strong className="mono">{fmtPct(utilization)}</strong></div>
                <div><span>Pending exercise</span><strong className="mono">{fmtUsd(tok(p.pendingExercise), 0)}</strong></div>
              </div>
              <div className="bar" aria-label={`Pool utilization ${fmtPct(utilization)}`}><span style={{ width: fmtPct(utilization), background: "var(--blue)" }} /></div>

              <div className="risk-columns">
                <div><h3>Devnet activity since deployment</h3><div className="kv"><span className="k">Premium receipts</span><span className="v mono">{fmtUsd(premiums)}</span></div><div className="kv"><span className="k">Gross payouts</span><span className="v mono">{fmtUsd(payouts)}</span></div><div className="kv"><span className="k">Failed-reference refunds</span><span className="v mono">{fmtUsd(refunds)}</span></div><div className="kv"><span className="k">Realized net</span><span className={"v mono " + (realized >= 0 ? "pos" : "neg")}>{fmtUsd(realized)}</span></div></div>
                <div><h3>Modelled economics · v{m.version}</h3><div className="kv"><span className="k">Execution and funding</span><span className="v mono">−{fmtUsd(exec)}</span></div><div className="kv"><span className="k">Operating expense</span><span className="v mono">−{fmtUsd(ops)}</span></div><div className="kv"><span className="k">Capital opportunity cost</span><span className="v mono">−{fmtUsd(capital)}</span></div><div className="kv"><span className="k">Risk allowance</span><span className="v mono">−{fmtUsd(risk)}</span></div><div className="kv"><span className="k">Modelled hedge cost</span><span className="v mono">{m.hedgeAvailable ? `−${fmtUsd(hedgeCost)}` : "n/a"}</span></div><div className="kv"><span className="k">Modelled net after costs</span><span className={"v mono " + (modelledNet >= 0 ? "pos" : "neg")}>{fmtUsd(modelledNet)}</span></div></div>
              </div>
              <p className="disclosure">Stress scenario: a 20% reference decline could consume up to <span className="mono neg">{fmtUsd(reserved * 0.2, 0)}</span> of the currently reserved amount. This is analysis, not an executed market result.</p>
            </section>
          );
        })}
      </div>
    </>
  );
}
