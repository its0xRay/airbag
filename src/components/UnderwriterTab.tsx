import { useChain } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { ASSUMPTIONS } from "../engine";
import { fmtUsd, fmtPct } from "../format";

const tok = (v: bigint) => Number(v) / 1e6;

/**
 * Underwriter economics (PRD §17). Realized figures are read from the on-chain
 * Pool account; the cost lines are MODELLED from the documented assumptions and
 * labelled as such. Hedge access that isn't available is never modelled as
 * executable.
 */
export default function UnderwriterTab() {
  const c = useChain();
  const loading = !c.pools[0] && !c.pools[1];

  return (
    <>
      <div className="callout warn" style={{ marginBottom: 16 }}>
        Realized figures are read live from the on-chain pool accounts. Cost and hedge lines are
        <strong> modelled</strong> from versioned assumptions — not executed.
      </div>

      {loading && <div className="card empty">Reading pool accounts…</div>}

      <div className="grid cols-2">
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
          const hedge = m.hedgeAvailable ? -((reserved * m.hedgeCostBps) / 10_000) : 0;
          const netUnhedged = realized - exec - ops - capital - risk;
          const netHedged = m.hedgeAvailable ? netUnhedged + hedge : null;

          return (
            <div className="card" key={a.key}>
              <div className="between" style={{ marginBottom: 12 }}>
                <strong>{a.symbol}</strong>
                <span className={"pill " + (m.hedgeAvailable ? "green" : "amber")}>
                  {m.hedgeAvailable ? "hedge investigable" : "no executable hedge"}
                </span>
              </div>

              <div className="card-title">Realized — read from chain</div>
              <div className="kv"><span className="k">Premium receipts</span><span className="v mono">{fmtUsd(premiums)}</span></div>
              <div className="kv"><span className="k">Gross payouts</span><span className="v mono">{fmtUsd(payouts)}</span></div>
              <div className="kv"><span className="k">Refunds</span><span className="v mono">{fmtUsd(refunds)}</span></div>
              <div className="kv"><span className="k">Realized net</span><span className={"v mono " + (realized >= 0 ? "pos" : "neg")}>{fmtUsd(realized)}</span></div>

              <div className="card-title" style={{ marginTop: 16 }}>Capital — read from chain</div>
              <div className="kv"><span className="k">Available / reserved</span><span className="v mono">{fmtUsd(available, 0)} / {fmtUsd(reserved, 0)}</span></div>
              <div className="kv"><span className="k">Pending exercise</span><span className="v mono">{fmtUsd(tok(p.pendingExercise), 0)}</span></div>
              <div className="bar" style={{ marginTop: 8 }}><span style={{ width: fmtPct(utilization), background: "var(--blue)" }} /></div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>utilization {fmtPct(utilization)}</div>

              <div className="card-title" style={{ marginTop: 16 }}>Modelled costs</div>
              <div className="kv"><span className="k">Execution + funding</span><span className="v mono">{fmtUsd(exec)}</span></div>
              <div className="kv"><span className="k">Operating expense</span><span className="v mono">{fmtUsd(ops)}</span></div>
              <div className="kv"><span className="k">Capital opportunity cost</span><span className="v mono">{fmtUsd(capital)}</span></div>
              <div className="kv"><span className="k">Risk allowance</span><span className="v mono">{fmtUsd(risk)}</span></div>
              <div className="kv"><span className="k">Modelled hedge result</span><span className="v mono">{m.hedgeAvailable ? fmtUsd(hedge) : "n/a"}</span></div>

              <div className="hr" />
              <div className="kv"><span className="k">Modelled net (unhedged)</span><span className={"v mono " + (netUnhedged >= 0 ? "pos" : "neg")}>{fmtUsd(netUnhedged)}</span></div>
              <div className="kv"><span className="k">Modelled net (hedged)</span><span className="v mono">{netHedged === null ? "n/a" : fmtUsd(netHedged)}</span></div>
              <div className="kv"><span className="k">Stress: reference −20%</span><span className="v mono neg">−{fmtUsd(reserved * 0.2, 0)}</span></div>
            </div>
          );
        })}
      </div>
    </>
  );
}
