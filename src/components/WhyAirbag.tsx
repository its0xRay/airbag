import { useState } from "react";
import CapitalFlow, { CapitalFlowPaths } from "./CapitalFlow";
import "./WhyAirbag.css";

const alternatives = [
  { name: "Sell now", detail: "Exit the position", values: ["Sold", "Give up exposure after selling", "Execution fees and possible slippage"] },
  { name: "Stop-market order", detail: "Trigger a sale", values: ["Triggers a sale; execution price can vary", "Exposure ends when sold", "Execution fees and possible slippage; no guaranteed floor"] },
  { name: "Leveraged short", detail: "Offset exposure", values: ["Held separately from the short", "Reduced by the short’s size", "Margin and liquidation risk; funding may be paid or received"] },
];
const rows = ["Token ownership", "Upside", "Cost & trade-off"];
const airbag = ["Kept in your wallet", "Kept, minus premium", "Upfront premium. Cover ends at expiry."];
function FundingIcon({ kind }: { kind: "holder" | "vault" | "depositor" }) {
  return <span className="funding-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{kind === "holder" ? <><path d="M3 7h18v13H3zM3 7V4h15v3M16 12h5v4h-5z" /></> : kind === "vault" ? <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="4" /><path d="M12 8v8M8 12h8" /></> : <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></>}</svg></span>;
}

export default function WhyAirbag() {
  const [comparison, setComparison] = useState(0);
  return <section className="lp-section lp-light why-one" id="why-protect" aria-labelledby="why-protect-title">
    <div className="why-heading"><div><span className="lp-eyebrow">Why Airbag</span><h2 className="lp-h2" id="why-protect-title">A price drop shouldn’t force your exit.</h2></div><p>Different ways to manage downside. Different trade-offs.</p></div>
    <div className="why-comparison">
      <label className="why-mobile-choice">Compare Airbag with<select className="input" value={comparison} onChange={e => setComparison(Number(e.target.value))}>{alternatives.map((a, i) => <option key={a.name} value={i}>{a.name}</option>)}</select></label>
      <table><caption className="sr-only">Ways to manage downside</caption><thead><tr><th scope="col"><span className="sr-only">Trade-off</span></th>{alternatives.map((a, i) => <th scope="col" key={a.name} className={i === comparison ? "comparison-selected" : "comparison-other"}>{a.name}<small>{a.detail}</small></th>)}<th scope="col" className="airbag-column">Airbag floor<small>Cash-settled put</small></th></tr></thead>
      <tbody>{rows.map((row, r) => <tr key={row}><th scope="row">{row}</th>{alternatives.map((a, i) => <td key={a.name} className={i === comparison ? "comparison-selected" : "comparison-other"}>{a.values[r]}</td>)}<td className="airbag-column">{airbag[r]}</td></tr>)}</tbody></table>
      <p className="why-availability">Alternative instruments depend on market availability. Airbag payouts follow the contract’s settlement reference.</p>
    </div>
    <div className="why-funding"><h3>How payouts are funded</h3><CapitalFlow>
      <div className="funding-party"><FundingIcon kind="holder" /><h4>Holders</h4><p>Pay a premium. Keep your tokens.</p></div>
      <CapitalFlowPaths forward="Premium" reverse="Contract payout" />
      <div className="funding-party funding-vault"><FundingIcon kind="vault" /><h4>Isolated vault</h4><p>Reserves each position’s maximum payout.</p></div>
      <CapitalFlowPaths forward="Withdrawal after settlement" reverse="Deposit" />
      <div className="funding-party"><FundingIcon kind="depositor" /><h4>Depositors</h4><p>Fund payouts. Share in premiums.</p></div>
    </CapitalFlow></div>
  </section>;
}
