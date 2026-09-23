import { roundStage } from "../client/vaultProgram";
import { redemptionValue, type OwnedVaultDeposit } from "../client/vaultPortfolio";
import { VERIFIED_ASSETS } from "../data/assets";
import { fmtClock, fmtOusd } from "../format";
import { useNowSeconds } from "../useNowSeconds";
import "./VaultsTab.css";

export default function VaultDepositList({ deposits }: { deposits: OwnedVaultDeposit[] }) {
  const now = useNowSeconds();
  const open = deposits.filter(({ deposit }) => !deposit.redeemed);
  const past = deposits.filter(({ deposit }) => deposit.redeemed);
  const row = ({ round, deposit }: OwnedVaultDeposit) => {
    const value = redemptionValue(round, deposit);
    const stage = roundStage(round, now);
    return <article className="vault-position-row" key={deposit.address.toBase58()}>
      <div><h3>{VERIFIED_ASSETS[round.assetId].symbol} vault</h3><p>{deposit.redeemed ? "Withdrawn" : stage} · {fmtClock(round.fundingClose)}</p></div>
      <div><span className="disclosure">Deposited</span><strong className="mono">{fmtOusd(Number(deposit.shares) / 1e6)}</strong></div>
      <div><span className="disclosure">{value == null ? "Next step" : deposit.redeemed ? "Received" : "Available to withdraw"}</span>
        <strong className={value == null ? "" : "mono"}>{value == null ? stage === "Funding" ? "Add or cancel before cutoff" : "Wait for obligations to settle" : fmtOusd(Number(value) / 1e6)}</strong>
        {value != null && <small>Net result {fmtOusd(Number(value - deposit.shares) / 1e6)} · test activity</small>}</div>
      <a className="btn ghost" href={`?view=vaults&round=${round.address.toBase58()}`}>{!deposit.redeemed && stage === "Redeemable" ? "Review withdrawal" : "View deposit"}</a>
    </article>;
  };
  return <section className="owned-vaults" aria-label="Your vault deposits"><div className="between"><h2>Vault deposits</h2><a className="btn ghost" href="?view=vaults">Fund a vault</a></div>
    <p className="disclosure">Separate from your buyer contracts. Capital backs payouts; deposits never renew automatically.</p>
    {open.length ? open.sort((a, b) => Number(b.round.phase === "redeemable") - Number(a.round.phase === "redeemable") || b.round.fundingClose - a.round.fundingClose).map(row) : <p>No outstanding vault deposits.</p>}
    {past.length > 0 && <details className="secondary-tool"><summary>Withdrawn deposits ({past.length})</summary>{past.sort((a, b) => b.round.fundingClose - a.round.fundingClose).map(row)}</details>}
  </section>;
}
