import { useEffect, useState } from "react";
import { explorerUrl, useChain } from "../onchain/store";
import { rpcScope } from "../onchain/transactionRecovery";

export default function TransactionProgress({ onViewPositions }: { onViewPositions: () => void }) {
  const c = useChain();
  const tx = c.transaction;
  const recover = c.recoverTransaction;
  const busy = c.busy;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const relevant = !!tx && tx.rpc === rpcScope(c.conn.rpcEndpoint);
  useEffect(() => {
    if (!relevant || tx?.state !== "checking" || busy) return;
    void recover();
    const timer = window.setInterval(() => { void recover(); }, 10000);
    return () => window.clearInterval(timer);
  }, [relevant, tx?.signature, tx?.state, recover, busy]);
  if (!relevant || !tx || (dismissed === tx.signature && tx.state !== "checking")) return null;
  return <section className="transaction-progress" aria-label="Transaction recovery" role="status">
    <div><strong>{tx.state === "checking" ? "Checking your transaction" : tx.state === "confirmed" ? "Transaction confirmed onchain" : tx.state === "failed" ? "Transaction failed" : "Transaction expired without confirmation"}</strong>
      <p className="faint">{tx.state === "checking" ? "Keep this page open or return later. We’ll check the original signature before allowing another submission." : tx.state === "confirmed" ? "Your execution is recorded. Open Positions for coverage and settlement status." : "No successful execution was found. Review your position before submitting again."}</p></div>
    <div className="row"><a className="btn ghost" href={explorerUrl("tx", tx.signature)} target="_blank" rel="noreferrer">View transaction ↗</a>
      {tx.state === "checking" ? <button className="btn ghost" disabled={c.recovering || busy} onClick={() => void recover()}>{c.recovering || busy ? "Checking…" : "Check status"}</button> : <><button className="btn ghost" onClick={onViewPositions}>View positions</button><button className="btn ghost" onClick={() => setDismissed(tx.signature)}>Dismiss</button></>}</div>
  </section>;
}
