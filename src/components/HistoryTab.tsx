import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";

/**
 * Transaction history (PRD §13.7) read from the chain — every signature that
 * touched a contract this wallet owns. There is no local activity log; if it
 * isn't on-chain, it isn't here.
 */
export default function HistoryTab() {
  const c = useChain();

  if (!c.connected) {
    return <div className="card empty">Connect the demo wallet to see your on-chain history.</div>;
  }

  return (
    <div className="card">
      <div className="between" style={{ marginBottom: 4 }}>
        <div className="card-title" style={{ margin: 0 }}>On-chain activity</div>
        <button className="btn ghost sm" disabled={c.busy} onClick={() => c.refresh()}>Refresh</button>
      </div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
        Signatures touching your contract accounts, newest first. Every row opens in the explorer.
      </div>

      {c.history.length === 0 ? (
        <div className="empty">
          No transactions yet. Buy protection in the Protect tab and it will appear here within seconds.
        </div>
      ) : (
        <table className="log">
          <thead>
            <tr><th>When</th><th>Contract</th><th>Asset</th><th>Slot</th><th>Signature</th></tr>
          </thead>
          <tbody>
            {c.history.map((h) => (
              <tr key={h.signature}>
                <td className="mono faint">
                  {h.blockTime ? new Date(h.blockTime * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                <td className="mono">#{h.contractId.toString()}</td>
                <td>{VERIFIED_ASSETS[h.assetId]?.symbol ?? h.assetId}</td>
                <td className="mono faint">{h.slot.toLocaleString()}</td>
                <td>
                  {h.err && <span className="pill red" style={{ marginRight: 6 }}>failed</span>}
                  <a className="mono" href={explorerUrl("tx", h.signature)} target="_blank" rel="noreferrer">
                    {h.signature.slice(0, 16)}… ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
