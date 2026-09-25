import { roundStage, type VaultRoundAccount } from "../client/vaultProgram";
import { fmtClock } from "../format";

export default function VaultTimeline({ round, now, fresh }: { round: VaultRoundAccount; now: number; fresh: boolean }) {
  const stage = roundStage(round, now);
  const current = !fresh ? -1 : stage === "Funding" ? 0 : stage === "Redeemable" ? 2 : 1;
  return <ol className="vault-timeline" aria-label="Round funding and withdrawal timeline">
    <li aria-current={current === 0 ? "step" : undefined}><strong>Funding</strong><span>Until {fmtClock(round.fundingClose)}</span><small>Deposit or cancel</small></li>
    <li aria-current={current === 1 ? "step" : undefined}><strong>{stage === "Settling" ? "Settling" : "Locked"}</strong><span>Latest expiry {fmtClock(round.latestExpiry)}</span><small>Until all obligations resolve</small></li>
    <li aria-current={current === 2 ? "step" : undefined}><strong>{current === 2 ? "Withdrawable" : "Withdrawal"}</strong><span>{current === 2 ? "Settlement complete" : "After settlement completes"}</span><small>Remaining balance after premiums and payouts</small></li>
  </ol>;
}
