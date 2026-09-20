import { useChain, explorerUrl } from "../onchain/store";
import { VERIFIED_ASSETS } from "../data/assets";

/**
 * Transaction history (PRD §13.7) read from the chain — every signature that
 * touched a contract this wallet owns. There is no local activity log; if it
 * isn't on-chain, it isn't here.
 */
export default function HistoryTab({ onProtect }: { onProtect: () => void }) {
  const c = useChain();

  if (!c.connected) {
    return <div className="card empty">Connect the demo wallet to see your onchain history.</div>;
  }

  return (
    <>
    <div className="app-page-head">
      <div><div className="card-title">Verifiable activity</div><h1>Onchain</h1><p>Confirmed Devnet signatures touching contracts owned by the connected wallet. No local or sample activity is inserted.</p></div>
    </div>
    <div className="card">
      <div className="between" style={{ marginBottom: 4 }}>
        <div className="card-title" style={{ margin: 0 }}>Onchain activity</div>
        <button className="btn ghost sm" disabled={c.busy} onClick={() => c.refresh()}>Refresh</button>
      </div>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
        Signatures touching your contract accounts, newest first. Every row opens in the explorer.
      </div>

      {c.history.length === 0 ? (
        <div className="empty">
          <strong>No onchain activity yet.</strong><br />Create a position and its confirmed signature will appear here.<div><button className="btn primary sm" style={{ marginTop: 14 }} onClick={onProtect}>Buy protection</button></div>
        </div>
      ) : (
        <table className="log">
          <thead>
            <tr><th>When</th><th>Action</th><th>Asset</th><th>Contract</th><th>Status</th><th>Signature</th></tr>
          </thead>
          <tbody>
            {c.history.map((h) => (
              <tr key={h.signature}>
                <td className="mono faint">
                  {h.blockTime ? new Date(h.blockTime * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </td>
                <td>Contract transaction</td>
                <td>{VERIFIED_ASSETS[h.assetId]?.symbol ?? h.assetId}</td>
                <td className="mono">#{h.contractId.toString()}</td>
                <td>{h.err ? <span className="pill red">failed</span> : <span className="pill green">confirmed</span>}</td>
                <td>
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
    </>
  );
}
