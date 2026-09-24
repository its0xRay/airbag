import { roundStage } from "../client/vaultProgram";
import { redemptionValue, type OwnedVaultDeposit } from "../client/vaultPortfolio";
import { VERIFIED_ASSETS } from "../data/assets";
import { fmtClock, fmtOusd } from "../format";
import { useNowSeconds } from "../useNowSeconds";
import "./VaultsTab.css";
import { useEffect, useRef } from "react";

export default function VaultDepositList({ deposits, view, target, refreshing = false, onRefresh }: { deposits: OwnedVaultDeposit[]; view?: "active" | "history"; target?: string | null; refreshing?: boolean; onRefresh?: () => void }) {
  const now = useNowSeconds();
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!target || focused.current === target) return;
    const card = document.getElementById(`deposit-${target}`);
    if (card) { card.scrollIntoView({ block: "start", behavior: "instant" }); card.focus({ preventScroll: true }); focused.current = target; }
  }, [deposits, target, view]);
  const open = deposits.filter(({ deposit }) => !deposit.redeemed);
  const past = deposits.filter(({ deposit }) => deposit.redeemed);
  const row = ({ round, deposit }: OwnedVaultDeposit) => {
    const value = redemptionValue(round, deposit);
    const stage = roundStage(round, now);
    return <article className={"vault-position-row" + (target === round.address.toBase58() ? " position-highlighted" : "")} id={`deposit-${round.address.toBase58()}`} tabIndex={-1} key={deposit.address.toBase58()}>
      <div><h3>{VERIFIED_ASSETS[round.assetId].symbol} vault</h3><p>{deposit.redeemed ? "Withdrawn" : stage} · {fmtClock(round.fundingClose)}</p></div>
      <div><span className="disclosure">Deposited</span><strong className="mono">{fmtOusd(Number(deposit.shares) / 1e6)}</strong></div>
      <div><span className="disclosure">{value == null ? "Next step" : deposit.redeemed ? "Received" : "Available to withdraw"}</span>
        <strong className={value == null ? "" : "mono"}>{value == null ? stage === "Funding" ? "Add or cancel before cutoff" : "Wait for obligations to settle" : fmtOusd(Number(value) / 1e6)}</strong>
        {value != null && <small>Net result {fmtOusd(Number(value - deposit.shares) / 1e6)} · test activity</small>}</div>
      <a className="btn ghost" href={`?view=vaults&round=${round.address.toBase58()}`}>{!deposit.redeemed && stage === "Redeemable" ? "Review withdrawal" : "View deposit"}</a>
    </article>;
  };
  if (view) {
    const visible = view === "active" ? open : past;
    const waiting = !!target && !deposits.some(d => d.round.address.toBase58() === target);
    return <section className="position-vault-list" aria-label="Your vault deposits">
      {waiting || (refreshing && !deposits.length) ? <div className="card empty" role="status"><strong>{refreshing ? "Loading your deposits…" : "Deposit data hasn’t loaded yet."}</strong><p>Your confirmed receipt remains available.</p><button className="btn ghost" disabled={refreshing} onClick={onRefresh}>Refresh deposits</button></div>
        : visible.length ? [...visible].sort((a, b) => Number(b.round.address.toBase58() === target) - Number(a.round.address.toBase58() === target) || Number(b.round.phase === "redeemable") - Number(a.round.phase === "redeemable") || b.round.fundingClose - a.round.fundingClose).map(row)
        : <div className="card empty"><strong>{view === "active" ? "No active vault deposits." : "No withdrawn deposits yet."}</strong><p>{view === "active" ? "Use Fund a vault to join an available funding round." : "Completed withdrawals appear here."}</p></div>}
    </section>;
  }
  return <section className="owned-vaults" aria-label="Your vault deposits"><div className="between"><h2>Vault deposits</h2><a className="btn ghost" href="?view=vaults">Fund a vault</a></div>
    <p className="disclosure">Separate from your buyer contracts. Capital backs payouts; deposits never renew automatically.</p>
    {open.length ? open.sort((a, b) => Number(b.round.phase === "redeemable") - Number(a.round.phase === "redeemable") || b.round.fundingClose - a.round.fundingClose).map(row) : <p>No outstanding vault deposits.</p>}
    {past.length > 0 && <details className="secondary-tool"><summary>Withdrawn deposits ({past.length})</summary>{past.sort((a, b) => b.round.fundingClose - a.round.fundingClose).map(row)}</details>}
  </section>;
}
