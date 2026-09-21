import { useChain } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";
import { ASSUMPTIONS } from "../engine";
import { fmtOusd, fmtPct } from "../format";

const tok = (v: bigint) => Number(v) / 1e6;

/** Onchain pool solvency first; modelled operating economics second. */
export default function UnderwriterTab() {
  const c = useChain();
  const loading = !c.pools[0] && !c.pools[1];

  return (
    <>
      <div className="app-page-head">
        <div><div className="card-title">Pool risk & capital</div><h1>Pools</h1><p>Collateral and realized activity come from Devnet pool accounts. Cost assumptions are modelled and are never presented as executed hedges.</p></div>
      </div>

      {loading && <div className="card empty" role="status">{c.busy ? "Reading pool accounts…" : <><strong>Pool accounts are unavailable.</strong><p>The Devnet RPC did not return pool data. Try again in a moment.</p><button className="btn ghost sm" onClick={() => c.refresh()}>Refresh pool data</button></>}</div>}

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
          const baseModelLoad = m.jumpEventBps + m.earlyExerciseBps + m.hedgeCostBps + m.executionFundingBps + m.opsBps + m.capitalCostBps + m.riskAllowanceBps;

          return (
            <section className="risk-section" key={a.key}>
              <div className="risk-head">
                <div><span className="lp-reference-kind">{a.kind === "PreStocks" ? "PreStocks" : "xStock"}</span><h2>{a.symbol}</h2></div>
                <span className={"pill " + (m.hedgeAvailable ? "blue" : "gray")}>
                  {m.hedgeAvailable ? "external hedge venue identified" : "no executable external hedge"}
                </span>
              </div>

              <div className="risk-metrics">
                <div><span>Available capital</span><strong className="mono">{fmtOusd(available, 0)}</strong></div>
                <div><span>Reserved collateral</span><strong className="mono">{fmtOusd(reserved, 0)}</strong></div>
                <div><span>Utilization</span><strong className="mono">{fmtPct(utilization)}</strong></div>
                <div><span>Pending exercise</span><strong className="mono">{fmtOusd(tok(p.pendingExercise), 0)}</strong></div>
              </div>
              <div className="capacity-visual">
                <div className="bar" aria-label={`Pool utilization ${fmtPct(utilization)}`}><span style={{ width: `${utilization * 100}%` }} /></div>
                <div><span>Reserved <strong className="mono">{fmtOusd(reserved, 0)}</strong></span><span>Available <strong className="mono">{fmtOusd(available, 0)}</strong></span></div>
              </div>

              <div className="risk-columns">
                <details><summary>Devnet pool activity</summary><div className="kv"><span className="k">Premium receipts</span><span className="v mono">{fmtOusd(premiums)}</span></div><div className="kv"><span className="k">Gross payouts</span><span className="v mono">{fmtOusd(payouts)}</span></div><div className="kv"><span className="k">Failed-reference refunds</span><span className="v mono">{fmtOusd(refunds)}</span></div><div className="kv"><span className="k">Realized test net</span><span className={"v mono " + (realized >= 0 ? "pos" : "neg")}>{fmtOusd(realized)}</span></div><p className="test-activity-note">Includes intentionally exercised Devnet scenarios and is not representative of expected pool return.</p></details>
                <details><summary>Pricing assumptions · v{m.version}</summary><div className="kv"><span className="k">Weekly jump and event risk</span><span className="v mono">{m.jumpEventBps} bps</span></div><div className="kv"><span className="k">Early exercise</span><span className="v mono">{m.earlyExerciseBps} bps</span></div><div className="kv"><span className="k">Execution and funding</span><span className="v mono">{m.executionFundingBps} bps</span></div><div className="kv"><span className="k">Operating expense</span><span className="v mono">{m.opsBps} bps</span></div><div className="kv"><span className="k">Capital opportunity cost</span><span className="v mono">{m.capitalCostBps} bps</span></div><div className="kv"><span className="k">Risk allowance</span><span className="v mono">{m.riskAllowanceBps} bps</span></div><div className="kv"><span className="k">Hedge cost assumption</span><span className="v mono">{m.hedgeCostBps} bps</span></div><div className="kv pricing-total"><span className="k">1-week base model load</span><span className="v mono">{baseModelLoad} bps</span></div><div className="kv"><span className="k">Executable hedge</span><span className="v">{m.hedgeAvailable ? "Not executed by Optket" : "Unavailable"}</span></div></details>
              </div>
              <p className="disclosure">Lifetime realized activity and current pricing assumptions are shown separately; they are not netted across different accounting periods. Maximum contractual payouts remain fully reserved; realized results depend on each contract’s floor and qualifying settlement reference.</p>
            </section>
          );
        })}
      </div>
    </>
  );
}
